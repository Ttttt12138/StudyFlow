"""Tiered permissions, step-up, approvals, limits and throttling (docs/permissions.md)."""
import json
import os
import secrets
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from auto_test.test_lending_merge import LendingHarness
from auto_test.test_multicurrency import FX_SETTINGS, HOME, PASSWORD, MultiCurrencyHarness
from finance import policy
from finance.models import AuditEvent
from finance.policy_models import ApprovalRequest, PolicyLimit, StepUpGrant
from finance.workflow_models import CurrencyConversion, Payment

ROOT = Path(__file__).resolve().parent.parent
THB_LIMITS = {"per_transaction": "50000.00", "daily": "100000.00", "monthly": "300000.00"}


def rates(**changes):
    return override_settings(STUDYFLOW_THROTTLE_RATES={**settings.STUDYFLOW_THROTTLE_RATES, **changes})


class PolicyHarness(MultiCurrencyHarness):
    username = "policy-student"

    def setUp(self):
        cache.clear()
        self.bootstrap()
        self.receive_home("9000.00")  # makes the BASE rent + tuition plan feasible above the reserve

    def raw(self, path, data=None, *, user=None, token=None, key=None, **extra):
        """A command POST with exactly the headers given (no automatic step-up)."""
        self.client.force_authenticate(user or self.user)
        headers = {"HTTP_IDEMPOTENCY_KEY": key or str(uuid4()), **extra}
        if token:
            headers["HTTP_X_STEP_UP_TOKEN"] = token
        return self.client.post("/api/v2/" + path.strip("/") + "/", data or {}, format="json", **headers)

    def api(self, path, data, user=None):
        self.client.force_authenticate(user or self.user)
        return self.client.post("/api/v2/" + path.strip("/") + "/", data, format="json")

    def read(self, path, user=None):
        self.client.force_authenticate(user or self.user)
        return self.client.get("/api/v2/" + path.strip("/") + "/")

    def step_up(self, action, target_id, amount, currency=HOME, user=None, password=PASSWORD):
        response = self.api("auth/step-up", {"password": password, "action": action,
                                             "target_id": str(target_id), "amount": amount,
                                             "currency": currency}, user)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["token"]

    def ask(self, action, target_id, amount, currency=HOME, user=None, code=201):
        response = self.api("approvals", {"action": action, "target_id": str(target_id), "amount": amount,
                                          "currency": currency, "reason": "Tuition this semester"}, user)
        self.assertEqual(response.status_code, code, response.data)
        return response.data.get("data", response.data)

    def decide(self, approval, staff=None, decision="approve", code=200, version=None):
        response = self.api("approvals/" + approval["id"] + "/decide", {
            "decision": decision, "note": "checked",
            "expected_version": approval["version"] if version is None else version},
            staff or self.approver)
        self.assertEqual(response.status_code, code, response.data)
        return response.data.get("data", response.data)

    def payment(self, event_id="rent"):
        return self.pending_payment(event_id, submit=False)

    def cny_quote(self, amount="1000.00", hold="5000.00"):
        if hold:
            self.hold("CNY", hold)
        return self.live("CNY", HOME, amount)

    def denial(self, response, code):
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data["detail"], code, response.data)
        return response.data.get("policy")


