# StudyFlow student frontend (Task A)

The home page is the agent-first **Study planner** (`src/plan/`, [design](../docs/agent-first.md)): a conversation that plans a school, its full cost, the funding gap and a simulated loan, then manages bills and day-to-day spending once the student is enrolled. B owns every cost, budget, loan and plan result. No frontend financial arithmetic, currency conversion, approval, payment or disbursement occurs. The ZIP was source material; its Git history, local token entry design and standalone configuration were not merged.

## Conversation workspace

`src/workspace/StudentWorkspace.tsx` keeps the planning conversation mounted while student tools open in one panel. At 1100px and above it is a 480px right pane, expandable across the workspace; smaller viewports use a full-screen panel. **Tools** groups all student modules; **My plan**, **Bills & spending** and **Record expense** are immediate shortcuts. Operations, the public sponsor page, credit verification and the legacy demo remain separate.

School, comparison, cost, loan and bill cards show summaries; **View details** opens the original turn's snapshot. Tool forms, filters and scroll positions survive closing and switching during this page session. Hidden tools stop polling and clear passwords/authorization and sponsor-token inputs. Account changes, sign-out and preview changes discard the workspace; reloading restores only server data and the URL target.

Legacy `?wallet=1`, `?loans=1`, etc. resolve to panels. New links use `?tool=wallet`; original money proposals use `?tool=agent&session=…&pending=…`. Browser back/forward restores the panel. Read-only preview links make no API calls. Plan, enrollment and money authorization use focus-managed confirmation dialogs. Successful API writes notify visible tools and the main conversation to refresh; refresh failures retain a retry entry and do not replay the write or fabricate an Agent message.

See [workspace verification](../evidence/workspace-20261012/summary.md) for separately recorded layout, mocked-browser and real-Django results.

## One-command demo

From the repository root, `docker compose up --build` builds this app into the `web` service and starts it with PostgreSQL, Django and the mock readiness worker. Open <http://localhost:8080> and use **Sign in to StudyFlow** with the `demo-student` login from `docker compose exec app cat .demo-credentials.json` (written by `manage.py seed_demo`; see the [main README](../README.md#quick-start-docker-no-credentials-needed)). `Dockerfile` builds with Node 22 and serves `dist/` from nginx; `docker/nginx.conf` proxies `/api/`, `/admin/` and `/health/` to Django with the browser Host, as the Vite proxy does, and serves Django's collected static files for its login page.

## Development

The repository keeps this app (A) next to the Django backend in `../backend/` (B) and the AI package in `../studyflow-ai/` (C). Prepare the Python environment as documented in the main README, start PostgreSQL, run `manage.py migrate --noinput` and `manage.py createcachetable` in `backend/` (required by the current backend’s database-backed throttles), then run these from `backend/` in separate terminals:

```sh
../.venv/bin/python manage.py runserver 127.0.0.1:8000 --noreload
../.venv/bin/python manage.py readiness_worker --mode mock
```

On Windows in this checkout, use `../studyFlow/Scripts/python.exe` instead of `../.venv/bin/python` (the `studyFlow` environment).

Readiness is on by default (`STUDYFLOW_READINESS_ENABLED`, set it to `false` in the ignored `backend/.env` to turn it off). Consumption can also be enabled; its additional coverage requirements must remain visible as incomplete results when no bank history is present. Do not disable those checks to make a student's budget look complete.

From `frontend/` (Node 22+ recommended; validated here on Node 24):

```sh
npm ci
npx playwright install chromium   # once, unless CHROMIUM_PATH points to an installed Chromium-based browser
npm run build
npm run dev                        # for manual use; the browser suites start Vite themselves
npm test                           # unit tests (Vitest) + mocked browser suites (Playwright)
npm run test:integration           # all real Django integration specs
npm run test:wallet-integration
npm run test:agent-integration     # AI assistant T2/T3 and trust center; no worker needed
```

| Command | What runs | Needs |
|---|---|---|
| `npm run test:unit` | Vitest unit tests next to the code (`src/**/*.test.ts`): money and date presentation, version freshness, import rebasing, upload kinds, API errors, pagination and CSRF renewal, form validation | nothing |
| `npm run test:e2e` | Playwright project `mocked` (`tests/e2e/mocked/`): every journey against mocked or synthetic responses, desktop and phone widths | Chromium |
| `npm run test:integration` / `test:wallet-integration` / `test:agent-integration` | Playwright project `integration` (`tests/e2e/integration/`): real HTTP against Django and PostgreSQL | Django on 127.0.0.1:8000, PostgreSQL, `readiness_worker --mode mock` |

