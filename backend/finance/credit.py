"""Simulated on-time record ("credit building"); not a bureau score."""
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from django.core import signing
from django.utils import timezone

from .credit_models import CreditSnapshot
from .lending_models import LoanInstallment
from .workflow_common import audit, owned, record
from .remittance_models import RemittanceOrder
from .workflow_models import DemoWallet, Payment

WINDOW_DAYS = 365
STATEMENT_SALT = "studyflow-credit-statement-v1"
STATEMENT_MAX_AGE = 90 * 24 * 3600
MULTIPLIERS = {"AT_RISK": Decimal("0.5"), "BUILDING": Decimal("1.0"),
               "FAIR": Decimal("1.2"), "GOOD": Decimal("1.5")}
DISCLAIMER = ("Simulated on-time record inside StudyFlow. Not a credit score and not "
              "reported to or obtained from any credit bureau.")
SETTLED_PAYMENTS = ("settled", "reconciled", "reconciliation_exception")


def _installments(owner, as_of, start):
    for row in LoanInstallment.objects.filter(owner=owner).order_by("due_on", "id"):
        if row.paid_on:
            status = "ON_TIME" if row.paid_on <= row.due_on else "LATE"
        elif row.due_on < as_of:
            status = "OVERDUE"
        else:
            continue
        yield {"source": "loan_installment", "id": str(row.id), "due_on": row.due_on,
               "completed_on": row.paid_on, "status": status}


def _payments(owner, as_of, start):
    rows = Payment.objects.filter(owner=owner, status__in=SETTLED_PAYMENTS)
    for row in rows.order_by("due_on", "id"):
        settled = (row.receipt or {}).get("settled_on")
        if not settled:
            continue
        settled = date.fromisoformat(settled)
        yield {"source": "payment", "id": str(row.id), "due_on": row.due_on,
               "completed_on": settled, "status": "ON_TIME" if settled <= row.due_on else "LATE"}


def _remittances(owner, as_of, start):
    # Transfers to oneself cost little and prove nothing, so only verified recipients count.
    rows = RemittanceOrder.objects.filter(owner=owner, status__in=("DELIVERED", "RECONCILED"),
                                          recipient="BENEFICIARY", beneficiary__verified=True,
                                          deadline__isnull=False,
                                          delivered_on__isnull=False)
    for row in rows.order_by("deadline", "id"):
        yield {"source": "remittance_order", "id": str(row.id), "due_on": row.deadline,
               "completed_on": row.delivered_on,
               "status": "ON_TIME" if row.delivered_on <= row.deadline else "LATE"}


# Each source yields evidence dicts for one owner; profile() applies the window.
EVIDENCE_SOURCES = [_installments, _payments, _remittances]


def _in_window(item, start):
    # Unresolved overdue items never age out; completed ones count by completion date.
    if item["status"] == "OVERDUE":
        return True
    return start <= (item["completed_on"] or item["due_on"])


def _overdue_on(owner, today):
    # The student-controlled demo clock may only make obligations overdue sooner.
    wallet = DemoWallet.objects.filter(owner=owner).first()
    return max(wallet.clock, today) if wallet else today


def _level(on_time, late, overdue):
    if overdue or late >= 2:
        return "AT_RISK"
    if on_time >= 6 and late == 0:
        return "GOOD"
    if on_time >= 3 and late <= 1:
        return "FAIR"
    return "BUILDING"


def _next_level(level, on_time, late, overdue):
    if level == "AT_RISK":
        return {"level": "BUILDING",
                "action": "RESOLVE_OVERDUE" if overdue else "WAIT_FOR_LATE_RECORDS_TO_AGE_OUT"}
    if level == "GOOD":
        return None
    if level == "FAIR":
        return {"level": "GOOD", "on_time_needed": max(6 - on_time, 0),
                "late_records_must_age_out": late > 0}
    return {"level": "FAIR", "on_time_needed": max(3 - on_time, 0)}


