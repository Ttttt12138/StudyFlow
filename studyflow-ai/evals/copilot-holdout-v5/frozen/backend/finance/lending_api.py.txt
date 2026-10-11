from django.contrib.auth import get_user_model
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from .affordability import save_profile
from .c_adapter import export_application
from .lending_ledger import account_record
from .lending_models import AffordabilityProfile, LoanAccount
from .lending_serializers import ProfileInput
from .workflow_api import CommandView
from .workflow_common import owned, record
from .workflow_serializers import CommandResponse, HistoryResponse


class ProfileView(CommandView):
    idempotency_namespace = "b-lending"
    serializer_class = ProfileInput
    handler = staticmethod(save_profile)

    @extend_schema(responses=CommandResponse)
    def get(self, request):
        profile = AffordabilityProfile.objects.filter(owner=request.user).first()
        return Response(
            {"data": record(profile) if profile else {"version": 0, "months": []}}
        )


class AccountView(APIView):
    @extend_schema(responses=HistoryResponse)
    @transaction.atomic
    def get(self, request, pk=None):
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        if pk:
            return Response(
                {"data": account_record(owned(LoanAccount, request.user, pk))}
            )
        from rest_framework.pagination import PageNumberPagination

        paginator = PageNumberPagination()
        accounts = LoanAccount.objects.filter(owner=request.user).order_by(
            "-created_at"
        )
        page = paginator.paginate_queryset(accounts, request)
        return paginator.get_paginated_response(
            [account_record(account) for account in page]
        )


class ContextView(APIView):
    @extend_schema(responses=CommandResponse)
    @transaction.atomic
    def get(self, request, pk):
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        exported = export_application(request.user, pk)
        return Response(
            {
                "data": {
                    key: value.model_dump(mode="json")
                    if hasattr(value, "model_dump")
                    else value
                    for key, value in exported.items()
                }
            }
        )
