# StudyFlow student frontend (Task A)

The connected React/TypeScript journey uses the final repository's Django API, saved semesters and C's evidence review. B owns every budget, forecast, funding, loan and application result. No frontend financial arithmetic, currency conversion, approval, payment or disbursement occurs. The ZIP was source material; its Git history, local token entry design and standalone configuration were not merged.

## One-command demo

From the repository root, `docker compose up --build` builds this app into the `web` service and starts it with PostgreSQL, Django and the mock readiness worker. Open <http://localhost:8080> and use **Sign in to StudyFlow** with the `demo-student` login from `docker compose exec app cat .demo-credentials.json` (written by `manage.py seed_demo`; see the [main README](../README.md#quick-start-docker-no-credentials-needed)). `Dockerfile` builds with Node 22 and serves `dist/` from nginx; `docker/nginx.conf` proxies `/api/`, `/admin/` and `/health/` to Django with the browser Host, as the Vite proxy does, and serves Django's collected static files for its login page.

## Development

The repository keeps this app (A) next to the Django backend in `../backend/` (B) and the AI package in `../studyflow-ai/` (C). Prepare the Python environment as documented in the main README, start PostgreSQL, run `manage.py migrate --noinput` and `manage.py createcachetable` in `backend/` (required by the current backend’s database-backed throttles), then run these from `backend/` in separate terminals:

```sh
../.venv/bin/python manage.py runserver 127.0.0.1:8000 --noreload
../.venv/bin/python manage.py readiness_worker --mode mock
```

Set `STUDYFLOW_READINESS_ENABLED=true` in the ignored `backend/.env`. Consumption can also be enabled; its additional coverage requirements must remain visible as incomplete results when no bank history is present. Do not disable those checks to make a student's budget look complete.

From `frontend/` (Node 22+ recommended; validated here on Node 24):

```sh
npm ci
npx playwright install chromium   # once, unless CHROMIUM_PATH points to an installed Chromium-based browser
npm run build
npm run dev                        # for manual use; the browser suites start Vite themselves
npm test                           # unit tests (Vitest) + mocked browser suites (Playwright)
  npm run test:integration           # all integration specs, including Agent/trust and 3 reference replays
npm run test:wallet-integration
npm run test:agent-integration     # AI assistant T2/T3 and trust center; no worker needed
```

| Command | What runs | Needs |
|---|---|---|
| `npm run test:unit` | Vitest unit tests next to the code (`src/**/*.test.ts`): money and date presentation, version freshness, import rebasing, upload kinds, API errors, pagination and CSRF renewal, form validation | nothing |
| `npm run test:e2e` | Playwright project `mocked` (`tests/e2e/mocked/`): every journey against mocked or synthetic responses, desktop and phone widths | Chromium |
| `npm run test:integration` / `test:wallet-integration` / `test:agent-integration` | Playwright project `integration` (`tests/e2e/integration/`): real HTTP against Django and PostgreSQL | Django on 127.0.0.1:8000, PostgreSQL, `readiness_worker --mode mock` |

Playwright starts Vite (`playwright.config.mjs`) unless `TEST_URL` points at a running server, and pins the browser locale to `en-US`. The integration specs create unique synthetic accounts and durable demo records; they never print or save passwords and call Django through `../.venv` (set `PYTHON` for another interpreter). Run them against a dedicated development database, not a production database. Reports, failure screenshots and traces go to the ignored `../output/frontend/` (`report/`, `test-results/`); open a trace with `npx playwright show-trace <file>`.

Vite proxies same-origin `/api` to Django at 127.0.0.1:8000 and preserves the browser Host/Origin for CSRF. Open the Vite dev origin and use **Sign in to StudyFlow**, the existing Django `/api/auth/login/` form. The browser returns to the frontend, reads `/api/auth/session/`, and sends cookies plus `X-CSRFToken`. A normal existing student account can be provisioned through Django admin; local demo credentials from `manage.py seed_demo` are also supported. There is no production student token entry or token stored in local/session storage.

## Deployment boundary

Build with `npm ci && npm run build`. Serve `frontend/dist` and `/api/` under **one origin**, with `/api/` forwarded to Django. Serve Django's collected static files for its existing login page; use Django's normal production WSGI/ASGI deployment, not runserver. Restrict allowed hosts to the deployment hostname. An HTTPS reverse proxy requires the current backend’s `DJANGO_SECURE=true`, correctly configured `DJANGO_SECURE_PROXY_SSL_HEADER` for a trusted proxy, and `DJANGO_CSRF_TRUSTED_ORIGINS` where needed; do not disable CSRF or relax CORS to substitute for correct routing. The Compose `web` service is a local HTTP example of this layout, not a production deployment. Hosting and live credentials were not deployed by this integration task. Vite is a development server, not the production hosting plan.

The synthetic connected preview is visibly labeled, read-only, and does not call financial APIs. The older three-screen demo is explicitly synthetic and remains separate from saved plans.

## Contracts and validation

See [contract comparison](../docs/frontend-contract-audit.md) and [integration results](../docs/frontend-integration.md).

