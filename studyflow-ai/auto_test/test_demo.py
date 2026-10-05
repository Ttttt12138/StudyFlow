from studyflow_ai.demo import run_demo
from studyflow_ai.providers.rules import RuleProvider


def test_demo_three_reproducible_runs():
    for _ in range(3):
        result = run_demo(RuleProvider(mode="mock"), RuleProvider(mode="mock"))
        assert result["forecast"]["projected_balance"] == "6000.00"
        assert result["check"]["risks"][0]["gap"] == "9000.00"
        assert result["balance_before_receipt"] == "80000.00"
        assert result["balance_after_mock_receipt"] == "90000.00"
        assert not result["after_receipt"]["risks"]
        assert result["repeat_reused"]
        assert result["integration_acceptance"] is False
