from types import SimpleNamespace

import httpx2
import pytest
from typesafe_sdk import RetryPolicy, TypeSafeClient

from studyflow_ai.config import Settings, providers
from studyflow_ai.models import CallRecord
from studyflow_ai.provider_models import Extraction
from studyflow_ai.providers.base import ProviderFailure
from studyflow_ai.providers.live import JevProvider, OpenAIProvider, invoke


def test_no_silent_mock_fallback(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(ValueError, match="Missing live configuration"):
        providers(Settings(mode="live"))


def test_project_llm_url_default_and_environment_override(monkeypatch):
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    assert Settings.from_env().openai_base_url == "https://ai.psu.blue/v1"
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    assert Settings.from_env().openai_model == "openai/gpt-6-luna"
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    assert Settings.from_env().openai_base_url == "https://example.test/v1"


def test_configured_llm_url_reaches_sdk(monkeypatch):
    import openai

    captured = {}

    def client_factory(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(close=lambda: None)

    monkeypatch.setattr(openai, "OpenAI", client_factory)
    monkeypatch.setattr("studyflow_ai.providers.live.JevProvider", lambda *args: None)
    monkeypatch.setenv("OPENAI_API_KEY", "test-llm-key")
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-jev-key")
    _, provider = providers(Settings(mode="live", openai_base_url="https://ai.psu.blue/v1"))
    assert captured["base_url"] == "https://ai.psu.blue/v1"
    assert captured["api_key"] == "test-llm-key"
    assert provider.model == "openai/gpt-6-luna"
    provider.close()


@pytest.mark.parametrize("output_text", ['{"events":[]}', '[{"category":null}]'])
def test_custom_url_responses_path_with_official_sdk(output_text):
    import json

    import httpx
    from openai import OpenAI

    def handle(request):
        assert str(request.url) == "https://ai.psu.blue/v1/responses"
        body = json.loads(request.content)
        assert body["model"] == "openai/gpt-6-luna"
        assert body["input"] == "Tuition invoice"
        assert body["text"]["format"]["strict"] is True
        assert '"events"' in body["instructions"]
        return httpx.Response(
            200,
            json={
                "id": "resp_fixture",
                "object": "response",
                "created_at": 1790985600,
                "model": "gateway-model",
                "status": "completed",
                "output": [
                    {
                        "id": "msg_fixture",
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {"type": "output_text", "text": output_text, "annotations": []}
                        ],
                    }
                ],
                "usage": {
                    "input_tokens": 5,
                    "output_tokens": 3,
                    "total_tokens": 8,
                    "input_tokens_details": {"cached_tokens": 0},
                    "output_tokens_details": {"reasoning_tokens": 0},
                },
                "parallel_tool_calls": False,
                "tool_choice": "none",
                "tools": [],
            },
        )

    client = OpenAI(
        api_key="test",
        base_url="https://ai.psu.blue/v1",
        http_client=httpx.Client(transport=httpx.MockTransport(handle)),
    )
    provider = OpenAIProvider("test", "openai/gpt-6-luna", client=client)
    try:
        if output_text.startswith("["):
            with pytest.raises(ProviderFailure) as error:
                provider.extract("Tuition invoice")
            assert error.value.code == "INVALID_MODEL_OUTPUT"
            assert error.value.record.attempts == 1
        else:
            result, record = provider.extract("Tuition invoice")
            assert result.events == []
            assert record.model == "gateway-model"
    finally:
        provider.close()


def test_retry_only_temporary_errors(monkeypatch):
    monkeypatch.setattr("studyflow_ai.providers.live.time.sleep", lambda _: None)
    attempts = []

    class APITimeoutError(Exception):
        pass

    def fail():
        attempts.append(1)
        raise APITimeoutError("SECRET")

    record = CallRecord(provider="openai", purpose="extract", model="m", mode="live")
    with pytest.raises(ProviderFailure) as failure:
        invoke(fail, record)
    assert len(attempts) == 3
    assert "SECRET" not in str(failure.value)


def test_auth_error_not_retried():
    class AuthenticationError(Exception):
        pass

    def fail():
        raise AuthenticationError("SECRET")

    record = CallRecord(provider="openai", purpose="extract", model="m", mode="live")
    with pytest.raises(ProviderFailure):
        invoke(fail, record)
    assert record.attempts == 1


@pytest.mark.parametrize(
    "status,refusal,code",
    [("incomplete", False, "INCOMPLETE_OUTPUT"), ("completed", True, "MODEL_REFUSAL")],
)
def test_openai_failure_response_is_explicit(status, refusal, code):
    part = SimpleNamespace(type="refusal" if refusal else "output_text")
    response = SimpleNamespace(
        status=status,
        output=[SimpleNamespace(content=[part])],
        output_parsed=None,
        model="actual-model",
        usage=None,
    )
    client = SimpleNamespace(responses=SimpleNamespace(parse=lambda **kwargs: response))
    with pytest.raises(ProviderFailure) as error:
        OpenAIProvider("test", "model", client).extract("untrusted")
    assert error.value.code == code


def test_openai_passes_strict_schema_and_disables_storage():
    captured = {}

    def parse(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            status="completed",
            output=[],
            output_parsed=Extraction(events=[]),
            model="actual",
            usage=SimpleNamespace(input_tokens=12, output_tokens=3),
        )

    provider = OpenAIProvider("test", "m", SimpleNamespace(responses=SimpleNamespace(parse=parse)))
    _, record = provider.extract("untrusted")
    assert captured["text_format"] is Extraction
    assert captured["store"] is False
    assert "tools" not in captured
    assert record.model == "actual"


def test_real_jev_sdk_with_mock_http_transport():
    body = {
        "model": "jev-fixture",
        "answers": {
            "category": {
                "type": "choice",
                "choice": "tuition",
                "confidence": 1,
                "probabilities": {"tuition": 1, "other": 0},
            },
            **{
                key: {"type": "noul", "noul": value}
                for key, value in {
                    "financial_relevance": 1,
                    "anomaly": 0,
                    "needs_planning": 0,
                }.items()
            },
        },
        "usage": {"input_tokens": 12, "output_tokens": 6},
    }

    def handle(request):
        assert request.url.path == "/v1/systemone"
        return httpx2.Response(200, json=body)

    client = TypeSafeClient(
        api_key="test", retry=RetryPolicy(max_retries=0), transport=httpx2.MockTransport(handle)
    )
    provider = JevProvider("test", client=client)
    result, record = provider.classify("tuition")
    assert result.category == "tuition"
    assert record.model == "jev-fixture"
    provider.close()
