# Gemini Scanned-Document Input: Chinese and English

> Status: the OCR import endpoints live under the readiness (enrollment budget) module, which is retired from the product on 2026-10-15 (backend only). The current frontend does not call these endpoints; this document describes the backend contract that remains in the code and tests.

This round delivered the Django integration, the C transcription adapter, the frontend API contract and synthetic acceptance material; no new frontend was built.
Supported inputs are PNG/JPEG, scanned PDFs, and PDFs in which some pages have no text layer; text PDFs still have their text layer extracted locally.
Gemini only transcribes: it does not compute amounts, verify payees or authorize payments. The transcribed text enters the existing C material extraction and the Django user confirmation flow.

## Enabling

Install the updated dependencies and run `python manage.py migrate` in `backend/`. Gemini API and OCR settings all live in the **C module's `studyflow-ai/.env`**; the template is `studyflow-ai/.env.example`. `backend/.env` keeps only Django, database and other backend settings; there, `STUDYFLOW_READINESS_ENABLED=true` turns on the backend endpoints.

In `studyflow-ai/.env`:

```dotenv
STUDYFLOW_OCR_ENABLED=true
GEMINI_API_KEY=<server-side-secret>
STUDYFLOW_OCR_MODEL=gemini-3.1-flash-lite
STUDYFLOW_OCR_FALLBACK_MODELS=gemini-3.5-flash-lite
STUDYFLOW_OCR_MAX_ATTEMPTS=3
STUDYFLOW_OCR_PAID_SERVICE_CONFIRMED=true
STUDYFLOW_OCR_ADULT_ONLY_CONFIRMED=true
STUDYFLOW_OCR_TIMEOUT=60
STUDYFLOW_OCR_REQUESTS_PER_HOUR=10
STUDYFLOW_DOCUMENT_RETENTION_DAYS=30
```

The C module's `OcrSettings` reads and validates the configuration; recognition and file handling are also implemented in `studyflow_ai`. The Django HTTP server, `readiness_worker` and `verify_document_ocr` call C's configuration entry point at startup to read `studyflow-ai/.env`, so no `--env-file` is needed. The backend keeps user authorization, jobs, throttling, audit and review. Restart the HTTP server and the worker after changes.
`studyflow-ai/.env` is ignored by Git; the example file holds only empty keys and defaults. Environment variables already set in the process take precedence over C's `.env`; Gemini fields in the root `.env` are not a configuration source.

The two `CONFIRMED` switches record the operator's confirmation of the service terms and deployment scope; they do not automatically verify the billing account, the user's age or any security certification.
Everything is off by default; an empty key or model returns `OCR_NOT_CONFIGURED`. The operator must check the paid project, available regions and the adults-only conditions.
Do not send real personal data to a data-processing service that does not apply. Paying does not mean zero retention, nor does it automatically satisfy the requirements of every school or jurisdiction.

`STUDYFLOW_MODE=mock` controls only the existing C extraction service; **once Gemini OCR is enabled, OCR is a real external request even when C is in mock mode**.
In C's live mode, the transcribed text may also be sent to C's configured provider; the OCR notice endpoint states the current extraction mode explicitly.
The HTTP server and the persistent worker must use the same configuration. The server never reads an API key, model or provider URL supplied by the frontend.

## Frontend integration order

All endpoints require sign-in. Writes still require `Idempotency-Key`; the version context is `semester_id/state_version/budget_version`.

1. `GET /api/v2/readiness/imports/ocr-notice/` returns `version/text_zh/text_en/languages/enabled/configured/policy_configured/extraction_mode/retention_days`.
2. Show the Chinese and English notice with a consent checkbox that is not pre-ticked; keep the manual-entry option. The user consents for this file, not for all future files.
3. Upload with `POST /api/v2/readiness/imports/`; example multipart fields:

```text
semester_id=<uuid>
state_version=1
budget_version=1
kind=image
language=zh-en
ocr_consent=true
ocr_notice_version=gemini-ocr-v1
file=<PNG/JPEG/PDF bytes>
```

`language` accepts only `zh/en/zh-en`, default `zh-en`; the prompt always covers both Chinese and English and keeps the original text untranslated.
`ocr_consent` defaults to false. Older clients that do not send the new fields can still use local text PDFs, text and manual transcription.
A duplicate file reuses the original import record; re-uploading never silently upgrades the original consent. Use the separate authorization endpoint below.

4. Poll `GET /api/v2/readiness/imports/{id}/`:

| Status / field | Frontend action |
|---|---|
| `QUEUED`, job `QUEUED/RUNNING/RETRY` | Show processing; do not automatically re-upload or re-authorize |
| `NEEDS_REVIEW` | Show the original next to the recognized result; review amount, currency, date, invoice number and payee |
| `processing.ocr.pages` | Details return per-page `number/text/language/uncertain`; list and command responses do not copy the full transcription |
| `processing.consent` | Current notice version, consent time, actor and extraction mode; historical consent metadata stays in the audit log |
| `source_type=gemini_ocr` | Show "AI-recognized, pending human review"; never show it as bank or identity verification |
| `original_sha256`, `processing.ocr.model/rule_version` | Original file fingerprint, requested model, transcription rule version |
| `OCR_UNCERTAIN_TEXT` | Mark uncertain pages and require checking or correction; never guess missing content |
| `NEEDS_MANUAL_INPUT` | Show the specific failure code; choose manual transcription or explicit re-authorization |
| `REJECTED` | File damaged, encrypted, unsupported or failed a safety check; ask for a different file |

