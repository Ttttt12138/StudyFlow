from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.urls import path
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers as s
from rest_framework.response import Response
from rest_framework.views import APIView

from finance.throttles import ScopedThrottle, UserThrottle
from finance.workflow_common import require
from finance.workflow_api import CommandView
from finance.workflow_serializers import CommandResponse, Input

from . import catalog, conversation, services
from .models import ROLES, AgentConversation
from . import assessment
from .assessment_inputs import AssessmentInput, SubmitPlanningLoan

KEY = OpenApiParameter(name="Idempotency-Key", location=OpenApiParameter.HEADER, required=True, type=str)


def _locale(request, data):
    return data.get("locale") or ("zh" if getattr(request, "LANGUAGE_CODE", "").startswith("zh") else "en")


def _key(request):
    key = request.headers.get("Idempotency-Key", "")
    require(1 <= len(key) <= 100, "Idempotency-Key header (1-100 characters) is required.")
    return key


class PlanningProfileInput(Input):
    # role is legacy and optional; the product no longer asks who is planning.
    role = s.ChoiceField(choices=ROLES, required=False, allow_blank=True)
    # One of DISPLAY_CURRENCIES; services.set_profile rejects others with CURRENCY_NOT_SUPPORTED.
    home_currency = s.CharField(max_length=3, required=False)


class ProfileView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        user = request.user
        return Response({"data": {**services.profile_record(services.profile(user)),
                                  **services.plan_record(services.plan_for(user), services.home_currency(user)),
                                  "family": services.links(user), "is_simulated": True}})

    @extend_schema(request=PlanningProfileInput, responses=CommandResponse)
    def post(self, request):
        data = PlanningProfileInput(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            result = services.set_profile(request.user, data.validated_data)
        return Response({"data": result})


class DisplayRatesView(APIView):
    """Indicative THB rates the app uses to show amounts in THB, CNY or USD."""

    @extend_schema(responses=CommandResponse)
    def get(self, request):
        return Response({"data": services.display_rates()})


class SchoolListView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        home = services.home_currency(request.user)
        return Response({"data": {"schools": [services.school_brief(e, home) for e in catalog.schools()],
                                  "sample": True}})


class SchoolDetailView(APIView):
    @extend_schema(responses=CommandResponse, parameters=[
        OpenApiParameter("years", int, OpenApiParameter.QUERY, required=False)])
    def get(self, request, key):
        entry = services.entry_or_404(key)
        years = request.query_params.get("years")
        require(years is None or (years.isdigit() and 1 <= int(years) <= 6), "YEARS_OUT_OF_RANGE")
        return Response({"data": {"school": entry.model_dump(mode="json"),
                                  "estimate": services.estimate(entry, int(years) if years else None,
                                                                services.home_currency(request.user))}})


class FamilyLinkView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        return Response({"data": services.links(request.user)})

    @extend_schema(request=None, responses=CommandResponse, parameters=[
        OpenApiParameter("X-Sponsor-Token", str, OpenApiParameter.HEADER, required=True)])
    def post(self, request):
        with transaction.atomic():
            result = services.link_family(request.user, request.headers.get("X-Sponsor-Token"))
        return Response({"data": result}, status=201)


class ConversationInput(Input):
    locale = s.ChoiceField(choices=["zh", "en"], required=False)


class MessageInput(Input):
    text = s.CharField(max_length=2000)


class ConversationCollectionView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        rows = AgentConversation.objects.filter(owner=request.user).order_by("-updated_at")[:20]
        return Response({"data": [conversation.summary(row) for row in rows]})

    @extend_schema(request=ConversationInput, responses=CommandResponse, parameters=[KEY])
    def post(self, request):
        _key(request)
        data = ConversationInput(data=request.data)
        data.is_valid(raise_exception=True)
        item = conversation.start(request.user, _locale(request, data.validated_data))
        return Response({"data": conversation.conversation_record(item)}, status=201)


class ConversationDetailView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request, pk):
        item = get_object_or_404(AgentConversation, owner=request.user, pk=pk)
        return Response({"data": conversation.conversation_record(item)})


class ConversationOpenView(APIView):
    """Called when the app opens a conversation; the agent may speak first (enrollment)."""

    @extend_schema(request=None, responses=CommandResponse)
    def post(self, request, pk):
        item = get_object_or_404(AgentConversation, owner=request.user, pk=pk)
        conversation.open_conversation(item)
        return Response({"data": conversation.conversation_record(item)})


