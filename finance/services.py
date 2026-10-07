import json
from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework.exceptions import APIException
from django.core.serializers.json import DjangoJSONEncoder
from .models import FinancialState, AuditEvent

class VersionConflict(APIException):
    status_code = 409
    default_detail = "State version changed. Refresh and retry."
    default_code = "stale_version"

# Event id prefixes written only by ledger postings.
LEDGER_PREFIXES = ("loan:", "repayment:", "received:", "conversion:", "remittance:")

def json_value(value):
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))

@transaction.atomic
def save_state(owner, expected_version, snapshot):
    # Lock stable parent: also serializes concurrent first-version creation.
    get_user_model().objects.select_for_update().get(pk=owner.pk)
    current = FinancialState.objects.filter(owner=owner).first()
    if expected_version != (current.version if current else 0):
        raise VersionConflict()
    from .workflow_models import DemoWallet, Payment
    from .workflow_common import require
    candidate = json_value(snapshot)
    item = DemoWallet.objects.filter(owner=owner).first()
    if item:
        for key in ["opening_balance", "as_of", "currency"]:
            require(candidate[key] == item.initial_state.snapshot[key],
                    "Demo opening snapshot is fixed; balances change only through the ledger.")
    previous_events = {event["id"]:event for event in current.snapshot["events"]} if current else {}
    next_events = {event["id"]:event for event in candidate["events"]}
    protected = set(Payment.objects.filter(owner=owner,status__in=[
        "pending","unknown","settled","reconciled","reconciliation_exception"]).values_list("event_id",flat=True))
    protected |= {key for key in previous_events if key.startswith(LEDGER_PREFIXES)}
    def comparable(event):
        if event is None: return None
        return {key:value for key,value in event.items()
            if not (key in {"source_id","beneficiary_id","evidence_note"} and value in (None,""))}
    for key in protected:
        require(comparable(next_events.get(key)) == comparable(previous_events.get(key)),
                "Executed or submitted events cannot be rewritten.")
    for key, event in next_events.items():
        require(event.get("settled_sequence") == previous_events.get(key, {}).get("settled_sequence"),
                "Settlement sequence is controlled by the ledger.")
    for key in next_events:
        if key.startswith(LEDGER_PREFIXES):
            require(key in previous_events, "Ledger event prefixes are reserved.")
    state = FinancialState.objects.create(
        owner=owner, version=expected_version + 1, snapshot=json_value(snapshot),
    )
    AuditEvent.objects.create(
        owner=owner, action="state.confirmed", entity_id=state.id,
        details={"version": state.version},
    )
    return state
