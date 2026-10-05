import os
from dataclasses import dataclass
from pathlib import Path


def load_env_file(path):
    allowed = {
        "STUDYFLOW_MODE",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "OPENAI_MODEL",
        "TYPESAFE_API_KEY",
        "TYPESAFE_DEFAULT_MODEL",
    }
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if "=" not in line:
            raise ValueError("Invalid environment file syntax")
        key, value = line.split("=", 1)
        if key.strip() in allowed:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ[key.strip()] = value


DEFAULT_OPENAI_MODEL = "openai/gpt-6-luna"
DEFAULT_OPENAI_BASE_URL = "https://ai.psu.blue/v1"


@dataclass(frozen=True)
class Settings:
    mode: str = "mock"
    openai_model: str = DEFAULT_OPENAI_MODEL
    jev_model: str = "jev-latest"
    openai_base_url: str = DEFAULT_OPENAI_BASE_URL

    @classmethod
    def from_env(cls, mode=None):
        return cls(
            mode=mode or os.getenv("STUDYFLOW_MODE", "mock"),
            openai_model=os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
            jev_model=os.getenv("TYPESAFE_DEFAULT_MODEL", "jev-latest"),
            openai_base_url=os.getenv("OPENAI_BASE_URL", DEFAULT_OPENAI_BASE_URL),
        )


def providers(settings: Settings):
    if settings.mode == "mock":
        from studyflow_ai.providers.rules import RuleProvider

        return RuleProvider(mode="mock"), RuleProvider(mode="mock")
    if settings.mode != "live":
        raise ValueError("Mode must be mock or live")
    missing = [
        key for key in ("OPENAI_API_KEY", "TYPESAFE_API_KEY") if not os.getenv(key, "").strip()
    ]
    if missing:
        raise ValueError("Missing live configuration: " + ", ".join(missing))
    from studyflow_ai.providers.live import JevProvider, OpenAIProvider

    return (
        JevProvider(os.environ["TYPESAFE_API_KEY"], settings.jev_model),
        OpenAIProvider(
            os.environ["OPENAI_API_KEY"], settings.openai_model, base_url=settings.openai_base_url
        ),
    )
