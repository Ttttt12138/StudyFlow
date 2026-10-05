"""Create a tiny synthetic text PDF fixture, not a real university invoice."""

from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

ROOT = Path(__file__).resolve().parents[1] / "src" / "studyflow_ai" / "data"


def main():
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
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
    text = ROOT.joinpath("tuition.txt").read_text(encoding="utf-8").strip()
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 10 Tf 30 700 Td ({text}) Tj ET".encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    writer.add_metadata({"/Title": "Synthetic StudyFlow tuition fixture"})
    writer.write(ROOT / "tuition.pdf")


if __name__ == "__main__":
    main()
