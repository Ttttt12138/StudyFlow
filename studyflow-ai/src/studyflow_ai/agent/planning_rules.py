"""Deterministic planner for planning conversations: CI, offline demos and mock mode.

It reads the newest message (context.goal) plus server memory, calls at most the tools one
reply needs, then answers from the observations. It never states a figure no tool returned.
"""

import json
import re
from decimal import Decimal

from studyflow_ai.agent import loan_rules
from studyflow_ai.agent.funnel import invite, stage
from studyflow_ai.agent.models import FinalStep, ToolCallStep
from studyflow_ai.agent.planning_facts import ambiguities
from studyflow_ai.agent.planning_facts import amounts as labelled_amounts
from studyflow_ai.agent.preparation import preparation_reply

CONFIRM = ("确认计划", "确定计划", "定下来", "就这样", "确认", "confirm", "finalise", "finalize", "lock in")
LOAN = ("贷款", "借款", "借钱", "loan", "borrow")
CHOOSE = ("就选", "选择", "决定", "就读", "去这", "选这", "choose", "pick", "go with", "decide")
COMPARE = ("比较", "对比", "哪个好", "区别", "compare", " vs", "versus", "difference")
COST = ("费用", "学费", "生活费", "多少钱", "总共", "开支", "花费", "全部", "cost", "tuition", "fee",
        "expense", "how much", "total", "price")
PROFILE = ("设施", "美食", "好吃", "吃", "玩", "周边", "环境", "宿舍", "校园", "图书馆", "景点", "facilit", "food",
           "eat", "fun", "visit", "campus", "dorm", "things to do", "nearby")
SCHOOLS = ("学校", "推荐", "有哪些", "选项", "院校", "大学", "schools", "options", "universities",
           "recommend", "list")
PLAN = ("我的计划", "计划", "进度", "my plan", "plan status")
# Day-to-day spending is not recorded; such messages are neither remittances nor plan facts.
SPENT = ("花了", "花费了", "买了", "付了", "消费了", "记账", "spent", "paid", "bought")
BILLS = ("账单", "还款", "什么时候交", "要交", "到期", "bills", "due", "repayment", "installment")
# The on-time record (credit) is not part of the planning chat.
FINANCE_KINDS = ("remit", "convert", "rate", "balance", "orders")
ALIASES = {
    "psu-phuket": ("普吉", "phuket", "宋卡王子大学普吉", "psu phuket"),
    "psu-hatyai": ("合艾", "hat yai", "hatyai", "psu hat yai"),
    "chulalongkorn": ("朱拉", "chula", "朱拉隆功"),
    "mahidol": ("玛希隆", "mahidol", "muic"),
    "thammasat": ("法政", "thammasat"),
    "manchester": ("曼彻斯特", "曼大", "manchester"),
    "melbourne": ("墨尔本", "墨大", "melbourne"),
    "nus": ("新国立", "新加坡国立", "nus", "national university of singapore"),
    "waseda": ("早稻田", "早大", "waseda"),
    "malaya": ("马来亚", "马大", "universiti malaya", "university of malaya"),
}
CURRENCIES = [("人民币", "CNY"), ("美元", "USD"), ("泰铢", "THB"), ("英镑", "GBP"), ("日元", "JPY"),
              ("澳元", "AUD"), ("新币", "SGD"), ("新元", "SGD"), ("令吉", "MYR"), ("欧元", "EUR"),
              ("元", "CNY"), ("rmb", "CNY"), ("cny", "CNY"), ("usd", "USD"), ("thb", "THB"),
              ("gbp", "GBP"), ("jpy", "JPY"), ("aud", "AUD"), ("sgd", "SGD"), ("myr", "MYR"),
              ("eur", "EUR"), ("baht", "THB"), ("yuan", "CNY")]
SAMPLE = {"zh": "（以上是根据公开资料整理的示例数据，付款前请再向学校确认。）",
          "en": "(Sample data from public sources; please confirm with the school before paying.)"}
