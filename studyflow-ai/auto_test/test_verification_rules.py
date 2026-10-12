from datetime import date

import pytest

from studyflow_ai.ingestion import Ingestor
from studyflow_ai.models import IngestContext, Source
from studyflow_ai.providers.rules import RuleProvider, category_for


def candidate(text, verified=True):
    result = Ingestor(RuleProvider(), RuleProvider()).ingest(
        Source(source_id="reference", kind="email", text=text),
        IngestContext(
            reference_date=date(2026, 10, 2),
            verified_source_ids=["reference"] if verified else [],
            verification_reference="review:test" if verified else None,
        ),
    )
    return result.candidates[0]


@pytest.mark.parametrize("text,expected", [
    ("My brother promises THB 4200 on 2026-10-12", "family_support"),
    ("爸妈承诺于2026-10-12资助THB 4200", "family_support"),
    ("生鲜订单 THB 1250，2026-10-12货到付款", "living"),
    ("Room sublet THB 4200 due 2026-10-12", "rent"),
    ("同学转租，每月5386.75，首次付款日2026-10-12", "rent"),
    ("Insurance, this is not tuition. THB 4200 due 2026-10-12", "other"),
    ("Please pay water bill THB 4200 due 2026-10-12", "utility"),
    ("My brother scored 87.50 in a football game", "irrelevant"),
])
def test_semantic_categories(text, expected):
    assert category_for(text) == expected


@pytest.mark.parametrize("deadline", [
    "Cash on delivery, expected delivery 2026-10-12",
    "货到付款，预计2026-10-12送达",
    "If unpaid after 2026-10-12 service will be suspended",
    "2026-10-12之后未缴将停水",
    "Payment collected on pickup, pickup 2026-10-12",
    "2026-10-12取货时付款",
])
def test_indirect_date_never_auto_confirms_verified_source(deadline):
    event = candidate(f"Food THB 1250. {deadline}. Beneficiary: Campus Shop")
    assert event.due_date == date(2026, 10, 12)
    assert event.status == "NEEDS_REVIEW"
    assert event.confidence_type == "INFERRED"
    assert any(i.code == "INFERRED_DUE_DATE" and i.field == "due_date" for i in event.issues)
    assert event.evidence


def test_explicit_date_remains_confirmable():
    event = candidate("Tuition THB 1250 due 2026-10-12. Beneficiary: Campus")
    assert event.status == "READY"
    assert event.confidence_type == "VERIFIED"


def test_conflicting_dates_are_not_arbitrarily_selected():
    event = candidate("Tuition THB 1250 due 2026-10-12 or 2026-10-14. Beneficiary: Campus")
    assert event.due_date is None
    assert event.status == "NEEDS_REVIEW"
    assert any(i.code == "CONFLICTING_DUE_DATE" for i in event.issues)


def test_multi_event_dates_do_not_conflict_with_each_other():
    text = "Tuition THB 1250 due 2026-10-12. Beneficiary: Campus\nWater bill THB 350 due 2026-10-14. Beneficiary: Utilities"
    extraction, _ = RuleProvider().extract(text)
    assert [(x.category, x.due_date) for x in extraction.events] == [
        ("tuition", "2026-10-12"), ("utility", "2026-10-14")]


def test_missing_year_is_reviewed():
    event = candidate("Food THB 1250, cash on delivery October 12. Beneficiary: Shop")
    assert event.due_date is None
    assert event.status == "NEEDS_REVIEW"


def test_issue_date_alone_is_not_a_payment_deadline():
    event = candidate("Tuition THB 1250. Issued 2026-10-03. Beneficiary: Campus")
    assert event.due_date is None
    assert event.status == "NEEDS_REVIEW"


def test_explicit_due_date_wins_over_issue_date():
    event = candidate("Tuition THB 1250. Issued 2026-10-03; due 2026-10-12. Beneficiary: Campus")
    assert event.due_date == date(2026, 10, 12)
    assert event.status == "READY"


def test_repeated_conflicting_deadlines_are_reviewed():
    event = candidate("Tuition THB 1250. Due 2026-10-03; due 2026-10-12. Beneficiary: Campus")
    assert event.due_date is None
    assert event.status == "NEEDS_REVIEW"


def test_indirect_evaluation_checks_date_evidence_and_review():
    from studyflow_ai.api import StudyFlowAI
    from studyflow_ai.demo_backend import DemoBackend
    from studyflow_ai.evaluation import evaluate_case

    provider = RuleProvider()
    case = {
        "case_id": "indirect-regression", "category": "living", "important": True,
        "backend_risk": False, "expected_review": True,
        "text": "Food THB 1250. Cash on delivery, expected delivery 2026-10-12. Beneficiary: Campus Shop",
        "expected_events": [{"category": "living", "amount": "1250.00", "currency": "THB",
                             "due_date": "2026-10-12", "due_date_kind": "inferred"}],
    }
    row = evaluate_case(StudyFlowAI(provider, provider, DemoBackend()), case)
    assert row["date_safety_checks"] == 1
    assert row["date_safety_failures"] == 0
    assert not row["failure_reasons"]


def test_indirect_candidate_cannot_be_committed_for_payment():
    from studyflow_ai.demo_backend import DemoBackend
    from studyflow_ai.models import IngestResult

    event = candidate("Food THB 1250. Cash on delivery, expected delivery 2026-10-12. Beneficiary: Shop")
    backend = DemoBackend()
    before = backend.read_state("student_001").model_dump()
    with pytest.raises(ValueError, match="Import is not ready"):
        backend.accept_import("student_001", IngestResult(candidates=[event]))
    assert backend.read_state("student_001").model_dump() == before
