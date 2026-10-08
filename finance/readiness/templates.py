"""Immutable, schema-validated school/city template registry."""

import json
from copy import deepcopy
from pathlib import Path

from finance.workflow_common import require

TEMPLATE_KEY = "psu-phuket-fis-ib-2026-1-shared"
REQUIRED = [
    "tuition",
    "housing",
    "deposit",
    "food",
    "transport",
    "communications",
    "utilities",
    "insurance",
    "visa",
    "travel",
    "settlement",
]
DIRECTORY = Path(__file__).with_name("template_data")


def list_templates():
    from .contracts import Draft

    result = []
    for path in sorted(DIRECTORY.glob("*.json")):
        item = json.loads(path.read_text(encoding="utf-8"))
        Draft.model_validate(
            {k: item[k] for k in ("profile", "costs", "reserve", "required_categories")}
        )
        result.append(item)
    return result


def get_template(room="shared", key=None, version=None):
    key = key or "psu-phuket-fis-ib-2026-1-" + room
    matches = [
        t
        for t in list_templates()
        if t["key"] == key and (version is None or t["version"] == version)
    ]
    require(bool(matches), "UNKNOWN_TEMPLATE_VERSION")
    return deepcopy(max(matches, key=lambda t: t["version"]))


def upgrade(owner, data, obj=None):
    from .services import persist_revision, versions

    semester, state = versions(owner, data)
    target = get_template(key=data["template_key"], version=data["template_version"])
    previous = {c["cost_id"]: c for c in semester.draft["costs"]}
    differences = [
        {"cost_id": c["cost_id"], "existing": previous.get(c["cost_id"]), "template": c}
        for c in target["costs"]
        if previous.get(c["cost_id"]) != c
    ]
    if not data["confirm"]:
        return {
            "changes": differences,
            "profile": {
                "existing": semester.draft["profile"],
                "template": target["profile"],
            },
            "template_key": target["key"],
            "template_version": target["version"],
            "requires_confirmation": True,
        }
    draft = deepcopy(semester.draft)
    draft["costs"].extend(c for c in target["costs"] if c["cost_id"] not in previous)
    draft["required_categories"] = target["required_categories"]
    draft["profile"] = target["profile"]
    semester.template_key, semester.template_version = target["key"], target["version"]
    semester.save(update_fields=["template_key", "template_version"])
    return persist_revision(owner, semester, state, draft)
