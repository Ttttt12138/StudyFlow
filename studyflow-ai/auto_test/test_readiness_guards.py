from datetime import date
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from studyflow_ai.readiness.api import ReadinessAI
from studyflow_ai.readiness.demo import DEMO_NOW, FixtureBackend
from studyflow_ai.readiness.models import ExtractionContext, MaterialSource
from studyflow_ai.readiness.provider import (
    LiveReadinessProvider,
    RawField,
    RawMaterial,
    RawProfileField,
)


def test_profile_field_names_are_schema_constrained():
    with pytest.raises(ValidationError):
        RawProfileField(field="School", value="Test", quote="Test", locator="line:1")


def test_funding_schema_distinguishes_source_and_quote_ids():
    backend = FixtureBackend()
    context = backend.funding_context(
        backend.state, backend.calculate_budget(backend.state, DEMO_NOW), DEMO_NOW
    )
    captured = {}

    def request(purpose, text, schema, prompt):
        captured["schema"] = schema
        return schema(candidates=[]), SimpleNamespace(prompt_version="")

    LiveReadinessProvider(SimpleNamespace(_request=request)).plan(context)
    with pytest.raises(ValidationError):
        captured["schema"].model_validate(
            {
                "candidates": [
                    {
                        "allocations": [
                            {"funding_id": "loan_demo", "currency": "THB", "amount": "30000"}
                        ],
                        "source_refs": ["loan_demo"],
                        "conditions": [],
                        "explanation": "test",
                    }
                ]
            }
        )


def test_fabricated_evidence_and_wrong_line_cannot_populate_profile():
    ai = ReadinessAI.mock()
    raw = RawMaterial(
        profile=[
            RawProfileField(field="school", value="Invented", quote="Invented", locator="line:1")
        ],
        costs=[],
    )
    record = ai.provider._record("extract")
    ai.provider.extract = lambda _: (raw, record)
    result = ai.extract_semester_material(
        MaterialSource(source_id="test", kind="text", text="School: Real"),
        ExtractionContext(reference_date=date(2026, 10, 2)),
    )
    assert result.draft.profile.school is None
    assert any(i.code == "UNSUPPORTED_FIELD" for i in result.issues)


@pytest.mark.parametrize("value,quote", [("USD", "$65000"), ("2026-10-15", "October 15")])
def test_ambiguous_fields_fail_evidence_checks(value, quote):
    from studyflow_ai.readiness.extraction import _supported

    raw = RawField(
        field="currency" if value == "USD" else "due_date",
        value=value,
        quote=quote,
        locator="line:1",
    )
    assert not _supported(raw)


def test_negative_refund_wording_cannot_support_refundable_true():
    from studyflow_ai.readiness.extraction import _supported

    raw = RawField(field="refundable", value="true", quote="押金不可退还", locator="line:1")
    assert not _supported(raw)


def test_inferred_point_estimate_stays_estimated():
    from studyflow_ai.readiness.models import CostItem, SemesterDraft

    cost = CostItem(
        category="food", currency="THB", amount="8000", period="monthly", confidence_type="INFERRED"
    )
    result = ReadinessAI.mock().assess_cost_completeness(SemesterDraft(costs=[cost]))
    assert next(c for c in result.categories if c.category == "food").state == "Estimated"


def test_unknown_loan_reference_cannot_be_sent_for_planning():
    backend = FixtureBackend()
    context = backend.funding_context(
        backend.state, backend.calculate_budget(backend.state, DEMO_NOW), DEMO_NOW
    )
    raw = context.model_dump(mode="json")
    raw["sources"][1]["loan_quote_id"] = None
    with pytest.raises(ValidationError):
        type(context).model_validate(raw)


def test_malformed_cost_amount_raises_validation_error():
    from studyflow_ai.readiness.models import CostItem

    with pytest.raises(ValidationError):
        CostItem(category="food", amount="not-money")


@pytest.mark.parametrize(
    "locator,quote", [("line:1", "[line:1] School: Real"), ("[line:1]", "School: Real")]
)
def test_model_line_marker_format_is_normalized_without_losing_evidence(locator, quote):
    ai = ReadinessAI.mock()
    raw = RawMaterial(
        profile=[RawProfileField(field="school", value="Real", quote=quote, locator=locator)],
        costs=[],
    )
    ai.provider.extract = lambda _: (raw, ai.provider._record("extract"))
    result = ai.extract_semester_material(
        MaterialSource(source_id="test", kind="text", text="School: Real"),
        ExtractionContext(reference_date=date(2026, 10, 2)),
    )
    assert result.draft.profile.school == "Real"
    assert result.draft.profile.evidence[0].quote == "School: Real"
    assert result.draft.profile.evidence[0].locator == "line:1"
