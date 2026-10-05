from datetime import timedelta

from studyflow_ai.demo_backend import DEMO_NOW, DemoBackend
from studyflow_ai.orchestration import StudyFlow
from studyflow_ai.providers.rules import RuleProvider


def service(backend=None):
    backend = backend or DemoBackend()
    return backend, StudyFlow(backend, RuleProvider(), RuleProvider())


def test_fixture_forecast_and_repeat_reuses_models():
    backend, flow = service()
    first = flow.run_check("student_001", "manual", DEMO_NOW)
    second = flow.run_check("student_001", "timer", DEMO_NOW)
    assert first.risks[0].gap == 9000
    assert first.planning[0].plans[0].validation == "CONDITIONAL"
    assert second.reused
    assert first.trace_id == second.trace_id
    assert backend.read_state("student_001").balance == 80000


def test_next_day_rechecks_deadline():
    backend, flow = service()
    first = flow.run_check("student_001", "timer", DEMO_NOW)
    second = flow.run_check("student_001", "timer", DEMO_NOW + timedelta(days=1))
    assert first.trace_id != second.trace_id


def test_actual_mock_receipt_changes_balance_not_plan_approval():
    backend, flow = service()
    flow.run_check("student_001", "manual", DEMO_NOW)
    backend.record_demo_receipt("receipt1", "10000")
    backend.record_demo_receipt("receipt1", "10000")
    assert backend.read_state("student_001").balance == 90000
    assert not flow.run_check("student_001", "receipt", DEMO_NOW).risks


def test_state_change_during_planning_retries():
    class ChangingBackend(DemoBackend):
        def save_check(self, key, result):
            if self.state.state_version == 1:
                self.record_demo_receipt("receipt1", "10000")
            return super().save_check(key, result)

    backend, flow = service(ChangingBackend())
    result = flow.run_check("student_001", "manual", DEMO_NOW)
    assert result.state_version == 2
    assert not result.risks
    assert any(item.event == "check_stale" for item in backend.audits)
