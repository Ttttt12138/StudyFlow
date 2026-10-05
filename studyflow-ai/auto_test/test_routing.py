import pytest

from studyflow_ai.models import Issue, RouteContext
from studyflow_ai.providers.rules import RuleProvider
from studyflow_ai.routing import Router


@pytest.mark.parametrize(
    "context,action",
    [
        (RouteContext(deterministic_risk=True), "PLAN"),
        (RouteContext(text="tuition invoice", needs_extraction=True), "EXTRACT"),
        (RouteContext(text="football club"), "SKIP"),
        (
            RouteContext(
                issues=[Issue(code="MISSING", message="missing")], deterministic_risk=True
            ),
            "REVIEW",
        ),
        (RouteContext(text="football club", financial_clues=True), "REVIEW"),
    ],
)
def test_routing_precedence(context, action):
    assert Router(RuleProvider()).route(context).action == action
