"""Contract tests for the Django side of the finance agent (docs/agent.md).

Covered sections: 工具目录, 执行循环约束, 待确认动作, 接口 — plus docs/permissions.md (step-up,
approvals, agent cap) and docs/remittance.md (what a confirmed submit must do).

The planner is the C package's job; for deterministic Django tests `finance.agent_runner.planner`
is patched to return a scripted planner. A *raw* stub (no C-side validation) is used where the
contract places the check on the Django loop ("执行循环约束（Django）", "Django 校验规划器的输出");
a stub that wraps the real `AgentPlanner` is used where the C contract does the validation.
Everything else goes through the real /api/v2/ routes; the ORM is only used to arrange edge cases
(expiry) and to inspect persisted state.
"""
import json
import re
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from studyflow_ai.agent import AgentPlanner, FinalStep, ToolCallStep
from studyflow_ai.models import CallRecord

from auto_test.test_multicurrency import BASE, FX_SETTINGS, HOME, PASSWORD, D, items, model, price
from auto_test.test_remittance import RemittanceHarness
from finance import agent_runner
from finance.agent_models import AgentPendingAction, AgentSession, AgentStep
from finance.agent_tools import TOOLS
from finance.policy_flow import client_flow, step_up_header
from finance.policy_models import ApprovalRequest, StepUpGrant
from finance.workflow_models import Corridor, DemoLedgerEntry, FXQuote

# docs/agent.md 工具目录: tool -> tier.
CATALOG = {
    "get_balances": "T0", "get_fx_rate": "T0", "list_corridors": "T0", "list_beneficiaries": "T0",
    "get_credit_profile": "T0", "list_remittance_orders": "T0", "rank_quotes": "T0",
    "create_live_quote": "T1", "create_remittance_order": "T1",
    "submit_remittance_order": "T2", "convert_balance": "T2",
}
CJK = re.compile(r"[一-鿿]")
NOT_FOUND = re.compile(r"(?i)not.?found|no .* matches|404")


def call(tool, rationale="scripted", **arguments):
    return ToolCallStep(tool=tool, arguments_json=json.dumps(arguments), rationale=rationale)


def raw_call(tool, arguments_json):
    return ToolCallStep(tool=tool, arguments_json=arguments_json, rationale="scripted")


def final(answer="完成。所有资金均为模拟。"):
    return FinalStep(answer=answer)


def record():
    return CallRecord(provider="stub", purpose="plan", model="stub-planner", mode="mock")


class StubPlanner:
    """Raw planner stub: replays a script with no validation, like a misbehaving planner would.

    Each script item is a step or a callable(context) -> step. When the script runs out it
    answers with a final step. Every context it is asked with is kept for assertions.
    """

    def __init__(self, script):
        self.script = list(script)
        self.contexts = []
        self.closed = 0

    def next_step(self, context):
        self.contexts.append(context)
        item = self.script.pop(0) if self.script else final()
        step = item(context) if callable(item) else item
        return step, record()

    def close(self):
        self.closed += 1


class ScriptedProvider:
    """Provider for the real AgentPlanner, so the C-side validation contract is exercised too."""

    def __init__(self, script):
        self.stub = StubPlanner(script)

    def next_step(self, context):
        return self.stub.next_step(context)

    def finish(self, context):
        self.stub.contexts.append(context)
        return final(), record()


