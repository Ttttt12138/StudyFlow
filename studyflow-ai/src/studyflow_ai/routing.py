from studyflow_ai.instruction_safety import blocks_extraction
from studyflow_ai.models import RouteContext, RouteResult, Status
from studyflow_ai.providers.base import ProviderFailure

MIN_PROBABILITY = 0.80


class Router:
    def __init__(self, classifier):
        self.classifier = classifier

    def route(self, context: RouteContext) -> RouteResult:
        result = RouteResult(
            action="REVIEW",
            reasons=[],
            state_version=context.state_version,
            source_refs=context.source_refs,
            status=Status.NEEDS_REVIEW,
        )
        if context.issues:
            result.reasons = [issue.code for issue in context.issues]
            return result
        try:
            result.classification, record = self.classifier.classify(context.text)
            result.calls.append(record)
        except ProviderFailure as exc:
            result.calls.append(exc.record)
            result.reasons.append(exc.code)
        return self._decide(context, result)

    def _decide(self, context, result):
        if result.classification and blocks_extraction(result.classification):
            return self._finish(result, "REVIEW", "POSSIBLE_ANOMALY")
        if context.deterministic_risk:
            return self._finish(result, "PLAN", "BACKEND_RISK")
        if result.classification is None:
            return self._finish(result, "REVIEW", "CLASSIFIER_UNAVAILABLE")
        if context.needs_extraction:
            return self._finish(result, "EXTRACT", "DOCUMENT_EXTRACTION_REQUIRED")
        judgment = result.classification
        if judgment is None:
            return self._finish(result, "REVIEW", "CLASSIFIER_UNAVAILABLE")
        if blocks_extraction(judgment):
            return self._finish(result, "REVIEW", "POSSIBLE_ANOMALY")
        if max(judgment.probabilities.values()) < MIN_PROBABILITY:
            return self._finish(result, "REVIEW", "LOW_CLASSIFICATION_PROBABILITY")
        if judgment.category == "irrelevant":
            can_skip = not context.financial_clues and judgment.probabilities["irrelevant"] >= 0.95
            return self._finish(result, "SKIP" if can_skip else "REVIEW", "RELEVANCE_GATE")
        action = "PLAN" if judgment.needs_planning >= 0.8 else "PROCESS"
        return self._finish(result, action, "CLASSIFICATION_GATE")

    @staticmethod
    def _finish(result, action, reason):
        result.action = action
        result.status = Status.NEEDS_REVIEW if action == "REVIEW" else Status.READY
        result.reasons.append(reason)
        return result
