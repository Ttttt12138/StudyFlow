import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject

from studyflow_ai.parsing import MAX_BYTES, InputError


@dataclass(frozen=True)
class PreparedDocument:
    data: bytes
    mime_type: str
    page_count: int


def prepare_document(kind, data):
    if not data or len(data) > MAX_BYTES:
        raise InputError("INPUT_TOO_LARGE")
    if kind == "image":
        document = _image(data)
    elif kind == "pdf":
        document = _pdf(data)
    else:
        raise InputError("UNSUPPORTED_MEDIA_TYPE")
    if len(document.data) > MAX_BYTES:
        raise InputError("INPUT_TOO_LARGE")
    return document


def _image(data):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in {"PNG", "JPEG"} or getattr(source, "n_frames", 1) != 1:
                    raise InputError("UNSUPPORTED_MEDIA_TYPE")
                if source.width * source.height > 20_000_000:
                    raise InputError("IMAGE_PIXEL_LIMIT")
                source.verify()
            with Image.open(io.BytesIO(data)) as source:
                normalized = ImageOps.exif_transpose(source).convert("RGB")
                clean = Image.new("RGB", normalized.size)
                clean.paste(normalized)
                output = io.BytesIO()
                clean.save(output, format="PNG")
                return PreparedDocument(output.getvalue(), "image/png", 1)
    except InputError:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise InputError("IMAGE_PIXEL_LIMIT") from None
    except Exception:
        raise InputError("IMAGE_DAMAGED") from None


def _reject_active_content(root):
    pending, visited = [root], set()
    forbidden = {
        "/JavaScript",
        "/JS",
        "/OpenAction",
        "/AA",
        "/A",
        "/EmbeddedFiles",
        "/EF",
        "/RichMedia",
        "/XFA",
        "/Launch",
        "/AcroForm",
    }
    while pending:
        node = pending.pop()
        if isinstance(node, IndirectObject):
            key = (node.idnum, node.generation)
            if key in visited:
                continue
            visited.add(key)
            if len(visited) > 10000:
                raise InputError("PDF_COMPLEXITY_LIMIT")
            node = node.get_object()
        if isinstance(node, DictionaryObject):
            active = node.get("/Subtype") in {
                "/FileAttachment",
                "/RichMedia",
                "/Movie",
                "/Sound",
                "/Screen",
            }
            if forbidden.intersection(node) or active:
                raise InputError("PDF_ACTIVE_CONTENT")
            pending.extend(node.values())
        elif isinstance(node, ArrayObject):
            pending.extend(node)


def _pdf(data):
    if not data.startswith(b"%PDF-"):
        raise InputError("PDF_DAMAGED")
    try:
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise InputError("PDF_ENCRYPTED")
        count = len(reader.pages)
        if not 1 <= count <= 50:
            raise InputError("PDF_TOO_MANY_PAGES")
        _reject_active_content(reader.trailer["/Root"])
        writer, output = PdfWriter(), io.BytesIO()
        for page in reader.pages:
            page.pop("/Metadata", None)
            writer.add_page(page)
        writer.add_metadata({})
        writer.write(output)
        return PreparedDocument(output.getvalue(), "application/pdf", count)
    except InputError:
        raise
    except Exception:
        raise InputError("PDF_DAMAGED") from None
