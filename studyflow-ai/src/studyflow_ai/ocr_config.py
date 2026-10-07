"""C-owned OCR configuration; never discovers a .env from the caller's cwd."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from studyflow_ai.config import read_env_file

C_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


@dataclass(frozen=True)
class OcrSettings:
    api_key: str = field(default="", repr=False)
    model: str = ""
    fallback_models: tuple[str, ...] = ()
    max_attempts: int = 3
    enabled: bool = False
    paid_service_confirmed: bool = False
    adult_only_confirmed: bool = False
    timeout: int = 60
    retention_days: int = 30
    requests_per_hour: int = 10

    @classmethod
    def from_env(cls, env_file=None):
        path = Path(env_file) if env_file is not None else C_ENV_FILE
        values = read_env_file(path) if path.is_file() else {}
        values.update(os.environ)
        return cls(
            api_key=values.get("GEMINI_API_KEY", "").strip(),
            model=values.get("STUDYFLOW_OCR_MODEL", "").strip(),
            fallback_models=tuple(
                m.strip()
                for m in values.get("STUDYFLOW_OCR_FALLBACK_MODELS", "").split(",")
                if m.strip()
            ),
            max_attempts=min(5, _positive(values, "STUDYFLOW_OCR_MAX_ATTEMPTS", 3)),
            enabled=_flag(values, "STUDYFLOW_OCR_ENABLED"),
            paid_service_confirmed=_flag(values, "STUDYFLOW_OCR_PAID_SERVICE_CONFIRMED"),
            adult_only_confirmed=_flag(values, "STUDYFLOW_OCR_ADULT_ONLY_CONFIRMED"),
            timeout=min(90, _positive(values, "STUDYFLOW_OCR_TIMEOUT", 60)),
            retention_days=_positive(values, "STUDYFLOW_DOCUMENT_RETENTION_DAYS", 30),
            requests_per_hour=_positive(values, "STUDYFLOW_OCR_REQUESTS_PER_HOUR", 10),
        )


def _flag(values, key):
    return values.get(key, "false").strip().lower() == "true"


def _positive(values, key, default):
    try:
        return max(1, int(values.get(key, str(default))))
    except ValueError:
        raise ValueError(f"Invalid integer setting: {key}") from None
