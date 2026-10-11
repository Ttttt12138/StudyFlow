"""The only code path that changes demo wallet balances."""
from copy import deepcopy
from decimal import Decimal, localcontext

from django.contrib.auth import get_user_model
from django.db.models import Max
from django.utils import timezone

from . import money
from .services import VersionConflict
from .workflow_common import append_state, audit, current, owned, record, require
from .workflow_models import (
    CurrencyConversion, DemoLedgerEntry, DemoWallet, FXQuote, WalletBalance,
)


def executable_sources():
    """Fixture-priced quotes only execute when the deployment itself runs on fixtures."""
    from django.conf import settings

    return ("frankfurter",) if settings.STUDYFLOW_FX_LIVE else ("frankfurter", "fixture")


def wallet(owner):
    item = DemoWallet.objects.filter(owner=owner).first()
    require(item is not None, "Initialize the isolated demo wallet first.")
    return item


def balance_of(item, currency):
    if currency == money.home_currency():
        return item.balance
    row = WalletBalance.objects.filter(owner=item.owner, currency=currency).first()
    return row.balance if row else Decimal(0)


def post(item, currency, amount, origin):
    """Write one ledger row and move the matching balance; never below zero."""
    money.require_supported(currency)
    amount = money.require_precision(amount, currency)
    require(amount != 0, "Ledger amount must be non-zero.")
    # Sequence numbers span currencies, so serialize on the owner as CommandView does.
    get_user_model().objects.select_for_update().get(pk=item.owner_id)
    if currency == money.home_currency():
        holder = DemoWallet.objects.select_for_update().get(pk=item.pk)
    else:
        holder, _ = WalletBalance.objects.select_for_update().get_or_create(
            owner=item.owner, currency=currency, defaults={"wallet": item})
    balance = holder.balance + amount
    require(Decimal(0) <= balance <= money.MAX_BALANCE, "INSUFFICIENT_BALANCE_OR_PRECISION")
    last = DemoLedgerEntry.objects.filter(owner=item.owner).aggregate(n=Max("sequence"))["n"] or 0
    entry = DemoLedgerEntry.objects.create(
        owner=item.owner, currency=currency, amount=amount, sequence=last + 1,
        effective_on=item.clock, **origin)
    holder.balance = balance
    holder.save(update_fields=["balance"])
    if isinstance(holder, DemoWallet):
        item.balance = balance
    return entry


def balances(item, available_home):
    home = money.home_currency()
    from .fx_rates import valuation

    rows = [{"currency": home, "balance": money.fmt(item.balance, home),
             "available_balance": money.fmt(available_home, home), "is_home": True,
             "indicative_home_value": money.fmt(item.balance, home), "valuation": None}]
    for row in WalletBalance.objects.filter(owner=item.owner).order_by("currency"):
        value, basis = valuation(row.currency, row.balance)
        rows.append({"currency": row.currency, "balance": money.fmt(row.balance, row.currency),
                     "available_balance": money.fmt(row.balance, row.currency), "is_home": False,
                     "indicative_home_value": value, "valuation": basis})
    return {"home_currency": home, "balances": rows, "is_simulated": True}


def quote_result(quote, amount, source_currency, target_currency):
    """Net received for sending `amount` through `quote`, in target precision."""
    require(amount > quote.sender_fee, "Sender fee consumes the allocation.")
    with localcontext() as context:
        context.prec = 48
        result = (amount - quote.sender_fee) * quote.rate - quote.receiver_fee
        require(result > 0, "CONVERSION_NOT_POSITIVE")
        require(result <= Decimal("99999999999999.99"),
                "Converted amount exceeds supported monetary precision.")
        result = money.quantize(result, target_currency)
    require(result > 0, "CONVERSION_NOT_POSITIVE")
    return result


def convert_balance(actor, data, obj=None):
    from .execution_services import available

    item = wallet(actor)
    quote = owned(FXQuote, actor, data["quote_id"])
    require(quote.consumed_at is None, "QUOTE_CONSUMED")
    require(quote.expires_at > timezone.now(), "QUOTE_EXPIRED")
    # Self-priced manual quotes are estimates; only server-priced corridor quotes move balances.
    require(quote.corridor_id is not None and quote.rate_source in executable_sources(),
            "QUOTE_NOT_EXECUTABLE")
    require(quote.corridor.enabled, "CORRIDOR_DISABLED")
    from .remittance_models import RemittanceOrder

    require(not RemittanceOrder.objects.filter(quote=quote).exists(), "QUOTE_IN_USE")
    source, target = quote.source_currency, quote.target_currency
    money.require_supported(source)
    money.require_supported(target)
    require(source != target, "SAME_CURRENCY_QUOTE")
    amount = money.require_precision(data["source_amount"], source)
    require(amount > 0, "Amount must be positive.")
    require(quote.quoted_amount is None or amount == quote.quoted_amount, "QUOTE_AMOUNT_MISMATCH")
    require(quote.corridor.min_amount <= amount <= quote.corridor.max_amount,
            "CORRIDOR_AMOUNT_OUT_OF_RANGE")
    state = current(actor)
    if state.version != data["state_version"]:
        raise VersionConflict()
    require(amount > quote.sender_fee, "CONVERSION_NOT_POSITIVE")
    received = quote_result(quote, amount, source, target)
    require(balance_of(item, source) >= amount, "INSUFFICIENT_BALANCE")
    home = money.home_currency()
    if source == home:
        require(available(item) - amount >= Decimal(state.snapshot["reserve"]), "RESERVE_REQUIRED")
    conversion = CurrencyConversion.objects.create(
        owner=actor, quote=quote, source_currency=source, source_amount=amount,
        target_currency=target, target_amount=received, rate=quote.rate,
        sender_fee=quote.sender_fee, receiver_fee=quote.receiver_fee, effective_on=item.clock)
    debit = post(item, source, -amount, {"conversion": conversion})
    credit = post(item, target, received, {"conversion": conversion})
    quote.consumed_at = timezone.now()
    quote.save(update_fields=["consumed_at"])
    if home in (source, target):
        snapshot = deepcopy(state.snapshot)
        leg = credit if target == home else debit
        snapshot["events"].append({
            "id": f"conversion:{conversion.id}",
            "label": f"Converted {source} to {target}",
            "kind": "income" if target == home else "expense",
            "amount": money.fmt(abs(leg.amount), home),
            "date": item.clock.isoformat(), "certainty": "confirmed",
            "settled_sequence": leg.sequence,
        })
        append_state(actor, snapshot, actor, "state.conversion_settled")
    audit(actor, actor, "wallet.conversion_settled", conversion, {
        "quote_id": str(quote.id), "source_currency": source, "source_amount": str(amount),
        "target_currency": target, "target_amount": str(received), "is_simulated": True})
    result = record(conversion)
    result.update(quote_id=str(quote.id), source_amount=money.fmt(amount, source),
                  target_amount=money.fmt(received, target),
                  debit_sequence=debit.sequence, credit_sequence=credit.sequence,
                  is_simulated=True)
    return result
