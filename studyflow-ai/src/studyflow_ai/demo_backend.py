"""IN-MEMORY DEMO ONLY. This is not B's production financial engine or database."""

from datetime import datetime
from decimal import Decimal
from threading import RLock
from zoneinfo import ZoneInfo

from studyflow_ai.models import (
    AuditEvent,
    FinancialSnapshot,
    Forecast,
    Obligation,
    PlanningContext,
    Risk,
    Status,
)
from studyflow_ai.privacy import redact
from studyflow_ai.validation import candidate_key, issue, transaction_key

DEMO_NOW = datetime(2026, 10, 2, 20, tzinfo=ZoneInfo("Asia/Bangkok"))


class DemoBackend:
    def __init__(self, seeded=True):
        self.state = FinancialSnapshot(
            student_id="student_001",
            state_version=1,
            as_of=DEMO_NOW,
            balance="80000",
            minimum_reserve="15000",
            obligations=[],
        )
        if seeded:
            self.state.obligations = [
                Obligation(
                    obligation_id="rent_oct", amount="9000", due_date="2026-10-05", category="rent"
                ),
                Obligation(
                    obligation_id="tuition_oct",
                    amount="65000",
                    due_date="2026-10-15",
                    category="tuition",
                ),
            ]
        self.checks, self.claims, self.receipts = {}, set(), set()
        self.imported, self.transactions, self.audits = set(), [], []
        self.lock = RLock()

    def read_state(self, student_id):
        if student_id != self.state.student_id:
            raise KeyError("Unknown demo student")
        with self.lock:
            return self.state.model_copy(deep=True)

    def forecast(self, snapshot, now):
        # A deliberately simplified fixture: unpaid obligations only, no production accounting.
        projected = snapshot.balance - sum((o.amount for o in snapshot.obligations), Decimal("0"))
        gap = max(Decimal("0"), snapshot.minimum_reserve - projected)
        risks = []
        if gap and snapshot.obligations:
            due = max(o.due_date for o in snapshot.obligations)
            risks = [
                Risk(
                    risk_id="liquidity_demo",
                    gap=gap,
                    due_date=due,
                    source_refs=[o.obligation_id for o in snapshot.obligations],
                )
            ]
        return Forecast(
            state_version=snapshot.state_version,
            projected_balance=projected,
            risks=risks,
            funding_target=gap,
        )

    def planning_context(self, snapshot, forecast, risk, now):
        return PlanningContext(snapshot=snapshot, forecast=forecast, risk=risk, now=now)

    def validate_plan(self, plan, context):
        result = plan.model_copy(deep=True)
        result.validation = "CONDITIONAL"
        if context.snapshot.state_version != self.state.state_version:
            result.validation = "STALE"
        if (
            plan.kind == "reduce_spending"
            and (context.reducible_spending or 0) < plan.required_funding
        ):
            result.validation = "INVALID"
            result.issues.append(issue("INSUFFICIENT_VERIFIED_SPENDING"))
        if plan.kind == "installment" and not context.installment_confirmed:
            result.issues.append(issue("INSTALLMENT_NOT_CONFIRMED"))
        return result

    def accept_import(self, student_id, result):
        self.read_state(student_id)
        if result.status != Status.READY or any(
            x.status != Status.READY for x in [*result.candidates, *result.transactions]
        ):
            raise ValueError("Import is not ready")
        with self.lock:
            changed = self._import_candidates(result.candidates)
            for tx in result.transactions:
                identity = ("transaction", transaction_key(tx)[0])
                if identity not in self.imported:
                    self.imported.add(identity)
                    self.transactions.append(tx.model_copy(deep=True))
                    changed = True
            if changed:
                self.state.state_version += 1
            return self.state.state_version

    def _import_candidates(self, candidates):
        changed = False
        for event in candidates:
            identity = ("candidate", candidate_key(event)[0])
            if identity in self.imported:
                continue
            self.imported.add(identity)
            changed = True
            if event.category != "family_support":
                self.state.obligations.append(
                    Obligation(
                        obligation_id=event.candidate_id,
                        amount=event.amount,
                        due_date=event.due_date,
                        category=event.category,
                    )
                )
        return changed

    def add_demo_recurring(self, recurring):
        if recurring.status != Status.READY:
            raise ValueError("Recurring candidate requires review")
        with self.lock:
            self.state.obligations.append(
                Obligation(
                    obligation_id="rent_oct",
                    category="rent",
                    amount=recurring.amount,
                    due_date=recurring.expected_next_date,
                )
            )
            self.state.state_version += 1

    def record_demo_receipt(self, receipt_id, amount):
        with self.lock:
            if receipt_id not in self.receipts:
                value = Decimal(amount)
                if not value.is_finite() or value <= 0:
                    raise ValueError("Invalid simulated receipt")
                self.state.balance += value
                self.state.state_version += 1
                self.receipts.add(receipt_id)

    def get_check(self, key):
        with self.lock:
            result = self.checks.get(key)
            return result.model_copy(deep=True) if result else None

    def claim_check(self, key):
        with self.lock:
            if key in self.claims or key in self.checks:
                return False
            self.claims.add(key)
            return True

    def release_check(self, key):
        with self.lock:
            self.claims.discard(key)

    def save_check(self, key, result):
        with self.lock:
            if result.state_version != self.state.state_version:
                return False
            self.checks[key] = result.model_copy(deep=True)
            self.audits.append(
                AuditEvent(
                    trace_id=result.trace_id,
                    event="check_saved",
                    timestamp=result.checked_at,
                    state_version=result.state_version,
                    source_refs=result.source_refs,
                    details=redact(result.model_dump(mode="json")),
                )
            )
            self.claims.discard(key)
            return True

    def audit(self, event):
        with self.lock:
            self.audits.append(event.model_copy(deep=True))
