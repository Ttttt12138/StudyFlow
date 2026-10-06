"""Remittance order state machine (docs/remittance.md)."""
from copy import deepcopy
from decimal import Decimal, localcontext

from django.utils import timezone

from . import money
from .remittance_models import RemittanceOrder, RemittanceStatusEvent
from .services import VersionConflict
from .wallets import EXECUTABLE_SOURCES, balance_of, post, quote_result, wallet
from .workflow_common import append_state, audit, current, owned, record, require, shift_date
from .workflow_models import Beneficiary, DemoLedgerEntry, FXQuote

# action: (allowed from-statuses, to-status)
TRANSITIONS = {
    "cancel": ({"CREATED"}, "CANCELLED"),
    "expire": ({"CREATED"}, "EXPIRED"),
    "submit": ({"CREATED"}, "SUBMITTED"),
    "dispatched": ({"SUBMITTED"}, "IN_TRANSIT"),
    "delivered": ({"SUBMITTED", "IN_TRANSIT", "UNKNOWN"}, "DELIVERED"),
    "failed": ({"SUBMITTED", "IN_TRANSIT", "UNKNOWN"}, "REFUNDED"),
    "unknown": ({"SUBMITTED", "IN_TRANSIT"}, "UNKNOWN"),
    "reconcile": ({"DELIVERED"}, "RECONCILED"),
}
# Adapter outcomes already reflected by these statuses are acknowledged without effect.
SETTLED_BY = {"dispatched": {"IN_TRANSIT"}, "delivered": {"DELIVERED", "RECONCILED"},
              "failed": {"REFUNDED"}, "unknown": {"UNKNOWN"}}


def _transition(order, action, actor, note="", details=None):
    allowed, target = TRANSITIONS[action]
    require(order.status in allowed, "INVALID_TRANSITION")
    previous = order.status
    order.status = target
    order.version += 1
    order.save()
    RemittanceStatusEvent.objects.create(
        owner=order.owner, order=order, from_status=previous, to_status=target, actor=actor,
        version=order.version, note=note[:500], details={"action": action, **(details or {})})
    audit(order.owner, actor, f"remittance.{action}", order,
          {"from": previous, "to": target, "is_simulated": True})


def _check_version(order, data):
    if order.version != data["expected_version"]:
        raise VersionConflict()


def _quote_expired(order):
    return order.status == "CREATED" and order.quote.expires_at <= timezone.now()


def _ledger_event(order, entry, kind, suffix):
    """Mirror a home-currency movement into the cash-flow state, like conversions do."""
    if entry.currency != money.home_currency():
        return
    state = current(order.owner)
    snapshot = deepcopy(state.snapshot)
    snapshot["events"].append({
        "id": f"remittance:{order.id}:{suffix}", "label": f"Remittance {suffix}",
        "kind": kind, "amount": money.fmt(abs(entry.amount), entry.currency),
        "date": entry.effective_on.isoformat(), "certainty": "confirmed",
        "settled_sequence": entry.sequence})
    append_state(order.owner, snapshot, order.owner, f"state.remittance_{suffix}")


def order_record(order):
    data = record(order)
    with localcontext() as context:
        context.prec = 48
        margin = (order.send_amount - order.sender_fee) * (order.mid_rate - order.rate) / order.mid_rate
    margin = money.quantize(max(margin, Decimal(0)), order.send_currency)
    data.update(
        effective_status="EXPIRED" if _quote_expired(order) else order.status,
        send_amount=money.fmt(order.send_amount, order.send_currency),
        sender_fee=money.fmt(order.sender_fee, order.send_currency),
        receive_amount=money.fmt(order.receive_amount, order.receive_currency),
        fx_margin_cost=money.fmt(margin, order.send_currency),
        total_cost=money.fmt(order.sender_fee + margin, order.send_currency),
        on_time=(order.delivered_on <= order.deadline) if order.delivered_on and order.deadline else None,
        rate_date=order.quote.rate_date.isoformat() if order.quote.rate_date else None,
        rate_source=order.quote.rate_source,
        history=[{"from": e.from_status, "to": e.to_status, "version": e.version, "note": e.note,
                  "actor_id": e.actor_id, "at": e.created_at.isoformat(), "details": e.details}
                 for e in order.history.all()],
        is_simulated=True)
    return data


