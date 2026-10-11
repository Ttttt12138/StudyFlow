# Reviewed Task A UX and wallet integration — 10 October 2026

> Path note (updated 2026-10-11): the B module now lives in `backend/`. Django commands below run inside `backend/`, and paths such as `manage.py`, `finance/`, `auto_test/` and `openapi.yaml` are relative to it. Results are kept as recorded at the time.

## Baseline and source verification

Final checkout: `front-end` at **b23511789a38f9be8ac7e5b20d50427258ae03c4**, clean before this task. It includes the five-step session-authenticated journey, live dashboard, and team backend **feature/bc-integration / 341e66a81d9338ca54d7de4f18f4c35f5225a43f**. Fetching the team branch confirmed that it has not advanced. No branch merge, commit or push was performed during this task.

Source: **aungkhantmyat/Agent_Frontend_UAT / main / 20d15272d67f50a8504e17dd153dc1a8a0cdc4a5**. The uploaded ZIP's archive comment and GitHub main ref match. The exact source commit was fetched read-only, and all **53 tracked files** were byte-compared with the ZIP: zero differences. Source documentation was reference material, not authority for extra actions.

## Selective transfer

| Source piece | Final integration decision |
|---|---|
| ConnectedApp presentation | Adapted welcome, evidence/conflict guidance, expense cards, compact budget/funding/application layout, progress position and responsive navigation. Existing final request handlers, session authentication, saved restoration, retry keys/economic identity, version checks and real-409 recovery retained. |
| PreviewConfirmation / PreviewApplication / PreviewWalkthrough | Added for synthetic mode only. Next-step buttons and explicit incomplete admission-review notice retained; position never claims completion. Changing a sample Food estimate switches fixed fixture responses, not browser calculations. |
| FundingComparison / PaymentCalendar | Adapted compact/expandable presentation; B's returned values and decisions remain authoritative. Dirty inputs disable budget/calendar/funding commands and flag stale results. |
| previewAdapter | Added revised fixed synthetic fixtures inside the isolated read-only tour. No live write path is exposed through this adapter. |
| sprint4.css / student-start.css | Imported alongside existing final styles. Existing dashboard styles/components retained. |
| src/wallet | Added wallet/remittance views and separate read-only preview. Source standalone session transport replaced by an adapter delegating to final DjangoClient. Session discovery uses `/api/auth/session/`, never token entry or a login-page cookie scrape. |
| Source client/contracts | Older five-step token client and older types not copied. Final decimal/null, session/CSRF, pagination and readiness versions retained. |
| Source dashboard | Not copied: final live dashboard and its established preview remain intact. |
| Original demo | Existing final original demo retained as a separate synthetic experience; not treated as the connected journey. |
| presenters.ts | Identical to final implementation; no replacement necessary. |

“Use my own information” leaves the tour and scrolls/focuses the **Django sign-in link**. Student country/type fields, nullable paid/period values, top-level reserve editing and locked/verified cost protection are retained. Source layouts are not allowed to remove these final integration fixes. Live applications remain tied to the selected quote. Preview comparisons retain their original sample application and show the other quote separately.

Wallet navigation preserves the mounted journey's unsaved edits/retry identities while visiting the wallet. The wallet URL supports reload. Direct wallet previews do not mount a hidden live journey or make financial API calls.

## Current backend audit before requests changed

Inspected current `backend/finance/urls.py`, `workflow_urls.py`, `workflow_api.py`, `workflow_serializers.py`, `wallet_api.py`, `fx_rates.py`, `remittance_api.py`, `remittance_orders.py`, `policy_api.py`, `policy.py`, and readiness/consumption/copilot routes/contracts. Django session authentication and CSRF requirements are unchanged.

All routes below have the `/api/v2/` prefix:

| Method / route | Current contract and permissions |
|---|---|
| GET demo/wallets/balances/ | Owned initialized simulated wallet; `{data: {home_currency, balances, is_simulated}}`. No frontend balance calculations. |
| GET corridors/ | `{data: Corridor[]}`; server-supported currencies, limits and settlement windows. |
| GET beneficiaries/ | Owned paginated `results`. Only verified recipients can be used for external orders. |
| POST fx-quotes/live/ | `{corridor_id, send_amount}`; executable quote under `data`. Route works with server fixture FX or live rates depending on settings. UI never uses manual/operator quote pricing. |
| GET remittance-orders/ | Owned paginated `results`. |
| GET remittance-orders/{id}/ | Owned `{data: order}` with effective expiry/status/history. |
| POST remittance-orders/ | Quote ID, SELF/BENEFICIARY recipient, beneficiary ID where applicable, purpose/reference/optional deadline. Preparation does not debit. Current executable quote and verified beneficiary enforced by B. |
| POST remittance-orders/{id}/submit/ | `{expected_version}`, Idempotency-Key and, when required, X-Step-Up-Token. Policy and financial transaction are server-enforced. |
| POST auth/step-up/ | Password plus exact action/target/amount/currency; top-level token response. Five-minute single-use binding. Password/token are not persisted or retained in retry fingerprints. |
| GET/POST approvals/ | Student reads owned requests or requests approval with action/target/amount/currency/reason. Backend prevents multiple open requests. This API is not the generic command-idempotency wrapper: lost approval responses require authoritative refresh; an existing open request returns 409. |
| POST approvals/{id}/decide/ | Staff only, expected_version; separate from student UI. Beneficiary verifier cannot approve that remittance. |
| POST beneficiaries/{id}/verify/ | Operator-only; not exposed in student UI. |
| POST remittance-orders/{id}/adapter-event/ | Operator-only; not exposed in student UI. |

