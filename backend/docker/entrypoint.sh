#!/bin/sh
# Prepare the database, then start the given command (gunicorn by default).
set -e

python manage.py migrate --noinput
# Rate-limit counters live in the database cache table (docs/permissions.md §6).
python manage.py createcachetable

# Demo users, budgets and loan examples; seed_demo refuses to overwrite existing users.
if [ "${STUDYFLOW_SEED_DEMO:-true}" = "true" ]; then
    python manage.py seed_demo || echo "seed_demo skipped: demo users already exist."
fi

exec "$@"