AFTER_APPLICATION = {
    "zh": "钱包、换汇和汇款要等贷款申请提交后才会开放，到时候我陪你一步步来。",
    "en": "The wallet, currency exchange and transfers open once your loan application is submitted; "
          "I'll walk you through them then. ",
}
HELP = {
    "zh": "我可以帮你算留学的全程总价、把几所学校放在一起比，再按你想借的金额推荐贷款方案。",
    "en": "I can work out the full cost of studying abroad, compare schools side by side, and suggest a loan "
          "for the amount you'd like to borrow. ",
}
SUBMITTED = {"zh": "你的贷款申请已经提交好了。", "en": "Your loan application is already in. "}
NO_EXPENSES = {
    "zh": "日常花销这里不做记录，不过接下来要交的账单和还款，我可以帮你看看。",
    "en": "Day-to-day spending isn't tracked here, but I can show you upcoming bills and repayments. ",
}
FAILED = {"zh": "有一项信息刚才没查到，", "en": "One lookup didn't go through just now; "}
FAILED_ONLY = {"zh": "这一步刚才没查成功，可以再发一次试试。", "en": "That didn't go through just now; try sending it again. "}


def _has(text, words):
    return any(w in text for w in words)


def _amount(text):
    match = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*(k|千|万|w)?", text)
    if not match:
        return None
    value = Decimal(match.group(1).replace(",", ""))
    value *= {"k": 1000, "千": 1000, "万": 10000, "w": 10000}.get(match.group(2) or "", 1)
    return value if value > 0 else None


def _currency(text):
    for word, code in CURRENCIES:
        if (word in text) if not word.isascii() else re.search(rf"\b{word}\b", text):
            return code
    return None


def _years(text):
    match = re.search(r"(\d)\s*(?:年|years?|yrs?)", text)
    return int(match.group(1)) if match and 1 <= int(match.group(1)) <= 6 else None


def _months(text):
    match = re.search(r"(\d{1,2})\s*(?:个月|months?)", text)
    if match:
        return int(match.group(1))
    years = re.search(r"(?:分|还|repay over|over)\s*(\d)\s*(?:年|years?)", text)
    return int(years.group(1)) * 12 if years else None


def _money(value, currency=""):
    if value is None:
        return "?"
    number = Decimal(str(value))
    text = f"{number:,.0f}" if number >= 100 else f"{number:,.2f}"
    return f"{text} {currency}".strip()


def _home_total(row, home_currency):
    """A comparison row's full-course total in the home currency, or None when not convertible."""
    if row.get("total") is None:
        return None
    if row.get("currency") == home_currency:
        return Decimal(str(row["total"]))
    converted = row.get("total_converted") or {}
    return Decimal(str(converted["amount"])) if converted.get("amount") is not None else None


def _name(item, locale):
    name = item.get("name") or {}
    return name.get(locale) or name.get("en") or item.get("key", "")


class Message:
    def __init__(self, context):
        self.text = context.goal.lower()
        memory = context.memory
        self.memory = memory
        self.locale = context.locale
        self.plan = memory.get("plan") or None
        self.schools = self._schools(memory.get("schools") or [])
        self.country = self._country(memory.get("schools") or [])
        recent = memory.get("recent_schools") or []
        plan_key = self.plan.get("school_key") if self.plan else None
        self.focus = self.schools[0] if self.schools else (plan_key or (recent[0] if recent else None))
        # Confirming the plan and submitting the loan application are one action in the loan panel.
        self.confirmed = (self.plan or {}).get("status") == "CONFIRMED"
        self.amount = _amount(re.sub(r"\d\s*(?:年|years?|个月|months?)", " ", self.text))
        self.currency = _currency(self.text)
        self.facts = labelled_amounts(self.text)
        self.ambiguous = ambiguities(self.text)
        self.years = _years(self.text)
        self.months = _months(self.text)

    def _schools(self, catalog):
        found = []
        for item in catalog:
            key = item["key"]
            words = [key, item.get("name_en", "").lower(), item.get("name_zh", ""), *ALIASES.get(key, ())]
            positions = [self.text.find(w) for w in words if w and w in self.text]
            if positions:
                found.append((min(positions), key))
        return [key for _, key in sorted(found)]

    def _country(self, catalog):
        for item in catalog:
            names = [item.get("country_en", "").lower(), item.get("country_zh", "")]
            if any(n and n in self.text for n in names):
                return item.get("country_code")
        return None


