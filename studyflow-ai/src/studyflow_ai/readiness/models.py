from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal
from uuid import uuid4

from babel.numbers import get_currency_precision, list_currencies
from pydantic import AwareDatetime, Field, field_serializer, field_validator, model_validator

from studyflow_ai.models import CallRecord, Contract, Evidence, Issue, Status

Category = Literal[
    "tuition",
    "housing",
    "deposit",
    "food",
    "transport",
    "communications",
    "subscription",
    "utilities",
    "insurance",
    "visa",
    "travel",
    "settlement",
    "reserve",
]
CATEGORIES = list(Category.__args__)
Trust = Literal["VERIFIED", "INFERRED", "UNCONFIRMED"]


def currency_code(value):
    if value not in list_currencies() or value in {"XXX", "XTS"}:
        raise ValueError("Unsupported currency code")
    return value


def validate_amount(value, currency):
    try:
        number = Decimal(value)
        unit = Decimal(1).scaleb(-get_currency_precision(currency))
        if not number.is_finite() or number < 0 or number != number.quantize(unit):
            raise ValueError("Invalid amount or currency precision")
        return number.quantize(unit)
    except (InvalidOperation, TypeError):
        raise ValueError("Invalid amount") from None


class MoneyValue(Contract):
    currency: str
    amount: Decimal

    _currency = field_validator("currency")(currency_code)

    @model_validator(mode="after")
    def precision(self):
        validate_amount(self.amount, self.currency)
        return self

    @field_serializer("amount")
    def serialize_amount(self, value):
        return f"{value:.{get_currency_precision(self.currency)}f}"


class Result(Contract):
    schema_version: Literal["2.0"] = "2.0"
    trace_id: str = Field(default_factory=lambda: uuid4().hex)
    source_refs: list[str] = Field(default_factory=list)
    status: Status = Status.READY
    issues: list[Issue] = Field(default_factory=list)


class MaterialSource(Contract):
    source_id: str
    kind: Literal["text", "pdf", "url"]
    text: str | None = None
    path: str | None = None
    url: str | None = None


class ExtractionContext(Contract):
    reference_date: date
    language: str = "en"
    student_id: str = "student_001"


class Provenance(Contract):
    source_id: str
    final_url: str | None = None
    fetched_at: AwareDatetime
    content_sha256: str
    media_type: str


class SemesterProfile(Contract):
    school: str | None = None
    campus: str | None = None
    country: str | None = None
    program: str | None = None
    student_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    evidence: list[Evidence] = Field(default_factory=list)

    @model_validator(mode="after")
    def ordered_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("Semester end precedes start")
        return self


class CostItem(Contract):
    cost_id: str = Field(default_factory=lambda: uuid4().hex)
    component: str | None = None
    category: Category
    currency: str | None = None
    amount: str | None = None
    lower: str | None = None
    upper: str | None = None
    period: Literal["once", "monthly", "semester", "yearly"] | None = None
    due_date: date | None = None
    year: int | None = Field(default=None, ge=1900, le=2200)
    campus: str | None = None
    paid: bool | None = None
    refundable: bool | None = None
    invoice_id: str | None = None
    applicability: Literal["APPLICABLE", "NOT_APPLICABLE"] = "APPLICABLE"
    applicability_reason: str | None = None
    confidence_type: Trust = "UNCONFIRMED"
    verification_reference: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)

    @field_validator("amount", "lower", "upper")
    @classmethod
    def valid_numeric_text(cls, value):
        if value is not None:
            try:
                number = Decimal(value)
                if not number.is_finite() or number < 0:
                    raise ValueError("Invalid cost amount")
            except InvalidOperation:
                raise ValueError("Invalid cost amount") from None
        return value

    @model_validator(mode="after")
    def valid_cost(self):
        if self.confidence_type == "VERIFIED" and not self.verification_reference:
            raise ValueError("VERIFIED needs a verification reference")
        if self.applicability == "NOT_APPLICABLE" and not self.applicability_reason:
            raise ValueError("Not applicable needs a reason")
        if self.currency:
            currency_code(self.currency)
        for value in (self.amount, self.lower, self.upper):
            if value is not None:
                number = Decimal(value)
                if not number.is_finite() or number < 0:
                    raise ValueError("Invalid cost")
                if self.currency:
                    validate_amount(value, self.currency)
        if self.lower is not None and self.upper is not None:
            if Decimal(self.lower) > Decimal(self.upper):
                raise ValueError("Invalid range")
            if self.amount is not None and not Decimal(self.lower) <= Decimal(
                self.amount
            ) <= Decimal(self.upper):
                raise ValueError("Base amount outside range")
        return self