class AgentHarness(RemittanceHarness):
    username = "ag-student"

    def bootstrap(self):
        super().bootstrap()
        self.factory_calls = 0

    # ---------------------------------------------------------------- planner patching
    def scripted(self, script, wrap=False):
        """Patch the runner's planner factory; returns (context manager, stub)."""
        if wrap:
            provider = ScriptedProvider(script)
            stub, brain = provider.stub, AgentPlanner(provider)
        else:
            stub = brain = StubPlanner(script)

        def factory():
            self.factory_calls += 1
            return brain
        return patch.object(agent_runner, "planner", factory), stub

    # ---------------------------------------------------------------- sessions API
    def start_raw(self, body, key="__new__", user=None):
        headers = {} if key is None else {"HTTP_IDEMPOTENCY_KEY": str(uuid4()) if key == "__new__" else key}
        self.client.force_authenticate(user or self.user)
        try:
            return self.client.post("/api/v2/agent/sessions/", body, format="json", **headers)
        except Exception as exc:  # an unhandled error means the loop crashed (HTTP 500)
            raise self.failureException("POST agent/sessions/ crashed with %r" % (exc,)) from None
        finally:
            self.client.force_authenticate(self.user)

    def start(self, goal="帮我查一下余额", locale="zh", key="__new__", code=201, user=None):
        response = self.start_raw({"goal": goal, "locale": locale}, key=key, user=user)
        self.assertEqual(response.status_code, code, str(response.data))
        return response.data.get("data", response.data)

    def run_script(self, script, goal="scripted goal", locale="zh", wrap=False):
        context, stub = self.scripted(script, wrap=wrap)
        with context:
            data = self.start(goal, locale)
        return data, stub

    @staticmethod
    def tool_steps(data):
        return [s for s in data["steps"] if s["status"] != "FINAL" and s.get("tool")]

    # ---------------------------------------------------------------- pending actions API
    def confirm_path(self, pending):
        return "agent/pending-actions/" + self.oid(pending) + "/confirm"

    def confirm(self, pending, key=None, user=None):
        """Confirm with the documented step-up (and approval when over the limit), via the API."""
        return self.call(self.confirm_path(pending), {}, key=key, user=user)

    def confirm_bare(self, pending, headers=None, key=None, user=None):
        """Confirm without any step-up token (or with explicit headers)."""
        self.client.force_authenticate(user or self.user)
        try:
            return self.client.post("/api/v2/" + self.confirm_path(pending) + "/", {}, format="json",
                                    HTTP_IDEMPOTENCY_KEY=key or str(uuid4()), **(headers or {}))
        finally:
            self.client.force_authenticate(self.user)

    def reject_action(self, pending, key=None, user=None):
        return self.call("agent/pending-actions/" + self.oid(pending) + "/reject", {}, key=key, user=user)

    def pending_row(self, pending):
        return AgentPendingAction.objects.get(pk=self.oid(pending))

    def debits(self, order):
        return DemoLedgerEntry.objects.filter(remittance_order_id=self.oid(order), remittance_leg="debit")

    def propose_submit(self, order):
        """A session whose stub planner proposes submitting `order`; returns the pending action."""
        data, _ = self.run_script([call("submit_remittance_order", order_id=self.oid(order))])
        proposed = [s for s in data["steps"] if s["status"] == "PROPOSED"]
        self.assertEqual(len(proposed), 1, data["steps"])
        return AgentPendingAction.objects.get(pk=proposed[0]["result"]["pending_action_id"])

    def init_other(self):
        """Give self.other a confirmed state and wallet so it can own quotes and orders."""
        self.client.force_authenticate(self.other)
        try:
            response = self.client.post("/api/v2/state/", {"expected_version": 0, "snapshot": BASE},
                                        format="json")
            self.assertEqual(response.status_code, 201, str(response.data))
        finally:
            self.client.force_authenticate(self.user)
        self.post("demo/initialize", {"state_version": 1}, user=self.other)

    def corridor_id(self, source="CNY", target=HOME, tier="economy"):
        return str(Corridor.objects.get(source_currency=source, target_currency=target, tier=tier).id)

    def money_footprint(self, owner=None):
        owner = owner or self.user
        return {
            "ledger": list(DemoLedgerEntry.objects.filter(owner=owner).order_by("sequence")
                           .values_list("sequence", "currency", "amount")),
            "home": self.home(owner),
            "foreign": sorted(model("WalletBalance").objects.filter(owner=owner)
                              .values_list("currency", "balance")),
            "conversions": model("CurrencyConversion").objects.filter(owner=owner).count(),
            "consumed": FXQuote.objects.filter(owner=owner, consumed_at__isnull=False).count(),
        }


THROTTLE = {**settings.STUDYFLOW_THROTTLE_RATES, "step_up": "1000/hour", "money": "1000/hour"}


