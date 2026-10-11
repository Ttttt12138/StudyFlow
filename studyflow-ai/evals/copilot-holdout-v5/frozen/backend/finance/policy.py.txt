"""Tiered permissions for money-moving commands (docs/permissions.md).

T2 routes declare an action from ACTIONS. CommandView calls enforce() inside its
transaction and user lock, after the idempotency lookup; the returned Clearance is
consumed in the same transaction once the handler succeeds.
"""
import secrets
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Callable
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core import signing
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from rest_framework.exceptions import APIException

from . import money
from .credit import limit_multiplier
from .lending_models import LoanAccount
from .models import AuditEvent
from .policy_models import ApprovalRequest, PolicyLimit, StepUpGrant
from .remittance_models import RemittanceOrder
from .agent_models import AgentPendingAction
from .services import VersionConflict
from .workflow_common import require
from .workflow_models import DemoLedgerEntry, FXQuote, Payment

STEP_UP_SALT = "studyflow-step-up-v1"
STEP_UP_SECONDS = 300
STEP_UP_HEADER = "X-Step-Up-Token"
# Calls made on behalf of an agent are capped at T1 (W4 sets this header).
AGENT_HEADER = "X-StudyFlow-Agent"
APPROVAL_LIFETIME = timedelta(hours=24)
LIMIT_ZONE = ZoneInfo("Asia/Bangkok")
CENT = Decimal("0.01")
# A payment in one of these states has already left the wallet's control; resubmitting is a no-op.
SUBMITTED = {"pending", "unknown", "settled", "reconciled", "reconciliation_exception"}
NOT_OUTFLOW = ["failed", "cancelled"]


class PolicyDenied(APIException):
    status_code = 403
    default_code = "policy_denied"

    def __init__(self, code, policy=None):
        # Keep plain strings so the body matches docs/permissions.md §5 exactly.
        self.detail = {"detail": code, **({"policy": policy} if policy is not None else {})}


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"

    def __init__(self, code):
        self.detail = {"detail": code}


@dataclass(frozen=True)
class Subject:
    action: str
    target_id: str
    amount: Decimal
    currency: str


@dataclass(frozen=True)
class Action:
    model: type | None
    resolve: Callable | None   # (actor, data, obj) -> Subject | None (None: nothing leaves the wallet)
    check: Callable | None     # (actor, target_id, amount, currency) -> None; raises on mismatch


def _payment_subject(actor, data, obj):
    if obj.status in SUBMITTED:
        return None
    return Subject("payment.submit", str(obj.pk), obj.amount, money.home_currency())


def _payment_check(actor, target_id, amount, currency):
    payment = get_object_or_404(Payment, owner=actor, pk=target_id)
    require(currency == money.home_currency() and amount == payment.amount, "POLICY_SUBJECT_MISMATCH")


def _conversion_subject(actor, data, obj):
    quote = FXQuote.objects.filter(owner=actor, pk=data["quote_id"]).first()
    if quote is None:
        return None  # the handler answers 404
    amount = money.require_precision(data["source_amount"], quote.source_currency)
    require(amount > 0, "Amount must be positive.")
    return Subject("wallet.convert", str(quote.pk), amount, quote.source_currency)


def _conversion_check(actor, target_id, amount, currency):
    quote = get_object_or_404(FXQuote, owner=actor, pk=target_id)
    require(currency == quote.source_currency, "POLICY_SUBJECT_MISMATCH")


def _repayment_subject(actor, data, obj):
    row = obj.installments.filter(number=data["installment_number"], paid_on__isnull=True).first()
    if row is None:
        return None  # the handler answers INSTALLMENT_NOT_PAYABLE
    return Subject("loan.repay", str(obj.pk), row.amount, money.home_currency())


def _repayment_check(actor, target_id, amount, currency):
    account = get_object_or_404(LoanAccount, owner=actor, pk=target_id)
    require(currency == money.home_currency()
            and account.installments.filter(paid_on__isnull=True, amount=amount).exists(),
            "POLICY_SUBJECT_MISMATCH")


# Every T2 action must be registered here and declared on its route (CommandView.policy).
def _remittance_subject(actor, data, obj):
    if obj.status != "CREATED" or obj.quote.expires_at <= timezone.now():
        return None  # replay, invalid transition or expiry: nothing is debited
    return Subject("remittance.submit", str(obj.pk), obj.send_amount, obj.send_currency)


