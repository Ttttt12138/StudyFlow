from django.test import override_settings
from rest_framework.test import APITestCase

from auto_test.test_multicurrency import FX_SETTINGS
from auto_test.test_policy import PolicyHarness


@override_settings(**FX_SETTINGS)
class OperationsQueueTests(PolicyHarness, APITestCase):
    def queue(self, user):
        response = self.read("operations/queue", user)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["data"]

    def test_students_cannot_read_the_queue(self):
        self.assertEqual(self.read("operations/queue").status_code, 403)

    def test_pending_approval_shows_target_and_separation_of_duties(self):
        payment = self.payment("tuition")
        approval = self.ask("payment.submit", payment["id"], "65000.00")
        # The operator verified the payee, so only the second operator may decide.
        mine = self.queue(self.operator)["approvals"]
        self.assertEqual([(a["id"], a["can_decide"], a["blocked_reason"]) for a in mine],
                         [(approval["id"], False, "VERIFIED_PAYEE")])
        row = self.queue(self.approver)["approvals"][0]
        self.assertEqual((row["can_decide"], row["blocked_reason"]), (True, None))
        self.assertEqual((row["owner_username"], row["requested_by_username"]), (self.username, self.username))
        target = row["target"]
        self.assertEqual((target["kind"], target["id"], target["amount"], target["currency"], target["status"]),
                         ("payment", payment["id"], "65000.00", "THB", "authorized"))
        self.assertEqual(target["payee_verified_by"], self.operator.pk)
        self.decide(approval)
        queue = self.queue(self.approver)
        self.assertEqual(queue["approvals"], [])
        self.assertEqual([(a["id"], a["status"], a["decided_by_username"]) for a in queue["recent_decisions"]],
                         [(approval["id"], "APPROVED", self.approver.get_username())])

    def test_submitted_payment_waits_for_the_adapter_result_then_leaves_the_queue(self):
        payment = self.pending_payment("rent")
        rows = self.queue(self.operator)["payments"]
        self.assertEqual([(p["id"], p["status"], p["owner_username"], p["beneficiary_name"]) for p in rows],
                         [(payment["id"], "pending", self.username, "Demo university")])
        self.post("payments/" + payment["id"] + "/adapter-event", {"outcome": "unknown"}, operator=True)
        self.assertEqual(self.queue(self.operator)["payments"][0]["status"], "unknown")
        self.settle(payment)
        self.assertEqual(self.queue(self.operator)["payments"], [])

    def test_loan_application_under_review_waits_for_the_operator(self):
        quote = self.post("loans", {"currency": "THB", "principal": "20000.00", "annual_rate": "0.12", "fees": "0.00",
                                    "months": 6, "first_due_date": "2026-12-01"})
        application = self.post("applications", {"quote_id": quote["id"]})
        # No affordability profile, so submission lands in manual review.
        submitted = self.post("applications/" + application["id"] + "/action", {"expected_version": application["version"], "action": "submit"})
        self.assertEqual(submitted["status"], "UNDER_REVIEW")
        rows = self.queue(self.operator)["applications"]
        self.assertEqual([(a["id"], a["status"], a["owner_username"], a["quote"]["principal"], a["quote"]["months"]) for a in rows],
                         [(application["id"], "UNDER_REVIEW", self.username, "20000.00", 6)])

    def test_sponsor_request_waits_for_a_link_then_leaves_once_received(self):
        request = self.post("sponsor-requests", {"economic_key": "family-ops", "amount": "5000.00", "currency": "THB",
                                                  "available_on": "2026-10-02", "purpose": "Rent help"})
        rows = self.queue(self.operator)["sponsor_requests"]
        self.assertEqual([(r["id"], r["status"], r["owner_username"], r["source"]["amount"]) for r in rows],
                         [(request["id"], "PENDING", self.username, "5000.00")])

    def test_unverified_payees_are_listed_until_verified(self):
        payee = self.post("beneficiaries", {"name": "New landlord", "destination_label": "MOCK"})
        listed = self.queue(self.operator)["beneficiaries"]
        self.assertEqual([(b["id"], b["name"], b["owner_username"]) for b in listed],
                         [(payee["id"], "New landlord", self.username)])
        self.post("beneficiaries/" + payee["id"] + "/verify", {"verified": True}, operator=True)
        self.assertEqual(self.queue(self.operator)["beneficiaries"], [])
