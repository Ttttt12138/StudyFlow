"""Export the nested scenario contract omitted by generic JSON serializers."""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from finance.copilot.contracts import Scenario
from finance.readiness.contracts import Allocation, Draft, FundingAction

document = {
    "schema_version": "copilot-v1",
    "scenario": Scenario.model_json_schema(mode="serialization"),
    "money": "THB decimal strings; no binary floats",
    "versions": ["semester_id", "state_version", "budget_version", "analysis_version"],
    "trust_states": ["Verified", "Estimated", "Unconfirmed", "Missing"],
    "trace_layer_states": [
        "EXECUTED",
        "FAILED",
        "NOT_CALLED",
        "MOCK",
        "CACHED",
        "OBSERVED",
    ],
    "review_states": [
        "OPEN",
        "IN_PROGRESS",
        "WAITING_INFORMATION",
        "RESOLVED",
        "REJECTED",
    ],
    "what_if_metrics": [
        "maximum_reserve_gap",
        "minimum_balance",
        "first_below_reserve",
        "first_negative_date",
        "remaining_expenses",
        "semester_funding_gap",
        "complete",
        "daily",
        "monthly",
        "issues",
        "name",
        "conditional",
        "conditions",
        "confirmed",
        "loan",
        "loan_needed",
        "unmet_gap",
        "assumptions",
        "is_simulated",
    ],
    "docs": "docs/copilot.md",
}
(ROOT / "docs/copilot-contracts.json").write_text(
    json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
)
(ROOT / "docs/readiness-contracts.json").write_text(
    json.dumps(
        {c.__name__: c.model_json_schema() for c in (Draft, FundingAction, Allocation)},
        indent=2,
        ensure_ascii=False,
    )
    + "\n",
    encoding="utf-8",
)
