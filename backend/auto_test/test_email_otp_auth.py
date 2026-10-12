import re

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    STUDYFLOW_OTP_RESEND_SECONDS=0,
)
class EmailOtpAuthTests(TestCase):
    password = "Correct-Horse-Battery-42"

    def setUp(self):
        self.client = APIClient()

    def request_code(self, email, purpose):
        response = self.client.post("/api/auth/otp/request/", {"email": email, "purpose": purpose}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)

    def test_sign_up_verifies_email_creates_user_and_session(self):
        email = "new.student@example.com"
        code = self.request_code(email, "sign_up")
        response = self.client.post("/api/auth/otp/verify/", {
            "email": email, "purpose": "sign_up", "code": code,
            "full_name": "New Student", "password": self.password,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        user = get_user_model().objects.get(email=email)
        self.assertTrue(user.check_password(self.password))
        self.assertEqual(user.first_name, "New")
        self.assertTrue(self.client.get("/api/auth/session/").data["authenticated"])
        reused = self.client.post("/api/auth/otp/verify/", {
            "email": email, "purpose": "sign_up", "code": code,
            "full_name": "New Student", "password": self.password,
        }, format="json")
        self.assertEqual(reused.status_code, 400)

    def test_sign_in_is_passwordless_and_starts_session(self):
        email = "returning.student@example.com"
        get_user_model().objects.create_user(username="returning", email=email, password=self.password)
        code = self.request_code(email, "sign_in")
        response = self.client.post("/api/auth/otp/verify/", {
            "email": email, "purpose": "sign_in", "code": code,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(self.client.get("/api/auth/session/").data["authenticated"])
    def test_password_reset_changes_password_and_starts_session(self):
        email = "reset.student@example.com"
        user = get_user_model().objects.create_user(username="reset", email=email, password="Old-password-44")
        code = self.request_code(email, "password_reset")
        response = self.client.post("/api/auth/otp/verify/", {
            "email": email, "purpose": "password_reset", "code": code,
            "password": self.password,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertTrue(user.check_password(self.password))
        self.assertTrue(self.client.get("/api/auth/session/").data["authenticated"])

    def test_unknown_sign_in_request_does_not_reveal_account(self):
        before = len(mail.outbox)
        response = self.client.post("/api/auth/otp/request/", {
            "email": "missing@example.com", "purpose": "sign_in",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(mail.outbox), before)

    def test_seeded_demo_account_can_sign_in_with_password(self):
        response = self.client.post("/api/auth/password/sign-in/", {
            "email": "admin@gmail.com", "password": "Admin123",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(self.client.get("/api/auth/session/").data["authenticated"])
