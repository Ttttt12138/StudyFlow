# StudyFlow student frontend (Task A)

The connected React/TypeScript journey uses the final repository's Django API, saved semesters and C's evidence review. B owns every budget, forecast, funding, loan and application result. No frontend financial arithmetic, currency conversion, approval, payment or disbursement occurs. The ZIP was source material; its Git history, local token entry design and standalone configuration were not merged.

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
npm run build
npm run dev    # keep running in its own terminal for the browser suites
npm test
npm run test:integration
npm run test:wallet-integration
```

`npm test` runs six **mocked/synthetic** Chromium browser suites. `npm run test:integration` requires the actual Django server, PostgreSQL and the **mock** worker; it creates unique synthetic student accounts and durable demo records. It does not print or save account passwords. Result reports/screenshots go to ignored `../output/frontend/`. The suites use Playwright's Chromium (`npx playwright install chromium`) unless `CHROMIUM_PATH` points to another Chromium-based browser. The integration suites call Django through `../.venv`; set `PYTHON` to use a different interpreter. It is safe to rerun against a dedicated development database, not a production database.

Vite proxies same-origin `/api` to Django at 127.0.0.1:8000 and preserves the browser Host/Origin for CSRF. Open the Vite dev origin and use **Sign in to StudyFlow**, the existing Django `/api/auth/login/` form. The browser returns to the frontend, reads `/api/auth/session/`, and sends cookies plus `X-CSRFToken`. A normal existing student account can be provisioned through Django admin; local demo credentials from `manage.py seed_demo` are also supported. There is no production student token entry or token stored in local/session storage.

## Deployment boundary

Build with `npm ci && npm run build`. Serve `frontend/dist` and `/api/` under **one origin**, with `/api/` forwarded to Django. Serve Django's collected static files for its existing login page; use Django's normal production WSGI/ASGI deployment, not runserver. Restrict allowed hosts to the deployment hostname. An HTTPS reverse proxy requires the current backend’s `DJANGO_SECURE=true`, correctly configured `DJANGO_SECURE_PROXY_SSL_HEADER` for a trusted proxy, and `DJANGO_CSRF_TRUSTED_ORIGINS` where needed; do not disable CSRF or relax CORS to substitute for correct routing. Hosting and live credentials were not deployed by this integration task. Vite is a development server, not the production hosting plan.

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
