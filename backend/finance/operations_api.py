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

from . import policy
from .operations_records import _application, _approval, _order, _payment, _student
from .operations_workbench import OperationsWorkbenchView
from .policy_models import ApprovalRequest
from .remittance_models import RemittanceOrder
from .sponsorship import SponsorRequest, public_record
from .workflow_common import record
from .workflow_models import Beneficiary, Payment, SimulatedApplication
from .workflow_serializers import CommandResponse

LIMIT = 100


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


urlpatterns = [
    path("operations/queue/", OperationsQueueView.as_view()),
    path("operations/workbench/", OperationsWorkbenchView.as_view()),
]
