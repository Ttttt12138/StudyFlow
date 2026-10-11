"""One transaction owns the command, immutable audit, and durable replay result."""

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select, text

from studyflow_backend.errors import DomainError
from studyflow_backend.models import Audit, Idempotency, Wallet


@dataclass(frozen=True)
class Command:
    actor_id: str
    operation: str
    key: str
    body: dict
    now: datetime
    trace_id: str


def digest_request(command):
    data = json.dumps([command.operation, command.body], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()


def serialize_key(session, command):
    raw = hashlib.sha256(f"{command.actor_id}:{command.key}".encode()).digest()[:8]
    lock_id = int.from_bytes(raw, "big", signed=True)
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})


def execute(factory, command, action):
    with factory.begin() as session:
        serialize_key(session, command)
        previous = session.get(Idempotency, (command.actor_id, command.key))
        request_hash = digest_request(command)
        if previous:
            if previous.request_hash != request_hash:
                raise DomainError("IDEMPOTENCY_CONFLICT")
            return previous.response
        result = action(session)
        session.add(
            Idempotency(
                actor_id=command.actor_id,
                key=command.key,
                request_hash=request_hash,
                response=result,
                created_at=command.now,
            )
        )
        return result


def lock_wallet(session, student_id):
    wallet = session.scalar(
        select(Wallet)
        .where(
            Wallet.student_id == student_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if wallet is None:
        raise DomainError("NOT_FOUND", 404)
    return wallet


def require_version(record, expected):
    if record.version != expected:
        raise DomainError("VERSION_CONFLICT")


def audit(session, command, event):
    session.add(
        Audit(
            actor_id=command.actor_id,
            student_id=event["student_id"],
            event=event["event"],
            object_id=event["object_id"],
            details=event.get("details", {}),
            created_at=command.now,
            trace_id=command.trace_id,
        )
    )
