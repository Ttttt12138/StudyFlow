import subprocess
import sys
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from auto_test.test_multicurrency import FX_SETTINGS
from auto_test.test_remittance import RemittanceHarness
from finance.i18n import localize

ROOT = Path(settings.BASE_DIR)


def has_cjk(text):
    return any("一" <= ch <= "鿿" for ch in text)


class CatalogTests(SimpleTestCase):
    def test_catalogs_match_code_and_are_compiled(self):
        result = subprocess.run([sys.executable, "scripts/i18n_messages.py", "check"], cwd=ROOT,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_unknown_code_falls_back_to_readable_text(self):
        self.assertEqual(localize("SOMETHING_NEW_HAPPENED"), "Something new happened.")


@override_settings(**FX_SETTINGS)
class LocalizedErrorTests(RemittanceHarness, APITestCase):
    def setUp(self):
        self.bootstrap()

    def manual_quote(self):
        return self.post("fx-quotes", {"source_currency": "CNY", "rate": "4.6", "sender_fee": "0",
                                       "receiver_fee": "0", "settlement_days": 1,
                                       "expires_at": (timezone.now() + timedelta(hours=1)).isoformat()})

    def order_error(self, language):
        quote = self.manual_quote()
        self.client.force_authenticate(self.user)
        return self.client.post("/api/v2/remittance-orders/", {
            "quote_id": quote["id"], "recipient": "SELF", "purpose": "other"}, format="json",
            HTTP_IDEMPOTENCY_KEY=quote["id"] + language, HTTP_ACCEPT_LANGUAGE=language)

    def test_code_is_stable_and_message_follows_language(self):
        zh = self.order_error("zh-Hans")
        en = self.order_error("en")
        for response in (zh, en):
            self.assertEqual(response.status_code, 400)
            self.assertIn("QUOTE_NOT_EXECUTABLE", str(response.data["detail"]))
            self.assertEqual(response.data["code"], "QUOTE_NOT_EXECUTABLE")
        self.assertTrue(has_cjk(zh.data["message"]), zh.data["message"])
        self.assertFalse(has_cjk(en.data["message"]))
        self.assertNotEqual(en.data["message"], "QUOTE_NOT_EXECUTABLE")
        self.assertEqual(zh["Content-Language"], "zh-hans")
        self.assertEqual(en["Content-Language"], "en")

    def test_unsupported_language_falls_back_to_english(self):
        response = self.order_error("fr")
        self.assertFalse(has_cjk(response.data["message"]))
        self.assertEqual(response["Content-Language"], "en")

    def test_legacy_sentence_and_version_conflict_are_translated(self):
        live = self.live_quote("CNY", "THB", "1000.00")
        self.fund_foreign("CNY", "2000.00")
        order = self.post("remittance-orders", {"quote_id": live["id"], "recipient": "SELF", "purpose": "other"})
        self.client.force_authenticate(self.user)
        stale = self.client.post(f"/api/v2/remittance-orders/{order['id']}/cancel/", {"expected_version": 9},
                                 format="json", HTTP_IDEMPOTENCY_KEY="stale-zh", HTTP_ACCEPT_LANGUAGE="zh-CN")
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.data["code"], "stale_version")
        self.assertTrue(has_cjk(stale.data["message"]))
        missing_key = self.client.post(f"/api/v2/remittance-orders/{order['id']}/cancel/",
                                       {"expected_version": 1}, format="json", HTTP_ACCEPT_LANGUAGE="zh")
        self.assertEqual(missing_key.status_code, 400)
        self.assertTrue(has_cjk(missing_key.data["message"]))
        self.assertIn("Idempotency-Key", str(missing_key.data["detail"]))

    def test_policy_denial_keeps_policy_body(self):
        live = self.live_quote("CNY", "THB", "1000.00")
        self.fund_foreign("CNY", "2000.00")
        order = self.post("remittance-orders", {"quote_id": live["id"], "recipient": "SELF", "purpose": "other"})
        self.client.force_authenticate(self.user)
        denied = self.client.post(f"/api/v2/remittance-orders/{order['id']}/submit/", {"expected_version": 1},
                                  format="json", HTTP_IDEMPOTENCY_KEY="deny", HTTP_ACCEPT_LANGUAGE="zh")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.data["detail"], "STEP_UP_REQUIRED")
        self.assertEqual(denied.data["policy"]["action"], "remittance.submit")
        self.assertTrue(has_cjk(denied.data["message"]))

    def test_field_errors_keep_drf_shape(self):
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/v2/remittance-orders/", {"recipient": "SELF"}, format="json",
                                    HTTP_IDEMPOTENCY_KEY="fields", HTTP_ACCEPT_LANGUAGE="zh")
        self.assertEqual(response.status_code, 400)
        self.assertIn("quote_id", response.data)
        self.assertNotIn("message", response.data)

    def test_agent_session_language_follows_accept_language(self):
        self.client.force_authenticate(self.user)
        zh = self.client.post("/api/v2/agent/sessions/", {"goal": "我的余额还有多少"}, format="json",
                              HTTP_IDEMPOTENCY_KEY="agent-zh", HTTP_ACCEPT_LANGUAGE="zh-Hans")
        en = self.client.post("/api/v2/agent/sessions/", {"goal": "What is my balance?"}, format="json",
                              HTTP_IDEMPOTENCY_KEY="agent-en", HTTP_ACCEPT_LANGUAGE="en-US")
        self.assertEqual(zh.data["data"]["locale"], "zh")
        self.assertEqual(en.data["data"]["locale"], "en")
        self.assertTrue(has_cjk(zh.data["data"]["final_answer"]))
        self.assertFalse(has_cjk(en.data["data"]["final_answer"]))


class HandlerUnitTests(SimpleTestCase):
    def test_list_wrapped_detail_is_supported(self):
        from finance.i18n import exception_handler

        response = exception_handler(ValidationError({"detail": ["QUOTE_EXPIRED"]}), {})
        self.assertEqual(response.data["code"], "QUOTE_EXPIRED")
        self.assertTrue(response.data["message"])
