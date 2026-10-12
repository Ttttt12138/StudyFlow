from datetime import date
from decimal import Decimal

import pytest

from studyflow_ai.demo_backend import DemoBackend
from studyflow_ai.ingestion import Ingestor
from studyflow_ai.models import IngestContext, Source
from studyflow_ai.provider_models import ExtractedEvent, ExtractedField, Extraction
from studyflow_ai.providers.rules import RuleProvider
from studyflow_ai.validation import build_candidate

CONTEXT = IngestContext(reference_date=date(2026, 10, 2), verified_source_ids=["support"],
                        verification_reference="test")
PROMISE = ("Personal sponsor pledges THB 3858 to the student on 2026-11-19. "
           "Pending payroll execution, not cash received. Beneficiary: Desk E9")


def raw_event(**changes):
    return ExtractedEvent(**{
        "category": "family_support", "amount": "3858.00", "currency": "THB",
        "date": None, "due_date": None, "counterparty": None, "invoice_id": None,
        "evidence": [ExtractedField(field="amount", quote="3858", locator="line:1"),
                     ExtractedField(field="currency", quote="THB", locator="line:1")],
        **changes,
    })


@pytest.mark.parametrize("text", [
    PROMISE,
    "个人资助人承诺于2026-11-19向学生汇款 THB 3858，尚未到账。",
    "Payroll mandate / 个人资助 THB 3858, scheduled 2026-11-19. 未到账。",
    "Family support: scheduled transfer of THB 3858 on 2026-11-19; pending receipt.",
    "Sponsor pledges THB 3858 on 2026-11-19, not cash received.",
    "Sponsor promises THB 3858 on 2026-11-19, not yet received.",
])
def test_recovers_supported_date_without_confirming_receipt(text):
    candidate = build_candidate(raw_event(), ("support", text), CONTEXT)
    assert candidate.due_date == date(2026, 11, 19)
    assert candidate.date is None and candidate.amount == Decimal("3858.00")
    assert candidate.status == "NEEDS_REVIEW" and candidate.confidence_type == "UNCONFIRMED"
    assert candidate.verification_reference is None
    evidence = [e for e in candidate.evidence if e.field == "due_date"]
    assert len(evidence) == 1 and evidence[0].quote in text
    assert evidence[0].source_id == "support" and evidence[0].locator == "line:1"
    assert "SOURCE_DATE_RECOVERED" in [i.code for i in candidate.issues]
    assert not any(i.code == "MISSING_FIELD" and i.field == "due_date" for i in candidate.issues)


@pytest.mark.parametrize("text", [
    "Personal sponsor pledges THB 3858. Issued on 2026-11-19.",
    "Personal sponsor pledges THB 3858, issued on 2026-11-19.",
    "Personal sponsor pledges THB 3858 for rent due on 2026-11-19.",
    "Personal sponsor pledges THB 3858, the student arrives on 2026-11-19.",
    "Personal sponsor pledges THB 3858 after enrollment on 2026-11-19.",
    "Personal sponsor pledges THB 3858 on 2026-11-19 or 2026-11-21.",
    "Personal sponsor pledges THB 3858 on 2026-11-19 or November 21.",
    "Personal sponsor pledges THB 3858 on November 19.",
    "Personal sponsor pledges THB 3858 on 2026-02-30.",
    "Personal sponsor does not pledge THB 3858 on 2026-11-19.",
    "Personal sponsor cancelled the promised THB 3858 transfer on 2026-11-19.",
    "个人资助人取消于2026-11-19汇款 THB 3858 的承诺。",
    "Personal sponsor paid THB 3858 on 2026-11-19.",
    "Personal sponsor promises THB 3858 on 2026-11-19, already received.",
    "Personal sponsor pledges THB 3858 on 2026-11-19. The pledge was cancelled.",
    "Personal sponsor pledges THB 3858; tuition THB 5000 due 2026-11-19.",
    "Sponsor pledges THB 3858 and THB 4000 on 2026-11-19.",
    "Personal sponsor pledges USD 3858 on 2026-11-19.",
    "Personal sponsor pledges THB 38580 on 2026-11-19.",
])
def test_ambiguous_unrelated_or_invalid_date_is_not_recovered(text):
    candidate = build_candidate(raw_event(), ("support", text), CONTEXT)
    assert candidate.due_date is None and candidate.date is None
    assert candidate.status == "NEEDS_REVIEW"
    assert "SOURCE_DATE_RECOVERED" not in [i.code for i in candidate.issues]


def test_separate_promises_stay_bound_to_the_cited_amount_line():
    text = PROMISE + "\nPersonal sponsor promises THB 3858 on 2026-12-01."
    candidate = build_candidate(raw_event(), ("support", text), CONTEXT)
    assert candidate.due_date == date(2026, 11, 19)
    raw = raw_event(evidence=[e.model_copy(update={"locator": "line:2"}) for e in raw_event().evidence])
    other = build_candidate(raw, ("support", text), CONTEXT)
    assert other.due_date == date(2026, 12, 1)


def test_page_scope_rejects_two_equal_amount_promises_with_different_dates():
    text = "[page:1] " + PROMISE + "\nPersonal sponsor promises THB 3858 on 2026-12-01."
    raw = raw_event(evidence=[e.model_copy(update={"locator": "page:1"}) for e in raw_event().evidence])
    assert build_candidate(raw, ("support", text), CONTEXT).due_date is None


def test_unambiguous_pdf_page_preserves_page_locator():
    raw = raw_event(evidence=[e.model_copy(update={"locator": "page:1"}) for e in raw_event().evidence])
    candidate = build_candidate(raw, ("support", "[page:1] " + PROMISE), CONTEXT)
    assert candidate.due_date == date(2026, 11, 19)
    assert candidate.evidence[-1].locator == "page:1"


@pytest.mark.parametrize("changes", [
    {"category": "tuition"}, {"date": "2026-11-19"}, {"due_date": "invalid"},
    {"evidence": []},
    {"evidence": [ExtractedField(field="amount", quote="3858", locator="line:9")]},
])
def test_recovery_does_not_overwrite_other_categories_or_invalid_model_dates(changes):
    candidate = build_candidate(raw_event(**changes), ("support", PROMISE), CONTEXT)
    assert "SOURCE_DATE_RECOVERED" not in [i.code for i in candidate.issues]


def test_existing_valid_date_is_unchanged():
    raw = raw_event(due_date="2026-11-19")
    raw.evidence.append(ExtractedField(field="due_date", quote=PROMISE, locator="line:1"))
    candidate = build_candidate(raw, ("support", PROMISE), CONTEXT)
    assert candidate.due_date == date(2026, 11, 19)
    assert "SOURCE_DATE_RECOVERED" not in [i.code for i in candidate.issues]


def test_recovery_propagates_review_and_cannot_automatically_change_balance():
    class MissingDate(RuleProvider):
        def extract(self, text):
            return Extraction(events=[raw_event()]), self.record("extract")
    result = Ingestor(RuleProvider(), MissingDate()).ingest(
        Source(source_id="support", kind="email", text=PROMISE), CONTEXT)
    assert result.candidates[0].due_date == date(2026, 11, 19)
    assert result.status == "NEEDS_REVIEW"
    backend = DemoBackend()
    before = backend.read_state("student_001").model_dump()
    with pytest.raises(ValueError, match="Import is not ready"):
        backend.accept_import("student_001", result)
    assert backend.read_state("student_001").model_dump() == before