@override_settings(**FX_SETTINGS)
class TierMatrixTests(PolicyHarness, APITestCase):
    def test_payment_submit_requires_step_up_with_documented_body(self):
        payment = self.payment("rent")
        response = self.raw("payments/" + payment["id"] + "/submit")
        self.assertEqual(response.status_code, 403)
        body = dict(response.data)
        # docs/i18n.md: every error also carries `code` and a localized `message`.
        self.assertEqual(body.pop("code"), "STEP_UP_REQUIRED")
        self.assertTrue(body.pop("message"))
        self.assertEqual(body, {"detail": "STEP_UP_REQUIRED", "policy": {
            "action": "payment.submit", "tier": "T2", "target_id": payment["id"], "amount": "9000.00",
            "currency": "THB", "limits": THB_LIMITS, "usage": {"daily": "0.00", "monthly": "0.00"},
            "requires": ["step_up"]}})
        self.assertEqual(Payment.objects.get(pk=payment["id"]).status, "authorized")
        token = self.step_up("payment.submit", payment["id"], "9000.00")
        response = self.raw("payments/" + payment["id"] + "/submit", token=token)
        self.assertEqual(response.status_code, 201, response.data)
        stored = Payment.objects.get(pk=payment["id"])
        self.assertEqual(stored.status, "pending")
        self.assertIsNotNone(stored.submitted_at)
        self.assertIsNotNone(StepUpGrant.objects.get(owner=self.user).used_at)

    def test_conversion_requires_step_up(self):
        quote = self.cny_quote()
        body = self.convert_body(quote["id"], "1000.00")
        policy_body = self.denial(self.raw("conversions", body), "STEP_UP_REQUIRED")
        self.assertEqual((policy_body["action"], policy_body["target_id"], policy_body["amount"],
                          policy_body["currency"], policy_body["tier"]),
                         ("wallet.convert", quote["id"], "1000.00", "CNY", "T2"))
        self.assertEqual(CurrencyConversion.objects.count(), 0)
        token = self.step_up("wallet.convert", quote["id"], "1000.00", "CNY")
        self.assertEqual(self.raw("conversions", body, token=token).status_code, 201)

    def test_home_currency_conversion_uses_home_limits(self):
        quote = self.live(HOME, "CNY", "1000.00")
        policy_body = self.denial(self.raw("conversions", self.convert_body(quote["id"], "1000.00")),
                                  "STEP_UP_REQUIRED")
        self.assertEqual(policy_body["currency"], HOME)
        self.assertEqual(policy_body["limits"], THB_LIMITS)

    def test_tuition_over_per_transaction_limit_needs_approval(self):
        payment = self.payment("tuition")
        route = "payments/" + payment["id"] + "/submit"
        body = self.denial(self.raw(route), "APPROVAL_REQUIRED")
        self.assertEqual((body["tier"], body["requires"]), ("T3", ["step_up", "approval"]))
        token = self.step_up("payment.submit", payment["id"], "65000.00")
        self.denial(self.raw(route, token=token), "APPROVAL_REQUIRED")
        approval = self.ask("payment.submit", payment["id"], "65000.00")
        self.denial(self.raw(route, token=token), "APPROVAL_REQUIRED")  # still pending
        approved = self.decide(approval)
        self.assertEqual(approved["status"], "APPROVED")
        body = self.denial(self.raw(route), "STEP_UP_REQUIRED")
        self.assertEqual(body["tier"], "T3")
        self.assertEqual(self.raw(route, token=token).status_code, 201)
        used = ApprovalRequest.objects.get(pk=approval["id"])
        self.assertEqual((used.status, used.version), ("USED", 3))
        self.assertIsNotNone(used.used_at)

    def test_resubmitting_a_submitted_payment_is_not_an_outflow(self):
        payment = self.payment("rent")
        token = self.step_up("payment.submit", payment["id"], "9000.00")
        self.assertEqual(self.raw("payments/" + payment["id"] + "/submit", token=token).status_code, 201)
        # Nothing leaves the wallet again, so no second step-up is demanded.
        response = self.raw("payments/" + payment["id"] + "/submit")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["data"]["status"], "pending")

    def test_failed_command_does_not_burn_the_token(self):
        payment = self.payment("rent")
        Payment.objects.filter(pk=payment["id"]).update(authorized_until=timezone.now() - timedelta(seconds=1))
        token = self.step_up("payment.submit", payment["id"], "9000.00")
        self.assertEqual(self.raw("payments/" + payment["id"] + "/submit", token=token).status_code, 400)
        self.assertIsNone(StepUpGrant.objects.get(owner=self.user).used_at)
        Payment.objects.filter(pk=payment["id"]).update(authorized_until=timezone.now() + timedelta(minutes=5))
        self.assertEqual(self.raw("payments/" + payment["id"] + "/submit", token=token).status_code, 201)

    def test_agent_calls_are_capped_at_t1(self):
        payment = self.payment("rent")
        token = self.step_up("payment.submit", payment["id"], "9000.00")
        response = self.raw("payments/" + payment["id"] + "/submit", token=token, HTTP_X_STUDYFLOW_AGENT="w4")
        body = self.denial(response, "AGENT_TIER_EXCEEDED")
        self.assertEqual(body["tier"], "T2")
        self.assertIsNone(StepUpGrant.objects.get(owner=self.user).used_at)
        # T1 calls stay available to an agent.
        response = self.raw("fx-quotes", self.quote_body("USD"), HTTP_X_STUDYFLOW_AGENT="w4")
        self.assertEqual(response.status_code, 201, response.data)

    def test_replay_returns_stored_response_without_policy(self):
        quote = self.cny_quote()
        body = self.convert_body(quote["id"], "1000.00")
        token = self.step_up("wallet.convert", quote["id"], "1000.00", "CNY")
        first = self.raw("conversions", body, token=token, key="convert-policy")
        self.assertEqual(first.status_code, 201)
        replay = self.raw("conversions", body, key="convert-policy")
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.data, first.data)
        self.assertEqual(self.raw("conversions", body, key="convert-policy",
                                  HTTP_X_STUDYFLOW_AGENT="w4").status_code, 200)
        self.assertEqual(self.raw("conversions", {**body, "source_amount": "900.00"},
                                  key="convert-policy").status_code, 400)

    @override_settings(STUDYFLOW_READINESS_ENABLED=True)
    def test_denial_creates_policy_trace(self):
        from finance.copilot.models import ExplanationTrace

        payment = self.payment("rent")
        response = self.raw("payments/" + payment["id"] + "/submit")
        self.denial(response, "STEP_UP_REQUIRED")
        trace = ExplanationTrace.objects.get(owner=self.user, trace_id=response["X-StudyFlow-Trace-ID"])
        layer = trace.layers["policy"]
        self.assertEqual((layer["decision"], layer["http_status"]), ("BLOCKED", 403))
        self.assertEqual(layer["rules"]["detail"], "STEP_UP_REQUIRED")
        self.assertEqual(layer["rules"]["policy"]["action"], "payment.submit")

    def test_reads_and_t1_writes_need_no_step_up(self):
        self.assertEqual(self.read("conversions").status_code, 200)
        self.assertEqual(self.raw("fx-quotes", self.quote_body("USD")).status_code, 201)


