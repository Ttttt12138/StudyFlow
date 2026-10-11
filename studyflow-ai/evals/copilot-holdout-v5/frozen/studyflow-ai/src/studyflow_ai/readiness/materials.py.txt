import hashlib
import io
from datetime import datetime, timezone
from html.parser import HTMLParser

from pypdf import PdfReader

from studyflow_ai.models import Source
from studyflow_ai.parsing import MAX_TEXT, InputError, read_source
from studyflow_ai.readiness.models import Provenance


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden, self.parts = 0, []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "template"):
            self.hidden += 1
        if not self.hidden and tag in ("p", "div", "br", "tr", "li", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "template"):
            self.hidden = max(0, self.hidden - 1)
        if not self.hidden and tag in ("td", "th"):
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def pdf_text(data):
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise InputError("PDF_ENCRYPTED")
        if len(reader.pages) > 50:
            raise InputError("PDF_TOO_MANY_PAGES")
        pages = [(p.extract_text() or "").strip() for p in reader.pages]
        if not any(pages):
            raise InputError("PDF_NO_TEXT_LAYER")
        if not all(pages):
            raise InputError("PDF_PARTIAL_TEXT_LAYER")
        return "\n".join(f"[page:{i}]\n{page}" for i, page in enumerate(pages, 1))
    except InputError:
        raise
    except Exception:
        raise InputError("PDF_DAMAGED") from None


def _web_text(response):
    media = response.headers.get("content-type", "").split(";")[0].lower()
    if media == "application/pdf":
        return pdf_text(response.body), media
    if media not in ("text/html", "text/plain"):
        raise InputError("UNSUPPORTED_MEDIA_TYPE")
    try:
        text = response.body.decode("utf-8-sig")
    except UnicodeError:
        raise InputError("INVALID_UTF8") from None
    if media == "text/html":
        parser = VisibleText()
        parser.feed(text)
        text = "\n".join(
            line.strip() for line in "".join(parser.parts).splitlines() if line.strip()
        )
    return text, media


def read_material(source, fetcher):
    final_url = None
    if source.kind == "url":
        if not source.url:
            raise InputError("URL_REQUIRED")
        final_url, response = fetcher.fetch(source.url)
        text, media = _web_text(response)
        content = response.body
    else:
        text = read_source(
            Source(
                source_id=source.source_id,
                kind="pdf" if source.kind == "pdf" else "email",
                text=source.text,
                path=source.path,
            )
        )
        content, media = (
            text.encode("utf-8"),
            "application/pdf" if source.kind == "pdf" else "text/plain",
        )
    if not text.strip() or len(text) > MAX_TEXT:
        raise InputError("EMPTY_INPUT" if not text.strip() else "INPUT_TOO_LARGE")
    provenance = Provenance(
        source_id=source.source_id,
        final_url=final_url,
        fetched_at=datetime.now(timezone.utc),
        content_sha256=hashlib.sha256(content).hexdigest(),
        media_type=media,
    )
    return text, provenance
