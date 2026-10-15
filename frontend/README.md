# StudyFlow student frontend (Task A)

The home page is the conversation-led Study planner. Price lookup and comparison lead to the Agent's recommendation using the user's loan amount. Concern shortcuts recalculate monthly payments, interest or principal; “Apply with this plan” opens explicit review of the current quote. Backend responses own costs, caps, quotes, approval and ledger effects. See the [shared contract](../docs/student-loan-contract.md).

## Conversation workspace

The conversation stays mounted while tools open beside it (full-screen on phones). `DRAFT` offers comparison and the loan panel. `CONFIRMED` means application submitted and also opens to-dos, bills and wallet/FX/remittance. Family support, independent credit records, monthly budgets, bookkeeping and enrollment confirmation are removed. Actual loan repayments stay in the loan panel. Operations remains a separate staff view; its legacy backend workflows are retained.

School drafts, read-only history, back/forward navigation and confirmation dialogs remain. Account or preview changes clear the workspace. Old tool URLs redirect to retained panels or the conversation; `stage=school` maps to `prepare`.

## One-command demo

From the repository root, `docker compose up --build` builds this app into the `web` service and starts it with PostgreSQL, Django and the mock readiness worker. Open <http://localhost:8080> and use **Sign in to StudyFlow** with the `demo-student` login from `docker compose exec app cat .demo-credentials.json` (written by `manage.py seed_demo`; see the [main README](../README.md#quick-start-docker-no-credentials-needed)). `Dockerfile` builds with Node 22 and serves `dist/` from nginx; `docker/nginx.conf` proxies `/api/`, `/admin/` and `/health/` to Django with the browser Host, as the Vite proxy does, and serves Django's collected static files for its login page.

## Development

The repository keeps this app (A) next to the Django backend in `../backend/` (B) and the AI package in `../studyflow-ai/` (C). Prepare the Python environment as documented in the main README, start PostgreSQL, run `manage.py migrate --noinput` and `manage.py createcachetable` in `backend/` (required by the current backend’s database-backed throttles), then run these from `backend/` in separate terminals:

```sh
../.venv/bin/python manage.py runserver 127.0.0.1:8000 --noreload
../.venv/bin/python manage.py readiness_worker --mode mock
```

On Windows in this checkout, use `../studyFlow/Scripts/python.exe` instead of `../.venv/bin/python` (the `studyFlow` environment).

Legacy readiness and consumption APIs retain their configuration and tests. The current student loan flow uses the catalog cost cap and user-entered amount; it does not request bank history or a monthly budget.

From `frontend/` (Node 22+ recommended; validated here on Node 24):

```sh
npm ci
npx playwright install chromium   # once, unless CHROMIUM_PATH points to an installed Chromium-based browser
npm run build
npm run dev                        # for manual use; the browser suites start Vite themselves
npm test                           # unit tests (Vitest) + mocked browser suites (Playwright)
npm run test:integration           # all real Django integration specs
npm run test:wallet-integration
npm run test:agent-integration     # conversation T2/T3 confirmation with the mock worker
```

| Command | What runs | Needs |
|---|---|---|
| `npm run test:unit` | Vitest unit tests next to the code (`src/**/*.test.ts`): money and date presentation, version freshness, import rebasing, upload kinds, API errors, pagination and CSRF renewal, form validation | nothing |
| `npm run test:e2e` | Playwright project `mocked` (`tests/e2e/mocked/`): every journey against mocked or synthetic responses, desktop and phone widths | Chromium |
| `npm run test:integration` / `test:wallet-integration` / `test:agent-integration` | Playwright project `integration` (`tests/e2e/integration/`): real HTTP against Django and PostgreSQL | Django on 127.0.0.1:8000, PostgreSQL, `readiness_worker --mode mock` |

