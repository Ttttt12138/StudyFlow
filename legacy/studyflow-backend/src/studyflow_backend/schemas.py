"""HTTP inputs. Decimal amounts deliberately reject JSON floating point numbers."""

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer, model_validator


def exact_number(value):
    if isinstance(value, (float, bool)):
        raise ValueError("Use a decimal string, not a floating point number")
    return value


Amount = Annotated[
    Decimal,
    BeforeValidator(exact_number),
    Field(ge=0, max_digits=18, decimal_places=2, allow_inf_nan=False),
    PlainSerializer(lambda value: format(value, ".2f"), return_type=str, when_used="json"),
]
Rate = Annotated[
    Decimal,
    BeforeValidator(exact_number),
    Field(ge=0, le=1, max_digits=9, decimal_places=8, allow_inf_nan=False),
]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class QuoteInput(Input):
    currency: Literal["THB"] = "THB"
    principal: Amount = Field(gt=0)
    annual_rate: Rate = Field(description="Fraction: 0.12 means 12% nominal annual interest")
    fees: Amount
    months: int = Field(ge=1, le=60, strict=True)
    first_due_date: date

    @model_validator(mode="after")
    def validate_terms(self):
        if self.fees >= self.principal:
            raise ValueError("Fees must be smaller than principal")
        if self.first_due_date.year > 9993:
            raise ValueError("Date exceeds schedule range")
        return self


class MonthBudget(Input):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    income: Amount | None = None
    living_expenses: Amount | None = None
    existing_repayments: Amount | None = None


class ProfileInput(Input):
    expected_version: int = Field(ge=0, strict=True)
    months: list[MonthBudget] = Field(max_length=120)

    @model_validator(mode="after")
    def unique_months(self):
        if len({m.month for m in self.months}) != len(self.months):
            raise ValueError("Duplicate budget month")
        return self


class ApplicationInput(Input):
    quote_id: str = Field(min_length=1, max_length=36)


class VersionInput(Input):
    expected_version: int = Field(ge=1, strict=True)


class ReviewInput(VersionInput):
    reason: str = Field(min_length=1, max_length=500)


class RepayInput(VersionInput):
    installment_number: int = Field(ge=1, le=60)


class TopupInput(VersionInput):
    student_id: str = Field(min_length=1, max_length=100)
    amount: Amount = Field(gt=0)
    reason: str = Field(min_length=1, max_length=500)
