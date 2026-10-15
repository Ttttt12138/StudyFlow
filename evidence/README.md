# Evidence Index

This folder holds the run logs and reports behind the claims in `docs/`. Raw execution reports are preserved as written by their commands; indexes and explanatory summaries are identified separately. `.gitattributes` keeps evidence bytes exact on every OS, so recorded SHA-256 digests stay valid. Superseded runs and earlier films were removed from the submission and remain in git history.

**All money movement is simulated.** Wallets, ledgers, loans, remittance rails, approvals and payouts are demo models running in a local (usually disposable) PostgreSQL test database. "Live" below means only that a real external service was called: the LLM gateway, the Frankfurter FX API, or Google Gemini for OCR. All accounts and documents are synthetic; no real user data is involved.

Run every command from the repository root. On Windows the interpreter is `studyFlow/Scripts/python.exe`; elsewhere, use the Python of your virtual environment. Mock-mode commands need only PostgreSQL. Live commands also need the credentials described in `studyflow-ai/.env.example`.

## Current test status

On 2026-10-16 the current code passed: Django **632 tests** (2 opt-in recordings skipped), C package (`studyflow-ai`) **481 tests**, frontend **81 unit + 54 mocked browser tests**. The archived gate run in `gates/` is a recorded run of an earlier commit (see §2).

## Contents

| Folder | What it shows | Mode | Date |
|---|---|---|---|
| [`demo-current-live-20261015/`](demo-current-live-20261015/README.md) | **Current 4:25 English demo film** and its live acceptance run (take-07): 19 live-AI user turns, 13 scenario checks, separate payee verifier and approver, uncut recordings and simulated-account operation logs | live LLM / fixture FX / simulated funds | 2026-10-15 |
| [`gates/`](gates/) | Full local gate suite (17 checks), recorded run of an earlier commit | mock | 2026-10-07 |
| [`agent/`](agent/) | Agent task completion and safety: tuning set and frozen holdout | live LLM + mock | 2026-10-07 |
| [`fx/`](fx/) | Server-side FX quotes from a live reference rate match the pricing formula | live FX | 2026-10-07 |
| [`ocr/`](ocr/) | Gemini OCR: provider failures first, then a passing model and the full HTTP chain | live OCR | 2026-10-06/07 |
| [`copilot/`](copilot/) | Earlier backend-only finance copilot module: HTTP demos and benchmark runs | live LLM + mock | 2026-10-06/07 |
| [`frontend-20261011/`](frontend-20261011/README.md) | Browser suites (mocked + real Django), unit tests, screenshots in English and Chinese | mock | 2026-10-11 |
| [`planning-live-20261014/`](planning-live-20261014/README.md) | Plan-to-loan signing and repayment with the live model: two browser journeys, preserved failed attempt | live LLM / simulated funds | 2026-10-14 |
| [`short-planning-20261013/`](short-planning-20261013/), [`short-planning-20261014/`](short-planning-20261014/) | Short planning journey (catalog, comparison, loan, signing, repayment) on desktop and phone against real Django | rule planner / simulated funds | 2026-10-13/14 |
| [`verification-20261011/`](verification-20261011/v5-first-live-summary.md) | First live run of the frozen copilot holdout v5 (backend-only module), referenced by `studyflow-ai/evals/copilot-holdout-v5/first-run.result.json` | live LLM | 2026-10-11 |
| [`demo-full-live-20261014/`](demo-full-live-20261014/README.md) | Historical October 14 acceptance logs supporting two AI reliability fixes cited in `docs/security-self-assessment.md` | live LLM / simulated funds | 2026-10-14 |

## 1. Demo film and 06 Execution evidence: `demo-current-live-20261015/`

[Watch the 4:25 English film](demo-current-live-20261015/StudyFlow_Demo_EN.mp4) · [English subtitles](demo-current-live-20261015/StudyFlow_Demo_EN.srt) · [Acceptance details](demo-current-live-20261015/README.md)

The film is edited only from the recorded take-07 browser run: real model calls, real local Django/PostgreSQL, simulated money. Only the English narration text was sent to Microsoft's speech service, with the user's explicit authorization.

**Execution evidence (checklist item 06).** Operation logs of the simulated accounts used in the run:

| File | Contents |
|---|---|
| [`take-07/financial-audit.json`](demo-current-live-20261015/take-07/financial-audit.json) | Audit events of the simulated accounts (newest 50 of 82: reminders, exchange, remittance, approval, tuition and repayment) |
| [`take-07/turns.json`](demo-current-live-20261015/take-07/turns.json) | Every user turn, agent tool call and tool result |
| [`take-07/model-trace.json`](demo-current-live-20261015/take-07/model-trace.json) | Full trace of the external model calls |
| [`take-07/approval-records.json`](demo-current-live-20261015/take-07/approval-records.json) | Independent staff approval of the over-limit transfer |
| [`take-07/loan-after-signing.json`](demo-current-live-20261015/take-07/loan-after-signing.json), [`loan-after-repayment.json`](demo-current-live-20261015/take-07/loan-after-repayment.json) | Simulated loan record after signing and after the repayment |
| [`take-07/raw/`](demo-current-live-20261015/take-07/raw/) | Uncut student, payee-verifier and approver recordings |
| [`take-07/coverage.json`](demo-current-live-20261015/take-07/coverage.json), [`accepted-source.zip`](demo-current-live-20261015/take-07/accepted-source.zip), [`source-check.json`](demo-current-live-20261015/take-07/source-check.json) | Scenario assertions, frozen source and post-run hash check |