- Commands/readiness responses are unwrapped from `data`; ordinary resource lists follow `results` and same-origin pagination links.
- Versioned writes carry semester/state/budget/available analysis versions. Run freshness compares all available versions and semester identity; dirty local edits invalidate current labels. Review/save edits before requesting new results.
- POST retries reuse the key and payload. A funding source's economic identity remains stable across retries. Successful responses also retain their key for recovery when subsequent history loading fails; once the whole action, including that reload, succeeds, the key is released so a deliberate repeat gets a fresh result.
- Unsaved edits survive reloads caused by other actions. If the saved draft changed elsewhere (or a write returns 409), edits are set aside with an explicit restore/keep choice; an open document review is re-applied to the latest saved draft instead. A failed reload is explicitly reported; it does not imply the latest state was obtained.
- C's original extraction/evidence is never edited. Confirmation uses IDs from B's merged proposed draft; document corrections require explicit review reasons. Verified saved costs cannot be edited directly in the expense UI.
- Decimal strings and null are preserved. Unknown amounts/payment status/period remain unknown; NOT_APPLICABLE requires a separate reason. Reserve is top-level, not an expense category.
- Progress, budgets, calendars, funding plans, loan quotes, affordability profiles and applications restore from Django after reload. Browser-only unsaved edits are deliberately temporary.

## Student dashboard

After Django session login, open **Dashboard** in the journey navigation. It reads the current briefing, financial calendar, notification metadata and owned review queue. Panels retry independently and compare state/budget/analysis versions; unsaved plan edits are clearly flagged. Notification/review controls are read-only. Upcoming dates show the first five backend events; list pagination is explicitly indicated.

The signed-out setup also offers **Preview student dashboard**: fixed demo data, no Django financial requests, read-only scenario controls. Dashboard preview navigation opens the synthetic journey. It never enters live mode implicitly.

See [current dashboard integration evidence](../docs/frontend-dashboard-integration.md). `npm test` includes two dashboard browser suites; `npm run test:integration` exercises actual Django and PostgreSQL with C mock providers and disposable student data.

## Reviewed UX and wallet/remittance

The welcome screen and read-only five-step tour now use the reviewed Task A presentation from source commit `20d1527`. “Use my own information” focuses Django session sign-in; no token entry was imported. Saved journey behavior and the live dashboard remain in place.

Signed-in students can open **Wallet & transfers** under **More options**. `/?wallet=1` also opens it directly; `/?wallet=preview` opens only its clearly labeled read-only synthetic preview. The wallet uses the established session/CSRF API client and follows all owned list pages. B owns prices, balances and decisions. Only simulation is supported here; backend setup, recipient verification and separate-operator approval are required where applicable.

With the documented local Django/PostgreSQL mock setup running, `npm run test:wallet-integration` exercises real HTTP with disposable students and two operators, fixture FX, safe retries, T2/T3, expiry and permissions. Operator assistance is test setup, not a student UI capability. See [reviewed UX and wallet integration](../docs/frontend-ux-wallet-integration.md) for exact scope, contracts and evidence.

## AI assistant

Under **More options**, signed-in students open **AI assistant** (`/?agent=1`; `/?agent=preview` is a fixed, read-only sample conversation with no Django request). The student writes a goal in plain language; `POST agent/sessions/` runs Django’s planner and returns every step. Each step shows its tool, permission tier (T0–T3), status, the planner’s reason and its raw arguments and result. The agent itself never goes beyond T1.

A T2 tool only creates a proposal. The proposal card shows the amount leaving the wallet, the expected receipt, the recipient, the target and the expiry, and says that nothing has been executed. **Confirm with password** asks for the password, requests a step-up grant for the *underlying* action (`remittance.submit` or `wallet.convert`, with the proposal’s exact target, amount and currency) and sends it once as `X-Step-Up-Token` to `agent/pending-actions/{id}/confirm/`. The password and grant stay in the call stack only. When Django answers `APPROVAL_REQUIRED` (T3: above a limit), the card switches to an approval request; a separate staff user decides it, then the student confirms again with a fresh password check. **Reject** closes the proposal without executing anything. Recent conversations reopen from the list below.

## Permissions & activity

**Permissions & activity** (`/?trust=1`; preview `/?trust=preview`) is read-only. It shows the four permission tiers and what each needs; the simulated on-time record (level, counts, factors, next level, evidence, and the **limit multiplier** it sets); effective outflow limits per currency with today’s and this month’s usage (`GET policy/limits/`); the student’s approval requests; and the audit log (`GET audit/`, filterable by category, older pages on demand). Each section loads and fails independently. Tier badges also appear on the wallet’s password and approval steps.

## Language and simulation notice

A strip at the top of every screen says that all money is simulated and holds the **English / 中文** switch. The choice applies to every screen, is remembered in this browser (`localStorage` key `studyflow.lang`, optional) and is sent to Django as `Accept-Language`, so backend error messages follow it. Dictionaries live in `src/i18n/`; see [i18n](../docs/i18n.md). English text is unchanged from before the switch existed, and the browser suites pin `en-US`.
