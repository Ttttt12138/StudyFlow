"""Deliberately limited rule baseline, also used for transparent offline demos."""

import re
from decimal import Decimal

from studyflow_ai.models import CallRecord, Classification, PlanningContext
from studyflow_ai.provider_models import (
    ExtractedEvent,
    ExtractedField,
    Extraction,
    Proposals,
    ProposedPlan,
    ProposedStep,
)

KEYWORDS = {
    "tuition": r"tuition|semester fee",
    "rent": r"\brent\b|rental|lease",
    "utility": r"electricity|water bill|utility",
    "family_support": r"family|sponsor|parents",
    "living": r"grocery|groceries|food|transport",
}
FINANCIAL = r"THB|USD|EUR|\bpayment\b|\bbalance\b|\binvoice\b|\bfee\b|\btransfer\b"
SUSPICIOUS = (
    r"ignore (?:previous|all|prior) instructions|transfer all funds|system prompt|override.*policy"
)


def category_for(text):
    for category, pattern in KEYWORDS.items():
        if re.search(pattern, text, re.I):
            return category
    return "other" if re.search(FINANCIAL, text, re.I) else "irrelevant"


def financial_clues(text):
    return category_for(text) != "irrelevant"


def _match(pattern, text):
    found = re.search(pattern, text, re.I)
    return found.group(1).strip() if found else None


def _extract_line(text, locator):
    amount = _match(r"(?:THB|USD|EUR)\s*([\d,]+(?:\.\d+)?)", text)
    currency = _match(r"\b(THB|USD|EUR)\b", text)
    due = _match(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    payee = _match(r"Beneficiary:\s*([^.;\n]+)", text)
    invoice = _match(r"\b(INV-[\w-]+)\b", text)
    fields = {
        "amount": amount,
        "currency": currency,
        "due_date": due,
        "counterparty": payee,
        "invoice_id": invoice,
    }
    evidence = [ExtractedField(field=k, quote=v, locator=locator) for k, v in fields.items() if v]
    return ExtractedEvent(
        category=category_for(text),
        amount=amount.replace(",", "") if amount else None,
        currency=currency,
        date=None,
        due_date=due,
        counterparty=payee,
        invoice_id=invoice,
        evidence=evidence,
    )


class RuleProvider:
    def __init__(self, mode="rules"):
        self.mode = mode

    def record(self, purpose):
        return CallRecord(provider="rules", purpose=purpose, model="rules-1.0", mode=self.mode)

    def classify(self, text):
        category = category_for(text)
        distribution = {
            name: float(name == category) for name in (*KEYWORDS, "other", "irrelevant")
        }
        return Classification(
            category=category,
            probabilities=distribution,
            confidence=None,
            financial_relevance=float(category != "irrelevant"),
            anomaly=float(bool(re.search(SUSPICIOUS, text, re.I))),
            needs_planning=float("shortfall" in text.lower()),
        ), self.record("classify")

    def extract(self, text):
        events = []
        for index, line in enumerate(text.splitlines(), 1):
            locator = _match(r"^\[(.*?)\]", line) or f"line:{index}"
            if category_for(line) != "irrelevant":
                events.append(_extract_line(line, locator))
        return Extraction(events=events), self.record("extract")

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