def _remittance_check(actor, target_id, amount, currency):
    order = get_object_or_404(RemittanceOrder, owner=actor, pk=target_id)
    require(currency == order.send_currency and amount == order.send_amount, "POLICY_SUBJECT_MISMATCH")


def _pending_subject(actor, data, obj):
    """An agent proposal is cleared exactly like the action it proposes."""
    if obj.status != "PENDING" or obj.expires_at <= timezone.now():
        return None  # the handler answers (expired, already decided)
    if obj.action == "remittance.submit":
        order = RemittanceOrder.objects.filter(owner=actor, pk=obj.target_id).first()
        return _remittance_subject(actor, data, order) if order else None
    if obj.action == "wallet.convert":
        return _conversion_subject(actor, {"quote_id": obj.target_id, "source_amount": obj.amount}, None)
    return None


ACTIONS = {
    "payment.submit": Action(Payment, _payment_subject, _payment_check),
    "wallet.convert": Action(None, _conversion_subject, _conversion_check),
    "loan.repay": Action(LoanAccount, _repayment_subject, _repayment_check),
    "remittance.submit": Action(RemittanceOrder, _remittance_subject, _remittance_check),
    # Confirming an agent proposal; step-up is requested for the underlying action.
    "agent.confirm": Action(AgentPendingAction, _pending_subject, None),
}


def subject_for(action, actor, data, pk=None):
    """Resolve the subject of a T2 call from its route target and body."""
    spec = ACTIONS[action]
    obj = None
    if spec.model is not None:
        obj = spec.model.objects.filter(owner=actor, pk=pk).first()
        if obj is None:
            return None
    return spec.resolve(actor, data, obj)


def requested_subject(actor, action, target_id, amount, currency):
    """Validate a step-up or approval request against the student's own target."""
    spec = ACTIONS.get(action)
    require(spec is not None and spec.check is not None, "ACTION_NOT_AVAILABLE")
    money.require_supported(currency)
    amount = money.require_precision(amount, currency)
    require(amount > 0, "Amount must be positive.")
    spec.check(actor, target_id, amount, currency)
    return Subject(action, str(target_id), amount, currency)


# -- limits and usage --------------------------------------------------------------

def limits_for(owner, currency):
    row = PolicyLimit.objects.filter(action="outflow", currency=currency, enabled=True).first()
    if row is None:
        return None
    factor = Decimal(limit_multiplier(owner))
    return {k: getattr(row, k) * factor for k in ("per_transaction", "daily", "monthly")}


def limits_summary(owner):
    """Effective outflow limits and usage per currency, for the student's own limits view."""
    from .credit import profile

    credit = profile(owner)
    factor = Decimal(credit["limit_multiplier"])

    def text(value):
        return format(Decimal(value).quantize(CENT), "f")
    rows = []
    for row in PolicyLimit.objects.filter(action="outflow", enabled=True).order_by("currency"):
        base = {k: getattr(row, k) for k in ("per_transaction", "daily", "monthly")}
        rows.append({"currency": row.currency, "base": {k: text(v) for k, v in base.items()},
                     "effective": {k: text(v * factor) for k, v in base.items()},
                     "usage": {k: text(v) for k, v in usage(owner, row.currency).items()}})
    return {"credit_level": credit["level"], "limit_multiplier": credit["limit_multiplier"],
            "window_zone": str(LIMIT_ZONE), "limits": rows, "is_simulated": True}


def window_starts(now=None):
    local = timezone.localtime(now or timezone.now(), LIMIT_ZONE)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return day, day.replace(day=1)


def spent(owner, currency, since):
    """Outflow since `since`: submitted payments plus non-payment debits (conversion, repayment, remittance)."""
    debits = DemoLedgerEntry.objects.filter(
        owner=owner, currency=currency, amount__lt=0, payment__isnull=True, created_at__gte=since,
    ).aggregate(total=Sum("amount"))["total"] or Decimal(0)
    total = -debits
    if currency == money.home_currency():
        total += Payment.objects.filter(owner=owner, submitted_at__gte=since).exclude(
            status__in=NOT_OUTFLOW).aggregate(total=Sum("amount"))["total"] or Decimal(0)
    return total


def usage(owner, currency, now=None):
    day, month = window_starts(now)
    return {"daily": spent(owner, currency, day), "monthly": spent(owner, currency, month)}


