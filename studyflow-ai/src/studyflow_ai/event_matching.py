"""Exact multiset matching with inspectable, one-use event indices."""
from collections import defaultdict, deque


def event_key(event):
    due = event.get("due_date")
    if event.get("category") == "family_support":
        due = event.get("date") or due
    return event.get("category"), event.get("amount"), event.get("currency"), due


def match_events(actual, expected):
    remaining = defaultdict(deque)
    for index, event in enumerate(expected):
        remaining[event_key(event)].append(index)
    pairs, extras, duplicates, seen = [], [], [], set()
    for index, event in enumerate(actual):
        key = event_key(event)
        if remaining[key]:
            pairs.append({"expected_index": remaining[key].popleft(), "predicted_index": index})
        else:
            extras.append(index)
            if key in seen:
                duplicates.append(index)
        seen.add(key)
    return {"event_matching_checked": True, "event_matches": pairs,
            "unmatched_expected_indices": sorted(i for queue in remaining.values() for i in queue),
            "unexpected_event_indices": extras, "duplicate_event_indices": duplicates,
            "predicted_event_count": len(actual)}


def event_match_metrics(rows):
    checked = [r for r in rows if r.get("event_matching_checked")]
    predictions = sum(r["predicted_event_count"] for r in checked)
    matches = sum(len(r["event_matches"]) for r in checked)
    return {
        "event_matching_cases": len(checked), "predicted_event_count": predictions,
        "matched_event_count": matches,
        "event_precision": matches / predictions if predictions else None,
        "unexpected_events": sum(len(r["unexpected_event_indices"]) for r in checked),
        "duplicate_events": sum(len(r["duplicate_event_indices"]) for r in checked),
        "unmatched_expected_events": sum(len(r["unmatched_expected_indices"]) for r in checked),
    }
