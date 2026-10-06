"""DRF throttles whose rates are read from settings on every request.

DRF binds SimpleRateThrottle.THROTTLE_RATES at import time; reading
settings.STUDYFLOW_THROTTLE_RATES instead lets override_settings and the
STUDYFLOW_THROTTLE_<SCOPE> variables apply. Counters live in the shared cache.
"""
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle


class SettingsRates:
    def get_rate(self):
        try:
            return settings.STUDYFLOW_THROTTLE_RATES[self.scope]
        except KeyError:
            raise ImproperlyConfigured(f"No throttle rate for scope {self.scope!r}.") from None


class AnonThrottle(SettingsRates, AnonRateThrottle):
    pass


class UserThrottle(SettingsRates, UserRateThrottle):
    pass


class ScopedThrottle(SettingsRates, ScopedRateThrottle):
    pass
