import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from finance.auth_models import EmailOtpChallenge

THROTTLE = {**settings.STUDYFLOW_THROTTLE_RATES, "auth": "1000/min"}


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    STUDYFLOW_OTP_RESEND_SECONDS=0,
    STUDYFLOW_THROTTLE_RATES=THROTTLE,
)
class EmailOtpAuthTests(TestCase):
    password = "Correct-Horse-Battery-42"

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def request_code(self, email, purpose):
        response = self.client.post("/api/auth/otp/request/", {"email": email, "purpose": purpose}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)

    def verify(self, email, purpose, code, **extra):
        return self.client.post("/api/auth/otp/verify/", {"email": email, "purpose": purpose, "code": code, **extra}, format="json")

    @staticmethod
    def wrong(code):
        return f"{(int(code) + 1) % 1_000_000:06d}"

    def test_sign_up_verifies_email_creates_user_and_session(self):
        email = "new.student@example.com"
        code = self.request_code(email, "sign_up")
        response = self.verify(email, "sign_up", code, full_name="New Student", password=self.password)
        self.assertEqual(response.status_code, 200, response.data)
        user = get_user_model().objects.get(email=email)
        self.assertTrue(user.check_password(self.password))
        self.assertEqual(user.first_name, "New")
        self.assertTrue(self.client.get("/api/auth/session/").data["authenticated"])
        reused = self.verify(email, "sign_up", code, full_name="New Student", password=self.password)
        self.assertEqual(reused.status_code, 400)

    def test_sign_in_is_passwordless_and_starts_session(self):
        email = "returning.student@example.com"
        get_user_model().objects.create_user(username="returning", email=email, password=self.password)
        code = self.request_code(email, "sign_in")
        response = self.verify(email, "sign_in", code)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(self.client.get("/api/auth/session/").data["authenticated"])

    def test_password_reset_changes_password_and_starts_session(self):
        email = "reset.student@example.com"
        user = get_user_model().objects.create_user(username="reset", email=email, password="Old-password-44")
        code = self.request_code(email, "password_reset")
        response = self.verify(email, "password_reset", code, password=self.password)
        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertTrue(user.check_password(self.password))
        self.assertTrue(self.client.get("/api/auth/session/").data["authenticated"])

    def test_unknown_sign_in_request_does_not_reveal_account(self):
        before = len(mail.outbox)
        response = self.client.post("/api/auth/otp/request/", {"email": "missing@example.com", "purpose": "sign_in"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(mail.outbox), before)

    def test_a_new_code_retires_the_previous_one(self):
        email = "twice@example.com"
        get_user_model().objects.create_user(username="twice", email=email)
        first = self.request_code(email, "sign_in")
        second = self.request_code(email, "sign_in")
        if first != second:
            self.assertEqual(self.verify(email, "sign_in", first).status_code, 400)
        self.assertEqual(self.verify(email, "sign_in", second).status_code, 200)

    @override_settings(STUDYFLOW_OTP_MAX_ATTEMPTS=5, STUDYFLOW_OTP_MAX_FAILURES_PER_WINDOW=8)
    def test_fresh_codes_do_not_reset_the_per_address_guess_budget(self):
        email = "target@example.com"
        get_user_model().objects.create_user(username="target", email=email)
        for _ in range(5):
            code = self.request_code(email, "sign_in")
            self.assertEqual(self.verify(email, "sign_in", self.wrong(code)).status_code, 400)
        code = self.request_code(email, "sign_in")
        for _ in range(3):
            self.verify(email, "sign_in", self.wrong(code))
        # Eight wrong guesses across challenges: the address is locked, even for the right code.
        locked = self.verify(email, "sign_in", code)
        self.assertEqual(locked.status_code, 429)
        self.assertEqual(locked.data["detail"], "OTP_LOCKED")
        again = self.client.post("/api/auth/otp/request/", {"email": email, "purpose": "sign_in"}, format="json")
        self.assertEqual(again.status_code, 429)
        self.assertFalse(self.client.get("/api/auth/session/").data["authenticated"])

    def test_otp_and_password_sign_in_require_csrf(self):
        email = "csrf@example.com"
        get_user_model().objects.create_user(username="csrf-user", email=email, password=self.password)
        strict = APIClient(enforce_csrf_checks=True)
        for path, body in [
            ("/api/auth/otp/request/", {"email": email, "purpose": "sign_in"}),
            ("/api/auth/otp/verify/", {"email": email, "purpose": "sign_in", "code": "123456"}),
            ("/api/auth/password/sign-in/", {"login": email, "password": self.password}),
        ]:
            response = strict.post(path, body, format="json")
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(response.data["detail"], "CSRF_FAILED")
        self.assertFalse(strict.get("/api/auth/session/").data["authenticated"])
        token = strict.get("/api/auth/session/").data["csrf_token"]
        response = strict.post("/api/auth/password/sign-in/", {"login": email, "password": self.password},
                               format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200, response.data)

    @override_settings(DEBUG=False, EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend",
                       STUDYFLOW_OTP_ALLOW_LOGGED_EMAIL=False)
    def test_codes_are_not_issued_to_the_log_outside_debug(self):
        response = self.client.post("/api/auth/otp/request/", {"email": "x@example.com", "purpose": "sign_up"}, format="json")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["detail"], "EMAIL_UNAVAILABLE")
        self.assertFalse(EmailOtpChallenge.objects.exists())

    def test_password_sign_in_accepts_email_or_username(self):
        get_user_model().objects.create_user(username="demo-student", password=self.password)
        get_user_model().objects.create_user(username="mail-user", email="Mail.User@example.com", password=self.password)
        for login in ["demo-student", "mail.user@EXAMPLE.com"]:
            client = APIClient()
            response = client.post("/api/auth/password/sign-in/", {"login": login, "password": self.password}, format="json")
            self.assertEqual(response.status_code, 200, (login, response.data))
        wrong = APIClient().post("/api/auth/password/sign-in/", {"login": "demo-student", "password": "nope"}, format="json")
        self.assertEqual(wrong.status_code, 400)
        self.assertEqual(wrong.data["detail"], "INVALID_CREDENTIALS")

    def test_no_shared_demo_account_is_seeded(self):
        self.assertFalse(get_user_model().objects.filter(username__iexact="admin@gmail.com").exists())
        self.assertFalse(get_user_model().objects.filter(email__iexact="admin@gmail.com").exists())
