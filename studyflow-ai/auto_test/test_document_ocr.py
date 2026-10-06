import io
import json

import httpx
import pytest
from PIL import Image
from pypdf import PdfWriter

from studyflow_ai.gemini_ocr import GeminiDocumentTextExtractor, prepare_document
from studyflow_ai.parsing import InputError


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def response(text="学费 Tuition 10000 THB", **changes):
    page = {"number": 1, "text": text, "language": "zh-en", "uncertain": False}
    result = {
        "candidates": [
            {
                "finishReason": "STOP",
                "content": {"parts": [{"text": json.dumps({"pages": [page]})}]},
            }
        ]
    }
    return {**result, **changes}


def extractor(handler):
    return GeminiDocumentTextExtractor(
        api_key="test-secret",
        model="gemini-test",
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.parametrize(
    "transcription", ["学费 Tuition 10000 THB", "学费：10000 泰铢", "Tuition THB 10000"]
)
def test_bilingual_transcription_and_request_boundary(transcription):
    def handle(request):
        assert request.url.host == "generativelanguage.googleapis.com"
        assert "test-secret" not in str(request.url)
        assert request.headers["x-goog-api-key"] == "test-secret"
        body = json.loads(request.content)
        assert not body.get("tools")
        assert body["store"] is False
        assert "inlineData" in body["contents"][0]["parts"][0]
        return httpx.Response(200, json=response(text=transcription))

    result = extractor(handle).recognize(prepare_document("image", png()))
    assert result.text == "[page:1]\n" + transcription
    assert result.pages[0].language == "zh-en"
    assert result.rule_version == "gemini-ocr-v1"


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "OCR_AUTH_FAILED"),
        (429, "OCR_RATE_LIMITED"),
        (500, "OCR_UNAVAILABLE"),
        (302, "OCR_PROVIDER_ERROR"),
    ],
)
def test_http_errors_are_redacted_without_retry(status, code):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(status, text="test-secret private document")

    with pytest.raises(InputError, match=code):
        extractor(handle).recognize(prepare_document("image", png()))
    assert len(calls) == 1


@pytest.mark.parametrize(
    "body,code",
    [
        (response(candidates=[]), "OCR_BLOCKED"),
        (response(candidates=[{"finishReason": "MAX_TOKENS"}]), "OCR_INCOMPLETE"),
        (response(text=""), "OCR_EMPTY"),
        (
            {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "invalid"}]}}]},
            "OCR_INVALID_RESPONSE",
        ),
    ],
)
def test_unusable_output_fails_closed(body, code):
    with pytest.raises(InputError, match=code):
        extractor(lambda _: httpx.Response(200, json=body)).recognize(
            prepare_document("image", png())
        )


def test_timeout_does_not_expose_provider_exception():
    def handle(request):
        raise httpx.ReadTimeout("test-secret", request=request)

    with pytest.raises(InputError, match="^OCR_TIMEOUT$"):
        extractor(handle).recognize(prepare_document("image", png()))


def test_page_coverage_must_match_pdf():
    writer, buffer = PdfWriter(), io.BytesIO()
    writer.add_blank_page(width=100, height=100)
    writer.add_blank_page(width=100, height=100)
    writer.write(buffer)
    with pytest.raises(InputError, match="OCR_PAGE_MISMATCH"):
        extractor(lambda _: httpx.Response(200, json=response())).recognize(
            prepare_document("pdf", buffer.getvalue())
        )


@pytest.mark.parametrize(
    "kind,data", [("image", b"fake.png"), ("image", b"<svg/>"), ("pdf", b"fake.pdf")]
)
def test_mime_spoofing_is_rejected(kind, data):
    with pytest.raises(InputError):
        prepare_document(kind, data)


def test_active_pdf_and_encrypted_pdf_are_rejected():
    for encrypted in (False, True):
        writer, buffer = PdfWriter(), io.BytesIO()
        writer.add_blank_page(width=100, height=100)
        if encrypted:
            writer.encrypt("secret")
        else:
            writer.add_js("app.alert('not allowed')")
        writer.write(buffer)
        with pytest.raises(InputError, match="PDF_ENCRYPTED|PDF_ACTIVE_CONTENT"):
            prepare_document("pdf", buffer.getvalue())


def test_model_cannot_redirect_request():
    with pytest.raises(InputError, match="OCR_NOT_CONFIGURED"):
        GeminiDocumentTextExtractor(api_key="secret", model="../../other?key=x")


def test_image_metadata_is_removed():
    from PIL.PngImagePlugin import PngInfo

    metadata = PngInfo()
    metadata.add_text("private", "not-needed-for-recognition")
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(buffer, format="PNG", pnginfo=metadata)
    clean = prepare_document("image", buffer.getvalue())
    assert b"not-needed-for-recognition" not in clean.data
    assert Image.open(io.BytesIO(clean.data)).info == {}


def test_unsupported_language_is_not_silently_translated():
    body = response()
    pages = {
        "pages": [
            {"number": 1, "text": "unsupported", "language": "unsupported", "uncertain": True}
        ]
    }
    body["candidates"][0]["content"]["parts"][0]["text"] = json.dumps(pages)
    with pytest.raises(InputError, match="OCR_UNSUPPORTED_LANGUAGE"):
        extractor(lambda _: httpx.Response(200, json=body)).recognize(
            prepare_document("image", png())
        )


def test_oversized_response_is_not_parsed():
    with pytest.raises(InputError, match="OCR_RESPONSE_TOO_LARGE"):
        extractor(lambda _: httpx.Response(200, content=b"x" * (1024 * 1024 + 1))).recognize(
            prepare_document("image", png())
        )


def test_demo_fixtures_are_hashed_and_pdf_has_no_text_layer():
    from hashlib import sha256
    from pathlib import Path

    from pypdf import PdfReader

    directory = Path(__file__).resolve().parents[2] / "examples/ocr/v1"
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["synthetic"] is True
    assert {r["language"] for r in manifest["files"]} == {"en", "zh", "zh-en"}
    for row in manifest["files"]:
        data = (directory / row["path"]).read_bytes()
        assert sha256(data).hexdigest() == row["sha256"]
        assert prepare_document(row["kind"], data).page_count == 1
        if row["kind"] == "pdf":
            assert not PdfReader(io.BytesIO(data)).pages[0].extract_text()


def test_pdf_file_attachment_annotation_is_rejected():
    from pypdf.generic import ArrayObject, DictionaryObject, NameObject

    writer, buffer = PdfWriter(), io.BytesIO()
    page = writer.add_blank_page(width=100, height=100)
    page[NameObject("/Annots")] = ArrayObject(
        [
            DictionaryObject(
                {
                    NameObject("/Type"): NameObject("/Annot"),
                    NameObject("/Subtype"): NameObject("/FileAttachment"),
                }
            )
        ]
    )
    writer.write(buffer)
    with pytest.raises(InputError, match="PDF_ACTIVE_CONTENT"):
        prepare_document("pdf", buffer.getvalue())
