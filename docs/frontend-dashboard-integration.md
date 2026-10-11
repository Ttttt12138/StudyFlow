# Student dashboard integration — 8 October 2026

> Path note (updated 2026-10-11): the B module now lives in `backend/`. Django commands below run inside `backend/`, and paths such as `manage.py`, `finance/`, `auto_test/` and `openapi.yaml` are relative to it. Results are kept as recorded at the time.

The final checkout is `front-end`. Its previous frontend commit was ebff923; the latest team backend `feature/bc-integration` at **341e66a81d9338ca54d7de4f18f4c35f5225a43f** was merged locally as abb0133 before dashboard verification. Only the README needed merge resolution: upstream English documentation was retained and the frontend documentation link preserved. The team branch was not modified or pushed.

The supplied Task A ZIP identifies **e8ff7f3c31cdb8d21550e59825a95bac38c6c987** in its archive comment. It contains no Git working tree. Dashboard components, presentation types, synthetic adapter and styles were adapted into the existing `frontend/`; the existing final-repository five-step implementation and Django session authentication were preserved. ZIP documentation was reference material.

## Current contract comparison

Read `backend/finance/urls.py`, `backend/finance/readiness/api.py`, `backend/finance/consumption/api.py`, `backend/finance/consumption/monitoring.py`, `backend/finance/copilot/api.py`, `backend/finance/copilot/reviews.py`, readiness serializers and the final frontend requests before changes.

| Read | Actual response and integration |
|---|---|
| `GET /api/v2/readiness/briefing/` | `{data: briefing}`. Status, issues, actions, next obligation, `as_of`, three versions and simulation flag are backend-authored. |
| `GET /api/v2/readiness/calendar/` | `{data: {calendar, as_of, state_version, budget_version, analysis_version, is_simulated}}`. Dates/amounts/status copied for display; first five events shown with calendar navigation. |
| `GET /api/v2/readiness/notifications/` | `{data: items, unread_count, count, next, previous}`. Added a raw GET option: normal unwrapping would discard metadata. The copilot URL resolves before the older readiness notification route. |
| `GET /api/v2/review-queue/` | `{data: {count, items, next, previous}}`. Standard unwrap retained; no `results` assumption. Non-staff reads are owner-filtered. |
| `GET /api/v2/readiness/state/` | Current owned semester and versions; compared with briefing/calendar. Unsaved journey edits also mark dashboard results outdated. Different summary `as_of` dates flag inconsistency. |
| Authentication | Existing `/api/auth/login/` session flow and `/api/auth/session/`; same-origin cookies and CSRF retained. No manually entered token screen imported. |
| Writes | Existing readiness writes retain semester/state/budget/available analysis versions. POST retries retain payload/key identity. No new dashboard writes. |

Both summary reads require readiness and consumption enabled. No active semester returns `NO_ACTIVE_SEMESTER`; the dashboard links to setup. Briefing and calendar are computed by B on GET rather than requiring a previously saved forecast run. Their status can remain incomplete even after all admission costs are supplied when consumption coverage is insufficient. This is not bypassed.

Read panels load independently, hide prior results on refresh, expose partial failures with retry, and reject late responses after unmount. A 401/403 displays sign-in and hides student panels. Missing authoritative state never establishes freshness. Backend issue codes/details remain expandable. Student actions navigate to relevant existing journey steps; unsupported service screens are labeled read-only instead of pretending they work.

Notifications and reviews show the returned first page; a non-null `next` is explicitly labeled. Notification read, review commands and operator actions are intentionally absent. Contract inspection found `expected_version` on review commands and staff restrictions for assignment/start/request-information/reject, loan decisions and beneficiary verification. These commands were not exercised or exposed.

## Validation boundaries

