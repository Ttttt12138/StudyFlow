# Planning Flow Live AI Acceptance

On 2026-10-14, the current StudyFlow planning flow passed two complete browser journeys using the configured external model gateway: an English desktop journey and a Chinese phone-width journey. Eight user turns completed through the live planner, followed by explicit user actions for loan selection, plan confirmation, checklist completion, signing and first repayment. Fifteen recorded planner calls used `openai/gpt-6-luna` and prompt `planning-1.7`; no rule-provider fallback or tool error was recorded.

This is acceptance of the current integrated flow using synthetic users and simulated funds. It is not an independent frozen benchmark, a real lending transaction, or a measure of general model accuracy. The model guides and explains; the user confirms the financial actions and the server calculates and executes them.

## Environment and evidence

| Item | Value |
|---|---|
| Backend | Real local Django HTTP server and PostgreSQL, isolated test database `test_studyflow_planning_live_acceptance_20261014` |
| Frontend | Current React/Vite app on dedicated port 5197, Chromium using installed Chrome |
| Model | Configured gateway model and call-record model: `openai/gpt-6-luna` |
| Prompt | `planning-1.7` |
| AI route | Main planning conversation calls the LLM; it does not call Jev |
| Financial data | Ten sourced sample school entries; fixed reference FX; synthetic student declarations |
| Funds and documents | Simulated wallets/loans/payouts; checklist declarations, no actual document verification |
| Approval shortcut | `STUDYFLOW_SIMULATED_APPROVAL_SECONDS=0` during acceptance |
| Review | Automated assertions authored by the coding assistant; no independent human review |

The [protocol](../evidence/planning-live-20261014/protocol.json) states the criteria and original source hashes. The passing attempt's [source manifest](../evidence/planning-live-20261014/attempt-02/source-manifest.json) records the actual files; none changed during that run. The only change from the first attempt was in the browser harness. A later import-spacing cleanup preserves the runner's Python AST; the [executed runner source](../evidence/planning-live-20261014/attempt-02/runner-source.py.txt) and final integrity record retain that distinction.

## Results

| Check | English desktop 1440 x 1000 | Chinese phone 390 x 844 |
|---|---|---|
| Four-school full-course comparison | Passed; four structured school cards | Passed; four structured school cards |
| School and declared funds reused | PSU Phuket, 10,000 THB | PSU Phuket, 10,000 THB |
| Server pre-check explained | 1,003,800 THB ceiling; no application submitted | Same ceiling; no application submitted |
| Pre-enrollment request to transfer without confirmation | Money tools deferred; plan remains draft | Money tools deferred; plan remains draft |
| Plan and loan confirmation | One approved simulated application | One approved simulated application |
| Product and amount | Commercial sample, 20,000 THB, 4.5%, 60-month amortization | Same product; 42 interest-only months followed by 60-month amortization |
| Documents and signing | Explicit checklist actions and signing | Explicit checklist actions and signing |
| Payout | Scheduled to the school; operator wallet disbursement refused | Same |
| First repayment | Password step-up; installment `PAID`, 372.86 THB | Password step-up; installment `PAID`, 75.00 THB interest |
| Browser errors / horizontal document overflow | None / none | None / none |

The simulated 20,000 THB loan covers part of the course gap, not the entire 1,003,800 THB. Planning approval sizes the loan against the gap; it does not assess family affordability. Signing locks the chosen plan and generates simulated bill allocations. The demo date and a separately recorded 10,000 THB top-up make the first repayment possible. Neither action is a bank receipt or real settlement.

The [browser results](../evidence/planning-live-20261014/attempt-02/browser.json) contain the two journeys; [turns](../evidence/planning-live-20261014/attempt-02/turns.json) contain the goals, answers, cards and steps; the [model trace](../evidence/planning-live-20261014/attempt-02/model-trace.json) records every persisted live step. [The runner log](../evidence/planning-live-20261014/attempt-02.log) records `OK` in 83.055 seconds. Eight screenshots show prices, loan selection, signing and repayment; the desktop repayment and phone loan screenshots were visually inspected.

## First attempt and correction

[Attempt 01](../evidence/planning-live-20261014/attempt-01.log) failed after two successful English user turns and five live model calls. The model had already saved the declared funds and opened the loan panel. The harness then tried to fill the pre-check form while the frontend's automatic assessment replaced it, causing a locator timeout. This was an automation timing/flow error, not a passing journey.

The harness was corrected to reuse the model-saved funds and wait for the resulting pre-check. The first attempt's [model trace](../evidence/planning-live-20261014/attempt-01/model-trace.json), browser error and screenshots are retained. Attempt 02 passed without changing the production application or model prompt. The failed attempt is not included in the two passing journey count.

## Related checks and limits

- [155 backend/browser tests](../evidence/planning-live-20261014/backend-baseline.log) passed in a separate isolated database before the live attempt. Coverage includes planning, quotes/confirmation/concurrency, payouts, repayment, policy, OTP/CSRF, top-up and the rule-based browser journey.
- [Focused AI-package checks](../evidence/planning-live-20261014/ai-focused-tests.log) passed: 136 tests for planning contracts, rules, fact extraction and the agent planner.
- Original frontend license copies match their recorded SHA-256 digests; local document links resolve and Markdown fences are balanced.

Successful model records are local instrumentation of the actual provider path. The gateway supplied no request IDs, and some plain-text final answers have no token-usage metadata; do not treat missing usage as zero cost or these traces as provider-signed receipts. Model output is stochastic, and one passing desktop/phone pair is not a reliability estimate. Enrollment completion, post-enrollment live wallet operations, real HTTPS deployment, physical mobile devices and school-side confirmation are outside this acceptance. The historical `agent-v2` first-run score remains unchanged.

## Reproduction

From `backend/`, use a new evidence directory for each live attempt. The configured keys remain in server-side environment files and are never copied into reports.

```powershell
$env:DB_TEST_NAME='test_studyflow_planning_live_acceptance_20261014'
$env:RUN_PLANNING_LIVE_ACCEPTANCE='1'
$env:SHORT_TEST_PORT='5197'
$env:SHORT_TEST_EVIDENCE='planning-live-20261014/attempt-03'
$env:CHROMIUM_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
..\studyFlow\Scripts\python.exe manage.py test auto_test.test_short_planning_browser --noinput --keepdb
```

The test forces live mode explicitly, launches its own Vite server and closes it afterward. It refuses to overwrite a folder containing a live model trace. The normal test suite remains offline unless this opt-in flag is present.
