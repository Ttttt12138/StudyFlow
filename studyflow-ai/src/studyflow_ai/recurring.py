import calendar
import re
from collections import defaultdict
from datetime import date
from decimal import Decimal
from statistics import median

from studyflow_ai.models import RecurringObligation, Status


def normalized(value):
    return re.sub(r"\W+", " ", value.casefold()).strip()


def month_index(day):
    return day.year * 12 + day.month - 1


def next_date(last, day, end_of_month, as_of):
    index = month_index(last) + 1
    while True:
        year, month = index // 12, index % 12 + 1
        maximum = calendar.monthrange(year, month)[1]
        expected = date(year, month, maximum if end_of_month else min(day, maximum))
        if expected >= as_of:
            return expected
        index += 1


def detect_recurring(transactions, as_of: date) -> list[RecurringObligation]:
    groups = defaultdict(list)
    for tx in transactions:
        if tx.date <= as_of and tx.amount < 0 and tx.status == Status.READY:
            groups[(tx.account_id, tx.currency, normalized(tx.counterparty))].append(tx)
    results = []
    for rows in groups.values():
        result = _pattern(sorted(rows, key=lambda tx: tx.date), as_of)
        if result:
            results.append(result)
    return results


def _pattern(rows, as_of):
    months = sorted(set(month_index(tx.date) for tx in rows))
    if len(months) < 2 or any(b - a != 1 for a, b in zip(months, months[1:], strict=False)):
        return None
    amounts = [abs(tx.amount) for tx in rows]
    amount = median(amounts)
    if any(abs(value - amount) > amount * Decimal("0.05") for value in amounts):
        return None
    month_ends = all(
        tx.date.day == calendar.monthrange(tx.date.year, tx.date.month)[1] for tx in rows
    )
    day = int(median([tx.date.day for tx in rows]))
    if not month_ends and any(abs(tx.date.day - day) > 3 for tx in rows):
        return None
    return _obligation(rows, (months, amount, day, month_ends), as_of)


def _obligation(rows, pattern, as_of):
    from studyflow_ai.bank_data import classify_transaction

    months, amount, day, month_ends = pattern
    review = len(months) < 3 or len(months) != len(rows)
    is_rent = any(
        re.search(r"rent|rental|lease|condo", tx.description + " " + tx.counterparty, re.I)
        for tx in rows
    )
    return RecurringObligation(
        account_id=rows[0].account_id,
        category="rent" if is_rent else {
            "Mobile": "mobile", "Subscription": "subscription", "Transport": "transport",
            "Utilities": "utilities",
        }.get(classify_transaction(rows[-1])["category"], "other"),
        counterparty=rows[0].counterparty,
        amount=amount.quantize(Decimal("0.01")),
        expected_next_date=next_date(rows[-1].date, day, month_ends, as_of),
        supporting_transaction_ids=[
            tx.transaction_id or f"{tx.source_id}:{tx.locator}" for tx in rows
        ],
        source_refs=sorted({tx.source_id for tx in rows}),
        status=Status.NEEDS_REVIEW if review else Status.READY,
        basis=f"{len(months)} consecutive months; 5% amount tolerance; 3-day tolerance; "
        f"month_end={month_ends}; multiple_transactions_per_month={len(months) != len(rows)}",
    )