def _obs(context, tool):
    return [o for o in context.observations if o.tool == tool]


def _ok(context, tool):
    found = [o for o in _obs(context, tool) if o.status in ("OK", "PROPOSED")]
    return found[-1] if found else None


def _tried(context, tool):
    return bool(_obs(context, tool))


class PlanningRules:
    def _call(self, tool, rationale, **arguments):
        return ToolCallStep(tool=tool, arguments_json=json.dumps(arguments), rationale=rationale)

    def _final(self, context, zh, en):
        return FinalStep(answer=(zh if context.locale == "zh" else en)[:2000])

    def next_step(self, context):
        from .life_rules import life_reply
        life = life_reply(context)
        if life is not None:
            return life
        m = Message(context)
        if m.ambiguous:
            if m.facts and m.focus and not _tried(context, "save_plan"):
                return self._save(context, m)
            labels = {"principal": ("借款金额", "borrowing amount")}
            return self._final(context, "你提到了好几个" + "、".join(labels[k][0] for k in m.ambiguous) + "，想用哪一个？告诉我一个就行，其他信息我都记着。",
                "You mentioned more than one " + ", ".join(labels[k][1] for k in m.ambiguous) + ". Which one should I use? The rest is noted.")
        guidance = preparation_reply(m.text, (m.plan or {}).get("status"), context.locale, m.plan)
        if guidance:
            return FinalStep(answer=guidance)
        finance = self._finance(context, m)
        if finance == "locked":
            return self._final(context, *(AFTER_APPLICATION[k] + invite(stage(context.memory, context.observations), k)
                                          for k in ("zh", "en")))
        if finance is not None:
            provider, intent = finance
            if provider._failed_twice(context):
                return provider._summary(context, intent, failed=True)
            return getattr(provider, "_" + intent.kind)(context, intent)
        if context.steps_remaining == 0 or self._failed(context):
            return self.answer(context, m)
        step = self._plan(context, m)
        return step or self.answer(context, m)

    def finish(self, context):
        from .life_rules import life_reply
        life = life_reply(context)
        if life is not None:
            return life
        finance = self._finance(context, Message(context))
        if finance == "locked":
            return self._final(context, *(AFTER_APPLICATION[k] + invite(stage(context.memory, context.observations), k)
                                          for k in ("zh", "en")))
        if finance is not None:
            provider, intent = finance
            return provider._summary(context, intent)
        return self.answer(context, Message(context))

    @staticmethod
    def _finance(context, m):
        """Wallet, FX and remittance requests go to the finance rules (the original agent) once the
        plan is confirmed (the loan application is submitted); before that they return "locked" and
        the planner says when they open."""
        from studyflow_ai.agent.planner import Intent

        if _has(m.text, SPENT) or _has(m.text, BILLS) or _has(m.text, LOAN):
            return None
        intent = Intent(context.goal)
        if intent.kind not in FINANCE_KINDS:
            return None
        if intent.kind in ("remit", "convert") and intent.amount is None:
            return None
        if not m.confirmed:
            # "My plan status" mentions status/进度 but is a planning question.
            if intent.kind == "orders" and _has(m.text, PLAN):
                return None
            return "locked"
        return _FinanceRules(), intent

    @staticmethod
    def _failed(context):
        return any(o.status in ("ERROR", "DENIED") for o in context.observations)

    # deciding the next tool -------------------------------------------------------------------

    def _plan(self, context, m):
        text = m.text
        if _has(text, SPENT) and m.amount is not None and not m.facts:
            return None  # answer() says spending is not recorded
        if loan_rules.relevant(m) and not m.schools:
            return self._loan(context, m)
        if m.confirmed and _has(text, BILLS):
            return None if _tried(context, "list_bills") else self._call("list_bills", "Upcoming bills")
        if _has(text, LOAN):
            return self._loan(context, m)
        if _has(text, CONFIRM) and m.plan and m.plan.get("status") == "DRAFT" and not m.schools:
            # The plan is confirmed only together with the loan application, in the loan panel.
            return self._loan(context, m)
        if (m.schools and _has(text, CHOOSE)) or (m.facts and m.focus and not _has(text, COMPARE)):
            return self._save(context, m)
        if _has(text, COMPARE) and len(m.schools) >= 2:
            if not _tried(context, "compare_schools"):
                return self._call("compare_schools", "Compare the named schools", school_keys=m.schools[:4])
            return None
        if m.focus and _has(text, COST):
            return self._estimate(context, m)
        if m.focus and _has(text, PROFILE):
            if not _tried(context, "get_school_profile"):
                return self._call("get_school_profile", "Campus life for the school",
                                  school_key=m.focus)
            return None
        if m.schools:
            # A bare school name: price first.
            return self._estimate(context, m)
        if _has(text, PLAN) and not _has(text, SCHOOLS):
            if not _tried(context, "get_plan"):
                return self._call("get_plan", "Read the current plan")
            return None
        if _has(text, SCHOOLS) or m.country or _has(text, COST):
            if not _tried(context, "list_schools"):
                arguments = {"country_code": m.country} if m.country else {}
                return self._call("list_schools", "Show the catalog", **arguments)
        return None

    def _estimate(self, context, m):
        if _tried(context, "estimate_total_cost"):
            return None
        arguments = {"school_key": m.focus}
        if m.years:
            arguments["years"] = m.years
        return self._call("estimate_total_cost", "Total cost for the school", **arguments)

    def _save(self, context, m):
        key = m.schools[0] if m.schools else (m.plan or {}).get("school_key") or m.focus
        if key is None:
            return None
        if not _tried(context, "save_plan"):
            arguments = {"school_key": key}
            if m.years:
                arguments["years"] = m.years
            arguments.update(m.facts)
            if m.currency and "principal" in arguments and "principal_currency" not in arguments:
                arguments["principal_currency"] = m.currency
            return self._call("save_plan", "Save the chosen school", **arguments)
        saved = _ok(context, "save_plan")
        status = ((saved.result.get("plan") or {}).get("status") if saved else None)
        # After choosing a school everyone continues in the loan panel.
        if status == "DRAFT" and context.tool("simulate_loan") and not _tried(context, "simulate_loan"):
            arguments = loan_rules.arguments(m)
            arguments.pop("principal", None)
            arguments.pop("principal_currency", None)
            return self._call("simulate_loan", "Recommend a loan for the chosen school", **arguments)
        return None

    def _loan(self, context, m):
        if m.schools or (m.facts and not m.plan):
            if not _tried(context, "save_plan"):
                return self._save(context, m)
        if not _tried(context, "simulate_loan"):
            plan = m.plan or {}
            saved = _ok(context, "save_plan")
            if saved:
                plan = saved.result.get("plan") or {}
            if not plan:
                return None  # answer() asks for the school first
            if plan.get("status") == "CONFIRMED" and not _has(m.text, ("推荐", "recommend")):
                return None  # answer() says the application is already submitted
            arguments = loan_rules.arguments(m)
            if _ok(context, "save_plan"):
                arguments.pop("principal", None)
                arguments.pop("principal_currency", None)
            return self._call("simulate_loan", "Recommend a loan and address the user's concern", **arguments)
        return None

    # answering --------------------------------------------------------------------------------

    def answer(self, context, m):
        advice = _ok(context, "simulate_loan")
        if advice and advice.result.get("advice"):
            return FinalStep(answer=loan_rules.advice_reply(advice.result["advice"], context.locale))
        zh, en = [], []
        sample = False
        sample |= self._schools_text(context, zh, en)
        sample |= self._profile_text(context, zh, en)
        sample |= self._compare_text(context, zh, en)
        sample |= self._estimate_text(context, zh, en)
        amount_noted = self._plan_text(context, zh, en)
        self._bills_text(context, zh, en)
        if any(item.status in ("ERROR", "DENIED") for item in context.observations):
            zh.insert(0, FAILED["zh"] if zh else FAILED_ONLY["zh"])
            en.insert(0, FAILED["en"] if en else FAILED_ONLY["en"])
        if sample:
            zh.append(SAMPLE["zh"])
            en.append(SAMPLE["en"])
        asks_loan = _has(m.text, LOAN) or _has(m.text, CONFIRM)
        if not zh:
            if _has(m.text, SPENT) and m.amount is not None:
                zh.append(NO_EXPENSES["zh"])
                en.append(NO_EXPENSES["en"])
            elif m.confirmed and asks_loan:
                zh.append(SUBMITTED["zh"])
                en.append(SUBMITTED["en"])
            elif not asks_loan:
                zh.append(HELP["zh"])
                en.append(HELP["en"])
        next_step = stage(context.memory, context.observations)
        if asks_loan and next_step in ("price", "compare", "choose"):
            # Loans follow a chosen school: say so instead of only a generic invitation.
            zh.append("贷款要先选定学校再算。")
            en.append("A loan is worked out once you've chosen a school. ")
        if not amount_noted:  # that sentence already says what happens next
            zh.append(invite(next_step, "zh"))
            en.append(invite(next_step, "en"))
        return self._final(context, "".join(zh), "".join(en).strip())

    def _schools_text(self, context, zh, en):
        listed = _ok(context, "list_schools")
        if not listed:
            return False
        rows = listed.result.get("schools", [])
        if not rows:
            zh.append("目录里暂时没有符合条件的学校。")
            en.append("No school in the catalog matches that yet. ")
            return False
        home = rows[0].get("home_currency")
        totals = [(Decimal(str(r["total_home"])), r) for r in rows
                  if r.get("total_home") is not None and r.get("home_currency") == home]
        countries = {((r.get("country") or {}).get("zh"), (r.get("country") or {}).get("en")) for r in rows}
        scope_zh, scope_en = next(iter(countries)) if len(countries) == 1 else ("目录里", "the catalog")
        if len(rows) == 1:
            row = rows[0]
            zh.append(f"{scope_zh}有 1 所学校：{_name(row, 'zh')}，全程约 {_money(row.get('total'), row.get('currency'))}。")
            en.append(f"There is one school in {scope_en}: {_name(row, 'en')}, about "
                      f"{_money(row.get('total'), row.get('currency'))} in total. ")
        elif len(totals) == len(rows):
            low, high = min(totals, key=lambda t: t[0]), max(totals, key=lambda t: t[0])
            zh.append(f"{scope_zh}有 {len(rows)} 所学校，全程总价从约 {_money(low[0], home)}（{_name(low[1], 'zh')}）"
                      f"到约 {_money(high[0], home)}（{_name(high[1], 'zh')}），每所的明细都在下方卡片里。")
            en.append(f"There are {len(rows)} schools in {scope_en}, from about {_money(low[0], home)} "
                      f"({_name(low[1], 'en')}) to about {_money(high[0], home)} ({_name(high[1], 'en')}) in total; "
                      "each one's details are in the cards below. ")
        else:
            zh.append(f"{scope_zh}有 {len(rows)} 所学校，每所的全程总价都在下方卡片里。")
            en.append(f"There are {len(rows)} schools in {scope_en}; each one's full cost is in the cards below. ")
        return True

    def _profile_text(self, context, zh, en):
        found = _ok(context, "get_school_profile")
        if not found:
            return False
        p = found.result

        def names(rows, locale, limit=3):
            return ("、" if locale == "zh" else ", ").join(_name(r, locale) for r in rows[:limit])

        zh.append(f"{_name(p, 'zh')}在{p['city']['zh']}。校内有{names(p['facilities'], 'zh')}；附近能吃到"
                  f"{names(p['food'], 'zh')}；周末可以去{names(p['attractions'], 'zh')}逛逛。")
        en.append(f"{_name(p, 'en')} is in {p['city']['en']}. On campus: {names(p['facilities'], 'en')}; "
                  f"food nearby: {names(p['food'], 'en')}; for weekends: {names(p['attractions'], 'en')}. ")
        return True

    def _compare_text(self, context, zh, en):
        found = _ok(context, "compare_schools")
        if not found:
            return False
        rows = found.result.get("schools", [])
        cheapest = next((r for r in rows if r.get("key") == found.result.get("cheapest")), None)
        if cheapest is None:
            zh.append("几所学校的对比都在下方卡片里。")
            en.append("The comparison is in the card below. ")
            return True
        home_currency = found.result.get("home_currency")
        totals = [_home_total(r, home_currency) for r in rows]
        more_zh = more_en = ""
        if len(rows) > 1 and None not in totals:
            gap = _money(max(totals) - min(totals), home_currency)
            more_zh, more_en = f"，比最贵的一所少约 {gap}", f", about {gap} less than the most expensive"
        # A school list in the same reply already points to the cards.
        listed = _ok(context, "list_schools") is not None
        zh.append(f"比下来，全程总价最低的是{_name(cheapest, 'zh')}{more_zh}"
                  f"{'。' if listed else '；各校明细在下方卡片里。'}")
        en.append(f"Side by side, {_name(cheapest, 'en')} costs the least overall{more_en}"
                  f"{'. ' if listed else '; the details are in the card below. '}")
        return True

    def _estimate_text(self, context, zh, en):
        found = _ok(context, "estimate_total_cost")
        if not found:
            return False
        e = found.result
        cur = e["currency"]
        converted = e.get("converted") or {}
        home = _money(converted.get("amount"), converted.get("currency")) if converted else ""
        g = e["groups"]
        zh.append(f"读 {e['years']} 年，全程大约 {_money(e['total'], cur)}{f'（约 {home}）' if home else ''}，"
                  f"其中学费 {_money(g['tuition'], cur)}、生活费 {_money(g['living'], cur)}、必要开支 {_money(g['essentials'], cur)}。")
        en.append(f"Over {e['years']} year(s) it comes to about {_money(e['total'], cur)}{f' (about {home})' if home else ''}: "
                  f"tuition {_money(g['tuition'], cur)}, living {_money(g['living'], cur)}, essentials "
                  f"{_money(g['essentials'], cur)}. ")
        return True

    def _bills_text(self, context, zh, en):
        listed = _ok(context, "list_bills")
        if not listed:
            return
        rows = listed.result.get("bills", [])[:4]
        if rows:
            zh.append("接下来要交的有：" + "；".join(f"{b['due_date']} {b['label'].get('zh')} "
                                                   f"{_money(b['amount'], b['currency'])}" for b in rows) + "。")
            en.append("Coming up: " + "; ".join(f"{b['due_date']} {b['label'].get('en')} "
                                                f"{_money(b['amount'], b['currency'])}" for b in rows) + ". ")
        else:
            zh.append("最近没有要交的账单。")
            en.append("Nothing is due right now. ")

    def _plan_text(self, context, zh, en):
        saved = _ok(context, "save_plan") or _ok(context, "get_plan")
        plan = (saved.result.get("plan") if saved else None) or None
        if not plan:
            return False
        school = (plan.get("school") or {}).get("name", {})
        cur = plan.get("currency")
        years = plan.get("duration_months", plan.get("years", 1) * 12) / 12
        zh.append(f"你的方案是{school.get('zh', plan.get('school_key'))}，读 {years:g} 年，全程约 {_money(plan.get('total'), cur)}。")
        en.append(f"Your plan: {school.get('en', plan.get('school_key'))} for {years:g} year(s), about "
                  f"{_money(plan.get('total'), cur)} in total. ")
        stored = _ok(context, "save_plan")
        principal = stored.result.get("loan_principal") if stored else None
        if plan.get("status") == "CONFIRMED":
            zh.append(SUBMITTED["zh"])
            en.append(SUBMITTED["en"])
        elif principal is not None:
            # The amount the backend stored (THB); a figure said in another currency is shown as said too.
            said, currency = stored.arguments.get("principal"), (stored.arguments.get("principal_currency") or "THB").upper()
            note = ("", "") if currency == "THB" or said is None else (
                f"（按 {_money(said, currency)} 折算）", f" (converted from {_money(said, currency)})")
            zh.append(f"想借的 {_money(principal, 'THB')}{note[0]} 我记下了，这就按这个金额帮你挑贷款方案。")
            en.append(f"I've noted the {_money(principal, 'THB')}{note[1]} you'd like to borrow and will find a "
                      "loan plan for it. ")
            return True
        return False


def _FinanceRules():
    from studyflow_ai.agent.planner import RuleAgentProvider

    return RuleAgentProvider()
