from collections.abc import Mapping

from rest_framework import serializers as s

from finance.workflow_serializers import Input


TERMS = [24, 36, 48, 60]
BORROWERS = ["student_with_parent", "parent"]


def amount(**kwargs):
    return s.DecimalField(max_digits=16, decimal_places=2, min_value=0, **kwargs)


class LoanTermsInput(Input):
    product = s.ChoiceField(choices=["custom", "commercial_student_demo"], default="custom")
    # The amount the family types; null until they do (no quote is made without it).
    principal = amount(allow_null=True, default=None)
    annual_rate = s.DecimalField(max_digits=9, decimal_places=8, min_value=0, max_value=1, default="0.06")
    fees = amount(default="0.00")
    first_due_date = s.DateField()
    months = s.ChoiceField(choices=TERMS, default=48)
    # "interest_only": interest only while studying, then `months` equal installments (study loan only).
    method = s.ChoiceField(choices=["amortized", "interest_only"], default="amortized")
    # Kept so stored inputs from before single-term quotes still validate; no longer read.
    periods = s.ListField(child=s.IntegerField(min_value=1, max_value=60), min_length=1,
                         max_length=3, required=False)


class AssessmentDetails(Input):
    """Who borrows and the loan typed in the panel.

    Older clients may still send the retired funds, supports, costs or budget keys; they are dropped, not rejected."""
    loan = LoanTermsInput()
    # Who signs the simulated loan; it changes the wording and the income proof asked for.
    borrower = s.ChoiceField(choices=BORROWERS, default="student_with_parent")

    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            data = {k: v for k, v in data.items() if k in self.fields}
        return super().to_internal_value(data)


class AssessmentInput(Input):
    expected_version = s.IntegerField(min_value=0)
    plan_version = s.IntegerField(min_value=1)
    inputs = AssessmentDetails()
    draft = s.BooleanField(default=False)


class SubmitPlanningLoan(Input):
    expected_version = s.IntegerField(min_value=1)
    plan_version = s.IntegerField(min_value=1)
    quote_id = s.UUIDField()


class LoanPreviewInput(Input):
    """Instant repayment figures while the amount or term is being chosen; nothing is stored."""
    principal = amount()
    months = s.ChoiceField(choices=TERMS)
    product = s.ChoiceField(choices=["custom", "commercial_student_demo"], default="custom")
    method = s.ChoiceField(choices=["amortized", "interest_only"], default="amortized")


class LoanDocumentInput(Input):
    task_id = s.UUIDField()
    done = s.BooleanField()
    expected_version = s.IntegerField(min_value=1)


class SignPlanningLoan(Input):
    application_id = s.UUIDField()
    expected_version = s.IntegerField(min_value=1)


class ConfirmPlanningPlan(Input):
    """Confirm the plan and submit the simulated loan quoted in the current assessment, in one step."""
    expected_version = s.IntegerField(min_value=1)
    plan_version = s.IntegerField(min_value=1)
    quote_id = s.UUIDField()
