from pathlib import Path

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from studyflow_ai.parsing import InputError, read_pdf


def write_pdf(path: Path, text=None, encrypted=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    if text:
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
        )
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 50 700 Td ({text}) Tj ET".encode("ascii"))
        page[NameObject("/Contents")] = writer._add_object(stream)
    if encrypted:
        writer.encrypt("test")
    writer.write(path)


def test_text_pdf(tmp_path):
    path = tmp_path / "invoice.pdf"
    write_pdf(path, "Tuition THB 65000 due 2026-10-15")
    assert "[page:1] Tuition" in read_pdf(path)


@pytest.mark.parametrize("encrypted,code", [(False, "PDF_NO_TEXT_LAYER"), (True, "PDF_ENCRYPTED")])
def test_unsupported_pdf(tmp_path, encrypted, code):
    path = tmp_path / "invoice.pdf"
    write_pdf(path, encrypted=encrypted)
    with pytest.raises(InputError, match=code):
        read_pdf(path)


def test_damaged_pdf(tmp_path):
    path = tmp_path / "bad.pdf"
    path.write_bytes(b"not a PDF")
    with pytest.raises(InputError, match="PDF_DAMAGED"):
        read_pdf(path)
