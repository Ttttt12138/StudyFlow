import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from babel.numbers import get_currency_precision
from django.core.exceptions import ImproperlyConfigured
from studyflow_ai.ocr_config import OcrSettings

BASE_DIR = Path(__file__).resolve().parent.parent
# backend/ (B) sits next to studyflow-ai/ (C) and frontend/ (A).
STUDYFLOW_AI_DIR = BASE_DIR.parent / "studyflow-ai"
# Capture C configuration before loading B's .env so B cannot shadow C's API settings.
_C_OCR = OcrSettings.from_env(STUDYFLOW_AI_DIR / ".env")
load_dotenv(BASE_DIR / ".env")
# The live agent planner (STUDYFLOW_MODE=live) reads its gateway settings from the environment;
# take them from studyflow-ai/.env unless the process or backend/.env already set them.
_C_LLM_KEYS = ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "TYPESAFE_API_KEY", "TYPESAFE_DEFAULT_MODEL")
if (STUDYFLOW_AI_DIR / ".env").is_file():
    from studyflow_ai.config import read_env_file

    for _key, _value in read_env_file(STUDYFLOW_AI_DIR / ".env").items():
        if _key in _C_LLM_KEYS and _value.strip():
            os.environ.setdefault(_key, _value)
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY in backend/.env.")
DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() == "true"
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")
# Email OTP. The console backend prints codes to the log, so outside DEBUG the OTP views refuse
# to issue codes through it (or the file backend) unless STUDYFLOW_OTP_ALLOW_LOGGED_EMAIL=true.
EMAIL_BACKEND = os.getenv("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "true").lower() == "true"
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "StudyFlow <no-reply@studyflow.local>")
STUDYFLOW_OTP_ALLOW_LOGGED_EMAIL = os.getenv("STUDYFLOW_OTP_ALLOW_LOGGED_EMAIL", "false").lower() == "true"
STUDYFLOW_OTP_TTL_SECONDS = int(os.getenv("STUDYFLOW_OTP_TTL_SECONDS", "600"))
STUDYFLOW_OTP_RESEND_SECONDS = int(os.getenv("STUDYFLOW_OTP_RESEND_SECONDS", "60"))
STUDYFLOW_OTP_MAX_ATTEMPTS = int(os.getenv("STUDYFLOW_OTP_MAX_ATTEMPTS", "5"))
# Demo only: a student's pending T3 approval may be approved by a simulated operator this many seconds after it
# was requested (approvals/<id>/simulate/). 0 turns the shortcut off, so only real staff decide. Off unless
# DJANGO_DEBUG is on or the variable is set: a deployed site must never approve its own over-limit payments.
STUDYFLOW_SIMULATED_APPROVAL_SECONDS = int(os.getenv("STUDYFLOW_SIMULATED_APPROVAL_SECONDS", "10" if DEBUG else "0"))
# Wrong codes per address across every challenge; reaching it locks OTP for that address.
STUDYFLOW_OTP_MAX_FAILURES_PER_WINDOW = int(os.getenv("STUDYFLOW_OTP_MAX_FAILURES_PER_WINDOW", "20"))
STUDYFLOW_OTP_LOCKOUT_WINDOW_SECONDS = int(os.getenv("STUDYFLOW_OTP_LOCKOUT_WINDOW_SECONDS", "86400"))
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "rest_framework", "rest_framework.authtoken", "corsheaders",
    "drf_spectacular", "finance",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": os.getenv("DB_NAME", "studyflow"),
    "USER": os.getenv("DB_USER", "studyflow"),
    "PASSWORD": os.getenv("DB_PASSWORD", ""),
    "HOST": os.getenv("DB_HOST", "127.0.0.1"),
    "PORT": os.getenv("DB_PORT", "5432"),
    "CONN_MAX_AGE": 60,
    "OPTIONS": {"connect_timeout": 5},
    # Parallel worktrees sharing one server need distinct test databases.
    "TEST": {"NAME": os.getenv("DB_TEST_NAME") or None},
}}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_SCHEMA_CLASS": "config.schema.StudyFlowSchema",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": ["finance.throttles.AnonThrottle", "finance.throttles.UserThrottle"],
}
# docs/permissions.md §6; override with STUDYFLOW_THROTTLE_<SCOPE>, e.g. STUDYFLOW_THROTTLE_STEP_UP=5/hour.
_THROTTLE_DEFAULTS = {
    "user": "1000/hour", "anon": "100/hour",
    "auth": "10/min", "step_up": "10/hour", "money": "60/hour", "sponsor": "20/hour", "agent": "30/hour",
}
STUDYFLOW_THROTTLE_RATES = {
    scope: os.getenv("STUDYFLOW_THROTTLE_" + scope.upper(), rate).strip()
    for scope, rate in _THROTTLE_DEFAULTS.items()
}
for _scope, _rate in STUDYFLOW_THROTTLE_RATES.items():
    _count, _, _period = _rate.partition("/")
    if not (_count.isdigit() and _period[:1] in {"s", "m", "h", "d"}):
        raise ImproperlyConfigured(f"Invalid throttle rate for {_scope}: {_rate!r}")
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = STUDYFLOW_THROTTLE_RATES
# Anonymous throttles key on the client IP. DRF trusts X-Forwarded-For when NUM_PROXIES is
# unset, which lets clients pick their own key; count only the configured trusted proxies.
# Stable error codes stay in `detail`; `message` is localized from Accept-Language.
REST_FRAMEWORK["EXCEPTION_HANDLER"] = "finance.i18n.exception_handler"
REST_FRAMEWORK["NUM_PROXIES"] = int(os.getenv("DJANGO_NUM_PROXIES", "0"))
# Throttle counters must be shared by all workers; create the table with `manage.py createcachetable`.
CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.db.DatabaseCache",
    "LOCATION": "studyflow_cache",
    # Culling would silently reset throttle counters, so keep the ceiling high.
    "OPTIONS": {"MAX_ENTRIES": 100000},
}}
# Budgets, loans and tuition settle in the home currency; wallets may hold the others.
STUDYFLOW_HOME_CURRENCY = os.getenv("STUDYFLOW_HOME_CURRENCY", "THB").upper()
STUDYFLOW_SUPPORTED_CURRENCIES = [
    x.strip().upper()
    for x in os.getenv("STUDYFLOW_SUPPORTED_CURRENCIES", "THB,USD,EUR,CNY,GBP,JPY,AUD,SGD,MYR").split(",")
    if x.strip()
]
# The B lending core and its C adapters are THB-only, so the home currency is pinned.
if STUDYFLOW_HOME_CURRENCY != "THB":
    raise ImproperlyConfigured("STUDYFLOW_HOME_CURRENCY must be THB until lending supports other currencies.")
