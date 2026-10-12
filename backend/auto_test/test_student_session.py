from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient


@override_settings(STUDYFLOW_READINESS_ENABLED=True)
class StudentSessionTests(TestCase):
    def test_session_identity_csrf_and_owned_api_permissions(self):
        client = APIClient(enforce_csrf_checks=True)
        guest = client.get('/api/auth/session/')
        self.assertFalse(guest.data['authenticated'])
        self.assertIn('csrf_token', guest.data)
        self.assertEqual(guest['Cache-Control'], 'no-store')
        self.assertEqual(client.get('/api/v2/readiness/templates/').status_code, 401)
        user = get_user_model().objects.create_user(username='session-student', password='test-only-session')
        client.force_login(user)
        identity = client.get('/api/auth/session/')
        self.assertTrue(identity.data['authenticated'])
        self.assertEqual(identity.data['username'], user.username)
        self.assertNotIn('password', identity.data)
        self.assertEqual(client.get('/api/v2/readiness/templates/').status_code, 200)
        self.assertEqual(client.post('/api/v2/readiness/semesters/', {}, format='json').status_code, 403)
        response = client.post('/api/v2/readiness/semesters/', {}, format='json',
                               HTTP_X_CSRFTOKEN=identity.data['csrf_token'], HTTP_IDEMPOTENCY_KEY='csrf-test')
        self.assertEqual(response.status_code, 400)  # Passed CSRF; serializer rejects missing reserve.