Reproduce a new take (needs live-model credentials and PostgreSQL; creates its own test database):

```bash
studyFlow/Scripts/python.exe -B -X utf8 scripts/run_formal_demo.py <new-take>
```

Media reproduction steps are in the folder's README.

## 2. Gate suite: `gates/`

The suite ran on 2026-10-07 against commit `8bde47b`. It is a recorded run of an earlier commit, not of the code as submitted; current suite results are listed under "Current test status" above.

```bash
studyFlow/Scripts/python.exe scripts/run_gates.py
```

The script writes each check to `output/gates/<name>.log`, and each demo also writes a `<name>.json` report. [`summary.txt`](gates/summary.txt) shows all 17 checks as `PASS`.

| File | Scenario |
|---|---|
| `holdout-freeze.log` | Code pinned by the v2/v3 blind-test protocols is still recoverable (empty log means OK) |
| `check.log`, `migrations.log`, `migrate.log`, `cache-table.log` | Django system checks, no missing migrations, migrations apply, shared rate-limit cache table exists |
| `i18n.log` | Chinese/English message catalogs are complete and compiled (empty log means OK) |
| `django-tests.log` | Django test suite on PostgreSQL at that commit: 481 tests, OK |
| `c-ruff.log`, `c-tests.log` | C module lint and tests at that commit: 298 passed |
| `demo-remittance.json` / `.log` | Remittance, 3 runs over real HTTP: route quotes against a deadline, payment to an operator-verified payee, full refund of a failed transfer, and an over-limit order approved as T3 by a second operator |
| `demo-agent.json` / `.log` | Agent, 3 runs over real HTTP in Chinese and English: the agent only *proposes*; the wallet is unchanged until the user confirms with step-up, and a second proposal changes nothing |
| `eval-agent.json` / `.log` | Agent evaluation in mock mode: 20/20 cases, 0 unsafe actions, 0 injections followed |
| `demo-bc.*`, `demo-readiness.*`, `demo-consumption.*`, `demo-copilot.*` | Regression demos for the modules the agent builds on |

In mock mode the agent planner is rule-based, so the 20/20 result shows the plumbing and the runner's safety checks work. It does **not** measure model quality; for that, see `agent/`.

## 3. Agent evaluation: `agent/`

```bash
cd backend  # Django commands run inside backend/
../studyFlow/Scripts/python.exe manage.py evaluate_agent --mode live --env-file ../studyflow-ai/.env
../studyFlow/Scripts/python.exe manage.py evaluate_agent --mode mock
# frozen holdout agent-v2 (live; quote only its first run, agent-eval-v2-live-first.json)
../studyFlow/Scripts/python.exe manage.py evaluate_agent --mode live --env-file ../studyflow-ai/.env --dataset ../studyflow-ai/evals/agent-v2/cases.jsonl
```

`studyflow-ai/evals/agent-v1/cases.jsonl` is the tuning set (20 cases, 3 with prompt-injection attempts). `studyflow-ai/evals/agent-v2/cases.jsonl` is the frozen holdout (24 cases, 4 with injection attempts). Full write-up: [docs/agent-evaluation.md](../docs/agent-evaluation.md).

| File | Run | Task completion | Unsafe actions | Injections followed |
|---|---|---:|---:|---:|
| [`agent-eval-live.json`](agent/agent-eval-live.json), [`-2`](agent/agent-eval-live-2.json), [`-3`](agent/agent-eval-live-3.json) | live, rounds 1–3 | 6/20, 9/20, 13/20 | 0 | 0/3 |
| [`agent-eval-v1-live-tuning-4.json`](agent/agent-eval-v1-live-tuning-4.json), [`-5`](agent/agent-eval-v1-live-tuning-5.json), [`-6`](agent/agent-eval-v1-live-tuning-6.json) | live, rounds 4–6 (tuning) | 14/20, 15/20, 15/20 | 0 | 0/3 |
| [`agent-eval-v2-live-first.json`](agent/agent-eval-v2-live-first.json) | **live, frozen holdout agent-v2, first run** | **18/24** | **0** | **1/4** |
| [`agent-eval-v2-mock.json`](agent/agent-eval-v2-mock.json) | mock planner on agent-v2, reference only | 18/24 | 0 | 1/4 |
| [`agent-live-smoke-report.json`](agent/agent-live-smoke-report.json) | live, 1-case smoke run | 0/1 | 0 | — |
| [`agent-eval-dev.json`](agent/agent-eval-dev.json), [`agent-eval-dev2.json`](agent/agent-eval-dev2.json) | mock, during development | 18/20, 20/20 | 0 | — |

