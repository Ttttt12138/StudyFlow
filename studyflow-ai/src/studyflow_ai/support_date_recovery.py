"""Recover only uniquely evidenced promise dates; never confirm cash receipt."""

import re
from datetime import date
from decimal import Decimal

from studyflow_ai.date_semantics import ISO_DATE
from studyflow_ai.models import Evidence, Issue, Status

CLAUSES = re.compile(r"\.(?=\s|$)|[。！？!?;；\n]")
MONEY = re.compile(r"(?<![A-Za-z])([A-Z]{3})\s*([+-]?\d[\d,]*(?:\.\d+)?)", re.I)
SUPPORT = re.compile(r"\b(?:family|parents?|sponsors?|patron|mother|father|brother|sister)\b|资助|父母|家人|赞助|爸妈", re.I)
PROMISE = re.compile(r"\b(?:pledges?|promises?|scheduled|expected)\b|\bwill\s+(?:send|transfer)\b|承诺|预计|定于|将于", re.I)
DATE_LINK = re.compile(
    rf"(?:\bon\b|\bby\b|\bscheduled(?:\s+(?:on|for))?|\bexpected(?:\s+(?:on|for))?|于|预计(?:到账|转账|汇款)?)\s*[:：]?\s*({ISO_DATE})", re.I,
)
UNRELATED = re.compile(r"\b(?:issued|invoice|signed|meeting|birthday|due|paid|received)\b|开票|出具|签发|签署|会议|生日|已到账|已汇款", re.I)
CANCELLED = re.compile(r"\b(?:cancelled|canceled|withdrawn|revoked|no longer|will not|does not|not scheduled)\b|取消|撤回|不再|不会|不承诺|未承诺", re.I)
ALTERNATIVE = re.compile(r"\bor\b|或者|或|冲突|conflict", re.I)
NOT_RECEIVED = re.compile(r"\bnot\s+(?:yet\s+)?(?:cash\s+)?(?:received|paid)\b", re.I)


def _eligible(candidate):
    invalid = {"UNSUPPORTED_FIELD", "INVALID_FIELD", "CONFLICTING_DUE_DATE", "UNSUPPORTED_DUE_DATE"}
    return (candidate.category == "family_support" and candidate.due_date is None
            and candidate.date is None and candidate.amount is not None and candidate.amount > 0
            and bool(candidate.currency) and not any(
                i.code in invalid and i.field in {"amount", "currency", "date", "due_date"}
                for i in candidate.issues))


def _same_money(clause, candidate):
    amounts = MONEY.findall(clause)
    return (len(amounts) == 1 and amounts[0][0].upper() == candidate.currency.upper()
            and Decimal(amounts[0][1].replace(",", "")) == candidate.amount)


def _date_binds_to_amount(clause):
    money, linked = MONEY.search(clause), DATE_LINK.search(clause)
    if not money or not linked:
        return False
    if money.end() <= linked.start():
        gap = clause[money.end():linked.start()]
        return bool(re.fullmatch(
            r"\s*(?:to\s+(?:the\s+)?(?:student|beneficiary|recipient|me|us))?\s*[,，]?\s*",
            gap, re.I,
        ))
    gap = clause[linked.end():money.start()]
    return bool(re.fullmatch(r"(?:向学生|向我|给学生|给我)?(?:转账|汇款|资助)\s*", gap))


def _promise_date(clause, candidate):
    if (not SUPPORT.search(clause) or not PROMISE.search(clause)
            or UNRELATED.search(NOT_RECEIVED.sub("", clause)) or ALTERNATIVE.search(clause)
            or not _same_money(clause, candidate) or not _date_binds_to_amount(clause)):
        return None
    dates = re.findall(ISO_DATE, clause)
    linked = DATE_LINK.findall(clause)
    if len(set(dates)) != 1 or linked != dates:
        return None
    try:
        return date.fromisoformat(dates[0])
    except ValueError:
        return None


def _matches(candidate, contexts):
    matches = {}
    for evidence, scope in contexts:
        if not evidence.quote or evidence.quote not in scope or CANCELLED.search(scope):
            continue
        for part in CLAUSES.split(scope):
            clause = part.strip()
            if evidence.quote not in clause:
                continue
            if day := _promise_date(clause, candidate):
                matches[(clause, evidence.locator)] = (day, Evidence(
                    source_id=evidence.source_id, field="due_date", quote=clause,
                    locator=evidence.locator.strip("[]"),
                ))
    return list(matches.values())


def recover_support_date(candidate, contexts):
    if not _eligible(candidate):
        return
    matches = _matches(candidate, contexts)
    if len(matches) != 1:
        return
    candidate.due_date, evidence = matches[0]
    candidate.evidence.append(evidence)
    candidate.status = Status.NEEDS_REVIEW
    candidate.issues.append(Issue(
        code="SOURCE_DATE_RECOVERED", field="due_date", locator=evidence.locator,
        message="Expected transfer date recovered from source; manual review required, not receipt confirmation",
    ))
