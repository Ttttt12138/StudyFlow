from django.conf import settings
from django.shortcuts import get_object_or_404
from django.urls import path
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from finance.readiness.models import NotificationOutbox
from finance.workflow_api import CommandView
from finance.workflow_common import record
from finance.workflow_serializers import CommandResponse, EmptyInput

from . import reviews, scenarios
from .contracts import ApplyInput, PreviewInput, ReviewInput, SimulateInput
from .models import ExplanationTrace, ReviewItem, WhatIfRun


class Enabled:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not settings.STUDYFLOW_READINESS_ENABLED:
            raise NotFound("Readiness is disabled")


class SimulateView(Enabled, CommandView):
    serializer_class = SimulateInput
    handler = staticmethod(scenarios.create)


class PreviewView(Enabled, CommandView):
    serializer_class = PreviewInput
    target_model = WhatIfRun
    handler = staticmethod(scenarios.preview)


class ApplyView(Enabled, CommandView):
    serializer_class = ApplyInput
    target_model = WhatIfRun
    handler = staticmethod(scenarios.apply)


class ScenarioView(Enabled, APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request, pk):
        return Response(
            {
                "data": scenarios.view(
                    get_object_or_404(WhatIfRun, owner=request.user, pk=pk)
                )
            }
        )


class ExplanationView(Enabled, APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request, trace_id):
        item = get_object_or_404(
            ExplanationTrace, owner=request.user, trace_id=trace_id
        )
        return Response({"data": record(item)})


def review_queryset(user):
    return (
        ReviewItem.objects.all()
        if user.is_staff
        else ReviewItem.objects.filter(owner=user)
    )


class ReviewView(Enabled, APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request, pk=None):
        rows = review_queryset(request.user)
        if pk:
            item = get_object_or_404(rows, pk=pk)
            return Response(
                {
                    "data": {
                        **record(item),
                        "history": [
                            record(h)
                            for h in item.reviewaction_set.order_by("created_at")
                        ],
                    }
                }
            )
        for field in ("status", "kind"):
            if request.query_params.get(field):
                rows = rows.filter(**{field: request.query_params[field]})
        if request.query_params.get("assigned_to_me") == "true":
            rows = rows.filter(assignee=request.user)
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(rows.order_by("-updated_at", "id"), request)
        return Response(
            {
                "data": {
                    "count": rows.count(),
                    "items": [record(r) for r in page],
                    "next": paginator.get_next_link(),
                    "previous": paginator.get_previous_link(),
                }
            }
        )


class ReviewActionView(Enabled, CommandView):
    serializer_class = ReviewInput
    target_model = ReviewItem
    handler = staticmethod(reviews.act)

    @extend_schema(responses=CommandResponse)
    def post(self, request, pk=None):
        # Reuse command locking/idempotency, with staff access to the assigned student's record.
        self.operator_only = request.user.is_staff
        return super().post(request, pk)


class NotificationView(Enabled, APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        rows = NotificationOutbox.objects.filter(owner=request.user)
        unread = rows.filter(read_at__isnull=True).count()
        if request.query_params.get("unread") == "true":
            rows = rows.filter(read_at__isnull=True)
        if request.query_params.get("transition"):
            rows = rows.filter(transition=request.query_params["transition"])
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(rows.order_by("-created_at", "id"), request)
        items = [
            {**record(r), "target": {"kind": "risk", "id": str(r.risk_id)}}
            for r in page
        ]
        return Response(
            {
                "data": items,
                "unread_count": unread,
                "count": rows.count(),
                "next": paginator.get_next_link(),
                "previous": paginator.get_previous_link(),
            }
        )


def mark_read(owner, data, item):
    if item.read_at is None:
        item.read_at = timezone.now()
        item.save(update_fields=["read_at"])
    return record(item)


class NotificationReadView(Enabled, CommandView):
    serializer_class = EmptyInput
    target_model = NotificationOutbox
    handler = staticmethod(mark_read)


urlpatterns = [
    path("readiness/what-if/", SimulateView.as_view()),
    path("readiness/what-if/<uuid:pk>/", ScenarioView.as_view()),
    path("readiness/what-if/<uuid:pk>/apply-preview/", PreviewView.as_view()),
    path("readiness/what-if/<uuid:pk>/apply/", ApplyView.as_view()),
    path("readiness/explanations/<str:trace_id>/", ExplanationView.as_view()),
    path("readiness/notifications/", NotificationView.as_view()),
    path("readiness/notifications/<uuid:pk>/read/", NotificationReadView.as_view()),
    path("review-queue/", ReviewView.as_view()),
    path("review-queue/<uuid:pk>/", ReviewView.as_view()),
    path("review-queue/<uuid:pk>/actions/", ReviewActionView.as_view()),
]
