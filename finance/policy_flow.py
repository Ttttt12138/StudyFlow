"""Scripted callers (tests, demo commands) run the documented step-up/approval flow.

Nothing here bypasses the policy: the helper calls POST approvals/, approvals/{id}/decide/
and auth/step-up/ through the API, like a client would, and returns the token to send.
"""
import secrets
from contextlib import contextmanager
from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import Resolver404, resolve
from django.utils import timezone
from rest_framework.exceptions import APIException

from . import policy
from .policy_models import ApprovalRequest

API_PREFIX = "/api/v2/"


def scripted_user(username, *, staff=False):
    """Create a synthetic identity with a random password (needed for step-up)."""
    password = secrets.token_urlsafe(18)
    user = get_user_model().objects.create_user(username=username, password=password, is_staff=staff)
    return user, password


def route_action(route):
    """The T2 action declared on a route, and its target pk; (None, None) for other routes."""
    try:
        match = resolve(API_PREFIX + route.strip("/") + "/")
    except Resolver404:
        return None, None
    view = getattr(match.func, "view_class", None)
    return getattr(view, "policy", None), match.kwargs.get("pk")


def subject(owner, route, body):
    action, pk = route_action(route)
    if not action:
        return None
    try:
        return policy.subject_for(action, owner, body or {}, pk)
    except (APIException, KeyError, TypeError, ValueError, ArithmeticError):
        return None  # invalid request: let the API answer it


class PolicyFlow:
    """`send(route, body)` posts as the owner and returns response data or None;
    `approve(approval)` decides as a staff member who is not the beneficiary verifier."""

    def __init__(self, owner, password, send, approve=None, reason="Scripted synthetic run"):
        self.owner, self.password, self.send, self.approve, self.reason = (
            owner, password, send, approve, reason)
        self.log = []

    def token(self, route, body):
        """Step-up token for a T2 call (after obtaining an approval for T3), or None."""
        target = subject(self.owner, route, body)
        if target is None:
            return None
        amount = format(target.amount.quantize(Decimal("0.01")), "f")
        fields = {"action": target.action, "target_id": target.target_id, "amount": amount,
                  "currency": target.currency}
        tier = policy.assess(self.owner, target).tier
        if tier == "T3" and self.approve is not None:
            self._approval(target, fields)
        granted = self.send("auth/step-up", {"password": self.password, **fields})
        self.log.append({**fields, "tier": tier, "step_up": bool(granted)})
        return granted["token"] if granted else None

    def _approval(self, target, fields):
        current = ApprovalRequest.objects.filter(
            owner=self.owner, action=target.action, target_id=target.target_id,
            status__in=["PENDING", "APPROVED"], expires_at__gt=timezone.now()).first()
        if current is not None and current.status == "APPROVED" and (
                current.amount, current.currency) == (target.amount, target.currency):
            return
        if current is None:
            created = self.send("approvals", {**fields, "reason": self.reason})
            if not created:
                return
            current = ApprovalRequest.objects.get(pk=created["id"])
        if current.status == "PENDING":
            self.approve({"id": str(current.pk), "version": current.version})


def approver(send_as_staff, note="Synthetic run reviewed by a second operator"):
    def approve(approval):
        return send_as_staff("approvals/" + approval["id"] + "/decide", {
            "decision": "approve", "note": note, "expected_version": approval["version"]})
    return approve


def client_sender(user):
    """In-process sender for tests and APIClient demos; a separate client keeps callers' auth state."""
    from rest_framework.test import APIClient

    client = APIClient(HTTP_HOST="localhost")
    client.force_authenticate(user)

    def send(route, body):
        response = client.post(API_PREFIX + route.strip("/") + "/", body, format="json")
        if response.status_code not in (200, 201):
            return None
        return response.data.get("data", response.data)
    return send


def client_flow(owner, password, staff=None):
    """PolicyFlow over APIClient; `staff` approves T3 requests and must not be the verifier."""
    return PolicyFlow(owner, password, client_sender(owner),
                      approver(client_sender(staff)) if staff is not None else None)


def step_up_header(flow, route, body):
    """Django test-client kwargs carrying the step-up token for `route`, if it is a T2 call."""
    token = flow.token(route, body) if flow is not None else None
    return {"HTTP_X_STEP_UP_TOKEN": token} if token else {}


@contextmanager
def scripted_throttling(**rates):
    """Demo commands compress months of activity into seconds of real time.

    Counters are isolated per command invocation (so repeated runs against the shared
    database do not accumulate) and any raised rate is returned for the report.
    """
    effective = {**settings.STUDYFLOW_THROTTLE_RATES, **rates}
    caches = deepcopy(settings.CACHES)
    caches["default"]["KEY_PREFIX"] = "demo-" + uuid4().hex
    with override_settings(STUDYFLOW_THROTTLE_RATES=effective, CACHES=caches):
        yield {"rates": effective, "raised": rates, "counters": "isolated per command invocation"}
