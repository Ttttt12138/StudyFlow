"""Cards shown under an agent reply. Every number comes from a tool result or the catalog."""

from . import catalog, services


def _school(key):
    entry = catalog.school(key)
    return entry.model_dump(mode="json") if entry else None


def build(user, tool, arguments, result, status):
    if status == "PROPOSED":
        if result.get("action") not in ("plan.confirm", "plan.enroll"):
            return {"type": "confirmation", "action": result.get("action"),
                    "pending_action_id": result.get("pending_action_id"), "details": result.get("details"),
                    "amount": result.get("amount"), "currency": result.get("currency"),
                    "expires_at": result.get("expires_at")}
        return {"type": "confirmation", "action": result["action"],
                "pending_action_id": result["pending_action_id"], "details": result.get("details"),
                "expires_at": result.get("expires_at"),
                "plan": services.plan_record(services.plan_for(user), services.home_currency(user))["plan"]}
    if status != "OK":
        return None
    if tool == "set_role":  # retired tool; kept so stored turns from older conversations still render
        return {"type": "role", **result}
    if tool == "list_schools":
        from .tools import filtered_schools

        home = services.home_currency(user)
        return {"type": "school_list", "schools": [{**services.school_brief(e, home), **services.school_sources(e)}
                                                   for e in filtered_schools(arguments)],
                "sample": True}
    if tool == "get_school_profile":
        return {"type": "school", "school": _school(arguments.get("school_key")), "sample": True}
    if tool == "compare_schools":
        # The planner saw totals only; the card also says where each school's figures come from.
        schools = [{**row, **services.school_sources(services.entry_or_404(row["key"]))} for row in result["schools"]]
        return {"type": "comparison", **result, "schools": schools}
    if tool == "estimate_total_cost":
        entry = services.entry_or_404(arguments["school_key"])
        estimate = services.estimate(entry, arguments.get("years"), services.home_currency(user))
        return {"type": "cost", "school": {"key": entry.key, "name": entry.school.name.model_dump()},
                "estimate": estimate, "notes": [n.model_dump() for n in entry.notes]}
    if tool == "simulate_loan":
        if result.get("advice"):
            return {"type": "loan_advice", **result}
        if result.get("open_assessment"):
            return {"type": "plan", "plan": result.get("plan")} if result.get("plan") else None
        return {"type": "loan", **result}
    if tool == "list_bills":
        return {"type": "bills", "bills": result.get("bills", [])}
    if tool in ("record_expense", "get_spending"):
        return {"type": "spending", **result}
    if tool in ("save_plan", "get_plan"):
        return {"type": "plan", "plan": result.get("plan")} if result.get("plan") else None
    return None
