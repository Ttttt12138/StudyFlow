# StudyFlow AI module (C)

`studyflow-ai` is the Python package that the Django backend (`backend/`, module B) imports in-process. It holds the parts of StudyFlow that decide or explain, while B owns money, state, permissions and the ledger:

| Part | Source | Used by B for |
|---|---|---|
| Agent planner | `src/studyflow_ai/agent/` (`planner.py`, `prompts.py`) | Each turn of the planning conversation: choose one tool call or a final answer. Live mode calls the LLM gateway (prompt `planning-2.6`, finance prompt `agent-1.3`); mock mode uses the deterministic `RuleAgentProvider` |
| Planning rules and replies | `agent/planning_rules.py`, `loan_rules.py`, `funnel.py`, `planning_facts.py` | Rule planner for offline runs, the server-written loan recommendation reply, and the one next-step invitation that ends every reply |
| FX reference rates | `readiness/fx.py` (`FxAdapter`) | Live reference rates (Frankfurter) or fixtures behind B's server-side quotes |
| Document OCR | `gemini_ocr.py`, `ocr_config.py` | Optional Gemini OCR behind B's consent and operator attestations |
| Evaluation | `evaluation.py`, `evals/` | Agent task sets (`agent-v1` tuning, `agent-v2` frozen holdout) and the frozen copilot holdouts |

The planner never moves money. It proposes tool calls; B validates every argument, enforces the step and write budgets, refuses wallet tools before the loan application is submitted, and executes T2 actions only after the student confirms. See [docs/agent.md](../docs/agent.md) and [docs/technical-overview.md §7](../docs/technical-overview.md#7-agent-loop-and-guardrails).

## Setup and tests

Python 3.11 or later. The repository's shared environment is `studyFlow/` at the repository root (see the [main README](../README.md#local-development)); from this directory:

```powershell
..\studyFlow\Scripts\python.exe -m pip install -r requirements.lock
..\studyFlow\Scripts\python.exe -m pip install --no-deps -e .
..\studyFlow\Scripts\python.exe -m pytest -p no:cacheprovider
..\studyFlow\Scripts\python.exe -m ruff check src auto_test scripts
```

On macOS/Linux use `../studyFlow/bin/python`. The suite (481 tests on 2026-10-17) runs offline.

## Model configuration

`STUDYFLOW_MODE=mock` (the default) makes no network calls. `live` reads `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `OPENAI_MODEL` from the process environment, or from a file passed explicitly with `--env-file`; `.env.example` lists the settings. Defaults are `OPENAI_BASE_URL=https://ai.psu.blue/v1` and `OPENAI_MODEL=openai/gpt-6-luna`. Calls record the model version, usage, latency and error code, and live mode never falls back silently to mock. Never commit real keys.

## Evaluation

The agent evaluation runs through the backend so it uses the real tool runner:

```bash
cd ../backend
../studyFlow/Scripts/python.exe manage.py evaluate_agent --mode mock --min-success 1.0
```

Mock mode checks the plumbing and the runner's safety rules; model quality is measured in live mode on the frozen `agent-v2` holdout. Results and limitations are in [docs/agent-evaluation.md](../docs/agent-evaluation.md). Holdout files are hash-checked by tests and must not be edited.

## Retired modules (backend only)

Earlier versions of this package also provided bank-statement and bill import (`ingestion.py`, `import_jobs.py`, `http.py`), recurring-payment detection, budget readiness and funding plans (`readiness/`, apart from the FX adapter), a finance copilot and a standalone funding-gap demo (`demo.py`). These features were removed from the product on 2026-10-15. The code and its tests stay until the retired backend modules are deleted after the competition; they are not part of the current student journey. [C module capabilities](docs/c-module-capabilities-en.md) records what they did.