@dataclass(frozen=True)
class Assessment:
    subject: Subject
    tier: str
    limits: dict | None
    usage: dict

    def describe(self):
        def text(value):
            return format(Decimal(value).quantize(CENT), "f")
        return {
            "action": self.subject.action, "tier": self.tier, "target_id": self.subject.target_id,
            "amount": text(self.subject.amount), "currency": self.subject.currency,
            "limits": None if self.limits is None else {k: text(v) for k, v in self.limits.items()},
            "usage": {k: text(v) for k, v in self.usage.items()},
            "requires": ["step_up", "approval"] if self.tier == "T3" else ["step_up"],
        }


def assess(owner, subject):
    limits = limits_for(owner, subject.currency)
    used = usage(owner, subject.currency)
    amount = subject.amount
    within = limits is not None and amount <= limits["per_transaction"] and (
        used["daily"] + amount <= limits["daily"]) and used["monthly"] + amount <= limits["monthly"]
    return Assessment(subject, "T2" if within else "T3", limits, used)


# -- enforcement ---------------------------------------------------------------------

@dataclass
class Clearance:
    grant: StepUpGrant
    approval: ApprovalRequest | None

    def consume(self):
        now = timezone.now()
        self.grant.used_at = now
        self.grant.save(update_fields=["used_at"])
        if self.approval is not None:
            self.approval.status = "USED"
            self.approval.used_at = now
            self.approval.version += 1
            self.approval.save(update_fields=["status", "used_at", "version"])


def is_agent(request):
    return bool(request.headers.get(AGENT_HEADER))


def enforce(request, action, actor, data, obj):
    """Return a Clearance for a T2/T3 call, None when nothing would leave the wallet, or raise PolicyDenied."""
    subject = ACTIONS[action].resolve(actor, data, obj)
    if subject is None:
        return None
    assessment = assess(actor, subject)
    if is_agent(request):
        raise PolicyDenied("AGENT_TIER_EXCEEDED", assessment.describe())
    token = request.headers.get(STEP_UP_HEADER, "")
    grant = None
    if token:
        grant = redeemable_grant(actor, token, subject)
        if grant is None:
            raise PolicyDenied("STEP_UP_INVALID", assessment.describe())
    approval = None
    if assessment.tier == "T3":
        # Checked before the step-up so the student gets approval before a 5-minute token.
        approval = approved(actor, subject)
        if approval is None:
            raise PolicyDenied("APPROVAL_REQUIRED", assessment.describe())
    if grant is None:
        raise PolicyDenied("STEP_UP_REQUIRED", assessment.describe())
    return Clearance(grant, approval)


def session_hash(user):
    # Read from the database so a password change elsewhere invalidates outstanding tokens.
    return get_user_model().objects.get(pk=user.pk).get_session_auth_hash()


def redeemable_grant(actor, token, subject):
    try:
        payload = signing.loads(token, salt=STEP_UP_SALT, max_age=STEP_UP_SECONDS)
    except signing.BadSignature:
        return None
    if not isinstance(payload, dict) or payload.get("u") != actor.pk:
        return None
    if not constant_time_compare(str(payload.get("h", "")), session_hash(actor)):
        return None
    grant = StepUpGrant.objects.select_for_update().filter(
        owner=actor, nonce=str(payload.get("n", ""))).first()
    if grant is None or grant.used_at is not None or grant.expires_at <= timezone.now():
        return None
    if (grant.action, str(grant.target_id), grant.amount, grant.currency) != (
            subject.action, subject.target_id, subject.amount, subject.currency):
        return None
    return grant


def approved(actor, subject):
    return ApprovalRequest.objects.select_for_update().filter(
        owner=actor, action=subject.action, target_id=subject.target_id, amount=subject.amount,
        currency=subject.currency, status="APPROVED", expires_at__gt=timezone.now(),
    ).first()


# -- step-up -------------------------------------------------------------------------

def audit(owner, actor, action, entity_id, details=None):
    AuditEvent.objects.create(owner=owner, action=action, entity_id=entity_id,
                              details={"actor_id": actor.pk, **(details or {})})


