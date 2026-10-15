"""Compare offered repayment terms using the same calculator as the student panel."""
from decimal import Decimal

from finance.workflow_common import require

from . import products
from .assessment_loans import calculate_preview


def compact(preview):
    return {key: value for key, value in preview.items() if key not in ("schedule", "is_simulated")}


def candidates(plan, terms, request):
    intent = request.get("intent", "recommend")
    method = request.get("method", "amortized" if intent == "lower_interest" else terms["method"])
    rows = []
    for product, offer in products.PRODUCTS.items():
        if request.get("product") and product != request["product"]:
            continue
        if method not in offer["methods"]:
            continue
        for months in offer["terms"]:
            if request.get("months") and months != request["months"]:
                continue
            row = calculate_preview(plan, terms, {"principal": terms["principal"], "product": product,
                                                  "months": months, "method": method})
            rows.append(compact(row))
    require(bool(rows), "TERM_NOT_OFFERED")
    return rows


def rank(rows, request, terms):
    intent = request.get("intent", "recommend")
    if intent in ("lower_monthly", "lower_interest"):
        first, second = (("monthly_payment", "total_interest") if intent == "lower_monthly"
                         else ("total_interest", "monthly_payment"))
        return sorted(rows, key=lambda row: (Decimal(row[first]), Decimal(row[second])))
    # Keep the term already discussed; use the lowest cost available at that term.
    return sorted(rows, key=lambda row: (abs(row["months"] - int(terms["months"])),
                                         Decimal(row["total_interest"]), Decimal(row["monthly_payment"])))


def recommended_product(terms, request):
    offers = products.offers(terms["annual_rate"])
    eligible = [o for o in offers if (not request.get("product") or o["key"] == request["product"])
                and (not request.get("method") or request["method"] in o["methods"])
                and (not request.get("months") or request["months"] in o["terms"])]
    require(bool(eligible), "TERM_NOT_OFFERED")
    return min(eligible, key=lambda offer: Decimal(offer["annual_rate"]))


def changes(previous, selected):
    if not previous:
        return None
    return {key: format(Decimal(selected[key]) - Decimal(previous[key]), ".2f")
            for key in ("principal", "monthly_payment", "total_interest", "total_repayment")}
