from django.core.cache import cache
from django.test import override_settings
from django.test.runner import DiscoverRunner


class StudyFlowTestRunner(DiscoverRunner):
    """Fast password hashing for step-up tests and fresh throttle counters per run."""

    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        self._hashers = override_settings(
            PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
        self._hashers.enable()

    def teardown_test_environment(self, **kwargs):
        self._hashers.disable()
        super().teardown_test_environment(**kwargs)

    def setup_databases(self, **kwargs):
        config = super().setup_databases(**kwargs)
        # The cache table survives --keepdb and TransactionTestCase flushes.
        cache.clear()
        return config
