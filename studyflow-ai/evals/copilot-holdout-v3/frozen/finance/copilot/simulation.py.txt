"""Read-only projections. All scenario modifications are made on independent copies."""

from copy import deepcopy
from datetime import date
from decimal import Decimal

from finance.consumption.projection import project_for
from finance.lending_core.calculations import assess, calculate
from finance.lending_core.schemas import MonthBudget, QuoteInput
from finance.lending_models import AffordabilityProfile
from finance.readiness.budget import bounds, money
from finance.readiness.services import business_date, converted_draft
from finance.workflow_common import owned, require
from finance.workflow_models import FundingSource


def patch_costs(draft, changes, now):
    for change in changes:
        item = next(
            (c for c in draft["costs"] if c["cost_id"] == change["cost_id"]), None
        )
        require(item is not None and not item.get("paid"), "COST_NOT_EDITABLE")
        require(bounds(item) is not None, "COST_BASELINE_MISSING")
        require(
            item["currency"] == "THB" and item.get("applicability") != "NOT_APPLICABLE",
            "COST_NOT_APPLICABLE",
        )
        require(
            now.isoformat() <= change["effective_on"] <= draft["profile"]["end_date"],
            "INVALID_EFFECTIVE_DATE",
        )
        if item["period"] != "monthly":
            require(
                item.get("due_date") and change["effective_on"] <= item["due_date"],
                "OVERRIDE_AFTER_OBLIGATION",
            )
        item["planned_overrides"] = [
            p
            for p in item.get("planned_overrides", [])
            if p["effective_on"] != change["effective_on"]
        ]
        item["planned_overrides"].append(
            {k: change[k] for k in ("amount", "effective_on")}
        )
    return draft


def support_events(owner, snapshot, changes, now):
    for index, change in enumerate(changes):
        require(change["available_on"] >= now.isoformat(), "FUNDING_DATE_IN_PAST")
        source_id = change.get("source_id")
        if source_id:
            source = owned(FundingSource, owner, source_id)
            require(
                source.kind in {"family", "family_support"}
                and source.currency == "THB"
                and not source.received
                and not source.already_in_opening,
                "SUPPORT_NOT_EDITABLE",
            )
            identifiers = {source.economic_key, "funding:" + str(source.id)}
            snapshot["events"] = [
                e
                for e in snapshot["events"]
                if e["id"] not in identifiers or "settled_sequence" in e
            ]
        snapshot["events"].append(
            {
                "id": f"whatif:family:{index}",
                "label": "Hypothetical family support",
                "kind": "income",
                "amount": change["amount"],
                "date": change["available_on"],
                "certainty": "estimated",
            }
        )


def include_support(owner, snapshot, now):
    existing = {e["id"] for e in snapshot["events"]}
    for source in FundingSource.objects.filter(
        owner=owner,
        kind__in=["family", "family_support"],
        currency="THB",
        received=False,
        already_in_opening=False,
        available_on__gte=now,
    ).exclude(sponsorrequest__status__in=["REJECTED", "REVOKED"]):
        key = "funding:" + str(source.id)
        if key not in existing and source.economic_key not in existing:
            snapshot["events"].append(
                {
                    "id": key,
                    "label": "Planned family support",
                    "kind": "income",
                    "amount": str(source.amount),
                    "date": source.available_on.isoformat(),
                    "certainty": source.certainty,
                }
            )


def loan_result(owner, scenario, snapshot, now):
    if not scenario.get("loan"):
        return None
    terms = QuoteInput.model_validate(scenario["loan"])
    receipt = scenario["loan_available_on"]
    require(
        receipt >= now.isoformat() and terms.first_due_date.isoformat() > receipt,
        "INVALID_LOAN_DATES",
    )
    result = calculate(terms)
    snapshot["events"].append(
        {
            "id": "whatif:loan",
            "label": "Hypothetical loan",
            "kind": "income",
            "amount": result["net_proceeds"],
            "date": receipt,
            "certainty": "estimated",
        }
    )
    for index, row in enumerate(result["repayments"]):
        snapshot["events"].append(
            {
                "id": f"whatif:repayment:{index}",
                "label": "Hypothetical repayment",
                "kind": "expense",
                "amount": row["amount"],
                "date": row["due_date"],
                "certainty": "estimated",
            }
        )
    profile = AffordabilityProfile.objects.filter(owner=owner).first()
    budgets = [
        MonthBudget.model_validate(row) for row in (profile.months if profile else [])
    ]
    from types import SimpleNamespace

    from finance.affordability import commitments

    additional = commitments(SimpleNamespace(owner=owner, pk=None))
    result["affordability"] = assess(result, budgets, additional)
    result["maximum_installment"] = money(
        max(Decimal(row["amount"]) for row in result["repayments"])
    )
    return result


