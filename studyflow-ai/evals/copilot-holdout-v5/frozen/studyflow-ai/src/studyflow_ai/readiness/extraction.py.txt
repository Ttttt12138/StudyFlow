import re
from datetime import date
from decimal import Decimal, InvalidOperation

from pydantic import ValidationError

from studyflow_ai.models import Evidence, Status
from studyflow_ai.normalization import date_in_quote
from studyflow_ai.parsing import InputError
from studyflow_ai.providers.base import ProviderFailure
from studyflow_ai.providers.rules import SUSPICIOUS
from studyflow_ai.readiness.completeness import issue
from studyflow_ai.readiness.materials import read_material
from studyflow_ai.readiness.models import CostItem, ExtractionResult, SemesterProfile

PROFILE_FIELDS = {
    "school",
    "campus",
    "country",
    "program",
    "student_type",
    "start_date",
    "end_date",
}
COST_FIELDS = {
    "amount",
    "lower",
    "upper",
    "currency",
    "period",
    "due_date",
    "year",
    "campus",
    "paid",
    "refundable",
    "invoice_id",
}
PERIOD_WORDS = {
    "once": r"once|one.time|一次|押金|deposit|settlement|安置",
    "monthly": r"monthly|per month|/month|每月|月付",
    "semester": r"semester|term|学期",
    "yearly": r"yearly|annual|per year|每年|年度",
}
CURRENCY_WORDS = {
    "THB": "泰铢",
    "CNY": "人民币",
    "USD": "美元",
    "EUR": "欧元",
    "JPY": "日元",
    "GBP": "英镑",
    "KWD": "科威特第纳尔",
}


def _located_quote(raw, lines):
    match = re.fullmatch(r"line:(\d+)", raw.locator)
    if not match or not raw.quote:
        return False
    index = int(match[1]) - 1
    return 0 <= index < len(lines) and raw.quote in lines[index]


def _supported(raw):
    field, value, quote = raw.field, raw.value.strip(), raw.quote
    if field in ("amount", "lower", "upper", "year"):
        numbers = re.findall(r"(?<![\d.])[+-]?\d[\d,]*(?:\.\d+)?", quote)
        return any(Decimal(n.replace(",", "")) == Decimal(value) for n in numbers)
    if field.endswith("date"):
        day = date.fromisoformat(value)
        return date_in_quote(day, quote) or f"{day.year}年{day.month}月{day.day}日" in quote
    if field == "period":
        return value in PERIOD_WORDS and bool(re.search(PERIOD_WORDS[value], quote, re.I))
    if field == "currency":
        return bool(re.search(rf"\b{re.escape(value)}\b", quote)) or bool(
            CURRENCY_WORDS.get(value) and CURRENCY_WORDS[value] in quote
        )
    if field in ("paid", "refundable"):
        if value == "true" and re.search(r"non.refundable|不可退|unpaid|未支付|未缴", quote, re.I):
            return False
        if re.search(rf"\b{field}\s*=\s*{value}\b", quote, re.I):
            return value in ("true", "false")
        words = {
            ("paid", "true"): r"\bpaid in full\b|已支付|已缴清",
            ("paid", "false"): r"\bunpaid\b|未支付|未缴",
            ("refundable", "true"): r"fully refundable|可退还",
            ("refundable", "false"): r"non.refundable|不可退",
        }
        return bool(re.search(words.get((field, value), r"(?!)"), quote, re.I))
    return bool(value) and value.casefold() in quote.casefold()


def validated_fields(raw_fields, allowed, source_data):
    source_id, text, issues = source_data
    values, evidence = {}, []
    for raw in raw_fields:
        locator = raw.locator.strip().removeprefix("[").removesuffix("]")
        quote = raw.quote.removeprefix(f"[{locator}] ").strip()
        raw = raw.model_copy(update={"locator": locator, "quote": quote})
        if raw.field not in allowed:
            issues.append(issue("UNKNOWN_FIELD", raw.field))
            continue
        try:
            supported = _located_quote(raw, text.splitlines()) and _supported(raw)
        except (ValueError, InvalidOperation):
            supported = False
        if not supported:
            problem = issue("UNSUPPORTED_FIELD", raw.field)
            problem.locator = raw.locator
            issues.append(problem)
            continue
        if raw.field in values:
            issues.append(issue("CONFLICTING_FIELD", raw.field))
            continue
        value = raw.value.strip()
        values[raw.field] = (value == "true") if raw.field in ("paid", "refundable") else value
        evidence.append(
            Evidence(source_id=source_id, field=raw.field, quote=raw.quote, locator=raw.locator)
        )
    return values, evidence


def build_draft(raw, source_data, result):
    values, evidence = validated_fields(raw.profile, PROFILE_FIELDS, source_data)
    try:
        result.draft.profile = SemesterProfile(**values, evidence=evidence)
    except ValidationError:
        result.issues.append(issue("INVALID_PROFILE"))
    for item in raw.costs:
        values, evidence = validated_fields(item.fields, COST_FIELDS, source_data)
        try:
            cost = CostItem(
                category=item.category, **values, evidence=evidence, source_refs=[source_data[0]]
            )
            result.draft.costs.append(cost)
            for field in ("currency", "period", "year"):
                if getattr(cost, field) is None:
                    result.issues.append(issue("MISSING_COST_FIELD", field))
            if cost.amount is None and (cost.lower is None or cost.upper is None):
                result.issues.append(issue("MISSING_COST_FIELD", "amount"))
        except (ValidationError, InvalidOperation):
            result.issues.append(issue("INVALID_COST", item.category))


class SemesterExtractor:
    def __init__(self, provider, fetcher, classifier=None):
        self.provider, self.fetcher, self.classifier = provider, fetcher, classifier

    def extract(self, source, context):
        result = ExtractionResult(source_refs=[source.source_id])
        try:
            text, provenance = read_material(source, self.fetcher)
            result.draft.provenance.append(provenance)
            if context.language not in ("en", "zh", "zh-CN", "zh-TW"):
                result.issues.append(issue("LANGUAGE_NOT_EVALUATED"))
            if re.search(SUSPICIOUS + r"|忽略.*指令|批准.*付款", text, re.I):
                result.route = "REVIEW"
                result.issues.append(issue("UNTRUSTED_INSTRUCTIONS"))
            else:
                self._extract(text, source.source_id, result)
        except (InputError, OSError) as exc:
            result.issues.append(
                issue(exc.code if isinstance(exc, InputError) else "SOURCE_UNREADABLE")
            )
            result.status = Status.REJECTED
        except ProviderFailure as exc:
            result.calls.append(exc.record)
            result.issues.append(issue(exc.code))
        if result.status != Status.REJECTED:
            result.status = Status.NEEDS_REVIEW
        return result

    def _extract(self, text, source_id, result):
        # Jev may flag review, but cannot discard admission facts lacking money.
        if self.classifier:
            try:
                classification, record = self.classifier.classify(text)
                result.calls.append(record)
                if classification.anomaly >= 0.5:
                    result.issues.append(issue("POSSIBLE_ANOMALY"))
            except ProviderFailure as exc:
                result.calls.append(exc.record)
                result.issues.append(issue("CLASSIFIER_UNAVAILABLE"))
        prompt = "\n".join(f"[line:{i}] {line}" for i, line in enumerate(text.splitlines(), 1))
        raw, record = self.provider.extract(prompt)
        result.calls.append(record)
        build_draft(raw, (source_id, text, result.issues), result)
        result.issues.append(issue("SOURCE_UNCONFIRMED"))