def step_up(user, data):
    """Re-authenticate with the password and issue a single-use token bound to one subject."""
    password = data["password"]
    if not (user.has_usable_password() and user.check_password(password)):
        audit(user, user, "auth.step_up_failed", data["target_id"], {"action": data["action"]})
        raise PolicyDenied("STEP_UP_FAILED")
    with transaction.atomic():
        subject = requested_subject(user, data["action"], data["target_id"], data["amount"],
                                    data["currency"])
        expires = timezone.now() + timedelta(seconds=STEP_UP_SECONDS)
        grant = StepUpGrant.objects.create(
            owner=user, nonce=secrets.token_urlsafe(32), action=subject.action,
            target_id=subject.target_id, amount=subject.amount, currency=subject.currency,
            expires_at=expires)
        # check_password may have upgraded the hash, so the session hash is read afterwards.
        token = signing.dumps({"n": grant.nonce, "u": user.pk, "h": session_hash(user)},
                              salt=STEP_UP_SALT)
        audit(user, user, "auth.step_up_granted", grant.id, {
            "action": subject.action, "target_id": subject.target_id,
            "amount": format(subject.amount.quantize(CENT), "f"), "currency": subject.currency})
    return {"token": token, "expires_in_seconds": STEP_UP_SECONDS, "action": subject.action,
            "target_id": subject.target_id, "amount": format(subject.amount.quantize(CENT), "f"),
            "currency": subject.currency}


# -- approvals -------------------------------------------------------------------------

def expire_stale(queryset=None):
    queryset = ApprovalRequest.objects.all() if queryset is None else queryset
    queryset.filter(status__in=["PENDING", "APPROVED"], expires_at__lte=timezone.now()).update(
        status="EXPIRED")


def request_approval(actor, data):
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=actor.pk)
        subject = requested_subject(actor, data["action"], data["target_id"], data["amount"],
                                    data["currency"])
        expire_stale(ApprovalRequest.objects.filter(owner=actor))
        open_ = ApprovalRequest.objects.filter(owner=actor, action=subject.action,
                                               target_id=subject.target_id,
                                               status__in=["PENDING", "APPROVED"])
        if open_.exists():
            raise Conflict("APPROVAL_ALREADY_OPEN")
        try:
            with transaction.atomic():
                approval = ApprovalRequest.objects.create(
                    owner=actor, requested_by=actor, action=subject.action,
                    target_id=subject.target_id, amount=subject.amount, currency=subject.currency,
                    reason=data["reason"], expires_at=timezone.now() + APPROVAL_LIFETIME)
        except IntegrityError:
            raise Conflict("APPROVAL_ALREADY_OPEN") from None
        audit(actor, actor, "approval.requested", approval.id, {
            "action": subject.action, "target_id": subject.target_id,
            "amount": format(subject.amount.quantize(CENT), "f"), "currency": subject.currency})
    return approval


def latest_verifier(beneficiary_id):
    event = AuditEvent.objects.filter(action="beneficiary.mock_verification",
                                      entity_id=beneficiary_id).order_by("-created_at").first()
    return event.details.get("actor_id") if event else None


def separation_of_duties(staff, approval):
    if staff.pk in (approval.requested_by_id, approval.owner_id):
        return False
    if approval.action == "payment.submit":
        payment = Payment.objects.filter(pk=approval.target_id).first()
        if payment is not None and latest_verifier(payment.beneficiary_id) == staff.pk:
            return False
    if approval.action == "remittance.submit":
        order = RemittanceOrder.objects.filter(pk=approval.target_id).first()
        if order is not None and order.beneficiary_id and latest_verifier(order.beneficiary_id) == staff.pk:
            return False
    return True


def decide(staff, pk, data):
    # Outside the decision transaction so the expiry persists even when the decision is refused.
    expire_stale(ApprovalRequest.objects.filter(pk=pk))
    with transaction.atomic():
        approval = get_object_or_404(ApprovalRequest.objects.select_for_update(), pk=pk)
        if not separation_of_duties(staff, approval):
            raise PolicyDenied("SEPARATION_OF_DUTIES")
        if approval.version != data["expected_version"]:
            raise VersionConflict()
        if approval.status != "PENDING":
            raise Conflict("APPROVAL_NOT_PENDING")
        approval.status = "APPROVED" if data["decision"] == "approve" else "REJECTED"
        approval.decided_by = staff
        approval.decided_at = timezone.now()
        approval.decision_note = data.get("note", "")
        approval.version += 1
        approval.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "version"])
        audit(approval.owner, staff, "approval." + approval.status.lower(), approval.id,
              {"action": approval.action, "target_id": str(approval.target_id)})
    return approval
