from datetime import datetime
from typing import Protocol

from studyflow_ai.models import AuditEvent
from studyflow_ai.readiness.models import (
    BudgetSnapshot,
    FundingCandidate,
    FundingContext,
    ReadinessResult,
    ReadinessState,
)


class ReadinessBackendPort(Protocol):
    def read_readiness_state(self, student_id: str) -> ReadinessState: ...
    def calculate_budget(self, state: ReadinessState, now: datetime) -> BudgetSnapshot: ...
    def funding_context(
        self, state: ReadinessState, budget: BudgetSnapshot, now: datetime
    ) -> FundingContext: ...
    def validate_funding(
        self, candidate: FundingCandidate, context: FundingContext
    ) -> FundingCandidate: ...
    def get_readiness_check(self, key: str) -> ReadinessResult | None: ...
    def claim_readiness_check(self, key: str) -> bool: ...
    def release_readiness_check(self, key: str) -> None: ...
    def save_readiness_check(self, key: str, result: ReadinessResult) -> bool:
        """CAS both versions, persist result/audit/outbox and release claim atomically."""
        ...

    def audit(self, event: AuditEvent) -> None: ...