class SemesterDraft(Contract):
    profile: SemesterProfile = Field(default_factory=SemesterProfile)
    costs: list[CostItem] = Field(default_factory=list)
    provenance: list[Provenance] = Field(default_factory=list)


class ExtractionResult(Result):
    draft: SemesterDraft = Field(default_factory=SemesterDraft)
    route: Literal["EXTRACT", "REVIEW"] = "EXTRACT"
    calls: list[CallRecord] = Field(default_factory=list)


class CategoryCoverage(Contract):
    category: Category
    state: Literal["Known", "Estimated", "Missing"]
    cost_ids: list[str]
    applicable: bool


class CompletenessResult(Result):
    complete: bool = False
    categories: list[CategoryCoverage] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)


class CurrencyPair(Contract):
    base: str
    quote: str
    _base = field_validator("base")(currency_code)
    _quote = field_validator("quote")(currency_code)


class FxQuote(Contract):
    pair: CurrencyPair
    rate: Decimal = Field(gt=0, allow_inf_nan=False)
    rate_date: date
    fetched_at: AwareDatetime
    source: str
    manual: bool = False
    basis: str | None = None
    stale: bool = False

    @model_validator(mode="after")
    def manual_basis(self):
        if self.manual and not self.basis:
            raise ValueError("Manual rate requires a basis")
        return self


class FxRequest(Contract):
    pairs: list[CurrencyPair] = Field(min_length=1, max_length=30)
    as_of: date
    manual_quotes: list[FxQuote] = Field(default_factory=list)

    @field_validator("manual_quotes")
    @classmethod
    def explicit_manual_basis(cls, quotes):
        if any(not q.manual or not q.basis for q in quotes):
            raise ValueError("Manual overrides require manual=true and a basis")
        return quotes


class FxResult(Result):
    quotes: list[FxQuote] = Field(default_factory=list)


class VersionedResult(Result):
    state_version: int | None = None
    budget_version: int | None = None


class PaymentPoint(Contract):
    date: date
    required: MoneyValue
    gap: MoneyValue


class BudgetSnapshot(Contract):
    state_version: int = Field(ge=1)
    budget_version: int = Field(ge=1)
    report_currency: str
    complete: bool
    low: MoneyValue
    base: MoneyValue
    high: MoneyValue
    gap: MoneyValue
    payment_points: list[PaymentPoint]
    risks: list[str]
    assumptions: list[str]
    fx_quotes: list[FxQuote] = Field(default_factory=list)

    _currency = field_validator("report_currency")(currency_code)

    @model_validator(mode="after")
    def consistent_currency(self):
        values = [self.low, self.base, self.high, self.gap]
        values += [m for p in self.payment_points for m in (p.required, p.gap)]
        if any(v.currency != self.report_currency for v in values):
            raise ValueError("Budget amounts must use report currency")
        if not self.low.amount <= self.base.amount <= self.high.amount:
            raise ValueError("Budget scenarios out of order")
        return self


class FundingSource(Contract):
    funding_id: str
    kind: Literal["existing_liquid_funds", "family_support", "scholarship", "installment", "reduce_spending", "borrowing"]
    allocatable: MoneyValue
    available_date: date | None
    conditions: list[str]
    received: bool = False
    loan_quote_id: str | None = None


class Repayment(Contract):
    due_date: date
    amount: MoneyValue