@override_settings(**FX_SETTINGS)
class StepUpTokenTests(PolicyHarness, APITestCase):
    def setUp(self):
        super().setUp()
        self.quote = self.cny_quote()
        self.body = self.convert_body(self.quote["id"], "1000.00")

    def convert(self, token, body=None):
        return self.raw("conversions", body or self.body, token=token)

    def test_response_shape_and_audit(self):
        response = self.api("auth/step-up", {"password": PASSWORD, "action": "wallet.convert",
                                             "target_id": self.quote["id"], "amount": "1000", "currency": "CNY"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(set(response.data), {"token", "expires_in_seconds", "action", "target_id",
                                              "amount", "currency"})
        self.assertEqual((response.data["expires_in_seconds"], response.data["amount"]), (300, "1000.00"))
        grant = StepUpGrant.objects.get(owner=self.user)
        self.assertAlmostEqual((grant.expires_at - timezone.now()).total_seconds(), 300, delta=5)
        self.assertNotIn(grant.nonce, json.dumps(AuditEvent.objects.filter(owner=self.user)
                                                 .values_list("details", flat=True)[::1]))
        self.assertTrue(AuditEvent.objects.filter(owner=self.user, action="auth.step_up_granted").exists())

    def test_wrong_password_is_refused_and_audited(self):
        response = self.api("auth/step-up", {"password": "wrong", "action": "wallet.convert",
                                             "target_id": self.quote["id"], "amount": "1000.00",
                                             "currency": "CNY"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["detail"], "STEP_UP_FAILED")
        self.assertFalse(StepUpGrant.objects.exists())
        self.assertTrue(AuditEvent.objects.filter(owner=self.user, action="auth.step_up_failed").exists())

    def test_user_without_password_cannot_step_up(self):
        self.user.set_unusable_password()
        self.user.save()
        response = self.api("auth/step-up", {"password": "", "action": "wallet.convert",
                                             "target_id": self.quote["id"], "amount": "1000.00",
                                             "currency": "CNY"})
        self.assertEqual(response.status_code, 400)  # blank password is not even accepted
        response = self.api("auth/step-up", {"password": "anything", "action": "wallet.convert",
                                             "target_id": self.quote["id"], "amount": "1000.00",
                                             "currency": "CNY"})
        self.assertEqual((response.status_code, response.data["detail"]), (403, "STEP_UP_FAILED"))

    def test_target_must_belong_to_the_user_and_match(self):
        other_token = self.api("auth/step-up", {"password": PASSWORD, "action": "wallet.convert",
                                                "target_id": self.quote["id"], "amount": "1000.00",
                                                "currency": "CNY"}, user=self.other)
        self.assertEqual(other_token.status_code, 404)
        wrong_currency = self.api("auth/step-up", {"password": PASSWORD, "action": "wallet.convert",
                                                   "target_id": self.quote["id"], "amount": "1000.00",
                                                   "currency": "THB"})
        self.assertEqual(wrong_currency.status_code, 400)
        self.assertIn("POLICY_SUBJECT_MISMATCH", str(wrong_currency.data))
        payment = self.payment("rent")
        wrong_amount = self.api("auth/step-up", {"password": PASSWORD, "action": "payment.submit",
                                                 "target_id": payment["id"], "amount": "8999.99",
                                                 "currency": "THB"})
        self.assertEqual(wrong_amount.status_code, 400)
        # agent.confirm is cleared through the underlying action, never requested directly.
        reserved = self.api("auth/step-up", {"password": PASSWORD, "action": "agent.confirm",
                                             "target_id": str(uuid4()), "amount": "10.00", "currency": "THB"})
        self.assertEqual(reserved.status_code, 400)
        self.assertIn("ACTION_NOT_AVAILABLE", str(reserved.data))
        missing_order = self.api("auth/step-up", {"password": PASSWORD, "action": "remittance.submit",
                                                  "target_id": str(uuid4()), "amount": "10.00",
                                                  "currency": "THB"})
        self.assertEqual(missing_order.status_code, 404)

    def test_forged_tokens_are_invalid(self):
        good = self.step_up("wallet.convert", self.quote["id"], "1000.00", "CNY")
        nonce = StepUpGrant.objects.get(owner=self.user).nonce
        session = self.user.get_session_auth_hash()
        forged = [
            "not-a-token",
            good[:-2] + ("AA" if not good.endswith("AA") else "BB"),
            signing.dumps({"n": nonce, "u": self.user.pk, "h": session}, salt="other-salt"),
            signing.dumps({"n": nonce, "u": self.user.pk, "h": session}, salt="studyflow-step-up-v1",
                          key="x" * 50),
            signing.dumps({"n": "unknown", "u": self.user.pk, "h": session}, salt="studyflow-step-up-v1"),
            signing.dumps({"n": nonce, "u": self.user.pk, "h": "0" * 64}, salt="studyflow-step-up-v1"),
            signing.dumps(["n", nonce], salt="studyflow-step-up-v1"),
        ]
        for token in forged:
            with self.subTest(token=token[:20]):
                self.denial(self.convert(token), "STEP_UP_INVALID")
        self.assertEqual(self.convert(good).status_code, 201)

    def test_token_of_another_user_is_invalid(self):
        token = self.step_up("wallet.convert", self.quote["id"], "1000.00", "CNY")
        subject = policy.Subject("wallet.convert", self.quote["id"], Decimal("1000.00"), "CNY")
        with transaction.atomic():
            self.assertIsNone(policy.redeemable_grant(self.other, token, subject))
            self.assertIsNotNone(policy.redeemable_grant(self.user, token, subject))

    def test_expired_token_is_invalid(self):
        token = self.step_up("wallet.convert", self.quote["id"], "1000.00", "CNY")
        later = FrozenTime(signing.time.time() + 301)
        with patch.object(signing, "time", later):
            self.denial(self.convert(token), "STEP_UP_INVALID")
        StepUpGrant.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.denial(self.convert(token), "STEP_UP_INVALID")

    def test_token_bound_to_amount_and_target(self):
        token = self.step_up("wallet.convert", self.quote["id"], "1000.00", "CNY")
        other_quote = self.live("CNY", HOME, "1000.00")
        self.denial(self.convert(token, self.convert_body(other_quote["id"], "1000.00")), "STEP_UP_INVALID")
        self.denial(self.convert(token, self.convert_body(self.quote["id"], "999.00")), "STEP_UP_INVALID")
        payment = self.payment("rent")
        self.denial(self.raw("payments/" + payment["id"] + "/submit", token=token), "STEP_UP_INVALID")
        self.assertEqual(self.convert(token, self.convert_body(self.quote["id"], "1000.00")).status_code, 201)

    def test_token_is_single_use(self):
        token = self.step_up("wallet.convert", self.quote["id"], "1000.00", "CNY")
        self.assertEqual(self.convert(token).status_code, 201)
        self.denial(self.convert(token), "STEP_UP_INVALID")

    def test_password_change_invalidates_tokens(self):
        token = self.step_up("wallet.convert", self.quote["id"], "1000.00", "CNY")
        user = get_user_model().objects.get(pk=self.user.pk)
        user.set_password("a-new-password-2")
        user.save()
        self.denial(self.convert(token), "STEP_UP_INVALID")
        self.user = user
        fresh = self.step_up("wallet.convert", self.quote["id"], "1000.00", "CNY", password="a-new-password-2")
        self.assertEqual(self.convert(fresh).status_code, 201)


class FrozenTime:
    def __init__(self, value):
        self.value = value

    def time(self):
        return self.value


@override_settings(**FX_SETTINGS)
class ApprovalTests(PolicyHarness, APITestCase):
    def setUp(self):
        super().setUp()
        self.tuition = self.payment("tuition")

    def test_lifecycle_and_visibility(self):
        approval = self.ask("payment.submit", self.tuition["id"], "65000.00")
        self.assertEqual((approval["status"], approval["requested_by"], approval["version"]),
                         ("PENDING", self.user.pk, 1))
        stored = ApprovalRequest.objects.get(pk=approval["id"])
        self.assertAlmostEqual((stored.expires_at - timezone.now()).total_seconds(), 86400, delta=10)
        self.ask("payment.submit", self.tuition["id"], "65000.00", code=409)
        self.assertEqual(self.read("approvals/" + approval["id"], user=self.other).status_code, 404)
        self.assertEqual(self.read("approvals", user=self.other).data["count"], 0)
        self.assertEqual(self.read("approvals", user=self.approver).data["count"], 1)
        self.assertEqual(self.read("approvals/" + approval["id"], user=self.approver).status_code, 200)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get("/api/v2/approvals/", {"status": "PENDING"}).data["count"], 1)
        self.assertEqual(self.client.get("/api/v2/approvals/", {"status": "USED"}).data["count"], 0)
        decided = self.decide(approval)
        self.assertEqual((decided["status"], decided["decided_by"], decided["version"]),
                         ("APPROVED", self.approver.pk, 2))
        self.decide(approval, version=2, code=409)  # no longer pending
        self.ask("payment.submit", self.tuition["id"], "65000.00", code=409)  # approved one is still open
        self.assertTrue(AuditEvent.objects.filter(action="approval.approved", entity_id=approval["id"]).exists())

    def test_request_must_match_the_target(self):
        self.ask("payment.submit", self.tuition["id"], "60000.00", code=400)
        self.ask("payment.submit", self.tuition["id"], "65000.00", currency="USD", code=400)
        self.ask("payment.submit", self.tuition["id"], "65000.00", user=self.other, code=404)
        self.ask("payment.submit", uuid4(), "65000.00", code=404)
        self.ask("remittance.submit", uuid4(), "65000.00", code=404)
        self.ask("agent.confirm", uuid4(), "65000.00", code=400)

    def test_only_staff_decide_and_stale_version_conflicts(self):
        approval = self.ask("payment.submit", self.tuition["id"], "65000.00")
        response = self.api("approvals/" + approval["id"] + "/decide",
                            {"decision": "approve", "expected_version": 1}, self.user)
        self.assertEqual(response.status_code, 403)
        self.decide(approval, version=2, code=409)
        self.assertEqual(ApprovalRequest.objects.get(pk=approval["id"]).status, "PENDING")

    def test_beneficiary_verifier_cannot_decide(self):
        approval = self.ask("payment.submit", self.tuition["id"], "65000.00")
        response = self.api("approvals/" + approval["id"] + "/decide",
                            {"decision": "approve", "expected_version": 1}, self.operator)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["detail"], "SEPARATION_OF_DUTIES")
        # The latest verification counts: once the approver re-verifies, the original operator may decide.
        self.post("beneficiaries/" + str(self.tuition["beneficiary"]) + "/verify", {"verified": True},
                  user=self.approver)
        self.decide(approval, staff=self.approver, code=403)
        self.assertEqual(self.decide(approval, staff=self.operator)["status"], "APPROVED")

    def test_staff_cannot_decide_their_own_request(self):
        target = uuid4()
        own = ApprovalRequest.objects.create(
            owner=self.approver, requested_by=self.approver, action="wallet.convert", target_id=target,
            amount=Decimal("1.00"), currency="CNY", reason="x", expires_at=timezone.now() + timedelta(hours=1))
        record = {"id": str(own.pk), "version": 1}
        response = self.api("approvals/" + record["id"] + "/decide",
                            {"decision": "approve", "expected_version": 1}, self.approver)
        self.assertEqual((response.status_code, response.data["detail"]), (403, "SEPARATION_OF_DUTIES"))
        owned = ApprovalRequest.objects.create(
            owner=self.approver, requested_by=self.operator, action="wallet.convert", target_id=uuid4(),
            amount=Decimal("1.00"), currency="CNY", reason="x", expires_at=timezone.now() + timedelta(hours=1))
        self.decide({"id": str(owned.pk), "version": 1}, staff=self.approver, code=403)
        self.assertEqual(self.decide({"id": str(owned.pk), "version": 1}, staff=self.other_staff())["status"],
                         "APPROVED")

    def other_staff(self):
        return get_user_model().objects.create_user(username="policy-third-operator", is_staff=True)

    def test_database_rejects_requester_as_decider(self):
        approval = ApprovalRequest.objects.get(pk=self.ask("payment.submit", self.tuition["id"], "65000.00")["id"])
        with self.assertRaises(IntegrityError), transaction.atomic():
            ApprovalRequest.objects.filter(pk=approval.pk).update(decided_by=self.user)

    def test_rejected_approval_does_not_authorize_and_can_be_requested_again(self):
        approval = self.ask("payment.submit", self.tuition["id"], "65000.00")
        self.assertEqual(self.decide(approval, decision="reject")["status"], "REJECTED")
        token = self.step_up("payment.submit", self.tuition["id"], "65000.00")
        self.denial(self.raw("payments/" + self.tuition["id"] + "/submit", token=token), "APPROVAL_REQUIRED")
        again = self.ask("payment.submit", self.tuition["id"], "65000.00")
        self.decide(again)
        self.assertEqual(self.raw("payments/" + self.tuition["id"] + "/submit", token=token).status_code, 201)

    def test_expired_approvals(self):
        pending = self.ask("payment.submit", self.tuition["id"], "65000.00")
        ApprovalRequest.objects.filter(pk=pending["id"]).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.decide(pending, code=409)
        self.assertEqual(ApprovalRequest.objects.get(pk=pending["id"]).status, "EXPIRED")
        approved = self.decide(self.ask("payment.submit", self.tuition["id"], "65000.00"))
        ApprovalRequest.objects.filter(pk=approved["id"]).update(expires_at=timezone.now() - timedelta(seconds=1))
        token = self.step_up("payment.submit", self.tuition["id"], "65000.00")
        self.denial(self.raw("payments/" + self.tuition["id"] + "/submit", token=token), "APPROVAL_REQUIRED")
        self.assertEqual(self.read("approvals/" + approved["id"]).data["data"]["status"], "EXPIRED")
        self.decide(self.ask("payment.submit", self.tuition["id"], "65000.00"))
        self.assertEqual(self.raw("payments/" + self.tuition["id"] + "/submit", token=token).status_code, 201)

    def test_used_approval_cannot_be_reused(self):
        approval = self.decide(self.ask("payment.submit", self.tuition["id"], "65000.00"))
        token = self.step_up("payment.submit", self.tuition["id"], "65000.00")
        self.assertEqual(self.raw("payments/" + self.tuition["id"] + "/submit", token=token).status_code, 201)
        self.assertEqual(ApprovalRequest.objects.get(pk=approval["id"]).status, "USED")
        # Even if the same target became submittable again, the used approval no longer matches.
        Payment.objects.filter(pk=self.tuition["id"]).update(status="authorized", submitted_at=None)
        token = self.step_up("payment.submit", self.tuition["id"], "65000.00")
        self.denial(self.raw("payments/" + self.tuition["id"] + "/submit", token=token), "APPROVAL_REQUIRED")


@override_settings(**FX_SETTINGS)
class LimitAndUsageTests(PolicyHarness, APITestCase):
    def submit(self, payment, amount):
        token = self.step_up("payment.submit", payment["id"], amount)
        response = self.raw("payments/" + payment["id"] + "/submit", token=token)
        self.assertEqual(response.status_code, 201, response.data)

    def convert_cny(self, amount, code=201):
        quote = self.live("CNY", HOME, amount)
        token = self.step_up("wallet.convert", quote["id"], amount, "CNY")
        response = self.raw("conversions", self.convert_body(quote["id"], amount), token=token)
        self.assertEqual(response.status_code, code, response.data)
        return response

    def test_daily_limit_accumulates_per_currency(self):
        PolicyLimit.objects.filter(currency="CNY").update(per_transaction=1000, daily=1500, monthly=2000)
        self.hold("CNY", "5000.00")
        self.convert_cny("800.00")
        body = self.denial(self.convert_cny("800.00", code=403), "APPROVAL_REQUIRED")
        self.assertEqual(body["usage"], {"daily": "800.00", "monthly": "800.00"})
        self.assertEqual(body["limits"], {"per_transaction": "1000.00", "daily": "1500.00", "monthly": "2000.00"})
        # CNY spending does not touch the THB allowance, and the THB credit leg is not an outflow.
        rent = self.payment("rent")
        body = self.denial(self.raw("payments/" + rent["id"] + "/submit"), "STEP_UP_REQUIRED")
        self.assertEqual(body["usage"], {"daily": "0.00", "monthly": "0.00"})
        self.convert_cny("700.00")  # exactly at the daily limit is allowed

    def test_limits_view_reports_effective_limits_and_usage(self):
        PolicyLimit.objects.filter(currency="CNY").update(per_transaction=1000, daily=1500, monthly=2000)
        self.hold("CNY", "5000.00")
        self.convert_cny("800.00")
        response = self.read("policy/limits")
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["data"]
        self.assertEqual((data["credit_level"], data["limit_multiplier"], data["window_zone"], data["is_simulated"]),
                         ("BUILDING", "1.0", "Asia/Bangkok", True))
        cny = next(row for row in data["limits"] if row["currency"] == "CNY")
        self.assertEqual(cny["base"], {"per_transaction": "1000.00", "daily": "1500.00", "monthly": "2000.00"})
        self.assertEqual(cny["effective"], cny["base"])
        self.assertEqual(cny["usage"], {"daily": "800.00", "monthly": "800.00"})
        with patch("finance.credit.profile", return_value={"level": "GOOD", "limit_multiplier": "1.5"}):
            rows = self.read("policy/limits").data["data"]["limits"]
        cny = next(row for row in rows if row["currency"] == "CNY")
        self.assertEqual(cny["effective"], {"per_transaction": "1500.00", "daily": "2250.00", "monthly": "3000.00"})
        PolicyLimit.objects.filter(currency="CNY").update(enabled=False)
        self.assertNotIn("CNY", [row["currency"] for row in self.read("policy/limits").data["data"]["limits"]])
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/v2/policy/limits/").status_code, (401, 403))

    def test_payments_and_debits_count_toward_home_usage(self):
        rent = self.payment("rent")
        self.submit(rent, "9000.00")
        self.assertEqual(policy.usage(self.user, HOME)["daily"], Decimal("9000.00"))
        self.settle(rent)  # the settlement debit is the same outflow, not counted twice
        self.assertEqual(policy.usage(self.user, HOME)["daily"], Decimal("9000.00"))
        quote = self.live(HOME, "CNY", "1000.00")
        self.convert(quote["id"], "1000.00")
        self.assertEqual(policy.usage(self.user, HOME)["daily"], Decimal("10000.00"))
        self.assertEqual(policy.usage(self.user, "CNY")["daily"], Decimal("0"))

    def test_failed_and_cancelled_payments_do_not_count(self):
        rent = self.payment("rent")
        self.submit(rent, "9000.00")
        self.post("payments/" + rent["id"] + "/adapter-event", {"outcome": "failed"}, operator=True)
        self.assertEqual(policy.usage(self.user, HOME)["daily"], Decimal("0"))

    def test_daily_and_monthly_windows_follow_bangkok_time(self):
        rent = self.payment("rent")
        self.submit(rent, "9000.00")
        # 23:30 on 15 Oct in Bangkok is 16:30 UTC the same day.
        submitted = datetime(2026, 10, 15, 16, 30, tzinfo=UTC)
        Payment.objects.filter(pk=rent["id"]).update(submitted_at=submitted)
        just_after_midnight = submitted + timedelta(hours=1)  # 00:30 on 16 Oct in Bangkok, still 15 Oct UTC
        self.assertEqual(policy.usage(self.user, HOME, just_after_midnight),
                         {"daily": Decimal("0"), "monthly": Decimal("9000.00")})
        self.assertEqual(policy.usage(self.user, HOME, submitted + timedelta(minutes=10))["daily"],
                         Decimal("9000.00"))
        next_month = datetime(2026, 10, 31, 17, 30, tzinfo=UTC)  # 1 Nov 00:30 Bangkok
        self.assertEqual(policy.usage(self.user, HOME, next_month),
                         {"daily": Decimal("0"), "monthly": Decimal("0")})

    def test_monthly_limit(self):
        PolicyLimit.objects.filter(currency=HOME).update(per_transaction=10000, daily=10000, monthly=12000)
        rent = self.payment("rent")
        # An earlier outflow this month (outside today's window) counts toward the month only.
        day, month = policy.window_starts()
        earlier = self.payment("tuition")
        Payment.objects.filter(pk=earlier["id"]).update(
            status="pending", submitted_at=max(month, day - timedelta(hours=1)), amount=Decimal("5000.00"))
        body = self.denial(self.raw("payments/" + rent["id"] + "/submit"), "APPROVAL_REQUIRED")
        self.assertEqual(body["usage"]["monthly"], "5000.00")
        self.assertEqual(body["usage"]["daily"], "5000.00" if day == month else "0.00")

    def test_missing_or_disabled_limit_is_t3(self):
        self.hold("CNY", "5000.00")
        PolicyLimit.objects.filter(currency="CNY").update(enabled=False)
        quote = self.live("CNY", HOME, "200.00")
        body = self.denial(self.raw("conversions", self.convert_body(quote["id"], "200.00")),
                           "APPROVAL_REQUIRED")
        self.assertEqual((body["tier"], body["limits"]), ("T3", None))
        PolicyLimit.objects.filter(currency="CNY").delete()
        token = self.step_up("wallet.convert", quote["id"], "200.00", "CNY")
        self.denial(self.raw("conversions", self.convert_body(quote["id"], "200.00"), token=token),
                    "APPROVAL_REQUIRED")
        self.decide(self.ask("wallet.convert", quote["id"], "200.00", "CNY"))
        response = self.raw("conversions", self.convert_body(quote["id"], "200.00"), token=token)
        self.assertEqual(response.status_code, 201, response.data)

    def test_credit_multiplier_scales_limits(self):
        rent = self.payment("tuition")
        with patch("finance.policy.limit_multiplier", return_value=Decimal("2")):
            body = self.denial(self.raw("payments/" + rent["id"] + "/submit"), "STEP_UP_REQUIRED")
        self.assertEqual(body["tier"], "T2")
        self.assertEqual(body["limits"], {"per_transaction": "100000.00", "daily": "200000.00",
                                          "monthly": "600000.00"})

    def test_ensure_default_limits_keeps_edited_rows(self):
        PolicyLimit.objects.filter(currency="USD").update(per_transaction=10, daily=20, monthly=30)
        PolicyLimit.objects.filter(currency="EUR").delete()
        from finance.policy_defaults import ensure_default_limits
        ensure_default_limits()
        self.assertEqual(PolicyLimit.objects.get(currency="USD").per_transaction, Decimal("10.00"))
        self.assertEqual(PolicyLimit.objects.get(currency="EUR").per_transaction, Decimal("1400.00"))


class RepaymentPolicyTests(LendingHarness, APITestCase):
    def raw(self, path, data, token=None):
        self.client.force_authenticate(self.student)
        extra = {"HTTP_X_STEP_UP_TOKEN": token} if token else {}
        return self.client.post("/api/v2/" + path + "/", data, format="json",
                                HTTP_IDEMPOTENCY_KEY=str(uuid4()), **extra)

    def test_repayment_requires_step_up_for_named_installment(self):
        _, _, _, account = self.fund()
        self.post("demo/clock", {"date": "2026-11-01"})
        route = "loan-accounts/" + account["id"] + "/repay"
        body = {"expected_version": 1, "installment_number": 1}
        response = self.raw(route, body)
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual((response.data["detail"], response.data["policy"]["action"],
                          response.data["policy"]["target_id"], response.data["policy"]["amount"]),
                         ("STEP_UP_REQUIRED", "loan.repay", account["id"], "2550.00"))
        self.client.force_authenticate(self.student)
        token = self.client.post("/api/v2/auth/step-up/", {
            "password": "merge-student-pass-1", "action": "loan.repay", "target_id": account["id"],
            "amount": "2550.00", "currency": "THB"}, format="json").data["token"]
        self.assertEqual(self.raw(route, body, token=token).status_code, 201)
        # A paid installment is no outflow: the handler answers, not the policy.
        self.assertEqual(self.raw(route, body).status_code, 409)


class AuthTokenTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(username="token-user", password="token-pass-1")

    def test_password_exchange(self):
        response = self.client.post("/api/v2/auth/token/", {"username": "token-user",
                                                            "password": "token-pass-1"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["token"], Token.objects.get(user=self.user).key)
        again = self.client.post("/api/v2/auth/token/", {"username": "token-user",
                                                         "password": "token-pass-1"}, format="json")
        self.assertEqual(again.data["token"], response.data["token"])
        bad = self.client.post("/api/v2/auth/token/", {"username": "token-user", "password": "nope"},
                               format="json")
        self.assertEqual(bad.status_code, 400)

    @rates(auth="2/min")
    def test_token_endpoint_is_throttled(self):
        codes = [self.client.post("/api/v2/auth/token/", {"username": "token-user", "password": "x"},
                                  format="json").status_code for _ in range(3)]
        self.assertEqual(codes, [400, 400, 429])
        spoofed = self.client.post("/api/v2/auth/token/", {"username": "token-user", "password": "x"},
                                   format="json", HTTP_X_FORWARDED_FOR="203.0.113.9")
        self.assertEqual(spoofed.status_code, 429)  # a client-chosen X-Forwarded-For is not trusted


@override_settings(**FX_SETTINGS)
class ThrottleTests(PolicyHarness, APITestCase):
    @rates(step_up="2/min")
    def test_step_up_is_throttled_per_user(self):
        quote = self.cny_quote()
        body = {"password": "wrong", "action": "wallet.convert", "target_id": quote["id"],
                "amount": "1000.00", "currency": "CNY"}
        codes = [self.api("auth/step-up", body).status_code for _ in range(3)]
        self.assertEqual(codes, [403, 403, 429])
        self.assertEqual(self.api("auth/step-up", {**body, "password": PASSWORD}).status_code, 429)

    @rates(money="1/min")
    def test_t2_routes_share_the_money_scope(self):
        rent = self.payment("rent")
        self.assertEqual(self.raw("payments/" + rent["id"] + "/submit").status_code, 403)
        quote = self.cny_quote()
        self.assertEqual(self.raw("conversions", self.convert_body(quote["id"], "1000.00")).status_code, 429)
        self.assertEqual(self.read("conversions").status_code, 200)  # reads are not money calls

    @rates(sponsor="1/min")
    def test_sponsor_confirmation_is_throttled_by_ip(self):
        self.client.force_authenticate(None)
        first = self.client.get("/api/v2/sponsor-confirmation/", HTTP_X_SPONSOR_TOKEN="x")
        second = self.client.get("/api/v2/sponsor-confirmation/", HTTP_X_SPONSOR_TOKEN="x")
        self.assertNotEqual(first.status_code, 429)
        self.assertEqual(second.status_code, 429)

    def test_health_is_not_throttled(self):
        with rates(anon="1/min"):
            self.assertEqual([self.client.get("/health/").status_code for _ in range(3)], [200] * 3)


class DeploymentSettingsTests(SimpleTestCase):
    def run_python(self, args, **env):
        environ = {**os.environ, "DJANGO_SECRET_KEY": secrets.token_urlsafe(64), "DJANGO_DEBUG": "False",
                   "DJANGO_SECURE": "false", **env}
        return subprocess.run([sys.executable, *args], cwd=ROOT, env=environ, capture_output=True, text=True,
                              timeout=120)

    def test_check_deploy_passes_only_when_secure(self):
        secure = self.run_python(["manage.py", "check", "--deploy", "--fail-level", "WARNING"],
                                 DJANGO_SECURE="true")
        self.assertEqual(secure.returncode, 0, secure.stdout + secure.stderr)
        insecure = self.run_python(["manage.py", "check", "--deploy", "--fail-level", "WARNING"],
                                   DJANGO_SECURE="false")
        self.assertNotEqual(insecure.returncode, 0)

    def test_secure_settings_and_throttle_overrides(self):
        script = ("import json,django,os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');"
                  "django.setup();from django.conf import settings as s;print(json.dumps({k:getattr(s,k,None) "
                  "for k in ['SECURE_SSL_REDIRECT','SECURE_HSTS_SECONDS','SECURE_HSTS_PRELOAD',"
                  "'SESSION_COOKIE_SECURE','CSRF_COOKIE_SECURE','SESSION_COOKIE_AGE','SECURE_PROXY_SSL_HEADER',"
                  "'CSRF_TRUSTED_ORIGINS','X_FRAME_OPTIONS','SECURE_REFERRER_POLICY','STUDYFLOW_THROTTLE_RATES',"
                  "'CACHES']}))")
        result = self.run_python(["-c", script], DJANGO_SECURE="true", DJANGO_SECURE_PROXY_SSL_HEADER="true",
                                 DJANGO_CSRF_TRUSTED_ORIGINS="https://studyflow.example",
                                 STUDYFLOW_THROTTLE_STEP_UP="3/hour")
        self.assertEqual(result.returncode, 0, result.stderr)
        values = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(values["SECURE_SSL_REDIRECT"], True)
        self.assertEqual(values["SECURE_HSTS_SECONDS"], 3600)
        self.assertEqual(values["SECURE_HSTS_PRELOAD"], False)
        self.assertEqual((values["SESSION_COOKIE_SECURE"], values["CSRF_COOKIE_SECURE"]), (True, True))
        self.assertEqual(values["SESSION_COOKIE_AGE"], 8 * 3600)
        self.assertEqual(values["SECURE_PROXY_SSL_HEADER"], ["HTTP_X_FORWARDED_PROTO", "https"])
        self.assertEqual(values["CSRF_TRUSTED_ORIGINS"], ["https://studyflow.example"])
        self.assertEqual((values["X_FRAME_OPTIONS"], values["SECURE_REFERRER_POLICY"]), ("DENY", "same-origin"))
        self.assertEqual(values["STUDYFLOW_THROTTLE_RATES"]["step_up"], "3/hour")
        self.assertEqual(values["STUDYFLOW_THROTTLE_RATES"]["auth"], "10/min")
        self.assertEqual(values["CACHES"]["default"]["LOCATION"], "studyflow_cache")

    def test_invalid_throttle_rate_fails_startup(self):
        result = self.run_python(["manage.py", "check"], STUDYFLOW_THROTTLE_MONEY="lots")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid throttle rate", result.stderr)


@override_settings(**FX_SETTINGS, STUDYFLOW_SIMULATED_APPROVAL_SECONDS=10)
class SimulatedApprovalTests(PolicyHarness, APITestCase):
    """Demo: approvals/<id>/simulate/ lets a simulated operator approve the student's own request after a wait."""

    def setUp(self):
        super().setUp()
        self.tuition = self.payment("tuition")

    def test_reason_is_optional(self):
        response = self.api("approvals", {"action": "payment.submit", "target_id": self.tuition["id"],
                                          "amount": "65000.00", "currency": HOME}, None)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["data"]["reason"], "")

    def test_waits_then_a_simulated_operator_approves_and_the_password_still_applies(self):
        approval = self.ask("payment.submit", self.tuition["id"], "65000.00")
        self.assertEqual(approval["simulated_after_seconds"], 10)
        early = self.api("approvals/" + approval["id"] + "/simulate", {})
        self.assertEqual((early.status_code, early.data["detail"]), (409, "APPROVAL_STILL_IN_REVIEW"))
        ApprovalRequest.objects.filter(pk=approval["id"]).update(created_at=timezone.now() - timedelta(seconds=11))
        self.assertEqual(self.read("approvals/" + approval["id"], user=self.other).status_code, 404)
        self.assertEqual(self.api("approvals/" + approval["id"] + "/simulate", {}, self.other).status_code, 404)
        done = self.api("approvals/" + approval["id"] + "/simulate", {})
        self.assertEqual(done.status_code, 200, done.data)
        stored = ApprovalRequest.objects.get(pk=approval["id"])
        self.assertEqual(stored.status, "APPROVED")
        self.assertNotIn(stored.decided_by_id, (self.user.pk, None))
        self.assertTrue(stored.decided_by.is_staff and not stored.decided_by.has_usable_password())
        self.assertEqual(self.api("approvals/" + approval["id"] + "/simulate", {}).status_code, 409)
        route = "payments/" + self.tuition["id"] + "/submit"
        self.denial(self.raw(route), "STEP_UP_REQUIRED")
        token = self.step_up("payment.submit", self.tuition["id"], "65000.00")
        self.assertEqual(self.raw(route, token=token).status_code, 201)

    @override_settings(STUDYFLOW_SIMULATED_APPROVAL_SECONDS=0)
    def test_can_be_turned_off(self):
        approval = self.ask("payment.submit", self.tuition["id"], "65000.00")
        self.assertEqual(approval["simulated_after_seconds"], 0)
        self.denial(self.api("approvals/" + approval["id"] + "/simulate", {}), "APPROVAL_SIMULATION_OFF")
        self.assertEqual(ApprovalRequest.objects.get(pk=approval["id"]).status, "PENDING")
