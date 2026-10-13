"""Regenerate read-only reminder previews using real API responses in an isolated test DB."""
import json
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from finance import execution_services
from finance.planning import checklist, in_school, services
from finance.planning.models import PlanBill, PlanningProfile, StudyTask
from finance.services import save_state


class StudyLifeFixture(APITestCase):
    def test_record(self):
        output = Path(settings.BASE_DIR).parent / "frontend/src/plan/preview-data"
        for stage in ("plan", "prepare", "school"):
            for lang in ("zh", "en"):
                recording = json.loads((output / f"{stage}.{lang}.json").read_text(encoding="utf-8"))
                old = recording["conversation"]["plan"]
                user = get_user_model().objects.create_user(f"life-preview-{stage}-{lang}")
                self.client.force_authenticate(user)
                services.save_plan(user, {"school_key": old["school_key"]})
                plan = services.plan_for(user)
                plan.start_date = date.fromisoformat(old["start_date"])
                plan.status = {"plan": "DRAFT", "prepare": "CONFIRMED", "school": "ENROLLED"}[stage]
                plan.snapshot = services.estimate(services.entry_or_404(plan.school_key), plan.years)
                plan.save()
                today = plan.start_date + timedelta(days=12 if stage == "school" else -7)
                profile, _ = PlanningProfile.objects.get_or_create(owner=user)
                profile.demo_date = today
                profile.save()
                if stage != "plan":
                    # As confirm_plan does: bills and the country checklist, with the early steps already done.
                    in_school.generate_bills(user, plan)
                    checklist.seed(user, plan)
                    finished = plan.start_date + timedelta(days=1) if stage == "school" else today - timedelta(days=14)
                    StudyTask.objects.filter(plan=plan, due_date__lt=finished).update(done=True)
                    StudyTask.objects.create(owner=user, plan=plan, title="补充学校通知日期" if lang == "zh" else "Check the notice deadline",
                        source_text="演示待办，请按实际学校通知修改" if lang == "zh" else "Demo task; verify against the school's notice")
                if stage == "school":
                    PlanBill.objects.filter(plan=plan, due_date__lt=plan.start_date + timedelta(days=1)).update(status="PAID")
                    state = save_state(user, 0, {"currency": "THB", "as_of": today.isoformat(),
                        "opening_balance": "60000.00", "reserve": "0.00", "events": []})
                    execution_services.initialize(user, {"state_version": state.version})
                    response = self.client.post("/api/v2/planning/expenses/record/", {"amount": "120", "note": "Lunch"},
                        format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
                    self.assertEqual(response.status_code, 201, response.data)
                response = self.client.get("/api/v2/planning/life/")
                self.assertEqual(response.status_code, 200, response.data)
                (output / f"life.{stage}.{lang}.json").write_text(json.dumps(response.data["data"], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
