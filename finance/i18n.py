"""Localized API error messages (docs/i18n.md).

`detail` keeps the stable code or legacy English text that clients and tests match on;
the handler adds `code` and a `message` translated for the request's Accept-Language.
"""
import re

from django.utils.translation import get_language, gettext
from rest_framework.views import exception_handler as drf_exception_handler

CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")


def localize(text):
    message = gettext(text)
    if message == text and CODE.match(text):
        # Uncatalogued code: still readable, never an empty message.
        message = text.replace("_", " ").capitalize() + "."
    return message


def _single_text(detail):
    if isinstance(detail, list) and len(detail) == 1:
        detail = detail[0]
    return detail if isinstance(detail, str) else None


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None or not isinstance(response.data, dict):
        return response
    detail = response.data.get("detail")
    text = _single_text(detail)
    if text is None:
        return response
    item = detail[0] if isinstance(detail, list) else detail
    response.data["code"] = str(text) if CODE.match(text) else getattr(item, "code", None) or "error"
    response.data["message"] = localize(str(text))
    response["Content-Language"] = get_language()
    return response
