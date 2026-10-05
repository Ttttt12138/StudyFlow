import hashlib
import json
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from finance.models import FinancialState

from .models import NotificationOutbox, ReadinessJob, RiskCard, Semester


def enqueue(owner, kind, key, payload=None):
    return ReadinessJob.objects.get_or_create(
        key=key,
        defaults={
            "owner": owner,
            "kind": kind,
            "payload": payload or {},
            "available_at": timezone.now(),
        },
    )[0]


def enqueue_check(owner, trigger):
    if not settings.STUDYFLOW_READINESS_ENABLED:
        return None
    semester = Semester.objects.filter(owner=owner, enabled=True).first()
    state = FinancialState.objects.filter(owner=owner).first()
    if not semester or not state:
        return None
    from .services import business_date

    key = f"check:{owner.pk}:{state.version}:{semester.version}:{business_date(owner)}"
    return enqueue(
        owner,
        "check",
        key,
        {
            "trigger": trigger,
            "semester_id": str(semester.id),
            "state_version": state.version,
            "budget_version": semester.version,
        },
    )


def schedule_daily(now=None):
    now = timezone.localtime(now or timezone.now())
    if now.hour < 8 or not settings.STUDYFLOW_READINESS_ENABLED:
        return
    for semester in (
        Semester.objects.filter(enabled=True).select_related("owner").iterator()
    ):
        enqueue_check(semester.owner, "daily")


@transaction.atomic
def claim_job(owner=None):
    now = timezone.now()
    eligible = Q(status__in=["QUEUED", "RETRY"], available_at__lte=now) | Q(
        status="RUNNING", lease_until__lte=now
    )
    query = ReadinessJob.objects.select_for_update(skip_locked=True).filter(eligible)
    if owner is not None:
        query = query.filter(owner=owner)
    job = query.order_by("available_at").first()
    if job is None:
        return None
    job.status, job.lease_token = "RUNNING", uuid.uuid4()
    job.lease_until, job.attempts = now + timedelta(minutes=5), job.attempts + 1
    job.save(update_fields=["status", "lease_token", "lease_until", "attempts"])
    return job


def finish_job(job, result=None, error=None):
    fields = {
        "status": "RETRY" if error else "DONE",
        "error_code": error or "",
        "lease_until": None,
        "lease_token": None,
        "result": result or {},
    }
    if error:
        fields["available_at"] = timezone.now() + timedelta(
            seconds=min(3600, 30 * 2 ** min(job.attempts, 7))
        )
    return ReadinessJob.objects.filter(pk=job.pk, lease_token=job.lease_token).update(
        **fields
    )


def update_risks(owner, semester, budget, prediction):
    risks = {
        "semester_gap": {"amount": budget["gap"], "incomplete": not budget["complete"]}
        if Decimal(budget["gap"]) > 0
        else None,
        "liquidity": {
            "amount": prediction["maximum_reserve_gap"],
            "date": prediction["first_gap_date"],
        }
        if Decimal(prediction["maximum_reserve_gap"]) > 0
        else None,
        "missing_information": {"issues": budget["issues"]}
        if budget["issues"]
        else None,
    }
    for kind, details in risks.items():
        card = RiskCard.objects.filter(semester=semester, kind=kind).first()
        if details is None and card is None:
            continue
        if (
            details is None
            and card.active
            and kind != "missing_information"
            and not budget["complete"]
        ):
            continue  # Missing costs cannot establish that an existing monetary risk has cleared.
        fingerprint = hashlib.sha256(
            json.dumps(details, sort_keys=True).encode()
        ).hexdigest()
        if card and card.fingerprint == fingerprint:
            continue
        transition = (
            "created" if card is None else "resolved" if details is None else "changed"
        )
        if card is None:
            card = RiskCard(owner=owner, semester=semester, kind=kind)
        card.details, card.active, card.fingerprint = (
            details or {},
            details is not None,
            fingerprint,
        )
        card.save()
        NotificationOutbox.objects.create(
            owner=owner,
            risk=card,
            transition=transition,
            payload={"kind": kind, "details": details},
        )


def run_one(owner=None):
    job = claim_job(owner)
    if job is None:
        return False
    try:
        if job.kind == "import":
            from .imports import process_material

            result = process_material(job)
        else:
            from .adapter import run_check

            result = run_check(job)
        finish_job(
            job,
            result,
            "CHECK_RETRY_REQUIRED" if result.get("retry_required") else None,
        )
    except Exception as exc:  # noqa: BLE001 -- Worker isolation boundary; persist retry state for every failure.
        # Never persist provider exceptions: they may contain credentials or document text.
        finish_job(job, error=type(exc).__name__[:100])
    return True
