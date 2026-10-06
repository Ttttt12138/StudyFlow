from django.urls import path
from rest_framework import serializers

from . import c_adapter, lending_applications, lending_ledger
from .lending_api import AccountView, ContextView, ProfileView
from .lending_models import LoanAccount
from .lending_serializers import ExplanationInput, RepaymentInput
from .workflow_models import SimulatedApplication
from .workflow_serializers import Input
from .workflow_urls import command


class VersionInput(Input):
    expected_version = serializers.IntegerField(min_value=1)


urlpatterns = [
    path("affordability-profile/", ProfileView.as_view()),
    path("loan-accounts/", AccountView.as_view()),
    path("loan-accounts/<uuid:pk>/", AccountView.as_view()),
    path("applications/<uuid:pk>/c-context/", ContextView.as_view()),
    command(
        "applications/<uuid:pk>/disburse/",
        "LoanDisburse",
        VersionInput,
        lending_applications.disburse,
        SimulatedApplication,
        True,
    ),
    command(
        "loan-accounts/<uuid:pk>/repay/",
        "LoanRepay",
        RepaymentInput,
        lending_ledger.repay,
        LoanAccount,
        namespace="b-lending",
    ),
    command(
        "applications/<uuid:pk>/explain/",
        "LoanExplain",
        ExplanationInput,
        c_adapter.explain,
        SimulatedApplication,
    ),
]
