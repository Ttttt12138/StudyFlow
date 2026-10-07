# Task A integration validation

Validated 2026-10-07 (Asia/Bangkok) against the latest team `feature/bc-integration` commit **3be0eb79c7a04e852da74efd337d458ce3862ea1**. The environment initially held e45d5d8; Task A changes were preserved while the checkout was fast-forwarded and the API comparison/validation was repeated. The uploaded ZIP was adapted into `frontend/`; its declared ee577dc source commit cannot be independently verified without Git metadata. Initial comparison is in [frontend-contract-audit.md](frontend-contract-audit.md). Run/setup instructions are in [frontend/README.md](../frontend/README.md).

## Result and ownership

A student can use existing Django session login, create/restore a semester, upload and review extracted material, confirm stable merged cost IDs, save nullable expense revisions, request/display B's budget and dated calendar, record promised funding and review B's recommendation/plan, save affordability inputs, create a quote and submit a simulated application. Reload restores saved progress and results. C's original extraction/evidence is unchanged by a corrected confirmation. The frontend performs no financial calculations, currency conversion or approval/settlement decisions.

Authentication adds only `GET /api/auth/session/`, returning authentication status, username and CSRF token with `Cache-Control: no-store`. Existing Django login and DRF session permissions remain in use. Session-authenticated writes require CSRF as well as idempotency keys. The ZIP's token form was removed. Synthetic preview controls are read-only; the older demo is visibly separated from live mode.

## Executed checks

| Check | Result | Boundary |
|---|---|---|
| `npm ci`, `npm run build` | Passed | TypeScript and production asset build, Node 24 / Vite 6 |
| `npm test` | All 3 browser suites passed | Mocked API / synthetic responses; desktop and mobile; list pagination; missing values, conflict review, retry keys, stale results; no financial API calls from synthetic connected preview |
| `npm run test:integration` | Passed | Actual Django HTTP, PostgreSQL 17, student session login + CSRF, actual persistent worker running C mock providers |
| Standard gate `manage.py test finance auto_test --noinput --keepdb` | 482 passed | PostgreSQL backend; includes new authentication/CSRF test |
| `pytest auto_test/test_lending_core.py` | 17 passed | B lending calculations, unchanged |
| C `pytest -p no:cacheprovider` | 293 passed | Existing AI tests; one existing pypdf deprecation warning |
| C `ruff check src auto_test scripts` | Passed | Existing C lint |
| `manage.py check` | Passed | Django configuration |
| `manage.py makemigrations --check --dry-run` | Passed, no changes | No model changes |
| `manage.py spectacular --validate --fail-on-warn` | Passed | Includes typed session endpoint |
| `git diff --check` | Passed | Change hygiene |

Real integration used a unique, normally authenticated non-staff student created in the development PostgreSQL database. Passwords were neither printed nor saved. All five screens were exercised through Chromium. B returned `REJECTED` / `UNAFFORDABLE` for a one-month quote where repayment exceeded the supplied monthly capacity; the frontend displayed that result. This is a successful simulation test, not an approval claim.

Real API tests also covered:

- Text material extraction, original evidence, selected merged IDs, corrected tuition, explicit review reasons and verified expense locking.
- Text PDF without OCR consent; image with OCR disabled returned `NEEDS_MANUAL_INPUT`; manual transcription then went through the actual C mock worker to `NEEDS_REVIEW`.
- Unknown expenses retained as null across save/reload. B returned incomplete results for genuinely missing information, including consumption coverage where applicable.
- Unsaved local edits mark budget, forecast and funding results stale. Restored runs compare semester identity plus state/budget/analysis versions; saved plan validation also labels stale inputs.
- Another legitimate client revised the semester, provoking an actual backend HTTP 409. Authoritative state reloaded and the student could restore/review/save unsaved edits.
- The test let Django commit a budget and funding source, then intentionally dropped the response. UI retries used exactly the same body and idempotency key; each created one record, not two. Funding economic identity also remained unchanged.
- Saved affordability inputs, quotes, application status, budget/calendar and funding histories survived reload.
- Desktop 1440px and mobile 390px screenshots were inspected, with no horizontal overflow or browser runtime errors. Mock suites additionally exercise calendar/funding layouts and the synthetic views.

The latest local report and screenshots are generated under ignored `output/frontend/` (`integration.json`, `integration-1440.png`, `integration-390.png`). The report lists the concrete UUID routes from that run. Tests create durable synthetic accounts/records and should run against a dedicated development database.

## Exact tested HTTP routes

`{id}` denotes the actual owned resource UUID recorded by the test. Everything below was exercised against the actual Django server, not just mocked route handlers.