class LoanQuote(Contract):
    quote_id: str
    principal: MoneyValue
    net_proceeds: MoneyValue
    fees: MoneyValue
    total_interest: MoneyValue
    repayments: list[Repayment]
    affordability: Literal["AFFORDABLE", "UNAFFORDABLE", "INSUFFICIENT_DATA"]
    missing_inputs: list[str]
    conditions: list[str]

    @model_validator(mode="after")
    def quote_consistency(self):
        values = [self.net_proceeds, self.fees, self.total_interest] + [
            r.amount for r in self.repayments
        ]
        if any(v.currency != self.principal.currency for v in values):
            raise ValueError("Loan quote currencies differ")
        days = [r.due_date for r in self.repayments]
        if days != sorted(set(days)):
            raise ValueError("Repayments must have distinct ordered dates")
        if self.affordability == "AFFORDABLE" and (self.missing_inputs or not self.repayments):
            raise ValueError("Incomplete inputs cannot establish affordability")
        return self


class ApplicationSnapshot(Contract):
    application_id: str
    quote_id: str
    state: Literal[
        "DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED", "DISBURSED"
    ]
    simulated: Literal[True] = True


class FundingActionOption(Contract):
    action_id: str
    kind: Literal["installment", "reduce_spending"]
    cost_id: str
    conditions: list[str] = Field(default_factory=list)


class FundingContext(Contract):
    student_id: str
    now: AwareDatetime
    budget: BudgetSnapshot
    sources: list[FundingSource]
    loan_quotes: list[LoanQuote]
    applications: list[ApplicationSnapshot] = Field(default_factory=list)
    actions: list[FundingActionOption] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_identifiers(self):
        for items, key in ((self.sources, "funding_id"), (self.loan_quotes, "quote_id")):
            ids = [getattr(x, key) for x in items]
            if len(ids) != len(set(ids)):
                raise ValueError("Duplicate funding/quote ID")
        quotes = {q.quote_id for q in self.loan_quotes}
        if any(s.loan_quote_id and s.loan_quote_id not in quotes for s in self.sources):
            raise ValueError("Unknown loan quote")
        if any(s.kind == "borrowing" and not s.loan_quote_id for s in self.sources):
            raise ValueError("Borrowing source requires a quote")
        if any(a.quote_id not in quotes for a in self.applications):
            raise ValueError("Application references an unknown quote")
        if len({a.action_id for a in self.actions}) != len(self.actions):
            raise ValueError("Duplicate action ID")
        return self


class Allocation(Contract):
    funding_id: str
    amount: MoneyValue


class FundingCandidate(Contract):
    candidate_id: str = Field(default_factory=lambda: uuid4().hex)
    allocations: list[Allocation]
    action_ids: list[str] = Field(default_factory=list)
    source_refs: list[str]
    conditions: list[str]
    explanation: str
    validation: Literal["PENDING", "CONDITIONAL", "VALID", "INVALID", "STALE"] = "PENDING"
    issues: list[Issue] = Field(default_factory=list)
    borrowing_net: MoneyValue | None = None
    financing_cost: MoneyValue | None = None
    remaining_gap: MoneyValue | None = None


class LoanExplanation(Contract):
    quote: LoanQuote
    message: str


class FundingResult(VersionedResult):
    candidates: list[FundingCandidate] = Field(default_factory=list, max_length=3)
    loan_explanations: list[LoanExplanation] = Field(default_factory=list)
    applications: list[ApplicationSnapshot] = Field(default_factory=list)
    application_notes: list[str] = Field(default_factory=list)
    calls: list[CallRecord] = Field(default_factory=list)


class ReadinessState(Contract):
    student_id: str
    state_version: int
    budget_version: int
    draft: SemesterDraft


class ReadinessResult(VersionedResult):
    completeness: CompletenessResult | None = None
    budget: BudgetSnapshot | None = None
    funding: FundingResult | None = None
    reused: bool = False
    stale: bool = False
