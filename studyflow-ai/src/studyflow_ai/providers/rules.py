"""Deliberately limited rule baseline, also used for transparent offline demos."""

import re
from decimal import Decimal

from studyflow_ai.date_semantics import due_date_issue, explicit_due_dates
from studyflow_ai.instruction_safety import SUSPICIOUS as SUSPICIOUS
from studyflow_ai.instruction_safety import untrusted_instructions
from studyflow_ai.models import CallRecord, Classification, PlanningContext
from studyflow_ai.provider_models import (
    ExtractedEvent,
    ExtractedField,
    Extraction,
    Proposals,
    ProposedPlan,
    ProposedStep,
)
from studyflow_ai.settlements import mask_components

# English keywords are word-bounded: a bare "lease" used to match "Please pay".
KEYWORDS = {
    "tuition": r"\btuition\b|\bsemester fees?\b|学费|学期费用",
    "rent": r"\brent\b|\brental\b|\blease\b|\bsublet(?:ting)?\b|房租|租金|租赁费用|转租",
    "utility": r"\belectricity\b|\bwater bills?\b|\butility\b|电费|水费|水电费",
    "family_support": (
        r"\bfamily\b|\bsponsors?\b|\bparents\b|父母|家长|资助"
        r"|\b(?:brother|sister|uncle|aunt|grandparents?)\b[^.\n]{0,70}"
        r"\b(?:promises?|sends?|supports?|transfers?|THB|USD|EUR)\b"
        r"|(?:爸妈|哥哥|姐姐|叔叔|阿姨|祖父母).{0,30}(?:承诺|汇款|生活费|转账)"
    ),
    "living": r"\bgrocery\b|\bgroceries\b|\bfood\b|\btransport\b|食品|交通|生鲜|菜钱",
}
FINANCIAL = r"THB|USD|EUR|\bpayment\b|\bbalance\b|\binvoice\b|\bfee\b|\btransfer\b"
# Only copular negation ("this is not tuition") is masked, up to the end of the clause;
# imperative text such as "do not pay tuition late" keeps its category.
NEGATED = (
    r"(?:\b(?:is|are|was|were)\s+not\b|\b(?:isn't|aren't|wasn't|weren't)\b|不是|并非|不属于|而非)"
    r"[^.;。；!?！？\n]*"
)
LABEL = r"^\s*(?:category|类别|类型)\s*[:：]\s*(.+)$"
AMOUNT = r"(?:THB|USD|EUR)\s*([\d,]+(?:\.\d+)?)"
DUE = r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)"
# Structural money signal for text without currency or keywords, e.g. "每月5386.75，首次付款日为…".
MONEY = (
    # Bare decimals need three integer digits so versions ("1.13") and scores ("87.50") stay out.
    r"(?<![\d.-])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?![\d-])|(?<![\d.-])\d{3,}\.\d{2}(?![\d.-])"
    r"|(?:price|cost|amount|total|fare|premium|charge|per month|金额|价格|费用|租金|每月|罚款)\s*[:：]?\s*\d"
)
PAYMENT = r"\bpay|\bpayable\b|\bdue\b|\bsettle|付款|支付|缴|交费|交租|结清|到期"
CONFIDENT, UNSURE = 0.95, 0.6


def _keyword_category(text):
    text = re.sub(NEGATED, " ", text, flags=re.I)
    for category, pattern in KEYWORDS.items():
        if re.search(pattern, text, re.I):
            return category
    return None


def _labelled_category(text):
    for label in re.findall(LABEL, text, re.I | re.M):
        if category := _keyword_category(label):
            return category
    return None


def structural_money(text):
    return bool(re.search(MONEY, text, re.I)) and bool(
        re.search(DUE, text) or re.search(PAYMENT, text, re.I)
    )


def category_for(text):
    if category := _labelled_category(text) or _keyword_category(text):
        return category
    financial = re.search(FINANCIAL, text, re.I) or structural_money(text)
    return "other" if financial else "irrelevant"


def financial_clues(text):
    return category_for(text) != "irrelevant"


def confidence_for(text, category):
    """Rules are only confident about one unambiguous keyword category or an explicit label.

    A generic "other" guess or competing keyword categories must stay below the router's
    probability gate so the material goes to review instead of being auto-processed.
    """
    if category == "irrelevant":
        return 1.0  # Skipping still needs no financial clue at all; see the router.
    if _labelled_category(text):
        return CONFIDENT
    masked = re.sub(NEGATED, " ", text, flags=re.I)
    hits = [name for name, pattern in KEYWORDS.items() if re.search(pattern, masked, re.I)]
    return CONFIDENT if category != "other" and len(hits) == 1 else UNSURE


def _match(pattern, text):
    found = re.search(pattern, text, re.I)
    return found.group(1).strip() if found else None


