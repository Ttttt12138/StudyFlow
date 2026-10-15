"""Extract user-facing API messages into gettext catalogs and compile them with Babel.

Usage (workspace root):
    python scripts/i18n_messages.py extract   # update locale/*/LC_MESSAGES/django.po, keep translations
    python scripts/i18n_messages.py compile   # write django.mo next to each .po
    python scripts/i18n_messages.py check     # fail if catalogs are stale, untranslated or uncompiled

Messages are the string details raised through `require(condition, "...")` and API
exceptions (`PolicyDenied("CODE")`, `default_detail = "..."`). Error codes (UPPER_SNAKE)
are translated in every language; English sentences only need the Chinese catalog.
System GNU gettext is not required.
"""
import ast
import io
from datetime import datetime, timezone
import re
import sys
from pathlib import Path

from babel.messages.catalog import Catalog
from babel.messages.mofile import write_mo
from babel.messages.pofile import read_po, write_po

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "finance"
LOCALES = {"zh_Hans": "zh_Hans", "en": "en"}
CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
RAISERS = {"require", "PolicyDenied", "FxNotExecutable", "Conflict", "ValidationError", "PermissionDenied",
           "InputError", "VersionConflict"}
# Raised with free text as well; only their error codes reach users.
CODE_ONLY_RAISERS = {"ValueError"}


def _strings(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        yield node.value
    elif isinstance(node, ast.JoinedStr):
        return  # dynamic text cannot be catalogued
    elif isinstance(node, ast.IfExp):
        yield from _strings(node.body)
        yield from _strings(node.orelse)


def extract():
    found = {}
    for path in sorted(SOURCES.rglob("*.py")):
        if "migrations" in path.parts or path.name.startswith("test"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            texts = []
            if isinstance(node, ast.Call):
                name = getattr(node.func, "id", getattr(node.func, "attr", ""))
                if name in RAISERS:
                    args = node.args[1:] if name == "require" else node.args[:1]
                    texts = [t for arg in args for t in _strings(arg)]
                elif name in CODE_ONLY_RAISERS:
                    texts = [t for arg in node.args[:1] for t in _strings(arg) if CODE.match(t)]
            elif isinstance(node, ast.Assign) and any(
                    getattr(t, "id", "") == "default_detail" for t in node.targets):
                texts = list(_strings(node.value))
            for text in texts:
                if text.strip() and len(text) <= 300:
                    found.setdefault(text, f"{path.relative_to(ROOT).as_posix()}:{node.lineno}")
    return found


def _catalog_path(locale):
    return ROOT / "locale" / locale / "LC_MESSAGES" / "django.po"


def _wanted(locale, text):
    return locale != "en" or CODE.match(text)


def update(found):
    for locale in LOCALES:
        path = _catalog_path(locale)
        old = {}
        if path.exists():
            with path.open("rb") as handle:
                old = {m.id: m.string for m in read_po(handle) if m.id}
        # Fixed dates keep regenerated catalogs diff-free.
        stamp = datetime(2026, 10, 7, tzinfo=timezone.utc)
        catalog = Catalog(locale=locale, project="StudyFlow", version="2", charset="utf-8",
                          creation_date=stamp, revision_date=stamp, fuzzy=False)
        for text, where in sorted(found.items()):
            if _wanted(locale, text):
                catalog.add(text, old.get(text, ""), locations=[(where.split(":")[0], int(where.split(":")[1]))])
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as handle:
            write_po(handle, catalog, width=100, sort_output=True)


def compile_all():
    for locale in LOCALES:
        with _catalog_path(locale).open("rb") as handle:
            catalog = read_po(handle)
        buffer = io.BytesIO()
        write_mo(buffer, catalog)
        _catalog_path(locale).with_suffix(".mo").write_bytes(buffer.getvalue())


def check(found):
    problems = []
    for locale in LOCALES:
        path = _catalog_path(locale)
        if not path.exists():
            problems.append(f"{locale}: catalog missing")
            continue
        with path.open("rb") as handle:
            catalog = read_po(handle)
        ids = {m.id: m.string for m in catalog if m.id}
        missing = [t for t in found if _wanted(locale, t) and t not in ids]
        untranslated = [k for k, v in ids.items() if not v]
        problems += [f"{locale}: not in catalog: {t!r}" for t in missing[:20]]
        problems += [f"{locale}: untranslated: {t!r}" for t in untranslated[:20]]
        buffer = io.BytesIO()
        write_mo(buffer, catalog)
        mo = path.with_suffix(".mo")
        if not mo.exists() or mo.read_bytes() != buffer.getvalue():
            problems.append(f"{locale}: django.mo is stale; run compile")
    for line in problems:
        print(line)
    return 1 if problems else 0


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "check"
    found = extract()
    if command == "extract":
        update(found)
        print(f"{len(found)} messages")
    elif command == "compile":
        compile_all()
    else:
        return check(found)
    return 0


if __name__ == "__main__":
    sys.exit(main())
