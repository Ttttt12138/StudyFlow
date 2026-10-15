"""Unsigned planning loans reserve their school bills without charging the wallet."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from finance.planning import in_school, services
from finance.planning.assessment import ensure_demo_state
from finance.planning.models import LoanPayout, PlanBill, PlanningAssessment
from finance.workflow_models import DemoLedgerEntry, DemoWallet, LoanSimulation, SimulatedApplication


class PendingLoanFundingTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user("pending-school-loan")
        self.client.force_authenticate(self.user)
        services.save_plan(self.user, {"school_key": "psu-phuket"})
        self.plan = services.plan_for(self.user)
        self.plan.status = "CONFIRMED"
        self.plan.save(update_fields=["status"])
        self.first = self.bill("tuition:1", "tuition", "41000.00", date(2027, 8, 9))
        self.second = self.bill("tuition:2", "tuition", "41000.00", date(2027, 12, 9))
        self.housing = self.bill("housing:1", "housing", "5000.00", date(2027, 8, 1))
        loan = LoanSimulation.objects.create(owner=self.user, inputs={"principal": "50000.00"},
                                             result={"net_proceeds": "50000.00"})
        self.application = SimulatedApplication.objects.create(owner=self.user, loan=loan, status="APPROVED")
        PlanningAssessment.objects.create(owner=self.user, plan=self.plan, version=1, plan_version=self.plan.version,
            inputs={}, result={"quotes": [{"id": str(loan.pk)}]})
        ensure_demo_state(self.user)
        DemoWallet.objects.filter(owner=self.user).update(balance=Decimal("100000.00"))

    def bill(self, source, kind, amount, due):
        return PlanBill.objects.create(owner=self.user, plan=self.plan, source_id=source, kind=kind,
            label={"en": source, "zh": source}, amount=Decimal(amount), currency="THB", due_date=due)

    def rows(self):
        response = self.client.get("/api/v2/planning/wallet-bills/")
        self.assertEqual(response.status_code, 200, response.data)
        return {row["id"]: row for row in response.data["data"]["bills"]}

    def test_unsigned_loan_reserves_tuition_first_and_reports_partial_coverage(self):
        before = list(PlanBill.objects.values_list("pk", "amount", "status"))
        rows = self.rows()
        self.assertEqual(rows[str(self.first.pk)]["loan_pending"], {"amount": "41000.00", "status": "APPROVED"})
        self.assertEqual(rows[str(self.second.pk)]["loan_pending"], {"amount": "9000.00", "status": "APPROVED"})
        self.assertIsNone(rows[str(self.housing.pk)]["loan_pending"])
        self.assertFalse(rows[str(self.first.pk)]["paid_by_loan"])
        self.assertFalse(LoanPayout.objects.exists())
        self.assertEqual(list(PlanBill.objects.values_list("pk", "amount", "status")), before)

    def test_wallet_and_manual_paid_routes_refuse_reserved_bills_without_writing(self):
        for action in (in_school.pay_from_wallet, in_school.pay_bill):
            with self.subTest(action=action.__name__):
                with self.assertRaisesMessage(ValidationError, "BILL_AWAITING_LOAN"):
                    action(self.user, {}, self.first)
        self.first.refresh_from_db()
        self.assertEqual(self.first.status, "DUE")
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance, Decimal("100000.00"))
        self.assertFalse(DemoLedgerEntry.objects.filter(plan_bill=self.first).exists())

    def test_only_active_applications_reserve_bills(self):
        for status in ("UNDER_REVIEW", "CANCELLED", "REJECTED", "DRAFT"):
            self.application.status = status
            self.application.save(update_fields=["status"])
            pending = self.rows()[str(self.first.pk)]["loan_pending"]
            if status == "UNDER_REVIEW":
                self.assertEqual(pending, {"amount": "41000.00", "status": status})
            else:
                self.assertIsNone(pending)

    def test_partial_foreign_bill_uses_the_bill_currency(self):
        self.first.currency = "USD"
        self.first.amount = Decimal("2000.00")
        self.first.save(update_fields=["currency", "amount"])
        rows = self.rows()
        self.assertEqual(rows[str(self.first.pk)]["loan_pending"], {"amount": "1515.15", "status": "APPROVED"})
        self.assertIsNone(rows[str(self.second.pk)]["loan_pending"])

    def test_a_quote_without_a_submitted_application_does_not_reserve_bills(self):
        self.application.delete()
        self.assertIsNone(self.rows()[str(self.first.pk)]["loan_pending"])

    def test_reminders_count_only_what_the_family_pays_while_the_loan_awaits_signing(self):
        from finance.planning import life

        DemoWallet.objects.filter(owner=self.user).update(balance=Decimal("0.00"))
        rows = {row["source_key"]: row for row in life.read(self.user)["items"]}
        first, second, housing = (rows[f"bill:{bill.pk}"] for bill in (self.first, self.second, self.housing))
        self.assertEqual(first["loan_pending"], {"amount": "41000.00", "status": "APPROVED"})
        # Fully covered by the loan: nothing short. Partly covered: only the family's 32,000 counts.
        self.assertEqual((first["shortfall"], first["at_risk"]), (None, False))
        self.assertEqual((second["shortfall"], second["at_risk"]), ("32000.00", True))
        self.assertEqual(housing["shortfall"], "5000.00")
        # Its loan share is set aside: the reminder cannot mark it paid, move it or change its amount.
        for action, extra in (("complete", {}), ("reschedule", {"date": "2027-09-01"}), ("set_amount", {"amount": "1.00"})):
            with self.subTest(action=action):
                response = self.client.post("/api/v2/planning/life/actions/", {"source_key": first["source_key"],
                    "expected_token": first["token"], "action": action, **extra}, format="json", HTTP_IDEMPOTENCY_KEY=action)
                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn("BILL_AWAITING_LOAN", str(response.data))
        snoozed = self.client.post("/api/v2/planning/life/actions/", {"source_key": first["source_key"],
            "expected_token": first["token"], "action": "acknowledge"}, format="json", HTTP_IDEMPOTENCY_KEY="ack")
        self.assertEqual(snoozed.status_code, 201, snoozed.data)