| Method | Route | Verified behavior |
|---|---|---|
| GET, POST | `/api/auth/login/` | Existing login form; session cookie; return to frontend |
| GET | `/api/auth/session/` | Guest/signed-in identity and CSRF token |
| GET | `/api/v2/readiness/templates/` | Backend template list |
| POST | `/api/v2/readiness/semesters/` | Creation with template, opening balance/date/reserve |
| GET | `/api/v2/readiness/semesters/{id}/` | Saved authoritative draft |
| POST | `/api/v2/readiness/semesters/revise/` | Corrections, expense saves, real version conflict and recovery |
| GET | `/api/v2/readiness/state/` | State/budget/analysis versions and backend-authored budget |
| GET | `/api/v2/readiness/imports/ocr-notice/` | Actual service/policy/consent notice, OCR disabled |
| GET, POST | `/api/v2/readiness/imports/` | List and multipart text/PDF/image uploads |
| GET | `/api/v2/readiness/imports/{id}/` | Processing status, extraction/evidence and merged proposed draft |
| POST | `/api/v2/readiness/imports/{id}/confirm/` | Reviewed stable cost IDs and corrected values; original extraction retained |
| POST | `/api/v2/readiness/imports/{id}/transcribe/` | Manual image transcription queued and processed |
| GET, POST | `/api/v2/readiness/budgets/` | Budget run/history, completeness, exact-once lost-response retry |
| GET, POST | `/api/v2/readiness/forecasts/` | Backend calendar with actual dated events, balances/gaps and missing-data flags |
| GET, POST | `/api/v2/readiness/funding-plans/recommend/` | Recommendation/history, non-loan allocations and conditions |
| GET, POST | `/api/v2/readiness/funding-plans/` | B plan validation and saved history |
| GET, POST | `/api/v2/funding-sources/` | Promised source stored as unreceived; exact-once lost-response retry |
| GET, POST | `/api/v2/loans/` | Quotes, B repayment schedule, fees/net proceeds/total repayment |
| GET, POST | `/api/v2/affordability-profile/` | Nullable monthly inputs, versions, restoration |
| GET, POST | `/api/v2/applications/` | Owned applications and draft creation |
| POST | `/api/v2/applications/{id}/action/` | Versioned submit; B authored decision/assessment |
| GET | `/api/v2/applications/{id}/` | Authoritative status reload |

In addition, the backend authentication test checked unauthenticated access rejection and session POST rejection without CSRF. Mocked browser tests inject HTTP 503 failures, check key reuse, follow a second resource-list page, and compare multiple quotes; those particular fault fixtures are not live provider tests.

The latest backend's standard `scripts/run_gates.py --skip-demos` also passed all ten gates: holdout freeze, configuration, i18n catalogs, migrations, Django tests, OpenAPI, C lint/tests, runtime migrations and cache-table readiness. Its logs are under ignored `output/gates/`. Earlier 157/161-test runs validated the original snapshot; the 482/293 counts above supersede them. The standard gate's unrelated backend demo commands were not rerun as part of Task A; the actual frontend journey was rerun against the latest server instead.

## Worker mode, prerequisites and limitations

The actual worker was `manage.py readiness_worker --mode mock`, restarted after updating to 3be0eb7. All new migrations through `0018_agent` and `manage.py createcachetable` were applied. Backend throttling/policy/security settings were retained without bypasses. Root readiness and consumption flags were enabled. Django, PostgreSQL, sessions, transactions, idempotency and queue persistence were real. C extraction/routing/planning providers were mock. No `--mode live` model request and no Gemini paid OCR request was tested.

The latest repository contains teammates’ earlier live verification reports; this task does not claim those as its own live frontend integration. Live provider credentials were unavailable in this running instance: relevant process binding names were unset and no C `.env` existed. Live extraction and paid OCR remain separate prerequisites; use secure environment configuration and C's existing configuration/consent requirements, then run its documented live verification. No credentials were invented, copied into frontend files, or requested in chat.

The frontend CI workflow was added and its local commands were exercised; a remote GitHub Actions run has not been triggered here. The changes remain in this checkout, without a push or production deployment. Deployment must serve the built frontend and Django `/api/` under the same origin, with Django's normal HTTPS proxy/CSRF/static configuration. Production hosting and live provider acceptance are unverified.

No B/C financial or extraction behavior was rewritten. The initial contract gaps were frontend/authentication integration concerns: token entry, swallowed history errors, stale local edits, missing budget-history restoration, retry economic IDs, reserve-as-cost selection, and selecting an application unrelated to the current quote. These are addressed by the integration. Existing B consumption data requirements remain visible rather than being bypassed.
