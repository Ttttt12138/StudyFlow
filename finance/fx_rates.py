"""Reference FX rates via C's Frankfurter adapter, and corridor-priced quotes."""
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import APIException
from studyflow_ai.readiness.fx import FxAdapter
from studyflow_ai.readiness.models import CurrencyPair, FxRequest

from . import money
from .workflow_common import audit, record, require
from .workflow_models import Corridor, FXQuote, FxRateSnapshot

STALE_DAYS = 7
QUOTE_SECONDS = 600
RATE_EXPONENT = Decimal("0.0000000001")
# Fixture mid-rates in THB per unit; cross rates go through THB.
FIXTURE_THB_PER_UNIT = {
    "THB": Decimal("1"), "USD": Decimal("33.00"), "EUR": Decimal("36.50"),
    "CNY": Decimal("4.60"), "GBP": Decimal("42.00"), "JPY": Decimal("0.2200"),
}


class FxUnavailable(APIException):
    status_code = 503
    default_detail = "FX_RATE_UNAVAILABLE"
    default_code = "fx_rate_unavailable"


class FxNotExecutable(APIException):
    status_code = 409
    default_code = "fx_rate_not_executable"


def _fixture_fetch(url):
    parts = urlsplit(url)
    base, quote = parts.path.rstrip("/").split("/")[-2:]
    if base not in FIXTURE_THB_PER_UNIT or quote not in FIXTURE_THB_PER_UNIT:
        raise ValueError("No fixture rate")
    rate = (FIXTURE_THB_PER_UNIT[base] / FIXTURE_THB_PER_UNIT[quote]).quantize(RATE_EXPONENT)
    return {"base": base, "quote": quote, "rate": rate,
            "date": parse_qs(parts.query)["date"][0], "providers": ["fixture"]}


def _today():
    return timezone.now().astimezone(ZoneInfo(settings.TIME_ZONE)).date()


def _result(snapshot, issues):
    stale = (_today() - snapshot.rate_date).days > STALE_DAYS
    if stale and "STALE_FX_RATE" not in issues:
        issues = [*issues, "STALE_FX_RATE"]
    return {"base": snapshot.base, "quote": snapshot.quote, "rate": format(snapshot.rate, "f"),
            "rate_date": snapshot.rate_date.isoformat(), "fetched_at": snapshot.fetched_at.isoformat(),
            "source": snapshot.source, "basis": snapshot.basis, "stale": stale, "issues": issues,
            "is_reference_rate": True}


def latest(base, quote):
    return FxRateSnapshot.objects.filter(base=base, quote=quote).order_by("-fetched_at").first()


def get_rate(base, quote):
    """Cached snapshot, else fetch and save, else fall back to the last snapshot."""
    money.require_supported(base)
    money.require_supported(quote)
    require(base != quote, "SAME_CURRENCY_QUOTE")
    snapshot = latest(base, quote)
    if snapshot and timezone.now() - snapshot.fetched_at < timedelta(seconds=settings.STUDYFLOW_FX_CACHE_SECONDS):
        return _result(snapshot, [])
    live = settings.STUDYFLOW_FX_LIVE
    adapter = FxAdapter() if live else FxAdapter(fetch_json=_fixture_fetch)
    fetched = adapter.fetch(FxRequest(pairs=[CurrencyPair(base=base, quote=quote)], as_of=_today()))
    issues = [item.code for item in fetched.issues]
    if fetched.quotes:
        found = fetched.quotes[0]
        snapshot = FxRateSnapshot.objects.create(
            base=base, quote=quote, rate=Decimal(found.rate).quantize(RATE_EXPONENT),
            rate_date=found.rate_date, fetched_at=timezone.now(),
            source="frankfurter" if live else "fixture", basis=(found.basis or "")[:300])
        return _result(snapshot, issues)
    if snapshot is None:
        raise FxUnavailable()
    return _result(snapshot, [*issues, "FX_FETCH_FAILED"])


def valuation(currency, amount):
    """Indicative home value from saved snapshots only; never fetches."""
    snapshot = latest(currency, money.home_currency())
    if snapshot is None:
        return None, None
    info = _result(snapshot, [])
    value = money.quantize(amount * snapshot.rate, money.home_currency())
    return money.fmt(value, money.home_currency()), {
        "rate": info["rate"], "rate_date": info["rate_date"], "source": info["source"], "stale": info["stale"]}


def create_live_quote(actor, data, obj=None):
    from .wallets import quote_result

    corridor = Corridor.objects.filter(pk=data["corridor_id"]).first()
    require(corridor is not None, "CORRIDOR_NOT_FOUND")
    require(corridor.enabled, "CORRIDOR_DISABLED")
    source, target = corridor.source_currency, corridor.target_currency
    amount = money.require_precision(data["send_amount"], source)
    require(corridor.min_amount <= amount <= corridor.max_amount, "CORRIDOR_AMOUNT_OUT_OF_RANGE")
    info = get_rate(source, target)
    if info["issues"]:
        # Report the user-actionable reason, not the adapter's internal code.
        reason = next((code for code in ("STALE_FX_RATE", "FX_FETCH_FAILED") if code in info["issues"]),
                      info["issues"][0])
        raise FxNotExecutable(reason)
    mid = Decimal(info["rate"])
    rate = (mid * (1 - Decimal(corridor.fx_margin_bps) / 10000)).quantize(RATE_EXPONENT, rounding=ROUND_DOWN)
    fee = money.quantize(corridor.fee_fixed + amount * corridor.fee_percent, source)
    require(amount > fee, "CONVERSION_NOT_POSITIVE")
    quote = FXQuote.objects.create(
        owner=actor, route_name=f"{corridor.provider} ({corridor.tier})", quote_version=1,
        settlement_min_days=corridor.settlement_min_days, settlement_days=corridor.settlement_days,
        source_currency=source, target_currency=target, rate=rate, sender_fee=fee, receiver_fee=0,
        expires_at=timezone.now() + timedelta(seconds=QUOTE_SECONDS),
        is_mock=info["source"] == "fixture", corridor=corridor, rate_source=info["source"],
        mid_rate=mid, rate_date=info["rate_date"], quoted_amount=amount)
    net = quote_result(quote, amount, source, target)
    audit(actor, actor, "fx.live_quote_created", quote, {
        "corridor": corridor.code, "mid_rate": info["rate"], "rate_date": info["rate_date"],
        "source": info["source"], "send_amount": str(amount)})
    result = record(quote)
    result.update(corridor_id=str(corridor.id), send_amount=money.fmt(amount, source),
                  net_received=money.fmt(net, target),
                  sender_fee=money.fmt(fee, source), is_reference_rate=True)
    return result
