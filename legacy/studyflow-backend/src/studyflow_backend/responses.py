"""Public response contracts for A's generated clients and OpenAPI documentation."""

from datetime import date, datetime
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

from studyflow_backend.schemas import MonthBudget, QuoteInput

Money = Annotated[str, Field(pattern=r"^-?\d+\.\d{2}$")]
T = TypeVar("T")


class Simulated(BaseModel):
    simulated: Literal[True] = True


class Assessment(BaseModel):
    status: Literal["AFFORDABLE", "UNAFFORDABLE", "INSUFFICIENT_DATA"]
    missing_inputs: list[str]
    shortfall_months: list[str]
    profile_version: int


class ScheduledRepayment(BaseModel):
    number: int
    due_date: date
    principal: Money
    interest: Money
    amount: Money
    remaining_principal: Money


class QuoteResult(Simulated):
    quote_id: str
    currency: Literal["THB"]
    principal: Money
    net_proceeds: Money
    fees: Money
    total_interest: Money
    total_repayment: Money
    repayments: list[ScheduledRepayment]
    terms: QuoteInput
    assessment: Assessment | None = None


class ProfileResult(Simulated):
    version: int
    months: list[MonthBudget]


class ApplicationResult(Simulated):
    application_id: str
    quote_id: str
    state: Literal[
        "DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED", "DISBURSED"
    ]
    version: int
    profile_version: int
    assessment: Assessment | dict


class AdminApplicationResult(ApplicationResult):
    student_id: str


class InstallmentResult(BaseModel):
    number: int
    due_date: date
    principal: Money
    interest: Money
    amount: Money
    status: Literal["PAID", "OVERDUE", "UNPAID"]
    paid_at: datetime | None


class LoanResult(Simulated):
    loan_id: str
    application_id: str
    status: Literal["ACTIVE", "CLOSED"]
    outstanding_principal: Money
    version: int
    currency: Literal["THB"]
    disbursed_at: datetime
    installments: list[InstallmentResult]


class WalletResult(Simulated):
    student_id: str
    balance: Money
    currency: Literal["THB"]
    version: int


class LedgerResult(Simulated):
    entry_id: str
    sequence: int
    kind: Literal["DISBURSEMENT", "REPAYMENT", "TOPUP"]
    reference: str
    amount: Money
    balance_after: Money
    reason: str
    created_at: datetime


class DisbursementResult(Simulated):
    application: ApplicationResult
    loan: LoanResult | None
    wallet: WalletResult | None = None


class RepaymentResult(Simulated):
    loan: LoanResult
    wallet: WalletResult


class Page(Simulated, Generic[T]):
    items: list[T]
    limit: int
    offset: int
    has_more: bool


class ErrorDetail(BaseModel):
    code: str


class ErrorResult(Simulated):
    error: ErrorDetail
    trace_id: str
