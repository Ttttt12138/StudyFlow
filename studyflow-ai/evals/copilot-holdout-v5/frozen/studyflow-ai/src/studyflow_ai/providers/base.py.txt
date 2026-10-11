from typing import Protocol

from studyflow_ai.models import CallRecord, Classification, PlanningContext
from studyflow_ai.provider_models import Extraction, Proposals


class ProviderFailure(Exception):
    """Carries sanitized metadata only; never raw provider exception bodies."""

    def __init__(self, code: str, record: CallRecord):
        super().__init__(code)
        self.code = code
        self.record = record


class Classifier(Protocol):
    def classify(self, text: str) -> tuple[Classification, CallRecord]: ...


class LanguageModel(Protocol):
    def extract(self, text: str) -> tuple[Extraction, CallRecord]: ...
    def plan(self, context: PlanningContext) -> tuple[Proposals, CallRecord]: ...