if STUDYFLOW_HOME_CURRENCY not in STUDYFLOW_SUPPORTED_CURRENCIES:
    raise ImproperlyConfigured("STUDYFLOW_SUPPORTED_CURRENCIES must include the home currency.")
for _code in STUDYFLOW_SUPPORTED_CURRENCIES:
    # Money columns store two decimals; currencies with finer minor units would drift.
    if get_currency_precision(_code) > 2 or len(_code) != 3:
        raise ImproperlyConfigured(f"Unsupported currency precision: {_code}")
STUDYFLOW_FX_LIVE = os.getenv("STUDYFLOW_FX_LIVE", "false").lower() == "true"
STUDYFLOW_FX_CACHE_SECONDS = int(os.getenv("STUDYFLOW_FX_CACHE_SECONDS", "900"))
SPECTACULAR_SETTINGS = {
    "TITLE": "StudyFlow Backend", "VERSION": "2.0.0",
    "DESCRIPTION": "StudyFlow demo: budgets, FX, funding, loans and policy-controlled simulated execution. All settlements are simulated.",
    "SERVE_INCLUDE_SCHEMA": False,
    "ENUM_NAME_OVERRIDES": {
        "SupportedCurrencyEnum": STUDYFLOW_SUPPORTED_CURRENCIES,
        "SettlementCurrencyEnum": [STUDYFLOW_HOME_CURRENCY],
        "EventCertaintyEnum": ["confirmed","estimated","missing"],
        "FundingCertaintyEnum": ["confirmed","estimated"],
        "PolicyActionEnum": "finance.policy_api.ACTION_CHOICES",
        "EmailOtpPurposeEnum": "finance.auth_models.EmailOtpChallenge.Purpose",
        # Keeps the remittance enum's published name now that another "purpose" field exists.
        "PurposeEnum": "finance.remittance_models.PURPOSES",
    },
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAuthenticated"],
}
CORS_ALLOWED_ORIGINS = [
    x for x in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if x
]
LANGUAGE_CODE = "en"
LANGUAGES = [("en", "English"), ("zh-hans", "简体中文")]
LOCALE_PATHS = [BASE_DIR / "locale"]
TIME_ZONE = "Asia/Bangkok"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
# Target of `collectstatic`; the Docker image sets it and the web container serves the files.
STATIC_ROOT = os.getenv("DJANGO_STATIC_ROOT") or None
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
TEST_RUNNER = "config.test_runner.StudyFlowTestRunner"


