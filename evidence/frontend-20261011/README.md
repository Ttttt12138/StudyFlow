# Frontend run evidence, 2026-10-11

Browser and unit test results for `frontend/` after the AI assistant, the permissions & activity page, the global simulation strip and the English/Chinese switch were added. Everything ran on Windows 11, Node 25, Chromium from `npx playwright install`, Django with PostgreSQL 17 in mock mode (mock planner, fixture FX), `readiness_worker --mode mock`, readiness and consumption enabled. All money is simulated.

| File | What it shows |
|---|---|
| `playwright.log` | `npx playwright test` (both projects): **15 passed**. 12 mocked specs plus 3 integration specs against real Django and PostgreSQL |
| `playwright-report/` | Playwright HTML report of that run (open `index.html`) |
| `vitest.log` | `npx vitest run`: **73 passed** (money and date presentation, freshness, import rebasing, upload kinds, API errors, pagination, CSRF renewal, validation) |
| `typecheck.log`, `build.log` | `tsc --noEmit` without errors; production `vite build` |
| `agent-integration.json` | `integration/agent.spec.mjs`: the agent plans and proposes, the wallet is unchanged until the student confirms with a password check (CNY 40,000 → 35,000), a wrong password is refused, a 15,000 CNY proposal is refused as T3 until a separate approver decides, then executes once (→ 20,000) and the approval becomes `USED`. The trust center shows the limit usage and the audit trail of each step |
| `wallet-integration.json` | `integration/wallet.spec.mjs`: fixture quotes, beneficiary gate, T2/T3, expiry, permissions, safe retries and reload |
| `integration.json` | `integration/journey.spec.mjs`: the five-step saved journey with session/CSRF and the C mock worker |
| `screenshots/` | Pages captured by the specs at desktop and phone widths: `agent-*` (preview in English and Chinese, mocked flow, live run), `trust-*` (preview in English and Chinese, mocked, live at 1440 and 390 px), `wallet-*`, `dashboard-*`, `connected-*`, `budget-*`, `integration-*`, `preview-mobile` |

## Reproduce

From `frontend/`, with Django on 127.0.0.1:8000 (`STUDYFLOW_READINESS_ENABLED=true`, `STUDYFLOW_CONSUMPTION_ENABLED=true`), PostgreSQL and `manage.py readiness_worker --mode mock` running as described in [frontend/README.md](../../frontend/README.md):

```bash
npm test
npm run test:integration && npm run test:wallet-integration && npm run test:agent-integration
```

The integration specs create disposable synthetic users and records in the development database; they never print or store passwords. For this run the frontend was served by Vite on port 5174 against a second Django process on port 8001 (`TEST_URL`, `PYTHON` set), so the developer's own servers were left untouched.

## Limits

Chromium only. Integration runs used a local HTTP origin, not a deployed HTTPS site, and the mock planner rather than a live model (live-model agent results are in [`../agent/`](../agent/)).
