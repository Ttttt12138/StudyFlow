from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from studyflow_ai.models import FinancialSnapshot, Forecast, PlanningContext, Risk
from studyflow_ai.planning import Planner
from studyflow_ai.providers.rules import RuleProvider


@pytest.fixture
def context():
    risk = Risk(risk_id="risk1", gap="9000", due_date="2026-10-15", source_refs=["tuition1"])
    return PlanningContext(
        snapshot=FinancialSnapshot(
            student_id="s",
            state_version=1,
            as_of="2026-10-02T20:00:00+07:00",
            balance="80000",
            minimum_reserve="15000",
        ),
        forecast=Forecast(
            state_version=1, projected_balance="6000", risks=[risk], funding_target="9000"
        ),
        risk=risk,
        now=datetime(2026, 10, 2, 20, tzinfo=ZoneInfo("Asia/Bangkok")),
    )


def test_candidate_is_pending_without_backend(context):
    result = Planner(RuleProvider()).generate_plans(context)
    assert result.plans[0].required_funding == Decimal("9000")
    assert result.plans[0].validation == "PENDING"
    assert result.state_version == 1


def test_buffer_only_comes_from_backend(context):
    context.forecast.buffer = Decimal("1000")
    context.forecast.funding_target = Decimal("10000")
    result = Planner(RuleProvider()).generate_plans(context)
    assert "1000.00" in result.plans[0].explanation


def test_no_plan_for_past_deadline(context):
    context.now = datetime(2026, 10, 20, tzinfo=ZoneInfo("Asia/Bangkok"))
    result = Planner(RuleProvider()).generate_plans(context)
    assert not result.plans
    assert result.issues[0].code == "DEADLINE_PASSED"


def test_hallucinated_reference_rejected(context):
    class BadModel(RuleProvider):
        def plan(self, context):
            output, record = super().plan(context)
            output.plans[0].source_refs = ["invented"]
            return output, record

    result = Planner(BadModel()).generate_plans(context)
    assert result.plans[0].validation == "INVALID"


def test_wrong_target_rejected(context):
    class BadModel(RuleProvider):
        def plan(self, context):
            output, record = super().plan(context)
            output.plans[0].required_funding = "10000"
            return output, record

    assert Planner(BadModel()).generate_plans(context).plans[0].validation == "INVALID"