def create_order(actor, data, obj=None):
    item = wallet(actor)
    quote = owned(FXQuote, actor, data["quote_id"])
    require(quote.corridor_id is not None and quote.rate_source in EXECUTABLE_SOURCES
            and quote.quoted_amount is not None, "QUOTE_NOT_EXECUTABLE")
    require(quote.consumed_at is None, "QUOTE_CONSUMED")
    require(not RemittanceOrder.objects.filter(quote=quote).exists(), "QUOTE_IN_USE")
    require(quote.expires_at > timezone.now(), "QUOTE_EXPIRED")
    require(quote.corridor.enabled, "CORRIDOR_DISABLED")
    beneficiary = None
    if data["recipient"] == "BENEFICIARY":
        require(data.get("beneficiary_id"), "BENEFICIARY_REQUIRED")
        beneficiary = owned(Beneficiary, actor, data["beneficiary_id"])
        require(beneficiary.verified, "BENEFICIARY_NOT_VERIFIED")
    else:
        require(not data.get("beneficiary_id"), "SELF_RECIPIENT_HAS_NO_BENEFICIARY")
    source, target = quote.source_currency, quote.target_currency
    received = quote_result(quote, quote.quoted_amount, source, target)
    order = RemittanceOrder.objects.create(
        owner=actor, quote=quote, corridor=quote.corridor, recipient=data["recipient"],
        beneficiary=beneficiary, purpose=data["purpose"], reference=data.get("reference", ""),
        send_currency=source, send_amount=quote.quoted_amount, sender_fee=quote.sender_fee,
        rate=quote.rate, mid_rate=quote.mid_rate or quote.rate, receive_currency=target,
        receive_amount=received, deadline=data.get("deadline"),
        expected_earliest=shift_date(item.clock, quote.settlement_min_days),
        expected_latest=shift_date(item.clock, quote.settlement_days))
    RemittanceStatusEvent.objects.create(
        owner=actor, order=order, from_status="", to_status="CREATED", actor=actor, version=1,
        details={"action": "create", "quote_id": str(quote.id)})
    audit(actor, actor, "remittance.created", order, {"quote_id": str(quote.id), "is_simulated": True})
    return order_record(order)


def cancel(actor, data, order):
    if order.status == "CANCELLED":
        return order_record(order)
    _check_version(order, data)
    _transition(order, "expire" if _quote_expired(order) else "cancel", actor, data.get("note", ""))
    return order_record(order)


def submit(actor, data, order):
    if order.status != "CREATED":
        require(order.status not in {"CANCELLED", "EXPIRED"}, "INVALID_TRANSITION")
        return order_record(order)  # already submitted: idempotent
    _check_version(order, data)
    if _quote_expired(order):
        # Persist the expiry and report it in the response; nothing is debited.
        _transition(order, "expire", actor, "Quote expired before submission")
        return order_record(order)
    item = wallet(actor)
    quote, corridor = order.quote, order.corridor
    require(quote.consumed_at is None, "QUOTE_CONSUMED")
    require(corridor.enabled, "CORRIDOR_DISABLED")
    require(corridor.min_amount <= order.send_amount <= corridor.max_amount, "CORRIDOR_AMOUNT_OUT_OF_RANGE")
    if order.beneficiary_id:
        require(order.beneficiary.verified, "BENEFICIARY_NOT_VERIFIED")
    require(balance_of(item, order.send_currency) >= order.send_amount, "INSUFFICIENT_BALANCE")
    if order.send_currency == money.home_currency():
        from .execution_services import available

        state = current(actor)
        require(available(item) - order.send_amount >= Decimal(state.snapshot["reserve"]), "RESERVE_REQUIRED")
    entry = post(item, order.send_currency, -order.send_amount,
                 {"remittance_order": order, "remittance_leg": "debit"})
    quote.consumed_at = timezone.now()
    quote.save(update_fields=["consumed_at"])
    order.submitted_at = timezone.now()
    _transition(order, "submit", actor, details={"debit_sequence": entry.sequence})
    _ledger_event(order, entry, "expense", "debit")
    return order_record(order)


def adapter_event(actor, data, order):
    outcome = data["outcome"]
    if order.status in SETTLED_BY[outcome]:
        return order_record(order)
    _check_version(order, data)
    if _quote_expired(order):
        _transition(order, "expire", actor, "Quote expired before submission")
        return order_record(order)
    note = data.get("note", "")
    item = wallet(order.owner)
    if outcome == "delivered":
        require(order.status in TRANSITIONS["delivered"][0], "INVALID_TRANSITION")
        order.delivered_on = item.clock
        details = {}
        if order.recipient == "SELF":
            entry = post(item, order.receive_currency, order.receive_amount,
                         {"remittance_order": order, "remittance_leg": "credit"})
            details["credit_sequence"] = entry.sequence
            _ledger_event(order, entry, "income", "credit")
        _transition(order, "delivered", actor, note, details)
    elif outcome == "failed":
        require(order.status in TRANSITIONS["failed"][0], "INVALID_TRANSITION")
        entry = post(item, order.send_currency, order.send_amount,
                     {"remittance_order": order, "remittance_leg": "refund"})
        order.failure_reason = (note or "ADAPTER_FAILED")[:200]
        _transition(order, "failed", actor, note, {"refund_sequence": entry.sequence})
        _ledger_event(order, entry, "income", "refund")
    else:
        _transition(order, outcome, actor, note)
    return order_record(order)


def reconcile(actor, data, order):
    if order.status == "RECONCILED":
        return order_record(order)
    _check_version(order, data)
    if _quote_expired(order):
        _transition(order, "expire", actor, "Quote expired before submission")
        return order_record(order)
    require(order.status == "DELIVERED", "INVALID_TRANSITION")
    legs = {e.remittance_leg: e for e in DemoLedgerEntry.objects.filter(remittance_order=order)}
    require("debit" in legs and legs["debit"].amount == -order.send_amount, "LEDGER_DEBIT_MISSING")
    if order.recipient == "SELF":
        require("credit" in legs and legs["credit"].amount == order.receive_amount, "LEDGER_CREDIT_MISSING")
    _transition(order, "reconcile", actor, data.get("note", ""))
    return order_record(order)