def _env_flag(name, default="false"):
    return os.getenv(name, default).strip().lower() == "true"


# Production hardening (docs/permissions.md §7); verified by `check --deploy` in CI.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS = [x.strip() for x in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if x.strip()]
DJANGO_SECURE = _env_flag("DJANGO_SECURE")
if DJANGO_SECURE:
    SECURE_SSL_REDIRECT = True
    # Plain-HTTP readiness probes from the load balancer.
    SECURE_REDIRECT_EXEMPT = [r"^health/$"]
    # Start low; raise to 31536000 only after HTTPS is confirmed on every host.
    SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_HSTS_SECONDS", "3600"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = _env_flag("DJANGO_HSTS_INCLUDE_SUBDOMAINS", "true")
    SECURE_HSTS_PRELOAD = _env_flag("DJANGO_HSTS_PRELOAD")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_AGE = 8 * 60 * 60
    if _env_flag("DJANGO_SECURE_PROXY_SSL_HEADER"):
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    if not SECURE_HSTS_PRELOAD:
        # Preload is an opt-in commitment that is hard to undo; it stays off by default.
        SILENCED_SYSTEM_CHECKS = ["security.W021"]

# Readiness (budget checks, payment readiness) is on unless explicitly turned off.
STUDYFLOW_READINESS_ENABLED = os.getenv("STUDYFLOW_READINESS_ENABLED", "true").lower() == "true"
STUDYFLOW_AI_MODE = os.getenv("STUDYFLOW_MODE", "mock")
# `manage.py test` stays offline and deterministic even when backend/.env selects live;
# a test that needs live mode says so with override_settings.
if len(sys.argv) > 1 and sys.argv[1] == "test":
    STUDYFLOW_AI_MODE = "mock"
STUDYFLOW_CONSUMPTION_ENABLED = os.getenv("STUDYFLOW_CONSUMPTION_ENABLED", "false").lower() == "true"
# reset_demo wipes the whole database; only a dedicated demo deployment may turn this on.
STUDYFLOW_ALLOW_DEMO_RESET = os.getenv("STUDYFLOW_ALLOW_DEMO_RESET", "false").lower() == "true"

# Django consumes C's configuration; OCR API settings belong to studyflow-ai/.env.
STUDYFLOW_OCR_ENABLED = _C_OCR.enabled
STUDYFLOW_OCR_PAID_SERVICE_CONFIRMED = _C_OCR.paid_service_confirmed
STUDYFLOW_OCR_ADULT_ONLY_CONFIRMED = _C_OCR.adult_only_confirmed
STUDYFLOW_OCR_MODEL = _C_OCR.model
STUDYFLOW_OCR_FALLBACK_MODELS = _C_OCR.fallback_models
STUDYFLOW_OCR_MAX_ATTEMPTS = _C_OCR.max_attempts
GEMINI_API_KEY = _C_OCR.api_key
STUDYFLOW_OCR_TIMEOUT = _C_OCR.timeout
STUDYFLOW_DOCUMENT_RETENTION_DAYS = _C_OCR.retention_days
STUDYFLOW_OCR_REQUESTS_PER_HOUR = _C_OCR.requests_per_hour
