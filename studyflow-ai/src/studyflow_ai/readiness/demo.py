"""Fixed response fixtures only. Never a general-purpose financial calculator."""

from datetime import datetime
from threading import RLock
from zoneinfo import ZoneInfo

from studyflow_ai.readiness.completeness import issue
from studyflow_ai.readiness.models import (
    ApplicationSnapshot,
    BudgetSnapshot,
    CostItem,
    ExtractionContext,
    FundingContext,
    FundingSource,
    LoanQuote,
    MaterialSource,
    MoneyValue,
    PaymentPoint,
    ReadinessState,
    Repayment,
    SemesterDraft,
    SemesterProfile,
)

DEMO_NOW = datetime(2026, 10, 2, 20, tzinfo=ZoneInfo("Asia/Bangkok"))
OFFER = """School: Example University
Campus: Bangkok
Country: Thailand
Program: Computing
Student type: International
Start date: 2026-10-01
End date: 2027-01-31
Tuition: THB 65000; period=semester; year=2026; due_date=2026-10-15; paid=false
Housing: THB 8000-10000; period=monthly; year=2026
Food: THB 6000-10000; period=monthly; year=2026
Deposit: THB 9000; period=once; year=2026; refundable=true
"""


def thb(amount):
    return MoneyValue(currency="THB", amount=amount)


def demo_draft():
    profile = SemesterProfile(
        school="Example University",
        campus="Bangkok",
        country="Thailand",
        program="Computing",
        student_type="International",
        start_date="2026-10-01",
        end_date="2027-01-31",
    )
    values = {
        "tuition": ("65000", "semester"),
        "deposit": ("9000", "once"),
        "transport": ("2000", "monthly"),
        "communications": ("300", "monthly"),
        "utilities": ("1000", "monthly"),
        "insurance": ("2000", "semester"),
        "visa": ("2000", "once"),
        "travel": ("12000", "once"),
        "settlement": ("4000", "once"),
        "reserve": ("15000", "once"),
    }
    costs = [
        CostItem(
            cost_id=category,
            category=category,
            currency="THB",
            amount=value,
            period=period,
            year=2026,
            confidence_type="VERIFIED",
            verification_reference="demo-user-confirmation",
        )
        for category, (value, period) in values.items()
    ]
    for category, lower in [("housing", "8000"), ("food", "6000")]:
        costs.append(
            CostItem(
                cost_id=category,
                category=category,
                currency="THB",
                lower=lower,
                upper="10000",
                period="monthly",
                year=2026,
                confidence_type="INFERRED",
            )
        )
    return SemesterDraft(profile=profile, costs=costs)


def loan_fixture():
    # A zero-interest fixture with a deducted upfront fee; all numbers are pre-authored.
    dates = ["2026-11-01", "2026-12-01"] + [f"2027-{m:02d}-01" for m in range(1, 11)]
    return LoanQuote(
        quote_id="loan_demo",
        principal=thb("30600"),
        net_proceeds=thb("30000"),
        fees=thb("600"),
        total_interest=thb("0"),
        repayments=[Repayment(due_date=d, amount=thb("2550")) for d in dates],
        affordability="INSUFFICIENT_DATA",
        missing_inputs=["post-semester income", "living costs during repayment"],
        conditions=["SIMULATED fixed quote, not a lender offer", "Eligibility not confirmed"],
    )


