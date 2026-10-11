from studyflow_ai.readiness.completeness import assess
from studyflow_ai.readiness.extraction import SemesterExtractor
from studyflow_ai.readiness.funding import FundingPlanner
from studyflow_ai.readiness.fx import FxAdapter
from studyflow_ai.readiness.orchestration import run_check
from studyflow_ai.readiness.provider import LiveReadinessProvider, MockReadinessProvider
from studyflow_ai.readiness.web import SafeFetcher


class ReadinessAI:
    def __init__(self, provider, backend=None, *, classifier=None, fetcher=None, fx=None):
        self.provider, self.backend, self.classifier = provider, backend, classifier
        self.extractor = SemesterExtractor(provider, fetcher or SafeFetcher(), classifier)
        self.planner = FundingPlanner(provider, backend)
        self.fx = fx or FxAdapter()

    @classmethod
    def mock(cls, backend=None):
        return cls(MockReadinessProvider(), backend)

    @classmethod
    def from_settings(cls, settings, backend=None):
        if settings.mode == "mock":
            return cls.mock(backend)
        from studyflow_ai.config import providers

        classifier, llm = providers(settings)
        return cls(LiveReadinessProvider(llm), backend, classifier=classifier)

    def extract_semester_material(self, source, context):
        return self.extractor.extract(source, context)

    def assess_cost_completeness(self, draft):
        return assess(draft)

    def fetch_fx_quotes(self, request):
        return self.fx.fetch(request)

    def generate_funding_candidates(self, context):
        return self.planner.generate(context)

    def run_readiness_check(self, student_id, trigger, now):
        return run_check(self, student_id, trigger, now)

    def close(self):
        for provider in (self.classifier, getattr(self.provider, "provider", None)):
            if provider and hasattr(provider, "close"):
                provider.close()
