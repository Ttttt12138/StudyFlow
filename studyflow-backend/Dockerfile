FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY src ./src
COPY migrations ./migrations
COPY alembic.ini README.md ./
RUN pip install --no-deps --no-build-isolation .
EXPOSE 8000
CMD ["uvicorn", "studyflow_backend.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
