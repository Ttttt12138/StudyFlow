"""Strict structured outputs, without authority or database fields."""

from typing import Literal

from pydantic import Field

from studyflow_ai.models import Category, Contract


class ExtractedField(Contract):
    field: str
    quote: str
    locator: str


class ExtractedEvent(Contract):
    category: Category
    amount: str | None
    currency: str | None
    date: str | None
    due_date: str | None
    counterparty: str | None
    invoice_id: str | None
    evidence: list[ExtractedField]


class Extraction(Contract):
    events: list[ExtractedEvent]


class ProposedStep(Contract):
    action: str
    by_date: str


class ProposedPlan(Contract):
    kind: Literal["family_support", "installment", "reduce_spending"]
    required_funding: str
    steps: list[ProposedStep]
    prerequisites: list[str]
    source_refs: list[str]
    explanation: str


class Proposals(Contract):
    plans: list[ProposedPlan]


class CategoryProbabilities(Contract):
    tuition: float
    rent: float
    utility: float
    family_support: float
    living: float
    other: float
    irrelevant: float


class ClassificationOutput(Contract):
    category: Category
    probabilities: CategoryProbabilities
    financial_relevance: float
    anomaly: float
    instruction_risk: float = Field(ge=0, le=1)
    payment_conflict: float = Field(ge=0, le=1)
    needs_planning: float
