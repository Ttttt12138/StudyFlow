# Execution Evidence

This folder holds the sandbox run logs and reports behind the claims in `docs/`. Every file is a verbatim copy of what a command wrote to the git-ignored `output/` folder. Nothing was edited after the run. `.gitattributes` keeps the bytes exact on every OS, so the SHA-256 digests recorded in `docs/*-verification-summary.json` stay valid.

**All money movement is simulated.** Wallets, ledgers, remittance rails and payouts are demo models. "Live" below means only that a real external service was called: the Frankfurter FX API, the LLM gateway configured for the C module, or Google Gemini for OCR. All test documents are synthetic, and no real user data is involved.

Run every command from the repository root. On Windows the interpreter is `studyFlow/Scripts/python.exe`; elsewhere, use the Python of your virtual environment. Mock-mode commands need only PostgreSQL. Live commands also need the credentials described in `studyflow-ai/.env.example`.

## Contents

| Folder | What it proves | Mode | Date |
|---|---|---|---|
| [`gates/`](gates/) | The full local gate suite (17 checks) passes on the submitted code | mock | 2026-10-07 |
| [`fx/`](fx/) | Server-side FX quotes from a live reference rate match the pricing formula | live FX | 2026-10-07 |
| [`agent/`](agent/) | Agent task completion and safety on the 20-case dataset | live LLM + mock | 2026-10-07 |
| [`ocr/`](ocr/) | Gemini OCR: provider failures first, then a passing model and the full HTTP chain | live OCR | 2026-10-06/07 |
| [`copilot/`](copilot/) | Finance copilot HTTP demos and model benchmark runs | live LLM + mock | 2026-10-06/07 |
| [`django-bc-20261005/`](django-bc-20261005/) | B + C integration on Django and PostgreSQL | mock | 2026-10-05 |
| [`c-module-20261004/`](c-module-20261004/) | Early standalone C-module (`studyflow-ai`) verification | mock + live | 2026-10-04 |

## 1. Gate suite: `gates/`

The suite ran on 2026-10-07. The application code under test is identical to the merge commit `de87c37` on `feature/bc-integration`. Only documentation, this folder and `scripts/` have changed since.

```bash
studyFlow/Scripts/python.exe scripts/run_gates.py
```

The script writes each check to `output/gates/<name>.log`, and each demo also writes a `<name>.json` report. [`summary.txt`](gates/summary.txt) shows all 17 checks as `PASS`.

| File | Scenario |
|---|---|
| `holdout-freeze.log` | Code pinned by the v2/v3 blind-test protocols is still recoverable (empty log means OK) |
| `check.log`, `migrations.log`, `migrate.log`, `cache-table.log` | Django system checks, no missing migrations, migrations apply, shared rate-limit cache table exists |
| `i18n.log` | Chinese/English message catalogs are complete and compiled (empty log means OK) |
| `django-tests.log` | Django test suite on PostgreSQL: **480 tests, OK** |
| `c-ruff.log`, `c-tests.log` | C module lint and tests: **293 passed** (`studyflow-ai/auto_test`) |
| `demo-remittance.json` / `.log` | **Proposition C remittance**, 3 runs over real HTTP. Each run: compare route quotes against a deadline, pay tuition to an operator-verified payee (`CREATED → SUBMITTED → IN_TRANSIT → DELIVERED → RECONCILED`), refund a failed transfer in full, approve an order above the 10,000 CNY limit as T3 through a second operator, and record the on-time payment in the credit profile |
| `demo-agent.json` / `.log` | **Proposition C agent**, 3 runs over real HTTP in Chinese and English sessions. The agent only *proposes* the remittance submission, and the wallet is unchanged until the user confirms with step-up. A second proposal is rejected and changes nothing. |
| `eval-agent.json` / `.log` | Agent evaluation in mock mode: 20/20 cases, 0 unsafe actions, 0 injections followed |
| `demo-bc.*`, `demo-readiness.*`, `demo-consumption.*`, `demo-copilot.*` | Regression demos for the B/C modules that proposition C builds on |

In mock mode the agent planner is rule-based, so the 20/20 result shows the plumbing and the runner's safety checks work. It does **not** measure model quality. For model quality, see `agent/`.

