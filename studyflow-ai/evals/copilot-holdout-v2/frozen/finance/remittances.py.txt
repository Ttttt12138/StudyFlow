from decimal import Decimal

from finance.budget_services import convert
from finance.workflow_common import owned, require, shift_date
from finance.workflow_models import FXQuote


def compare(owner, data, obj=None):
    require(len(data["quote_ids"]) == len(set(data["quote_ids"])), "DUPLICATE_QUOTE")
    rows = []
    for quote_id in data["quote_ids"]:
        quote = owned(FXQuote, owner, quote_id)
        require(
            quote.source_currency == data["source_currency"], "QUOTE_CURRENCY_MISMATCH"
        )
        net, days, _ = convert(owner, data["amount"], data["source_currency"], quote.id)
        arrival = shift_date(data["send_on"], days)
        rows.append(
            {
                "quote_id": str(quote.id),
                "quote_version": quote.quote_version,
                "route_name": quote.route_name,
                "source_currency": quote.source_currency,
                "target_currency": "THB",
                "send_amount": str(data["amount"]),
                "rate": str(quote.rate),
                "sender_fee": str(quote.sender_fee),
                "receiver_fee": str(quote.receiver_fee),
                "net_received": str(net),
                "arrival_earliest": str(
                    shift_date(data["send_on"], quote.settlement_min_days)
                ),
                "arrival_latest": str(arrival),
                "latest_send_date": str(shift_date(data["deadline"], -days)),
                "deadline_risk": arrival > data["deadline"],
                "shortfall": format(
                    max(Decimal(0), data["required_amount"] - net), ".2f"
                ),
                "feasible": arrival <= data["deadline"]
                and net >= data["required_amount"],
                "expires_at": quote.expires_at.isoformat(),
                "is_simulated": True,
            }
        )
    rows.sort(
        key=lambda r: (
            not r["feasible"],
            -Decimal(r["net_received"]),
            r["arrival_latest"],
            r["quote_id"],
        )
    )
    return {
        "routes": rows,
        "recommended_quote_id": rows[0]["quote_id"] if rows[0]["feasible"] else None,
        "reason": "ON_TIME_AND_SUFFICIENT"
        if rows[0]["feasible"]
        else "NO_ON_TIME_SUFFICIENT_ROUTE",
        "assumptions": [
            "Simulated quotes; calendar days; arrival is not guaranteed; sender fee is included in send amount."
        ],
        "is_simulated": True,
    }
