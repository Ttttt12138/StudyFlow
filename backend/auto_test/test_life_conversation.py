from auto_test.test_planning import ConversationHarness
from finance.planning import services
from finance.planning.models import StudyTask


class LifeConversationTests(ConversationHarness):
    def test_one_sentence_creates_task_and_query_does_not_duplicate_it(self):
        services.save_plan(self.user, {"school_key": "psu-phuket"})
        conversation = self.start("zh")
        answer = self.say(conversation, "提醒我明天交住宿材料")
        self.assertIn("已添加", answer["final_answer"])
        self.assertEqual(StudyTask.objects.filter(owner=self.user).count(), 1)
        answer = self.say(conversation, "我的待办有哪些")
        self.assertIn("住宿材料", answer["final_answer"])
        self.assertEqual(StudyTask.objects.filter(owner=self.user).count(), 1)
