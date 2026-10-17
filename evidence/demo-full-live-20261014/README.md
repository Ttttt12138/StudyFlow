# October 14 full-flow acceptance (historical)

This folder is retained as historical evidence for two AI reliability fixes described in [`docs/security-self-assessment.md`](../../docs/security-self-assessment.md) (clock guidance and output validation). It is not the current demo; the current 4:28 film and its acceptance run are in [`../demo-current-live-20261015/`](../demo-current-live-20261015/README.md).

All money, wallets, loans and payments in these runs are simulated in a disposable PostgreSQL test database.

| Path | What it shows |
| --- | --- |
| `take-04/` | Failed take: the model compared quote expiry with the advanced demo study date and repeatedly refreshed valid quotes. Browser, Django and Vite logs, the conversation (`turns.json`), the full model trace, the failure screen, and the source baseline/hash manifest. |
| `take-05/` | Failed take: unstructured gateway prose was treated as a final answer and no reminder was created. Same log set as take-04. |
| `clock-fix-*.log` | Test runs for the clock fix (`memory.server_time` supplied to the planner). |
| `format-fix-red.log`, `format-fix-*.log`, `format-explicit-ai.log`, `format-live-probe*.json` | Failing-then-passing tests and live probes for the output-validation fix (bounded retry, then `INVALID_MODEL_OUTPUT`). |
| `take-07/` | The accepted October 14 take, kept intact (uncut recordings, turns, model trace, frozen source). It is read by `scripts/verify_neural_demo.py`. |
| `edit-manifest.json`, `formal-zira-previous-20261014/edit-manifest.json` | Edit manifests kept only because the shared editing modules in `scripts/` (`verify_full_demo.py`, `edit_neural_demo.py`, `verify_neural_demo.py`) reference these paths. |

Earlier takes, superseded films and production archives were removed from the submission; they remain in git history.
