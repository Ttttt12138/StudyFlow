from django.db import models
from django.db.models import Q

from finance.models import OwnedRecord

ROLES = ["parent", "student"]
# The product no longer asks who is planning; the column is kept so existing rows stay valid.
DISPLAY_CURRENCIES = ("THB", "CNY", "USD")
PLAN_STATUSES = ["DRAFT", "CONFIRMED"]


class PlanningProfile(OwnedRecord):
    """Account preferences for planning: the display currency (role is optional legacy data)."""
    role = models.CharField(max_length=10, blank=True, default="", choices=[(r, r.title()) for r in ROLES])
    home_currency = models.CharField(max_length=3, default="THB")
    demo_date = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner"], name="planning_profile_one_per_owner"),
            models.CheckConstraint(condition=Q(role__in=["", *ROLES]), name="planning_profile_role_valid"),
        ]


class StudyPlan(OwnedRecord):
    """The school chosen in the planning conversation; CONFIRMED once its loan application is submitted."""
    school_key = models.CharField(max_length=60)
    catalog_version = models.PositiveIntegerField()
    years = models.FloatField(default=1)  # half-year steps, e.g. 3.5
    loan = models.ForeignKey("finance.LoanSimulation", null=True, blank=True, on_delete=models.PROTECT)
    # The school's tuition account (planning/payees.py); payments to the school need it verified.
    school_payee = models.ForeignKey("finance.Beneficiary", null=True, blank=True, on_delete=models.PROTECT,
                                     related_name="+")
    status = models.CharField(max_length=10, default="DRAFT",
                              choices=[(s, s.title()) for s in PLAN_STATUSES])
    # Cost breakdown frozen when the plan is confirmed; the catalog may change later.
    snapshot = models.JSONField(default=dict)
    start_date = models.DateField()
    confirmed_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner"], name="study_plan_one_per_owner"),
            models.CheckConstraint(condition=Q(status__in=PLAN_STATUSES), name="study_plan_status_valid"),
            models.CheckConstraint(condition=Q(years__gte=1, years__lte=6), name="study_plan_years_range"),
        ]


class PlanningAssessment(OwnedRecord):
    """An immutable revision of declared planning inputs, separate from the wallet."""
    plan = models.ForeignKey(StudyPlan, on_delete=models.PROTECT, related_name="assessments")
    version = models.PositiveIntegerField()
    plan_version = models.PositiveIntegerField()
    inputs = models.JSONField(default=dict)
    result = models.JSONField(default=dict)

    class Meta:
        ordering = ["-version"]
        constraints = [models.UniqueConstraint(fields=["plan", "version"], name="planning_assessment_revision")]


class AgentConversation(OwnedRecord):
    """A multi-turn chat; each user message runs as one AgentSession (a turn)."""
    locale = models.CharField(max_length=2, choices=[("zh", "Chinese"), ("en", "English")])
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


BILL_KINDS = ["tuition", "housing", "insurance", "visa", "loan", "other"]
BILL_STATUSES = ["DUE", "PAID"]


class PlanBill(OwnedRecord):
    """A fixed payment generated from the plan when it is confirmed together with the loan application."""
    plan = models.ForeignKey(StudyPlan, on_delete=models.PROTECT, related_name="bills")
    kind = models.CharField(max_length=10, choices=[(k, k.title()) for k in BILL_KINDS])
    source_id = models.CharField(max_length=60)
    label = models.JSONField(default=dict)
    due_date = models.DateField()
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3)
    status = models.CharField(max_length=4, default="DUE", choices=[(s, s.title()) for s in BILL_STATUSES])
    paid_at = models.DateTimeField(null=True, blank=True)
    # The demo date it was paid on; the credit record compares it with `due_date`.
    paid_on = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["due_date", "kind", "source_id"]
        constraints = [
            models.UniqueConstraint(fields=["plan", "source_id"], name="plan_bill_source_unique"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="plan_bill_positive_amount"),
            models.CheckConstraint(condition=Q(status__in=BILL_STATUSES), name="plan_bill_status_valid"),
        ]


class PlanDraft(OwnedRecord):
    """A school the student chose, kept so they can switch back to it (planning/drafts.py keeps the latest three)."""
    school_key = models.CharField(max_length=60)
    years = models.FloatField()
    # The assessment inputs last used with this school: the borrower and the loan picked.
    inputs = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [models.UniqueConstraint(fields=["owner", "school_key"], name="plan_draft_one_per_school")]


PAYOUT_STATUSES = ["SCHEDULED", "PAID"]


class LoanPayout(OwnedRecord):
    """One tranche of a signed planning loan, paid to the school for one plan bill on its due date (simulated).

    Amounts are THB (the loan's currency); `bill_amount` is what it settles in the bill's own currency."""
    plan = models.ForeignKey(StudyPlan, on_delete=models.PROTECT, related_name="payouts")
    application = models.ForeignKey("finance.SimulatedApplication", on_delete=models.PROTECT, related_name="payouts")
    bill = models.OneToOneField(PlanBill, on_delete=models.PROTECT, related_name="payout")
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    bill_amount = models.DecimalField(max_digits=16, decimal_places=2)
    due_date = models.DateField()
    status = models.CharField(max_length=10, default="SCHEDULED", choices=[(s, s.title()) for s in PAYOUT_STATUSES])
    paid_on = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["due_date", "created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="loan_payout_positive_amount"),
            models.CheckConstraint(condition=Q(status__in=PAYOUT_STATUSES), name="loan_payout_status_valid"),
        ]


class StudyTask(OwnedRecord):
    plan = models.ForeignKey(StudyPlan, on_delete=models.PROTECT)
    title = models.CharField(max_length=200)
    due_date = models.DateField(null=True, blank=True)
    amount = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default="THB")
    source_text = models.TextField(blank=True)
    # Set for checklist items seeded from the school's country template (planning/checklist.py).
    template_key = models.CharField(max_length=60, blank=True)
    done = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(amount__isnull=True) | Q(amount__gte=0), name="study_task_amount_nonnegative")]


class ReminderPreference(OwnedRecord):
    source_key = models.CharField(max_length=100)
    snoozed_until = models.DateField(null=True, blank=True)
    due_override = models.DateField(null=True, blank=True)
    # The amount on the school's actual notice, replacing the catalog estimate of a bill or task.
    amount_override = models.DecimalField(max_digits=16, decimal_places=2, null=True, blank=True)
    seen_token = models.CharField(max_length=64, blank=True)
    version = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "source_key"], name="reminder_preference_unique")]
