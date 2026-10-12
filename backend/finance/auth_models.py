import uuid

from django.db import models


class EmailOtpChallenge(models.Model):
    class Purpose(models.TextChoices):
        SIGN_UP = "sign_up", "Sign up"
        SIGN_IN = "sign_in", "Sign in"
        PASSWORD_RESET = "password_reset", "Password reset"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(db_index=True)
    purpose = models.CharField(max_length=24, choices=Purpose.choices)
    code_digest = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["email", "purpose", "-created_at"], name="email_otp_lookup")]
