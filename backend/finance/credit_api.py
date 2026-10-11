from django.urls import path
from drf_spectacular.utils import extend_schema
from rest_framework import serializers as s
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import credit
from .credit_models import CreditSnapshot
from .workflow_serializers import CommandResponse, EmptyInput, Input
from .workflow_urls import command, resource


class CreditStatementInput(Input):
    snapshot_id = s.UUIDField()


class StatementVerifyInput(Input):
    # Malformed input is reported as an invalid statement (HTTP 200), not a 400.
    statement = s.CharField(allow_blank=True, allow_null=True, required=False, default="",
                            trim_whitespace=False)


class ProfileView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        return Response({"data": credit.profile(request.user)})


class VerifyView(APIView):
    # Public so a landlord or school can check a statement without an account.
    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(request=StatementVerifyInput, responses=CommandResponse)
    def post(self, request):
        data = StatementVerifyInput(data=request.data)
        data.is_valid(raise_exception=True)
        return Response({"data": credit.verify_statement(data.validated_data["statement"])})


urlpatterns = [
    path("credit/profile/", ProfileView.as_view()),
    path("credit/statements/verify/", VerifyView.as_view()),
    command("credit/statements/", "CreditStatement", CreditStatementInput, credit.issue_statement),
    *resource("credit/snapshots", CreditSnapshot, EmptyInput, credit.create_snapshot),
]
