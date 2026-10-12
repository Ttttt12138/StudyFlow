"""Email OTP authentication for StudyFlow's browser session."""
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
from django.db import transaction
from django.db.models import Q
from django.middleware.csrf import get_token
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .auth_models import EmailOtpChallenge
from .throttles import ScopedThrottle


def normalize_email(value: str) -> str:
    return get_user_model().objects.normalize_email(value.strip()).casefold()


def find_user(email: str):
    return get_user_model().objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).order_by("id").first()


def digest_code(challenge_id, code: str) -> str:
    payload = f"{challenge_id}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()


class OtpRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    purpose = serializers.ChoiceField(choices=EmailOtpChallenge.Purpose.values)

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


class PasswordSignInSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)

    def validate_email(self, value):
        return normalize_email(value)


class EmailOtpRequestView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedThrottle]
    throttle_scope = "auth"

    @extend_schema(request=OtpRequestSerializer)
    def post(self, request):
        serializer = OtpRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        purpose = serializer.validated_data["purpose"]
        user = find_user(email)
        if purpose == EmailOtpChallenge.Purpose.SIGN_UP and user:
            return Response({"detail": "ACCOUNT_EXISTS", "message": "An account already uses this email."}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        cooldown = int(getattr(settings, "STUDYFLOW_OTP_RESEND_SECONDS", 60))
        recent = EmailOtpChallenge.objects.filter(email=email, purpose=purpose, created_at__gte=now - timedelta(seconds=cooldown)).first()
        if recent:
            return Response({"detail": "OTP_COOLDOWN", "message": "Please wait before requesting another code."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        code = f"{secrets.randbelow(1_000_000):06d}"
        challenge = EmailOtpChallenge(id=uuid.uuid4(), email=email, purpose=purpose,
                                      expires_at=now + timedelta(seconds=settings.STUDYFLOW_OTP_TTL_SECONDS))
        challenge.code_digest = digest_code(challenge.id, code)
        challenge.save()

        # Do not reveal whether a sign-in/reset address exists. A decoy challenge follows the
        # same API path but sends no message and can never authenticate a user.
        should_send = purpose == EmailOtpChallenge.Purpose.SIGN_UP or user is not None
        if should_send:
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
                return Response({"detail": "EMAIL_UNAVAILABLE", "message": "We could not send the email. Please try again."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"message": "If the address can be used, a six-digit code has been sent.", "expires_in": settings.STUDYFLOW_OTP_TTL_SECONDS})


class EmailOtpVerifyView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedThrottle]
    throttle_scope = "auth"

    @extend_schema(request=OtpVerifySerializer)
    def post(self, request):
        serializer = OtpVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        now = timezone.now()
        with transaction.atomic():
            challenge = EmailOtpChallenge.objects.select_for_update().filter(
                email=data["email"], purpose=data["purpose"], consumed_at__isnull=True,
            ).order_by("-created_at").first()
            if not challenge or challenge.expires_at <= now or challenge.attempts >= settings.STUDYFLOW_OTP_MAX_ATTEMPTS:
                return Response({"detail": "OTP_INVALID", "message": "The code is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)
            if not hmac.compare_digest(challenge.code_digest, digest_code(challenge.id, data["code"])):
                challenge.attempts += 1
                challenge.save(update_fields=["attempts"])
                return Response({"detail": "OTP_INVALID", "message": "The code is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)

            user = find_user(data["email"])
            if data["purpose"] == EmailOtpChallenge.Purpose.SIGN_UP:
                if user:
                    return Response({"detail": "ACCOUNT_EXISTS", "message": "An account already uses this email."}, status=status.HTTP_400_BAD_REQUEST)
                username = "sf_" + hashlib.sha256(data["email"].encode()).hexdigest()[:24]
                parts = data["full_name"].strip().split(None, 1)
                user = get_user_model().objects.create_user(
                    username=username, email=data["email"], password=data["password"],
                    first_name=parts[0], last_name=parts[1] if len(parts) > 1 else "",
                )
            elif not user or not user.is_active:
                return Response({"detail": "OTP_INVALID", "message": "The code is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)
            elif data["purpose"] == EmailOtpChallenge.Purpose.PASSWORD_RESET:
                user.set_password(data["password"])
                user.save(update_fields=["password"])

            challenge.consumed_at = now
            challenge.save(update_fields=["consumed_at"])

        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response({
            "authenticated": True,
            "email": user.email,
            "username": user.get_username(),
            "csrf_token": get_token(request),
        })

class PasswordSignInView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedThrottle]
    throttle_scope = "auth"

    @extend_schema(request=PasswordSignInSerializer)
    def post(self, request):
        serializer = PasswordSignInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user(serializer.validated_data["email"])
        authenticated = authenticate(
            request,
            username=user.get_username() if user else "",
            password=serializer.validated_data["password"],
        )
        if not authenticated:
            return Response({"detail": "INVALID_CREDENTIALS", "message": "The email or password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        login(request, authenticated)
        return Response({
            "authenticated": True,
            "email": authenticated.email,
            "username": authenticated.get_username(),
            "csrf_token": get_token(request),
        })
