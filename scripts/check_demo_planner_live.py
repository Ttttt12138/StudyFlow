"""Replay two failed decision contexts against the live model without executing tools."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "studyflow-ai/src")]
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from finance.agent_tools import CONVERSATION_TOOLS
from studyflow_ai.agent import AgentContext, AgentPlanner, Observation, ToolSpec
from studyflow_ai.agent.models import FinalStep, ToolCallStep
from studyflow_ai.config import Settings
from studyflow_ai.providers.base import ProviderFailure


def main():
    evidence = ROOT / "evidence/demo-full-live-20261014"
    failed = json.loads((evidence / "take-06/model-trace.json").read_text(encoding="utf-8"))["turns"][-1]
    observations = [Observation(**{key: step[key] for key in ("tool", "arguments", "status", "result")})
                    for step in failed["steps"] if step["status"] == "OK"]
    memory = {"today": "2027-08-01", "server_time": datetime.now(timezone.utc).isoformat(),
              "plan": observations[-1].result["plan"]}
    tools = [ToolSpec(**tool.spec()) for tool in CONVERSATION_TOOLS.values()]
    contexts = [AgentContext(goal=failed["goal"], locale="en", tools=tools, observations=observations,
                             memory=memory, steps_remaining=0),
                AgentContext(goal="Remind me tomorrow to submit housing documents.", locale="en",
                             tools=tools, memory=memory, steps_remaining=10)]
    planner, results = AgentPlanner.from_settings(Settings.from_env("live")), []
    try:
        for index, context in enumerate(contexts):
            try:
                step, record = planner.next_step(context)
                good = isinstance(step, FinalStep) if index == 0 else isinstance(step, ToolCallStep) and step.tool == "create_study_task"
                results.append({"case": index, "passed": good, "step": step.model_dump(), "call": record.model_dump()})
            except ProviderFailure as exc:
                results.append({"case": index, "passed": False, "error": exc.code, "call": exc.record.model_dump()})
            print(json.dumps(results[-1]), flush=True)
    finally:
        planner.close()
        target = evidence / "format-live-probe-02.json"
        assert not target.exists(), "Preserve earlier probes"
        target.write_text(json.dumps(results, indent=2), encoding="utf-8")
    assert all(item["passed"] for item in results)


if __name__ == "__main__":
    main()
