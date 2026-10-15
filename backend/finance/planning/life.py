"""In-app reminders are projections: reopening or refreshing never generates new notices."""
import hashlib
import json
from decimal import Decimal

from . import services
from .life_sources import balances, source_rows
from .models import ReminderPreference


def reminder_stage(due, today):
    if due is None:
        return "unknown"
    days = (due - today).days
    if days < 0:
        return "overdue"
    if days == 0:
        return "due"
    if days == 1:
        return "tomorrow"
    return "week" if days <= 7 else "later"


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def decorate(row, pref, today):
    due = pref.due_override if pref and pref.due_override else row["due_date"]
    amount = str(pref.amount_override) if pref and pref.amount_override is not None else row["amount"]
    stage = reminder_stage(due, today)
    notice = digest([row, due, stage, amount])
    return {**row, "due_date": due.isoformat() if due else None, "stage": stage, "amount": amount,
        "catalog_amount": row["amount"], "amount_confirmed": bool(pref and pref.amount_override is not None),
        "estimated": row["estimated"] and not bool(pref and (pref.due_override or pref.amount_override is not None)),
        "token": digest([notice, pref.version if pref else 0]), "notice_token": notice,
        "unread": not row["done"] and (not pref or pref.seen_token != notice),
        "snoozed": bool(pref and pref.snoozed_until and pref.snoozed_until > today),
        "snoozed_until": pref.snoozed_until.isoformat() if pref and pref.snoozed_until else None}


def money_check(rows, held):
    """Whether each open payment is covered by the wallet when it falls due.

    Open amounts are taken from the balance of their currency in due-date order, so two bills never count the
    same money; `shortfall` is how much of this item is not covered. Before the wallet exists nothing is checked.
    """
    spent = {}
    for row in sorted(rows, key=lambda r: (r["due_date"] or "9999", r["source_key"])):
        row["shortfall"], row["shortfall_basis"], row["at_risk"] = None, None, False
        # A bill the signed loan pays to the school needs no money from the wallet.
        if row["done"] or row["amount"] is None or row["due_date"] is None or row.get("paid_by_loan"):
            continue
        amount, currency = Decimal(row["amount"]), row["currency"]
        # A loan awaiting approval or signing will pay its share to the school; only the rest needs the wallet.
        if row.get("loan_pending"):
            amount -= min(amount, Decimal(row["loan_pending"]["amount"]))
            if amount <= 0:
                continue
        if held is not None and currency in held:
            before = spent.get(currency, Decimal(0))
            spent[currency] = before + amount
            short = min(amount, max(Decimal(0), spent[currency] - held[currency]))
            row["shortfall"], row["shortfall_basis"], row["at_risk"] = str(short), "wallet", short > 0


def read(user):
    plan, today = services.plan_for(user), services.today_for(user)
    preferences = {p.source_key: p for p in ReminderPreference.objects.filter(owner=user)}
    rows = [decorate(row, preferences.get(row["source_key"]), today) for row in source_rows(user, plan)]
    priority = {s: i for i, s in enumerate(["overdue", "due", "tomorrow", "week", "unknown", "later"])}
    money_check(rows, balances(user))
    rows.sort(key=lambda r: (r["done"], r["snoozed"], priority[r["stage"]], r["due_date"] or "9999", r["source_key"]))
    active = [r for r in rows if not r["done"] and not r["snoozed"] and r["stage"] != "later"]
    return {"today": today.isoformat(), "is_simulated": True, "in_app_only": True,
        "items": rows, "upcoming": active[:3], "attention_count": len(active),
        "unread_count": sum(r["unread"] for r in active)}
