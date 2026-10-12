# StudyFlow API: Django + gunicorn. All money is simulated; mock mode needs no credentials.
# Build from the repository root (`docker compose build`): B imports the C package
# from studyflow-ai/, so both directories are part of the build context.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_STATIC_ROOT=/app/static

# Same layout as the repository: /app/backend next to /app/studyflow-ai.
WORKDIR /app/backend

# Dependencies first so code edits do not invalidate the install layer.
COPY backend/requirements.lock.txt ./
COPY studyflow-ai/pyproject.toml studyflow-ai/README.md ../studyflow-ai/
COPY studyflow-ai/src ../studyflow-ai/src
RUN pip install -r requirements.lock.txt gunicorn==23.0.0 \
    && pip install -e ../studyflow-ai

COPY studyflow-ai ../studyflow-ai
COPY backend .
# Login page and admin assets; the web image (frontend/Dockerfile) copies and serves them.
RUN DJANGO_SECRET_KEY=collectstatic-build-only python manage.py collectstatic --noinput
RUN useradd --create-home --uid 10001 studyflow \
    && mkdir -p output \
    && chown -R studyflow:studyflow /app
USER studyflow

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/', timeout=2)"
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
