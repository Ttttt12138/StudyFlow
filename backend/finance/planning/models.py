from django.conf import settings
from django.db import models
from django.db.models import Q

from finance.models import OwnedRecord

ROLES = ["parent", "student"]
PLAN_STATUSES = ["DRAFT", "CONFIRMED", "ENROLLED"]


class PlanningProfile(OwnedRecord):
    """Who is using the account. One account plays one role (product decision B)."""
    role = models.CharField(max_length=10, choices=[(r, r.title()) for r in ROLES])
    home_currency = models.CharField(max_length=3, default="CNY")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner"], name="planning_profile_one_per_owner"),
            models.CheckConstraint(condition=Q(role__in=ROLES), name="planning_profile_role_valid"),
        ]


class StudyPlan(OwnedRecord):
    """The school chosen in the planning conversation and how it will be paid for."""
    school_key = models.CharField(max_length=60)
    catalog_version = models.PositiveIntegerField()
    years = models.PositiveSmallIntegerField(default=1)
    available_funds = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    funds_currency = models.CharField(max_length=3, blank=True)
    loan = models.ForeignKey("finance.LoanSimulation", null=True, blank=True, on_delete=models.PROTECT)
    status = models.CharField(max_length=10, default="DRAFT",
                              choices=[(s, s.title()) for s in PLAN_STATUSES])
    # Cost breakdown frozen when the plan is confirmed; the catalog may change later.
    snapshot = models.JSONField(default=dict)
    start_date = models.DateField()
    confirmed_at = models.DateTimeField(null=True, blank=True)
    enrolled_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner"], name="study_plan_one_per_owner"),
            models.CheckConstraint(condition=Q(status__in=PLAN_STATUSES), name="study_plan_status_valid"),
            models.CheckConstraint(condition=Q(years__gte=1, years__lte=6), name="study_plan_years_range"),
            models.CheckConstraint(condition=Q(available_funds__isnull=True) | Q(available_funds__gte=0),
                                   name="study_plan_funds_nonnegative"),
        ]


class FamilyLink(models.Model):
    """A parent account linked to a student account through a confirmed sponsor link."""
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="parent_links")
    parent = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="student_links")
    sponsor_request = models.ForeignKey("finance.SponsorRequest", on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["student", "parent"], name="family_link_unique_pair"),
            models.CheckConstraint(condition=~Q(student=models.F("parent")), name="family_link_distinct_accounts"),
        ]


class AgentConversation(OwnedRecord):
    """A multi-turn chat; each user message runs as one AgentSession (a turn)."""
    locale = models.CharField(max_length=2, choices=[("zh", "Chinese"), ("en", "English")])
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


BILL_KINDS = ["tuition", "housing", "insurance", "visa", "loan", "other"]
BILL_STATUSES = ["DUE", "PAID"]
EXPENSE_CATEGORIES = ["food", "transport", "housing", "study", "shopping", "fun", "health", "other"]


class PlanBill(OwnedRecord):
    """A fixed in-school payment generated from the confirmed plan when the student enrolls."""
    plan = models.ForeignKey(StudyPlan, on_delete=models.PROTECT, related_name="bills")
    kind = models.CharField(max_length=10, choices=[(k, k.title()) for k in BILL_KINDS])
    source_id = models.CharField(max_length=60)
    label = models.JSONField(default=dict)
    due_date = models.DateField()
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3)
    status = models.CharField(max_length=4, default="DUE", choices=[(s, s.title()) for s in BILL_STATUSES])
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["due_date", "kind", "source_id"]
        constraints = [
            models.UniqueConstraint(fields=["plan", "source_id"], name="plan_bill_source_unique"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="plan_bill_positive_amount"),
            models.CheckConstraint(condition=Q(status__in=BILL_STATUSES), name="plan_bill_status_valid"),
        ]


class ExpenseEntry(OwnedRecord):
    """Day-to-day spending the student records by form or by telling the agent."""
    spent_on = models.DateField()
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3)
    category = models.CharField(max_length=10, choices=[(c, c.title()) for c in EXPENSE_CATEGORIES])
    note = models.CharField(max_length=200, blank=True)
    via_agent = models.BooleanField(default=False)

    class Meta:
        ordering = ["-spent_on", "-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="expense_entry_positive_amount"),
            models.CheckConstraint(condition=Q(category__in=EXPENSE_CATEGORIES), name="expense_entry_category_valid"),
        ]
