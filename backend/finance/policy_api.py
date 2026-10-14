"""Auth token, step-up and dual-control approval routes (docs/permissions.md)."""
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.urls import path
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers as s
from rest_framework.authtoken.models import Token
from rest_framework.authtoken.serializers import AuthTokenSerializer
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import policy
from .policy_models import APPROVAL_STATUSES, ApprovalRequest
from .serializers import CurrencyAmountField
from .throttles import AnonThrottle, ScopedThrottle, UserThrottle
from .workflow_common import record
from .workflow_serializers import CURRENCIES, CommandResponse, HistoryResponse, Input

ACTION_CHOICES = list(policy.ACTIONS)


class TokenResponse(s.Serializer):
    token = s.CharField()


class StepUpInput(Input):
    password = s.CharField(max_length=128, trim_whitespace=False)
    action = s.ChoiceField(choices=ACTION_CHOICES)
    target_id = s.UUIDField()
    amount = CurrencyAmountField()
    currency = s.ChoiceField(choices=CURRENCIES)


class StepUpResponse(s.Serializer):
    token = s.CharField()
    expires_in_seconds = s.IntegerField()
    action = s.CharField()
    target_id = s.UUIDField()
    amount = s.CharField()
    currency = s.CharField()


class ApprovalInput(Input):
    action = s.ChoiceField(choices=ACTION_CHOICES)
    target_id = s.UUIDField()
    amount = CurrencyAmountField()
    currency = s.ChoiceField(choices=CURRENCIES)
    # Optional: the student may explain the payment; operations may contact them either way.
    reason = s.CharField(max_length=500, required=False, allow_blank=True, default="")


class ApprovalDecisionInput(Input):
    decision = s.ChoiceField(choices=["approve", "reject"])
    note = s.CharField(max_length=500, required=False, allow_blank=True, default="")
    expected_version = s.IntegerField(min_value=1)


def approval_record(item):
    from django.conf import settings
    # 0 when the demo's simulated operator is off: the page then waits for real staff instead of counting down.
    return {**record(item), "owner": item.owner_id,
            "simulated_after_seconds": max(0, settings.STUDYFLOW_SIMULATED_APPROVAL_SECONDS)}


def visible(user):
    queryset = ApprovalRequest.objects.all()
    if not user.is_staff:
        queryset = queryset.filter(owner=user)
    return queryset


class TokenView(APIView):
    """Exchange a username and password for an API token."""
    authentication_classes = ()
    permission_classes = (AllowAny,)
    throttle_classes = (AnonThrottle, ScopedThrottle)
    throttle_scope = "auth"

    @extend_schema(request=AuthTokenSerializer, responses=TokenResponse)
    def post(self, request):
        serializer = AuthTokenSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        token, _ = Token.objects.get_or_create(user=serializer.validated_data["user"])
        return Response({"token": token.key})


class StepUpView(APIView):
    throttle_classes = (UserThrottle, ScopedThrottle)
    throttle_scope = "step_up"

    @extend_schema(request=StepUpInput, responses=StepUpResponse)
    def post(self, request):
        serializer = StepUpInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(policy.step_up(request.user, serializer.validated_data))


class ApprovalListView(APIView):
    @extend_schema(responses=HistoryResponse, parameters=[
        OpenApiParameter("status", str, OpenApiParameter.QUERY, enum=APPROVAL_STATUSES)])
    def get(self, request):
        policy.expire_stale(visible(request.user))
        queryset = visible(request.user).order_by("-created_at")
        if request.query_params.get("status"):
            queryset = queryset.filter(status=request.query_params["status"].upper())
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response([approval_record(x) for x in page])

    @extend_schema(request=ApprovalInput, responses={201: CommandResponse})
    def post(self, request):
        serializer = ApprovalInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        approval = policy.request_approval(request.user, serializer.validated_data)
        return Response({"data": approval_record(approval)}, status=201)


class ApprovalDetailView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request, pk):
        policy.expire_stale(visible(request.user).filter(Q(pk=pk)))
        return Response({"data": approval_record(get_object_or_404(visible(request.user), pk=pk))})


class ApprovalDecisionView(APIView):
    @extend_schema(request=ApprovalDecisionInput, responses=CommandResponse)
    def post(self, request, pk):
        if not request.user.is_staff:
            raise PermissionDenied("Only operations staff can decide approvals.")
        serializer = ApprovalDecisionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        approval = policy.decide(request.user, pk, serializer.validated_data)
        return Response({"data": approval_record(approval)})


class ApprovalSimulateView(APIView):
    """Demo: the requester's own pending approval is approved by a simulated operator after a short wait."""

    @extend_schema(request=None, responses=CommandResponse)
    def post(self, request, pk):
        return Response({"data": approval_record(policy.simulate_approval(request.user, pk))})


class LimitsView(APIView):
    """T0: the student's effective outflow limits (base x credit multiplier) and usage."""

    @extend_schema(responses=CommandResponse)
    def get(self, request):
        return Response({"data": policy.limits_summary(request.user)})


urlpatterns = [
    path("auth/token/", TokenView.as_view()),
    path("policy/limits/", LimitsView.as_view()),
    path("auth/step-up/", StepUpView.as_view()),
    path("approvals/", ApprovalListView.as_view()),
    path("approvals/<uuid:pk>/", ApprovalDetailView.as_view()),
    path("approvals/<uuid:pk>/decide/", ApprovalDecisionView.as_view()),
    path("approvals/<uuid:pk>/simulate/", ApprovalSimulateView.as_view()),
]
