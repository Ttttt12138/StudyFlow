# StudyFlow: Django backend and C module

Django is the unified B backend under `/api/v2/`. Lending uses the migrated B calculation and state rules; budgets, FX, payments and reconciliation remain Django services. C is an independent package in [studyflow-ai](studyflow-ai/README.md).

## Install and run

Use Python 3.11+ in an activated virtual environment. Install `requirements-dev.txt`. Copy `.env.example` to `.env` only if it does not exist, and configure a random Django secret and a dedicated PostgreSQL database before running:

```text
python manage.py migrate
python manage.py runserver 127.0.0.1:8000 --noreload
```

## Lending and migration

Read [API_GUIDE.md](API_GUIDE.md) and [lending migration notes](docs/django-b-lending.md). Migration 0005 adds lending accounts and installments; 0006 preserves historical ledger credits and adopts existing settled loans. Resolve legacy processing/unknown disbursements with the previous version before migrating. Migration 0006 is not automatically reversible.

## Verification

With a dedicated PostgreSQL development database and permission to create its isolated test database:

```text
python manage.py test finance auto_test --noinput
python -m pytest auto_test/test_lending_core.py
python manage.py makemigrations --check --dry-run
python manage.py demo_bc --runs 3
```

The demo adds new simulated identities to the configured database. The C adapter exports authoritative loan values and mock explanations from an owned scenario; it does not constitute a complete multi-scenario readiness budget. Full readiness orchestration is a separate change. All monetary operations are simulated.
