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

from finance.services import json_value
from finance.workflow_api import CommandView, ReadView, ResourceView
from finance.workflow_common import record, require
from finance.workflow_models import Beneficiary, IdempotencyRecord
from finance.workflow_serializers import CommandResponse, HistoryResponse

from . import imports, services
from . import serializers as s
from .funding import create_funding_plan, recommend_funding
from .models import (
    ImportMaterial,
    NotificationOutbox,
    ReadinessJob,
    ReadinessRun,
    RiskCard,
    Semester,
)
from .safety import update_beneficiary
from .templates import get_template


class Enabled:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not settings.STUDYFLOW_READINESS_ENABLED:
            raise NotFound("Readiness is disabled")


class TemplatesView(Enabled, APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        return Response({"data": [get_template("shared"), get_template("single")]})


class StateView(Enabled, APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        return Response({"data": services.financial_state(request.user)})


class SemesterView(Enabled, ResourceView):
    model = Semester
    serializer_class = s.SemesterInput
    handler = staticmethod(services.create_semester)


class RevisionView(Enabled, CommandView):
    serializer_class = s.RevisionInput
    handler = staticmethod(services.revise_semester)


class RunView(Enabled, ResourceView):
    model = ReadinessRun
    kind = "budget"

    @extend_schema(responses=HistoryResponse)
    def get(self, request):
        rows = ReadinessRun.objects.filter(owner=request.user, kind=self.kind).order_by(
            "-created_at"
        )[:50]
        return Response({"data": [record(row) for row in rows]})


class BudgetView(RunView):
    kind = "budget"
    serializer_class = s.Versions
    handler = staticmethod(services.create_budget)


class ForecastView(RunView):
    kind = "forecast"
    serializer_class = s.ForecastInput
    handler = staticmethod(services.create_forecast)


class FundingView(RunView):
    kind = "funding"
    serializer_class = s.FundingInput
    handler = staticmethod(create_funding_plan)


class RecommendationView(RunView):
    kind = "recommendation"
    serializer_class = s.FundingInput
    handler = staticmethod(recommend_funding)


def request_check(owner, data, obj=None):
    from .jobs import enqueue_check

    services.versions(owner, data)
    return record(enqueue_check(owner, "manual"))


class CheckView(Enabled, ResourceView):
    model = ReadinessJob
    serializer_class = s.Versions
    handler = staticmethod(request_check)


class OwnedReadView(Enabled, ReadView):
    pass


class ImportView(Enabled, APIView):
    parser_classes = (MultiPartParser, FormParser)

    @extend_schema(responses=HistoryResponse)
    def get(self, request, pk=None):
        rows = ImportMaterial.objects.filter(owner=request.user).order_by("-created_at")
        if pk:
            return Response(
                {"data": imports.material_record(get_object_or_404(rows, pk=pk))}
            )
        return Response({"data": [imports.material_record(row) for row in rows[:50]]})

    @extend_schema(request=s.UploadInput, responses={202: CommandResponse})
    def post(self, request):
        serializer = s.UploadInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        upload = data.pop("file")
        require(upload.size <= 5 * 1024 * 1024, "FILE_SIZE_LIMIT")
        content = upload.read(5 * 1024 * 1024 + 1)
        fingerprint = hashlib.sha256(
            json.dumps(json_value(data), sort_keys=True).encode() + content
        ).hexdigest()
        key = request.headers.get("Idempotency-Key", "")
        require(1 <= len(key) <= 100, "IDEMPOTENCY_KEY_REQUIRED")
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            previous = IdempotencyRecord.objects.filter(
                owner=request.user, scope=request.path, key=key
            ).first()
            if previous:
                require(previous.request_hash == fingerprint, "IDEMPOTENCY_CONFLICT")
                return Response(previous.response, status=202)
            payload = {"data": imports.upload(request.user, data, content)}
            IdempotencyRecord.objects.create(
                owner=request.user,
                scope=request.path,
                key=key,
                request_hash=fingerprint,
                response=payload,
            )
        return Response(payload, status=202)


class ConfirmView(Enabled, CommandView):
    serializer_class = s.ConfirmationInput
    target_model = ImportMaterial
    handler = staticmethod(imports.confirm)


class BeneficiaryUpdateView(Enabled, CommandView):
    serializer_class = s.BeneficiaryUpdateInput
    target_model = Beneficiary
    handler = staticmethod(update_beneficiary)


urlpatterns = [
    path("beneficiaries/<uuid:pk>/update/", BeneficiaryUpdateView.as_view()),
    path("templates/", TemplatesView.as_view()),
    path("semesters/", SemesterView.as_view()),
    path("semesters/revise/", RevisionView.as_view()),
    path("semesters/<uuid:pk>/", OwnedReadView.as_view(model=Semester)),
    path("state/", StateView.as_view()),
    path("budgets/", BudgetView.as_view()),
    path("forecasts/", ForecastView.as_view()),
    path("funding-plans/", FundingView.as_view()),
    path("funding-plans/recommend/", RecommendationView.as_view()),
    path("checks/", CheckView.as_view()),
    path("checks/<uuid:pk>/", OwnedReadView.as_view(model=ReadinessJob)),
    path("risks/", OwnedReadView.as_view(model=RiskCard)),
    path("notifications/", OwnedReadView.as_view(model=NotificationOutbox)),
    path("imports/", ImportView.as_view()),
    path("imports/<uuid:pk>/", ImportView.as_view()),
    path("imports/<uuid:pk>/confirm/", ConfirmView.as_view()),
]
