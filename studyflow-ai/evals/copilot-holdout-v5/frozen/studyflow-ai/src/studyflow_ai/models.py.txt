"""Versioned integration contracts. Monetary JSON values are decimal strings."""

from datetime import date as Date
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    model_validator,
)


def money(value: Decimal) -> Decimal:
    try:
        valid = value.is_finite() and value == value.quantize(Decimal("0.01"))
    except InvalidOperation:
        valid = False
    if not valid:
        raise ValueError("Money must be finite with at most two decimal places")
    return value.quantize(Decimal("0.01"))


Money = Annotated[
    Decimal,
    AfterValidator(money),
    PlainSerializer(lambda v: f"{v:.2f}", return_type=str, when_used="json"),
]
Category = Literal["tuition", "rent", "utility", "family_support", "living", "other", "irrelevant"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Status(StrEnum):
    READY = "READY"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    REJECTED = "REJECTED"


class Envelope(Contract):
    schema_version: Literal["1.0"] = "1.0"
    trace_id: str = Field(default_factory=lambda: uuid4().hex)
    source_refs: list[str] = Field(default_factory=list)
    status: Status = Status.READY


class Issue(Contract):
    code: str
    field: str | None = None
    locator: str | None = None
    message: str


class Evidence(Contract):
    source_id: str
    field: str
    quote: str
    locator: str


class Source(Contract):
    source_id: str
    kind: Literal["csv", "email", "pdf"]
    text: str | None = None
    path: str | None = None


class IngestContext(Contract):
    student_id: str = "student_001"
    reference_date: Date
    verified_source_ids: list[str] = Field(default_factory=list)
    verification_reference: str | None = None
    known_beneficiaries: list[str] = Field(default_factory=list)


class Transaction(Contract):
    transaction_id: str | None = None
    source_id: str = ""
    locator: str = ""
    account_id: str
    date: Date
    amount: Money
    currency: Literal["THB"] = "THB"
    counterparty: str
    description: str
    status: Status = Status.READY
    issues: list[Issue] = Field(default_factory=list)


class CandidateEvent(Contract):
    candidate_id: str = Field(default_factory=lambda: uuid4().hex)
    category: Category
    amount: Money | None = None
    currency: str | None = None
    date: Date | None = None
    due_date: Date | None = None
    counterparty: str | None = None
    invoice_id: str | None = None
    confidence_type: Literal["VERIFIED", "INFERRED", "UNCONFIRMED"] = "UNCONFIRMED"
    verification_reference: str | None = None
    status: Status = Status.NEEDS_REVIEW
    evidence: list[Evidence] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)

    @model_validator(mode="after")
    def verified_has_basis(self):
        if self.confidence_type == "VERIFIED" and not self.verification_reference:
            raise ValueError("VERIFIED requires a verification reference")
        return self


class CallRecord(Contract):
    provider: str
    purpose: Literal["classify", "extract", "plan"]
    model: str
    mode: Literal["mock", "live", "rules"]
    prompt_version: str = "1.0"
    duration_ms: float = 0
    input_tokens: int = 0
    output_tokens: int = 0
    attempts: int = 1
    error_code: str | None = None
    request_id: str | None = None


class Classification(Contract):
    category: Category
    probabilities: dict[str, float]
    confidence: float | None = None
    financial_relevance: float = Field(ge=0, le=1)
    anomaly: float = Field(ge=0, le=1)
    needs_planning: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def valid_probabilities(self):
        values = list(self.probabilities.values())
        if not values or any(not 0 <= p <= 1 for p in values):
            raise ValueError("Invalid category probabilities")
        if abs(sum(values) - 1) > 0.01 or self.category not in self.probabilities:
            raise ValueError("Incomplete category distribution")
        if self.probabilities[self.category] < max(values):
            raise ValueError("Selected category must maximize probability")
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("Invalid confidence")
        return self


class RouteContext(Contract):
    text: str = ""
    source_refs: list[str] = Field(default_factory=list)
    state_version: int | None = None
    needs_extraction: bool = False
    issues: list[Issue] = Field(default_factory=list)
    deterministic_risk: bool = False
    financial_clues: bool = False


class RouteResult(Envelope):
    state_version: int | None = None
    action: Literal["REVIEW", "PLAN", "EXTRACT", "PROCESS", "SKIP"]
    reasons: list[str]
    classification: Classification | None = None
    calls: list[CallRecord] = Field(default_factory=list)


class IngestResult(Envelope):
    candidates: list[CandidateEvent] = Field(default_factory=list)
    transactions: list[Transaction] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)
    calls: list[CallRecord] = Field(default_factory=list)
    routing: RouteResult | None = None


class RecurringObligation(Envelope):
    account_id: str
    category: Literal["rent", "other", "mobile", "subscription", "transport", "utilities"]
    counterparty: str
    amount: Money
    currency: Literal["THB"] = "THB"
    frequency: Literal["monthly"] = "monthly"
    expected_next_date: Date
    confidence_type: Literal["INFERRED"] = "INFERRED"
    supporting_transaction_ids: list[str]
    rule_version: str = "monthly-1.1"
    basis: str


class Obligation(Contract):
    obligation_id: str
    amount: Money
    due_date: Date
    category: Category


class FinancialSnapshot(Contract):
    student_id: str
    state_version: int = Field(ge=0)
    as_of: AwareDatetime
    balance: Money
    minimum_reserve: Money
    obligations: list[Obligation] = Field(default_factory=list)


class Risk(Contract):
    risk_id: str
    kind: str = "liquidity_shortfall"
    gap: Money
    due_date: Date
    source_refs: list[str]


class Forecast(Contract):
    state_version: int
    projected_balance: Money
    risks: list[Risk]
    buffer: Money = Decimal("0")
    funding_target: Money


class PlanningContext(Contract):
    snapshot: FinancialSnapshot
    forecast: Forecast
    risk: Risk
    now: AwareDatetime
    installment_confirmed: bool = False
    reducible_spending: Money | None = None

    @model_validator(mode="after")
    def matching_versions(self):
        if self.snapshot.state_version != self.forecast.state_version:
            raise ValueError("Snapshot and forecast versions differ")
        if self.risk not in self.forecast.risks:
            raise ValueError("Risk must belong to the forecast")
        return self


class PlanStep(Contract):
    action: str
    by_date: Date


class CandidatePlan(Contract):
    plan_id: str = Field(default_factory=lambda: uuid4().hex)
    kind: Literal["family_support", "installment", "reduce_spending"]
    required_funding: Money
    steps: list[PlanStep] = Field(min_length=1)
    prerequisites: list[str]
    source_refs: list[str] = Field(min_length=1)
    explanation: str
    validation: Literal["PENDING", "CONDITIONAL", "VALID", "INVALID", "STALE"] = "PENDING"
    issues: list[Issue] = Field(default_factory=list)


class PlanResult(Envelope):
    state_version: int
    plans: list[CandidatePlan] = Field(default_factory=list, max_length=3)
    calls: list[CallRecord] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)


class CheckResult(Envelope):
    state_version: int
    checked_at: AwareDatetime
    risks: list[Risk]
    routes: list[RouteResult] = Field(default_factory=list)
    planning: list[PlanResult] = Field(default_factory=list)
    reused: bool = False
    stale: bool = False


class AuditEvent(Contract):
    trace_id: str
    event: str
    timestamp: AwareDatetime
    state_version: int | None = None
    source_refs: list[str] = Field(default_factory=list)
    details: dict = Field(default_factory=dict)