Wallet lists now follow all same-origin `/api/v2/` pages through the final `getAll` helper. Source's first-page-only limitation is resolved, including creation recovery searches. The browser test includes a second beneficiary page. Successful submissions and order-status refreshes reload backend balances and approvals rather than retaining the earlier wallet snapshot. External pagination destinations and repeated pages are rejected.

Contract difference: fresh quote creation can return `receiver_fee` as numeric **0** because the newly constructed backend model carries that literal before reread. Wallet display formats the supplied value as text; null remains unknown. It does not infer a fee or calculate pricing.

Readiness commands retain semester/state/budget/available analysis versions, and same-payload retries retain their keys. No backend source, serializer, financial calculation, extraction workflow or worker policy was changed.

## Executed validation and boundaries

- TypeScript and production Vite build: passed.
- Six browser suites: original demo, connected journey, synthetic tour, dashboard preview, mocked connected dashboard, and wallet. Mock/synthetic results remain separate from live HTTP. Suites cover errors, retry keys, nullable values, stale inputs, expandable controls, mobile navigation, synthetic preview isolation and session/CSRF wallet contracts.
- Actual five-step Chromium journey: real Django HTTP/session/CSRF, PostgreSQL 17, persistent `readiness_worker --mode mock`, readiness and consumption enabled. Includes C's evidence/missing-field/source-conflict response, amount/date correction, stable merged IDs, original extraction retained, verified locks, unknown expense persistence/reload, B's incomplete and complete budgets/forecast/funding/loan/application, actual 409 with restored edits, lost committed budget/source responses without duplication, and live dashboard restoration.
- Actual wallet Chromium journey: real Django HTTP/session/CSRF and PostgreSQL 17 with **STUDYFLOW_FX_LIVE=false / fixture FX**. Backend prices quotes. A disposable semester/wallet is initialized through HTTP. A distinct operator verifies a beneficiary, and a different operator decides the T3 approval. Student attempts to verify, decide or call an adapter callback are denied. No operator decision buttons exist in student UI.
- Wallet preparation leaves balances unchanged. Failed-before-commit and dropped-after-commit creation use the same body/key and produce one order. T2 step-up submission response is dropped after commit; replay of that same key/body returns the saved command response even after the single-use grant is consumed, with one debit and one submitted event.
- T3 requires operator approval then password step-up. Reload restores authoritative orders and USED approval status. Quote expiry is tested by moving only a disposable fixture quote timestamp into the past, followed by actual HTTP reads and rejection. This is controlled expiry testing, not waiting for production timeouts.
- A real wallet HTTP 409 is checked through the order-version command. Readiness separately tests a genuinely changed version from another legitimate client and UI recovery.
- Targeted Django suites: **60 passed** (`auto_test.test_student_session`, `auto_test.test_remittance`, `auto_test.test_remittance_concurrency`) against PostgreSQL. Full unrelated backend/C suites were not rerun.
- Desktop/mobile layouts: journey 1440/390, synthetic tour desktop/mobile, wallet 1440/390/320. Runtime errors and horizontal overflow are checked. Screenshots are generated in ignored output/frontend and /tmp.

Modes are separate: database/session/CSRF/transactions/idempotency/HTTP are real; **C extraction providers are mock**, **FX is fixture**, and money is simulated. Text and text-layer PDF extraction run through the actual worker. Image upload with OCR disabled requires manual transcription, then worker processing. **No live extraction provider, Frankfurter live FX, or Gemini OCR request was tested.** Remittance endpoints do not require the readiness worker. Mocked wallet refund/unknown views do not establish live delivery/refund callbacks; live callback execution is outside this UI task (student denial was verified).

Reports: ignored `output/frontend/integration.json` and `output/frontend/wallet-integration.json` contain timestamps, modes, checks and concrete live routes/UUIDs. Previous failed checks were traced to stopped Vite, changed accessible headings/expandable sections and a preview-only quote/application association defect; those were corrected and affected checks rerun. No assertion was removed to conceal a backend failure.