class MessageView(APIView):
    throttle_scope = "agent"

    def get_throttles(self):
        return [UserThrottle(), ScopedThrottle()]

    @extend_schema(request=MessageInput, responses=CommandResponse, parameters=[KEY])
    def post(self, request, pk):
        key = _key(request)
        item = get_object_or_404(AgentConversation, owner=request.user, pk=pk)
        data = MessageInput(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            turn, created = conversation.send(item, data.validated_data["text"], key)
        except IntegrityError:
            turn, created = conversation.send(item, data.validated_data["text"], key)
        require(turn.conversation_id == item.id and turn.goal == data.validated_data["text"],
                "Idempotency key was used with a different request.")
        return Response({"data": conversation.turn_record(turn)}, status=201 if created else 200)


urlpatterns = [
    path("planning/profile/", ProfileView.as_view()),
    path("planning/rates/", DisplayRatesView.as_view()),
    path("planning/schools/", SchoolListView.as_view()),
    path("planning/schools/<slug:key>/", SchoolDetailView.as_view()),
    path("planning/family-links/", FamilyLinkView.as_view()),
    path("agent/conversations/", ConversationCollectionView.as_view()),
    path("agent/conversations/<uuid:pk>/", ConversationDetailView.as_view()),
    path("agent/conversations/<uuid:pk>/open/", ConversationOpenView.as_view()),
    path("agent/conversations/<uuid:pk>/messages/", MessageView.as_view()),
]


class InSchoolView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        from . import in_school

        return Response({"data": {**in_school.summary(request.user),
                                  "bills": in_school.bills(request.user)}})


class ExpenseQuery(Input):
    month = s.CharField(required=False)
    offset = s.IntegerField(min_value=0, max_value=1000000, default=0)


class ExpenseView(APIView):
    @extend_schema(responses=CommandResponse, parameters=[
        OpenApiParameter("month", str, OpenApiParameter.QUERY, required=False),
        OpenApiParameter("offset", int, OpenApiParameter.QUERY, required=False)])
    def get(self, request):
        from . import in_school

        query = ExpenseQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response({"data": in_school.spending_page(request.user, **query.validated_data)})


def _expense(actor, data, obj=None):
    from . import in_school

    return in_school.record_expense(actor, data)


def _pay(actor, data, bill):
    from . import in_school

    return in_school.pay_bill(actor, data, bill)


def _commands():
    from finance.workflow_serializers import EmptyInput
    from finance.workflow_urls import command

    from .models import PlanBill
    from .tools import ExpenseInput
    from . import life_commands
    from .life_inputs import ReminderActionInput, StudyBudgetInput, StudyClockInput, StudyTaskInput, UndoExpenseInput

    return [command("planning/life/tasks/", "StudyTaskCreate", StudyTaskInput, life_commands.create_task),
            command("planning/life/clock/", "StudyClockAdvance", StudyClockInput, life_commands.advance_clock),
            command("planning/life/actions/", "StudyReminderAction", ReminderActionInput, life_commands.act),
            command("planning/life/budget/", "StudyBudgetSave", StudyBudgetInput, life_commands.save_budget),
            command("planning/life/undo-expense/", "StudyExpenseUndo", UndoExpenseInput, life_commands.undo_expense),
            command("planning/loan-applications/", "PlanningLoanSubmit", SubmitPlanningLoan, assessment.submit),
            command("planning/expenses/record/", "PlanningExpense", ExpenseInput, _expense),
            command("planning/bills/<uuid:pk>/pay/", "PlanningBillPay", EmptyInput, _pay, PlanBill)]


urlpatterns += [
    path("planning/in-school/", InSchoolView.as_view()),
    path("planning/expenses/", ExpenseView.as_view()),
    *_commands(),
]


class AssessmentView(CommandView):
    serializer_class = AssessmentInput
    handler = staticmethod(assessment.save)

    @extend_schema(responses=CommandResponse)
    def get(self, request):
        return Response({"data": assessment.read(request.user)})


# The combined read/write resource must precede the command route at the same path.
urlpatterns.insert(0, path("planning/assessment/", AssessmentView.as_view()))


class StudyLifeView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        from . import life
        return Response({"data": life.read(request.user)})


urlpatterns.append(path("planning/life/", StudyLifeView.as_view()))
