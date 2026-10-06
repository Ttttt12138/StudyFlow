"""Funding changes are either cash arrivals or obligation edits, never both."""

from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from finance.budget_services import convert
from finance.workflow_common import owned, require
from finance.workflow_models import FundingSource, SimulatedApplication

from .budget import money
from .services import business_date, converted_draft, save_run, versions
from finance.money import home_currency


def exact(value):
    try:
        require(isinstance(value, str), "USE_DECIMAL_STRING")
        amount = Decimal(value)
        require(
            amount.is_finite()
            and amount > 0
            and amount == amount.quantize(Decimal(".01")),
            "INVALID_ALLOCATION_AMOUNT",
        )
        return amount
    except (InvalidOperation, TypeError):
        require(False, "INVALID_ALLOCATION_AMOUNT")


def apply_actions(draft, actions):
    result, seen = deepcopy(draft), set()
    for action in actions:
        key = action["cost_id"]
        require(key not in seen, "DUPLICATE_COST_ACTION")
        seen.add(key)
        item = next((c for c in result["costs"] if c["cost_id"] == key), None)
        require(
            item is not None
            and not item.get("paid")
            and item.get("amount") is not None,
            "COST_ACTION_UNAVAILABLE",
        )
        require(
            item["currency"] == home_currency() and not item.get("conflict"),
            "COST_ACTION_UNAVAILABLE",
        )
        if action["kind"] == "reduce_spending":
            require(not item.get("locked"), "LOCKED_COST_CANNOT_BE_REDUCED")
            require(
                item["category"]
                in {"food", "transport", "communications", "settlement"},
                "CONTRACTUAL_COST_CANNOT_BE_REDUCED",
            )
            require(
                item.get("confidence_type") != "VERIFIED",
                "VERIFIED_OBLIGATION_CANNOT_BE_REDUCED",
            )
            reduction = exact(action["amount"])
            require(reduction <= Decimal(item["amount"]), "REDUCTION_EXCEEDS_EXPENSE")
            item["amount"] = money(Decimal(item["amount"]) - reduction)
            item["lower"] = item["upper"] = None
            item["locked"] = (
                True  # This explicit scenario override must survive calibration.
            )
        else:
            require(
                item["category"] == "tuition"
                and item["period"] in {"once", "semester"},
                "INSTALLMENT_REQUIRES_TUITION",
            )
            payments = action["payments"]
            require(
                payments
                and sum((exact(p["amount"]) for p in payments), Decimal(0))
                == Decimal(item["amount"]),
                "INSTALLMENT_TOTAL_MISMATCH",
            )
            require(
                len({p["date"] for p in payments}) == len(payments),
                "DUPLICATE_INSTALLMENT_DATE",
            )
            result["costs"].remove(item)
            for index, payment in enumerate(payments):
                result["costs"].append(
                    {
                        **item,
                        "cost_id": key + ":part:" + str(index),
                        "period": "once",
                        "component": key + ":part:" + str(index),
                        "due_date": payment["date"],
                        "amount": payment["amount"],
                    }
                )
    return result


def allocate(owner, snapshot, allocations):
    seen, conditions, borrowing, fees = set(), [], Decimal(0), Decimal(0)
    for allocation in allocations:
        source = owned(FundingSource, owner, allocation["source_id"])
        require(
            source.id not in seen
            and not source.received
            and not source.already_in_opening,
            "DUPLICATE_OR_RECEIVED_FUNDING",
        )
        seen.add(source.id)
        require(
            source.kind not in {"installment", "reduce_spending"},
            "NONCASH_SOURCE_REQUIRES_ACTION",
        )
        require(
            source.economic_key not in {e["id"] for e in snapshot["events"]},
            "FUNDING_ALREADY_IN_STATE",
        )
        amount = exact(allocation["amount"])
        require(amount <= source.amount, "ALLOCATION_EXCEEDS_CAPACITY")
        net, days, _ = convert(
            owner, amount, source.currency, allocation.get("fx_quote_id")
        )
        arrival = source.available_on + timedelta(days=days)
        require(
            arrival >= date.fromisoformat(snapshot["as_of"]), "FUNDING_DATE_IN_PAST"
        )
        snapshot["events"].append(
            {
                "id": "funding:" + str(source.id),
                "label": source.kind,
                "kind": "income",
                "amount": money(net),
                "date": arrival.isoformat(),
                "certainty": "confirmed",
            }
        )
        if source.certainty != "confirmed":
            conditions.append("RECEIPT_UNCONFIRMED:" + str(source.id))
        if source.loan_id:
            status, cost = include_loan(owner, source, amount, snapshot)
            borrowing += net
            fees += cost
            conditions += status
    return conditions, borrowing, fees


