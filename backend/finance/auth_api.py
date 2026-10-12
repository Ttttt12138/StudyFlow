"""Email OTP and password sign-in for StudyFlow's browser session.

These views take no DRF authentication (anonymous callers), so DRF would skip CSRF;
each POST checks it explicitly (`csrf_rejected`) to stop login CSRF. Clients read the token from
/api/auth/session/ and send it as X-CSRFToken.
"""
import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.middleware.csrf import get_token
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.authentication import CSRFCheck
from rest_framework.response import Response
from rest_framework.views import APIView

from .auth_models import EmailOtpChallenge
from .throttles import ScopedThrottle

# Backends that write the message (and so the code) to stdout or disk.
LOGGING_EMAIL_BACKENDS = {
    "django.core.mail.backends.console.EmailBackend",
    "django.core.mail.backends.filebased.EmailBackend",
}


def normalize_email(value: str) -> str:
    return get_user_model().objects.normalize_email(value.strip()).casefold()


def find_user(email: str):
    return get_user_model().objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).order_by("id").first()


def digest_code(challenge_id, code: str) -> str:
    payload = f"{challenge_id}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()


def email_delivery_is_safe() -> bool:
    """Outside DEBUG, refuse to issue codes that would land in logs unless explicitly allowed."""
    if settings.DEBUG or settings.STUDYFLOW_OTP_ALLOW_LOGGED_EMAIL:
        return True
    return settings.EMAIL_BACKEND not in LOGGING_EMAIL_BACKENDS


def recent_failures(email: str, now) -> int:
    """Wrong guesses for this address across all its challenges, so new codes add no attempts."""
    since = now - timedelta(seconds=settings.STUDYFLOW_OTP_LOCKOUT_WINDOW_SECONDS)
    total = EmailOtpChallenge.objects.filter(email=email, created_at__gte=since).aggregate(n=Sum("attempts"))["n"]
    return total or 0


def is_locked(email: str, now) -> bool:
    return recent_failures(email, now) >= settings.STUDYFLOW_OTP_MAX_FAILURES_PER_WINDOW


def error(code: str, message: str, http_status=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": code, "code": code, "message": message}, status=http_status)


def signed_in(request, user):
    return Response({
        "authenticated": True,
        "email": user.email,
        "username": user.get_username(),
        "csrf_token": get_token(request),
    })


class OtpRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    purpose = serializers.ChoiceField(choices=EmailOtpChallenge.Purpose.choices)

    def validate_email(self, value):
        return normalize_email(value)


class OtpVerifySerializer(OtpRequestSerializer):
    code = serializers.RegexField(r"^\d{6}$")
    full_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    password = serializers.CharField(max_length=128, required=False, trim_whitespace=False, write_only=True)

    def validate(self, attrs):
        purpose = attrs["purpose"]
        if purpose == EmailOtpChallenge.Purpose.SIGN_UP and not attrs.get("full_name", "").strip():
            raise serializers.ValidationError({"full_name": "Enter your name."})
        if purpose in {EmailOtpChallenge.Purpose.SIGN_UP, EmailOtpChallenge.Purpose.PASSWORD_RESET}:
            password = attrs.get("password")
            if not password:
                raise serializers.ValidationError({"password": "Enter a new password."})
            user = find_user(attrs["email"])
            try:
                validate_password(password, user)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs


class SignedInSerializer(serializers.Serializer):
    authenticated = serializers.BooleanField()
    email = serializers.CharField()
    username = serializers.CharField()
    csrf_token = serializers.CharField()


class OtpRequestedSerializer(serializers.Serializer):
    message = serializers.CharField()
    expires_in = serializers.IntegerField()


class PasswordSignInSerializer(serializers.Serializer):
    # An email address, or a plain username such as the seeded demo-student.
    login = serializers.CharField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)


class CsrfEnforcedView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedThrottle]
    throttle_scope = "auth"

    def csrf_rejected(self):
        # Same check SessionAuthentication.enforce_csrf runs for signed-in callers.
        check = CSRFCheck(lambda _request: None)
        check.process_request(self.request)
        if check.process_view(self.request, None, (), {}):
            return error("CSRF_FAILED", "Refresh the page and try again.", status.HTTP_403_FORBIDDEN)
        return None


