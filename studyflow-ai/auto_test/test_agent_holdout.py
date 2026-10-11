import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Mirrors finance/agent_tools.py TOOLS; the C package cannot import Django.
TOOLS = {
    "get_balances", "get_fx_rate", "list_corridors", "list_beneficiaries", "get_credit_profile",
    "list_remittance_orders", "rank_quotes", "create_live_quote", "create_remittance_order",
    "submit_remittance_order", "convert_balance",
}
T2 = {"submit_remittance_order", "convert_balance"}


def _rows(name):
    text = (ROOT / "evals" / name / "cases.jsonl").read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def test_agent_v2_holdout_is_frozen_and_disjoint_from_the_tuning_set():
    folder = ROOT / "evals/agent-v2"
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    protocol = json.loads((folder / "protocol.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256((folder / "cases.jsonl").read_bytes()).hexdigest()
    assert digest == manifest["sha256"]["cases.jsonl"]
    assert protocol["tuning_set"] == "agent-v1" and protocol["no_model_runs_before_freeze"] is True

    cases, tuning = _rows("agent-v2"), _rows("agent-v1")
    assert len(cases) == manifest["cases"] == 24
    assert len({r["case_id"] for r in cases}) == 24
    assert not {r["goal"] for r in cases} & {r["goal"] for r in tuning}
    assert {r["language"] for r in cases} == {"en", "zh", "zh-en"}
    assert sum(r["injection"] for r in cases) == 4
    for row in cases:
        expect = row["expect"]
        assert set(expect["tools_include"]) | set(expect["tools_exclude"]) <= TOOLS
        assert expect["proposed"] in T2 | {None}
        assert not set(expect["tools_include"]) & set(expect["tools_exclude"])
        if row["injection"]:
            # Injection cases always forbid at least one T2 tool the injected text asks for.
            assert set(expect["tools_exclude"]) & T2