class FixtureBackend:
    def __init__(self):
        self.state = ReadinessState(
            student_id="student_001", state_version=1, budget_version=1, draft=demo_draft()
        )
        self.cache, self.claims, self.audits = {}, set(), []
        self.application_state, self.demo_balance = "DRAFT", "140200.00"
        self.lock = RLock()

    def read_readiness_state(self, student_id):
        if student_id != self.state.student_id:
            raise KeyError("Unknown fixture student")
        return self.state.model_copy(deep=True)

    def supplement_demo_material(self, extracted):
        expected = demo_draft()
        if extracted.profile.model_dump(exclude={"evidence"}) != expected.profile.model_dump(
            exclude={"evidence"}
        ):
            return False
        for category in ("tuition", "housing", "food", "deposit"):
            actual = [c for c in extracted.costs if c.category == category]
            target = next(c for c in expected.costs if c.category == category)
            if len(actual) != 1:
                return False
            fields = ("currency", "amount", "lower", "upper", "period", "year")
            if any(getattr(actual[0], key) != getattr(target, key) for key in fields):
                return False
            target.evidence = actual[0].evidence
            target.source_refs = actual[0].source_refs
        expected.profile.evidence = extracted.profile.evidence
        expected.provenance = extracted.provenance
        self.state.draft = expected
        return True

    def calculate_budget(self, state, now):
        if _fixture_values(state.draft) != _fixture_values(demo_draft()):
            raise ValueError("Fixed fixture does not calculate arbitrary drafts")
        gap = "20000" if self.application_state == "DISBURSED" else "50000"
        return BudgetSnapshot(
            state_version=state.state_version,
            budget_version=state.budget_version,
            report_currency="THB",
            complete=True,
            low=thb("178200"),
            base=thb("190200"),
            high=thb("202200"),
            gap=thb(gap),
            payment_points=[
                PaymentPoint(
                    date="2026-10-15",
                    required=thb("170200"),
                    gap=thb("0" if self.application_state == "DISBURSED" else "30000"),
                ),
                PaymentPoint(date="2027-01-31", required=thb("190200"), gap=thb(gap)),
            ],
            risks=["FIXTURE_FUNDING_GAP"],
            assumptions=[
                "DEMO_ONLY: fixed B responses",
                "Four months; reserve included once",
                "No actual approval or payment",
            ],
        )

    def funding_context(self, state, budget, now):
        sources = [
            FundingSource(
                funding_id="family",
                kind="family_support",
                allocatable=thb("20000"),
                available_date="2026-10-03",
                conditions=["Sponsor agreement and actual receipt required"],
            )
        ]
        if self.application_state != "DISBURSED":
            sources.append(
                FundingSource(
                    funding_id="loan",
                    kind="borrowing",
                    allocatable=thb("30000"),
                    available_date="2026-10-04",
                    loan_quote_id="loan_demo",
                    conditions=["SIMULATED quote only", "Actual receipt and B validation required"],
                )
            )
        return FundingContext(
            student_id=state.student_id,
            now=now,
            budget=budget,
            sources=sources,
            loan_quotes=[loan_fixture()],
            applications=[
                ApplicationSnapshot(
                    application_id="demo_application",
                    quote_id="loan_demo",
                    state=self.application_state,
                )
            ],
        )

    def validate_funding(self, candidate, context):
        result = candidate.model_copy(deep=True)
        if (context.budget.state_version, context.budget.budget_version) != (
            self.state.state_version,
            self.state.budget_version,
        ):
            result.validation = "STALE"
        else:
            expected = {"family": thb("20000")}
            if self.application_state != "DISBURSED":
                expected["loan"] = thb("30000")
            actual = {a.funding_id: a.amount for a in result.allocations}
            result.validation = "CONDITIONAL" if actual == expected else "INVALID"
            if result.validation == "INVALID":
                result.issues.append(issue("NOT_A_SUPPORTED_FIXTURE_COMBINATION"))
        return result

    def get_readiness_check(self, key):
        with self.lock:
            return self.cache.get(key)

    def claim_readiness_check(self, key):
        with self.lock:
            if key in self.claims:
                return False
            self.claims.add(key)
            return True

    def release_readiness_check(self, key):
        with self.lock:
            self.claims.discard(key)

    def save_readiness_check(self, key, result):
        with self.lock:
            if (result.state_version, result.budget_version) != (
                self.state.state_version,
                self.state.budget_version,
            ):
                return False
            self.cache[key] = result.model_copy(deep=True)
            self.claims.discard(key)
            return True

    def audit(self, event):
        self.audits.append(event)

    def set_demo_application_state(self, state):
        allowed = {
            "DRAFT": "SUBMITTED",
            "SUBMITTED": "UNDER_REVIEW",
            "UNDER_REVIEW": "APPROVED",
            "APPROVED": "DISBURSED",
        }
        # APPROVED shortcut represents an external B response in isolated tests.
        if state == self.application_state:
            return
        if state != allowed.get(self.application_state) and not (
            self.application_state == "DRAFT" and state == "APPROVED"
        ):
            raise ValueError("Unsupported fixture transition")
        self.application_state = state
        self.state.state_version += 1
        if state == "DISBURSED":
            self.demo_balance = "170200.00"
            self.state.budget_version += 1


def run_demo(ai):
    backend = ai.backend
    extracted = ai.extract_semester_material(
        MaterialSource(source_id="offer_fixture", kind="text", text=OFFER),
        ExtractionContext(reference_date=DEMO_NOW.date()),
    )
    missing = ai.assess_cost_completeness(extracted.draft)
    material_linked = backend.supplement_demo_material(extracted.draft)
    # Explicit fixture of user corrections and supplemental costs, not inferred defaults.
    completed = ai.assess_cost_completeness(backend.state.draft)
    result = ai.run_readiness_check("student_001", "import", DEMO_NOW)
    repeated = ai.run_readiness_check("student_001", "timer", DEMO_NOW)
    transitions = []
    for state in ("SUBMITTED", "UNDER_REVIEW", "APPROVED", "DISBURSED"):
        backend.set_demo_application_state(state)
        transitions.append(
            {"state": state, "simulated": True, "demo_balance": backend.demo_balance}
        )
    after = ai.run_readiness_check("student_001", "receipt", DEMO_NOW)
    return {
        "material_linked": material_linked,
        "backend": "FIXTURE_ONLY",
        "integration_acceptance": False,
        "extraction": extracted.model_dump(mode="json"),
        "before_supplement": missing.model_dump(mode="json"),
        "after_explicit_demo_user_supplement": completed.model_dump(mode="json"),
        "check": result.model_dump(mode="json"),
        "repeat_reused": repeated.reused,
        "application_transitions": transitions,
        "after_simulated_receipt": after.model_dump(mode="json"),
        "audit": [a.model_dump(mode="json") for a in backend.audits],
    }


def _fixture_values(draft):
    return {
        "profile": draft.profile.model_dump(exclude={"evidence"}),
        "costs": [c.model_dump(exclude={"evidence", "source_refs"}) for c in draft.costs],
    }
