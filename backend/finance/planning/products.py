"""The two simulated planning loan products and how they differ. Not bank offers.

The custom loan uses the rate on the assessment (6% unless edited) over up to 48 months. The study loan example has
a fixed, lower rate and is the only product offered over 60 months.
"""
from decimal import Decimal

from finance.workflow_common import require

PRODUCTS = {
    "custom": {"annual_rate": None, "terms": [24, 36, 48]},
    "commercial_student_demo": {"annual_rate": Decimal("0.045"), "terms": [24, 36, 48, 60]},
}


def rate(product, declared):
    """The product's fixed rate, or the declared one for the custom loan."""
    fixed = PRODUCTS[product]["annual_rate"]
    return fixed if fixed is not None else Decimal(declared)


def check_term(product, months):
    require(int(months) in PRODUCTS[product]["terms"], "TERM_NOT_OFFERED")


def offers(declared):
    """What the pre-check shows for each product: its rate and terms."""
    return [{"key": key, "annual_rate": format(rate(key, declared).normalize(), "f"), "terms": spec["terms"]}
            for key, spec in PRODUCTS.items()]
