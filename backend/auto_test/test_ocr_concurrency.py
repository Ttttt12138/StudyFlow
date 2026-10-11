from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase
from django.utils import timezone
from studyflow_ai.parsing import InputError

from finance.readiness.models import ImportMaterial, ReadinessJob, Semester
from finance.readiness.ocr import _mark_attempt


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
class OcrConcurrencyTests(TransactionTestCase):
    def test_only_one_worker_can_start_external_request(self):
        owner = get_user_model().objects.create_user(username="ocr-race")
        semester = Semester.objects.create(owner=owner, template_key="synthetic")
        material = ImportMaterial.objects.create(
            owner=owner,
            semester=semester,
            kind="image",
            content=b"test",
            sha256="a" * 64,
            state_version=1,
            budget_version=1,
        )
        job = ReadinessJob.objects.create(
            owner=owner,
            kind="import",
            key="ocr-race",
            payload={"material_id": str(material.pk)},
            available_at=timezone.now(),
            status="RUNNING",
            lease_token=uuid4(),
        )
        barrier = Barrier(2)

        def attempt(_):
            try:
                candidate = ImportMaterial.objects.get(pk=material.pk)
                task = ReadinessJob.objects.get(pk=job.pk)
                barrier.wait(timeout=10)
                _mark_attempt(candidate, task)
                return "allowed"
            except InputError as exc:
                return exc.code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = sorted(executor.map(attempt, range(2)))
        self.assertEqual(results, ["OCR_ATTEMPT_REQUIRES_REVIEW", "allowed"])
