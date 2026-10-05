from studyflow_ai.readiness.api import ReadinessAI
from studyflow_ai.readiness.demo import DEMO_NOW, FixtureBackend, demo_draft


def test_readiness_cache_and_authoritative_loan_terms():
    backend = FixtureBackend()
    ai = ReadinessAI.mock(backend)
    first = ai.run_readiness_check("student_001", "import", DEMO_NOW)
    second = ai.run_readiness_check("student_001", "timer", DEMO_NOW)
    assert first.budget.gap.amount == 50000
    assert second.reused
    assert first.funding.loan_explanations[0].quote.net_proceeds.amount == 30000
    assert "无法判断还款能力" in first.funding.loan_explanations[0].message
    assert all(x.validation == "CONDITIONAL" for x in first.funding.candidates)


def test_model_failure_keeps_budget_and_retry_is_not_cached():
    from studyflow_ai.models import CallRecord
    from studyflow_ai.providers.base import ProviderFailure

    backend = FixtureBackend()
    ai = ReadinessAI.mock(backend)
    original = ai.provider.plan

    def fail(_):
        raise ProviderFailure(
            "TIMEOUT", CallRecord(provider="openai", purpose="plan", model="test", mode="live")
        )

    ai.provider.plan = fail
    result = ai.run_readiness_check("student_001", "timer", DEMO_NOW)
    assert result.budget.risks
    assert not backend.cache
    ai.provider.plan = original
    assert ai.run_readiness_check("student_001", "timer", DEMO_NOW).funding.candidates


def test_version_race_rechecks_once_then_marks_stale():
    backend = FixtureBackend()
    saves = []

    def race(key, result):
        saves.append(key)
        backend.state.state_version += 1
        return False

    backend.save_readiness_check = race
    result = ReadinessAI.mock(backend).run_readiness_check("student_001", "timer", DEMO_NOW)
    assert result.stale
    assert len(saves) == 2
    assert not backend.claims


def test_no_backend_still_allows_completeness():
    ai = ReadinessAI.mock()
    assert ai.assess_cost_completeness(demo_draft()).complete
    result = ai.run_readiness_check("student_001", "timer", DEMO_NOW)
    assert result.status == "NEEDS_REVIEW"
    assert result.budget is None


def test_simulated_approval_does_not_equal_receipt():
    backend = FixtureBackend()
    before = backend.demo_balance
    backend.set_demo_application_state("APPROVED")
    assert backend.demo_balance == before
    backend.set_demo_application_state("DISBURSED")
    assert backend.demo_balance == "170200.00"


def test_demo_links_extraction_evidence_and_rejects_mismatched_fees():
    from studyflow_ai.readiness.demo import OFFER, run_demo
    from studyflow_ai.readiness.models import ExtractionContext, MaterialSource

    backend = FixtureBackend()
    ai = ReadinessAI.mock(backend)
    result = run_demo(ai)
    assert result["material_linked"]
    assert backend.state.draft.profile.evidence
    other = ai.extract_semester_material(
        MaterialSource(source_id="x", kind="text", text=OFFER.replace("65000", "99999")),
        ExtractionContext(reference_date=DEMO_NOW.date()),
    )
    assert not FixtureBackend().supplement_demo_material(other.draft)
    backend.set_demo_application_state("DISBURSED")
    assert backend.demo_balance == "170200.00"
