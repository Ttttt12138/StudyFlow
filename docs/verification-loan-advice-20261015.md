# Conversational loan adviser verification — 2026-10-15

Scope: the uncommitted workspace based on `990e558`, implementing the user's request for proactive loan recommendations, responses to concerns and guidance through application. The current flow is defined in [the shared contract](student-loan-contract.md). This change has no schema migration.

## Resulting behavior

- Choosing a school introduces the recommended product and asks for the desired principal. It reuses the school and course context; it never substitutes the course cost for a missing loan amount.
- A stated amount produces one recommendation with principal, annual rate, maximum monthly payment, fees, interest, total repayment, school proceeds and repayment date. The existing backend calculator also supplies the alternatives and any interest-only phases.
- Monthly-payment and interest concerns recalculate available terms and show the tradeoff against the actual previous quote. A request to borrow less asks only for the new amount. Explicit product/method preferences persist.
- The recommendation card and a conversational request to apply both lead to review of the current plan, assessment version and quote. Only the user's confirmation submits the application. The existing documents/signing panel then opens; submission does not sign or disburse.
- Refusal persists as a paused recommendation, including across a new conversation. Earlier cards cannot submit an obsolete quote.
- A successful `simulate_loan` result ends that tool cycle with a factual server-authored answer. This prevents a second model call from repeatedly recalculating the same concern or changing the displayed numbers. Trace metadata distinguishes the model's decisions from the deterministic reply.

## Verification results

| Check | Result | Local evidence |
| --- | --- | --- |
| Django `finance` and `auto_test` | 625 discovered: 622 passed, 3 opt-in historical browser fixtures skipped | `output/loan-advice-backend-complete.log` |
| AI package pytest suite | 468 passed | `output/loan-advice-ai-final.log` |
| Frontend unit suite | 78 passed in 12 files | `output/loan-advice-frontend-unit.log` |
| Mocked browser suite | All 54 passed in the combined run | `output/loan-advice-browser-final.log` |
| Real Django/PostgreSQL browser suite | All 8 passed in the final integration rerun | `output/loan-advice-integration-final.log`, `output/loan-advice-integration-final/report/` |
| TypeScript and Vite production build | Passed; existing large-chunk warning remains | `output/loan-advice-frontend-build.log` |
| Django check, migration drift, OpenAPI validation, AI Ruff and changed-backend Ruff | Passed; no migration changes | `output/loan-advice-openapi.yaml`, terminal checks |
| Bilingual preview recording | Passed through real rule-mode APIs in a dedicated test database | `output/loan-advice-preview.log`, `frontend/src/plan/preview-data/` |
| Live planner regression | Seven turns passed with simulated loans | `output/loan-advice-live.json`, `output/loan-advice-live.log` |

The new backend and AI cases cover missing amounts, currency conversion, cost-cap errors, actual product-rate comparisons, persisted constraints, interest-only phases, pause/resume, application review without submission, stale-quote rejection and completion without another model call. Frontend tests check exact review matching; real-API browser journeys cover both card interaction and the explicit application confirmation.

The English desktop journey uses 1440×1000 and the Chinese narrow-viewport journey uses 390×844 in installed Edge. Both select a school, borrow THB 48,000, request a lower monthly payment (60 months), request less interest (24 months), reduce principal to THB 30,000 and explicitly submit one application. The resulting application remains unsigned. Screenshots of the recommendation and review dialog were inspected; there were no page errors or horizontal overflow. This is browser emulation, not physical-device keyboard or Safari coverage. Screenshots are under `output/loan-advice-integration-final/loan-advice-*.png` and `loan-advice-review-*.png`.

## Live regression provenance

The live path used `planning-2.2`, the configured gateway and model `openai/gpt-6-luna`, with a synthetic account in the isolated browser database. Its seven turns cover recommendation, monthly-payment concern, total-interest concern, a request to borrow less, the new amount, application review and refusal. There were eight recorded planner calls and nine total attempts, followed by seven separately marked deterministic replies. Each turn performed one `simulate_loan` call. No application was submitted by this live-script regression; the final persisted recommendation was paused.

The first attempt exposed repeated calculation calls and an invalid final response. That failed result is preserved in `output/loan-advice-live-attempt01.json` and `.log`. The deterministic completion fix has a regression test, and the subsequent seven-turn run passed. This is a targeted regression following a repair, not an independent frozen acceptance evaluation or proof of broad live-model reliability. All products and financial effects remain simulated.

## Isolation and reproduction

Use `studyFlow/Scripts/python.exe`. Backend tests used `DB_TEST_NAME=test_studyflow_loan_advice_20261015`; the preview recorder used `test_studyflow_loan_advice_preview_20261015`. Browser and live regression data used only `DB_NAME=studyflow_loan_advice_browser_20261015`. The user's development database was neither migrated nor reset for this change.

The test API listened on 8016 and Vite on 5186. Test settings in `output/loan_advice_browser_settings.py` disable persistent database connections to avoid exhausting PostgreSQL connections during browser runs. The API and mock readiness worker share the isolated database. Use `STUDYFLOW_MODE=mock`, fixture FX and `STUDYFLOW_SIMULATED_APPROVAL_SECONDS=0` for integration tests.

The first combined browser run passed all 54 mocked cases and six integration cases, but the payments case timed out because the test API retained the development automatic-approval shortcut. The wallet case was interrupted while correcting that same configuration. Its log and trace are retained in `output/loan-advice-browser-final/`; application code was not changed to accommodate this test setup. After disabling that shortcut in the isolated test API, all eight integration tests passed in 1.3 minutes. That full rerun is recorded separately in `output/loan-advice-integration-final.log`.

From the repository root:

```powershell
$env:DB_TEST_NAME='test_studyflow_loan_advice_20261015'
.\studyFlow\Scripts\python.exe backend/manage.py test finance auto_test --noinput --keepdb
```

From `studyflow-ai/`:

```powershell
..\studyFlow\Scripts\python.exe -m pytest auto_test -q -o cache_dir=../output/loan-advice-pytest-cache --basetemp=../output/loan-advice-pytest-tmp
```

From `frontend/`, with the isolated API, Vite and mock worker running:

```powershell
$env:TEST_URL='http://127.0.0.1:5186'
$env:PYTHON='D:\Qoder-project\AI studyflow\studyFlow\Scripts\python.exe'
$env:CHROMIUM_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:DB_NAME='studyflow_loan_advice_browser_20261015'
$env:STUDYFLOW_MODE='mock'
$env:STUDYFLOW_FX_LIVE='false'
$env:STUDYFLOW_SIMULATED_APPROVAL_SECONDS='0'
npx vitest run
npx playwright test --project=mocked --project=integration
npm run build
```

The ordinary development frontend (5173), its session proxy and backend health endpoint (8000) returned HTTP 200 after the change; see `output/loan-advice-dev-health.json`. No commit, push or deployment was performed.
