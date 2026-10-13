"""Explicitly record a read-only short-flow preview from the local API."""
import json
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from finance.planning import services

from .test_planning_assessment import ShortPlanningTests


class ShortPlanningFixture(APITestCase):
    def test_record(self):
        user = get_user_model().objects.create_user("recorded-short-plan")
        self.client.force_authenticate(user)
        plan = services.save_plan(user, {"school_key": "chulalongkorn"})["plan"]
        inputs = ShortPlanningTests.inputs(self)
        response = self.client.post("/api/v2/planning/assessment/", {
            "expected_version": 0, "plan_version": plan["version"], "inputs": inputs},
            format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(response.status_code, 201, response.data)
        target = Path(settings.BASE_DIR).parent / "frontend/src/plan/preview-data/assessment.json"
        target.write_text(json.dumps(response.data["data"], ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")
