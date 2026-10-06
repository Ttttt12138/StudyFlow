"""One-step-at-a-time planner for the finance agent (docs/agent.md)."""

import json
import re
from decimal import Decimal, InvalidOperation

from studyflow_ai.agent import prompts
from studyflow_ai.agent.models import AgentContext, FinalStep, PlannerOutput, ToolCallStep
from studyflow_ai.models import CallRecord
from studyflow_ai.providers.base import ProviderFailure


class AgentPlanner:
    def __init__(self, provider):
        self.provider = provider

    @classmethod
    def from_settings(cls, settings):
        if settings.mode == "mock":
            return cls(RuleAgentProvider())
        from studyflow_ai.config import providers

        _, llm = providers(settings)
        return cls(LiveAgentProvider(llm))

    def next_step(self, context: AgentContext):
        if context.steps_remaining == 0:
            step, record = self.provider.finish(context)
            if not isinstance(step, FinalStep):
                record.error_code = "INVALID_TOOL_CALL"
                raise ProviderFailure("INVALID_TOOL_CALL", record)
        else:
            step, record = self.provider.next_step(context)
        if isinstance(step, ToolCallStep):
            validate_call(step, context, record)
        return step, record

    def close(self):
        if hasattr(self.provider, "close"):
            self.provider.close()


def parse_arguments(step: ToolCallStep):
    try:
        value = json.loads(step.arguments_json)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def validate_call(step, context, record):
    spec = context.tool(step.tool)
    arguments = parse_arguments(step)
    if spec is None or arguments is None or any(k not in arguments for k in spec.required):
        record.error_code = "INVALID_TOOL_CALL"
        raise ProviderFailure("INVALID_TOOL_CALL", record)


class LiveAgentProvider:
    def __init__(self, openai_provider):
        self.provider = openai_provider

    def _call(self, context, instruction):
        try:
            output, record = self.provider._request(
                "plan", context.model_dump_json(), PlannerOutput, instruction)
        except ProviderFailure as exc:
            exc.record.prompt_version = prompts.VERSION
            raise
        record.prompt_version = prompts.VERSION
        return output.step, record

    def next_step(self, context):
        return self._call(context, prompts.AGENT)

    def finish(self, context):
        step, record = self._call(context, prompts.AGENT + "\nReturn kind=final now.")
        if not isinstance(step, FinalStep):
            record.error_code = "INVALID_TOOL_CALL"
            raise ProviderFailure("INVALID_TOOL_CALL", record)
        return step, record

    def close(self):
        if hasattr(self.provider, "close"):
            self.provider.close()


# --- deterministic mock -------------------------------------------------------------------

CURRENCY_WORDS = [  # longer tokens first so 美元 is not read as 元
    ("人民币", "CNY"), ("美元", "USD"), ("欧元", "EUR"), ("泰铢", "THB"), ("英镑", "GBP"),
    ("日元", "JPY"), ("元", "CNY"), ("rmb", "CNY"), ("yuan", "CNY"), ("baht", "THB"),
    ("dollars", "USD"), ("dollar", "USD"), ("euros", "EUR"), ("euro", "EUR"),
    ("cny", "CNY"), ("thb", "THB"), ("usd", "USD"), ("eur", "EUR"), ("gbp", "GBP"), ("jpy", "JPY"),
]
REMIT = ("汇款", "汇到", "汇给", "汇去", "转账", "交学费", "付学费", "支付", "send", "transfer",
         "remit", "wire", "pay")
CONVERT = ("兑换", "换成", "换汇", "换", "convert", "exchange")
RATE = ("汇率", "exchange rate", "rate")
DATE = re.compile(r"(?<!\d)(20\d\d-\d\d-\d\d)(?!\d)")
BALANCE = ("余额", "balance")
CREDIT = ("信用", "credit")
ORDERS = ("订单", "进度", "order", "status", "到账了")
TUITION = ("学费", "学校", "tuition", "university", "school")
FAMILY = ("家里", "家人", "父母", "family", "parents", "home")


