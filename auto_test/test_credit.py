"""Independent spec tests for docs/credit.md (simulated on-time record / credit building).

Evidence rows (LoanInstallment, Payment, RemittanceOrder) are created directly with the ORM on
purpose: money-moving endpoints require step-up authentication, so these tests only use HTTP for
state/, demo/initialize/, demo/clock/ and the credit endpoints.

"Real today" is simulated by patching django.utils.timezone.localdate (finance.credit uses it for
as_of); the demo wallet clock starts on that same date and is moved with demo/clock/.
"""
import json
import time
from collections import Counter
from copy import deepcopy
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core import signing
from django.db import DatabaseError, transaction
from django.utils import timezone
from rest_framework.test import APITestCase

from finance.credit_models import CreditSnapshot
from finance.lending_models import LoanAccount, LoanInstallment
from finance.models import AuditEvent, FinancialState
from finance.remittance_models import RemittanceOrder
from finance.workflow_models import (
    Beneficiary,
    BudgetScenario,
    Corridor,
    Disbursement,
    FundingPlan,
    FXQuote,
    LoanSimulation,
    Payment,
    SimulatedApplication,
)

SALT = "studyflow-credit-statement-v1"
# Patched "real today"; the demo wallet clock is initialized to the same date.
CLOCK = date(2026, 3, 31)
_REAL_LOCALDATE = timezone.localdate
SNAPSHOT = {
    "currency": "THB",
    "as_of": CLOCK.isoformat(),
    "opening_balance": "1000.00",
    "reserve": "0.00",
    "events": [],
}
COUNTED_PAYMENT_STATUSES = ["settled", "reconciled", "reconciliation_exception"]
UNCOUNTED_PAYMENT_STATUSES = ["draft", "authorized", "pending", "unknown", "failed", "cancelled", "expired"]
MULTIPLIERS = {"AT_RISK": Decimal("0.5"), "GOOD": Decimal("1.5"), "FAIR": Decimal("1.2"), "BUILDING": Decimal("1.0")}


def days_ago(n, base=CLOCK):
    return base - timedelta(days=n)


def unwrap(body):
    return body["data"] if isinstance(body, dict) and "data" in body else body


def list_items(body):
    """Accept either DRF pagination ({"results": [...]}) or {"data": [...]} envelopes."""
    if isinstance(body, dict) and "results" in body:
        return body["results"]
    data = unwrap(body)
    if isinstance(data, dict) and "results" in data:
        return data["results"]
    return data


