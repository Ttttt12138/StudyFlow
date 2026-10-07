"""Application decisions never change cash balances."""

from datetime import date

from sqlalchemy import select

from studyflow_backend.calculations import calculate
from studyflow_backend.errors import DomainError
from studyflow_backend.models import Application, Profile, Quote
from studyflow_backend.repository import assessment, owned
from studyflow_backend.transactions import audit, lock_wallet, require_version
from studyflow_backend.views import application_view, profile_view


def event(session, command, row, name, details=None):
    audit(
        session,
        command,
        {
            "student_id": row.student_id,
            "object_id": row.id,
            "event": name,
            "details": details or {},
        },
    )


def create_quote(session, command, body):
    lock_wallet(session, command.actor_id)
    if body.first_due_date <= command.now.date():
        raise DomainError("FIRST_DUE_DATE_NOT_FUTURE", 422)
    try:
        data = calculate(body)
    except ValueError as exc:
        raise DomainError(str(exc), 422) from exc
    row = Quote(student_id=command.actor_id, data=data, created_at=command.now)
    session.add(row)
    session.flush()
    event(session, command, row, "QUOTE_CREATED")
    return {"quote_id": row.id, **data, "assessment": assessment(session, row)}


def save_profile(session, command, body):
    wallet = lock_wallet(session, command.actor_id)
    row = session.get(Profile, command.actor_id)
    if (row.version if row else 0) != body.expected_version:
        raise DomainError("VERSION_CONFLICT")
    values = [m.model_dump(mode="json") for m in body.months]
    if row:
        row.months, row.version = values, row.version + 1
    else:
        row = Profile(student_id=command.actor_id, months=values, version=1)
        session.add(row)
    wallet.version += 1
    audit(
        session,
        command,
        {
            "student_id": command.actor_id,
            "object_id": command.actor_id,
            "event": "PROFILE_UPDATED",
            "details": {"version": row.version},
        },
    )
    return profile_view(row)


def create_application(session, command, body):
    wallet = lock_wallet(session, command.actor_id)
    quote = owned(session, Quote, body.quote_id, command.actor_id)
    if session.scalar(select(Application.id).where(Application.quote_id == quote.id)):
        raise DomainError("QUOTE_ALREADY_USED")
    ensure_future(quote, command)
    row = Application(student_id=command.actor_id, quote_id=quote.id, created_at=command.now)
    session.add(row)
    session.flush()
    wallet.version += 1
    event(session, command, row, "DRAFT_CREATED")
    return application_view(row)


def ensure_future(quote, command):
    if date.fromisoformat(quote.data["repayments"][0]["due_date"]) <= command.now.date():
        raise DomainError("QUOTE_EXPIRED")


def locked_application(session, application_id, student_id=None):
    row = owned(session, Application, application_id, student_id)
    wallet = lock_wallet(session, row.student_id)
    session.refresh(row)
    return row, wallet


def decide(session, command, row):
    quote = session.get(Quote, row.quote_id)
    ensure_future(quote, command)
    result = assessment(session, quote, row.id)
    row.assessment, row.profile_version = result, result["profile_version"]
    row.state = {
        "AFFORDABLE": "APPROVED",
        "UNAFFORDABLE": "REJECTED",
        "INSUFFICIENT_DATA": "UNDER_REVIEW",
    }[result["status"]]
    row.version += 1
    event(session, command, row, row.state, result)


def submit(session, command, application_id, body):
    row, wallet = locked_application(session, application_id, command.actor_id)
    require_version(row, body.expected_version)
    if row.state != "DRAFT":
        raise DomainError("INVALID_STATE")
    row.state = "SUBMITTED"
    event(session, command, row, "SUBMITTED")
    decide(session, command, row)
    wallet.version += 1
    return application_view(row)


def review(session, command, application_id, body):
    row, wallet = locked_application(session, application_id)
    require_version(row, body.expected_version)
    if row.state != "UNDER_REVIEW":
        raise DomainError("INVALID_STATE")
    event(session, command, row, "REVIEW_REQUESTED", {"reason": body.reason})
    decide(session, command, row)
    wallet.version += 1
    return application_view(row)


def cancel(session, command, application_id, body):
    row, wallet = locked_application(session, application_id, command.actor_id)
    require_version(row, body.expected_version)
    if row.state in {"DISBURSED", "CANCELLED"}:
        raise DomainError("INVALID_STATE")
    row.state, row.version = "CANCELLED", row.version + 1
    wallet.version += 1
    event(session, command, row, "CANCELLED")
    return application_view(row)