## Remaining prerequisites and review decisions

Precommit recheck on 10 October 2026: build/type check, all six browser suites, both real Django HTTP journeys and all 60 targeted Django tests passed again. The first journey run exposed a test race: notifications can change between the dashboard load and a separate verification GET. The assertion now compares the rendered count with the exact real HTTP response consumed by the dashboard; the full journey passed after this correction. No application assertion was weakened. `git diff --check` passed. Work remains uncommitted and unpushed on `front-end`.

No known blocking frontend defect remains in the exercised baseline. Wallet funding/initialization, beneficiary verification, separate-operator T3 decisions and later simulated delivery callbacks remain backend/operator prerequisites. The student interface displays those limits instead of bypassing them. Conversion, remittance reconciliation controls, real payment rails and other backlog pages are not claimed as implemented.

Notification/review writes remain absent. The dashboard preview, synthetic journey and wallet preview remain fixed/read-only. Live models/OCR/FX, production hosting and remote CI are unverified. No deployment or merge approval is implied by these checks.

Team lead review: changes are uncommitted on `front-end` and unpushed. No merge conflict occurred. Review the preserved session/CSRF and live-dashboard boundaries, scoped styling, wallet pagination/client adapter, new synthetic presentation components, and test/handoff changes. The current branch base already includes backend 341e66a; this task adds no backend changes.

## Exact HTTP endpoints exercised

UUIDs are normalized to `{id}` below. Concrete fixture IDs, modes and run timestamps are in the generated JSON reports. Role prefixes distinguish student traffic from operator-assisted test setup.

### Five-step journey and live dashboard

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

### Wallet/remittance

- `approver: GET /api/auth/login/`
- `approver: GET /api/auth/session/`
- `approver: GET /api/v2/approvals/`
- `approver: GET /api/v2/beneficiaries/`
- `approver: GET /api/v2/corridors/`
- `approver: GET /api/v2/demo/wallets/balances/`
- `approver: GET /api/v2/remittance-orders/`
- `approver: POST /api/auth/login/`
- `approver: POST /api/v2/approvals/{id}/decide/`
- `student: GET /api/auth/login/`
- `student: GET /api/auth/session/`
- `student: GET /api/v2/approvals/`
- `student: GET /api/v2/beneficiaries/`
- `student: GET /api/v2/corridors/`
- `student: GET /api/v2/demo/wallets/balances/`
- `student: GET /api/v2/remittance-orders/`
- `student: GET /api/v2/remittance-orders/{id}/`
- `student: POST /api/auth/login/`
- `student: POST /api/v2/approvals/`
- `student: POST /api/v2/approvals/{id}/decide/`
- `student: POST /api/v2/auth/step-up/`
- `student: POST /api/v2/beneficiaries/`
- `student: POST /api/v2/beneficiaries/{id}/verify/`
- `student: POST /api/v2/demo/initialize/`
- `student: POST /api/v2/fx-quotes/live/`
- `student: POST /api/v2/readiness/semesters/`
- `student: POST /api/v2/remittance-orders/`
- `student: POST /api/v2/remittance-orders/{id}/adapter-event/`
- `student: POST /api/v2/remittance-orders/{id}/cancel/`
- `student: POST /api/v2/remittance-orders/{id}/submit/`
- `verifier: GET /api/auth/login/`
- `verifier: GET /api/auth/session/`
- `verifier: GET /api/v2/approvals/`
- `verifier: GET /api/v2/beneficiaries/`
- `verifier: GET /api/v2/corridors/`
- `verifier: GET /api/v2/demo/wallets/balances/`
- `verifier: GET /api/v2/remittance-orders/`
- `verifier: POST /api/auth/login/`
- `verifier: POST /api/v2/approvals/{id}/decide/`
- `verifier: POST /api/v2/beneficiaries/{id}/verify/`

## Changed file groups

- Existing frontend: `src/main.tsx`, `src/backend/ConnectedApp.tsx`, `client.ts`, `FundingComparison.tsx`, `PaymentCalendar.tsx`, and synthetic `previewAdapter.ts`.
- Added presentation: three `Preview*.tsx` components, `student-start.css`, `sprint4.css`.
- Added wallet: `src/wallet/{WalletApp.tsx,client.ts,types.ts,mockAdapter.ts,wallet.css}`.
- Tests: updated existing journey/tour/demo/dashboard selectors for reviewed layouts; new mocked wallet and real wallet integration suites; package scripts.
- Documentation/CI: `frontend/README.md`, this handoff, `.github/workflows/frontend.yml` now also runs wallet integration. Remote CI was not triggered.
