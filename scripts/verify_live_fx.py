"""Verify the live Frankfurter path end to end (makes real HTTPS requests).

Usage: studyFlow/Scripts/python.exe manage.py shell -c "exec(open('scripts/verify_live_fx.py', encoding='utf-8').read())"
Fetches reference rates for every seeded corridor pair, prices one live quote per corridor
inside a rolled-back transaction, and writes output/verification-live-fx.json.
"""
import json
from pathlib import Path
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import override_settings

from finance import fx_rates
from finance.corridors import ensure_default_corridors
from finance.workflow_models import Corridor


class _Rollback(Exception):
    pass


report = {"source": "frankfurter", "pairs": [], "quotes": []}
with override_settings(STUDYFLOW_FX_LIVE=True, STUDYFLOW_FX_CACHE_SECONDS=0):
    ensure_default_corridors()
    pairs = sorted({(c.source_currency, c.target_currency) for c in Corridor.objects.filter(enabled=True)})
    for base, quote in pairs:
        try:
            report["pairs"].append(fx_rates.get_rate(base, quote))
        except Exception as exc:  # report every pair, even when one fails
            report["pairs"].append({"base": base, "quote": quote, "error": type(exc).__name__,
                                    "detail": str(getattr(exc, "detail", exc))[:200]})
    try:
        with transaction.atomic():
            user = get_user_model().objects.create_user(username="fx-verify-" + uuid4().hex[:10])
            for corridor in Corridor.objects.filter(enabled=True):
                amount = str(max(corridor.min_amount, min(corridor.max_amount, corridor.min_amount * 10)))
                try:
                    quote = fx_rates.create_live_quote(user, {"corridor_id": corridor.id, "send_amount": amount})
                    report["quotes"].append({k: quote[k] for k in (
                        "route_name", "source_currency", "target_currency", "send_amount", "sender_fee",
                        "mid_rate", "rate", "rate_source", "rate_date", "net_received", "is_mock")})
                except Exception as exc:
                    report["quotes"].append({"corridor": corridor.code, "error": type(exc).__name__,
                                             "detail": str(getattr(exc, "detail", exc))[:200]})
            raise _Rollback()
    except _Rollback:
        pass
report["passed"] = all("error" not in r for r in report["pairs"] + report["quotes"]) and all(
    r["source"] == "frankfurter" and not r["stale"] for r in report["pairs"])
Path("output").mkdir(exist_ok=True)
Path("output/verification-live-fx.json").write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                                    encoding="utf-8")
print(json.dumps({"passed": report["passed"],
                  "pairs": [(r.get("base"), r.get("quote"), r.get("rate"), r.get("rate_date"), r.get("stale"),
                             r.get("issues"), r.get("error")) for r in report["pairs"]],
                  "quotes": len(report["quotes"])}, ensure_ascii=False))
