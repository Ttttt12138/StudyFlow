import hashlib
import json
import unicodedata
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from studyflow_ai.gemini_ocr import GeminiDocumentTextExtractor, prepare_document
from studyflow_ai.parsing import InputError


def check_sample(provider, directory, sample):
    path = directory / sample["path"]
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != sample["sha256"]:
        raise CommandError(
            "Synthetic fixture checksum mismatch; refusing external upload."
        )
    try:
        result = provider.recognize(prepare_document(sample["kind"], data))
        text = "".join(unicodedata.normalize("NFKC", result.text).split())
        missing = [token for token in sample["expected_tokens"] if token not in text]
        return {
            "file": sample["path"],
            "passed": not missing,
            "missing": missing,
            "uncertain_pages": [p.number for p in result.pages if p.uncertain],
        }
    except InputError as exc:
        return {"file": sample["path"], "passed": False, "error_code": exc.code}


class Command(BaseCommand):
    help = "Explicitly send the six synthetic OCR fixtures to Gemini; never reads user documents."

    def add_arguments(self, parser):
        parser.add_argument("--live", action="store_true")
        parser.add_argument("--output", type=Path, default=Path("output/ocr-live.json"))

    def handle(self, *args, **options):
        if not options["live"]:
            raise CommandError(
                "Use --live to authorize sending synthetic fixtures to Gemini."
            )
        if not (
            settings.STUDYFLOW_OCR_ENABLED
            and settings.STUDYFLOW_OCR_PAID_SERVICE_CONFIRMED
            and settings.STUDYFLOW_OCR_ADULT_ONLY_CONFIRMED
        ):
            raise CommandError("OCR deployment policy gates are not configured.")
        try:
            provider = GeminiDocumentTextExtractor(
                api_key=settings.GEMINI_API_KEY,
                model=settings.STUDYFLOW_OCR_MODEL,
                timeout=settings.STUDYFLOW_OCR_TIMEOUT,
            )
        except InputError as exc:
            raise CommandError(exc.code) from None
        directory = settings.BASE_DIR / "examples" / "ocr" / "v1"
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        results = [
            check_sample(provider, directory, sample) for sample in manifest["files"]
        ]
        report = {
            "synthetic": True,
            "live": True,
            "model": provider.model,
            "fixture_version": manifest["version"],
            "results": results,
            "passed": all(r["passed"] for r in results),
        }
        options["output"].parent.mkdir(parents=True, exist_ok=True)
        options["output"].write_text(json.dumps(report, indent=2), encoding="utf-8")
        self.stdout.write(json.dumps(report))
        if not report["passed"]:
            raise CommandError("OCR synthetic acceptance failed; see report.")
