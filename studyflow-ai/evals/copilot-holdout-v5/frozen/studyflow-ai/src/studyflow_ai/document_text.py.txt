from typing import Protocol

from studyflow_ai.parsing import InputError, read_pdf


class DocumentTextExtractor(Protocol):
    def extract(self, kind: str, path: str) -> str: ...


class TextLayerExtractor:
    def extract(self, kind: str, path: str) -> str:
        if kind == "image":
            raise InputError("OCR_NOT_CONFIGURED")
        try:
            return read_pdf(path)
        except InputError as exc:
            if exc.code in {"PDF_NO_TEXT_LAYER", "PDF_PARTIAL_TEXT_LAYER"}:
                raise InputError("OCR_NOT_CONFIGURED") from None
            raise
