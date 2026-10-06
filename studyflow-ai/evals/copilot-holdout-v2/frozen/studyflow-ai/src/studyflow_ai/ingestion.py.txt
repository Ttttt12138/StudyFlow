import re

from studyflow_ai.models import IngestContext, IngestResult, RouteContext, Source, Status
from studyflow_ai.parsing import InputError, parse_csv, read_source
from studyflow_ai.providers.base import ProviderFailure
from studyflow_ai.providers.rules import SUSPICIOUS, financial_clues
from studyflow_ai.routing import Router
from studyflow_ai.validation import (
    build_candidate,
    candidate_key,
    issue,
    mark_duplicates,
    transaction_key,
)


class Ingestor:
    def __init__(self, classifier, language_model):
        self.router, self.language_model = Router(classifier), language_model

    def ingest(self, source: Source, context: IngestContext) -> IngestResult:
        result = IngestResult(source_refs=[source.source_id])
        try:
            text = read_source(source)
            if source.kind == "csv":
                self._csv(text, source.source_id, result)
            else:
                self._document(source, (text, context), result)
        except (InputError, OSError) as exc:
            result.issues.append(
                issue(exc.code if isinstance(exc, InputError) else "SOURCE_UNREADABLE")
            )
            result.status = Status.REJECTED
        except ProviderFailure as exc:
            result.calls.append(exc.record)
            result.issues.append(issue(exc.code))
        return self._finish(result)

    @staticmethod
    def _csv(text, source_id, result):
        result.transactions, result.issues = parse_csv(text, source_id)
        mark_duplicates(result.transactions, transaction_key)

    def _document(self, source, data, result):
        text, context = data
        suspicious = [issue("UNTRUSTED_INSTRUCTIONS")] if re.search(SUSPICIOUS, text, re.I) else []
        route_context = RouteContext(
            text=text,
            source_refs=result.source_refs,
            needs_extraction=financial_clues(text),
            issues=suspicious,
            financial_clues=financial_clues(text),
        )
        result.routing = self.router.route(route_context)
        result.calls.extend(result.routing.calls)
        if result.routing.action == "SKIP":
            return
        if result.routing.classification and result.routing.classification.anomaly >= 0.5:
            result.routing.action = "REVIEW"
            suspicious.append(issue("POSSIBLE_ANOMALY"))
        if result.routing.action == "REVIEW":
            result.issues.extend(suspicious or [issue("REVIEW_REQUIRED")])
            return
        result.routing.action = "EXTRACT"
        prompt_text = (
            text
            if source.kind == "pdf"
            else "\n".join(f"[line:{i}] {line}" for i, line in enumerate(text.splitlines(), 1))
        )
        extracted, record = self.language_model.extract(prompt_text)
        result.calls.append(record)
        result.candidates = [
            build_candidate(raw, (source.source_id, text), context)
            for raw in extracted.events
            if raw.category != "irrelevant"
        ]
        mark_duplicates(result.candidates, candidate_key)

    @staticmethod
    def _finish(result):
        if result.status != Status.REJECTED and (
            result.issues
            or any(
                item.status != Status.READY for item in [*result.candidates, *result.transactions]
            )
        ):
            result.status = Status.NEEDS_REVIEW
        return result
