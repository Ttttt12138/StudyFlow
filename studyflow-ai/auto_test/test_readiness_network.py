from datetime import date, datetime, timezone

import pytest

from studyflow_ai.parsing import InputError
from studyflow_ai.readiness.fx import FxAdapter
from studyflow_ai.readiness.models import CurrencyPair, FxQuote, FxRequest
from studyflow_ai.readiness.web import SafeFetcher, WebResponse, public_target


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/a",
        "http://169.254.169.254/",
        "http://[::1]/",
        "file:///etc/passwd",
        "https://user:secret@example.com/",
        "https://localhost/",
    ],
)
def test_block_unsafe_targets(url):
    with pytest.raises(InputError):
        public_target(url)


def test_public_dns_is_resolved_before_request_and_redirect_rechecked(monkeypatch):
    monkeypatch.setattr(
        "studyflow_ai.readiness.web.socket.getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )
    calls = []

    def send(target):
        calls.append(target)
        return WebResponse(302, {"location": "http://127.0.0.1/private"}, b"")

    with pytest.raises(InputError, match="UNSAFE_URL"):
        SafeFetcher(sender=send).fetch("https://example.org/fees")
    assert len(calls) == 1
    assert calls[0].address == "93.184.216.34"


def test_fx_direction_stale_and_cache():
    calls = []

    def fetch(url):
        calls.append(url)
        return {
            "base": "CNY",
            "quote": "THB",
            "date": "2026-09-20",
            "rate": 5,
            "providers": [{"key": "fixture", "date": "2026-09-20", "rate": 5}],
        }

    adapter = FxAdapter(fetch_json=fetch)
    request = FxRequest(pairs=[CurrencyPair(base="CNY", quote="THB")], as_of=date(2026, 10, 2))
    first = adapter.fetch(request)
    assert first.quotes[0].stale
    assert first.status == "NEEDS_REVIEW"
    adapter.fetch(request)
    assert len(calls) == 1
    wrong = FxAdapter(
        fetch_json=lambda _: {"base": "THB", "quote": "CNY", "date": "2026-10-02", "rate": 0.2}
    )
    assert not wrong.fetch(request).quotes
    assert wrong.fetch(request).issues[0].code == "INVALID_FX_RESPONSE"


def test_manual_fx_basis_and_future_dates():
    pair = CurrencyPair(base="USD", quote="THB")
    quote = FxQuote(
        pair=pair,
        rate="35",
        rate_date="2026-10-03",
        fetched_at=datetime.now(timezone.utc),
        source="manual",
        manual=True,
        basis="Bank quote",
    )
    result = FxAdapter(fetch_json=lambda _: pytest.fail("Manual quote must avoid network")).fetch(
        FxRequest(pairs=[pair], as_of=date(2026, 10, 2), manual_quotes=[quote])
    )
    assert result.status == "NEEDS_REVIEW"
    assert not result.quotes
