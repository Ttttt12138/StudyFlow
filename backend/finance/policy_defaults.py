"""Default per-currency T2 outflow limits (docs/permissions.md)."""

# currency: (per_transaction, daily, monthly)
DEFAULT_LIMITS = {
    "THB": ("50000", "100000", "300000"),
    "CNY": ("10000", "20000", "60000"),
    "USD": ("1500", "3000", "9000"),
    "EUR": ("1400", "2800", "8400"),
    "GBP": ("1200", "2400", "7200"),
    "JPY": ("200000", "400000", "1200000"),
}


def ensure_default_limits(model=None):
    """Create missing default limits; existing rows keep their (possibly edited) values."""
    if model is None:
        from .policy_models import PolicyLimit as model
    for currency, (per_transaction, daily, monthly) in DEFAULT_LIMITS.items():
        model.objects.get_or_create(action="outflow", currency=currency, defaults=dict(
            per_transaction=per_transaction, daily=daily, monthly=monthly))
