"""Extract an explicit labelled loan amount without mistaking tuition, dates or terms for it."""
import re
from decimal import Decimal

LABELS = {
    "principal": r"(?:想|拟|要)?借(?:款)?|贷(?:款)?|borrow(?:ing)?|loan(?: amount)?",
}
# A term ("36 个月", "4 years") or a rate after the number is not an amount.
NUMBER = r"(\d[\d,]*(?:\.\d+)?)(?![\d.])\s*(万|千|k)?(?!\s*(?:个?月|年|期|%|months?|years?|yrs?))"
CURRENCY = r"THB|CNY|USD|GBP|AUD|SGD|JPY|MYR|EUR|人民币|泰铢|美元|英镑|澳元|日元|令吉"
CODES = {"人民币": "CNY", "泰铢": "THB", "美元": "USD", "英镑": "GBP", "澳元": "AUD", "日元": "JPY", "令吉": "MYR"}


def matches(text, label):
    return list(re.finditer(rf"(?:{label})\s*(?:是|为|有|:|：|of|is|have|about)?\s*({CURRENCY})?\s*{NUMBER}\s*({CURRENCY})?", text, re.I))


def ambiguities(text):
    result = []
    for key, label in LABELS.items():
        rows = matches(text, label)
        values = {(r.group(2).replace(",", ""), r.group(3), (r.group(1) or r.group(4) or "").upper()) for r in rows}
        if len(values) > 1 or any(r.group(1) and r.group(4) and r.group(1).upper() != r.group(4).upper() for r in rows):
            result.append(key)
    return result


def amounts(text):
    result = {}
    uncertain = ambiguities(text)
    for key, label in LABELS.items():
        rows = matches(text, label)
        found = rows[0] if rows and key not in uncertain else None
        if found:
            number = Decimal(found.group(2).replace(",", ""))
            factor = {"万": 10000, "千": 1000, "k": 1000}.get((found.group(3) or "").lower(), 1)
            result[key] = f"{number * factor:.2f}"
            currency = found.group(1) or found.group(4)
            if currency:
                result[key + "_currency"] = CODES.get(currency, currency.upper())
    return result
