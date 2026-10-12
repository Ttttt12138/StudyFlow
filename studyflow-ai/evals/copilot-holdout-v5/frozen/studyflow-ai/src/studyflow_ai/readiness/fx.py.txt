import json
from datetime import date, datetime, timezone
from decimal import Decimal
from urllib.parse import urlencode

from pydantic import ValidationError

from studyflow_ai.models import Status
from studyflow_ai.parsing import InputError
from studyflow_ai.readiness.completeness import issue
from studyflow_ai.readiness.models import FxQuote, FxResult
from studyflow_ai.readiness.web import SafeFetcher


def fetch_json(url):
    final, response = SafeFetcher().fetch(url)
    if not final.startswith("https://api.frankfurter.dev/"):
        raise InputError("INVALID_FX_RESPONSE")
    return json.loads(response.body, parse_float=Decimal)


class FxAdapter:
    def __init__(self, fetch_json=fetch_json):
        self.fetch_json, self.cache = fetch_json, {}

    def _quote(self, pair, as_of):
        if pair.base == pair.quote:
            return FxQuote(
                pair=pair,
                rate="1",
                rate_date=as_of,
                fetched_at=datetime.now(timezone.utc),
                source="identity",
            )
        key = (pair.base, pair.quote, as_of)
        if key in self.cache:
            return self.cache[key].model_copy(deep=True)
        url = f"https://api.frankfurter.dev/v2/rate/{pair.base}/{pair.quote}?{urlencode({'date': as_of.isoformat(), 'expand': 'providers'})}"
        data = self.fetch_json(url)
        if data.get("base", "").upper() != pair.base or data.get("quote", "").upper() != pair.quote:
            raise InputError("INVALID_FX_RESPONSE")
        quote = FxQuote(
            pair=pair,
            rate=data["rate"],
            rate_date=date.fromisoformat(data["date"]),
            fetched_at=datetime.now(timezone.utc),
            source=url,
            basis="Providers: "
            + ", ".join(p["key"] if isinstance(p, dict) else p for p in data.get("providers", [])),
        )
        self.cache[key] = quote.model_copy(deep=True)
        return quote

    def fetch(self, request):
        result = FxResult()
        for pair in request.pairs:
            try:
                manual = [q for q in request.manual_quotes if q.pair == pair]
                if len(manual) > 1:
                    raise InputError("DUPLICATE_MANUAL_RATE")
                quote = (
                    manual[0].model_copy(deep=True) if manual else self._quote(pair, request.as_of)
                )
                age = (request.as_of - quote.rate_date).days
                if age < 0:
                    raise InputError("FUTURE_FX_RATE")
                quote.stale = age > 7
                result.quotes.append(quote)
                if quote.stale:
                    result.issues.append(issue("STALE_FX_RATE", f"{pair.base}/{pair.quote}"))
            except InputError as exc:
                result.issues.append(issue(exc.code, f"{pair.base}/{pair.quote}"))
            except (OSError, ValueError, KeyError, TypeError, ValidationError):
                result.issues.append(issue("INVALID_FX_RESPONSE", f"{pair.base}/{pair.quote}"))
        if result.issues:
            result.status = Status.NEEDS_REVIEW
        return result
