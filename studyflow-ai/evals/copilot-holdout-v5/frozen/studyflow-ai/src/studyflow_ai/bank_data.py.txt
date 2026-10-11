"""Provider-neutral, read-only bank data boundary. CSV does not verify a bank balance."""

import re
from typing import Protocol

from studyflow_ai.parsing import InputError, parse_csv

RULE_VERSION = "spending-1.0"
CATEGORIES = (
    "Rent",
    "Food",
    "Transport",
    "Mobile",
    "Utilities",
    "Subscription",
    "Transfer",
    "Income",
    "Refund",
    "Other",
)
RULES = (
    ("Transfer", r"internal transfer|own account|transfer|转账|โอน"),
    ("Refund", r"refund|reversal|退款"),
    ("Rent", r"rent|rental|lease|condo|房租|ค่าเช่า"),
    ("Mobile", r"mobile|telephone|telecom|ais|dtac|通信|话费"),
    ("Subscription", r"subscription|netflix|spotify|订阅"),
    ("Utilities", r"electric|water bill|utilities|水电"),
    ("Transport", r"transport|bus|bts|mrt|taxi|grab ride|交通"),
    ("Food", r"food|cafe|lunch|dinner|restaurant|grocery|餐|อาหาร"),
)


class BankDataAdapter(Protocol):
    def parse(self, content: bytes, source_id: str = "") -> tuple[list, list]: ...


class CsvTransactionAdapter:
    def parse(self, content: bytes, source_id: str = "") -> tuple[list, list]:
        if not content or len(content) > 5 * 1024 * 1024:
            raise InputError("FILE_SIZE_LIMIT")
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise InputError("INVALID_UTF8") from None
        rows, issues = parse_csv(text, source_id)
        if len(rows) + len(issues) > 10000:
            raise InputError("CSV_ROW_LIMIT")
        if any(
            len(t.account_id) > 150
            or len(t.counterparty) > 300
            or len(t.description) > 2000
            or len(t.transaction_id or "") > 200
            or abs(t.amount) > 99999999999999
            for t in rows
        ):
            raise InputError("CSV_FIELD_LIMIT")
        return rows, [issue.model_dump(mode="json") for issue in issues]


def classify_transaction(tx):
    text = tx.counterparty + " " + tx.description
    category, basis, confidence = "Other", "No matching rule; review required", 0.2
    for name, pattern in RULES:
        if re.search(pattern, text, re.I):
            category, basis, confidence = name, pattern, 0.85
            break
    if tx.amount > 0 and category not in {"Transfer", "Refund"}:
        category, basis, confidence = "Income", "Positive amount", 0.7
    return {
        "category": category,
        "basis": basis,
        "confidence": confidence,
        "rule_version": RULE_VERSION,
        "source_type": "inferred",
    }
