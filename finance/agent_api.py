from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.urls import path
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers as s
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from . import agent_runner
from .agent_models import AgentPendingAction, AgentSession
from .workflow_common import require
from .workflow_serializers import CommandResponse, EmptyInput, HistoryResponse, Input
from .workflow_urls import command


class SessionInput(Input):
    goal = s.CharField(max_length=2000)
    locale = s.ChoiceField(choices=["zh", "en"], required=False)


class SessionCollectionView(APIView):
    @extend_schema(responses=HistoryResponse)
    def get(self, request):
        rows = AgentSession.objects.filter(owner=request.user).order_by("-created_at")
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(rows, request)
        return paginator.get_paginated_response([agent_runner.session_record(row) for row in page])

    @extend_schema(request=SessionInput, responses=CommandResponse, parameters=[OpenApiParameter(
        name="Idempotency-Key", location=OpenApiParameter.HEADER, required=True, type=str)])
    def post(self, request):
        key = request.headers.get("Idempotency-Key", "")
        require(1 <= len(key) <= 100, "Idempotency-Key header (1-100 characters) is required.")
        data = SessionInput(data=request.data)
        data.is_valid(raise_exception=True)
        # Without an explicit locale, answer in the request's negotiated language.
        data.validated_data.setdefault(
            "locale", "zh" if getattr(request, "LANGUAGE_CODE", "").startswith("zh") else "en")
        existing = AgentSession.objects.filter(owner=request.user, idempotency_key=key).first()
        if existing is None:
            try:
                with transaction.atomic():
                    session = AgentSession.objects.create(
                        owner=request.user, idempotency_key=key, goal=data.validated_data["goal"],
                        locale=data.validated_data["locale"], mode=agent_runner.settings.STUDYFLOW_AI_MODE)
            except IntegrityError:
                existing = AgentSession.objects.get(owner=request.user, idempotency_key=key)
        if existing is not None:
            require(existing.goal == data.validated_data["goal"]
                    and existing.locale == data.validated_data["locale"],
                    "Idempotency key was used with a different request.")
            return Response({"data": agent_runner.session_record(existing)})
        # Planner calls may be slow, so the loop runs outside a request-wide transaction.
        agent_runner.run(session)
        return Response({"data": agent_runner.session_record(session)}, status=201)


class SessionDetailView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request, pk):
        session = get_object_or_404(AgentSession, owner=request.user, pk=pk)
        return Response({"data": agent_runner.session_record(session)})


urlpatterns = [
    path("agent/sessions/", SessionCollectionView.as_view()),
    path("agent/sessions/<uuid:pk>/", SessionDetailView.as_view()),
    command("agent/pending-actions/<uuid:pk>/confirm/", "AgentConfirm", EmptyInput,
            agent_runner.confirm_pending, AgentPendingAction, policy="agent.confirm"),
    command("agent/pending-actions/<uuid:pk>/reject/", "AgentReject", EmptyInput,
            agent_runner.reject_pending, AgentPendingAction),
]
