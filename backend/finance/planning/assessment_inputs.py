from rest_framework import serializers as s

from finance.workflow_serializers import Input


def amount(**kwargs):
    return s.DecimalField(max_digits=16, decimal_places=2, min_value=0, **kwargs)


class SupportInput(Input):
    id = s.SlugField(max_length=60)
    amount = amount()
    currency = s.CharField(max_length=3)
    available_on = s.DateField(allow_null=True)
    confirmed = s.BooleanField(default=False)
    included_in_funds = s.BooleanField(default=False)


class RepaymentChange(Input):
    month = s.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$")
    income = amount(allow_null=True, required=False)
    living_expenses = amount(allow_null=True, required=False)
    existing_repayments = amount(allow_null=True, required=False)


class PlanningRecurringInput(Input):
    income = amount(allow_null=True, default=None)
    living_expenses = amount(allow_null=True, default=None)
    existing_repayments = amount(allow_null=True, default=None)
    from_month = s.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$", allow_blank=True, default="")
    to_month = s.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$", allow_blank=True, default="")
    changes = RepaymentChange(many=True, default=list)

    def validate(self, data):
        if bool(data["from_month"]) != bool(data["to_month"]) or data["from_month"] > data["to_month"]:
            raise s.ValidationError("REPAYMENT_MONTH_RANGE_INVALID")
        months = [c["month"] for c in data["changes"]]
        if len(months) != len(set(months)) or len(months) > 120:
            raise s.ValidationError("REPAYMENT_CHANGES_INVALID")
        return data


class LoanTermsInput(Input):
    product = s.ChoiceField(choices=["custom", "commercial_student_demo"], default="custom")
    principal = amount(allow_null=True, default=None)
    annual_rate = s.DecimalField(max_digits=9, decimal_places=8, min_value=0, max_value=1, default="0.06")
    fees = amount(default="0.00")
    first_due_date = s.DateField()
    periods = s.ListField(child=s.IntegerField(min_value=1, max_value=60), min_length=1,
                         max_length=3, default=lambda: [48, 24])


class CostOverrideInput(Input):
    cost_id = s.SlugField(max_length=60)
    amount = amount(allow_null=True, required=False)
    due_date = s.DateField(allow_null=True, required=False)
    paid = s.BooleanField(default=False)


class AssessmentDetails(Input):
    available_funds = amount(allow_null=True)
    funds_currency = s.CharField(max_length=3)
    reserve = amount(allow_null=True)
    as_of = s.DateField()
    horizon = s.ChoiceField(choices=[30, 60, 90], default=90)
    payment_date = s.DateField(allow_null=True, default=None)
    supports = SupportInput(many=True, default=list)
    costs = CostOverrideInput(many=True, default=list)
    repayment = PlanningRecurringInput()
    loan = LoanTermsInput()

    def validate(self, data):
        for name, key in (("supports", "id"), ("costs", "cost_id")):
            ids = [r[key] for r in data[name]]
            if len(ids) != len(set(ids)) or len(ids) > 40:
                raise s.ValidationError("DUPLICATE_OR_EXCESS_PLANNING_ITEMS")
        return data


class AssessmentInput(Input):
    expected_version = s.IntegerField(min_value=0)
    plan_version = s.IntegerField(min_value=1)
    inputs = AssessmentDetails()
    draft = s.BooleanField(default=False)


class SubmitPlanningLoan(Input):
    expected_version = s.IntegerField(min_value=1)
    plan_version = s.IntegerField(min_value=1)
    quote_id = s.UUIDField()
