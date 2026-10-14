"""The two simulated planning loan products and how they differ. Not bank offers.

The custom loan uses the rate on the assessment (6% unless edited) over up to 48 months. The study loan example has
a fixed, lower rate, is the only product offered over 60 months, and alone lets the family pay interest only while
the student studies, the principal being repaid after the course ends.
"""
from datetime import date
from decimal import Decimal

from finance.workflow_common import require

PRODUCTS = {
    "custom": {"annual_rate": None, "terms": [24, 36, 48], "methods": ["amortized"]},
    "commercial_student_demo": {"annual_rate": Decimal("0.045"), "terms": [24, 36, 48, 60],
                                "methods": ["amortized", "interest_only"]},
}
METHODS = ("amortized", "interest_only")


def rate(product, declared):
    """The product's fixed rate, or the declared one for the custom loan."""
    fixed = PRODUCTS[product]["annual_rate"]
    return fixed if fixed is not None else Decimal(declared)


def check_term(product, months):
    require(int(months) in PRODUCTS[product]["terms"], "TERM_NOT_OFFERED")


def check_method(product, method):
    require(method in PRODUCTS[product]["methods"], "METHOD_NOT_OFFERED")


def grace_months(plan, first_due_date, method):
    """Interest-only installments: every monthly due date before the course ends (none for equal installments)."""
    if method != "interest_only":
        return 0
    from finance.lending_core.calculations import month_date

    from . import catalog, services

    entry = catalog.school(plan.school_key)
    months = services.estimate(entry, plan.years)["duration_months"] if entry else round(float(plan.years) * 12)
    course_end = month_date(plan.start_date, int(months))
    first = date.fromisoformat(first_due_date) if isinstance(first_due_date, str) else first_due_date
    count = 0
    while count < 72 and month_date(first, count) < course_end:
        count += 1
    return count


def offers(declared):
    """What the pre-check shows for each product: its rate, terms and repayment methods."""
    return [{"key": key, "annual_rate": format(rate(key, declared).normalize(), "f"), "terms": spec["terms"],
             "methods": spec["methods"]} for key, spec in PRODUCTS.items()]
