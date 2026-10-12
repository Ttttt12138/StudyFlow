"""Tools the finance agent may call (docs/agent.md). T2 tools only propose."""
from decimal import Decimal

from rest_framework import serializers as s

from . import credit, fx_rates, money, remittance_orders
from .execution_services import available
from .remittance_api import OrderInput
from .remittance_models import RemittanceOrder
from .wallets import balances, executable_sources, quote_result, wallet
from .workflow_common import owned, record, require, shift_date
from .workflow_models import Beneficiary, Corridor, FXQuote
from .workflow_serializers import CurrencyAmountField, Input, LiveQuoteInput

class RateInput(Input):
    base = s.CharField(max_length=3)
    quote = s.CharField(max_length=3)


class CorridorFilter(Input):
    source_currency = s.CharField(max_length=3, required=False)
    target_currency = s.CharField(max_length=3, required=False)


class RankInput(Input):
    quote_ids = s.ListField(child=s.UUIDField(), min_length=2, max_length=6)
    deadline = s.DateField(required=False, allow_null=True)


class OrderRef(Input):
    order_id = s.UUIDField()


class ConvertInput(Input):
    quote_id = s.UUIDField()
    source_amount = CurrencyAmountField()


class Empty(Input):
    pass


def _balances(user, data):
    item = wallet(user)
    return balances(item, available(item))


def _rate(user, data):
    return fx_rates.get_rate(data["base"].upper(), data["quote"].upper())


def _corridors(user, data):
    rows = Corridor.objects.filter(enabled=True)
    for name in ("source_currency", "target_currency"):
        if data.get(name):
            rows = rows.filter(**{name: data[name].upper()})
    return {"corridors": [record(row) for row in rows]}


def _beneficiaries(user, data):
    rows = Beneficiary.objects.filter(owner=user).order_by("created_at")
    return {"beneficiaries": [{"id": str(b.id), "name": b.name, "verified": b.verified,
                               "destination_label": b.destination_label} for b in rows]}


def _credit(user, data):
    return {k: v for k, v in credit.profile(user).items() if k != "evidence"}


def _orders(user, data):
    rows = RemittanceOrder.objects.filter(owner=user).order_by("-created_at")[:10]
    return {"orders": [{"id": str(o.id), "status": o.status, "send_amount": money.fmt(o.send_amount, o.send_currency),
                        "send_currency": o.send_currency, "receive_currency": o.receive_currency,
                        "receive_amount": money.fmt(o.receive_amount, o.receive_currency),
                        "created_at": o.created_at.isoformat()} for o in rows]}


def _rank(user, data):
    item = wallet(user)
    rows = []
    for quote_id in data["quote_ids"]:
        quote = owned(FXQuote, user, quote_id)
        require(quote.rate_source in executable_sources() and quote.quoted_amount is not None, "QUOTE_NOT_EXECUTABLE")
        net = quote_result(quote, quote.quoted_amount, quote.source_currency, quote.target_currency)
        arrival = shift_date(item.clock, quote.settlement_days)
        rows.append({"quote_id": str(quote.id), "route_name": quote.route_name,
                     "target_currency": quote.target_currency, "net_received": money.fmt(net, quote.target_currency),
                     "sender_fee": money.fmt(quote.sender_fee, quote.source_currency),
                     "arrival_latest": arrival.isoformat(),
                     "on_time": data.get("deadline") is None or arrival <= data["deadline"],
                     "expires_at": quote.expires_at.isoformat()})
    require(len({r["target_currency"] for r in rows}) == 1, "QUOTE_CURRENCY_MISMATCH")
    rows.sort(key=lambda r: (not r["on_time"], -Decimal(r["net_received"]), r["arrival_latest"], r["quote_id"]))
    return {"ranked": rows, "recommended_quote_id": rows[0]["quote_id"] if rows[0]["on_time"] else None}


def _live_quote(user, data):
    return fx_rates.create_live_quote(user, data)


def _create_order(user, data):
    return remittance_orders.create_order(user, data)


class Proposal:
    """Validated T2 intent; the runner records it as a pending action, never executes it."""
    def __init__(self, action, target_id, amount, currency, arguments):
        self.action, self.target_id, self.arguments = action, target_id, arguments
        self.amount, self.currency = amount, currency


def _submit_order(user, data):
    order = owned(RemittanceOrder, user, data["order_id"])
    require(order.status == "CREATED", "INVALID_TRANSITION")
    recipient = {"recipient": order.recipient, "receive_currency": order.receive_currency,
                 "receive_amount": money.fmt(order.receive_amount, order.receive_currency)}
    if order.beneficiary_id:
        recipient["beneficiary"] = {"id": str(order.beneficiary_id), "name": order.beneficiary.name,
                                    "destination_label": order.beneficiary.destination_label}
    return Proposal("remittance.submit", order.id, order.send_amount, order.send_currency,
                    {"order_id": str(order.id), **recipient})


