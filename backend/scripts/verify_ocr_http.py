import hashlib
import json
import os
import sys
import threading
from pathlib import Path
from wsgiref.simple_server import make_server

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
from studyflow_ai.config import load_env_file

load_env_file(ROOT.parent / "studyflow-ai/.env")
import django

django.setup()
from django.core.wsgi import get_wsgi_application
from django.test import override_settings

from finance.management.commands.demo_copilot import CopilotDemo, QuietHandler
from finance.readiness.models import ImportMaterial, Semester
from finance.workflow_common import current
from finance.workflow_models import DemoLedgerEntry, DemoWallet


def facts(user):
    return {"financial_version": current(user).version,
            "budget_version": Semester.objects.get(owner=user).version,
            "wallet_balance": str(DemoWallet.objects.get(owner=user).balance),
            "ledger_count": DemoLedgerEntry.objects.filter(owner=user).count()}


destination = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "output/ocr-independent-http-first.json"
assert not destination.exists()
report = {"passed": False, "synthetic": True, "ocr_mode": "live", "extraction_mode": "live", "transport": "real_loopback_http", "database": "PostgreSQL"}
with override_settings(STUDYFLOW_READINESS_ENABLED=True, STUDYFLOW_AI_MODE="live", ALLOWED_HOSTS=["127.0.0.1", "localhost"]):
    server = make_server("127.0.0.1", 0, get_wsgi_application(), handler_class=QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    demo = None
    try:
        demo = CopilotDemo(f"http://127.0.0.1:{server.server_port}")
        report["run_id"] = demo.run_id
        semester = demo.request("readiness/semesters", {"reserve": "1000.00", "opening_balance": "10000.00", "as_of": "2026-10-06"})
        demo.request("demo/initialize", {"state_version": semester["state_version"]})
        demo.drain()
        before = facts(demo.student)
        notice = demo.request("readiness/imports/ocr-notice")
        sample = ROOT / "examples/ocr/v1/invoice-zh-en.pdf"
        material = demo.request("readiness/imports", data={**demo.context(), "kind": "pdf", "language": "zh-en", "ocr_consent": "true", "ocr_notice_version": notice["version"]}, files={"file": (sample.name, sample.read_bytes(), "application/pdf")})
        job = demo.drain(material["job_id"])
        result = demo.request("readiness/imports/" + material["id"])
        stored = ImportMaterial.objects.get(pk=material["id"])
        after = facts(demo.student)
        ocr = stored.processing.get("ocr", {})
        report.update(before=before, after=after, job_status=job["status"], material_status=result["status"], issues=stored.result.get("issues", []), source_type=stored.result.get("source_type"), ocr_model=ocr.get("model"), pages=ocr.get("pages"), consent=stored.processing.get("consent"), original_sha256=stored.sha256, source_sha256=hashlib.sha256(sample.read_bytes()).hexdigest(), steps=demo.steps, extraction_calls=stored.result.get("calls", []), review_items=demo.request("review-queue"))
        assert job["status"] == "DONE", result
        assert result["status"] == "NEEDS_REVIEW", result
        assert stored.result.get("source_type") == "gemini_ocr", result
        assert before == after, "OCR changed financial facts"
        from django.conf import settings
        assert ocr.get("model") == settings.STUDYFLOW_OCR_MODEL
        report["passed"] = True
    except Exception as exc:
        report["error_type"] = type(exc).__name__
        raise
    finally:
        if demo:
            demo.http.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("OCR HTTP passed:", destination)
