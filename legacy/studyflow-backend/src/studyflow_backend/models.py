"""PostgreSQL storage. Business mutations are owned by transaction services."""

from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def identifier():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Actor(Base):
    __tablename__ = "actors"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    __table_args__ = (CheckConstraint("role IN ('student','admin')"),)


class Wallet(Base):
    __tablename__ = "wallets"
    student_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), primary_key=True)
    balance: Mapped[Decimal] = mapped_column(Numeric(20, 2), default=Decimal("0.00"))
    version: Mapped[int] = mapped_column(default=1)
    __table_args__ = (CheckConstraint("balance >= 0"), CheckConstraint("version >= 1"))


class Profile(Base):
    __tablename__ = "profiles"
    student_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), primary_key=True)
    months: Mapped[list] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(default=1)


class Quote(Base):
    __tablename__ = "quotes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    student_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), index=True)
    data: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Application(Base):
    __tablename__ = "applications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    student_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), index=True)
    quote_id: Mapped[str] = mapped_column(ForeignKey("quotes.id"), unique=True)
    state: Mapped[str] = mapped_column(String(20), default="DRAFT")
    version: Mapped[int] = mapped_column(default=1)
    assessment: Mapped[dict] = mapped_column(JSONB, default=dict)
    profile_version: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint(
            "state IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','CANCELLED','DISBURSED')"
        ),
    )


class Loan(Base):
    __tablename__ = "loans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id"), unique=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="ACTIVE")
    outstanding_principal: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    version: Mapped[int] = mapped_column(default=1)
    disbursed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        CheckConstraint("outstanding_principal >= 0"),
        CheckConstraint("status IN ('ACTIVE','CLOSED')"),
    )


class Installment(Base):
    __tablename__ = "installments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    loan_id: Mapped[str] = mapped_column(ForeignKey("loans.id"), index=True)
    number: Mapped[int]
    due_date: Mapped[date]
    principal: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    interest: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("loan_id", "number"),
        CheckConstraint("amount = principal + interest"),
        CheckConstraint("principal > 0 AND interest >= 0"),
    )


class Ledger(Base):
    __tablename__ = "ledger"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    sequence: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    reference: Mapped[str] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    balance_after: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    reason: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("kind", "reference"),
        CheckConstraint("balance_after >= 0"),
        CheckConstraint(
            "(kind = 'REPAYMENT' AND amount < 0) OR "
            "(kind IN ('DISBURSEMENT','TOPUP') AND amount > 0)"
        ),
    )


class Audit(Base):
    __tablename__ = "audit"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    actor_id: Mapped[str] = mapped_column(ForeignKey("actors.id"))
    student_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), index=True)
    event: Mapped[str] = mapped_column(String(100))
    object_id: Mapped[str] = mapped_column(String(100))
    details: Mapped[dict] = mapped_column(JSONB)
    trace_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Idempotency(Base):
    __tablename__ = "idempotency"
    actor_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
