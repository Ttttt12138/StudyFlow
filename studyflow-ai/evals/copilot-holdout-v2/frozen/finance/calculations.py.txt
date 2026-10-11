from datetime import date
from decimal import Decimal

def forecast(snapshot, end_date, include_estimates=False):
    """THB-only exact arithmetic. Observed settlements follow ledger order; planned expenses precede planned income on the same date."""
    start = date.fromisoformat(snapshot["as_of"])
    end = date.fromisoformat(end_date) if isinstance(end_date, str) else end_date
    if end < start or (end - start).days > 730:
        raise ValueError("Forecast horizon must be between 0 and 730 days.")
    balance = Decimal(snapshot["opening_balance"])
    reserve = Decimal(snapshot["reserve"])
    minimum = balance
    maximum_gap = max(Decimal("0"), reserve - balance)
    first_gap = start.isoformat() if maximum_gap > 0 else None
    timeline, missing, excluded = [], [], []
    events = []
    for event in snapshot["events"]:
        when = date.fromisoformat(event["date"]) if event["date"] else None
        if when and when < start:
            raise ValueError("Event predates the opening snapshot.")
        if when and when > end:
            continue
        if event["amount"] is None or when is None or event["certainty"] == "missing":
            missing.append(event["id"])
            continue
        if event["certainty"] == "estimated" and not include_estimates:
            excluded.append(event["id"])
            continue
        events.append(event)
    for event in sorted(events, key=lambda e: (e["date"], 0 if "settled_sequence" in e else 1,
        e.get("settled_sequence", 0 if e["kind"] == "expense" else 1), e["id"])):
        value = Decimal(event["amount"])
        balance += value if event["kind"] == "income" else -value
        gap = max(Decimal("0"), reserve - balance)
        minimum = min(minimum, balance)
        maximum_gap = max(maximum_gap, gap)
        if gap > 0 and first_gap is None:
            first_gap = event["date"]
        timeline.append({
            **event, "balance_after": f"{balance:.2f}", "reserve_gap": f"{gap:.2f}",
        })
    return {
        "currency": "THB", "end_date": end.isoformat(),
        "ending_balance": f"{balance:.2f}", "minimum_balance": f"{minimum:.2f}",
        "maximum_cash_shortfall": f"{max(Decimal('0'), -minimum):.2f}",
        "maximum_reserve_gap": f"{maximum_gap:.2f}", "first_gap_date": first_gap,
        "status": "incomplete" if missing or excluded else "complete_under_assumptions",
        "missing_event_ids": missing, "excluded_estimate_ids": excluded,
        "includes_estimates": include_estimates, "timeline": timeline,
        "assumptions": [
            "Opening balance is at the start of as_of; events already included must be omitted.",
            "Observed settlements follow ledger order; planned expenses precede planned income on the same date.",
            "No FX, fees, unlisted expenses, or settlement delays are invented.",
        ],
    }
