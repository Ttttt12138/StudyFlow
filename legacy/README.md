# Legacy code: not part of the submission

The code in this folder is kept for reference only. It is not built, tested or deployed by this repository's CI, `compose.yaml` or `scripts/`.

| Folder | What it was | Superseded by |
|---|---|---|
| [`studyflow-backend/`](studyflow-backend/) | An early standalone Python lending prototype (loan quotes, automated review, simulated disbursement, instalment repayment) built on FastAPI, SQLAlchemy and Alembic with PostgreSQL | Its business rules were ported into the Django app under `/api/v2`. See `finance/` and [docs/django-b-lending.md](../docs/django-b-lending.md). |

The prototype's own docs link to run outputs in its git-ignored `output/` folder. Those links do not resolve in a fresh clone.