Playwright starts Vite (`playwright.config.mjs`) unless `TEST_URL` points at a running server, and pins the browser locale to `en-US`. The integration specs create unique synthetic accounts and durable demo records; they never print or save passwords and call Django through `../.venv` (set `PYTHON` for another interpreter). Set `DB_NAME` to an isolated browser database shared by the test runner, API server and worker. Set `STUDYFLOW_SIMULATED_APPROVAL_SECONDS=0` on the test API and runner: the integration suite checks a separate staff approver, so the development automatic-approval shortcut must be disabled. Do not run tests or migrations against the existing development database. Reports, failure screenshots and traces go to `STUDYFLOW_TEST_OUTPUT` when set, otherwise the ignored `../output/frontend/` (`report/`, `test-results/`); open a trace with `npx playwright show-trace <file>`.

Vite proxies same-origin `/api` to Django at 127.0.0.1:8000 and preserves the browser Host/Origin for CSRF. Open the Vite dev origin and use **Sign in to StudyFlow**, the `/auth` page (the Django `/api/auth/login/` form also remains available). The browser returns to the frontend, reads `/api/auth/session/`, and sends cookies plus `X-CSRFToken`. A normal existing student account can be provisioned through Django admin; local demo credentials from `manage.py seed_demo` are also supported. There is no production student token entry or token stored in local/session storage.

## Deployment boundary

Build with `npm ci && npm run build`. Serve `frontend/dist` and `/api/` under **one origin**, with `/api/` forwarded to Django. Serve Django's collected static files for its existing login page; use Django's normal production WSGI/ASGI deployment, not runserver. Restrict allowed hosts to the deployment hostname. An HTTPS reverse proxy requires the current backend’s `DJANGO_SECURE=true`, correctly configured `DJANGO_SECURE_PROXY_SSL_HEADER` for a trusted proxy, and `DJANGO_CSRF_TRUSTED_ORIGINS` where needed; do not disable CSRF or relax CORS to substitute for correct routing. The Compose `web` service is a local HTTP example of this layout, not a production deployment. Hosting and live credentials were not deployed by this integration task. Vite is a development server, not the production hosting plan.

The read-only preview has two recorded stages: `/?plan=preview` and `/?plan=preview&stage=prepare`. Generate conversations, assessments and life data together with `python backend/manage.py test auto_test.fixture_plan_preview` from the repository root using an isolated `DB_TEST_NAME`. Each preview stage uses its own API recording and makes no Django calls. The guided demo has eight stops.

## Contracts and validation

The [shared contract](../docs/student-loan-contract.md) defines every planning route, removed input, status transition and deletion. The [current verification record](../docs/verification-student-loan-20261015.md) lists the full test results and their scope.

- Planning responses unwrap `data`; other paginated resources follow `results` and same-origin pagination links.
- Estimates and confirmation carry both assessment and plan versions. Changing the form invalidates the current quote until the user estimates again.
- Writes keep the same idempotency key and body during retries, require CSRF and session authentication, and surface revision conflicts. Money actions retain password checks and second-person approval where applicable.
- School applications attach an immutable simulated notice. Other documents require explicit completion, and signing remains a separate confirmation.

## Retained tools

The loan card and panel share versioned assessments and quotes. The card reviews and submits through the same confirmation endpoint; the panel also supports manual amount/product/term/method selection, documents, signing and repayment. The preparation panel contains to-dos, school bills and the demo date. The wallet contains balances, conversion, remittance, bill payments and ledger history. Removing the independent credit line does not remove wallet balances or loan repayment history.

Requests for transfers and conversion also work in the main conversation after application submission. A proposal requires explicit confirmation; the assistant does not execute protected money actions on its own.

`/ops` remains a staff-only operations console with overview, work queue and recent records. Existing legacy platform workflows retain permission, version and idempotency checks. Removed student modules and their old routes no longer mount; the retired family, trust, copilot, expenses and standalone loan implementations are gone.

The historical multi-role `demo` Playwright project and older opt-in live recordings still describe previous versions. They are outside the current default suites and must be updated before reuse. The current reproducible demonstration is [the student script](../docs/demo-script.md) and `integration/plan.spec.mjs`; no reset of the development database is needed.

## Language and simulation notice

Every screen labels simulated money and supports English / 中文. The language is optionally remembered under `studyflow.lang` and sent as `Accept-Language`; dictionaries live in `src/i18n/`. Browser tests explicitly cover both languages and desktop/phone viewport sizes. See [i18n](../docs/i18n.md).
