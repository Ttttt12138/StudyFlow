"""Records the planner preview shown at /?plan=preview (frontend/src/plan/preview-data/).

Not collected by default (no test_ prefix). Regenerate after changing cards or the catalog:
    python manage.py test auto_test.fixture_plan_preview
It drives the real API with the deterministic rule planner, so the preview has the live shapes.
"""
import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.conf import settings

from auto_test.test_planning import API, ConversationHarness
from finance.planning import services
from finance.planning.models import StudyPlan

OUT = Path(settings.BASE_DIR).parent / "frontend" / "src" / "plan" / "preview-data"
SCRIPTS = {
    "zh": {"plan": ["我是家长", "朱拉隆功读4年全部费用多少？", "比较曼彻斯特和墨尔本", "早稻田周边有什么好吃好玩的？",
                    "我们有存款20万人民币，就选朱拉隆功", "帮我试算贷款，分48个月", "确认计划"],
           "school": ["今天午饭花了120泰铢", "打车花了85泰铢", "这个月花了多少？", "接下来有哪些账单？", "人民币兑泰铢汇率是多少"]},
    "en": {"plan": ["I'm a parent", "What does 4 years at Chulalongkorn cost in total?", "Compare Manchester and Melbourne",
                    "What food and fun is near Waseda?", "We have savings of 200000 CNY, choose Chulalongkorn",
                    "Simulate a loan over 48 months", "Confirm the plan"],
           "school": ["I spent 120 THB on lunch today", "Taxi, spent 85 THB", "How much have I spent this month?",
                      "Which bills are due?", "What is the CNY to THB rate?"]},
}


def scrub(value):
    """Stable, account-free JSON for the bundle."""
    text = json.dumps(value, ensure_ascii=False, default=str)
    return json.loads(text)


class PlanPreviewFixture(ConversationHarness):
    username = "demo-family"

    def write(self, name, data):
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / name).write_text(json.dumps(scrub(data), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    def get(self, path):
        response = self.client.get(API + path)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["data"]

    def run_stage_one(self, lang):
        conversation = self.start(lang)
        for text in SCRIPTS[lang]["plan"]:
            self.say(conversation, text)
        return self.get(f"agent/conversations/{conversation['id']}/")

    def test_record(self):
        for lang in ("zh", "en"):
            StudyPlan.objects.filter(owner=self.user).delete()
            self.user.planningprofile_set.all().delete()
            stage_one = self.run_stage_one(lang)
            self.write(f"plan.{lang}.json", {"conversation": stage_one, "in_school": self.get("planning/in-school/"),
                                             "family": self.get("planning/family-links/")})
            # Stage two: confirm, let the agent propose enrollment near the start date, then live there.
            pending = next(p for t in stage_one["turns"] for p in t["pending_actions"] if p["status"] == "PENDING")
            self.post(f"agent/pending-actions/{pending['id']}/confirm/")
            start = StudyPlan.objects.get(owner=self.user).start_date
            with patch.object(services, "today_for", return_value=start - timedelta(days=2)):
                conversation = self.start(lang)
                enroll = next(p for t in self.get(f"agent/conversations/{conversation['id']}/")["turns"]
                              for p in t["pending_actions"] if p["action"] == "plan.enroll")
                self.post(f"agent/pending-actions/{enroll['id']}/confirm/")
            with patch.object(services, "today_for", return_value=start + timedelta(days=12)):
                for text in SCRIPTS[lang]["school"]:
                    self.say(conversation, text)
                self.write(f"school.{lang}.json", {
                    "conversation": self.get(f"agent/conversations/{conversation['id']}/"),
                    "in_school": self.get("planning/in-school/"), "family": self.get("planning/family-links/")})
            from finance.planning.models import PlanBill
            PlanBill.objects.filter(owner=self.user).delete()
            from finance.planning.models import ExpenseEntry
            ExpenseEntry.objects.filter(owner=self.user).delete()