def leaves(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from leaves(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from leaves(item)
    else:
        yield value


class CreditHarness:
    def setUp(self):
        users = get_user_model().objects
        self.student = users.create_user(username="credit-student")
        self.other = users.create_user(username="credit-other")
        self._accounts = {}
        self._numbers = {}
        self._plans = {}
        self.today = CLOCK
        localdate = patch(
            "django.utils.timezone.localdate",
            lambda value=None, timezone=None: self.today if value is None else _REAL_LOCALDATE(value, timezone),
        )
        localdate.start()
        self.addCleanup(localdate.stop)
        for user in (self.student, self.other):
            self.bootstrap(user)
        self.client.force_authenticate(self.student)

    # ---- HTTP helpers -------------------------------------------------
    def bootstrap(self, user):
        self.client.force_authenticate(user)
        response = self.client.post(
            "/api/v2/state/", {"expected_version": 0, "snapshot": deepcopy(SNAPSHOT)}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        response = self.client.post(
            "/api/v2/demo/initialize/", {"state_version": 1}, format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid4()),
        )
        self.assertEqual(response.status_code, 201, response.data)

    def set_today(self, value):
        """Move the (patched) real date; the demo clock is left alone."""
        self.today = value

    def set_clock(self, value, user=None):
        self.client.force_authenticate(user or self.student)
        response = self.client.post(
            "/api/v2/demo/clock/", {"date": value.isoformat()}, format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid4()),
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.client.force_authenticate(self.student)

    def profile(self, user=None):
        self.client.force_authenticate(user or self.student)
        response = self.client.get("/api/v2/credit/profile/")
        self.assertEqual(response.status_code, 200, getattr(response, "data", response))
        self.assertIn("data", response.data)
        return response.data["data"]

    def create_snapshot(self, user=None, key=None):
        self.client.force_authenticate(user or self.student)
        response = self.client.post(
            "/api/v2/credit/snapshots/", {}, format="json", HTTP_IDEMPOTENCY_KEY=key or str(uuid4())
        )
        self.assertIn(response.status_code, (200, 201), getattr(response, "data", response))
        return response

    def issue(self, snapshot_id, user=None, key=None):
        self.client.force_authenticate(user or self.student)
        return self.client.post(
            "/api/v2/credit/statements/", {"snapshot_id": str(snapshot_id)}, format="json",
            HTTP_IDEMPOTENCY_KEY=key or str(uuid4()),
        )

    def verify(self, statement):
        self.client.force_authenticate(None)
        self.client.logout()
        response = self.client.post("/api/v2/credit/statements/verify/", {"statement": statement}, format="json")
        self.assertEqual(response.status_code, 200, getattr(response, "data", response))
        self.assertIn("data", response.data)  # spec: always wrapped in {"data": ...}
        return response.data["data"]

    # ---- ORM evidence -------------------------------------------------
    def account(self, owner):
        if owner.pk not in self._accounts:
            loan = LoanSimulation.objects.create(owner=owner, inputs={}, result={"schedule": []})
            application = SimulatedApplication.objects.create(owner=owner, loan=loan, status="DISBURSED")
            disbursement = Disbursement.objects.create(
                owner=owner, application=application, amount=Decimal("5000.00"),
                scheduled_on=days_ago(800), status="settled",
            )
            self._accounts[owner.pk] = LoanAccount.objects.create(
                owner=owner, disbursement=disbursement, outstanding_principal=Decimal("5000.00")
            )
            self._numbers[owner.pk] = 0
        return self._accounts[owner.pk]

    def installment(self, due_on, paid_on=None, owner=None):
        owner = owner or self.student
        account = self.account(owner)
        self._numbers[owner.pk] += 1
        return LoanInstallment.objects.create(
            owner=owner, account=account, number=self._numbers[owner.pk], due_on=due_on,
            amount=Decimal("100.00"), principal=Decimal("100.00"), paid_on=paid_on,
        )

    def plan(self, owner):
        if owner.pk not in self._plans:
            state = FinancialState.objects.filter(owner=owner).first()
            scenario = BudgetScenario.objects.create(
                owner=owner, state=state, kind="expected", revision=999, inputs={}, result={}
            )
            plan = FundingPlan.objects.create(owner=owner, scenario=scenario, inputs={}, result={})
            beneficiary = Beneficiary.objects.create(
                owner=owner, name="Demo university", destination_label="MOCK-UNIVERSITY", verified=True
            )
            self._plans[owner.pk] = (state, plan, beneficiary)
        return self._plans[owner.pk]

    def payment(self, due_on, settled_on=None, status="settled", owner=None):
        owner = owner or self.student
        state, plan, beneficiary = self.plan(owner)
        event_id = "credit-" + uuid4().hex[:12]
        receipt = None
        if settled_on is not None:
            receipt = {
                "reference": "mock:" + event_id, "event_id": event_id, "amount": "100.00",
                "currency": "THB", "beneficiary_id": str(beneficiary.id), "is_simulated": True,
                "settled_on": settled_on.isoformat(),
            }
        return Payment.objects.create(
            owner=owner, plan=plan, state=state, beneficiary=beneficiary, event_id=event_id,
            amount=Decimal("100.00"), due_on=due_on, status=status, receipt=receipt,
        )

    def remittance(self, deadline, delivered_on, recipient="BENEFICIARY", status="DELIVERED",
                   verified=True, owner=None):
        owner = owner or self.student
        if not hasattr(self, "_corridor"):
            self._corridor = Corridor.objects.create(
                code="credit-test-" + uuid4().hex[:8], provider="Mock", tier="standard",
                source_currency="THB", target_currency="USD", min_amount=Decimal("1.00"),
                max_amount=Decimal("100000.00"),
            )
        quote = FXQuote.objects.create(
            owner=owner, source_currency="THB", target_currency="USD", rate=Decimal("0.03"),
            expires_at=timezone.now() + timedelta(hours=1), corridor=self._corridor,
            quoted_amount=Decimal("100.00"),
        )
        beneficiary = None
        if recipient == "BENEFICIARY":
            beneficiary = Beneficiary.objects.create(
                owner=owner, name="Landlord", destination_label="MOCK-LANDLORD", verified=verified
            )
        return RemittanceOrder.objects.create(
            owner=owner, quote=quote, corridor=self._corridor, recipient=recipient, beneficiary=beneficiary,
            purpose="living", send_currency="THB", send_amount=Decimal("100.00"), sender_fee=Decimal("0"),
            rate=Decimal("0.03"), mid_rate=Decimal("0.03"), receive_currency="USD",
            receive_amount=Decimal("3.00"), deadline=deadline, status=status, delivered_on=delivered_on,
        )

    def on_time(self, n, owner=None, start=5):
        """n installments paid exactly on their due date, all well inside the window."""
        return [self.installment(days_ago(start + 7 * i), days_ago(start + 7 * i), owner) for i in range(n)]

    def late(self, n, owner=None, start=8):
        return [self.installment(days_ago(start + 7 * i), days_ago(start + 7 * i - 3), owner) for i in range(n)]

    # ---- assertions ---------------------------------------------------
    def factor(self, data, code):
        matches = [f for f in data["factors"] if f["code"] == code]
        self.assertLessEqual(len(matches), 1, data["factors"])
        return matches[0] if matches else None

    def assert_profile(self, level, on_time, late, overdue, user=None):
        from finance.credit import limit_multiplier

        data = self.profile(user)
        self.assertEqual(data["level"], level, data)
        self.assertEqual((data["on_time"], data["late"], data["overdue"]), (on_time, late, overdue), data)
        self.assertEqual(Decimal(str(data["limit_multiplier"])), MULTIPLIERS[level], data)
        self.assertEqual(limit_multiplier(user or self.student), MULTIPLIERS[level])
        self.assertIs(data["is_simulated"], True)
        self.assertTrue(data.get("disclaimer"))
        # factors
        # Factors with count 0 are omitted (THIN_HISTORY is governed by its own rule).
        if on_time:
            self.assertEqual(self.factor(data, "ON_TIME_RECORDS")["effect"], "positive")
            self.assertEqual(self.factor(data, "ON_TIME_RECORDS")["count"], on_time)
        else:
            self.assertIsNone(self.factor(data, "ON_TIME_RECORDS"), data["factors"])
        if late:
            self.assertEqual(self.factor(data, "LATE_RECORDS")["effect"], "negative")
            self.assertEqual(self.factor(data, "LATE_RECORDS")["count"], late)
        else:
            self.assertIsNone(self.factor(data, "LATE_RECORDS"), data["factors"])
        if overdue:
            self.assertEqual(self.factor(data, "OVERDUE_RECORDS")["effect"], "negative")
            self.assertEqual(self.factor(data, "OVERDUE_RECORDS")["count"], overdue)
        else:
            self.assertIsNone(self.factor(data, "OVERDUE_RECORDS"), data["factors"])
        thin = self.factor(data, "THIN_HISTORY")
        if on_time < 3:
            self.assertIsNotNone(thin, data["factors"])
            self.assertEqual(thin["effect"], "neutral")
        else:
            self.assertIsNone(thin, data["factors"])
        for item in data["factors"]:
            self.assertIn(item["code"], {"ON_TIME_RECORDS", "LATE_RECORDS", "OVERDUE_RECORDS", "THIN_HISTORY"})
        # next_level
        nxt = data["next_level"]
        if level == "GOOD":
            self.assertIsNone(nxt)
        elif level == "AT_RISK":
            self.assertEqual(nxt["level"], "BUILDING")
            self.assertEqual(nxt["action"], "RESOLVE_OVERDUE" if overdue else "WAIT_FOR_LATE_RECORDS_TO_AGE_OUT")
        elif level == "FAIR":
            self.assertEqual(nxt["level"], "GOOD")
            self.assertEqual(nxt["on_time_needed"], max(6 - on_time, 0))
            self.assertIs(nxt["late_records_must_age_out"], late > 0)
        else:
            self.assertEqual(nxt, {"level": "FAIR", "on_time_needed": 3 - on_time})
        self.assertEqual(len(data["evidence"]), on_time + late + overdue, data["evidence"])
        return data


class CreditLevelTests(CreditHarness, APITestCase):
    def test_building_without_records(self):
        data = self.assert_profile("BUILDING", 0, 0, 0)
        self.assertEqual(data["as_of"], CLOCK.isoformat())
        self.assertEqual(data["evidence"], [])

    def test_building_with_two_on_time(self):
        self.on_time(2)
        self.assert_profile("BUILDING", 2, 0, 0)

    def test_fair_at_exactly_three_on_time(self):
        self.on_time(3)
        self.assert_profile("FAIR", 3, 0, 0)

    def test_fair_three_on_time_one_late(self):
        self.on_time(3)
        self.late(1)
        self.assert_profile("FAIR", 3, 1, 0)

    def test_two_on_time_one_late_stays_building(self):
        self.on_time(2)
        self.late(1)
        self.assert_profile("BUILDING", 2, 1, 0)

    def test_five_on_time_is_still_fair(self):
        self.on_time(5)
        self.assert_profile("FAIR", 5, 0, 0)

    def test_good_at_six_on_time_zero_late(self):
        self.on_time(6)
        self.assert_profile("GOOD", 6, 0, 0)

    def test_six_on_time_one_late_is_fair(self):
        self.on_time(6)
        self.late(1)
        self.assert_profile("FAIR", 6, 1, 0)

    def test_one_overdue_installment_is_at_risk_despite_history(self):
        self.on_time(10)
        self.installment(days_ago(1))  # unpaid, due yesterday
        self.assert_profile("AT_RISK", 10, 0, 1)

    def test_two_late_is_at_risk(self):
        self.on_time(8)
        self.late(2)
        self.assert_profile("AT_RISK", 8, 2, 0)

    def test_two_late_without_on_time_is_at_risk_with_thin_history(self):
        self.late(2)
        self.assert_profile("AT_RISK", 0, 2, 0)

    def test_overdue_and_two_late_asks_to_resolve_overdue(self):
        self.on_time(3)
        self.late(2)
        self.installment(days_ago(2))
        self.assert_profile("AT_RISK", 3, 2, 1)

    def test_paid_on_due_date_is_on_time_and_day_after_is_late(self):
        self.installment(days_ago(20), days_ago(20))
        self.installment(days_ago(30), days_ago(29))
        self.assert_profile("BUILDING", 1, 1, 0)

    def test_unpaid_due_today_or_later_is_not_overdue(self):
        self.on_time(3)
        self.installment(CLOCK)  # due today: not "due_on < today"
        self.installment(CLOCK + timedelta(days=30))
        self.assert_profile("FAIR", 3, 0, 0)

    def test_advancing_clock_past_unpaid_due_date_makes_it_overdue(self):
        # Regression (b): the demo clock can make an obligation overdue sooner than real time.
        self.on_time(3)
        row = self.installment(CLOCK + timedelta(days=10))
        self.assert_profile("FAIR", 3, 0, 0)
        self.set_clock(CLOCK + timedelta(days=10))  # due_on == clock: not yet overdue
        self.assert_profile("FAIR", 3, 0, 0)
        self.set_clock(CLOCK + timedelta(days=11))
        data = self.assert_profile("AT_RISK", 3, 0, 1)
        self.assertEqual(data["as_of"], CLOCK.isoformat())  # still the real date
        self.assertIn(str(row.id), {item["id"] for item in data["evidence"]})

    def test_overdue_uses_real_today_when_demo_clock_is_behind(self):
        behind = get_user_model().objects.create_user(username="credit-behind")
        self.client.force_authenticate(behind)
        snapshot = {**deepcopy(SNAPSHOT), "as_of": days_ago(30).isoformat()}
        response = self.client.post("/api/v2/state/", {"expected_version": 0, "snapshot": snapshot}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        response = self.client.post("/api/v2/demo/initialize/", {"state_version": 1}, format="json",
                                    HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(response.status_code, 201, response.data)
        self.installment(days_ago(10), owner=behind)  # not overdue on the clock, overdue in real time
        self.assert_profile("AT_RISK", 0, 0, 1, user=behind)

    def test_paying_late_after_overdue_moves_record_to_late(self):
        self.on_time(3)
        row = self.installment(days_ago(5))
        self.assert_profile("AT_RISK", 3, 0, 1)
        LoanInstallment.objects.filter(pk=row.pk).update(paid_on=CLOCK)
        self.assert_profile("FAIR", 3, 1, 0)


class CreditSourceTests(CreditHarness, APITestCase):
    def test_records_older_than_twelve_months_are_ignored(self):
        self.on_time(2)
        old = [self.installment(days_ago(400 + i), days_ago(400 + i)) for i in range(5)]
        self.installment(days_ago(420), days_ago(410))  # old late
        self.installment(days_ago(430), days_ago(400))  # old late
        self.payment(days_ago(400), days_ago(400))
        data = self.assert_profile("BUILDING", 2, 0, 0)
        ids = {item["id"] for item in data["evidence"]}
        self.assertFalse(ids & {str(row.id) for row in old})

    def test_records_eleven_months_old_are_counted(self):
        self.installment(days_ago(330), days_ago(330))
        self.payment(days_ago(320), days_ago(320))
        self.installment(days_ago(310), days_ago(310))
        self.assert_profile("FAIR", 3, 0, 0)

    def test_window_moves_with_the_real_date(self):
        self.installment(days_ago(330), days_ago(330))
        self.on_time(2)
        self.assert_profile("FAIR", 3, 0, 0)
        later = CLOCK + timedelta(days=60)
        self.set_today(later)
        data = self.assert_profile("BUILDING", 2, 0, 0)
        self.assertEqual(data["as_of"], later.isoformat())

    def test_advancing_demo_clock_400_days_drops_nothing(self):
        # Regression (a): a student-controlled clock must not age late records out.
        self.on_time(3)
        self.installment(days_ago(330), days_ago(320))
        self.installment(days_ago(330), days_ago(310))
        before = self.assert_profile("AT_RISK", 3, 2, 0)
        self.set_clock(CLOCK + timedelta(days=400))
        after = self.assert_profile("AT_RISK", 3, 2, 0)
        self.assertEqual(after["as_of"], CLOCK.isoformat())
        self.assertEqual({i["id"] for i in after["evidence"]}, {i["id"] for i in before["evidence"]})

    def test_advancing_demo_clock_keeps_fair_with_late_record(self):
        self.on_time(6)
        self.installment(days_ago(320), days_ago(300))
        self.assert_profile("FAIR", 6, 1, 0)
        self.set_clock(CLOCK + timedelta(days=400))
        self.assert_profile("FAIR", 6, 1, 0)

    def test_as_of_is_real_date_in_profile_snapshot_and_statement(self):
        # Regression (c).
        self.on_time(3)
        self.set_clock(CLOCK + timedelta(days=100))
        self.assertEqual(self.profile()["as_of"], CLOCK.isoformat())
        snap = unwrap(self.create_snapshot().data)
        self.assertEqual(snap["as_of"], CLOCK.isoformat())
        self.assertEqual(CreditSnapshot.objects.get(pk=snap["id"]).as_of, CLOCK)
        response = self.issue(snap["id"])
        self.assertIn(response.status_code, (200, 201), response.data)
        payload = signing.loads(response.data["data"]["statement"], salt=SALT)
        self.assertIn(CLOCK.isoformat(), [str(v) for v in leaves(payload)])
        self.assertNotIn((CLOCK + timedelta(days=100)).isoformat(), json.dumps(payload))

    def test_as_of_is_unpatched_real_today(self):
        patch.stopall()  # use the genuine timezone.localdate()
        self.set_clock(CLOCK + timedelta(days=700))
        self.assertEqual(self.profile()["as_of"], _REAL_LOCALDATE().isoformat())

    def test_remittances_to_verified_beneficiaries_count(self):
        on_time = [self.remittance(days_ago(10 + i), days_ago(12 + i)) for i in range(3)]
        late = self.remittance(days_ago(40), days_ago(38), status="RECONCILED")
        data = self.assert_profile("FAIR", 3, 1, 0)
        self.assertEqual({item["id"] for item in data["evidence"]}, {str(r.id) for r in on_time + [late]})

    def test_self_remittances_never_count(self):
        for i in range(6):
            self.remittance(days_ago(10 + i), days_ago(12 + i), recipient="SELF")
        self.remittance(days_ago(40), days_ago(30), recipient="SELF")  # late self-transfer
        self.assert_profile("BUILDING", 0, 0, 0)

    def test_remittance_to_unverified_beneficiary_does_not_count(self):
        for i in range(3):
            self.remittance(days_ago(10 + i), days_ago(12 + i), verified=False)
        self.assert_profile("BUILDING", 0, 0, 0)

    def test_undelivered_or_deadline_free_remittances_do_not_count(self):
        self.remittance(None, days_ago(10))  # no deadline
        self.remittance(days_ago(10), None, status="IN_TRANSIT")
        self.remittance(days_ago(20), None, status="CANCELLED")
        self.remittance(days_ago(30), None, status="UNKNOWN")
        self.assert_profile("BUILDING", 0, 0, 0)

    def test_window_includes_exactly_365_days_back_and_excludes_366(self):
        inside = [self.installment(days_ago(365), days_ago(365)), self.payment(days_ago(365), days_ago(365))]
        outside = [self.installment(days_ago(366), days_ago(366)), self.payment(days_ago(366), days_ago(366)),
                   self.installment(days_ago(370), days_ago(366))]  # late, completed 366 days back
        data = self.assert_profile("BUILDING", 2, 0, 0)
        ids = {item["id"] for item in data["evidence"]}
        self.assertEqual(ids, {str(row.id) for row in inside})
        self.assertFalse(ids & {str(row.id) for row in outside})

    def test_completed_records_are_placed_by_completion_date(self):
        # Due before the window but completed inside it -> counted (late).
        late_installment = self.installment(days_ago(400), days_ago(300))
        late_payment = self.payment(days_ago(380), days_ago(360))
        # Completed more than 365 days back -> ignored.
        self.installment(days_ago(380), days_ago(370))
        self.payment(days_ago(390), days_ago(366))
        data = self.assert_profile("AT_RISK", 0, 2, 0)
        self.assertEqual({item["id"] for item in data["evidence"]},
                         {str(late_installment.id), str(late_payment.id)})

    def test_records_completed_after_real_today_still_count(self):
        # No upper bound: completions on "future" demo dates count immediately.
        self.on_time(3)
        rows = [
            self.installment(CLOCK + timedelta(days=10), CLOCK + timedelta(days=3)),
            self.payment(CLOCK + timedelta(days=20), CLOCK + timedelta(days=5)),
            self.remittance(CLOCK + timedelta(days=9), CLOCK + timedelta(days=8)),
            self.payment(CLOCK + timedelta(days=1), CLOCK + timedelta(days=6)),  # late
        ]
        data = self.assert_profile("FAIR", 6, 1, 0)
        self.assertLessEqual({str(r.id) for r in rows}, {item["id"] for item in data["evidence"]})

    def test_unresolved_overdue_never_ages_out(self):
        self.on_time(6)
        old = self.installment(days_ago(500))
        data = self.assert_profile("AT_RISK", 6, 0, 1)
        self.assertIn(str(old.id), {item["id"] for item in data["evidence"]})
        self.set_today(CLOCK + timedelta(days=700))
        self.assert_profile("AT_RISK", 0, 0, 1)

    def test_fair_late_record_must_age_out_before_good(self):
        self.on_time(6)
        self.installment(days_ago(320), days_ago(300))
        data = self.assert_profile("FAIR", 6, 1, 0)
        self.assertEqual(data["next_level"]["on_time_needed"], 0)
        self.assertIs(data["next_level"]["late_records_must_age_out"], True)
        self.set_today(CLOCK + timedelta(days=65))  # late completion exactly 365 days back
        self.assert_profile("FAIR", 6, 1, 0)
        self.set_today(CLOCK + timedelta(days=66))  # now 366 days back
        self.assert_profile("GOOD", 6, 0, 0)

    def test_at_risk_from_late_records_recovers_when_they_age_out(self):
        self.on_time(3)
        self.installment(days_ago(330), days_ago(320))
        self.installment(days_ago(330), days_ago(310))
        data = self.assert_profile("AT_RISK", 3, 2, 0)
        self.assertEqual(data["next_level"]["action"], "WAIT_FOR_LATE_RECORDS_TO_AGE_OUT")
        self.set_today(CLOCK + timedelta(days=46))  # first late now 366 days back
        self.assert_profile("FAIR", 3, 1, 0)
        self.set_today(CLOCK + timedelta(days=56))
        self.assert_profile("FAIR", 3, 0, 0)

    def test_as_of_is_today_without_wallet(self):
        walletless = get_user_model().objects.create_user(username="credit-no-wallet")
        data = self.profile(walletless)
        self.assertEqual(data["as_of"], timezone.localdate().isoformat())
        self.assertEqual(data["level"], "BUILDING")

    def test_payments_count_only_in_settled_statuses(self):
        for status in COUNTED_PAYMENT_STATUSES:
            self.payment(days_ago(10), days_ago(12), status=status)
        for status in UNCOUNTED_PAYMENT_STATUSES:
            self.payment(days_ago(20), days_ago(21), status=status)
        data = self.assert_profile("FAIR", 3, 0, 0)
        self.assertEqual(len(data["evidence"]), 3)

    def test_payment_timeliness_uses_receipt_settled_on(self):
        self.payment(days_ago(10), days_ago(10))  # settled on due date -> on time
        self.payment(days_ago(20), days_ago(25), status="reconciled")  # early -> on time
        self.payment(days_ago(30), days_ago(29), status="reconciliation_exception")  # late
        self.assert_profile("BUILDING", 2, 1, 0)

    def test_two_late_payments_are_at_risk(self):
        self.on_time(6)
        self.payment(days_ago(30), days_ago(20))
        self.payment(days_ago(40), days_ago(35))
        self.assert_profile("AT_RISK", 6, 2, 0)

    def test_unsettled_past_due_payments_are_never_overdue(self):
        self.on_time(6)
        self.payment(days_ago(60), None, status="pending")
        self.payment(days_ago(50), None, status="failed")
        self.payment(days_ago(40), None, status="draft")
        self.assert_profile("GOOD", 6, 0, 0)

    def test_other_users_records_are_never_counted(self):
        self.on_time(10, owner=self.other)
        self.late(3, owner=self.other)
        self.installment(days_ago(3), owner=self.other)
        for status in COUNTED_PAYMENT_STATUSES:
            self.payment(days_ago(10), days_ago(5), status=status, owner=self.other)
        self.on_time(1)
        self.assert_profile("BUILDING", 1, 0, 0)
        self.assert_profile("AT_RISK", 10, 6, 1, user=self.other)

    def test_evidence_lists_each_counted_record(self):
        rows = self.on_time(3)
        payment = self.payment(days_ago(15), days_ago(16))
        data = self.assert_profile("FAIR", 4, 0, 0)
        evidence = {item["id"]: item for item in data["evidence"]}
        self.assertEqual(set(evidence), {str(r.id) for r in rows} | {str(payment.id)})
        first = evidence[str(rows[0].id)]
        self.assertEqual(first["source"], "loan_installment")
        self.assertEqual(first["due_on"], rows[0].due_on.isoformat())
        self.assertEqual(first["completed_on"], rows[0].paid_on.isoformat())
        self.assertEqual(first["status"], "ON_TIME")
        paid = evidence[str(payment.id)]
        self.assertEqual(paid["due_on"], payment.due_on.isoformat())
        self.assertEqual(paid["completed_on"], days_ago(16).isoformat())
        self.assertEqual(paid["status"], "ON_TIME")

    def test_profile_get_writes_nothing(self):
        self.on_time(3)
        before = (CreditSnapshot.objects.count(), AuditEvent.objects.count(), FinancialState.objects.count())
        self.profile()
        self.profile()
        after = (CreditSnapshot.objects.count(), AuditEvent.objects.count(), FinancialState.objects.count())
        self.assertEqual(before, after)

    def test_profile_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/v2/credit/profile/").status_code, (401, 403))


class CreditSnapshotTests(CreditHarness, APITestCase):
    def test_snapshot_requires_idempotency_key(self):
        response = self.client.post("/api/v2/credit/snapshots/", {}, format="json")
        self.assertGreaterEqual(response.status_code, 400)
        self.assertLess(response.status_code, 500)
        self.assertEqual(CreditSnapshot.objects.count(), 0)

    def test_snapshot_records_current_result_and_replays(self):
        self.on_time(4)
        expected = self.profile()
        first = self.create_snapshot(key="snap-1")
        body = unwrap(first.data)
        self.assertEqual(body["level"], "FAIR")
        for field in ("on_time", "late", "overdue", "as_of"):
            self.assertEqual(body[field], expected[field], field)
        row = CreditSnapshot.objects.get(owner=self.student)
        self.assertEqual(str(row.id), body["id"])
        self.assertEqual((row.level, row.on_time, row.late, row.overdue, row.as_of),
                         ("FAIR", 4, 0, 0, CLOCK))
        replay = self.create_snapshot(key="snap-1")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data, first.data)
        self.assertEqual(CreditSnapshot.objects.filter(owner=self.student).count(), 1)
        self.create_snapshot(key="snap-2")
        self.assertEqual(CreditSnapshot.objects.filter(owner=self.student).count(), 2)

    def test_snapshot_is_frozen_after_new_records(self):
        self.on_time(3)
        snap = unwrap(self.create_snapshot().data)
        self.on_time(3, start=60)
        self.assertEqual(self.profile()["level"], "GOOD")
        response = self.client.get("/api/v2/credit/snapshots/" + snap["id"] + "/")
        self.assertEqual(response.status_code, 200)
        detail = unwrap(response.data)
        self.assertEqual((detail["level"], detail["on_time"]), ("FAIR", 3))

    def test_snapshot_rows_are_immutable_in_database(self):
        row = CreditSnapshot.objects.create(
            owner=self.student, level="FAIR", on_time=3, late=0, overdue=0, as_of=CLOCK
        )
        with self.assertRaises(DatabaseError), transaction.atomic():
            CreditSnapshot.objects.filter(pk=row.pk).update(level="GOOD")
        with self.assertRaises(DatabaseError), transaction.atomic():
            CreditSnapshot.objects.filter(pk=row.pk).delete()
        self.assertEqual(CreditSnapshot.objects.get(pk=row.pk).level, "FAIR")

    def test_api_created_snapshot_is_immutable(self):
        self.on_time(3)
        snap = unwrap(self.create_snapshot().data)
        with self.assertRaises(DatabaseError), transaction.atomic():
            CreditSnapshot.objects.filter(pk=snap["id"]).update(on_time=99)
        self.assertEqual(CreditSnapshot.objects.get(pk=snap["id"]).on_time, 3)

    def test_snapshot_list_and_detail_are_owner_scoped(self):
        mine = unwrap(self.create_snapshot().data)
        theirs = unwrap(self.create_snapshot(user=self.other).data)
        self.client.force_authenticate(self.student)
        listed = self.client.get("/api/v2/credit/snapshots/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in list_items(listed.data)], [mine["id"]])
        self.assertEqual(self.client.get("/api/v2/credit/snapshots/" + mine["id"] + "/").status_code, 200)
        self.assertEqual(self.client.get("/api/v2/credit/snapshots/" + theirs["id"] + "/").status_code, 404)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/v2/credit/snapshots/").status_code, (401, 403))


class CreditStatementTests(CreditHarness, APITestCase):
    def snapshot_with_history(self):
        self.rows = self.on_time(3) + self.late(1)
        self.paid = self.payment(days_ago(45), days_ago(46))
        snap = unwrap(self.create_snapshot().data)
        self.assertEqual((snap["level"], snap["on_time"], snap["late"], snap["overdue"]), ("FAIR", 4, 1, 0))
        return snap

    def issued(self, snap):
        response = self.issue(snap["id"])
        self.assertIn(response.status_code, (200, 201), getattr(response, "data", response))
        return response.data["data"]

    def test_statement_for_own_snapshot(self):
        snap = self.snapshot_with_history()
        data = self.issued(snap)
        self.assertIsInstance(data["statement"], str)
        self.assertEqual(data["expires_in_days"], 90)
        self.assertEqual(data["snapshot_id"], snap["id"])
        self.assertEqual(data["level"], "FAIR")

    def test_statement_requires_idempotency_key(self):
        snap = self.snapshot_with_history()
        response = self.client.post("/api/v2/credit/statements/", {"snapshot_id": snap["id"]}, format="json")
        self.assertGreaterEqual(response.status_code, 400)
        self.assertLess(response.status_code, 500)

    def test_statement_rejects_other_users_snapshot(self):
        theirs = unwrap(self.create_snapshot(user=self.other).data)
        response = self.issue(theirs["id"], user=self.student)
        self.assertIn(response.status_code, (400, 403, 404))
        self.assertNotIn("statement", json.dumps(response.data))
        response = self.issue(uuid4(), user=self.student)
        self.assertIn(response.status_code, (400, 403, 404))

    def test_statement_contains_only_summary_fields(self):
        snap = self.snapshot_with_history()
        statement = self.issued(snap)["statement"]
        payload = signing.loads(statement, salt=SALT)
        values = Counter(str(v) for v in leaves(payload))
        expected = Counter(str(v) for v in [snap["id"], self.student.username, "FAIR", 4, 1, 0, CLOCK.isoformat()])
        self.assertEqual(expected - values, Counter(), payload)
        # The seven listed fields plus the issue time, nothing else.
        self.assertEqual(sum(values.values()), 8, payload)
        text = json.dumps(payload)
        for row in self.rows:
            self.assertNotIn(str(row.id), text)
            self.assertNotIn(row.due_on.isoformat(), text)
        self.assertNotIn(str(self.paid.id), text)
        self.assertNotIn(self.paid.event_id, text)
        for word in ("evidence", "factors", "loan_installment", "100.00", "amount"):
            self.assertNotIn(word, text)

    def test_verify_valid_statement_without_login(self):
        snap = self.snapshot_with_history()
        statement = self.issued(snap)["statement"]
        payload = signing.loads(statement, salt=SALT)
        result = self.verify(statement)
        self.assertIs(result["valid"], True, result)
        self.assertIs(result["is_simulated"], True)
        for key, value in payload.items():
            self.assertEqual(result[key], value, key)

    def test_verify_tampered_or_foreign_strings_are_invalid_signature(self):
        snap = self.snapshot_with_history()
        statement = self.issued(snap)["statement"]
        flipped = statement[:3] + ("A" if statement[3] != "A" else "B") + statement[4:]
        payload = signing.loads(statement, salt=SALT)
        for candidate in (
            flipped,
            statement[:-1] + ("A" if statement[-1] != "A" else "B"),
            "not-a-statement",
            signing.dumps(payload, salt="some-other-salt"),
        ):
            result = self.verify(candidate)
            self.assertIs(result["valid"], False, candidate)
            self.assertEqual(result["reason"], "INVALID_SIGNATURE", candidate)

    def test_verify_empty_or_oversized_statement_is_200_invalid_signature(self):
        # Spec: anything that is not a valid statement -> {"valid": false, reason}, HTTP 200.
        for candidate in ("", "x" * 5000):
            result = self.verify(candidate)
            self.assertIs(result["valid"], False)
            self.assertEqual(result["reason"], "INVALID_SIGNATURE")

    def test_verify_correctly_signed_non_dict_payload_is_invalid_signature(self):
        for payload in ("just a string", ["a", "list"], 42, None):
            result = self.verify(signing.dumps(payload, salt=SALT))
            self.assertIs(result["valid"], False, payload)
            self.assertEqual(result["reason"], "INVALID_SIGNATURE", payload)

    def test_verify_signed_payload_with_malformed_snapshot_id_is_200(self):
        snap = self.snapshot_with_history()
        payload = signing.loads(self.issued(snap)["statement"], salt=SALT)
        id_key = next(k for k, v in payload.items() if v == snap["id"])
        for bad in ("not-a-uuid", {"nested": 1}, ["x"]):
            result = self.verify(signing.dumps({**payload, id_key: bad}, salt=SALT))  # asserts HTTP 200
            self.assertIs(result["valid"], False, bad)
            # Spec: malformed signed content -> INVALID_SIGNATURE; a mismatch reason is also defensible.
            self.assertIn(result["reason"], ("INVALID_SIGNATURE", "SNAPSHOT_MISMATCH"), bad)

    def test_verify_ignores_bogus_credentials(self):
        snap = self.snapshot_with_history()
        statement = self.issued(snap)["statement"]
        self.client.force_authenticate(None)
        response = self.client.post("/api/v2/credit/statements/verify/", {"statement": statement},
                                    format="json", HTTP_AUTHORIZATION="Token not-a-real-token")
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.data["data"]["valid"], True)

    def issued_at(self, snap, offset):
        """Issue a statement as if the wall clock were shifted by offset."""
        shifted = timezone.now() + offset
        real_time = time.time

        with patch("time.time", lambda: real_time() + offset.total_seconds()), \
                patch("django.utils.timezone.now", lambda: shifted):
            return self.issued(snap)["statement"]

    def test_verify_expired_after_ninety_days(self):
        snap = self.snapshot_with_history()
        statement = self.issued_at(snap, -timedelta(days=91))
        result = self.verify(statement)
        self.assertIs(result["valid"], False, result)
        self.assertEqual(result["reason"], "EXPIRED")

    def test_verify_still_valid_before_ninety_days(self):
        snap = self.snapshot_with_history()
        statement = self.issued_at(snap, -timedelta(days=89))
        self.assertIs(self.verify(statement)["valid"], True)

    def test_verify_signed_content_not_matching_snapshot(self):
        snap = self.snapshot_with_history()
        payload = signing.loads(self.issued(snap)["statement"], salt=SALT)
        level_key = next(k for k, v in payload.items() if v == "FAIR")
        forged_level = {**payload, level_key: "GOOD"}
        id_key = next(k for k, v in payload.items() if v == snap["id"])
        missing_snapshot = {**payload, id_key: str(uuid4())}
        for forged in (forged_level, missing_snapshot):
            result = self.verify(signing.dumps(forged, salt=SALT))
            self.assertIs(result["valid"], False, forged)
            self.assertEqual(result["reason"], "SNAPSHOT_MISMATCH", forged)