class Intent:
    def __init__(self, goal):
        text = goal.lower()
        match = DATE.search(text)
        self.deadline = match.group(1) if match else None
        self.amount = self._amount(DATE.sub(" ", text))
        self.kind = self._kind(text, self.amount)
        self.source, self.target = self._currencies(text)
        self.tuition = any(w in text for w in TUITION)
        self.family = any(w in text for w in FAMILY)

    @staticmethod
    def _kind(text, amount):
        stripped = text
        for word in RATE:
            stripped = stripped.replace(word, " ")
        # "Has my remittance order arrived?" asks about orders, not for a new transfer.
        if amount is None and any(w in text for w in ORDERS):
            return "orders"
        if any(w in stripped for w in REMIT):
            return "remit"
        if any(w in stripped for w in CONVERT):
            return "convert"
        if any(w in text for w in RATE):
            return "rate"
        if any(w in text for w in CREDIT):
            return "credit"
        if any(w in text for w in ORDERS):
            return "orders"
        if any(w in text for w in BALANCE):
            return "balance"
        return "unknown"

    @staticmethod
    def _amount(text):
        match = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*(k|千|万)?", text)
        if not match:
            return None
        try:
            value = Decimal(match.group(1).replace(",", ""))
        except InvalidOperation:
            return None
        value *= {"k": 1000, "千": 1000, "万": 10000}.get(match.group(2) or "", 1)
        return value if value > 0 else None

    @staticmethod
    def _currencies(text):
        found, rest = [], text
        for word, code in CURRENCY_WORDS:
            pattern = word if not word.isascii() else rf"\b{word}\b"
            for match in re.finditer(pattern, rest):
                found.append((match.start(), code))
            rest = re.sub(pattern, lambda m: " " * len(m.group(0)), rest)
        ordered = []
        for _, code in sorted(found):
            if code not in ordered:
                ordered.append(code)
        source = ordered[0] if ordered else None
        target = ordered[1] if len(ordered) > 1 else None
        if source and not target:
            target = "THB" if source != "THB" else "CNY"
        return source, target


def _obs(context, tool):
    return [o for o in context.observations if o.tool == tool]


def _last_ok(context, tool):
    found = [o for o in _obs(context, tool) if o.status in ("OK", "PROPOSED")]
    return found[-1] if found else None


def _money(value):
    return format(Decimal(str(value)).quantize(Decimal("0.01")), "f")


