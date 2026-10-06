from django.shortcuts import get_object_or_404
from django.urls import path
from drf_spectacular.utils import extend_schema
from rest_framework import serializers as s
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from . import remittance_orders as orders
from .remittance_models import PURPOSES, RemittanceOrder
from .workflow_api import CommandView
from .workflow_serializers import CommandResponse, HistoryResponse, Input
from .workflow_urls import command


class OrderInput(Input):
    quote_id = s.UUIDField()
    recipient = s.ChoiceField(choices=["SELF", "BENEFICIARY"])
    beneficiary_id = s.UUIDField(required=False, allow_null=True)
    purpose = s.ChoiceField(choices=PURPOSES)
    reference = s.CharField(max_length=140, required=False, allow_blank=True)
    deadline = s.DateField(required=False, allow_null=True)


class OrderVersionInput(Input):
    expected_version = s.IntegerField(min_value=1)
    note = s.CharField(max_length=500, required=False, allow_blank=True)


class OrderEventInput(OrderVersionInput):
    outcome = s.ChoiceField(choices=["dispatched", "delivered", "failed", "unknown"])


class OrderCollectionView(CommandView):
    serializer_class = OrderInput
    handler = staticmethod(orders.create_order)

    @extend_schema(responses=HistoryResponse)
    def get(self, request):
        rows = RemittanceOrder.objects.filter(owner=request.user).select_related("quote").order_by("-created_at")
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(rows, request)
        return paginator.get_paginated_response([orders.order_record(row) for row in page])


class OrderDetailView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request, pk):
        order = get_object_or_404(RemittanceOrder, owner=request.user, pk=pk)
        return Response({"data": orders.order_record(order)})


urlpatterns = [
    path("remittance-orders/", OrderCollectionView.as_view()),
    path("remittance-orders/<uuid:pk>/", OrderDetailView.as_view()),
    command("remittance-orders/<uuid:pk>/cancel/", "RemittanceCancel", OrderVersionInput,
            orders.cancel, RemittanceOrder),
    command("remittance-orders/<uuid:pk>/submit/", "RemittanceSubmit", OrderVersionInput,
            orders.submit, RemittanceOrder),
    command("remittance-orders/<uuid:pk>/adapter-event/", "RemittanceAdapterEvent", OrderEventInput,
            orders.adapter_event, RemittanceOrder, True),
    command("remittance-orders/<uuid:pk>/reconcile/", "RemittanceReconcile", OrderVersionInput,
            orders.reconcile, RemittanceOrder),
]