5. Keep using `POST .../{id}/confirm/` to submit the user-checked draft, issuer, selected_cost_ids and conflict handling. Payments still have their own beneficiary verification and authorization checks.

`POST .../{id}/authorize-ocr/` accepts, in `NEEDS_MANUAL_INPUT`, the version context plus `ocr_consent=true/ocr_notice_version/language`, and creates a new job.
A running job returns 409 and the client should refresh the status; the same idempotency key never creates a second job. Changing C's extraction mode requires a new notice.
`POST .../{id}/transcribe/` keeps the existing manual-entry flow.

## Failures, concurrency and request boundaries

- File limit 5 MiB; PDFs at most 50 pages; images only static PNG/JPEG, at most 20 megapixels. The actual format is checked; the extension and client MIME type are not trusted.
- Images are re-encoded and EXIF and other attached metadata removed; PDFs have their pages rebuilt and document and page metadata removed, and JavaScript, automatic actions, embedded attachments and forms are rejected. Personal information visible on the page is not redacted automatically.
- Fixed official HTTPS host; the API key is sent only in a header; redirects and environment proxies are disabled; no Files API, search, URL fetching, function or code execution tools are used, and `store=false` disables optional request logging.
- This cannot promise zero retention for Google's safety monitoring, and it does not replace storage encryption, network egress policy or resource isolation of the file-parsing process in the deployment.
- By default each user gets at most 10 outbound attempts per hour, based on database row locks and audit counts. The worker records the attempt before sending, so an interrupted process does not resend automatically.
- Transient provider failures (503/5xx, 429, timeouts, connection errors) are retried within the same job up to a limit: models rotate in the order `STUDYFLOW_OCR_MODEL` → `STUDYFLOW_OCR_FALLBACK_MODELS`, with exponential backoff and random jitter between attempts (about 0.5–4.5 seconds); total requests do not exceed `STUDYFLOW_OCR_MAX_ATTEMPTS` (1–5, default 3; 1 turns retry off), and total time does not exceed 180 seconds to stay within the 5-minute worker lease. Retries send the same processed file the user consented to, to the same provider; the per-user hourly limit counts jobs, and one job makes at most `MAX_ATTEMPTS` outbound requests. `processing.ocr.model` records the model that actually succeeded.
- Authentication errors, safety blocks, truncation, missing pages, languages other than Chinese and English, or invalid JSON are not retried; once retries are exhausted a fixed `OCR_*` error code is returned as well, the job ends and falls back to manual input, and the provider's raw error response is not stored.
- After a successful OCR, the contract-validated transcription is cached; if downstream extraction fails temporarily, the cache is reused and the original file is not sent again. A stale lease cannot overwrite a newer result.
- Prompt instructions inside the file are untrusted data; the existing suspicious-instruction detection and confirmation block stay in force. The detection rules are not a complete prompt-injection defense; isolating payment permissions is the necessary boundary.

## Original retention and deletion

`POST .../{id}/discard-source/` takes the version context and an idempotency key, and deletes the original binary and that material's full-text OCR cache; it is refused while a job is running.
It is **not a complete personal-data deletion endpoint**: extracted evidence, user confirmations, financial records and related idempotent responses are kept as business records.
After the source file is deleted it cannot be OCR'd again, but existing review data and financial records are kept.

In deployment, run `python manage.py purge_document_sources` daily; it removes originals and OCR caches of finished materials older than 30 days by default.
This round provides the cleanup command but does not modify operating-system scheduled tasks. Jobs still queued or running are skipped; files past the retention period may no longer be sent for OCR.
Requests use inline bytes, so there are no remote Files API files to clean up; the provider's own retention policy still applies.

## Reproducible acceptance

`backend/examples/ocr/v1/` contains 3 PNGs in Chinese, English and mixed Chinese/English, plus matching pure-scan PDFs, all clearly labeled Synthetic.
`manifest.json` contains the version, file checksums and the expected text for amounts, dates and invoice numbers. To generate:

```powershell
Set-Location backend
../studyFlow/Scripts/python.exe scripts/build_ocr_fixtures.py --font C:/Windows/Fonts/msyh.ttc
```

After deployment configuration, run explicitly in `backend/`:

```text
python manage.py verify_document_ocr --live --output output/ocr-live.json
```

The command sends only the six synthetic samples above and produces a pass/fail result for each; it reads no user material and prints no keys.
Different fonts or rendering versions may change the file checksums; rebuilding updates the manifest. Passing on six clear samples does not mean blurry photos, handwriting or every layout has been verified.
Automated tests use MockTransport or simulated recognition results, which only prove request boundaries, contracts and state-machine behavior; real recognition quality must be judged from the live results above and later sample evaluations.

References: [Gemini document understanding](https://ai.google.dev/gemini-api/docs/document-processing), [generateContent API](https://ai.google.dev/api/generate-content), [Terms of service and data use](https://ai.google.dev/gemini-api/terms).
