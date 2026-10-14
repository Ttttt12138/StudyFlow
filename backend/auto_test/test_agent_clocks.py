"""The planner must not compare real quote expiry against the simulated study date."""
from datetime import date, datetime
from datetime import timezone as utc
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils.dateparse import parse_datetime
from finance import agent_runner
from finance.agent_models import AgentSession
from finance.planning.conversation import _memory
from finance.planning.models import AgentConversation, PlanningProfile

from auto_test.test_agent import StubPlanner, final


class AgentClockTests(TestCase):
    def test_server_clock_is_explicit_when_demo_date_is_in_the_future_or_past(self):
        user = get_user_model().objects.create_user("clock-student")
        profile = PlanningProfile.objects.create(owner=user, demo_date=date(2027, 9, 8))
        conversation = AgentConversation.objects.create(owner=user, locale="en")
        now = datetime(2026, 10, 14, 14, 30, tzinfo=utc.utc)
        for day in (date(2027, 9, 8), date(2025, 8, 1)):
            with self.subTest(demo_date=day):
                profile.demo_date = day
                profile.save()
                memory = _memory(conversation)
                turn = AgentSession.objects.create(owner=user, goal="Explain a quote", locale="en", mode="mock", idempotency_key=day.isoformat())
                planner = StubPlanner([final("No money moved.")])
                with patch.object(agent_runner, "planner", return_value=planner), patch.object(agent_runner.timezone, "now", return_value=now):
                    agent_runner.run(turn, memory=memory)
                context = planner.contexts[0]
                self.assertEqual(context.memory["today"], day.isoformat())
                self.assertEqual(parse_datetime(context.memory["server_time"]), now)
                self.assertNotIn("server_time", memory, "Adding the server clock must not mutate the caller's facts")
