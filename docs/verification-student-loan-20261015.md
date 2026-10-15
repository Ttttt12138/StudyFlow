# Student loan flow verification — 2026-10-15

Scope: the current uncommitted workspace and [shared contract](student-loan-contract.md). The student flow uses a typed principal, full-course cap, mandatory application and automatic simulated admission notice. Removed features are not part of the current student UI or planning API.

## Results

| Check | Result | Local evidence |
| --- | --- | --- |
| Django `finance` + `auto_test` | 604 discovered: 601 passed, 3 opt-in browser/recording tests skipped | `output/simplify-backend-tests.log` |
| AI package full pytest suite | 451 passed | `output/simplify-ai-tests.log` |
| Frontend unit suite | 74 passed, 10 files | `output/simplify-frontend-full.log` |
| Frontend mocked browser suite | 38 passed | `output/simplify-frontend-full.log`, `output/simplify-browser/report/` |
| Real Django/PostgreSQL browser suite | 6 passed | `output/simplify-integration-tests.log`, `output/simplify-integration/report/` |
| TypeScript + Vite production build | Passed; existing large-chunk warning remains | `output/simplify-frontend-build.log` |
| Django system check, migration drift, gettext catalogs, OpenAPI validation, C Ruff | All passed | `output/gates/{check,migrations,i18n,openapi,c-ruff}.log` |
| Preview recording | Unified recorder passed; both languages and both stages agree on plan ID/status, principal and automatic notice | `frontend/src/plan/preview-data/` |

The generated `backend/openapi.yaml` matches the separately regenerated validated schema byte for byte. `git diff --check` passes.

The three skipped Django cases are `test_full_demo_browser`, `test_short_planning_browser` and `test_study_life_browser`, gated by opt-in recording environment variables. They are historical workflows, not current acceptance. The retained six real-API Playwright suites provide current integration coverage. No live-model, OCR-provider, real-money or production deployment acceptance is claimed.

## Coverage relevant to this change

- Required positive principal, no automatic gap inference, fees excluded from the course-cost cap, stale revisions and missing quote rejection.
- Read-only loan preview and amount/product/term/method estimate before explicit application confirmation.
- Automatic completed admission notice at submission, idempotent replay and rejection of attempts to undo the notice.
- DRAFT/CONFIRMED navigation, legacy URL compatibility and wallet/remittance gating before submission.
- Approved application → other documents → explicit signing → school payout schedule → funded wallet → due installment repayment, exercised through the real UI and API.
- Populated 0034→0035 schema upgrade with ENROLLED, confirmed-without-loan and enrolled-without-loan rows. Historical credit repayment amount, currency, date, timestamp, owner, sequence and origin UUID survive. Append-only trigger still rejects ledger mutation after migration.
- Retained wallet balances, currency conversion, bill payments, T2 password check, T3 separate approver, idempotency after lost responses and ledger results.
- Read-only previews, no preview API calls, English/Chinese desktop and narrow viewport navigation, price composition and conversion confirmation visibility. Rendered desktop/mobile screenshots were inspected; this does not cover physical-device keyboards or Safari.

## Reproduction and isolation

Use the repository `studyFlow/Scripts/python.exe` interpreter. The Django suite used `DB_TEST_NAME=test_studyflow_simplify_20261015`. Real browser tests used only `DB_NAME=studyflow_simplify_browser_20261015`, with unique synthetic users and fixture FX. The user's development database was neither migrated nor reset.

From the repository root, with PostgreSQL configured:

```powershell
$env:DB_TEST_NAME='test_studyflow_simplify_20261015'
.\studyFlow\Scripts\python.exe backend/manage.py test finance auto_test --noinput --keepdb
.\studyFlow\Scripts\python.exe backend/manage.py test auto_test.fixture_plan_preview --noinput --keepdb
.\studyFlow\Scripts\python.exe scripts/run_gates.py --only check i18n migrations openapi c-ruff
```

For the last gate command, set `DB_NAME` to the isolated browser database. Run AI tests from `studyflow-ai/`:

```powershell
..\studyFlow\Scripts\python.exe -m pytest auto_test -q -o cache_dir=../output/pytest-simplify-cache4 --basetemp=../output/pytest-simplify-tmp4
```

The browser API and mock readiness worker used the same isolated database. Vite listened on 5178, proxying to the isolated Django server on 8015. The test-only settings file `output/simplify_browser_settings.py` sets `DATABASES['default']['CONN_MAX_AGE']=0` to avoid persistent connection exhaustion from Django's threaded development server. Application settings and existing development listeners remain unchanged.

From `frontend/`, point `TEST_URL` at that Vite instance and set `PYTHON` to the project interpreter. The tested browser is installed Edge via `CHROMIUM_PATH`; no bundled-browser assumption is required.

```powershell
$env:TEST_URL='http://127.0.0.1:5178'
$env:PYTHON='D:\Qoder-project\AI studyflow\studyFlow\Scripts\python.exe'
$env:CHROMIUM_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:DB_NAME='studyflow_simplify_browser_20261015'
$env:STUDYFLOW_MODE='mock'
npm test
npm run test:integration
npm run build
```

Migration 0035 is ready and validated in isolated databases. Back up the deployment target before applying it: deleted family/budget/expense/credit-feature data cannot be reconstructed by a reverse schema migration. Existing financial ledger rows and actual loan records are retained. No commit, push or deployment was performed.

## Authorized development restart after validation

The user subsequently requested a development database backup, migration and frontend/backend restart. Inspection found `0035_simplify_student_loan_flow` already applied at `2026-10-15T08:38:08.539634Z`. The new full backup `output/db-backups/studyflow-current-20261015-161239.dump` therefore captures the current migrated database. It was restored successfully to a disposable database; row counts and row-content digests matched for users, plans, applications, loan accounts/installments, disbursements, wallets, balances, ledger and school bills. SHA-256: `1B4CE0B8A125F7F7D2261724F3718A091D90086D556F0876D6171FE0CF2B8158`.

The existing pre-0035 backup `output/db-backups/studyflow-before-0035-20261015-49f6fc8f.dump` was also checked with `pg_restore --list`; it includes the retired tables. It was preserved. The subsequent authorized `migrate --noinput` reported no pending migrations, and `migrate --check` and Django system checks passed.

The development backend (8000) and Vite frontend (5173) were restarted using `studyFlow` and the existing live AI / fixture-FX configuration. Health, session/CSRF proxy, expected authentication denial, and authenticated reads for existing DRAFT/CONFIRMED records passed. Three read-only browser checks passed against the restarted frontend: complete eight-stop tour, application/automatic-notice preview, and bilingual cost composition. This smoke check did not invoke the live LLM or reset existing accounts/data. Operational logs and backup metadata are under `output/dev-restart-20261015/`.