`openapi.yaml` is not copied. It is byte-identical to the tracked [`openapi.yaml`](../openapi.yaml).

## 2. Live FX: `fx/`

```bash
studyFlow/Scripts/python.exe manage.py shell -c "exec(open('scripts/verify_live_fx.py', encoding='utf-8').read())"
```

| File | Result |
|---|---|
| [`verification-live-fx.json`](fx/verification-live-fx.json) | 4 currency pairs fetched live from Frankfurter, none stale. 12 route quotes built inside a rolled-back transaction. Fee, spread and payout amounts match the formula worked by hand. |

Details: [docs/verification-live-20261007.md §1](../docs/verification-live-20261007.md).

## 3. Agent evaluation: `agent/`

```bash
# live model (needs the LLM gateway credentials in studyflow-ai/.env)
studyFlow/Scripts/python.exe manage.py evaluate_agent --mode live --env-file studyflow-ai/.env
# mock planner
studyFlow/Scripts/python.exe manage.py evaluate_agent --mode mock
```

Dataset: `studyflow-ai/evals/agent-v1/cases.jsonl` (20 cases; 3 of them contain prompt-injection attempts).

| File | Run | Task completion | Unsafe actions | Injections followed |
|---|---|---:|---:|---:|
| [`agent-eval-live.json`](agent/agent-eval-live.json) | live, round 1 | 6/20 | 0 | 0/3 |
| [`agent-eval-live-2.json`](agent/agent-eval-live-2.json) | live, round 2 | 9/20 | 0 | 0/3 |
| [`agent-eval-live-3.json`](agent/agent-eval-live-3.json) | live, round 3 | 13/20 | 0 | 0/3 |
| [`agent-live-smoke-report.json`](agent/agent-live-smoke-report.json) | live, 1-case smoke run before round 1 | 0/1 | 0 | — |
| [`agent-eval-dev.json`](agent/agent-eval-dev.json), [`agent-eval-dev2.json`](agent/agent-eval-dev2.json) | mock, during development | 18/20, 20/20 | 0 | — |

**Read these numbers with care.**
- Between rounds, the parser and the tool descriptions were fixed after the developers had seen the previous round's failures. The labels were not changed. Round 3 is therefore **not** a frozen, independent test, and 13/20 must not be quoted as a final score.
- The dataset and labels were written by AI and have not been reviewed by a human. Each round ran once, so run-to-run variance is unknown.
- The `injection_followed` field was added in round 3. The counts for rounds 1 and 2 were recomputed from the saved results using the same definition.

Failure analysis: [docs/verification-live-20261007.md §2](../docs/verification-live-20261007.md).

## 4. Gemini OCR: `ocr/`

Every file here uses the synthetic samples in `examples/ocr/v1/`. The files are listed in chronological order: they show the provider failures first, then the fix.

```bash
# six-sample transcription check against the configured model(s)
studyFlow/Scripts/python.exe manage.py verify_document_ocr --live --output output/<name>.json
# full chain: real loopback HTTP -> PostgreSQL worker -> Gemini -> C live extraction
studyFlow/Scripts/python.exe scripts/verify_ocr_http.py output/<name>.json
# single raw request, to diagnose provider errors (the API key is redacted from the output)
studyFlow/Scripts/python.exe scripts/diagnose_ocr_transport.py output/<name>.json
```

| File | Result |
|---|---|
| `ocr-provider-diagnostic.json` | 2026-10-06: `gemini-2.5-flash` returns 404, because the model is no longer offered to new users |
| `ocr-independent-20261006-configured.json` | Six-sample check on that model: failed (`OCR_PROVIDER_ERROR`) |
| `ocr-independent-20261006-gemini38.json`, `-gemini36.json` | Same check on other models: failed (`OCR_UNAVAILABLE` / `OCR_TIMEOUT`) |
| `ocr-gemini36-diagnostic.json` | Raw response: 503 `UNAVAILABLE`, "high demand", which is a provider capacity problem |
| `ocr-independent-http-first.json`, `ocr-independent-http-gemini36.json` | Full HTTP chain while the provider was failing: failed safely, with the financial version, budget, wallet and ledger the same before and after |
| `ocr-probe-20261007-gemini35lite.json` | 2026-10-07: `gemini-3.5-flash-lite`, 5/6 passed (one 503) |
| `ocr-probe-20261007-gemini31lite.json` | `gemini-3.1-flash-lite`, 6/6 passed |
| `ocr-live-20261007-gemini31lite-fallback.json` | Primary model plus fallback, at most 3 attempts: 6/6 passed |
| `ocr-http-20261007-gemini31lite.json` | **Full HTTP chain passed.** The document ends in `NEEDS_REVIEW` with `source_type=gemini_ocr`. Financial version, budget version, wallet (10,000.00) and ledger (0 entries) are the same before and after. |

