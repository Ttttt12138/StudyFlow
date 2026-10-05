from datetime import date
from io import BytesIO

import pytest
from pypdf import PdfWriter

from studyflow_ai.parsing import InputError
from studyflow_ai.readiness.api import ReadinessAI
from studyflow_ai.readiness.demo import DEMO_NOW, FixtureBackend
from studyflow_ai.readiness.materials import pdf_text
from studyflow_ai.readiness.models import CurrencyPair, ExtractionContext, FxRequest, MaterialSource
from studyflow_ai.readiness.web import SafeFetcher, WebResponse


@pytest.mark.parametrize("data,code", [(b"broken", "PDF_DAMAGED"), (None, "PDF_NO_TEXT_LAYER")])
def test_v2_pdf_errors(data, code):
    if data is None:
        writer, stream = PdfWriter(), BytesIO()
        writer.add_blank_page(100, 100)
        writer.write(stream)
        data = stream.getvalue()
    with pytest.raises(InputError, match=code):
        pdf_text(data)


def test_v2_text_pdf_keeps_school_and_fee_evidence():
    result = ReadinessAI.mock().extract_semester_material(
        MaterialSource(source_id="pdf", kind="pdf", path="examples/readiness/offer-en.pdf"),
        ExtractionContext(reference_date=date(2026, 10, 2)),
    )
    assert result.draft.profile.school == "Example University"
    assert next(c for c in result.draft.costs if c.category == "tuition").amount == "65000"


def test_html_text_provenance_and_no_script_extraction():
    class Fetcher:
        def fetch(self, url):
            return url, WebResponse(
                200,
                {"content-type": "text/html"},
                b"<h1>School: Actual</h1><script>School: Bad</script><p>Campus: Main</p>",
            )

    ai = ReadinessAI.mock()
    ai.extractor.fetcher = Fetcher()
    result = ai.extract_semester_material(
        MaterialSource(source_id="web", kind="url", url="https://example.test/fees"),
        ExtractionContext(reference_date=date(2026, 10, 2)),
    )
    assert result.draft.profile.school == "Actual"
    assert result.draft.provenance[0].final_url == "https://example.test/fees"
    assert len(result.draft.provenance[0].content_sha256) == 64
    assert all("Bad" not in e.quote for e in result.draft.profile.evidence)


def test_public_cross_domain_redirect_and_redirect_limit(monkeypatch):
    monkeypatch.setattr(
        "studyflow_ai.readiness.web.socket.getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )
    hits = []

    def send(target):
        hits.append(target.host)
        return (
            WebResponse(302, {"location": "https://b.example/fees"}, b"")
            if len(hits) == 1
            else WebResponse(200, {"content-type": "text/plain"}, b"fees")
        )

    url, _ = SafeFetcher(sender=send).fetch("https://a.example/start")
    assert hits == ["a.example", "b.example"]
    assert url == "https://b.example/fees"
    with pytest.raises(InputError, match="TOO_MANY_REDIRECTS"):
        SafeFetcher(sender=lambda _: WebResponse(302, {"location": "/again"}, b"")).fetch(url)


def test_same_currency_fx_does_not_need_network():
    from studyflow_ai.readiness.fx import FxAdapter

    result = FxAdapter(fetch_json=lambda _: pytest.fail("No FX needed")).fetch(
        FxRequest(pairs=[CurrencyPair(base="JPY", quote="JPY")], as_of=date(2026, 10, 2))
    )
    assert result.quotes[0].rate == 1
    assert result.status == "READY"


def test_manual_override_cannot_disguise_itself_as_automatic_quote():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        FxRequest(
            pairs=[CurrencyPair(base="USD", quote="THB")],
            as_of="2026-10-02",
            manual_quotes=[
                {
                    "pair": {"base": "USD", "quote": "THB"},
                    "rate": "35",
                    "rate_date": "2026-10-02",
                    "fetched_at": DEMO_NOW,
                    "source": "manual",
                }
            ],
        )


def test_complete_budget_still_requires_cost_year():
    from studyflow_ai.readiness.demo import demo_draft

    draft = demo_draft()
    draft.costs[0].year = None
    result = ReadinessAI.mock().assess_cost_completeness(draft)
    assert not result.complete
    assert any(i.code == "MISSING_APPLICABLE_YEAR" for i in result.issues)


def test_failed_persistence_keeps_computed_risk():
    backend = FixtureBackend()

    def fail(*args):
        raise ConnectionError("secret connection string")

    backend.save_readiness_check = fail
    result = ReadinessAI.mock(backend).run_readiness_check("student_001", "timer", DEMO_NOW)
    assert result.budget is not None and result.budget.risks
    assert "secret" not in result.model_dump_json()
    assert not backend.claims


def test_audit_outage_during_model_failure_keeps_budget():
    from studyflow_ai.models import CallRecord
    from studyflow_ai.providers.base import ProviderFailure

    backend = FixtureBackend()
    ai = ReadinessAI.mock(backend)

    def fail_model(_):
        raise ProviderFailure(
            "TIMEOUT", CallRecord(provider="openai", purpose="plan", model="m", mode="live")
        )

    def fail_audit(_):
        raise ConnectionError()

    ai.provider.plan = fail_model
    backend.audit = fail_audit
    result = ai.run_readiness_check("student_001", "timer", DEMO_NOW)
    assert result.budget and result.budget.risks
    assert any(i.code == "AUDIT_UNAVAILABLE" for i in result.issues)


def test_received_source_cannot_be_counted_twice_and_validation_outage_stays_pending():
    backend = FixtureBackend()
    context = backend.funding_context(
        backend.state, backend.calculate_budget(backend.state, DEMO_NOW), DEMO_NOW
    )
    context.sources[0].received = True
    result = ReadinessAI.mock(backend).generate_funding_candidates(context)
    assert result.candidates[0].validation == "INVALID"
    assert any(i.code == "FUNDS_ALREADY_IN_BALANCE" for i in result.candidates[0].issues)
    context.sources[0].received = False

    def fail(*args):
        raise TimeoutError()

    backend.validate_funding = fail
    result = ReadinessAI.mock(backend).generate_funding_candidates(context)
    assert result.candidates[0].validation == "PENDING"
