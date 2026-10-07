# Third-Party Components and Licenses

Generated on 2026-10-07 from the installed package metadata (`importlib.metadata`), starting from `requirements.lock.txt` and `studyflow-ai/pyproject.toml` and following every transitive runtime dependency. Versions are the pinned ones the project runs and tests with.

> **Project licence.** This repository does not yet contain a `LICENSE` file for StudyFlow's own code. The team must choose one before publishing. Every third-party licence below permits use in a closed or open project, subject to the notes at the end.

## Runtime Python packages

| Package | Version | Licence | Used for |
|---|---|---|---|
| Django | 5.2.17 | BSD-3-Clause | Web framework, ORM, migrations |
| djangorestframework | 3.18.1 | BSD-3-Clause | REST API, authentication, throttling |
| drf-spectacular | 0.30.0 | BSD-3-Clause | OpenAPI schema and Swagger UI view |
| django-cors-headers | 4.9.0 | MIT | CORS headers |
| psycopg / psycopg-binary | 3.3.6 | **LGPL-3.0-only** | PostgreSQL driver |
| python-dotenv | 1.2.4 | BSD-3-Clause | Loading `.env` files |
| asgiref | 3.12.1 | BSD-3-Clause | Django dependency |
| sqlparse | 0.6.0 | BSD-3-Clause | Django dependency |
| tzdata | 2026.5 | Apache-2.0 | Time-zone data (Asia/Bangkok windows) |
| PyYAML | 6.0.3 | MIT | drf-spectacular dependency |
| jsonschema, jsonschema-specifications | 4.26.0, 2025.9.1 | MIT | drf-spectacular dependency |
| referencing, rpds-py, attrs | 0.37.0, 2026.6.3, 26.1.0 | MIT | jsonschema dependencies |
| inflection | 0.5.1 | MIT | drf-spectacular dependency |
| uritemplate | 4.2.0 | BSD-3-Clause OR Apache-2.0 | drf-spectacular dependency |
| pydantic, pydantic-core | 2.13.5, 2.46.5 | MIT | C package data contracts, LLM output validation |
| annotated-types, typing-inspection | 0.8.0, 0.4.4 | MIT | pydantic dependencies |
| typing_extensions | 4.16.0 | PSF-2.0 | pydantic dependency |
| openai | 2.54.0 | Apache-2.0 | Client for the OpenAI-compatible LLM gateway (live mode) |
| typesafe-sdk | 0.7.2 | MIT | Structured classification client used by the C copilot (live mode) |
| httpx, httpcore, h11 | 0.28.1, 1.0.9, 0.16.0 | BSD-3-Clause / BSD-3-Clause / MIT | HTTP client (Frankfurter FX, Gemini OCR, openai) |
| httpx2, httpcore2 | 2.13.1, 2.13.1 | BSD-3-Clause | typesafe-sdk dependency |
| anyio, sniffio, idna, certifi | 4.15.1, 1.3.1, 3.20, 2026.7.22 | MIT / MIT OR Apache-2.0 / BSD-3-Clause / **MPL-2.0** | HTTP stack dependencies |
| distro, jiter, tqdm | 1.9.0, 0.17.0, 4.70.1 | Apache-2.0 / MIT / **MPL-2.0 AND MIT** | openai dependencies |
| tenacity, truststore | 9.1.4, 0.10.4 | Apache-2.0 / MIT | typesafe-sdk and httpx2 dependencies |
| pypdf | 6.19.0 | BSD-3-Clause | PDF text extraction and safety checks |
| Pillow | 12.3.0 | MIT-CMU | Image preparation for OCR |
| Babel | 2.18.0 | BSD-3-Clause | Currency codes and precision in the C package |
| colorama | 0.4.6 | BSD-3-Clause | tqdm dependency (Windows console colour) |
| gunicorn | 23.0.0 | MIT | WSGI server in the Docker image |

## Development and test tools (not shipped)

| Package | Version | Licence |
|---|---|---|
| pytest, pytest-cov | 9.1.1, 7.1.0 | MIT |
| coverage | 7.16.2 | Apache-2.0 |
| ruff | 0.16.10 | MIT |
| build | 1.6.1 | MIT |
| fastapi, python-multipart (optional `http` extra of the C package) | 0.142.2, 0.0.32 | MIT / Apache-2.0 |

## Container images

| Image | Licence | Used for |
|---|---|---|
| `python:3.13-slim` | PSF-2.0 (Python) plus Debian package licences | Application image base |
| `postgres:17` | PostgreSQL License (permissive) plus Debian package licences | Database |

## Loaded at runtime from a CDN (not redistributed)

| Component | Licence | Notes |
|---|---|---|
| Swagger UI (`swagger-ui-dist`, via cdn.jsdelivr.net) | Apache-2.0 | Loaded by the browser on `/api/docs/` (drf-spectacular default) |

## External services (only in live mode)

| Service | Used for | Terms |
|---|---|---|
| Frankfurter API (frankfurter.dev) | Reference FX rates (`STUDYFLOW_FX_LIVE=true`) | Free public API; data from central banks |
| OpenAI-compatible LLM gateway | Agent planner and copilot (`STUDYFLOW_MODE=live`) | Operator's own account and terms |
| Typesafe API | Copilot classification (live mode) | Operator's own account and terms |
| Google Gemini API | Optional document OCR (off by default) | Google's paid-service terms; see [gemini-ocr.md](gemini-ocr.md) |

## Notes on copyleft components

- **psycopg (LGPL-3.0).** It is used unmodified as a separately installed, dynamically loaded library. Under the LGPL this is permitted from code under any licence, provided users can replace the library, which is the case with any pip-installed package. If psycopg is modified and redistributed, the modified source must be published.
- **certifi and tqdm (MPL-2.0).** They are used unmodified. MPL-2.0 is a file-level copyleft and applies only if those files are modified and redistributed.
