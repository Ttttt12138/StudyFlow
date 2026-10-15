"""Record both preview stages from real APIs in Django's isolated test database.

Run: python backend/manage.py test auto_test.fixture_plan_preview
"""
import json
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model

from auto_test.test_planning import API, ConversationHarness

OUT = Path(settings.BASE_DIR).parent / "frontend/src/plan/preview-data"
SCRIPTS = {
    "en": ["What does 4 years at Chulalongkorn cost in total?", "Compare Manchester and Melbourne",
           "Choose Chulalongkorn", "I want to borrow 200000 THB"],
    "zh": ["朱拉隆功读4年一共多少钱？", "比较曼彻斯特和墨尔本", "就选朱拉隆功", "我想贷款20万泰铢"],
}


class PlanPreviewFixture(ConversationHarness):
    def write(self, name, data):
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")

    def get(self, path):
        response = self.client.get(API + path)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["data"]

    def capture(self, conversation, stage, lang):
        assessment = self.get("planning/assessment/")
        self.write(f"{stage}.{lang}.json", {
            "conversation": self.get(f"agent/conversations/{conversation['id']}/"), "assessment": assessment})
        self.write(f"life.{stage}.{lang}.json", self.get("planning/life/"))
        if stage == "plan" and lang == "en":
            self.write("assessment.json", assessment)
        return assessment

    def test_record(self):
        for lang in ("en", "zh"):
            self.user = get_user_model().objects.create_user(f"preview-student-{lang}")
            self.client.force_authenticate(self.user)
            conversation = self.start(lang)
            for text in SCRIPTS[lang]:
                self.say(conversation, text)
            current = self.get("planning/assessment/")
            current["inputs"]["loan"].update(principal="200000.00", months=48)
            response = self.post("planning/assessment/", {"expected_version": current["version"],
                "plan_version": current["plan_version"], "inputs": current["inputs"]})
            self.assertEqual(response.status_code, 201, response.data)
            quote = self.capture(conversation, "plan", lang)
            response = self.post("planning/plan/confirm/", {"expected_version": quote["version"],
                "plan_version": quote["plan_version"], "quote_id": quote["quotes"][0]["id"]})
            self.assertEqual(response.status_code, 201, response.data)
            self.say(conversation, "Which bills are due?" if lang == "en" else "接下来有哪些账单？")
            self.capture(conversation, "prepare", lang)
