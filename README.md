# StudyFlow Backend

Django 5.2 / Django REST Framework / PostgreSQL 16.
The three requested backend areas are implemented as a **local simulated MVP**.
No real bank transfer, credit decision, or lender integration occurs.

## Running now

- API base: http://127.0.0.1:8000/api/v2/
- Readiness: http://127.0.0.1:8000/health/
- API docs: http://127.0.0.1:8000/api/docs/
- Session login: http://127.0.0.1:8000/api/auth/login/
- PostgreSQL: 127.0.0.1:55432, database studyflow, dedicated non-superuser app role.
- Private student/operator login details and tokens: .demo-credentials.json.
  This file is gitignored. Do not share its contents or put operator tokens in AI tools.
- Seed IDs: examples/demo-ids.json. No loan is approved or money moved by the seed.

The existing PostgreSQL service on port 5432 rejected the supplied credentials.
It was not modified. A separate password-protected cluster was initialized in
.postgres/ using the installed PostgreSQL binaries. Your .env points to this cluster.

## Restart after closing/rebooting

From this Backend folder in PowerShell:

    .\scripts\start-postgres.cmd
    .\scripts\start-backend.cmd

start-backend checks applied migrations before running localhost:8000.
The server is Django's development server, not a production deployment.
To stop only the isolated project database:

    .\scripts\stop-postgres.cmd

The CMD launchers use a process-scoped PowerShell execution-policy bypass because
this Windows account blocks direct PS1 execution. They do not change the machine's
execution policy.

## Implemented

1. Budgets and funding:
   essential/expected/higher_cost scenario revisions; THB forecasts and calendars;
   timestamped mock FX quotes for USD/EUR/CNY/GBP/JPY into THB; explicit fees and
   calendar-day settlement delays; combined source capacity, duplication, timing,
   and uncertainty validation; controlled simulated non-loan funding receipts.
2. Loans:
   comparable mock loan snapshots; fixed nominal annual rates with monthly
   amortization; zero-interest support; capitalizing grace periods; complete
   schedules and final rounding; withheld fees and net proceeds; explicit
   insufficient-information affordability results; simulated application review.
3. Execution:
   student authorization bound to current state/plan/expense/beneficiary/amount;
   controlled mock beneficiary verification and adapter outcomes; available-fund
   checks and pending holds; approval without balance changes; idempotent
   disbursement/payment ledger entries; timeout/unknown recovery; receipt matching
   and reconciliation; PostgreSQL append-only financial history and audit.

All new workflow writes require Idempotency-Key. Use the same key/body to retry
one action; use a new key for a different action. Keys are scoped to actor and URL.
Original state confirmation uses expected_version; forecast POST records a new run.

## Team integration

Read API_REFERENCE.md for the endpoint catalog, API_GUIDE.md for workflow guidance,
FUNCTION_REFERENCE.md for internal functions, and openapi.yaml for the generated
machine-readable contract.
examples/workflow.http shows the complete loan-to-payment sequence.
Use student credentials for frontend and extraction integrations.
Operator-only routes require is_staff and represent a controlled local mock adapter.
Do not grant operator credentials to extraction/planning models.

Financial money values are decimal strings. Dates use YYYY-MM-DD.
Unknown fees must not be omitted as if zero: FX fees/settlement days and loan
withheld fees are required inputs. Use an explicit zero for a known zero mock fee.
Source metadata endpoints do not upload/parse files, fetch URLs, or verify a school.
Those C-side extraction adapters and the A-side UI remain separate integrations.

## Demo data

Three budgets share one fictional student:
80,000 THB opening funds; 9,000 rent; 65,000 tuition; 15,000 reserve.
The expected scenario includes 9,400 living costs and a gap of 18,400 THB.
Essential/higher-cost scenarios explicitly use estimated living costs.
Two mock loans have 20,000 principal, 1,600 withheld fee, and 18,400 net proceeds.
Income is unknown, so their affordability result is insufficient_information.
A mock beneficiary is explicitly bound to the seeded expense events.

On a fresh database only:

    .\.venv\Scripts\python.exe manage.py migrate
    .\.venv\Scripts\python.exe manage.py seed_demo

seed_demo refuses to overwrite existing demo accounts; it is not a destructive reset.

## Tests and verification

Actual PostgreSQL suite, using the dedicated precreated test_studyflow database:

    .\.venv\Scripts\python.exe manage.py test --keepdb

The app role does not have CREATEDB. --keepdb uses the isolated precreated test DB.
73 tests pass, including concurrent receipts, concurrent payment holds, stale
versions, rejected operator actions, exact decimal calculations, rollback after
audit failure, append-only database history, and the complete reconciliation flow.

Optional lightweight tests:

    .\.venv\Scripts\python.exe manage.py test --settings=config.test_settings

PostgreSQL concurrency/trigger cases intentionally skip on SQLite.
Schema and migration checks:

    .\.venv\Scripts\python.exe manage.py spectacular --file openapi.yaml --validate --fail-on-warn
    .\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
    .\.venv\Scripts\python.exe manage.py check

## Fresh checkout / another machine

    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
    Copy-Item .env.example .env

Create your own dedicated PostgreSQL role, application database, and test database,
then configure .env with those connection details and a random Django secret.
.postgres/, .env, .venv/, logs, and demo credentials are not portable source artifacts.
Do not copy a live PostgreSQL data directory between machines.

## Boundaries

- Settlement ledger is THB-only. Foreign-currency budgets/loan comparisons are
  supported; foreign loans cannot enter the THB disbursement simulator.
- Rates are mock quotes, not market data. Settlement delays use calendar days.
- Loan terms are a supported fixed-rate monthly model, not arbitrary lender contracts.
- Income assessment is a constant-monthly scenario, not credit scoring.
- Mock transfer fees for THB payments and same-currency external receipts are zero;
  this is a simulator rule, not a claim about a real provider.
- Scenario/funding plans are immutable drafts and do not reserve unreceived sources.
  Actual payment submission reserves settled wallet funds globally.
- Source identity deduplication relies on stable economic keys and student confirmation;
  it does not independently identify two differently described real-world promises.
- Expenses remain in validated versioned state snapshots. The original TXT ERD is
  a broader target blueprint; execution/scenario/loan tables are implemented separately.
- No real adapter, background provider polling, refund/reversal API, or production
  deployment is included. Unknown outcomes require controlled mock status resolution.
- DEBUG/local HTTP settings are for development. Production security and hosting
  configuration remain a separate step.

Current completion evidence: 08_Backend_Completion_Report.txt.
07_API_Readiness_Audit.txt is the historical audit from before this implementation.
