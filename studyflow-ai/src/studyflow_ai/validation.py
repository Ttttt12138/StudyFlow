import hashlib
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from studyflow_ai.models import CandidateEvent, Evidence, Issue, Status
from studyflow_ai.normalization import date_in_quote, parse_money


def issue(code, field=None, message=None):
    return Issue(code=code, field=field, message=message or code.replace("_", " ").lower())


def _value(raw, field, issues):
    value = getattr(raw, field)
    if value is None:
        return None
    try:
        if field == "amount":
            return parse_money(value)
        if field in ("date", "due_date"):
            return date.fromisoformat(value)
        return value
    except (ValueError, InvalidOperation):
        issues.append(issue("INVALID_FIELD", field))
        return None


def evidence_matches(value, evidence, text):
    if not evidence.quote or evidence.quote not in text:
        return False
    if isinstance(value, Decimal):
        numbers = re.findall(r"(?<!\d)[+-]?\d[\d,]*(?:\.\d+)?", evidence.quote)
        return any(Decimal(number.replace(",", "")) == value for number in numbers)
    if isinstance(value, date):
        return date_in_quote(value, evidence.quote)
    return str(value).casefold() in evidence.quote.casefold()


def _located_text(text, locator):
    if locator.startswith("line:"):
        try:
            index = int(locator.split(":")[1]) - 1
            return text.splitlines()[index] if index >= 0 else ""
        except (ValueError, IndexError):
            return ""
    if locator.startswith("page:"):
        marker = f"[{locator}] "
        if marker in text:
            return text.split(marker, 1)[1].split("[page:", 1)[0]
    return ""


def build_candidate(raw, source_text, context):
    source_id, text = source_text
    issues = []
    fields = {
        key: _value(raw, key, issues)
        for key in ("amount", "currency", "date", "due_date", "counterparty", "invoice_id")
    }
    evidence = [Evidence(source_id=source_id, **ev.model_dump()) for ev in raw.evidence]
    candidate = CandidateEvent(category=raw.category, **fields, evidence=evidence, issues=issues)
    for key, value in fields.items():
        if value is not None and not any(
            ev.field == key and evidence_matches(value, ev, _located_text(text, ev.locator))
            for ev in evidence
        ):
            candidate.issues.append(issue("UNSUPPORTED_FIELD", key))
    _required_fields(candidate)
    if context.known_beneficiaries and candidate.counterparty not in context.known_beneficiaries:
        candidate.issues.append(issue("BENEFICIARY_MISMATCH", "counterparty"))
    trusted = source_id in context.verified_source_ids and context.verification_reference
    if trusted and not candidate.issues:
        candidate.verification_reference = context.verification_reference
        candidate.confidence_type = "VERIFIED"
        candidate.status = Status.READY
    elif not trusted:
        candidate.issues.append(issue("SOURCE_UNCONFIRMED"))
    return candidate


def _required_fields(candidate):
    fields = ["amount", "currency"]
    fields.append(
        "date" if candidate.category == "family_support" and candidate.date else "due_date"
    )
    if candidate.category != "family_support":
        fields.append("counterparty")
    for key in fields:
        value = getattr(candidate, key)
        if value is None or (isinstance(value, str) and not value.strip()):
            candidate.issues.append(issue("MISSING_FIELD", key))
    if candidate.amount is not None and candidate.amount <= 0:
        candidate.issues.append(issue("NONPOSITIVE_OBLIGATION", "amount"))
    if candidate.currency is not None and candidate.currency != "THB":
        candidate.issues.append(issue("UNSUPPORTED_CURRENCY", "currency"))


def mark_duplicates(items, key):
    seen = {}
    for item in items:
        identity, exact = key(item)
        if identity in seen:
            code = "DUPLICATE_IDENTIFIER" if exact else "POSSIBLE_DUPLICATE"
            for duplicate in (item, seen[identity]):
                duplicate.status = Status.NEEDS_REVIEW
                duplicate.issues.append(issue(code))
        else:
            seen[identity] = item


def transaction_key(tx):
    if tx.transaction_id:
        return (tx.account_id, tx.transaction_id), True
    return (tx.account_id, tx.date, tx.amount, tx.currency, tx.counterparty, tx.description), False


def candidate_key(candidate):
    if candidate.invoice_id:
        return (candidate.counterparty, candidate.invoice_id), True
    value = (
        candidate.category,
        candidate.amount,
        candidate.currency,
        candidate.due_date,
        candidate.date,
        candidate.counterparty,
    )
    return hashlib.sha256(str(value).encode()).hexdigest(), False
