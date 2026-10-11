"""Conservative, source-based interpretation of payment deadlines."""

import re

ISO_DATE = r"(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)"
INDIRECT = re.compile(
    r"cash on delivery|货到付款|expected delivery|预计.{0,25}(?:送达|送货)"
    r"|(?:pay(?:ment)?|collected).{0,25}on pickup|取货.{0,8}付款"
    r"|(?:unpaid|未缴|未付).{0,60}(?:suspend|disconnect|停水|停电|停供)"
    r"|(?:suspend|disconnect|停水|停电|停供).{0,60}(?:unpaid|未缴|未付)", re.I,
)
DEADLINE = re.compile(r"\bdue\b|\bpay(?:ment|able)?\b|付款|缴费|截止|到期", re.I)
EXPLICIT_DUE = re.compile(
    rf"(?:\bdue(?:\s+date)?|\bpayable|\bpayment\s+date|\bpay\s+by|付款日(?:期)?|截止日期|到期日|请于)\s*[:：]?\s*({ISO_DATE})", re.I,
)
ISSUED = re.compile(rf"(?:\bissued|\bissue\s+date|开票日期|出具日期|签发日期)\s*[:：]?\s*({ISO_DATE})", re.I)


def explicit_due_dates(text):
    return EXPLICIT_DUE.findall(text)


def due_date_issue(contexts, value):
    """Inspect only the event's cited source lines, never unrelated event dates."""
    dates = set()
    for text in contexts:
        dates.update(explicit_due_dates(text))
        found = re.findall(ISO_DATE, text)
        # An issue date plus a due date is not itself a conflict. Alternatives are.
        if len(set(found)) > 1 and re.search(r"\bor\b|或者|或|冲突|conflict", text, re.I):
            return "CONFLICTING_DUE_DATE"
        if len(found) == 1 and DEADLINE.search(text):
            dates.update(found)
    if len(dates) > 1:
        return "CONFLICTING_DUE_DATE"
    if value not in dates and any(value in ISSUED.findall(text) for text in contexts):
        return "UNSUPPORTED_DUE_DATE"
    if any(INDIRECT.search(text) for text in contexts):
        return "INFERRED_DUE_DATE"
    return None