def _line_fields(text):
    amount = _match(AMOUNT, text)
    if amount is None:
        amount = _match(r"(?:金额|数额|amount)\s*([\d,]+(?:\.\d+)?)", text)
    deadlines = explicit_due_dates(text)
    return {
        "amount": amount,
        "currency": _match(r"(?<![A-Za-z])(THB|USD|EUR)(?![A-Za-z])", text),
        "due_date": deadlines[0] if deadlines else _match(DUE, text),
        "counterparty": _match(r"Beneficiary:\s*([^.;\n]+)", text),
        "invoice_id": _match(r"\b(INV-[\w-]+)\b", text),
    }


def _event(category, fields, evidence):
    amount = fields.get("amount")
    return ExtractedEvent(
        category=category,
        amount=amount.replace(",", "") if amount else None,
        currency=fields.get("currency"),
        date=None,
        due_date=fields.get("due_date"),
        counterparty=fields.get("counterparty"),
        invoice_id=fields.get("invoice_id"),
        evidence=evidence,
    )


def _extract_events(text):
    """Group values split across lines into one event per amount.

    A header or ``Category:`` line without values sets the category for the value lines
    below it, and a date on its own line joins the open event when that event has no date.
    """
    document = category_for(text)
    if document == "irrelevant":
        return []
    events, context, current = [], None, None

    def flush():
        # Fragments with neither an amount nor their own category (e.g. an issue date) are dropped.
        if current and (current["fields"].get("amount") or current["category"]):
            category = current["category"] or current["context"] or document
            events.append(_event(category, current["fields"], current["evidence"]))

    for index, line in enumerate(mask_components(text).splitlines(), 1):
        locator = _match(r"^\[(.*?)\]", line) or f"line:{index}"
        line = re.sub(r"^\[(?:line|page):\d+\]\s?", "", line)
        own = _keyword_category(line)
        if label := _match(LABEL, line):
            own = _keyword_category(label) or own
        fields = {k: v for k, v in _line_fields(line).items() if v}
        if not fields:
            context = own or context
            continue
        if current:
            clash = any(k in current["fields"] for k in ("amount", "invoice_id", "due_date") if k in fields)
            if clash and not own and "amount" not in fields and "invoice_id" not in fields:
                if "due_date" in fields:
                    current["evidence"].append(ExtractedField(field="due_date", quote=line, locator=locator))
                continue  # A second bare date belongs to no new event.
            if clash or (own and current["category"] not in (None, own)):
                flush()
                current = None
        if current is None:
            current = {"category": None, "context": context, "fields": {}, "evidence": []}
        for key, value in fields.items():
            current["fields"].setdefault(key, value)
            current["evidence"].append(ExtractedField(field=key, quote=line if key == "due_date" else value, locator=locator))
        current["category"] = current["category"] or own
    flush()
    if not events:
        # Keep a value-less candidate so incomplete financial material still reaches review.
        events.append(_event(document, current["fields"] if current else {}, current["evidence"] if current else []))
    return events


class RuleProvider:
    def __init__(self, mode="rules"):
        self.mode = mode

    def record(self, purpose):
        return CallRecord(provider="rules", purpose=purpose, model="rules-1.5-safe-settlements", mode=self.mode)

    def classify(self, text):
        category = category_for(text)
        names = (*KEYWORDS, "other", "irrelevant")
        top = confidence_for(text, category)
        distribution = {
            name: top if name == category else (1 - top) / (len(names) - 1) for name in names
        }
        attack = float(untrusted_instructions(text))
        conflict = float(any(due_date_issue([line], "") == "CONFLICTING_DUE_DATE"
                             for line in text.splitlines()))
        return Classification(
            category=category,
            probabilities=distribution,
            confidence=top,
            financial_relevance=float(category != "irrelevant"),
            anomaly=max(attack, conflict),
            instruction_risk=attack,
            payment_conflict=conflict,
            needs_planning=float("shortfall" in text.lower()),
        ), self.record("classify")

    def extract(self, text):
        return Extraction(events=_extract_events(text)), self.record("extract")

    def plan(self, context: PlanningContext):
        target = context.forecast.funding_target
        buffer = context.forecast.buffer
        explanation = f"Request {target:.2f} THB; minimum shortfall {context.risk.gap:.2f} THB."
        if buffer > Decimal("0"):
            explanation += f" Includes a backend-provided buffer of {buffer:.2f} THB."
        plan = ProposedPlan(
            kind="family_support",
            required_funding=f"{target:.2f}",
            steps=[
                ProposedStep(
                    action="Request family funding", by_date=context.now.date().isoformat()
                ),
                ProposedStep(
                    action="Verify receipt and request a fresh forecast before payment",
                    by_date=context.risk.due_date.isoformat(),
                ),
            ],
            prerequisites=[
                "Sponsor agreement",
                "Funds actually received",
                "Fresh forecast and payment authorization",
            ],
            source_refs=[context.risk.risk_id, *context.risk.source_refs],
            explanation=explanation,
        )
        return Proposals(plans=[plan]), self.record("plan")

    def close(self):
        pass