def include_loan(owner, source, amount, snapshot):
    from finance.affordability import assess

    application = SimulatedApplication.objects.filter(
        owner=owner, loan=source.loan
    ).first()
    require(
        source.loan.engine_version == "b-monthly-amortization-v1",
        "LEGACY_LOAN_UNSUPPORTED",
    )
    require(
        amount == Decimal(source.loan.result["net_proceeds"]),
        "LOAN_REQUIRES_EXACT_NET_PROCEEDS_QUOTE",
    )
    require(
        not application
        or application.status not in {"REJECTED", "CANCELLED", "DISBURSED"},
        "LOAN_UNAVAILABLE",
    )
    conditions = ["LOAN_APPROVAL_AND_RECEIPT_REQUIRED"]
    if not application:
        conditions.append("INSUFFICIENT_DATA")
    else:
        decision = assess(application)
        require(decision["status"] != "UNAFFORDABLE", "UNAFFORDABLE_LOAN")
        if decision["status"] != "AFFORDABLE":
            conditions.append("INSUFFICIENT_DATA")
    for row in source.loan.result["schedule"]:
        if Decimal(row["payment"]) > 0:
            snapshot["events"].append(
                {
                    "id": "repayment:" + str(source.loan_id) + ":" + str(row["number"]),
                    "label": "Loan repayment",
                    "kind": "expense",
                    "amount": row["payment"],
                    "date": row["due_date"],
                    "certainty": "confirmed",
                }
            )
    return conditions, Decimal(source.loan.result["total_cost_over_net_proceeds"])


def evaluate(owner, semester, state, data):
    from django.conf import settings

    draft = converted_draft(owner, semester.draft)
    if settings.STUDYFLOW_CONSUMPTION_ENABLED:
        from finance.consumption.analysis import effective_draft

        draft, _statistics = effective_draft(owner, draft, business_date(owner))
    draft = apply_actions(draft, data.get("actions", []))
    snapshot = deepcopy(state.snapshot)
    changed = {a["cost_id"] for a in data.get("actions", [])}
    for key in changed:
        affected = [
            e for e in snapshot["events"] if e["id"].startswith("cost:" + key + ":")
        ]
        require(
            not any("settled_sequence" in e for e in affected),
            "SETTLED_COST_CANNOT_CHANGE",
        )
        snapshot["events"] = [e for e in snapshot["events"] if e not in affected]
    conditions, borrowing, fees = allocate(owner, snapshot, data.get("allocations", []))
    conditions += [
        "ACTION_ELIGIBILITY_REQUIRES_CONFIRMATION:" + a["cost_id"]
        for a in data.get("actions", [])
    ]
    now = business_date(owner)
    end = date.fromisoformat(draft["profile"]["end_date"])
    # Include deferred tuition as well as the semester. Loan affordability is checked over its full term above.
    end = max(
        [end, now]
        + [
            date.fromisoformat(p["date"])
            for a in data.get("actions", [])
            for p in a.get("payments", [])
        ]
    )
    require((end - now).days <= 730, "PAYMENT_HORIZON_EXCEEDS_730_DAYS")
    horizon = (end - now).days + 1
    from finance.consumption.projection import project_for

    result = project_for(owner, snapshot, draft, now, horizon, conditional=True)
    remaining = Decimal(result["maximum_reserve_gap"])
    validation = (
        "INVALID"
        if remaining > 0
        else "CONDITIONAL"
        if conditions or not result["complete"]
        else "VALID"
    )
    return {
        "validation": validation,
        "remaining_gap": money(remaining),
        "borrowing_net": money(borrowing),
        "financing_cost": money(fees),
        "conditions": conditions,
        "forecast": result,
        "actions": data.get("actions", []),
        "allocations": data.get("allocations", []),
        "affordability": "INSUFFICIENT_DATA"
        if "INSUFFICIENT_DATA" in conditions
        else "SEE_B_QUOTE",
        "state_version": state.version,
        "budget_version": semester.version,
    }


def create_funding_plan(owner, data, obj=None):
    semester, state = versions(owner, data)
    return save_run(
        owner, semester, state, "funding", data, evaluate(owner, semester, state, data)
    )


def recommend(owner, semester, state, actions=None):
    from finance.copilot.models import PlanningPreference
    preference = PlanningPreference.objects.filter(semester=semester).first()
    borrowing_allowed = preference is None or preference.allow_new_loan
    data = {"allocations": [], "actions": actions or []}
    result = evaluate(owner, semester, state, data)
    priority = {"external_savings": 0, "family": 1, "scholarship": 2}
    sources = sorted(
        FundingSource.objects.filter(
            owner=owner,
            received=False,
            already_in_opening=False,
            currency=home_currency(),
            loan__isnull=True,
        ),
        key=lambda source: (
            priority.get(source.kind, 99),
            source.available_on,
            str(source.id),
        ),
    )
    for source in sources:
        gap = Decimal(result["remaining_gap"])
        if gap <= 0:
            break
        if source.kind not in priority or source.available_on < business_date(owner):
            continue
        allocation = {
            "source_id": str(source.id),
            "amount": money(min(source.amount, gap)),
        }
        proposal = {**data, "allocations": [*data["allocations"], allocation]}
        projected = evaluate(owner, semester, state, proposal)
        if Decimal(projected["remaining_gap"]) < gap:
            data, result = proposal, projected
    return {
        "recommended_borrowing_net": result["remaining_gap"] if borrowing_allowed else "0.00",
        "unmet_gap": result["remaining_gap"],
        "allow_new_loan": borrowing_allowed,
        "nonloan_plan": result,
        "quote_required": borrowing_allowed and Decimal(result["remaining_gap"]) > 0,
        "assumptions": result["conditions"],
        "is_recommendation_final": result["forecast"]["complete"],
    }


def recommend_funding(owner, data, obj=None):
    semester, state = versions(owner, data)
    result = recommend(owner, semester, state, data.get("actions", []))
    return save_run(owner, semester, state, "recommendation", data, result)