@override_settings(**FX_SETTINGS, STUDYFLOW_AI_MODE="mock", STUDYFLOW_THROTTLE_RATES=THROTTLE)
class AgentSessionApiTests(AgentHarness, APITestCase):
    def setUp(self):
        self.bootstrap()

    # ================================================================ POST agent/sessions/
    def test_create_requires_idempotency_key(self):
        context, stub = self.scripted([final()])
        with context:
            response = self.start_raw({"goal": "查余额", "locale": "zh"}, key=None)
            self.assertEqual(response.status_code, 400, str(response.data))
            self.assertIn("Idempotency-Key", str(response.data))
            response = self.start_raw({"goal": "查余额", "locale": "zh"}, key="")
            self.assertEqual(response.status_code, 400, str(response.data))
        self.assertEqual(AgentSession.objects.count(), 0)
        self.assertEqual(stub.contexts, [])

    def test_same_key_same_body_replays_without_running_planner_again(self):
        context, stub = self.scripted([call("get_balances"), final("余额已查询。所有资金均为模拟。")])
        with context:
            first = self.start("查余额", "zh", key="agent-replay")
            asked = len(stub.contexts)
            again = self.start_raw({"goal": "查余额", "locale": "zh"}, key="agent-replay")
        self.assertEqual(again.status_code, 200, str(again.data))
        self.assertEqual(again.data["data"]["id"], first["id"])
        self.assertEqual(again.data["data"]["steps"], first["steps"])
        self.assertEqual(again.data["data"]["final_answer"], first["final_answer"])
        self.assertEqual(asked, 2)
        self.assertEqual(len(stub.contexts), asked, "planner must not be asked again on replay")
        self.assertEqual(self.factory_calls, 1)
        self.assertEqual(AgentSession.objects.filter(owner=self.user).count(), 1)
        self.assertEqual(AgentStep.objects.filter(owner=self.user).count(), 2)

    def test_same_key_different_goal_or_locale_is_rejected(self):
        context, stub = self.scripted([final()])
        with context:
            self.start("查余额", "zh", key="agent-mismatch")
            other_goal = self.start_raw({"goal": "查汇率", "locale": "zh"}, key="agent-mismatch")
            other_locale = self.start_raw({"goal": "查余额", "locale": "en"}, key="agent-mismatch")
        self.assertEqual(other_goal.status_code, 400, str(other_goal.data))
        self.assertEqual(other_locale.status_code, 400, str(other_locale.data))
        self.assertEqual(AgentSession.objects.count(), 1)
        self.assertEqual(len(stub.contexts), 1)

    def test_same_key_is_scoped_per_user(self):
        context, _ = self.scripted([final(), final()])
        with context:
            mine = self.start("查余额", key="shared-key")
            theirs = self.start("查余额", key="shared-key", user=self.other)
        self.assertNotEqual(mine["id"], theirs["id"])

    def test_goal_and_locale_validation(self):
        context, stub = self.scripted([final()])
        with context:
            for body in [{"goal": "x" * 2001, "locale": "zh"}, {"goal": "", "locale": "zh"},
                         {"locale": "zh"}, {"goal": "查余额", "locale": "fr"},
                         {"goal": "查余额", "locale": "zh", "extra": 1}]:
                response = self.start_raw(body)
                self.assertEqual(response.status_code, 400, (body, response.data))
            self.assertEqual(AgentSession.objects.count(), 0)
            self.assertEqual(stub.contexts, [])
            accepted = self.start("x" * 2000, "en")
        self.assertEqual(accepted["status"], "COMPLETED")
        self.assertEqual(stub.contexts[0].goal, "x" * 2000)
        self.assertEqual(stub.contexts[0].locale, "en")

    def test_omitted_locale_follows_negotiated_language(self):
        """Clarified contract: no locale -> Accept-Language zh* gives "zh", anything else "en"."""
        context, stub = self.scripted([final(), final(), final(), final()])
        cases = [("zh-CN,zh;q=0.9", "zh"), ("zh-TW", "zh"), ("en-US,en;q=0.9", "en"), ("th-TH", "en")]
        with context:
            for header, expected in cases:
                self.client.force_authenticate(self.user)
                response = self.client.post("/api/v2/agent/sessions/", {"goal": "查余额"}, format="json",
                                            HTTP_IDEMPOTENCY_KEY=str(uuid4()), HTTP_ACCEPT_LANGUAGE=header)
                self.assertEqual(response.status_code, 201, (header, response.data))
                self.assertEqual(response.data["data"]["locale"], expected, header)
                self.assertEqual(stub.contexts[-1].locale, expected, header)
        # An explicit locale still wins over the header.
        context, stub = self.scripted([final()])
        with context:
            response = self.client.post("/api/v2/agent/sessions/", {"goal": "查余额", "locale": "zh"},
                                        format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()),
                                        HTTP_ACCEPT_LANGUAGE="en-US")
        self.assertEqual(response.data["data"]["locale"], "zh")

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        response = self.client.post("/api/v2/agent/sessions/", {"goal": "查余额", "locale": "zh"},
                                    format="json", HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertIn(response.status_code, (401, 403))
        self.assertEqual(self.client.get("/api/v2/agent/sessions/").status_code in (401, 403), True)

    def test_planner_sees_documented_tool_catalog(self):
        data, stub = self.run_script([final()])
        tools = {t.name: t.tier for t in stub.contexts[0].tools}
        self.assertEqual(tools, CATALOG)
        self.assertEqual(stub.contexts[0].steps_remaining, 10)
        self.assertEqual(stub.contexts[0].observations, [])
        self.assertEqual(stub.closed, 1)
        self.assertEqual(data["status"], "COMPLETED")
        self.assertNotIn("idempotency_key", data)

    # ================================================================ mock planner end-to-end
    def test_mock_planner_zh_remittance_goal_proposes_without_moving_money(self):
        self.fund_foreign("CNY", "40000.00")
        before = self.money_footprint()
        data = self.start("帮我把5000元人民币汇到泰铢，比较一下渠道", "zh")
        self.assertEqual(data["status"], "COMPLETED", data)
        self.assertTrue(data["final_answer"].strip())
        self.assertRegex(data["final_answer"], CJK)
        self.assertIn("模拟", data["final_answer"])
        steps = data["steps"]
        self.assertEqual([s["number"] for s in steps], list(range(1, len(steps) + 1)))
        self.assertEqual(steps[-1]["status"], "FINAL")
        for step in steps[:-1]:
            for field in ("tool", "tier", "status", "arguments", "result"):
                self.assertIn(field, step)
            self.assertEqual(step["tier"], CATALOG[step["tool"]], step)
            self.assertIsInstance(step["arguments"], dict)
            if step["tier"] == "T2":
                self.assertEqual(step["status"], "PROPOSED", step)
            else:
                self.assertEqual(step["status"], "OK", step)
        used = [s["tool"] for s in steps[:-1]]
        for tool in ("get_balances", "list_corridors", "create_live_quote", "rank_quotes",
                     "create_remittance_order", "submit_remittance_order"):
            self.assertIn(tool, used)
        # Documented result fields.
        by_tool = {s["tool"]: s for s in steps[:-1]}
        self.assertIn("balances", by_tool["get_balances"]["result"])
        self.assertIn("corridors", by_tool["list_corridors"]["result"])
        self.assertIn("ranked", by_tool["rank_quotes"]["result"])
        self.assertIn("recommended_quote_id", by_tool["rank_quotes"]["result"])
        proposed = by_tool["submit_remittance_order"]
        for field in ("pending_action_id", "expires_at", "requires"):
            self.assertIn(field, proposed["result"])
        order_id = by_tool["create_remittance_order"]["result"]["id"]
        self.assertEqual(proposed["arguments"], {"order_id": order_id})
        # Exactly one pending action for the order, with the order's amount and currency.
        order = self.db(order_id)
        pending = AgentPendingAction.objects.filter(owner=self.user)
        self.assertEqual(pending.count(), 1)
        row = pending.get()
        self.assertEqual((row.status, row.action, str(row.target_id)), ("PENDING", "remittance.submit", order_id))
        self.assertEqual((row.amount, row.currency), (order.send_amount, order.send_currency))
        self.assertEqual((order.send_amount, order.send_currency), (Decimal("5000.00"), "CNY"))
        self.assertEqual(str(row.id), proposed["result"]["pending_action_id"])
        self.assertAlmostEqual((row.expires_at - row.created_at).total_seconds(), 900, delta=5)
        self.assertEqual([p["id"] for p in data["pending_actions"]], [str(row.id)])
        # Nothing moved: balances, ledger and consumed quotes unchanged; order still CREATED.
        self.assertEqual(self.money_footprint(), before)
        self.assertEqual(self.foreign("CNY"), Decimal("40000.00"))
        self.assertEqual((order.status, order.version), ("CREATED", 1))
        self.assertEqual(self.debits(order).count(), 0)
        self.assert_invariant()

    # ================================================================ safety (stub planner)
    def test_t2_tools_never_execute_regardless_of_arguments(self):
        order, order_quote = self.new_order(amount="1000.00")
        self.fund_foreign("CNY", "3000.00")
        conv_quote = self.live_quote("CNY", HOME, "1000.00")
        before = self.money_footprint()
        order_id, quote_id = self.oid(order), self.oid(conv_quote)
        script = [
            call("submit_remittance_order", order_id=order_id, execute=True, confirm=True,
                 step_up_token="forged", amount="1.00"),
            call("submit_remittance_order", order_id=order_id),
            call("convert_balance", quote_id=quote_id, source_amount="1000.00", execute=True),
            call("convert_balance", quote_id=quote_id, source_amount="1000.00"),
        ]
        data, _ = self.run_script(script)
        t2 = [s for s in self.tool_steps(data) if s["tier"] == "T2"]
        self.assertEqual(len(t2), 4)
        for step in t2:
            self.assertIn(step["status"], {"PROPOSED", "ERROR", "DENIED"}, step)
            self.assertNotEqual(step["status"], "OK")
        proposed = [s for s in t2 if s["status"] == "PROPOSED"]
        self.assertEqual(len(proposed), 2)
        for step in proposed:
            self.assertIs(step["result"].get("executed"), False)
        self.assertEqual(self.money_footprint(), before)
        row = self.db(order)
        self.assertEqual((row.status, row.version), ("CREATED", 1))
        self.assertIsNone(FXQuote.objects.get(pk=self.oid(order_quote)).consumed_at)
        self.assertIsNone(FXQuote.objects.get(pk=quote_id).consumed_at)
        self.assertEqual(self.debits(order).count(), 0)
        submit = AgentPendingAction.objects.get(owner=self.user, action="remittance.submit")
        self.assertEqual((submit.amount, submit.currency, submit.status), (row.send_amount, "CNY", "PENDING"))
        convert = AgentPendingAction.objects.get(owner=self.user, action="wallet.convert")
        self.assertEqual((convert.amount, convert.currency, str(convert.target_id), convert.status),
                         (Decimal("1000.00"), "CNY", quote_id, "PENDING"))
        self.assert_invariant()

    def test_unknown_tool_fails_session_with_invalid_tool_call(self):
        """Raw planner output naming a tool outside the catalogue (incl. an operator action)."""
        for tool in ("transfer_all_funds", "adapter_event"):
            with self.subTest(tool=tool):
                before = self.money_footprint()
                data, _ = self.run_script([call(tool, order_id=str(uuid4())), call("get_balances")])
                self.assertEqual(data["status"], "FAILED", data)
                self.assertEqual(data["error_code"], "INVALID_TOOL_CALL")
                self.assertTrue(data["final_answer"].strip())
                self.assertEqual([s for s in self.tool_steps(data) if s["status"] in {"OK", "PROPOSED"}], [])
                self.assertEqual(self.money_footprint(), before)

    def test_unknown_tool_via_real_planner_validation_fails_session(self):
        data, stub = self.run_script([call("transfer_all_funds", amount="99999")], wrap=True)
        self.assertEqual(data["status"], "FAILED", data)
        self.assertEqual(data["error_code"], "INVALID_TOOL_CALL")
        self.assertTrue(data["final_answer"].strip())
        self.assertEqual([s for s in data["steps"] if s["status"] in {"OK", "PROPOSED"}], [])
        self.assertEqual(AgentPendingAction.objects.count(), 0)

    def test_non_object_arguments_never_execute_and_do_not_crash(self):
        for arguments_json in ("[1, 2]", "{not json", '"get"'):
            with self.subTest(arguments=arguments_json):
                data, _ = self.run_script([raw_call("get_balances", arguments_json)])
                self.assertIn(data["status"], {"COMPLETED", "FAILED"}, data)
                first = data["steps"][0]
                self.assertNotIn(first["status"], {"OK", "PROPOSED"}, first)

    def test_argument_validation_error_is_step_error_and_loop_continues(self):
        script = [call("get_fx_rate", base="CNYX", quote="THB"),
                  call("get_balances"),
                  final("查到了余额。所有资金均为模拟。")]
        data, stub = self.run_script(script)
        self.assertEqual(data["status"], "COMPLETED", data)
        statuses = [(s["tool"], s["status"]) for s in data["steps"]]
        self.assertEqual(statuses, [("get_fx_rate", "ERROR"), ("get_balances", "OK"), ("", "FINAL")])
        self.assertIn("error", data["steps"][0]["result"])
        # The planner saw the error as an observation on its next turn.
        seen = stub.contexts[1].observations
        self.assertEqual([(o.tool, o.status) for o in seen], [("get_fx_rate", "ERROR")])
        self.assertEqual(stub.contexts[1].steps_remaining, 9)

    def test_missing_required_argument_from_raw_planner_is_step_error(self):
        data, _ = self.run_script([call("create_live_quote", send_amount="1000.00"), call("get_balances")])
        self.assertEqual([(s["tool"], s["status"]) for s in self.tool_steps(data)],
                         [("create_live_quote", "ERROR"), ("get_balances", "OK")])
        self.assertEqual(FXQuote.objects.filter(owner=self.user).count(), 0)

    def test_other_users_ids_are_not_found_and_not_leaked(self):
        self.init_other()
        self.fund_foreign("CNY", "1000.00")
        other_quote = self.live_quote("CNY", HOME, "1234.00", user=self.other)
        other_order_quote = self.live_quote("CNY", HOME, "1500.00", user=self.other)
        other_order = self.create(other_order_quote, user=self.other)
        own_quote = self.live_quote("CNY", HOME, "1000.00")
        before_other = self.money_footprint(self.other)
        script = [
            call("rank_quotes", quote_ids=[self.oid(other_quote), self.oid(own_quote)]),
            call("create_remittance_order", quote_id=self.oid(other_quote), recipient="SELF", purpose="other"),
            call("submit_remittance_order", order_id=self.oid(other_order)),
            call("convert_balance", quote_id=self.oid(other_quote), source_amount="1234.00"),
        ]
        data, _ = self.run_script(script)
        steps = self.tool_steps(data)
        self.assertEqual([(s["tool"], s["status"]) for s in steps],
                         [(c.tool, "ERROR") for c in script])
        secrets = {self.other.username, other_quote["rate"], other_quote["quoted_amount"],
                   other_order["send_amount"], other_order["receive_amount"], "1234", "1500",
                   other_quote["route_name"]}
        for step in steps:
            text = json.dumps(step["result"], ensure_ascii=False)
            self.assertRegex(text, NOT_FOUND)
            for secret in secrets:
                self.assertNotIn(str(secret), text, step)
            for field in ("quoted_amount", "send_amount", "balance", "rate", "owner"):
                self.assertNotIn('"' + field + '"', text, step)
        self.assertEqual(AgentPendingAction.objects.count(), 0)
        self.assertEqual(model("RemittanceOrder").objects.filter(owner=self.user).count(), 0)
        self.assertEqual(self.db(other_order).status, "CREATED")
        self.assertEqual(self.money_footprint(self.other), before_other)

    def test_fifth_t1_write_is_denied_by_write_budget(self):
        corridor = self.corridor_id()
        script = [call("create_live_quote", corridor_id=corridor, send_amount="%d.00" % (1000 + i))
                  for i in range(5)]
        data, _ = self.run_script(script)
        steps = self.tool_steps(data)
        self.assertEqual([s["status"] for s in steps], ["OK"] * 4 + ["DENIED"])
        self.assertEqual(steps[4]["result"].get("error"), "WRITE_BUDGET_EXHAUSTED")
        self.assertEqual(FXQuote.objects.filter(owner=self.user).count(), 4)
        self.assertFalse(FXQuote.objects.filter(owner=self.user, quoted_amount=Decimal("1004.00")).exists())
        self.assertEqual(AgentSession.objects.get(pk=data["id"]).write_count, 4)

    def test_t0_reads_still_run_after_write_budget_is_spent(self):
        corridor = self.corridor_id()
        script = [call("create_live_quote", corridor_id=corridor, send_amount="%d.00" % (1000 + i))
                  for i in range(4)] + [call("create_live_quote", corridor_id=corridor, send_amount="2000.00"),
                                        call("get_balances")]
        data, _ = self.run_script(script)
        self.assertEqual([s["status"] for s in self.tool_steps(data)], ["OK"] * 4 + ["DENIED", "OK"])

    def test_step_budget_asks_planner_with_zero_steps_after_ten_calls(self):
        def until_zero(context):
            return final("预算用完。所有资金均为模拟。") if context.steps_remaining == 0 else call("get_balances")
        data, stub = self.run_script([until_zero] * 20)
        self.assertEqual(data["status"], "COMPLETED", data)
        self.assertEqual(len(self.tool_steps(data)), 10)
        self.assertEqual([c.steps_remaining for c in stub.contexts], list(range(10, -1, -1)))
        self.assertEqual(data["steps"][-1]["status"], "FINAL")
        self.assertEqual(data["final_answer"], "预算用完。所有资金均为模拟。")

    def test_step_budget_is_enforced_even_if_planner_keeps_calling_tools(self):
        """Raw planner ignores steps_remaining=0: the Django loop must not run an 11th tool call."""
        corridor = self.corridor_id()
        script = [call("get_balances")] * 10 + [call("create_live_quote", corridor_id=corridor,
                                                     send_amount="1000.00")] * 5
        data, stub = self.run_script(script)
        self.assertLessEqual(len(self.tool_steps(data)), 10, [s["tool"] for s in data["steps"]])
        self.assertIn(data["status"], {"COMPLETED", "FAILED"})
        self.assertEqual(FXQuote.objects.filter(owner=self.user).count(), 0)
        self.assertEqual(stub.contexts[-1].steps_remaining, 0)

    def test_two_consecutive_failures_of_same_tool_stop_the_loop(self):
        """docs/agent.md 执行循环约束: stop when a tool's two most recent calls both failed."""
        script = [call("get_fx_rate", base="XXXX", quote="THB")] * 4 + [call("get_balances")]
        data, _ = self.run_script(script)
        failing = [s for s in self.tool_steps(data) if s["tool"] == "get_fx_rate"]
        self.assertEqual(len(failing), 2, [(s["tool"], s["status"]) for s in data["steps"]])
        self.assertNotIn("get_balances", [s["tool"] for s in self.tool_steps(data)])
        self.assertIn(data["status"], {"COMPLETED", "FAILED"})
        self.assertTrue(data["final_answer"].strip())

    def test_rank_without_on_time_route_stops_before_creating_order(self):
        """docs/agent.md: recommended_quote_id null -> stop and explain, no order is created."""
        self.fund_foreign("CNY", "3000.00")
        quotes = [self.live_quote("CNY", HOME, "1000.00", tier=t) for t in ("economy", "express")]
        script = [call("rank_quotes", quote_ids=[q["id"] for q in quotes], deadline="2000-01-01"),
                  call("create_remittance_order", quote_id=quotes[0]["id"], recipient="SELF", purpose="other")]
        data, _ = self.run_script(script)
        ranked = data["steps"][0]
        self.assertEqual((ranked["tool"], ranked["status"]), ("rank_quotes", "OK"))
        self.assertIsNone(ranked["result"]["recommended_quote_id"])
        self.assertEqual(model("RemittanceOrder").objects.filter(owner=self.user).count(), 0)
        self.assertNotIn("create_remittance_order",
                         [s["tool"] for s in self.tool_steps(data) if s["status"] == "OK"])

    def test_proposing_same_t2_target_twice_is_already_proposed(self):
        order, _ = self.new_order(amount="1000.00")
        script = [call("submit_remittance_order", order_id=self.oid(order)),
                  call("get_balances"),
                  call("submit_remittance_order", order_id=self.oid(order))]
        data, _ = self.run_script(script)
        steps = self.tool_steps(data)
        self.assertEqual([s["status"] for s in steps], ["PROPOSED", "OK", "ERROR"])
        self.assertIn("ALREADY_PROPOSED", json.dumps(steps[2]["result"]))
        self.assertEqual(AgentPendingAction.objects.filter(owner=self.user).count(), 1)
        # A later session cannot open a second pending action for the same target either.
        again, _ = self.run_script([call("submit_remittance_order", order_id=self.oid(order))])
        self.assertEqual(self.tool_steps(again)[0]["status"], "ERROR")
        self.assertIn("ALREADY_PROPOSED", json.dumps(self.tool_steps(again)[0]["result"]))
        self.assertEqual(AgentPendingAction.objects.filter(owner=self.user).count(), 1)

    def test_huge_tool_result_is_truncated_before_reaching_planner(self):
        huge = {"rows": ["r%05d-%s" % (i, "x" * 40) for i in range(500)]}
        self.assertGreater(len(json.dumps(huge)), 4000)
        with patch.object(TOOLS["get_balances"], "handler", lambda user, data: huge):
            data, stub = self.run_script([call("get_balances")])
        step = data["steps"][0]
        self.assertEqual(step["status"], "OK")
        observed = stub.contexts[1].observations[0].result
        self.assertNotEqual(observed, huge)
        self.assertEqual(observed, step["result"])
        self.assertNotIn("r00499", json.dumps(observed))

    def test_truncated_tool_result_is_at_most_4000_characters(self):
        huge = {"text": 'say "hi" ' * 2000}
        with patch.object(TOOLS["get_balances"], "handler", lambda user, data: huge):
            data, stub = self.run_script([call("get_balances")])
        observed = stub.contexts[1].observations[0].result
        self.assertLessEqual(len(json.dumps(observed, ensure_ascii=False)), 4000)
        self.assertLessEqual(len(json.dumps(data["steps"][0]["result"], ensure_ascii=False)), 4000)

    def test_agent_steps_are_immutable_in_the_database(self):
        data, _ = self.run_script([call("get_balances")])
        step = AgentStep.objects.filter(session_id=data["id"]).first()
        with self.assertRaises(DatabaseError), transaction.atomic():
            AgentStep.objects.filter(pk=step.pk).update(status="ERROR")
        with self.assertRaises(DatabaseError), transaction.atomic():
            AgentStep.objects.filter(pk=step.pk).update(result={"forged": True})
        with self.assertRaises(DatabaseError), transaction.atomic():
            AgentStep.objects.filter(pk=step.pk).delete()
        step.refresh_from_db()
        self.assertEqual(step.status, "OK")

    # ================================================================ confirm / reject
    def test_confirm_without_step_up_is_refused(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        before = self.money_footprint()
        response = self.confirm_bare(pending)
        self.assertEqual(response.status_code, 403, str(response.data))
        self.assertEqual(response.data["detail"], "STEP_UP_REQUIRED")
        policy = response.data["policy"]
        self.assertEqual((policy["action"], policy["target_id"], policy["amount"], policy["currency"]),
                         ("remittance.submit", self.oid(order), "1000.00", "CNY"))
        self.assertEqual(policy["requires"], ["step_up"])
        self.assertEqual(self.pending_row(pending).status, "PENDING")
        self.assertEqual(self.db(order).status, "CREATED")
        self.assertEqual(self.money_footprint(), before)

    def test_confirm_from_agent_is_capped_at_t1(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        headers = step_up_header(client_flow(self.user, PASSWORD, None), self.confirm_path(pending), {})
        headers["HTTP_X_STUDYFLOW_AGENT"] = "w4"
        response = self.confirm_bare(pending, headers=headers)
        self.assertEqual(response.status_code, 403, str(response.data))
        self.assertEqual(response.data["detail"], "AGENT_TIER_EXCEEDED")
        self.assertEqual(self.debits(order).count(), 0)
        self.assertEqual(self.pending_row(pending).status, "PENDING")

    def test_step_up_for_another_target_is_invalid(self):
        order, _ = self.new_order(amount="1000.00")
        decoy, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        headers = step_up_header(client_flow(self.user, PASSWORD, None),
                                 "remittance-orders/" + self.oid(decoy) + "/submit",
                                 {"expected_version": 1})
        response = self.confirm_bare(pending, headers=headers)
        self.assertEqual(response.status_code, 403, str(response.data))
        self.assertEqual(response.data["detail"], "STEP_UP_INVALID")
        self.assertEqual(self.debits(order).count() + self.debits(decoy).count(), 0)

    def test_confirm_with_step_up_submits_order_and_consumes_grant(self):
        order, quote = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        response = self.confirm(pending)
        self.assertEqual(response.status_code, 201, str(response.data))
        self.assertEqual(response.data["data"]["status"], "CONFIRMED")
        row = self.db(order)
        self.assertEqual((row.status, row.version), ("SUBMITTED", 2))
        debits = self.debits(order)
        self.assertEqual(debits.count(), 1)
        self.assertEqual(debits.get().amount, -Decimal("1000.00"))
        self.assertEqual(self.foreign("CNY"), Decimal("0.00"))
        self.assertIsNotNone(FXQuote.objects.get(pk=quote["id"]).consumed_at)
        saved = self.pending_row(pending)
        self.assertEqual(saved.status, "CONFIRMED")
        self.assertIsNotNone(saved.decided_at)
        grants = StepUpGrant.objects.filter(owner=self.user, action="remittance.submit",
                                            target_id=self.oid(order))
        self.assertEqual(grants.count(), 1)
        self.assertIsNotNone(grants.get().used_at)
        self.assertEqual(self.history_rows(order), [("", "CREATED", 1), ("CREATED", "SUBMITTED", 2)])
        self.assert_invariant()

    def test_mock_session_then_confirm_end_to_end(self):
        self.fund_foreign("CNY", "40000.00")
        data = self.start("帮我把5000元人民币汇到泰铢，比较一下渠道", "zh")
        pending = data["pending_actions"][0]
        response = self.confirm(pending)
        self.assertEqual(response.status_code, 201, str(response.data))
        self.assertEqual(self.foreign("CNY"), Decimal("35000.00"))
        self.assertEqual(self.db(pending["target_id"]).status, "SUBMITTED")
        self.assert_invariant()

    def test_over_limit_confirm_requires_approval_then_succeeds(self):
        order, _ = self.new_order(amount="12000.00")
        pending = self.propose_submit(order)
        # Step-up alone (no approval) is not enough for a T3 amount.
        headers = step_up_header(client_flow(self.user, PASSWORD, None), self.confirm_path(pending), {})
        self.assertTrue(headers)
        denied = self.confirm_bare(pending, headers=headers)
        self.assertEqual(denied.status_code, 403, str(denied.data))
        self.assertEqual(denied.data["detail"], "APPROVAL_REQUIRED")
        self.assertEqual(denied.data["policy"]["tier"], "T3")
        self.assertIn("approval", denied.data["policy"]["requires"])
        self.assertEqual(self.debits(order).count(), 0)
        self.assertEqual(self.pending_row(pending).status, "PENDING")
        # The harness flow requests an approval, has the non-verifier staff approve it, then steps up.
        response = self.confirm(pending)
        self.assertEqual(response.status_code, 201, str(response.data))
        self.assertEqual(self.pending_row(pending).status, "CONFIRMED")
        self.assertEqual(self.db(order).status, "SUBMITTED")
        self.assertEqual(self.debits(order).count(), 1)
        approval = ApprovalRequest.objects.get(owner=self.user, action="remittance.submit",
                                               target_id=self.oid(order))
        self.assertEqual(approval.status, "USED")
        self.assertEqual(approval.decided_by, self.approver)
        self.assertEqual(approval.amount, Decimal("12000.00"))
        self.assert_invariant()

    def test_confirm_by_another_user_is_not_found(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        response = self.confirm(pending, user=self.other)
        self.assertEqual(response.status_code, 404, str(response.data))
        response = self.reject_action(pending, user=self.other)
        self.assertEqual(response.status_code, 404, str(response.data))
        self.assertEqual(self.pending_row(pending).status, "PENDING")
        self.assertEqual(self.debits(order).count(), 0)

    def test_confirm_after_expiry_expires_without_debit(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        AgentPendingAction.objects.filter(pk=pending.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1))
        before = self.money_footprint()
        response = self.confirm(pending)
        self.assertLess(response.status_code, 500, str(response.data))
        self.assertEqual(self.pending_row(pending).status, "EXPIRED")
        self.assertEqual(self.debits(order).count(), 0)
        self.assertEqual(self.db(order).status, "CREATED")
        self.assertEqual(self.money_footprint(), before)
        # And it can no longer be confirmed afterwards.
        again = self.confirm(pending)
        self.assertEqual(self.pending_row(pending).status, "EXPIRED")
        self.assertEqual(self.debits(order).count(), 0)
        self.assertNotEqual(again.data.get("data", {}).get("status"), "CONFIRMED", again.data)

    def test_confirm_of_confirmed_action_replays_without_second_debit(self):
        order, _ = self.new_order(amount="1000.00")
        self.fund_foreign("CNY", "1000.00")  # room for a second debit if the guard failed
        pending = self.propose_submit(order)
        first = self.confirm(pending, key="confirm-once")
        self.assertEqual(first.status_code, 201, str(first.data))
        same_key = self.confirm(pending, key="confirm-once")
        self.assertEqual(same_key.status_code, 200, str(same_key.data))
        self.assertEqual(same_key.data, first.data)
        new_key = self.confirm(pending)
        self.assertIn(new_key.status_code, (200, 201), str(new_key.data))
        self.assertEqual(new_key.data["data"]["status"], "CONFIRMED")
        self.assertEqual(self.debits(order).count(), 1)
        self.assertEqual(self.foreign("CNY"), Decimal("1000.00"))
        self.assertEqual(self.db(order).version, 2)
        self.assert_invariant()

    def test_reject_moves_nothing_and_closes_the_action(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        before = self.money_footprint()
        response = self.reject_action(pending)
        self.assertEqual(response.status_code, 201, str(response.data))
        self.assertEqual(response.data["data"]["status"], "REJECTED")
        self.assertEqual(self.pending_row(pending).status, "REJECTED")
        self.assertEqual(self.money_footprint(), before)
        self.assertEqual(self.db(order).status, "CREATED")
        closed = self.confirm(pending)
        self.assertEqual(closed.status_code, 400, str(closed.data))
        self.assertIn("PENDING_ACTION_CLOSED", str(closed.data))
        self.assertEqual(self.pending_row(pending).status, "REJECTED")
        self.assertEqual(self.debits(order).count(), 0)
        self.assertEqual(self.money_footprint(), before)

    def test_reject_after_confirm_is_closed(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        self.assertEqual(self.confirm(pending).status_code, 201)
        response = self.reject_action(pending)
        self.assertEqual(response.status_code, 400, str(response.data))
        self.assertIn("PENDING_ACTION_CLOSED", str(response.data))
        self.assertEqual(self.pending_row(pending).status, "CONFIRMED")

    def test_rejected_target_can_be_proposed_again(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        self.reject_action(pending)
        again = self.propose_submit(order)
        self.assertNotEqual(again.pk, pending.pk)
        self.assertEqual(again.status, "PENDING")

    def test_convert_proposal_confirm_uses_current_state_version(self):
        self.fund_foreign("CNY", "5000.00")
        data = self.start("Convert 2000 CNY to THB", "en")
        self.assertEqual(data["status"], "COMPLETED", data)
        self.assertRegex(data["final_answer"], r"(?i)simulat")
        proposed = [s for s in data["steps"] if s["status"] == "PROPOSED"]
        self.assertEqual([s["tool"] for s in proposed], ["convert_balance"])
        pending = AgentPendingAction.objects.get(pk=proposed[0]["result"]["pending_action_id"])
        self.assertEqual((pending.action, pending.amount, pending.currency),
                         ("wallet.convert", Decimal("2000.00"), "CNY"))
        quote = FXQuote.objects.get(pk=pending.target_id)
        self.assertIsNone(quote.consumed_at)
        self.assertEqual(model("CurrencyConversion").objects.filter(owner=self.user).count(), 0)
        # The financial state moves on between proposal and confirmation.
        state = self.state()
        response = self.client.post("/api/v2/state/", {"expected_version": state.version,
                                                       "snapshot": state.snapshot}, format="json")
        self.assertEqual(response.status_code, 201, str(response.data))
        self.assertEqual(self.version(), state.version + 1)
        home_before = self.home()
        response = self.confirm(pending)
        self.assertEqual(response.status_code, 201, str(response.data))
        self.assertEqual(self.pending_row(pending).status, "CONFIRMED")
        conversion = model("CurrencyConversion").objects.get(owner=self.user)
        self.assertEqual((conversion.quote_id, conversion.source_amount), (quote.pk, Decimal("2000.00")))
        expected = price(self.corridor("CNY", HOME, quote.corridor.tier), "2000.00")["target"]
        self.assertEqual(conversion.target_amount, expected)
        self.assertEqual(self.foreign("CNY"), Decimal("3000.00"))
        self.assertEqual(self.home(), home_before + expected)
        self.assertIsNotNone(FXQuote.objects.get(pk=quote.pk).consumed_at)
        grant = StepUpGrant.objects.get(owner=self.user, action="wallet.convert", target_id=quote.pk)
        self.assertIsNotNone(grant.used_at)
        self.assert_invariant()

    # ================================================================ GET list/detail
    def test_list_and_detail_are_owner_scoped(self):
        context, _ = self.scripted([final(), final(), final()])
        with context:
            mine = self.start("查余额")
            mine2 = self.start("查汇率")
            theirs = self.start("查余额", user=self.other)
        listed = self.get("agent/sessions")
        self.assertEqual(listed.status_code, 200, str(listed.data))
        self.assertEqual({row["id"] for row in items(listed.data)}, {mine["id"], mine2["id"]})
        for row in items(listed.data):
            self.assertNotIn("idempotency_key", row)
        other_list = self.get("agent/sessions", user=self.other)
        self.assertEqual([row["id"] for row in items(other_list.data)], [theirs["id"]])
        detail = self.get("agent/sessions/" + mine["id"])
        self.assertEqual(detail.status_code, 200, str(detail.data))
        self.assertEqual(detail.data["data"]["id"], mine["id"])
        self.assertEqual(detail.data["data"]["steps"], mine["steps"])
        self.assertEqual(self.get("agent/sessions/" + theirs["id"]).status_code, 404)
        self.assertEqual(self.get("agent/sessions/" + mine["id"], user=self.other).status_code, 404)
        self.assertEqual(self.get("agent/sessions/" + str(uuid4())).status_code, 404)

    def test_detail_shows_pending_action_status_changes(self):
        order, _ = self.new_order(amount="1000.00")
        pending = self.propose_submit(order)
        self.confirm(pending)
        detail = self.get("agent/sessions/" + str(pending.session_id)).data["data"]
        self.assertEqual([(p["id"], p["status"]) for p in detail["pending_actions"]],
                         [(str(pending.pk), "CONFIRMED")])