Playwright starts Vite (`playwright.config.mjs`) unless `TEST_URL` points at a running server, and pins the browser locale to `en-US`. The integration specs create unique synthetic accounts and durable demo records; they never print or save passwords and call Django through `../.venv` (set `PYTHON` for another interpreter). Run them against a dedicated development database, not a production database. Reports, failure screenshots and traces go to `STUDYFLOW_TEST_OUTPUT` when set, otherwise the ignored `../output/frontend/` (`report/`, `test-results/`); open a trace with `npx playwright show-trace <file>`.

Vite proxies same-origin `/api` to Django at 127.0.0.1:8000 and preserves the browser Host/Origin for CSRF. Open the Vite dev origin and use **Sign in to StudyFlow**, the existing Django `/api/auth/login/` form. The browser returns to the frontend, reads `/api/auth/session/`, and sends cookies plus `X-CSRFToken`. A normal existing student account can be provisioned through Django admin; local demo credentials from `manage.py seed_demo` are also supported. There is no production student token entry or token stored in local/session storage.

## Deployment boundary

Build with `npm ci && npm run build`. Serve `frontend/dist` and `/api/` under **one origin**, with `/api/` forwarded to Django. Serve Django's collected static files for its existing login page; use Django's normal production WSGI/ASGI deployment, not runserver. Restrict allowed hosts to the deployment hostname. An HTTPS reverse proxy requires the current backend’s `DJANGO_SECURE=true`, correctly configured `DJANGO_SECURE_PROXY_SSL_HEADER` for a trusted proxy, and `DJANGO_CSRF_TRUSTED_ORIGINS` where needed; do not disable CSRF or relax CORS to substitute for correct routing. The Compose `web` service is a local HTTP example of this layout, not a production deployment. Hosting and live credentials were not deployed by this integration task. Vite is a development server, not the production hosting plan.

The planner preview (`/?plan=preview`; `&stage=prepare` for the confirmed, not yet enrolled stage and `&stage=school` for the in-school stage) is visibly labeled, read-only and replays a conversation recorded from the real API (`src/plan/preview-data/`, regenerated by `python manage.py test auto_test.fixture_plan_preview`); it makes no Django request. The original five-step demo (`/?legacy=1`, not linked from the main navigation) is explicitly synthetic and remains separate from saved plans: confirmation, expenses and budget, then funding (non-loan money that arrives before tuition is due, then the smallest quoted loan tier from fixed sample quotes in `src/funding/mockCResponse.ts`) and a simulated application decided by one stated demo rule, ending in a journey summary. Funding stays closed while the budget is stale.

## Contracts and validation

See [contract comparison](../docs/frontend-contract-audit.md) and [integration results](../docs/frontend-integration.md).

- Commands/readiness responses are unwrapped from `data`; ordinary resource lists follow `results` and same-origin pagination links.
- Versioned writes carry semester/state/budget/available analysis versions. Run freshness compares all available versions and semester identity; dirty local edits invalidate current labels. Review/save edits before requesting new results.
- POST retries reuse the key and payload. A funding source's economic identity remains stable across retries. Successful responses also retain their key for recovery when subsequent history loading fails; once the whole action, including that reload, succeeds, the key is released so a deliberate repeat gets a fresh result.
- Unsaved edits survive reloads caused by other actions. If the saved draft changed elsewhere (or a write returns 409), edits are set aside with an explicit restore/keep choice; an open document review is re-applied to the latest saved draft instead. A failed reload is explicitly reported; it does not imply the latest state was obtained.
- C's original extraction/evidence is never edited. Confirmation uses IDs from B's merged proposed draft; document corrections require explicit review reasons. Verified saved costs cannot be edited directly in the expense UI.
- Decimal strings and null are preserved. Unknown amounts/payment status/period remain unknown; NOT_APPLICABLE requires a separate reason. Reserve is top-level, not an expense category.
- Progress, budgets, calendars, funding plans, loan quotes, affordability profiles and applications restore from Django after reload. Browser-only unsaved edits are deliberately temporary.

## Study planner (home)

`/` opens the planner; signed out it offers Django sign-in, the recorded preview and the guided demo (`/?tour=1`). Old `/?journey=preview…` links open the preview. The saved five-step journey and its dashboard were replaced by the planner; the client-side original stays at `/?legacy=1`.

