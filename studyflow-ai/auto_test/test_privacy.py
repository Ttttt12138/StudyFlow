from studyflow_ai.privacy import redact


def test_audit_removes_account_numbers_and_credentials():
    payload = {
        "api_key": "secret",
        "account_id": "bank-12345",
        "evidence": [{"quote": "Pay account 123-456-7890"}],
    }
    cleaned = redact(payload)
    assert cleaned["api_key"] == "[REDACTED]"
    assert cleaned["account_id"] == "[REDACTED]"
    assert "123-456" not in cleaned["evidence"][0]["quote"]
    assert payload["api_key"] == "secret"
