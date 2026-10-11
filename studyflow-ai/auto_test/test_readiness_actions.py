from datetime import datetime
from zoneinfo import ZoneInfo

from studyflow_ai.readiness.demo import FixtureBackend
from studyflow_ai.readiness.funding import check_allocations
from studyflow_ai.readiness.models import FundingActionOption, FundingCandidate


def context():
    backend = FixtureBackend()
    now = datetime(2026, 10, 2, 20, tzinfo=ZoneInfo("Asia/Bangkok"))
    state = backend.read_readiness_state("student_001")
    budget = backend.calculate_budget(state, now)
    return backend.funding_context(state, budget, now)


def test_non_cash_action_is_not_an_allocation():
    value = context()
    value.actions = [
        FundingActionOption(action_id="plan-1:0", kind="installment", cost_id="tuition")
    ]
    candidate = FundingCandidate(
        allocations=[],
        action_ids=["plan-1:0"],
        source_refs=["plan-1:0"],
        conditions=[],
        explanation="Use the verified school schedule",
    )
    assert not check_allocations(candidate, value)
    assert candidate.allocations == []


def test_unknown_and_duplicate_actions_rejected():
    value = context()
    candidate = FundingCandidate(
        allocations=[],
        action_ids=["invented", "invented"],
        source_refs=[],
        conditions=[],
        explanation="invalid",
    )
    assert "UNKNOWN_OR_DUPLICATE_ACTION" in {
        issue.code for issue in check_allocations(candidate, value)
    }


def test_empty_candidate_is_not_an_action():
    candidate = FundingCandidate(allocations=[], source_refs=[], conditions=[], explanation="empty")
    assert "EMPTY_CANDIDATE" in {issue.code for issue in check_allocations(candidate, context())}


def test_distinct_cost_components_may_have_different_applicability():
    from studyflow_ai.readiness.completeness import _conflicts
    from studyflow_ai.readiness.models import CostItem, SemesterProfile
    items = [CostItem(category="settlement", component="enrollment", amount="20000.00", year=2026),
             CostItem(category="settlement", component="card", applicability="NOT_APPLICABLE", applicability_reason="No card")]
    assert not _conflicts(items, SemesterProfile(start_date="2026-08-10"))
