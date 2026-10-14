# StudyFlow Security, Database, Account, and Functional Test Report

**Date:** 2026-10-14 (Asia/Bangkok)  
**Repository:** `C:\psu\project with senior\Frontend`  
**Branch:** `integration/abc`  
**Commit:** `1933598` (`feat(frontend): show each school's data sources on plan cards`)  
**Overall result:** **Partially passed — core backend/database/account controls pass; AI and browser-flow regressions remain.**

## Executive summary

The updated StudyFlow frontend and backend are running together locally. Vite serves the frontend on port 5173 and proxies `/api` requests to Django on port 8000. Django connects successfully to the project PostgreSQL database on port 55432.

The strongest result is the backend: all 611 Django tests passed on an isolated PostgreSQL 16 cluster, with two intentional skips. This covers account/authentication behavior, permissions, CSRF/session handling, concurrency, ledger/database constraints, planning, loans, payments, remittance, credit, OCR gates, and other application workflows.

The targeted browser security suite also passed all 17 tests. It verified password sign-in, email-code signup UI, anonymous access boundaries, CSRF handling, password step-up, separate-operator approval, public verification, and non-persistence of sensitive tokens.

The release is not fully green. Four AI-package tests fail, six mocked browser flows time out, and the first real browser integration journey times out after the backend successfully processes its API calls. These should be resolved before treating the branch as release-ready.

## Running environment

| Component | Address | Result |
|---|---|---|
| Frontend (Vite) | `http://127.0.0.1:5173` | Running; HTTP 200 |
| Django API | `http://127.0.0.1:8000` | Running |
| Django health | `http://127.0.0.1:8000/health/` | `200`, database connected |
| Frontend-to-backend proxy | `http://127.0.0.1:5173/api/auth/session/` | `200`, anonymous session plus CSRF token returned |
| Project PostgreSQL | `127.0.0.1:55432` | Running and connected |
| Readiness worker | mock mode | Running |

The project is running in local mock mode. The planner/chat works through Django's built-in rule-based planner without an external AI API. Live OpenAI, Gemini OCR, and live FX providers were not enabled or tested.

## Test results

| Area | Command or check | Result |
|---|---|---|
| Database connection | Django `/health/` | **PASS** — `database: connected` |
| Migrations | `manage.py migrate --noinput` | **PASS** — migrations `0019` through `0031` applied |
| Cache/throttling table | `manage.py createcachetable` | **PASS** — `studyflow_cache` exists |
| Django configuration | `manage.py check` | **PASS** — no issues |
| Django deployment security | `manage.py check --deploy` | **WARN** — five local-development warnings; see Security findings |
| Django/backend suite | `manage.py test --noinput` on isolated PostgreSQL 16 | **PASS** — 611 passed, 2 skipped, 0 failed |
| Python dependencies | `python -m pip check` | **PASS** — no broken requirements |
| npm dependency audit during install | `npm ci` | **PASS** — 0 vulnerabilities reported |
| Frontend production build | `npm run build` | **PASS** — typecheck and Vite build completed |
| Frontend unit tests | `npm run test:unit` | **PASS** — 171/171 |
| Targeted account/security browser tests | sign-in, agent, credit, and family specs | **PASS** — 17/17 |
| AI package | `pytest auto_test` | **FAIL** — 441 passed, 4 failed (445 collected) |
| Mocked browser suite | `npm run test:e2e` | **PARTIAL/FAIL** — through test 54: 42 passed, 6 failed, 6 skipped; 20 not run after stopping the timeout chain |
| Real browser integration | `npm run test:integration` | **PARTIAL/FAIL** — first agent journey timed out at 300 seconds; one test was skipped and the remaining nine were not run |

## Database validation

- The live project role connected successfully to the existing StudyFlow database.
- All current migrations applied cleanly to the live development database.
- The health endpoint confirmed database availability without leaking connection details.
- The normal application role cannot create databases. This is a good least-privilege property, but it prevented Django from creating its temporary test database.
- To test real PostgreSQL safely, a separate temporary PostgreSQL 16 cluster was initialized on port 55434. Django created and destroyed its test database there. All 611 backend tests passed. The temporary server was stopped after the run.
- Database-focused coverage includes migrations, transaction/concurrency behavior, non-negative balance and ledger invariants, idempotency, approvals, remittance state changes, loan/payment state, and account/session records.

## Account and security validation

The passing backend and targeted browser suites covered:

- Password sign-in and session creation.
- Email verification-code signup behavior in the UI.
- Anonymous versus authenticated access boundaries.
- CSRF token retrieval and `X-CSRFToken` use on writes.
- Password step-up for sensitive T2 actions.
- Rejection of an incorrect password before execution.
- Separate-operator approval for T3 actions.
- One-time approval/grant semantics and idempotency keys.
- No password, sponsor token, or confirmation token retained in local storage, session storage, or the URL.
- Public credit-statement verification without creating a session cookie.
- Sponsor/family token removal from the URL fragment after use.
- Throttling/error behavior and stable error responses.
- Health-check failure behavior without database-detail leakage.