Read these numbers with care: rounds 1–6 tuned the parser and tool descriptions after seeing failures, so they are not independent tests; the labels were AI-written and not human-reviewed; each round ran once. Quote the agent-v2 first run. Failure analysis: [docs/verification-live-20261007.md §2](../docs/verification-live-20261007.md).

## 4. Live FX: `fx/`

```bash
cd backend
../studyFlow/Scripts/python.exe manage.py shell -c "exec(open('scripts/verify_live_fx.py', encoding='utf-8').read())"
```

[`verification-live-fx.json`](fx/verification-live-fx.json): 4 currency pairs fetched live from Frankfurter, none stale; 12 route quotes built inside a rolled-back transaction; fee, spread and payout amounts match the formula worked by hand. Details: [docs/verification-live-20261007.md §1](../docs/verification-live-20261007.md).

## 5. Gemini OCR: `ocr/`

All files use the synthetic samples in `backend/examples/ocr/v1/`, in chronological order: provider failures first, then the fix.

```bash
cd backend
../studyFlow/Scripts/python.exe manage.py verify_document_ocr --live --output output/<name>.json
../studyFlow/Scripts/python.exe scripts/verify_ocr_http.py output/<name>.json
../studyFlow/Scripts/python.exe scripts/diagnose_ocr_transport.py output/<name>.json
```

| File | Result |
|---|---|
| `ocr-provider-diagnostic.json`, `ocr-independent-20261006-*.json`, `ocr-gemini36-diagnostic.json` | 2026-10-06: configured models unavailable (404 / 503 / timeout) |
| `ocr-independent-http-first.json`, `ocr-independent-http-gemini36.json` | Full HTTP chain while the provider was failing: failed safely, financial state unchanged |
| `ocr-probe-20261007-gemini35lite.json`, `ocr-probe-20261007-gemini31lite.json` | 2026-10-07: 5/6 and 6/6 passed |
| `ocr-live-20261007-gemini31lite-fallback.json` | Primary model plus fallback, at most 3 attempts: 6/6 passed |
| `ocr-http-20261007-gemini31lite.json` | **Full HTTP chain passed**; the document waits in `NEEDS_REVIEW`, wallet and ledger unchanged |

OCR only transcribes text. It never moves money, and an extracted document always waits for user confirmation. Details: [docs/gemini-ocr.md](../docs/gemini-ocr.md).

## 6. Finance copilot (earlier backend-only module): `copilot/`

Commands: `manage.py demo_copilot` and `manage.py evaluate_copilot` (run inside `backend/`). Each file's SHA-256 digest is recorded in [docs/copilot-verification-summary.json](../docs/copilot-verification-summary.json), [docs/independent-verification-summary.json](../docs/independent-verification-summary.json) and [docs/holdout-v3-verification-summary.json](../docs/holdout-v3-verification-summary.json).

| File | Scenario |
|---|---|
| `copilot-87171484….json` | HTTP demo, mock: main flow plus injected failures |
| `copilot-9851955e….json`, `copilot-4cd15888….json` | HTTP demo, live model, 3 runs each |
| `copilot-eval-69c402c5….json` | First frozen benchmark run: **failed** the accuracy threshold, kept as-is |
| `copilot-eval-949f52cf….json`, `-858c7302….json`, `-9ec9264f….json`, `-5944e657….json` | Later regression runs on the same dataset (not blind tests) |
| `copilot-independent-v2-first.json`, `copilot-independent-v3-first.json` | First runs on the v2 and v3 blind holdouts |

## 7. Frontend and planning journeys

- [`frontend-20261011/`](frontend-20261011/README.md): Playwright (mocked and real-Django) and Vitest results, typecheck/build logs and screenshots from 2026-10-11.
- [`planning-live-20261014/`](planning-live-20261014/README.md): live-model planning acceptance; report in [docs/verification-planning-live-20261014.md](../docs/verification-planning-live-20261014.md).
- `short-planning-20261013/`, `short-planning-20261014/`: browser runs of `frontend/auto_test/short-planning.browser.mjs` through `backend/auto_test/test_short_planning_browser.py` (`RUN_SHORT_PLANNING_BROWSER=1`).

## Pre-publication check

Before copying, every file was scanned for API keys, bearer and JWT tokens, auth headers, password and token fields, e-mail addresses, phone numbers and team members' personal identifiers. No secrets were found. The only hits were public PSU web pages used as source URLs; test fixtures such as `secret@example.com`, `127.0.0.1` and `169.254.169.254`; and absolute paths to the build machine's project folder (`D:\Qoder-project\...`), left in place because editing them would invalidate recorded digests.
