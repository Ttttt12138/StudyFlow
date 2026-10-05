from django.apps import AppConfig


class FinanceConfig(AppConfig):
    name = "finance"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from .readiness import signals  # noqa: F401
