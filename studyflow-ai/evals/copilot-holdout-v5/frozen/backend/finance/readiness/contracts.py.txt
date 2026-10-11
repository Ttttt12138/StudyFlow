from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator
from studyflow_ai.models import Contract
from studyflow_ai.readiness.models import CostItem, SemesterProfile

from finance.lending_core.schemas import Amount


class Profile(SemesterProfile):
    city: str | None = None
    semester: str | None = None
    lifestyle_profile: str | None = None


class PlannedOverride(Contract):
    effective_on: date
    amount: Amount = Field(le=Decimal("99999999999999.99"))


class Cost(CostItem):
    locked: bool = False
    cost_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    component: str | None = None
    observed_at: datetime | None = None
    verified_at: datetime | None = None
    planned_overrides: list[PlannedOverride] = Field(
        default_factory=list, max_length=24
    )
    valid_until: date | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    synthetic: bool = False
    conflict: bool = False
    alternatives: list[dict] = Field(default_factory=list)
    issuer: str | None = None
    beneficiary_id: UUID | None = None
    fx_quote_id: UUID | None = None

    @field_validator("amount", "lower", "upper")
    @classmethod
    def supported_amount(cls, value):
        if value is not None and Decimal(value) > Decimal("99999999999999.99"):
            raise ValueError("Amount exceeds shared monetary precision")
        return value


class Draft(Contract):
    profile: Profile
    costs: list[Cost] = Field(max_length=100)
    reserve: str | None = None
    required_categories: list[str] = Field(default_factory=list)

    @field_validator("reserve")
    @classmethod
    def reserve_money(cls, value):
        if value is not None:
            amount = Decimal(value)
            if (
                not amount.is_finite()
                or amount < 0
                or amount != amount.quantize(Decimal(".01"))
            ):
                raise ValueError("Reserve must be a nonnegative exact THB amount")
        return value

    @model_validator(mode="after")
    def valid_period(self):
        if any(cost.category == "reserve" for cost in self.costs):
            raise ValueError("Use top-level reserve; it is not a spending item")
        if not self.profile.start_date or not self.profile.end_date:
            raise ValueError("Confirm semester start and end")
        if (self.profile.end_date - self.profile.start_date).days > 730:
            raise ValueError("Semester exceeds 730 days")
        ids = [c.cost_id for c in self.costs]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate cost IDs")
        return self


class PaymentPart(Contract):
    date: date
    amount: str


class FundingAction(Contract):
    kind: Literal["installment", "reduce_spending"]
    cost_id: str
    amount: str | None = None
    payments: list[PaymentPart] = Field(default_factory=list, max_length=60)
    evidence: str = Field(min_length=1, max_length=2000)


class Allocation(Contract):
    source_id: UUID
    amount: str
    fx_quote_id: UUID | None = None