- **Conversation** (`agent/conversations/`): each message is one agent turn (`POST …/messages/` with an `Idempotency-Key`). The first turn asks whether the user is a parent or the student. Opening a conversation calls `POST …/open/`, where the agent may speak first: from three days before the start date it proposes enrollment.
- **Cards** under each reply come from tool results and the school catalog, never from model text: school list, campus life (facilities, food nearby, places to visit), comparison, full cost by tuition / living / essential costs with sourced or estimated lines, plan, simulated loan, confirmation, bills and spending. School figures carry a **Sample data** badge.
- **Confirmations**: confirming a plan or enrollment needs no password (no money moves); `agent/pending-actions/{id}/confirm|reject/`. A proposal that moves money opens the separate finance assistant in the tool panel at the original session and pending-action ID, without creating a replacement action.
- **View** switch (parent / student) changes only the suggestions; both see everything.
- **On-demand panels**: my plan (status, total, funds, gap, loan); in school (`planning/in-school/`: month spending against the living budget, the expense form `planning/expenses/record/`, upcoming bills with *mark as paid* `planning/bills/{id}/pay/`, links to wallet, payments and loans); family (`planning/family-links/`: a parent pastes a confirmed sponsor-link token to link the student's account and then sees the student's plan, bills and monthly totals, not individual purchases).

`tests/e2e/mocked/plan.spec.mjs` covers the preview and a mocked conversation; `tests/e2e/integration/plan.spec.mjs` runs plan → loan → confirm → proactive enrollment → spending → family link against real Django.

## Reviewed UX and wallet/remittance

Students open **Wallet & transfers** from the grouped **Tools** menu. `/?wallet=1` also opens it directly; `/?wallet=preview` opens only its clearly labeled read-only synthetic preview. The wallet uses the established session/CSRF API client and follows all owned list pages. B owns prices, balances and decisions. Only simulation is supported here; backend setup, recipient verification and separate-operator approval are required where applicable.

With the documented local Django/PostgreSQL mock setup running, `npm run test:wallet-integration` exercises real HTTP with disposable students and two operators, fixture FX, safe retries, T2/T3, expiry and permissions. Operator assistance is test setup, not a student UI capability. See [reviewed UX and wallet integration](../docs/frontend-ux-wallet-integration.md) for exact scope, contracts and evidence.

## AI assistant

The separate **Finance assistant** opens in the shared tool panel from **Tools** or a money proposal in the main conversation (`/?agent=1` is also supported; `/?agent=preview` is a fixed, read-only sample conversation with no Django request). The student writes a goal in plain language; `POST agent/sessions/` runs Django’s planner and returns every step. Each step shows its tool, permission tier (T0–T3), status, the planner’s reason and its raw arguments and result. The agent itself never goes beyond T1.

A T2 tool only creates a proposal. The proposal card shows the amount leaving the wallet, the expected receipt, the recipient, the target and the expiry, and says that nothing has been executed. **Confirm with password** asks for the password, requests a step-up grant for the *underlying* action (`remittance.submit` or `wallet.convert`, with the proposal’s exact target, amount and currency) and sends it once as `X-Step-Up-Token` to `agent/pending-actions/{id}/confirm/`. The password and grant stay in the call stack only. When Django answers `APPROVAL_REQUIRED` (T3: above a limit), the card switches to an approval request; a separate staff user decides it, then the student confirms again with a fresh password check. **Reject** closes the proposal without executing anything. Recent conversations reopen from the list below.

## Permissions & activity

**Payments** (`/?payments=1`; preview `/?payments=preview`) pays a confirmed tuition bill against the current readiness funding plan: create (`POST payments/`), authorize for 15 minutes (`authorize/`, T1), submit to the sandbox adapter (`submit/`, T2 password step-up; over-limit amounts first need an operator approval, T3), then, once an operator has recorded the simulated adapter result (`adapter-event/`, in the operations console), reconcile the receipt with the invoice (`reconcile/`). It shows the progress rail, the settlement receipt with its ledger entry, and the payment's audit events. `manage.py demo_payment_ready` prepares a synthetic student whose tuition is ready to pay and writes the credentials to the ignored `output/payment-ready.json`; `tests/e2e/integration/payments.spec.mjs` uses it to run the whole chain against real Django.

**Operations console** (`/ops` or `/?ops=1`; read-only preview `/ops?ops=preview`) has three sections: **Overview**, **Work queue**, and **Recent records**. Overview shows full-database open-item counts, approvals expiring within 60 minutes, unknown payment/transfer results, unverified payees, workload bars, recent approval outcomes, and five priority items. Cards and bars open the corresponding list filter. Recent records explicitly cover the latest 20 approvals, including used and expired requests.