- Production TypeScript/Vite build passes. Clean `npm ci --cache /tmp/studyflow-npm-cache` passes; the default `/home/agent/.npm` cache is unwritable in this environment. Integrity checks were retained.
- Five browser suites: original demo, connected journey, connected synthetic preview, dashboard synthetic preview, and mocked dashboard contract/error states. These are mocked/synthetic tests, not live integration.
- Actual Chromium journey uses Django HTTP, PostgreSQL 17, normal disposable non-staff student/session login and CSRF, plus `readiness_worker --mode mock` with readiness/consumption enabled. It verifies document processing/evidence, corrected amount/date, stable merged IDs, original extraction preservation, verified-cost locking, nullable expense persistence, reload, stale local edits, real HTTP 409 recovery, funding recommendation/plan, quote/affordability/application assessment and dashboard reads/reload.
- A committed budget and funding-source response is deliberately dropped. Retrying creates one record and reuses the key/body. Backend transactions/idempotency are real; dropped responses are injected transport faults.
- Incomplete budget remains incomplete with missing inputs. A subsequent complete fixture uses real transaction CSV upload/confirmation and balance confirmation APIs, explicit `NOT_APPLICABLE` reasons, and a reviewed due date; B returns a complete budget. Those supporting consumption APIs are exercised through HTTP helpers, not a new spending UI.
- Mock suites cover missing fee, conflict presentation, HTTP 503, empty/signed-out states, partial dashboard failure/retry and mismatched versions. The live journey covers merge review/correction, unknown expenses, actual 409 and backend-authored values. A real naturally stale dashboard response is not manufactured; mismatched dashboard versions are mock-tested.
- Text extraction and text PDF use C mock providers. Image upload with OCR disabled returns manual-input status; manual transcription is processed by the actual worker. No live extraction provider or Gemini OCR call was made. This is live Django integration with mock AI, not live-model acceptance.
- Desktop 1440px and mobile 390px layout/overflow checks and screenshots are included. Targeted Django session/CSRF test passes (one test). Full backend/C suites were not rerun for this frontend-only change; previous validation counts belong to the earlier report.

The exact live methods/UUID routes and timestamp are generated by `frontend/tests/e2e/integration/journey.spec.mjs` (then `frontend/tests/integration.mjs`) in ignored `output/frontend/integration.json`; dashboard and journey screenshots are in the same directory. API calls made by HTTP test helpers are recorded too. The frontend preserves decimal strings/null and makes no financial or approval calculations. B's rejected unaffordable simulated application is displayed as returned, not treated as a frontend failure.

## Remaining scope

Dashboard preview controls remain synthetic/read-only; the older demo stays separate. Notification-read/review writes, wallet/remittance, spending UI and operator consoles are outside this baseline. Live provider/OCR verification and production same-origin hosting remain prerequisites for deployment acceptance. No backend calculation or extraction behavior changed, and no remote CI/deployment result is claimed.

Cloud install/start instructions were saved with cache-table readiness, frontend installation/build, Vite startup, mocked browser checks and the live-Django/mock-worker journey. Saving the environment draft does not publish it or prove restoration in a new task.

## Exact live HTTP routes from the completed run

Run timestamp (UTC): `2026-10-08T16:39:57.221Z`. Resource UUIDs are normalized to `{id}`; concrete IDs are retained in the generated JSON.

- `GET /api/auth/login/`
- `GET /api/auth/session/`
- `GET /api/v2/affordability-profile/`
- `GET /api/v2/applications/`
- `GET /api/v2/applications/{id}/`
- `GET /api/v2/funding-sources/`
- `GET /api/v2/loans/`
- `GET /api/v2/readiness/briefing/`
- `GET /api/v2/readiness/budgets/`
- `GET /api/v2/readiness/calendar/`
- `GET /api/v2/readiness/forecasts/`
- `GET /api/v2/readiness/funding-plans/`
- `GET /api/v2/readiness/funding-plans/recommend/`
- `GET /api/v2/readiness/imports/`
- `GET /api/v2/readiness/imports/ocr-notice/`
- `GET /api/v2/readiness/imports/{id}/`
- `GET /api/v2/readiness/notifications/`
- `GET /api/v2/readiness/semesters/{id}/`
- `GET /api/v2/readiness/state/`
- `GET /api/v2/readiness/templates/`
- `GET /api/v2/review-queue/`
- `POST /api/auth/login/`
- `POST /api/v2/affordability-profile/`
- `POST /api/v2/applications/`
- `POST /api/v2/applications/{id}/action/`
- `POST /api/v2/funding-sources/`
- `POST /api/v2/loans/`
- `POST /api/v2/readiness/balance-confirmations/`
- `POST /api/v2/readiness/budgets/`
- `POST /api/v2/readiness/forecasts/`
- `POST /api/v2/readiness/funding-plans/`
- `POST /api/v2/readiness/funding-plans/recommend/`
- `POST /api/v2/readiness/imports/`
- `POST /api/v2/readiness/imports/{id}/confirm/`
- `POST /api/v2/readiness/imports/{id}/transcribe/`
- `POST /api/v2/readiness/semesters/`
- `POST /api/v2/readiness/semesters/revise/`
- `POST /api/v2/readiness/transaction-imports/`
- `POST /api/v2/readiness/transaction-imports/{id}/confirm/`
