"""Operator work queue: everything waiting on a staff action, across students (read-only).

The actions themselves stay on their existing routes: approvals/{id}/decide/,
payments/{id}/adapter-event/, remittance-orders/{id}/adapter-event/, beneficiaries/{id}/verify/,
applications/{id}/decision|disburse/, sponsor-requests/{id}/issue-link/ and funding-sources/{id}/receive/.
"""
from django.db.models import Q
from django.urls import path
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from . import money, policy
from .policy_api import approval_record
from .policy_models import ApprovalRequest
from .remittance_models import RemittanceOrder
from .remittance_orders import order_record
from .sponsorship import SponsorRequest, public_record
from .workflow_common import record
from .workflow_models import Beneficiary, Payment, SimulatedApplication
from .workflow_serializers import CommandResponse

LIMIT = 100


def _student(obj):
    return {"owner": obj.owner_id, "owner_username": obj.owner.get_username()}


def _payment(payment):
    return {**record(payment), **_student(payment), "currency": money.home_currency(),
            "beneficiary_name": payment.beneficiary.name,
            "beneficiary_verified": payment.beneficiary.verified}


def _order(order):
    return {**order_record(order), **_student(order),
            "beneficiary_name": order.beneficiary.name if order.beneficiary_id else None}


def _application(application):
    result = application.loan.result
    return {**record(application), **_student(application), "quote": {
        key: result.get(key) for key in ("currency", "principal", "net_proceeds", "fees", "total_repayment",
                                         "maximum_installment", "affordability_status")} | {
        "months": application.loan.inputs.get("months"), "annual_rate": application.loan.inputs.get("annual_rate")}}


def _target(approval):
    """What the approval would release, so the operator decides on the real subject."""
    if approval.action == "payment.submit":
        payment = Payment.objects.select_related("owner", "beneficiary").filter(pk=approval.target_id).first()
        return payment and {"kind": "payment", **_payment(payment),
                            "payee_verified_by": policy.latest_verifier(payment.beneficiary_id)}
    if approval.action == "remittance.submit":
        order = RemittanceOrder.objects.select_related("owner", "beneficiary", "quote").filter(pk=approval.target_id).first()
        return order and {"kind": "remittance_order", **_order(order),
                          "payee_verified_by": policy.latest_verifier(order.beneficiary_id) if order.beneficiary_id else None}
    return None


def _approval(staff, approval):
    allowed = policy.separation_of_duties(staff, approval)
    blocked = None
    if not allowed:
        blocked = "OWN_REQUEST" if staff.pk in (approval.requested_by_id, approval.owner_id) else "VERIFIED_PAYEE"
    return {**approval_record(approval), **_student(approval),
            "requested_by_username": approval.requested_by.get_username(),
            "decided_by_username": approval.decided_by.get_username() if approval.decided_by_id else None,
            "can_decide": allowed and approval.status == "PENDING", "blocked_reason": blocked,
            "target": _target(approval)}


class OperationsQueueView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        if not request.user.is_staff:
            raise PermissionDenied("Only operations staff can see the operations queue.")
        policy.expire_stale()
        approvals = ApprovalRequest.objects.select_related("owner", "requested_by", "decided_by")
        pending = approvals.filter(status="PENDING").order_by("expires_at")[:LIMIT]
        decided = approvals.exclude(status="PENDING").order_by("-decided_at", "-created_at")[:20]
        payments = Payment.objects.select_related("owner", "beneficiary").filter(
            status__in=["pending", "unknown"]).order_by("submitted_at")[:LIMIT]
        orders = RemittanceOrder.objects.select_related("owner", "beneficiary", "quote").prefetch_related("history").filter(
            status__in=["SUBMITTED", "IN_TRANSIT", "UNKNOWN"]).order_by("submitted_at")[:LIMIT]
        payees = Beneficiary.objects.select_related("owner").filter(verified=False).order_by("created_at")[:LIMIT]
        applications = SimulatedApplication.objects.select_related("owner", "loan").filter(
            status__in=["UNDER_REVIEW", "APPROVED"]).order_by("created_at")[:LIMIT]
        sponsors = SponsorRequest.objects.select_related("owner", "source").filter(
            Q(status="PENDING") | Q(status="CONFIRMED", source__received=False)).order_by("created_at")[:LIMIT]
        return Response({"data": {
            "operator": {"id": request.user.pk, "username": request.user.get_username()},
            "approvals": [_approval(request.user, a) for a in pending],
            "recent_decisions": [_approval(request.user, a) for a in decided],
            "payments": [_payment(p) for p in payments],
            "remittance_orders": [_order(o) for o in orders],
            "beneficiaries": [{**record(b), **_student(b)} for b in payees],
            "applications": [_application(a) for a in applications],
            "sponsor_requests": [{**public_record(r), **_student(r)} for r in sponsors],
            "is_simulated": True,
        }})


urlpatterns = [path("operations/queue/", OperationsQueueView.as_view())]
