"""Validate catalog JSON files without Django: python finance/planning/validate_catalog.py [files...]."""

import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("catalog", HERE / "catalog.py")
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)

paths = [Path(p) for p in sys.argv[1:]] or sorted((HERE / "catalog").glob("*.json"))
failed = False
for path in paths:
    try:
        entry = catalog.Entry.model_validate(json.loads(path.read_text(encoding="utf-8")))
        print(f"OK   {path.name}: {entry.school.name.en} ({entry.school.currency}, {len(entry.costs)} costs)")
    except Exception as exc:  # noqa: BLE001 - report every file
        failed = True
        print(f"FAIL {path.name}: {exc}")
sys.exit(1 if failed else 0)
