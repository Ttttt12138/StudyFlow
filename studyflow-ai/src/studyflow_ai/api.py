"""Stable Python facade; construction keeps backend and model dependencies explicit."""

from studyflow_ai.ingestion import Ingestor
from studyflow_ai.orchestration import StudyFlow
from studyflow_ai.planning import Planner
from studyflow_ai.recurring import detect_recurring
from studyflow_ai.routing import Router


class StudyFlowAI:
    def __init__(self, classifier, language_model, backend=None):
        self.classifier, self.language_model, self.backend = classifier, language_model, backend
        self.ingestor = Ingestor(classifier, language_model)
        self.router = Router(classifier)
        self.planner = Planner(language_model, backend)
        self.flow = StudyFlow(backend, classifier, language_model) if backend else None

    def ingest(self, source, context):
        return self.ingestor.ingest(source, context)

    def detect_recurring(self, transactions, as_of):
        return detect_recurring(transactions, as_of)

    def route(self, context):
        return self.router.route(context)

    def generate_plans(self, planning_context):
        return self.planner.generate_plans(planning_context)

    def run_check(self, student_id, trigger, now):
        if self.flow is None:
            raise ValueError("run_check requires a BackendPort implementation")
        return self.flow.run_check(student_id, trigger, now)

    def close(self):
        for provider in {id(p): p for p in (self.classifier, self.language_model)}.values():
            if hasattr(provider, "close"):
                provider.close()