class RuleAgentProvider:
    """Deterministic scripted planner for CI and offline demos; never used in live mode."""

    def _record(self):
        return CallRecord(provider="rules", purpose="plan", model="agent-rules", mode="mock",
                          prompt_version=prompts.VERSION)

    def _call(self, tool, rationale, **arguments):
        return ToolCallStep(tool=tool, arguments_json=json.dumps(arguments), rationale=rationale)

    def _final(self, context, zh, en):
        return FinalStep(answer=zh if context.locale == "zh" else en)

    def finish(self, context):
        return self._summary(context, Intent(context.goal)), self._record()

    def next_step(self, context):
        intent = Intent(context.goal)
        if self._failed_twice(context):
            return self._summary(context, intent, failed=True), self._record()
        step = getattr(self, "_" + intent.kind)(context, intent)
        return step, self._record()

    # intents ------------------------------------------------------------------------------

    def _unknown(self, context, intent):
        return self._final(
            context,
            "我可以帮你查余额、查汇率、比较汇款渠道、创建汇款或换汇（提交前需要你本人确认）。请告诉我金额和币种。所有资金均为模拟。",
            "I can check balances and rates, compare remittance routes, and prepare remittances or "
            "conversions (you confirm before anything is submitted). Tell me the amount and currencies. "
            "All funds are simulated.")

    @staticmethod
    def _failed_twice(context):
        """Stop when a tool's two most recent calls both failed (contract rule 4)."""
        last = {}
        for item in context.observations:
            last[item.tool] = (last.get(item.tool, (False, False))[1], item.status in ("ERROR", "DENIED"))
        return any(all(pair) for pair in last.values())

    def _balance(self, context, intent):
        if not _last_ok(context, "get_balances"):
            return self._call("get_balances", "Read wallet balances")
        return self._summary(context, intent)

    def _credit(self, context, intent):
        if not _last_ok(context, "get_credit_profile"):
            return self._call("get_credit_profile", "Read the on-time record")
        return self._summary(context, intent)

    def _orders(self, context, intent):
        if not _last_ok(context, "list_remittance_orders"):
            return self._call("list_remittance_orders", "Read recent remittance orders")
        return self._summary(context, intent)

    def _rate(self, context, intent):
        if not _last_ok(context, "get_fx_rate"):
            return self._call("get_fx_rate", "Read the reference rate",
                              base=intent.source or "CNY", quote=intent.target or "THB")
        return self._summary(context, intent)

    def _needs_amount(self, context, intent):
        if intent.amount is None or intent.source is None:
            return self._final(context, "请告诉我要汇出或兑换的金额和币种，例如“5000 元人民币”。所有资金均为模拟。",
                               "Please tell me the amount and currency, e.g. \"5000 CNY\". "
                               "All funds are simulated.")
        return None

    def _corridor_quotes(self, context, intent, limit):
        """Next call needed to get live quotes on the pair's corridors, or None when done."""
        if not _last_ok(context, "get_balances"):
            return self._call("get_balances", "Check the source balance first")
        balances = _last_ok(context, "get_balances").result.get("balances", [])
        held = next((b for b in balances if b.get("currency") == intent.source), None)
        if held is None or Decimal(held.get("balance", "0")) < intent.amount:
            return self._summary(context, intent, insufficient=True)
        corridors_obs = _last_ok(context, "list_corridors")
        if corridors_obs is None:
            return self._call("list_corridors", "Find routes for the currency pair",
                              source_currency=intent.source, target_currency=intent.target)
        corridors = corridors_obs.result.get("corridors", [])[:limit]
        if not corridors:
            return self._summary(context, intent, no_route=True)
        quoted = {o.arguments.get("corridor_id") for o in _obs(context, "create_live_quote")}
        for corridor in corridors:
            if corridor.get("id") not in quoted:
                return self._call("create_live_quote", f"Price the {corridor.get('tier')} route",
                                  corridor_id=corridor.get("id"), send_amount=_money(intent.amount))
        if not [o for o in _obs(context, "create_live_quote") if o.status == "OK"]:
            return self._summary(context, intent, failed=True)
        return None

    def _remit(self, context, intent):
        missing = self._needs_amount(context, intent)
        if missing or (step := self._corridor_quotes(context, intent, 3)):
            return missing or step
        quotes = [o.result for o in _obs(context, "create_live_quote") if o.status == "OK"]
        recommended = quotes[0].get("id")
        if len(quotes) > 1:
            ranked = _last_ok(context, "rank_quotes")
            if ranked is None:
                arguments = {"quote_ids": [q.get("id") for q in quotes]}
                if intent.deadline:
                    arguments["deadline"] = intent.deadline
                return self._call("rank_quotes", "Compare the priced routes", **arguments)
            recommended = ranked.result.get("recommended_quote_id")
            if recommended is None:
                return self._final(
                    context, "没有能在截止日期前到账的渠道。请调整截止日期或金额后再试。所有资金均为模拟。",
                    "No route arrives before the deadline. Adjust the deadline or amount and try again. "
                    "All funds are simulated.")
        beneficiary = None
        if self._external(intent):
            listed = _last_ok(context, "list_beneficiaries")
            if listed is None:
                return self._call("list_beneficiaries", "Find a verified recipient")
            beneficiary = next((b for b in listed.result.get("beneficiaries", []) if b.get("verified")), None)
            if beneficiary is None:
                return self._final(
                    context, "还没有已核验的收款人。请先添加收款人并等待核验，再让我创建汇款。所有资金均为模拟。",
                    "There is no verified recipient yet. Add one and wait for verification first. "
                    "All funds are simulated.")
        order = _last_ok(context, "create_remittance_order")
        if order is None:
            arguments = {"quote_id": recommended,
                         "recipient": "BENEFICIARY" if beneficiary else "SELF",
                         "purpose": "tuition" if intent.tuition else
                         "family_support" if intent.family else "other"}
            if beneficiary:
                arguments["beneficiary_id"] = beneficiary.get("id")
            if intent.deadline:
                arguments["deadline"] = intent.deadline
            return self._call("create_remittance_order", "Prepare the order", **arguments)
        if not _obs(context, "submit_remittance_order"):
            return self._call("submit_remittance_order", "Propose submission for confirmation",
                              order_id=order.result.get("id"))
        return self._summary(context, intent)

    @staticmethod
    def _external(intent):
        return intent.tuition or (intent.family and intent.target != "THB")

    def _convert(self, context, intent):
        missing = self._needs_amount(context, intent)
        if missing or (step := self._corridor_quotes(context, intent, 1)):
            return missing or step
        quote = next(o.result for o in _obs(context, "create_live_quote") if o.status == "OK")
        if not _obs(context, "convert_balance"):
            return self._call("convert_balance", "Propose the conversion for confirmation",
                              quote_id=quote.get("id"), source_amount=_money(intent.amount))
        return self._summary(context, intent)

    # answers ------------------------------------------------------------------------------

    def _summary(self, context, intent, failed=False, insufficient=False, no_route=False):
        zh, en = [], []
        if failed:
            zh.append("有工具调用失败，我先停在这里，请稍后重试或检查输入。")
            en.append("A tool call failed, so I stopped here. Please retry later or check the input.")
        if insufficient:
            zh.append(f"{intent.source} 余额不足以支付 {_money(intent.amount)}。")
            en.append(f"Your {intent.source} balance does not cover {_money(intent.amount)}.")
        if no_route:
            zh.append(f"目前没有 {intent.source}→{intent.target} 的可用汇路。")
            en.append(f"There is no available {intent.source}->{intent.target} route.")
        balances = _last_ok(context, "get_balances")
        if balances and intent.kind == "balance":
            parts = [f"{b.get('balance')} {b.get('currency')}" for b in balances.result.get("balances", [])]
            zh.append("当前余额：" + "，".join(parts) + "。")
            en.append("Balances: " + ", ".join(parts) + ".")
        rate = _last_ok(context, "get_fx_rate")
        if rate:
            r = rate.result
            zh.append(f"{r.get('base')}/{r.get('quote')} 参考汇率 {r.get('rate')}（{r.get('source')}，{r.get('rate_date')}）。")
            en.append(f"{r.get('base')}/{r.get('quote')} reference rate {r.get('rate')} ({r.get('source')}, {r.get('rate_date')}).")
        credit = _last_ok(context, "get_credit_profile")
        if credit:
            c = credit.result
            zh.append(f"准时记录等级 {c.get('level')}：准时 {c.get('on_time')} 笔，逾期 {c.get('late')} 笔。")
            en.append(f"On-time record level {c.get('level')}: {c.get('on_time')} on time, {c.get('late')} late.")
        orders = _last_ok(context, "list_remittance_orders")
        if orders:
            rows = orders.result.get("orders", [])
            zh.append(f"最近 {len(rows)} 张汇款订单：" + "，".join(f"{o.get('status')}" for o in rows) + "。" if rows else "暂无汇款订单。")
            en.append(f"Latest {len(rows)} orders: " + ", ".join(f"{o.get('status')}" for o in rows) + "." if rows else "No remittance orders yet.")
        quotes = {o.result.get("id"): o.result for o in _obs(context, "create_live_quote") if o.status == "OK"}
        ranked = _last_ok(context, "rank_quotes")
        chosen = None
        order = _last_ok(context, "create_remittance_order")
        if order:
            chosen = quotes.get(order.arguments.get("quote_id"))
        elif ranked:
            chosen = quotes.get(ranked.result.get("recommended_quote_id"))
        elif quotes:
            chosen = next(iter(quotes.values()))
        if chosen:
            zh.append(f"比较了 {len(quotes)} 个渠道，选择 {chosen.get('route_name')}：发送 {chosen.get('send_amount')} "
                      f"{chosen.get('source_currency')}，费用 {chosen.get('sender_fee')}，汇率 {chosen.get('rate')}"
                      f"（{chosen.get('rate_source')}，{chosen.get('rate_date')}），到账约 {chosen.get('net_received')} "
                      f"{chosen.get('target_currency')}，约 {chosen.get('settlement_days')} 天。")
            en.append(f"Compared {len(quotes)} routes; chose {chosen.get('route_name')}: send {chosen.get('send_amount')} "
                      f"{chosen.get('source_currency')}, fee {chosen.get('sender_fee')}, rate {chosen.get('rate')} "
                      f"({chosen.get('rate_source')}, {chosen.get('rate_date')}), about {chosen.get('net_received')} "
                      f"{chosen.get('target_currency')} in about {chosen.get('settlement_days')} days.")
        proposed = [o for o in context.observations if o.status == "PROPOSED"]
        if proposed:
            zh.append("提交动作已生成，等待你本人确认（需要二次验证），尚未执行。")
            en.append("The submission is prepared and awaits your confirmation with re-authentication; nothing has been executed.")
        denied = [o for o in context.observations if o.status == "DENIED"]
        if denied:
            zh.append("部分动作被权限策略拒绝。")
            en.append("Some actions were blocked by the permission policy.")
        if not zh:
            return self._unknown(context, intent)
        zh.append("以上均为模拟资金。")
        en.append("All funds are simulated.")
        return self._final(context, "".join(zh), " ".join(en))