The staff-only `GET operations/workbench/` read model accepts `student` (case-insensitive username substring), `kind` (`all`, `approvals`, `transactions`, `payees`, `loans`, `sponsors`), `attention` (`all`, `expiring`, `unknown`), `page` and `page_size` (20 by default; maximum 100). It returns `operator`, `summary`, mixed `items` (`kind`, `record`, `queued_at`, `attention`), `pagination`, `recent_decisions`, `generated_at` and `is_simulated`. Summary counts follow only the student filter and never use a truncated page. The database sorts expiring approvals first, then unknown results, then oldest items, with stable ID ties. Expired approvals are projected read-only; no migration or write occurs during this GET. The old `operations/queue/` contract remains available.

All six record types open in a focus-managed detail dialog (right-side panel on desktop, full-screen on phones). Existing approval, payment/transfer adapter, payee verification, loan reassessment/disbursement, sponsor link and receipt commands retain explicit confirmation, backend separation of duties, versioning and idempotency. A successful write followed by a failed read locks stale actions and offers a read-only retry. Preview is offline and cannot write. New helpers live in `src/operations/`; `auto_test/test_operations_workbench.py` covers database counts, pagination, expiry and access, and the operations/family/loans browser integration suites exercise real Django/PostgreSQL with simulated money.

**Wallet extras** (inside `/?wallet=1`): currency conversion along the seeded corridor directions (`fx-quotes/live/` for every tier, then `POST conversions/`, T2 `wallet.convert` with the password step-up) and the append-only ledger (`GET ledger/`, paged; the currency filter applies to loaded pages only, because the route has no server-side filter).

**Loans** (`/?loans=1`; preview `/?loans=preview`): quotes, the affordability profile, applications (submit/cancel; operators re-assess and disburse in the console), loan accounts with installment status on the demo clock, repayment of the lowest unpaid installment (T2 `loan.repay`), disbursements, and a labelled demo-clock control.

**Spending insights** (`/?insights=1`): CSV transaction import (multipart upload → row review, duplicates, coverage declaration → confirm), then polls the readiness check and shows the recalculated forecast; transactions (re-categorise), recurring expenses (accept/ignore), risk cards and readiness checks. No money moves on this page.

**Family support** (`/?family=1`) and the sponsor page (`/?sponsor=1#token=…`, no sign-in): the student creates, revises or withdraws a request; an operator sends the link from the console (`src/family/link.ts`; the token stays in the URL fragment and is removed from the address bar on load); the family member confirms or declines with plain `fetch` (no cookies); the operator records receipt.

**Compare plans** (`/?copilot=1`, formerly the What-if planner): up to three scenarios (cost changes, family support, an optional loan) compared against the baseline, apply-preview with blockers, explicit apply, decision explanations, the student review queue and notifications.

**Credit statements** (inside `/?trust=1`) and the public verifier (`/?verify=1`, no sign-in): snapshot → signed statement (90 days) to share; anyone can verify it.

**Demo rehearsal** (`tests/e2e/demo/rehearsal.spec.mjs`, Playwright project `demo`): resets the compose demo stack (`manage.py reset_demo --yes`), then runs every section of `docs/demo-script.md` through the UI as student, payer, operator, approver and an anonymous family member, recording videos and `steps.json` per run under `evidence/`. Run it three times in a row with `npx playwright test --project=demo --repeat-each 3` and `TEST_URL` pointing at the stack.

**Permissions & activity** (`/?trust=1`; preview `/?trust=preview`) is read-only. It shows the four permission tiers and what each needs; the simulated on-time record (level, counts, factors, next level, evidence, and the **limit multiplier** it sets); effective outflow limits per currency with today’s and this month’s usage (`GET policy/limits/`); the student’s approval requests; and the audit log (`GET audit/`, filterable by category, older pages on demand). Each section loads and fails independently. Tier badges also appear on the wallet’s password and approval steps.

## Language and simulation notice

A strip at the top of every screen says that all money is simulated and holds the **English / 中文** switch. The choice applies to every screen, is remembered in this browser (`localStorage` key `studyflow.lang`, optional) and is sent to Django as `Accept-Language`, so backend error messages follow it. Dictionaries live in `src/i18n/`; see [i18n](../docs/i18n.md). English text is unchanged from before the switch existed, and the browser suites pin `en-US`.
