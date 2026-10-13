"""School catalog for the planning conversation (product docs: docs/agent-first.md).

Each school is one JSON file in ``catalog/``. Figures are real-school references taken from
public sources and shown to users as sample data: they are not a quote or an invoice.
"""

import json
from datetime import date
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, HttpUrl, model_validator
from studyflow_ai.models import Contract

DIRECTORY = Path(__file__).with_name("catalog")

CostCategory = Literal[
    "tuition", "housing", "deposit", "food", "transport", "communications",
    "insurance", "visa", "travel", "settlement", "study_materials",
]
Period = Literal["once", "semester", "year", "month"]
# How many times each period occurs in one academic year (two semesters).
PER_YEAR = {"once": 0, "semester": 2, "year": 1, "month": 12}
ESSENTIAL = ("tuition", "housing", "food", "insurance", "visa")
Decimal2 = str


def _money(value):
    if value is None:
        return value
    amount = Decimal(value)
    if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal(".01")):
        raise ValueError("Money must be a nonnegative decimal string with two places")
    return value


class Text(Contract):
    en: str = Field(min_length=1, max_length=300)
    zh: str = Field(min_length=1, max_length=300)


class School(Contract):
    name: Text
    country: Text
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    city: Text
    campus: str | None = None
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    program: Text
    language: str = Field(max_length=40)
    website: HttpUrl
    # Typical length of the bachelor's programme; estimates default to it.
    duration_years: int | None = Field(default=None, ge=1, le=6)
    duration_months: int | None = Field(default=None, ge=1, le=72)
    total_semesters: int | None = Field(default=None, ge=1, le=24)


class Calendar(Contract):
    intake: str = Field(pattern=r"^\d{4}-\d{2}$")
    start_date: date
    end_date: date
    # Some programmes (e.g. PSU Phuket FIS) run three semesters a year.
    semesters_per_year: int = Field(default=2, ge=1, le=3)
    source_url: HttpUrl | None = None

    @model_validator(mode="after")
    def ordered(self):
        if self.end_date <= self.start_date:
            raise ValueError("Calendar ends before it starts")
        return self


class Cost(Contract):
    cost_id: str = Field(pattern=r"^[a-z0-9_]+$", max_length=60)
    category: CostCategory
    label: Text
    period: Period
    amount: Decimal2 | None = None
    lower: Decimal2 | None = None
    upper: Decimal2 | None = None
    estimate: bool
    status: Literal["known", "estimated", "missing"] | None = None
    year_amounts: list[Decimal2] = Field(default_factory=list, max_length=6)
    course_total: Decimal2 | None = None
    due_date: date | None = None
    start_month: int = Field(default=0, ge=0, le=71)
    source_url: HttpUrl | None = None
    quote: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def valid_amounts(self):
        for value in (self.amount, self.lower, self.upper, self.course_total, *self.year_amounts):
            _money(value)
        if self.status == "missing":
            if self.year_amounts or any(v is not None for v in (self.amount, self.lower, self.upper, self.course_total)):
                raise ValueError("Missing costs cannot carry amounts")
            return self
        if self.amount is None and (self.lower is None or self.upper is None):
            raise ValueError(f"{self.cost_id}: give amount or both lower and upper")
        if self.lower is not None and self.upper is not None and Decimal(self.lower) > Decimal(self.upper):
            raise ValueError(f"{self.cost_id}: lower exceeds upper")
        if not self.estimate and (self.source_url is None or not self.quote):
            raise ValueError(f"{self.cost_id}: a sourced figure needs source_url and quote")
        return self

    def typical(self):
        if self.amount is not None:
            return Decimal(self.amount)
        return ((Decimal(self.lower) + Decimal(self.upper)) / 2).quantize(Decimal(".01"))


class Place(Contract):
    name: Text
    kind: str = Field(max_length=40)
    note: Text
    distance_km: float | None = Field(default=None, ge=0, le=500)
    typical_cost: Decimal2 | None = None
    source_url: HttpUrl | None = None

    @model_validator(mode="after")
    def valid_cost(self):
        _money(self.typical_cost)
        return self


class Source(Contract):
    url: HttpUrl
    title: str = Field(max_length=200)
    accessed: date


class Entry(Contract):
    key: str = Field(pattern=r"^[a-z0-9-]+$", max_length=60)
    version: int = Field(ge=1)
    sample: Literal[True] = True
    observed_at: date
    school: School
    calendar: Calendar
    costs: list[Cost] = Field(min_length=5, max_length=40)
    facilities: list[Place] = Field(min_length=3, max_length=12)
    food: list[Place] = Field(min_length=3, max_length=12)
    attractions: list[Place] = Field(min_length=3, max_length=12)
    sources: list[Source] = Field(min_length=1, max_length=30)
    notes: list[Text] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def complete(self):
        ids = [c.cost_id for c in self.costs]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate cost_id")
        missing = set(ESSENTIAL) - {c.category for c in self.costs}
        if missing:
            raise ValueError(f"Missing essential categories: {sorted(missing)}")
        return self


@lru_cache(maxsize=1)
def _load():
    entries = {}
    for path in sorted(DIRECTORY.glob("*.json")):
        entry = Entry.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if entry.key in entries:
            raise ValueError(f"Duplicate school key {entry.key}")
        entries[entry.key] = entry
    return entries


def schools():
    return list(_load().values())


def school(key):
    return _load().get(key)
