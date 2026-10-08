# Gemini OCR implementation verification — 2026-10-06 (Asia/Bangkok)

Follow-up: live requests have now been performed; the active model is `gemini-3.6-flash`. One of six synthetic fixtures passed; the remaining requests failed with availability/time-out errors, including a diagnosed HTTP 503. See [the subsequent live verification report](verification-independent-20261006.md). The implementation checks and earlier configuration state below are retained as historical evidence.

## Scope

Chinese, English and mixed-language raster PNG/JPEG and scanned PDF ingestion. Gemini
transcribes; existing C extraction and Django review/confirmation remain separate.
No frontend application, bank connection, production deployment or payment authority
was added. The original consumption/funding implementation and its pending changes
were preserved.

## Checks performed

| Check | Result |
|---|---|
| `manage.py test finance auto_test --noinput --keepdb` against local PostgreSQL | 156 passed |
| Focused OCR API/concurrency tests after source-purge lock adjustment | 14 passed |
| C `pytest auto_test` after PDF attachment hardening | 157 passed |
| `makemigrations --check --dry-run` | No changes detected |
| `migrate --noinput` on local demonstration database | Migration 0013 applied |
| `spectacular --validate --fail-on-warn --file openapi.yaml` | Passed |
| Ruff on new/changed OCR modules and tests | Passed |
| Python compileall | Passed |
| Six synthetic PNG/PDF fixtures | Checksums match; PDFs contain no text layer |
| Mixed-language fixture visual inspection | Chinese and English render legibly |

The PostgreSQL daemon stopped during verification. Docker and the existing project
container were restarted without replacing the database volume, then PostgreSQL
tests completed. Lightweight SQLite checks were supplementary, not substitutes for
the PostgreSQL concurrency test.

The C suite emits one deprecation warning from a test deliberately constructing a
JavaScript-bearing PDF (`PdfWriter.add_js`). It is not used by the production parser.

## Behaviors covered

- No consent or missing operator policy gates means no Gemini request.
- Fixed HTTPS endpoint, header-only key, no redirects/tools, bounded response and timeout.
- Chinese/English/mixed text preserved, page coverage checked, invalid/truncated/blocked
  responses and unsupported language rejected with sanitized error codes.
- MIME spoofing, damaged/encrypted/active PDFs and attachment annotations rejected;
  image metadata removed before transmission.
- External attempt fenced by PostgreSQL locks and worker lease; one winner under a race.
- User rate limit, explicit/idempotent retry, no automatic OCR reupload after failure;
  cached transcription reused if downstream extraction fails.
- Scanned PDF becomes text input for C rather than being read again as an empty text layer.
- Results remain pending review; original budget and wallet/ledger do not change.
- Cross-user reads denied, suspicious document instructions cannot be confirmed.
- Original-file disposal and expiry cleanup preserve financial evidence; active tasks
  cannot have their source removed.

## Not yet verified

Current configuration has OCR disabled and no Gemini key/model. No live Gemini request
was sent and no real student document was uploaded. Network/recognition tests used
MockTransport or simulated model results. These results do not establish live OCR accuracy.

`manage.py verify_document_ocr --live` is available after deployment configuration;
it sends only the six synthetic fixtures and reports expected token matches/errors.
Formal organizational security review, jurisdiction-specific data processing approval,
age/access controls, production encryption/resource isolation and real-world document
accuracy evaluation remain deployment/acceptance work. Operator configuration flags
are attestations, not automatic certifications. See [configuration and API contract](gemini-ocr.md).
