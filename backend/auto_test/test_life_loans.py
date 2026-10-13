from rest_framework.test import APITestCase

from auto_test.test_lending_merge import LendingHarness
from finance.planning import services


class LifeLoanTests(LendingHarness, APITestCase):
    def test_actual_contract_reminder_and_repayment_stay_linked(self):
        _, _, _, account = self.fund()
        services.save_plan(self.student, {"school_key": "psu-phuket"})
        self.post("planning/life/clock", {"date": "2026-11-01"})
        before = self.get("planning/life")
        item = next(row for row in before["items"] if row["kind"] == "loan")
        self.assertEqual(item["source_key"], f"loan:{account['id']}:1")
        self.assertEqual(item["stage"], "due")
        body = {"source_key": item["source_key"], "expected_token": item["token"]}
        self.post("planning/life/actions", {**body, "action": "complete"}, code=400)
        self.post("planning/life/actions", {**body, "action": "reschedule", "date": "2026-11-03"}, code=400)
        self.post(f"loan-accounts/{account['id']}/repay", {"expected_version": 1, "installment_number": 1})
        next_item = next(row for row in self.get("planning/life")["items"] if row["kind"] == "loan")
        self.assertEqual(next_item["source_key"], f"loan:{account['id']}:2")
        self.assertEqual(next_item["due_date"], "2026-12-01")

