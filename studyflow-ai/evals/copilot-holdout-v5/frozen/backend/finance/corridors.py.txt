"""Default simulated remittance corridors.

Seeded by migration 0015. TransactionTestCase flushes tables, so tests and demo
commands call ensure_default_corridors() instead of relying on migration data.
"""

# (source, target, min, max, [(tier, fee_fixed, fee_percent, margin_bps, min_days, days)])
DEFAULT_CORRIDORS = [
    ("CNY", "THB", "100", "50000", [("express", "30", "0.0050", 60, 0, 1),
        ("standard", "15", "0.0030", 40, 1, 2), ("economy", "0", "0.0015", 25, 3, 5)]),
    ("USD", "THB", "20", "10000", [("express", "15", "0.0050", 60, 0, 1),
        ("standard", "8", "0.0030", 40, 1, 3), ("economy", "0", "0.0015", 25, 3, 6)]),
    ("EUR", "THB", "20", "10000", [("express", "14", "0.0050", 60, 0, 1),
        ("standard", "7", "0.0030", 40, 1, 3), ("economy", "0", "0.0015", 25, 3, 6)]),
    ("THB", "CNY", "500", "300000", [("express", "150", "0.0050", 60, 0, 1),
        ("standard", "80", "0.0030", 40, 1, 2), ("economy", "0", "0.0015", 25, 3, 5)]),
]
PROVIDERS = {"express": "Demo Express Remit", "standard": "Demo Standard Transfer",
             "economy": "Demo Economy Wire"}


def ensure_default_corridors(model=None):
    """Create any missing default corridor; existing rows (and their enabled flag) are kept."""
    if model is None:
        from .workflow_models import Corridor as model
    for source, target, low, high, tiers in DEFAULT_CORRIDORS:
        for tier, fee, percent, margin, min_days, days in tiers:
            model.objects.get_or_create(code=f"{source}-{target}-{tier}".lower(), defaults=dict(
                provider=PROVIDERS[tier], tier=tier, source_currency=source, target_currency=target,
                min_amount=low, max_amount=high, fee_fixed=fee, fee_percent=percent,
                fx_margin_bps=margin, settlement_min_days=min_days, settlement_days=days))
