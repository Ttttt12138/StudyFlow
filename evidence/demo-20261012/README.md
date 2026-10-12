# Demo rehearsal, three consecutive runs (2026-10-12)

**All money movement is simulated.** This folder proves the plan's acceptance item "data can be reset, and the full flow runs three times in a row in the delivery environment".

- **Environment:** compose project `studyflow-demo-20261012` (PostgreSQL 17, Django/gunicorn, the mock readiness worker, nginx serving the built frontend), all running the working tree on base commit `4b4a90a` plus uncommitted changes. Ports: web `127.0.0.1:8098`, API `8028`, DB `55448`. The stack runs with `STUDYFLOW_ALLOW_DEMO_RESET=true`.
- **Script:** [`docs/demo-script.md`](../../docs/demo-script.md).
- **Automation:** [`frontend/tests/e2e/demo/rehearsal.spec.mjs`](../../frontend/tests/e2e/demo/rehearsal.spec.mjs). Each run starts with `manage.py reset_demo --yes` inside the `app` container, reads the fresh demo credentials from the container, then drives every section through the browser as `demo-payer`, `demo-student`, `demo-operator`, `demo-approver`, an anonymous family member and an anonymous verifier.

```bash
docker compose -p studyflow-demo-20261012 up -d --build --wait
```

```bash
TEST_URL=http://127.0.0.1:8098 DEMO_EVIDENCE=demo-20261012 npx playwright test --project=demo --repeat-each 3
```

The compose command needs `STUDYFLOW_ALLOW_DEMO_RESET=true STUDYFLOW_API_PORT=8028 STUDYFLOW_DB_PORT=55448 STUDYFLOW_WEB_PORT=8098` in the environment. Run the Playwright command from `frontend/`.

## Result: 3 of 3 runs passed

| Run | Started (UTC) | Duration | Steps passed | Page errors |
|---|---|---|---|---|
| 1 | 2026-10-11T21:17:12Z | 30.8 s | 10/10 | 0 |
| 2 | 2026-10-11T21:17:52Z | 35.3 s | 10/10 | 0 |
| 3 | 2026-10-11T21:18:38Z | 36.0 s | 10/10 | 0 |

These are the times recorded in each `steps.json`. Playwright's own totals (39–45 s per run) also include browser start-up and teardown.

### Steps in every run (run 1 timings)

| Step | Time |
|---|---|
| reset demo database | 7.1 s |
| sign in all roles | 1.9 s |
| 1 tuition payment: authorize, wrong then correct password, operator settles, reconcile with invoice | 4.3 s |
| 2 over-limit CNY transfer: verifying operator blocked, second operator approves, password, dispatched, delivered | 2.4 s |
| 3 CNY→THB conversion with password; two ledger legs | 1.2 s |
| 4 CSV import (rising costs), then recalculation; wallet balance unchanged | 4.8 s |
| 5 family support: request, operator link, anonymous confirmation, money recorded as received | 1.7 s |
| 6 loan: quote, affordable application, operator disbursement, demo clock, repayment with password | 2.4 s |
| 7 what-if: compare, preview, apply; wallet balance unchanged | 3.6 s |
| 8 signed on-time statement verified by an anonymous visitor; a tampered copy fails | 1.5 s |

## Files

- `run-<n>/steps.json`: the per-step record (name, pass/fail, seconds, error text if any, page errors).
- `run-<n>/*.png`: one full-page screenshot per section.
- `run-1/videos/<role>/*.webm`: the screen recording of run 1, one video per role.
- The videos of runs 2 and 3 were kept out of the repository to save space (`output/agent-notes/demo-videos/`, ignored).

## Defects found and fixed while getting here

1. **What-if apply was blocked.** On an account with a confirmed tuition invoice, applying any what-if scenario failed with `USE_IMPORT_CONFIRMATION_TO_VERIFY`. The cause: the verified cost's timestamps are stored as `+00:00` but compared against a dump that writes `Z`. `normalize_draft` now compares canonical forms on both sides. Regression tests: `backend/auto_test/test_readiness_verified.py`.
2. **Reset kept rate-limit counters.** The first three-run attempt failed in runs 2 and 3 on step-up throttling (10 per hour). `flush` keeps the database cache table, and the recreated users get the same ids, so step-up counters from earlier runs carried over. `reset_demo` now also clears the cache.
