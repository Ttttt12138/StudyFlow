# Planning live AI acceptance 2026-10-14

The English desktop and Chinese phone journeys passed with the external model gateway, real local Django/PostgreSQL and simulated funds. See the [acceptance report](../../docs/verification-planning-live-20261014.md) for results, conditions and reproduction.

| File or folder | Purpose |
|---|---|
| `protocol.json` | Initial requirements and source hashes; integrated acceptance, not a frozen independent benchmark |
| `backend-baseline.log`, `baseline/` | 155 passing related tests, including the rule-based browser flow |
| `ai-focused-tests.log` | 136 passing AI contract/rule/fact/planner checks |
| `attempt-01.log`, `attempt-01/` | Preserved failed harness attempt after five successful live calls |
| `attempt-02.log`, `attempt-02/` | Passing desktop/phone flow, eight successful live turns, fifteen recorded live calls |
| `attempt-02/source-manifest.json` | Passing-run source fingerprint; no drift during the run |
| `attempt-02/runner-source.py.txt` | Exact executed Python runner before a semantics-preserving import-spacing cleanup |
| `attempt-02/model-trace.json` | Persisted live provider metadata, steps and outcomes; no keys or auth headers |
| `attempt-02/turns.json`, `browser.json` | User turns and browser journey results |

Loan terms and payments are simulations. Checklist completion is a declaration, not document verification. FX uses fixtures. The planning route calls the LLM, not Jev. The gateway supplied no request IDs, and some answers lack usage metadata. No real bank, loan, transfer or school receipt was exercised.
