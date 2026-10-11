"""Currency configuration and ISO 4217 precision helpers."""
from decimal import ROUND_HALF_UP, Decimal

from babel.numbers import get_currency_precision
from django.conf import settings

from .workflow_common import require

MAX_BALANCE = Decimal("9999999999999999.99")


def home_currency():
    return settings.STUDYFLOW_HOME_CURRENCY


def supported_currencies():
    return list(settings.STUDYFLOW_SUPPORTED_CURRENCIES)


def require_supported(currency):
    require(currency in settings.STUDYFLOW_SUPPORTED_CURRENCIES, "CURRENCY_NOT_SUPPORTED")


def exponent(currency):
    return Decimal(1).scaleb(-get_currency_precision(currency))


def require_precision(amount, currency):
    amount = Decimal(amount)
    require(amount == amount.quantize(exponent(currency)), "AMOUNT_PRECISION_INVALID")
    return amount


def quantize(amount, currency):
    return Decimal(amount).quantize(exponent(currency), rounding=ROUND_HALF_UP)


def fmt(amount, currency):
    return format(quantize(amount, currency), "f")
