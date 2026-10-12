"""Build reviewable proposals without replacing conflicting template evidence."""

from copy import deepcopy


def propose(baseline, extracted, source_id):
    draft = deepcopy(baseline)
    conflicts = {}
    for field, value in extracted.get("profile", {}).items():
        if value is None or field == "evidence":
            continue
        old = draft["profile"].get(field)
        if old and str(old).casefold() != str(value).casefold():
            conflicts["profile." + field] = {"existing": old, "candidate": value}
        elif old is None:
            draft["profile"][field] = value
    for candidate in extracted.get("costs", []):
        matches = [c for c in draft["costs"] if c["category"] == candidate["category"]]
        if len(matches) != 1:
            conflicts["candidate." + candidate["cost_id"]] = {
                "candidate": candidate,
                "reason": "Choose a cost component explicitly",
            }
            continue
        target = matches[0]
        changes = {
            key: value
            for key, value in candidate.items()
            if value is not None
            and key
            in {
                "amount",
                "lower",
                "upper",
                "currency",
                "period",
                "due_date",
                "paid",
                "year",
                "campus",
                "invoice_id",
            }
        }
        different = any(
            target.get(key) is not None and target[key] != value
            for key, value in changes.items()
        )
        if different:
            target["conflict"] = True
            target.setdefault("alternatives", []).append(
                {"candidate": changes, "source": source_id}
            )
            conflicts[target["cost_id"]] = {
                "existing": deepcopy(target),
                "candidate": changes,
            }
        else:
            target.update(changes)
            target["source_refs"] = list(
                dict.fromkeys(target.get("source_refs", []) + [source_id])
            )
            target["evidence"] = target.get("evidence", []) + candidate.get(
                "evidence", []
            )
            target["confidence_type"] = "UNCONFIRMED"
    return draft, conflicts