def profile(owner):
    # The window follows real time so moving the demo clock cannot age records out.
    as_of = timezone.localdate()
    start = as_of - timedelta(days=WINDOW_DAYS)
    overdue_on = _overdue_on(owner, as_of)
    evidence = [item for source in EVIDENCE_SOURCES for item in source(owner, overdue_on, start)
                if _in_window(item, start)]
    counts = {status: sum(1 for item in evidence if item["status"] == status)
              for status in ("ON_TIME", "LATE", "OVERDUE")}
    on_time, late, overdue = counts["ON_TIME"], counts["LATE"], counts["OVERDUE"]
    level = _level(on_time, late, overdue)
    factors = []
    if on_time:
        factors.append({"code": "ON_TIME_RECORDS", "effect": "positive", "count": on_time})
    if late:
        factors.append({"code": "LATE_RECORDS", "effect": "negative", "count": late})
    if overdue:
        factors.append({"code": "OVERDUE_RECORDS", "effect": "negative", "count": overdue})
    if on_time < 3:
        factors.append({"code": "THIN_HISTORY", "effect": "neutral", "count": on_time})
    return {
        "level": level, "on_time": on_time, "late": late, "overdue": overdue,
        "as_of": as_of.isoformat(), "limit_multiplier": str(MULTIPLIERS[level]),
        "factors": factors, "next_level": _next_level(level, on_time, late, overdue),
        "evidence": [{**item, "due_on": item["due_on"].isoformat(),
                      "completed_on": item["completed_on"].isoformat() if item["completed_on"] else None}
                     for item in evidence],
        "is_simulated": True, "disclaimer": DISCLAIMER,
    }


def limit_multiplier(owner):
    """Factor applied to T2 outflow limits for this owner's credit level."""
    return MULTIPLIERS[profile(owner)["level"]]


def create_snapshot(actor, data, obj=None):
    result = profile(actor)
    snapshot = CreditSnapshot.objects.create(
        owner=actor, level=result["level"], on_time=result["on_time"], late=result["late"],
        overdue=result["overdue"], factors=result["factors"], evidence=result["evidence"],
        as_of=result["as_of"])
    audit(actor, actor, "credit.snapshot_created", snapshot, {"level": snapshot.level})
    return {**record(snapshot), "limit_multiplier": result["limit_multiplier"],
            "next_level": result["next_level"], "disclaimer": DISCLAIMER}


def _statement_body(snapshot):
    return {"snapshot_id": str(snapshot.id), "holder": snapshot.owner.get_username(),
            "level": snapshot.level, "on_time": snapshot.on_time, "late": snapshot.late,
            "overdue": snapshot.overdue, "as_of": snapshot.as_of.isoformat()}


def issue_statement(actor, data, obj=None):
    snapshot = owned(CreditSnapshot, actor, data["snapshot_id"])
    body = {**_statement_body(snapshot), "issued_at": timezone.now().isoformat()}
    statement = signing.dumps(body, salt=STATEMENT_SALT)
    audit(actor, actor, "credit.statement_issued", snapshot, {"level": snapshot.level})
    return {"statement": statement, "expires_in_days": STATEMENT_MAX_AGE // 86400,
            "snapshot_id": str(snapshot.id), "level": snapshot.level, "is_simulated": True}


def verify_statement(statement):
    if not statement or len(statement) > 4000:
        return {"valid": False, "reason": "INVALID_SIGNATURE"}
    try:
        body = signing.loads(statement, salt=STATEMENT_SALT, max_age=STATEMENT_MAX_AGE)
    except signing.SignatureExpired:
        return {"valid": False, "reason": "EXPIRED"}
    except signing.BadSignature:
        return {"valid": False, "reason": "INVALID_SIGNATURE"}
    keys = {"snapshot_id", "holder", "level", "on_time", "late", "overdue", "as_of", "issued_at"}
    if not isinstance(body, dict) or set(body) != keys:
        return {"valid": False, "reason": "INVALID_SIGNATURE"}
    try:
        snapshot_id = UUID(str(body["snapshot_id"]))
    except ValueError:
        return {"valid": False, "reason": "INVALID_SIGNATURE"}
    snapshot = CreditSnapshot.objects.filter(pk=snapshot_id).select_related("owner").first()
    expected = _statement_body(snapshot) if snapshot else None
    if expected is None or any(body.get(key) != value for key, value in expected.items()):
        return {"valid": False, "reason": "SNAPSHOT_MISMATCH"}
    return {"valid": True, **body, "is_simulated": True, "disclaimer": DISCLAIMER}