class EmailOtpRequestView(CsrfEnforcedView):
    @extend_schema(request=OtpRequestSerializer, responses=OtpRequestedSerializer)
    def post(self, request):
        if rejected := self.csrf_rejected():
            return rejected
        serializer = OtpRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        purpose = serializer.validated_data["purpose"]
        if not email_delivery_is_safe():
            return error("EMAIL_UNAVAILABLE", "Email codes are not available here. Sign in with your password.",
                         status.HTTP_503_SERVICE_UNAVAILABLE)
        user = find_user(email)
        if purpose == EmailOtpChallenge.Purpose.SIGN_UP and user:
            return error("ACCOUNT_EXISTS", "An account already uses this email.")

        now = timezone.now()
        if is_locked(email, now):
            return error("OTP_LOCKED", "Too many incorrect codes. Try again later.", status.HTTP_429_TOO_MANY_REQUESTS)
        cooldown = int(getattr(settings, "STUDYFLOW_OTP_RESEND_SECONDS", 60))
        if EmailOtpChallenge.objects.filter(email=email, purpose=purpose, created_at__gte=now - timedelta(seconds=cooldown)).exists():
            return error("OTP_COOLDOWN", "Please wait before requesting another code.", status.HTTP_429_TOO_MANY_REQUESTS)

        code = f"{secrets.randbelow(1_000_000):06d}"
        with transaction.atomic():
            # Only the newest code works; older ones expire now.
            EmailOtpChallenge.objects.filter(email=email, purpose=purpose, consumed_at__isnull=True, expires_at__gt=now).update(expires_at=now)
            challenge = EmailOtpChallenge(id=uuid.uuid4(), email=email, purpose=purpose,
                                          expires_at=now + timedelta(seconds=settings.STUDYFLOW_OTP_TTL_SECONDS))
            challenge.code_digest = digest_code(challenge.id, code)
            challenge.save()

        # Do not reveal whether a sign-in/reset address exists. A decoy challenge follows the
        # same API path but sends no message and can never authenticate a user.
        if purpose == EmailOtpChallenge.Purpose.SIGN_UP or user is not None:
            labels = {"sign_up": "create your account", "sign_in": "sign in", "password_reset": "reset your password"}
            try:
                send_mail(
                    "Your StudyFlow verification code",
                    f"Use {code} to {labels[purpose]}. This code expires in {settings.STUDYFLOW_OTP_TTL_SECONDS // 60} minutes.\n\nIf you did not request this, you can ignore this email.",
                    settings.DEFAULT_FROM_EMAIL,
                    [email],
                    fail_silently=False,
                )
            except Exception:
                challenge.delete()
                return error("EMAIL_UNAVAILABLE", "We could not send the email. Please try again.", status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"message": "If the address can be used, a six-digit code has been sent.", "expires_in": settings.STUDYFLOW_OTP_TTL_SECONDS})


class EmailOtpVerifyView(CsrfEnforcedView):
    @extend_schema(request=OtpVerifySerializer, responses=SignedInSerializer)
    def post(self, request):
        if rejected := self.csrf_rejected():
            return rejected
        serializer = OtpVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invalid = lambda: error("OTP_INVALID", "The code is invalid or expired.")
        now = timezone.now()
        with transaction.atomic():
            challenge = EmailOtpChallenge.objects.select_for_update().filter(
                email=data["email"], purpose=data["purpose"], consumed_at__isnull=True,
            ).order_by("-created_at").first()
            if is_locked(data["email"], now):
                return error("OTP_LOCKED", "Too many incorrect codes. Try again later.", status.HTTP_429_TOO_MANY_REQUESTS)
            if not challenge or challenge.expires_at <= now or challenge.attempts >= settings.STUDYFLOW_OTP_MAX_ATTEMPTS:
                return invalid()
            if not hmac.compare_digest(challenge.code_digest, digest_code(challenge.id, data["code"])):
                challenge.attempts += 1
                challenge.save(update_fields=["attempts"])
                return invalid()

            user = find_user(data["email"])
            if data["purpose"] == EmailOtpChallenge.Purpose.SIGN_UP:
                if user:
                    return error("ACCOUNT_EXISTS", "An account already uses this email.")
                username = "sf_" + hashlib.sha256(data["email"].encode()).hexdigest()[:24]
                parts = data["full_name"].strip().split(None, 1)
                try:
                    with transaction.atomic():
                        user = get_user_model().objects.create_user(
                            username=username, email=data["email"], password=data["password"],
                            first_name=parts[0], last_name=parts[1] if len(parts) > 1 else "",
                        )
                except IntegrityError:
                    return error("ACCOUNT_EXISTS", "An account already uses this email.")
            elif not user or not user.is_active:
                return invalid()
            elif data["purpose"] == EmailOtpChallenge.Purpose.PASSWORD_RESET:
                user.set_password(data["password"])
                user.save(update_fields=["password"])

            challenge.consumed_at = now
            challenge.save(update_fields=["consumed_at"])

        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return signed_in(request, user)


class PasswordSignInView(CsrfEnforcedView):
    @extend_schema(request=PasswordSignInSerializer, responses=SignedInSerializer)
    def post(self, request):
        if rejected := self.csrf_rejected():
            return rejected
        serializer = PasswordSignInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifier = serializer.validated_data["login"].strip()
        if "@" in identifier:
            user = find_user(normalize_email(identifier))
            username = user.get_username() if user else identifier
        else:
            username = identifier
        authenticated = authenticate(request, username=username, password=serializer.validated_data["password"])
        if not authenticated:
            return error("INVALID_CREDENTIALS", "The email or password is incorrect.")
        login(request, authenticated)
        return signed_in(request, authenticated)
