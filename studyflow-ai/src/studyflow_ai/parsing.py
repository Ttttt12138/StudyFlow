import csv
import io
from pathlib import Path

from pydantic import ValidationError

from studyflow_ai.models import Issue, Source, Transaction
from studyflow_ai.normalization import parse_money

MAX_BYTES = 5 * 1024 * 1024
MAX_TEXT = 100_000


class InputError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def read_source(source: Source) -> str:
    if source.kind == "pdf":
        return read_pdf(source.path)
    text = source.text
    if text is None:
        if not source.path:
            raise InputError("EMPTY_INPUT")
        if Path(source.path).stat().st_size > MAX_BYTES:
            raise InputError("INPUT_TOO_LARGE")
        try:
            text = Path(source.path).read_text(encoding="utf-8-sig")
        except UnicodeError:
            raise InputError("INVALID_UTF8") from None
    if not text.strip():
        raise InputError("EMPTY_INPUT")
    if len(text) > MAX_TEXT:
        raise InputError("INPUT_TOO_LARGE")
    return text.lstrip("\ufeff")


def read_pdf(path) -> str:
    from pypdf import PdfReader

    if not path:
        raise InputError("PDF_PATH_REQUIRED")
    if Path(path).stat().st_size > MAX_BYTES:
        raise InputError("INPUT_TOO_LARGE")
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise InputError("PDF_ENCRYPTED")
        if len(reader.pages) > 50:
            raise InputError("PDF_TOO_MANY_PAGES")
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
    except InputError:
        raise
    except Exception:
        raise InputError("PDF_DAMAGED") from None
    if not pages or not any(pages):
        raise InputError("PDF_NO_TEXT_LAYER")
    if any(not page for page in pages):
        raise InputError("PDF_PARTIAL_TEXT_LAYER")
    text = "\n".join(f"[page:{i}] {page}" for i, page in enumerate(pages, 1))
    if len(text) > MAX_TEXT:
        raise InputError("INPUT_TOO_LARGE")
    return text


def parse_csv(text: str, source_id: str):
    reader = csv.DictReader(io.StringIO(text))
    required = {"account_id", "date", "amount", "currency", "counterparty", "description"}
    if not required.issubset(reader.fieldnames or []):
        raise InputError("CSV_MISSING_COLUMNS")
    transactions, issues = [], []
    for row in reader:
        locator = f"row:{reader.line_num}"
        try:
            transactions.append(_transaction(row, source_id, locator))
        except (ValidationError, ValueError, TypeError):
            issues.append(
                Issue(
                    code="INVALID_CSV_ROW",
                    locator=locator,
                    message="Check required fields, ISO date, THB currency and monetary precision.",
                )
            )
    if not transactions and not issues:
        raise InputError("CSV_EMPTY")
    return transactions, issues


def _transaction(row, source_id, locator):
    if None in row or any(
        not (row.get(k) or "").strip()
        for k in ("account_id", "date", "amount", "currency", "counterparty", "description")
    ):
        raise ValueError("Missing or extra CSV fields")
    fields = {k: (v or "").strip() for k, v in row.items()}
    fields["amount"] = parse_money(fields["amount"])
    fields["transaction_id"] = fields.get("transaction_id") or None
    return Transaction(**fields, source_id=source_id, locator=locator)
