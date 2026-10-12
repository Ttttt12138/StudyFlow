"""Explicit v5 scoring extension; historical legacy/role denominators stay intact."""

V5_SCORING_POLICY = "bijective_events_with_review_v2"
REVIEW_POLICIES = {"all_expected_with_review_v1", V5_SCORING_POLICY}


def scored_events(expected, policy):
    if policy in REVIEW_POLICIES:
        return expected
    if policy != "complete_only":
        raise ValueError(f"Unknown scoring policy: {policy}")
    return [e for e in expected if all(e[k] is not None for k in ("amount", "currency", "due_date"))]


def null_date_safety(events, expected, review):
    targets = [e for e in expected if e["due_date"] is None]
    failures = 0
    for target in targets:
        matches = [e for e in events if all(
            e.get(k) == target[k] for k in ("category", "amount", "currency")
        )]
        safe = review and bool(matches) and all(
            e.get("due_date") is None and e.get("date") is None
            and e.get("status") == "NEEDS_REVIEW" for e in matches
        )
        failures += not safe
    return len(targets), failures


def review_safety_met(metrics, policy):
    return (
        metrics["null_date_safety_failures"] == 0
        and metrics["date_safety_failures"] == 0
        and metrics["wrong_auto_decisions"] == 0
        and (policy != V5_SCORING_POLICY or (
            metrics["event_matching_cases"] == metrics["samples"]
            and metrics["unexpected_events"] == 0
            and metrics["duplicate_events"] == 0
        ))
    )
