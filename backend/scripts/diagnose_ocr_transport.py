import json
import sys
import time
from pathlib import Path

import httpx
from studyflow_ai.gemini_ocr import _request_body, prepare_document
from studyflow_ai.ocr_config import OcrSettings

settings = OcrSettings.from_env()
sample = Path("examples/ocr/v1/invoice-en.png")
body = _request_body(prepare_document("image", sample.read_bytes()))
started = time.monotonic()
result = {"model": settings.model, "sample": sample.name, "timeout_seconds": 90}
try:
    response = httpx.post(
        "https://generativelanguage.googleapis.com/v1beta/models/" + settings.model + ":generateContent",
        headers={"x-goog-api-key": settings.api_key}, json=body, timeout=90, trust_env=False,
    )
    result["http_status"] = response.status_code
    try:
        data = response.json()
    except ValueError:
        data = {}
    error = data.get("error", {})
    result.update(status=error.get("status"), message=str(error.get("message", "")).replace(settings.api_key, "[REDACTED]")[:1200], model_version=data.get("modelVersion"), usage=data.get("usageMetadata"))
except httpx.HTTPError as exc:
    result["error_type"] = type(exc).__name__
result["elapsed_seconds"] = round(time.monotonic() - started, 2)
destination = Path(sys.argv[1])
assert not destination.exists()
destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
