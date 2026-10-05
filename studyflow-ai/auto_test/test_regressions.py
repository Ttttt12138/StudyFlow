from datetime import date

import pytest
from pydantic import ValidationError

from studyflow_ai.api import StudyFlowAI
from studyflow_ai.demo_backend import DEMO_NOW, DemoBackend
from studyflow_ai.models import CallRecord, CandidateEvent, Evidence, IngestContext, Source
from studyflow_ai.providers.base import ProviderFailure
from studyflow_ai.providers.rules import RuleProvider
from studyflow_ai.validation import evidence_matches


def test_oversized_money_reports_validation_error():
    with pytest.raises(ValidationError):
        CandidateEvent(category="tuition", amount="1e100")


def test_thousands_grouping_cannot_change_amount_silently():
    text = 'account_id,date,amount,currency,counterparty,description\na,2026-09-05,"1,2,3",THB,Shop,food'
    ai = StudyFlowAI(RuleProvider(), RuleProvider())
    result = ai.ingest(
        Source(source_id="x", kind="csv", text=text),
        IngestContext(reference_date=date(2026, 10, 2)),
    )
    assert result.status == "NEEDS_REVIEW"
    assert not result.transactions


def test_explicit_english_date_evidence_is_supported():
    evidence = Evidence(source_id="s", field="due_date", quote="October 15, 2026", locator="line:1")
    assert evidence_matches(date(2026, 10, 15), evidence, "Due October 15, 2026")


def test_document_model_failure_retains_error():
    class Broken(RuleProvider):
        def extract(self, text):
            record = CallRecord(
                provider="openai", purpose="extract", model="m", mode="live", error_code="TIMEOUT"
            )
            raise ProviderFailure("TIMEOUT", record)

    ai = StudyFlowAI(RuleProvider(), Broken())
    result = ai.ingest(
        Source(source_id="s", kind="email", text="Tuition THB 65000"),
        IngestContext(reference_date=date(2026, 10, 2)),
    )
    assert result.status == "NEEDS_REVIEW"
    assert result.calls[-1].error_code == "TIMEOUT"


def test_failed_planning_does_not_poison_daily_cache():
    class Flaky(RuleProvider):
        broken = True

        def plan(self, context):
            if self.broken:
                raise ProviderFailure(
                    "TIMEOUT",
                    CallRecord(
                        provider="openai",
                        purpose="plan",
                        model="m",
                        mode="live",
                        error_code="TIMEOUT",
                    ),
                )
            return super().plan(context)

    model = Flaky()
    ai = StudyFlowAI(RuleProvider(), model, DemoBackend())
    failed = ai.run_check("student_001", "manual", DEMO_NOW)
    assert failed.risks and not failed.planning[0].plans
    model.broken = False
    recovered = ai.run_check("student_001", "manual", DEMO_NOW)
    assert not recovered.reused and recovered.planning[0].plans