def metrics(prediction):
    daily = prediction["daily"]
    expenses = sum(
        (
            Decimal(e["amount"])
            for e in prediction["timeline"]
            if e["kind"] == "expense" and "settled_sequence" not in e
        ),
        Decimal(0),
    )
    return {
        "maximum_reserve_gap": prediction["maximum_reserve_gap"],
        "minimum_balance": money(min(Decimal(d["minimum_balance"]) for d in daily)),
        "first_below_reserve": next(
            (d["date"] for d in daily if Decimal(d["reserve_gap"]) > 0), None
        ),
        "first_negative_date": next(
            (d["date"] for d in daily if Decimal(d["minimum_balance"]) < 0), None
        ),
        "remaining_expenses": money(expenses),
        "semester_funding_gap": money(
            max(
                Decimal(0),
                Decimal(prediction.get("reserve", "0"))
                - Decimal(prediction["ending_balance"]),
            )
        ),
        "complete": prediction["complete"],
        "daily": daily,
        "monthly": prediction["monthly"],
        "issues": prediction.get("data_issues", [])
        + prediction.get("budget_issues", []),
    }


def evaluate(owner, semester, state, scenario):
    now = business_date(owner)
    horizon = (date.fromisoformat(semester.draft["profile"]["end_date"]) - now).days + 1
    require(1 <= horizon <= 731, "SEMESTER_NOT_ACTIVE")
    for change in scenario.get("costs", []):
        cost = next(
            (c for c in semester.draft["costs"] if c["cost_id"] == change["cost_id"]),
            None,
        )
        require(
            cost is None or cost["currency"] == "THB",
            "COST_OVERRIDE_REQUIRES_THB_BASELINE",
        )
        if cost and cost["period"] != "monthly":
            require(
                not any(
                    e["id"].startswith("cost:" + cost["cost_id"] + ":")
                    and "settled_sequence" in e
                    for e in state.snapshot["events"]
                ),
                "SETTLED_COST_IS_IMMUTABLE",
            )
    draft = patch_costs(
        converted_draft(owner, deepcopy(semester.draft)), scenario.get("costs", []), now
    )
    snapshot = deepcopy(state.snapshot)
    include_support(owner, snapshot, now)
    support_events(owner, snapshot, scenario.get("family_support", []), now)
    hypothetical_income = any(
        e["kind"] == "income" and e["certainty"] != "confirmed"
        for e in snapshot["events"]
    )
    before_loan = project_for(owner, snapshot, deepcopy(draft), now, horizon, True)
    loan = loan_result(owner, scenario, snapshot, now)
    conditional = project_for(owner, snapshot, deepcopy(draft), now, horizon, True)
    confirmed_snapshot = deepcopy(state.snapshot)
    include_support(owner, confirmed_snapshot, now)
    support_events(owner, confirmed_snapshot, scenario.get("family_support", []), now)
    confirmed = project_for(
        owner, confirmed_snapshot, deepcopy(draft), now, horizon, False
    )
    result = metrics(conditional)
    result.update(
        name=scenario.get("name", "Current plan"),
        conditional=bool(
            scenario.get("costs")
            or scenario.get("family_support")
            or loan
            or hypothetical_income
        ),
        conditions=[
            "CONTRACT_CHANGE_REQUIRES_REVIEW:" + change["cost_id"]
            for change in scenario.get("costs", [])
            if any(
                c["cost_id"] == change["cost_id"]
                and (c.get("locked") or c.get("confidence_type") == "VERIFIED")
                for c in semester.draft["costs"]
            )
        ]
        + (["HYPOTHETICAL_FUNDING_NOT_SETTLED"] if hypothetical_income or loan else []),
        confirmed=metrics(confirmed),
        loan=loan,
        loan_needed=before_loan["maximum_reserve_gap"]
        if scenario.get("allow_new_loan", True)
        else "0.00",
        unmet_gap=conditional["maximum_reserve_gap"],
        assumptions=scenario,
        is_simulated=True,
    )
    return result
