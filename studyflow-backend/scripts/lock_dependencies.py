"""Freeze installed dependency closures without adding the optional local C package."""

from importlib.metadata import distribution
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


def closure(roots):
    found, pending = {}, list(roots)
    while pending:
        name = canonicalize_name(pending.pop())
        if name in found:
            continue
        package = distribution(name)
        found[name] = package.version
        for item in package.requires or []:
            requirement = Requirement(item)
            if requirement.marker is None or requirement.marker.evaluate():
                pending.append(requirement.name)
    return [f"{name}=={version}" for name, version in sorted(found.items())]


def main():
    runtime = [
        "fastapi",
        "uvicorn",
        "sqlalchemy",
        "alembic",
        "psycopg",
        "psycopg-binary",
        "pydantic",
        "tzdata",
        "setuptools",
        "wheel",
    ]
    for filename, roots in [
        ("requirements.lock", runtime),
        ("requirements-dev.lock", runtime + ["pytest", "httpx", "ruff"]),
    ]:
        Path(filename).write_text(
            "# Resolved and tested with Python 3.13.\n" + "\n".join(closure(roots)) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