def _convert(user, data):
    quote = owned(FXQuote, user, data["quote_id"])
    require(quote.rate_source in executable_sources() and quote.consumed_at is None, "QUOTE_NOT_EXECUTABLE")
    amount = money.require_precision(data["source_amount"], quote.source_currency)
    return Proposal("wallet.convert", quote.id, amount, quote.source_currency,
                    {"quote_id": str(quote.id), "source_amount": money.fmt(amount, quote.source_currency)})


# Live models filled names into id fields and invented purposes when the schema only said
# "string"; formats, enums and hints tell them where each value must come from.
HINTS = {
    "corridor_id": "id of a corridor from list_corridors",
    "quote_id": "id of a live quote from create_live_quote",
    "quote_ids": "ids of live quotes from create_live_quote",
    "beneficiary_id": "id of a verified beneficiary from list_beneficiaries (not its name)",
    "order_id": "id of a CREATED order from create_remittance_order",
    "send_amount": "decimal string in the corridor's source currency, e.g. \"5000.00\"",
    "source_amount": "decimal string equal to the quote's send_amount",
    "recipient": "SELF credits the student's own wallet in the target currency; BENEFICIARY pays a "
                 "verified third party",
    # agent-v1 live round 3: three sends stopped only to ask for the purpose. The student
    # still sees and confirms it on the proposal, so a stated default is safe.
    "purpose": "tuition for school fees, living for rent or daily costs, family_support for family; "
               "use other when the goal states no purpose (do not stop to ask)",
}


def _field_schema(name, field):
    kind = type(field).__name__
    schema = {"type": {"ListField": "array", "IntegerField": "integer"}.get(kind, "string")}
    if kind == "UUIDField":
        schema["format"] = "uuid"
    elif kind == "DateField":
        schema["format"] = "date"
    elif kind == "ChoiceField":
        schema["enum"] = list(field.choices)
    elif kind == "ListField" and type(field.child).__name__ == "UUIDField":
        schema["items"] = {"type": "string", "format": "uuid"}
    if name in HINTS:
        schema["description"] = HINTS[name]
    return schema


def _schema(serializer):
    properties, required = {}, []
    for name, field in serializer().fields.items():
        properties[name] = _field_schema(name, field)
        if field.required:
            required.append(name)
    return {"type": "object", "properties": properties, "required": required}


class Tool:
    def __init__(self, name, tier, description, serializer, handler):
        self.name, self.tier, self.description = name, tier, description
        self.serializer, self.handler = serializer, handler

    def spec(self):
        return {"name": self.name, "tier": self.tier, "description": self.description,
                "parameters": _schema(self.serializer)}


TOOLS = {tool.name: tool for tool in [
    Tool("get_balances", "T0", "Wallet balances per currency with indicative home value.", Empty, _balances),
    Tool("get_fx_rate", "T0", "Reference FX rate (central-bank blend via Frankfurter, or fixture) with date and source.",
         RateInput, _rate),
    Tool("list_corridors", "T0", "Enabled remittance corridors with limits, fees and settlement days.",
         CorridorFilter, _corridors),
    Tool("list_beneficiaries", "T0", "The student's recipients and whether each is verified.", Empty, _beneficiaries),
    Tool("get_credit_profile", "T0", "Simulated on-time record level and factors.", Empty, _credit),
    Tool("list_remittance_orders", "T0", "Latest 10 remittance orders.", Empty, _orders),
    Tool("rank_quotes", "T0", "Rank 2-6 live quotes by on-time arrival, amount received and speed.",
         RankInput, _rank),
    Tool("create_live_quote", "T1", "Price a corridor for a send amount (10-minute quote).",
         LiveQuoteInput, _live_quote),
    Tool("create_remittance_order", "T1", "Create a remittance order in CREATED status from a live quote. "
         "Use recipient SELF when the student moves money into their own wallet or names no other "
         "recipient; use BENEFICIARY only with a verified beneficiary_id. Nothing is sent until the "
         "student confirms submit_remittance_order.",
         OrderInput, _create_order),
    Tool("submit_remittance_order", "T2", "Propose submitting an order; the student must confirm.",
         OrderRef, _submit_order),
    Tool("convert_balance", "T2", "Propose a conversion between own balances; the student must confirm.",
         ConvertInput, _convert),
]}