No secret values or test passwords are included in this report.

## Security findings

### S1 — Production HTTPS hardening is disabled in the local configuration

**Severity:** Medium for deployment; expected for local HTTP development.

`manage.py check --deploy` reported:

- `SECURE_HSTS_SECONDS` is unset.
- `SECURE_SSL_REDIRECT` is false.
- `SESSION_COOKIE_SECURE` is false.
- `CSRF_COOKIE_SECURE` is false.
- `DEBUG` is true.

Before deploying publicly, use a production environment with HTTPS, `DEBUG=False`, secure session and CSRF cookies, redirect-to-HTTPS, and carefully configured HSTS. Do not enable HSTS on an HTTP-only local environment.

### S2 — Two AI planning-fact extraction regressions

**Severity:** High for chat/planning data correctness.

The following tests fail because `monthly_income` is absent from parsed results:

- `test_labelled_amounts_keep_their_own_currency`
- `test_ambiguous_amount_is_not_silently_selected_and_punctuation_is_safe`

Impact: the rule-based planner can omit a clearly supplied monthly income in both Chinese labelled input and an English sentence containing ambiguous savings values. This may produce incomplete affordability/planning results.

### S3 — Frozen holdout evidence files are missing

**Severity:** Medium for evaluation integrity.

Two holdout-integrity tests fail because these frozen files are missing:

- `studyflow-ai/evals/copilot-holdout-v2/frozen/finance/affordability.py.txt`
- `studyflow-ai/evals/copilot-holdout-v3/frozen/finance/affordability.py.txt`

Impact: the repository cannot prove that the recorded v2/v3 blind evaluation used the exact pinned runtime code when the current file digest differs.

### S4 — Browser workflows time out after UI changes

**Severity:** High for regression confidence; exact user impact needs confirmation.

The mocked browser run timed out in six flows:

- Two preparation/journey-transition tests.
- One monthly-spending question/draft-preservation test.
- Two payment tests, including the T3 approval/password flow.
- One planner-preview test.

The real Django agent journey also timed out after 300 seconds. Backend logs showed successful authentication/session calls, funding-source writes, conversation creation, wallet reads, and planning responses. The captured page remained on the planner screen, indicating a frontend expectation/navigation mismatch rather than a database or API outage.

Playwright evidence is under `output/frontend/test-results/` and `output/frontend/report/`.

### S5 — Large frontend bundles

**Severity:** Low; performance/maintainability.

The production build passed but warned about chunks above 500 kB, including an approximately 1.08 MB main JavaScript chunk and a 632 kB world-data chunk. Consider route/module-level dynamic imports and manual chunking.

## Functional coverage summary

The passing backend suite exercises the application's core functions, including:

- Accounts, sessions, OTP challenges, permissions, throttling, and audit records.
- Wallet balances, FX quotes, conversions, top-ups, and ledger invariants.
- Remittance lifecycle, refunds, callbacks, and idempotency.
- T2 password step-up and T3 separate-person approvals.
- Credit records/statements and public verification.
- Loans, affordability, disbursement, repayment, and simulated dates.
- Study planning, school/cost data, plan confirmation, bills, expenses, and family links.
- Payments, readiness, consumption analysis, copilot behavior, and OCR security gates.
- Agent action limits, pending-action confirmation, proposal expiry, and concurrency.

The browser-level account/security subset is green, but the complete mocked and real integration suites are not green because of the timeouts listed above.

## Recommended next actions

1. Fix `monthly_income` extraction in `studyflow_ai.agent.planning_facts` and rerun all 445 AI tests.
2. Restore or intentionally regenerate the v2/v3 frozen affordability evidence with documented provenance; do not merely update hashes to silence the guard.
3. Review the six timed-out mocked specs against the current navigation/UI wording and determine whether the product or the tests are stale.
4. Inspect the real agent trace and update the broken transition/locator, then rerun all 11 real integration journeys.
5. Apply the five Django deployment-security settings in a production-only environment.
6. Rerun the complete gate command after fixes and require all non-optional suites to be green before release.

## Test limitations

- External live AI, Gemini OCR, and live FX services were not tested; mock mode was used.
- The complete mocked browser suite was stopped after repeated two-minute timeouts; 20 tests were not reached.
- The complete real integration suite was stopped after the first five-minute timeout to avoid a cascade of long timeouts; nine tests were not reached.
- This was a local development security/functional validation, not a penetration test or production infrastructure review.
