"""Redact audit payloads; original evidence belongs in B's access-controlled store."""

import re


def redact(value):
    if isinstance(value, dict):
        return {
            key: (
                "[REDACTED]"
                if key.lower() in ("api_key", "authorization", "password", "account_id")
                else redact(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        return re.sub(
            r"\b(?:\d[ -]?){9,}\d\b",
            lambda m: "[ACCOUNT_ENDING_" + re.sub(r"\D", "", m.group())[-4:] + "]",
            value,
        )
    return value
