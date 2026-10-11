import hashlib
import json

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.urls import path
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from finance.workflow_api import CommandView, ReadView
from finance.workflow_common import record, require
from finance.workflow_models import IdempotencyRecord
from finance.workflow_serializers import CommandResponse, HistoryResponse

from . import imports
from . import serializers as s
from .analysis import analyze, review_recurring
from .models import (
    CalibrationRevision,
    ObservedTransaction,
    RecurringExpense,
    TransactionImport,
)
from .monitoring import overview


class Enabled:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if (
            not settings.STUDYFLOW_CONSUMPTION_ENABLED
            or not settings.STUDYFLOW_READINESS_ENABLED
        ):
            raise NotFound("Consumption learning is disabled")


class UploadView(Enabled, APIView):
    parser_classes = (MultiPartParser, FormParser)

    @extend_schema(request=s.UploadInput, responses={202: CommandResponse})
    @transaction.atomic
    def post(self, request):
        serializer = s.UploadInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        upload = data.pop("file")
        require(upload.size <= 5 * 1024 * 1024, "FILE_SIZE_LIMIT")
        content = upload.read(5 * 1024 * 1024 + 1)
        digest = hashlib.sha256(
            json.dumps(data, sort_keys=True).encode() + content
        ).hexdigest()
        key = request.headers.get("Idempotency-Key", "")
        require(1 <= len(key) <= 100, "IDEMPOTENCY_KEY_REQUIRED")
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        previous = IdempotencyRecord.objects.filter(
            owner=request.user, scope=request.path, key=key
        ).first()
        if previous:
            require(previous.request_hash == digest, "IDEMPOTENCY_CONFLICT")
            return Response(previous.response, status=202)
        payload = {"data": imports.upload(request.user, data, content)}
        IdempotencyRecord.objects.create(
            owner=request.user,
            scope=request.path,
            key=key,
            request_hash=digest,
            response=payload,
        )
        return Response(payload, status=202)

    @extend_schema(responses=HistoryResponse)
    def get(self, request):
        view = ReadView()
        view.model = TransactionImport
        return view.get(request)


class OwnedReadView(Enabled, ReadView):
    @extend_schema(responses=HistoryResponse)
    def get(self, request, pk=None):
        if self.model is not ObservedTransaction:
            return super().get(request, pk)
        query = self.model.objects.filter(owner=request.user).order_by("-date", "id")
        filters = s.TransactionQueryInput(data=request.query_params)
        filters.is_valid(raise_exception=True)
        query = query.filter(**filters.validated_data)
        if pk:
            return Response({"data": record(get_object_or_404(query, pk=pk))})
        from rest_framework.pagination import PageNumberPagination

        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(query, request)
        return paginator.get_paginated_response([record(row) for row in page])


class ConfirmView(Enabled, CommandView):
    target_model = TransactionImport
    serializer_class = s.ConfirmInput
    handler = staticmethod(imports.confirm)


class RevisionView(Enabled, CommandView):
    target_model = ObservedTransaction
    serializer_class = s.RevisionInput
    handler = staticmethod(imports.revise_transaction)


class RecurringView(Enabled, CommandView):
    target_model = RecurringExpense
    serializer_class = s.RecurringInput
    handler = staticmethod(review_recurring)


class BalanceView(Enabled, CommandView):
    serializer_class = s.BalanceInput
    handler = staticmethod(imports.confirm_balance)


class SummaryView(Enabled, APIView):
    kind = "briefing"

    @extend_schema(responses=CommandResponse)
    def get(self, request):
        if self.kind == "calibrations":
            result = {
                "current": analyze(request.user),
                "history": [
                    record(r)
                    for r in CalibrationRevision.objects.filter(
                        owner=request.user
                    ).order_by("-created_at")[:50]
                ],
            }
        else:
            result = overview(request.user)
            if self.kind == "calendar":
                result = {
                    k: result[k]
                    for k in (
                        "calendar",
                        "as_of",
                        "state_version",
                        "budget_version",
                        "analysis_version",
                        "is_simulated",
                    )
                }
            else:
                result.pop("prediction")
        return Response({"data": result})


urlpatterns = [
    path("balance-confirmations/", BalanceView.as_view()),
    path("transaction-imports/", UploadView.as_view()),
    path(
        "transaction-imports/<uuid:pk>/", OwnedReadView.as_view(model=TransactionImport)
    ),
    path("transaction-imports/<uuid:pk>/confirm/", ConfirmView.as_view()),
    path("transactions/", OwnedReadView.as_view(model=ObservedTransaction)),
    path("transactions/<uuid:pk>/revise/", RevisionView.as_view()),
    path("recurring-expenses/", OwnedReadView.as_view(model=RecurringExpense)),
    path("recurring-expenses/<uuid:pk>/review/", RecurringView.as_view()),
    path("calibrations/", SummaryView.as_view(kind="calibrations")),
    path("calendar/", SummaryView.as_view(kind="calendar")),
    path("briefing/", SummaryView.as_view()),
]
