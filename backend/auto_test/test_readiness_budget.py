from copy import deepcopy
from datetime import date

from django.test import SimpleTestCase

from finance.readiness.budget import calculate, project


def cost(key, amount, **changes):
    return {
        "cost_id": key,
        "category": "tuition",
        "amount": amount,
        "currency": "THB",
        "period": "once",
        "due_date": "2026-08-10",
        "paid": False,
        "confidence_type": "UNCONFIRMED",
        **changes,
    }


def draft(costs):
    return {
        "profile": {"start_date": "2026-08-10", "end_date": "2026-12-15"},
        "costs": costs,
        "reserve": "15000.00",
        "required_categories": ["tuition"],
    }


class BudgetTests(SimpleTestCase):
    def test_reserve_is_required_cash_not_spending(self):
        result = calculate(draft([cost("tuition", "65000.00")]), "14000.00")
        self.assertEqual(result["base"], "80000.00")
        self.assertEqual(result["gap"], "66000.00")
        self.assertEqual(sum(float(e["amount"]) for e in result["events"]), 65000)

    def test_paid_cost_and_deposit(self):
        result = calculate(
            draft(
                [
                    cost("tuition", "65000.00", paid=True),
                    cost("deposit", "9000.00", category="deposit", refundable=True),
                ]
            ),
            "0.00",
        )
        self.assertEqual(result["base"], "89000.00")
        self.assertEqual(result["remaining_base"], "24000.00")
        self.assertEqual(len(result["events"]), 1)

    def test_monthly_proration_and_estimate(self):
        data = draft(
            [
                cost(
                    "living",
                    None,
                    category="food",
                    period="monthly",
                    lower="3100.00",
                    upper="6200.00",
                    confidence_type="INFERRED",
                )
            ]
        )
        data["required_categories"] = ["food"]
        data["profile"] = {"start_date": "2026-08-10", "end_date": "2026-08-31"}
        result = calculate(data, "0.00")
        self.assertEqual(result["base"], "18300.00")
        self.assertEqual(result["low"], "17200.00")

    def test_missing_and_conflict_never_complete(self):
        for changes in ({"amount": None}, {"due_date": None}, {"conflict": True}):
            result = calculate(
                draft([cost("tuition", "65000.00") | changes]), "999999.00"
            )
            self.assertFalse(result["complete"])
            self.assertFalse(result["sufficient"])

    def test_daily_forecast_does_not_count_unconfirmed_income(self):
        snapshot = {
            "as_of": "2026-08-01",
            "opening_balance": "80000.00",
            "reserve": "15000.00",
            "events": [
                {
                    "id": "promise",
                    "kind": "income",
                    "label": "family",
                    "date": "2026-08-09",
                    "amount": "50000.00",
                    "certainty": "estimated",
                }
            ],
        }
        result = project(
            snapshot, draft([cost("tuition", "75000.00")]), date(2026, 8, 1), 30
        )
        self.assertEqual(result["maximum_reserve_gap"], "10000.00")
        self.assertEqual(len(result["daily"]), 30)
        self.assertEqual(result["first_gap_date"], "2026-08-10")

    def test_input_is_not_mutated(self):
        data = draft([cost("tuition", "65000.00")])
        original = deepcopy(data)
        calculate(data, "140000.00")
        self.assertEqual(original, data)

    def test_settled_cost_is_not_reintroduced_after_date_advances(self):
        snapshot = {
            "as_of": "2026-08-01",
            "opening_balance": "100000.00",
            "reserve": "15000.00",
            "events": [
                {
                    "id": "cost:tuition:2026-08-10",
                    "label": "tuition",
                    "kind": "expense",
                    "amount": "65000.00",
                    "date": "2026-08-10",
                    "certainty": "confirmed",
                    "settled_sequence": 1,
                }
            ],
        }
        result = project(
            snapshot, draft([cost("tuition", "65000.00")]), date(2026, 8, 11), 30
        )
        self.assertEqual(result["ending_balance"], "35000.00")
        self.assertFalse(result["timeline"])

    def test_same_day_income_cannot_hide_intraday_gap(self):
        snapshot = {
            "as_of": "2026-08-01",
            "opening_balance": "80000.00",
            "reserve": "15000.00",
            "events": [
                {
                    "id": "income",
                    "label": "support",
                    "kind": "income",
                    "amount": "50000.00",
                    "date": "2026-08-10",
                    "certainty": "confirmed",
                }
            ],
        }
        result = project(
            snapshot, draft([cost("tuition", "75000.00")]), date(2026, 8, 1), 30
        )
        self.assertEqual(result["monthly"][0]["minimum_balance"], "5000.00")
        self.assertEqual(result["ending_balance"], "55000.00")

    def test_source_proposal_fills_missing_but_preserves_conflicts(self):
        from finance.readiness.merging import propose

        baseline = draft(
            [cost("tuition", "41000.00"), cost("food", None, category="food")]
        )
        extracted = {
            "profile": {},
            "costs": [
                cost("new-tuition", "65000.00"),
                cost("new-food", "3000.00", category="food"),
            ],
        }
        proposal, conflicts = propose(baseline, extracted, "offer")
        self.assertEqual(proposal["costs"][0]["amount"], "41000.00")
        self.assertTrue(proposal["costs"][0]["conflict"])
        self.assertIn("tuition", conflicts)
        self.assertEqual(proposal["costs"][1]["amount"], "3000.00")
        self.assertEqual(proposal["costs"][1]["confidence_type"], "UNCONFIRMED")
