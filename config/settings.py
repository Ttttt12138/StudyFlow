import os
from pathlib import Path
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured
from studyflow_ai.ocr_config import OcrSettings

BASE_DIR = Path(__file__).resolve().parent.parent
# Capture C configuration before loading B's .env so B cannot shadow C's API settings.
_C_OCR = OcrSettings.from_env(BASE_DIR / "studyflow-ai" / ".env")
load_dotenv(BASE_DIR / ".env")
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY in .env.")
DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() == "true"
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")
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
}
SPECTACULAR_SETTINGS = {
    "TITLE": "StudyFlow Backend", "VERSION": "2.0.0",
    "DESCRIPTION": "StudyFlow demo: budgets, FX, funding, loans and policy-controlled simulated execution. All settlements are simulated.",
    "SERVE_INCLUDE_SCHEMA": False,
    "ENUM_NAME_OVERRIDES": {
        "SupportedCurrencyEnum": ["THB","USD","EUR","CNY","GBP","JPY"],
        "SettlementCurrencyEnum": ["THB"],
        "EventCertaintyEnum": ["confirmed","estimated","missing"],
        "FundingCertaintyEnum": ["confirmed","estimated"],
    },
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAuthenticated"],
}
CORS_ALLOWED_ORIGINS = [
    x for x in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if x
]
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Bangkok"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STUDYFLOW_READINESS_ENABLED = os.getenv("STUDYFLOW_READINESS_ENABLED", "false").lower() == "true"
STUDYFLOW_AI_MODE = os.getenv("STUDYFLOW_MODE", "mock")
STUDYFLOW_CONSUMPTION_ENABLED = os.getenv("STUDYFLOW_CONSUMPTION_ENABLED", "false").lower() == "true"

# Django consumes C's configuration; OCR API settings belong to studyflow-ai/.env.
STUDYFLOW_OCR_ENABLED = _C_OCR.enabled
STUDYFLOW_OCR_PAID_SERVICE_CONFIRMED = _C_OCR.paid_service_confirmed
STUDYFLOW_OCR_ADULT_ONLY_CONFIRMED = _C_OCR.adult_only_confirmed
STUDYFLOW_OCR_MODEL = _C_OCR.model
GEMINI_API_KEY = _C_OCR.api_key
STUDYFLOW_OCR_TIMEOUT = _C_OCR.timeout
STUDYFLOW_DOCUMENT_RETENTION_DAYS = _C_OCR.retention_days
STUDYFLOW_OCR_REQUESTS_PER_HOUR = _C_OCR.requests_per_hour
