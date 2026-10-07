from django.shortcuts import get_object_or_404
from django.urls import path
from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_serializer,
)
from rest_framework import serializers as s
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from finance import sponsorship as sponsor
from finance.remittances import compare
from finance.serializers import MoneyField
from finance.throttles import AnonThrottle, ScopedThrottle
from finance.workflow_api import CommandView, ResourceView
from finance.workflow_common import require
from finance.workflow_serializers import CURRENCIES, HOME_CURRENCY, CommandResponse, Input


class SponsorInput(Input):
    economic_key = s.CharField(max_length=100)
    amount = MoneyField()
    currency = s.ChoiceField(choices=CURRENCIES)
    available_on = s.DateField()
    purpose = s.CharField(max_length=500)


class TermsInput(Input):
    terms_version = s.IntegerField(min_value=1)


class SponsorRevisionInput(TermsInput):
    action = s.ChoiceField(choices=["revise", "revoke"])
    amount = MoneyField(required=False)
    currency = s.ChoiceField(choices=CURRENCIES, required=False)
    available_on = s.DateField(required=False)
    purpose = s.CharField(max_length=500, required=False)


@extend_schema_serializer(component_name="SponsorDecisionInput")
class DecisionInput(TermsInput):
    decision = s.ChoiceField(choices=["confirm", "reject"])


class ComparisonInput(Input):
    quote_ids = s.ListField(child=s.UUIDField(), min_length=2, max_length=10)
    source_currency = s.ChoiceField(choices=[c for c in CURRENCIES if c != HOME_CURRENCY])
    amount = MoneyField()
    required_amount = MoneyField()
    send_on = s.DateField()
    deadline = s.DateField()


class SponsorView(ResourceView):
    model = sponsor.SponsorRequest
    serializer_class = SponsorInput
    handler = staticmethod(sponsor.create_request)

    @extend_schema(responses=CommandResponse)
    def get(self, request, pk=None):
        query = self.model.objects.filter(owner=request.user).order_by("-created_at")
        result = (
            sponsor.public_record(get_object_or_404(query, pk=pk))
            if pk
            else [sponsor.public_record(r) for r in query[:50]]
        )
        return Response({"data": result})


class SponsorRevisionView(CommandView):
    target_model = sponsor.SponsorRequest
    serializer_class = SponsorRevisionInput
    handler = staticmethod(sponsor.revise_request)


class SponsorDetailView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request, pk):
        return SponsorView().get(request, pk)


class IssueView(CommandView):
    target_model = sponsor.SponsorRequest
    serializer_class = TermsInput
    operator_only = True
    handler = staticmethod(sponsor.issue_link)

    @extend_schema(request=TermsInput, responses=CommandResponse)
    def post(self, request, pk=None):
        response = super().post(request, pk)
        item = get_object_or_404(sponsor.SponsorRequest, pk=pk)
        require(
            response.data["data"]["generation"] == item.token_generation
            and item.status == "PENDING",
            "INVITATION_SUPERSEDED",
        )
        response.data = {
            "data": {
                k: v for k, v in response.data["data"].items() if k != "generation"
            }
        }
        response.data["data"].update(
            token=sponsor.token_value(item),
            confirmation_path="/api/v2/sponsor-confirmation/",
            token_header="X-Sponsor-Token",
            is_simulated=True,
        )
        return response


class ConfirmationView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)
    # Anonymous, so counted per client IP.
    throttle_classes = (AnonThrottle, ScopedThrottle)
    throttle_scope = "sponsor"

    @extend_schema(
        responses=CommandResponse,
        parameters=[
            OpenApiParameter(
                "X-Sponsor-Token", str, OpenApiParameter.HEADER, required=True
            )
        ],
    )
    def get(self, request):
        return Response(
            {"data": sponsor.token_preview(request.headers.get("X-Sponsor-Token"))}
        )

    @extend_schema(
        request=DecisionInput,
        responses=CommandResponse,
        parameters=[
            OpenApiParameter(
                "X-Sponsor-Token", str, OpenApiParameter.HEADER, required=True
            )
        ],
    )
    def post(self, request):
        serializer = DecisionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = sponsor.confirm_token(
            request.headers.get("X-Sponsor-Token"),
            serializer.validated_data,
            request.headers.get("Idempotency-Key", ""),
        )
        return Response({"data": result})


class ComparisonView(CommandView):
    serializer_class = ComparisonInput
    handler = staticmethod(compare)


urlpatterns = [
    path("sponsor-requests/", SponsorView.as_view()),
    path("sponsor-requests/<uuid:pk>/", SponsorDetailView.as_view()),
    path("sponsor-requests/<uuid:pk>/revise/", SponsorRevisionView.as_view()),
    path("sponsor-requests/<uuid:pk>/issue-link/", IssueView.as_view()),
    path("sponsor-confirmation/", ConfirmationView.as_view()),
    path("remittance-comparisons/", ComparisonView.as_view()),
]