OCR only transcribes text. It never moves money, and an extracted document always waits for user confirmation. Details: [docs/verification-independent-20261006.md](../docs/verification-independent-20261006.md) and [docs/gemini-ocr.md](../docs/gemini-ocr.md).

## 5. Finance copilot: `copilot/`

Commands: [docs/copilot.md](../docs/copilot.md) (`demo_copilot`, `evaluate_copilot`). Each file's SHA-256 digest is recorded in [docs/copilot-verification-summary.json](../docs/copilot-verification-summary.json), [docs/independent-verification-summary.json](../docs/independent-verification-summary.json) and [docs/holdout-v3-verification-summary.json](../docs/holdout-v3-verification-summary.json).

| File | Scenario |
|---|---|
| `copilot-87171484….json` | HTTP demo, mock: main flow plus injected failures |
| `copilot-9851955e….json`, `copilot-4cd15888….json` | HTTP demo, live model, 3 runs each |
| `copilot-eval-69c402c5….json` | First frozen benchmark run: **failed** the accuracy threshold, kept as-is |
| `copilot-eval-949f52cf….json`, `-858c7302….json`, `-9ec9264f….json`, `-5944e657….json` | Later regression runs on the same dataset (marked as regression runs, not blind tests) |
| `copilot-independent-v2-first.json` | First run on the new v2 blind holdout |
| `copilot-independent-v3-first.json` | First run on the v3 blind holdout |

Write-ups: [docs/verification-copilot-20261006.md](../docs/verification-copilot-20261006.md), [docs/verification-independent-20261006.md](../docs/verification-independent-20261006.md), [docs/verification-holdout-v3-20261007.md](../docs/verification-holdout-v3-20261007.md).

## 6. B + C integration: `django-bc-20261005/`

Django tests, B core JUnit, C regression JUnit, the 3-run integration report and an HTTP smoke check. Write-up and commands: [docs/verification-django-b-20261005.md](../docs/verification-django-b-20261005.md).

## 7. Early C-module run: `c-module-20261004/`

A verbatim copy of `studyflow-ai/output/verification-2026-10-04-1791120299950/`, without its pytest temp folder. It records the first standalone verification of the C package: 130 tests, 87.19% statement coverage, 15/15 offline contract checks, 3 consecutive live-model demo runs, live PDF extraction, live FX, and 32/32 cases on the frozen evaluation set. `environment.json` pins the package versions and the SHA-256 of every source file at the time of the run. Later work has superseded the test counts; the current numbers are in `gates/`.

Write-up: [studyflow-ai/docs/verification-2026-10-04.md](../studyflow-ai/docs/verification-2026-10-04.md).

## Not included

`legacy/studyflow-backend/` is an earlier standalone lending prototype that is not part of this submission. Its own run outputs stay in its git-ignored `output/` folder, so the links in its old docs do not resolve.

## Pre-publication check

Before copying, every file was scanned for API keys (Google, OpenAI-style, GitHub, AWS), bearer and JWT tokens, auth headers, password and token fields, e-mail addresses, phone numbers and team members' personal identifiers. No secrets were found. The only hits were:
- public PSU web pages used as source URLs;
- test fixtures such as `secret@example.com`, `127.0.0.1` and `169.254.169.254`, which appear inside test names;
- absolute paths to the build machine's project folder (`D:\Qoder-project\...`). These were left in place, because editing them would invalidate the recorded digests.

## Demo video

To be added. A link will go here when the recording is published.
