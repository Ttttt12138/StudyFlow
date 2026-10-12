"""A staff-only read model: complete counts and a database-paged, mixed work queue."""
from datetime import timedelta
from math import ceil

from django.db.models import Case, DateTimeField, F, IntegerField, Q, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from .operations_records import _application, _approval, _order, _payment, _student
from .policy_models import ApprovalRequest
from .remittance_models import RemittanceOrder
from .sponsorship import SponsorRequest, public_record
from .workflow_common import record
from .workflow_models import Beneficiary, Payment, SimulatedApplication
from .workflow_serializers import CommandResponse

GROUPS = {"approval": "approvals", "payment": "transactions", "order": "transactions",
          "payee": "payees", "loan": "loans", "sponsor": "sponsors"}


class WorkbenchQuery(serializers.Serializer):
    student = serializers.CharField(required=False, default="", allow_blank=True, max_length=150)
    kind = serializers.ChoiceField(choices=["all", *dict.fromkeys(GROUPS.values())], default="all")
    attention = serializers.ChoiceField(choices=["all", "expiring", "unknown"], default="all")
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=20)


def pending_sets(student, now):
    queries = {
        "approval": ApprovalRequest.objects.filter(status="PENDING", expires_at__gt=now),
        "payment": Payment.objects.filter(status__in=["pending", "unknown"]),
        "order": RemittanceOrder.objects.filter(status__in=["SUBMITTED", "IN_TRANSIT", "UNKNOWN"]),
        "payee": Beneficiary.objects.filter(verified=False),
        "loan": SimulatedApplication.objects.filter(status__in=["UNDER_REVIEW", "APPROVED"]),
        "sponsor": SponsorRequest.objects.filter(Q(status="PENDING") | Q(status="CONFIRMED", source__received=False)),
    }
    return {kind: query.filter(owner__username__icontains=student) for kind, query in queries.items()}


def summarize(queries, now):
    counts = {kind: query.count() for kind, query in queries.items()}
    return {"total": sum(counts.values()), "unverified": counts["payee"],
            "expiring": queries["approval"].filter(expires_at__lte=now + timedelta(hours=1)).count(),
            "unknown": queries["payment"].filter(status="unknown").count() + queries["order"].filter(status="UNKNOWN").count(),
            "by_kind": {group: sum(counts[kind] for kind in counts if GROUPS[kind] == group)
                        for group in dict.fromkeys(GROUPS.values())}}


def priority(kind, now):
    if kind == "approval":
        return Case(When(expires_at__lte=now + timedelta(hours=1), then=Value(0)), default=Value(2))
    if kind in ("payment", "order"):
        return Case(When(status__iexact="unknown", then=Value(1)), default=Value(2))
    return Value(2, output_field=IntegerField())


def queue_index(queries, options, now):
    parts = []
    for kind, query in queries.items():
        if options["kind"] != "all" and GROUPS[kind] != options["kind"]:
            continue
        queued = Coalesce("submitted_at", "created_at") if kind in ("payment", "order") else F("created_at")
        query = query.order_by().annotate(work_kind=Value(kind), work_priority=priority(kind, now), queued_at=queued)
        if options["attention"] != "all":
            query = query.filter(work_priority=0 if options["attention"] == "expiring" else 1)
        parts.append(query.values("id", "work_kind", "work_priority", "queued_at"))
    return parts[0].union(*parts[1:], all=True).order_by("work_priority", "queued_at", "work_kind", "id")


def record_set(query, kind):
    relations = {"approval": ("owner", "requested_by", "decided_by"), "payment": ("owner", "beneficiary"),
                 "order": ("owner", "beneficiary", "quote"), "payee": ("owner",),
                 "loan": ("owner", "loan"), "sponsor": ("owner", "source")}
    query = query.select_related(*relations[kind])
    return query.prefetch_related("history") if kind == "order" else query


def present(obj, kind, staff):
    presenters = {"approval": lambda row: _approval(staff, row), "payment": _payment,
                  "order": _order, "loan": _application,
                  "payee": lambda row: {**record(row), **_student(row)},
                  "sponsor": lambda row: {**public_record(row), **_student(row)}}
    return presenters[kind](obj)


def page_items(queries, index, staff):
    records = {}
    for kind, query in queries.items():
        ids = [row["id"] for row in index if row["work_kind"] == kind]
        if ids:
            records[kind] = record_set(query.filter(pk__in=ids), kind).in_bulk()
    return [{"kind": row["work_kind"], "queued_at": row["queued_at"],
             "attention": {0: "expiring", 1: "unknown"}.get(row["work_priority"]),
             "record": present(records[row["work_kind"]][row["id"]], row["work_kind"], staff)}
            for row in index if row["id"] in records.get(row["work_kind"], {})]


def recent_decisions(student, staff, now):
    expired = Q(status__in=["PENDING", "APPROVED"], expires_at__lte=now)
    query = ApprovalRequest.objects.filter(owner__username__icontains=student).filter(~Q(status="PENDING") | expired)
    query = query.annotate(activity_at=Case(When(expired, then=F("expires_at")),
        default=Coalesce("decided_at", "created_at"), output_field=DateTimeField()))
    rows = record_set(query, "approval").order_by("-activity_at", "-created_at", "-pk")[:20]
    result = []
    for row in rows:
        if row.status in ("PENDING", "APPROVED") and row.expires_at <= now:
            row.status = "EXPIRED"  # Read-time projection; GET never changes the underlying approval.
        result.append({**_approval(staff, row), "activity_at": row.activity_at})
    return result


def workbench(staff, options):
    now = timezone.now()
    queries = pending_sets(options["student"], now)
    summary = summarize(queries, now)
    index = queue_index(queries, options, now)
    total = index.count()
    pages = max(1, ceil(total / options["page_size"]))
    page = min(options["page"], pages)
    start = (page - 1) * options["page_size"]
    return {"operator": {"id": staff.pk, "username": staff.get_username()}, "summary": summary,
            "items": page_items(queries, list(index[start:start + options["page_size"]]), staff),
            "pagination": {"page": page, "page_size": options["page_size"], "total": total, "pages": pages},
            "recent_decisions": recent_decisions(options["student"], staff, now),
            "generated_at": now, "is_simulated": True}


class OperationsWorkbenchView(APIView):
    @extend_schema(parameters=[WorkbenchQuery], responses=CommandResponse)
    def get(self, request):
        if not request.user.is_staff:
            raise PermissionDenied("Only operations staff can see the workbench.")
        query = WorkbenchQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response({"data": workbench(request.user, query.validated_data)})
