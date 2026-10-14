"""Deterministic planner for planning conversations: CI, offline demos and mock mode.

It reads the newest message (context.goal) plus server memory, calls at most the tools one
reply needs, then answers from the observations. It never states a figure no tool returned.
"""

import json
import re
from decimal import Decimal

from studyflow_ai.agent.models import FinalStep, ToolCallStep
from studyflow_ai.agent.planning_facts import ambiguities
from studyflow_ai.agent.planning_facts import amounts as labelled_amounts
from studyflow_ai.agent.preparation import arrival_reported, preparation_reply

CONFIRM = ("确认计划", "确定计划", "定下来", "就这样", "确认", "confirm", "finalise", "finalize", "lock in")
LOAN = ("贷款", "借款", "借钱", "loan", "borrow")
CHOOSE = ("就选", "选择", "决定", "就读", "去这", "选这", "choose", "pick", "go with", "decide")
FUNDS = ("存款", "积蓄", "预算", "准备了", "有存", "savings", "saved", "budget", "we have")
COMPARE = ("比较", "对比", "哪个好", "区别", "compare", " vs", "versus", "difference")
COST = ("费用", "学费", "生活费", "多少钱", "总共", "开支", "花费", "全部", "cost", "tuition", "fee",
        "expense", "how much", "total", "price")
PROFILE = ("设施", "美食", "好吃", "吃", "玩", "周边", "环境", "宿舍", "校园", "图书馆", "景点", "facilit", "food",
           "eat", "fun", "visit", "campus", "dorm", "things to do", "nearby")
SCHOOLS = ("学校", "推荐", "有哪些", "选项", "院校", "大学", "schools", "options", "universities",
           "recommend", "list")
PLAN = ("我的计划", "计划", "进度", "my plan", "plan status")
SPENT = ("花了", "花费了", "买了", "付了", "消费了", "spent", "paid", "bought")
SPENDING = ("这个月", "本月", "花了多少", "开销", "预算", "超支", "spending", "this month", "budget", "how much have i")
BILLS = ("账单", "还款", "什么时候交", "要交", "到期", "bills", "due", "repayment", "installment")
FINANCE_KINDS = ("remit", "convert", "rate", "balance", "orders", "credit")
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
STATUS = {"DRAFT": ("草稿", "draft"), "CONFIRMED": ("已确认", "confirmed"), "ENROLLED": ("已入学", "enrolled")}
CATEGORY_ZH = {"food": "餐饮", "transport": "交通", "housing": "住房", "study": "学习", "shopping": "购物", "fun": "娱乐",
               "health": "医疗", "other": "其他"}
SAMPLE = {"zh": "（示例数据，来自公开资料，付款前请向学校确认。）",
          "en": "(Sample data from public sources; confirm with the school before paying.)"}
SIMULATED = {"zh": "所有资金与贷款均为模拟。", "en": "All money and loans are simulated."}
AFTER_ENROLLMENT = {
    "zh": "汇款、换汇、钱包等资金工具会在确认入学后开放。现在可以先查学校总价、比较几所学校，或看看资金缺口和贷款方案。",
    "en": "Remittance, currency exchange and wallet tools open once enrollment is confirmed. For now I can look up "
          "a school's total cost, compare schools, or work out your funding gap and a loan option.",
}
HELP = {
    "zh": "告诉我想去的学校，我来算学费、住宿和生活费的全程总价；也可以比较几所学校，或告诉我存款金额来算资金缺口。",
    "en": "Tell me a school and I'll work out the full-course total for tuition, housing and living costs; "
          "I can also compare schools, or use your savings to work out the funding gap.",
}


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
        self.enrolled = (self.plan or {}).get("status") == "ENROLLED"
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
            labels = {"available_funds": ("可用资金", "available funds"),
                      "support_amount": ("家庭支持", "family support"), "principal": ("拟借金额", "borrowing amount")}
            return self._final(context, "仅需确认：" + "、".join(labels[k][0] for k in m.ambiguous) + "有多个数值或币种，应使用哪一个？其他已知资料会保留。",
                "Please clarify only " + ", ".join(labels[k][1] for k in m.ambiguous) + ": which amount and currency should I use? Other known details are retained.")
        guidance = preparation_reply(m.text, (m.plan or {}).get("status"), context.locale, m.plan)
        if guidance:
            return FinalStep(answer=guidance)
        finance = self._finance(context, m)
        if finance == "locked":
            return FinalStep(answer=AFTER_ENROLLMENT[context.locale])
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
            return FinalStep(answer=AFTER_ENROLLMENT[context.locale])
        if finance is not None:
            provider, intent = finance
            return provider._summary(context, intent)
        return self.answer(context, Message(context))

    @staticmethod
    def _finance(context, m):
        """Wallet, FX and remittance requests go to the finance rules (the original agent) once the
        student is enrolled; before that they return "locked" and the planner says when they open."""
        from studyflow_ai.agent.planner import Intent

        if _has(m.text, SPENT) or _has(m.text, BILLS) or _has(m.text, SPENDING) or _has(m.text, LOAN):
            return None
        intent = Intent(context.goal)
        if intent.kind not in FINANCE_KINDS:
            return None
        if intent.kind in ("remit", "convert") and intent.amount is None:
            return None
        if not m.enrolled:
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
        enrolled = m.enrolled
        if enrolled:
            step = self._in_school(context, m)
            if step is not False:
                return step
        if not enrolled and arrival_reported(text):
            if not _tried(context, "confirm_enrollment"):
                return self._call("confirm_enrollment", "The user says the student has enrolled")
            return None
        if _has(text, LOAN):
            return self._loan(context, m)
        if _has(text, CONFIRM) and m.plan and m.plan.get("status") == "DRAFT" and not m.schools:
            if not _tried(context, "confirm_plan"):
                return self._call("confirm_plan", "The user wants to finalise the plan")
            return None
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

    def _in_school(self, context, m):
        """False when the message is not about in-school money, so planning rules continue."""
        text = m.text
        if _has(text, SPENT) and m.amount is not None:
            if _tried(context, "record_expense"):
                return None
            arguments = {"amount": f"{m.amount:.2f}", "note": context.goal[:200]}
            if m.currency:
                arguments["currency"] = m.currency
            return self._call("record_expense", "Record what the student spent", **arguments)
        if _has(text, BILLS):
            return None if _tried(context, "list_bills") else self._call("list_bills", "Upcoming bills")
        if _has(text, SPENDING):
            if _tried(context, "get_spending"):
                return None
            month = re.search(r"(20\d\d-\d\d)", text)
            arguments = {"month": month.group(1)} if month else {}
            return self._call("get_spending", "This month's spending", **arguments)
        return False

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
            if m.currency and "funds_currency" not in arguments and "available_funds" in arguments:
                arguments["funds_currency"] = m.currency
            return self._call("save_plan", "Save the chosen school", **arguments)
        saved = _ok(context, "save_plan")
        gap = ((saved.result.get("plan") or {}).get("gap") if saved else None)
        if gap and Decimal(gap) > 0 and _has(m.text, LOAN) and not _tried(context, "simulate_loan"):
            return self._call("simulate_loan", "Cover the funding gap")
        return None

    def _loan(self, context, m):
        if m.schools or m.facts:
            if not _tried(context, "save_plan"):
                return self._save(context, m)
        if not _tried(context, "simulate_loan"):
            plan = m.plan or {}
            saved = _ok(context, "save_plan")
            if saved:
                plan = saved.result.get("plan") or {}
            if not plan:
                return None  # answer() asks for the school or the savings first
            arguments = {"months": m.months} if m.months and 6 <= m.months <= 60 else {}
            return self._call("simulate_loan", "Simulate a loan for the gap", **arguments)
        return None

    # answering --------------------------------------------------------------------------------

    def answer(self, context, m):
        zh, en = [], []
        for item in context.observations:
            if item.status in ("ERROR", "DENIED"):
                code = item.result.get("error")
                code = code if isinstance(code, str) else json.dumps(code, ensure_ascii=False)[:120]
                zh.append(f"{item.tool} 没有成功（{code}）。")
                en.append(f"{item.tool} did not succeed ({code}).")
        sample = False
        sample |= self._schools_text(context, m, zh, en)
        sample |= self._profile_text(context, zh, en)
        sample |= self._compare_text(context, zh, en)
        sample |= self._estimate_text(context, zh, en)
        simulated = self._plan_text(context, m, zh, en)
        simulated |= self._in_school_text(context, zh, en)
        if sample:
            zh.append(SAMPLE["zh"])
            en.append(SAMPLE["en"])
        if simulated:
            zh.append(SIMULATED["zh"])
            en.append(SIMULATED["en"])
        if not zh:
            if _has(m.text, LOAN):
                zh.append("先告诉我选哪所学校、家里已准备多少钱，我来算资金缺口，再试算贷款。")
                en.append("Tell me the school and how much the family has saved; I'll work out the gap, then a loan.")
            else:
                zh.append(HELP["zh"])
                en.append(HELP["en"])
        return self._final(context, "".join(zh), " ".join(en))

    def _schools_text(self, context, m, zh, en):
        listed = _ok(context, "list_schools")
        if not listed:
            return False
        rows = listed.result.get("schools", [])
        if not rows:
            zh.append("目录里暂时没有符合条件的学校。")
            en.append("No catalog school matches that yet.")
            return False
        parts_zh, parts_en = [], []
        for row in rows:
            converted = row.get("first_year_converted") or {}
            if row.get("first_year_home"):
                converted = {"amount": row["first_year_home"], "currency": row.get("home_currency")}
            extra = f"≈{_money(converted.get('amount'), converted.get('currency'))}" if converted else ""
            parts_zh.append(f"{_name(row, 'zh')}（{row['country']['zh']}，首年约 "
                            f"{_money(row['first_year_total'], row['currency'])}{extra}）")
            parts_en.append(f"{_name(row, 'en')} ({row['country']['en']}, first year about "
                            f"{_money(row['first_year_total'], row['currency'])}{' ' + extra if extra else ''})")
        zh.append(f"目录里有 {len(rows)} 所学校：" + "；".join(parts_zh) + "。")
        en.append(f"{len(rows)} schools in the catalog: " + "; ".join(parts_en) + ".")
        zh.append("说出学校名，我把全程总价算给你，也可以比较几所学校。")
        en.append("Name a school and I'll give you the full-course total, or compare a few.")
        return True

    def _profile_text(self, context, zh, en):
        found = _ok(context, "get_school_profile")
        if not found:
            return False
        p = found.result

        def names(rows, locale, limit=3):
            return ("、" if locale == "zh" else ", ").join(_name(r, locale) for r in rows[:limit])

        zh.append(f"{_name(p, 'zh')}在{p['city']['zh']}。校内有{names(p['facilities'], 'zh')}；附近可以吃"
                  f"{names(p['food'], 'zh')}；周末可以去{names(p['attractions'], 'zh')}。")
        en.append(f"{_name(p, 'en')} is in {p['city']['en']}. Campus has {names(p['facilities'], 'en')}; "
                  f"nearby food: {names(p['food'], 'en')}; weekends: {names(p['attractions'], 'en')}.")
        return True

    def _compare_text(self, context, zh, en):
        found = _ok(context, "compare_schools")
        if not found:
            return False
        rows = found.result.get("schools", [])
        part_zh, part_en = [], []
        for row in rows:
            if row.get("total") is None:  # older result shape: first-year only
                converted = row.get("first_year_converted") or {}
                home = f"（≈{_money(converted.get('amount'), converted.get('currency'))}）" if converted else ""
                part_zh.append(f"{_name(row, 'zh')} 首年约 {_money(row['first_year_total'], row['currency'])}{home}")
                part_en.append(f"{_name(row, 'en')} first year about "
                               f"{_money(row['first_year_total'], row['currency'])}{' ' + home if home else ''}")
                continue
            converted = row.get("total_converted") or {}
            home = _money(converted.get("amount"), converted.get("currency")) if converted else ""
            years = row.get("years") or row.get("duration_years")
            part_zh.append(f"{_name(row, 'zh')} 读 {years} 年总价约 {_money(row['total'], row['currency'])}"
                           f"{f'（≈{home}）' if home else ''}")
            part_en.append(f"{_name(row, 'en')} {years} year(s) total about {_money(row['total'], row['currency'])}"
                           f"{f' (≈{home})' if home else ''}")
        zh.append("对比：" + "；".join(part_zh) + "。")
        en.append("Comparison: " + "; ".join(part_en) + ".")
        cheapest = next((r for r in rows if r.get("key") == found.result.get("cheapest")), None)
        if cheapest is not None:
            home_currency = found.result.get("home_currency")
            totals = [_home_total(r, home_currency) for r in rows]
            more_zh = more_en = ""
            if len(rows) > 1 and None not in totals:
                gap = _money(max(totals) - min(totals), home_currency)
                more_zh, more_en = f"，比最贵的一所少约 {gap}", f", about {gap} less than the most expensive"
            zh.append(f"全程总价最低的是{_name(cheapest, 'zh')}{more_zh}。")
            en.append(f"Lowest full-course total: {_name(cheapest, 'en')}{more_en}.")
        return True

    def _estimate_text(self, context, zh, en):
        found = _ok(context, "estimate_total_cost")
        if not found:
            return False
        e = found.result
        cur = e["currency"]
        converted = e.get("converted") or {}
        home_zh = f"（≈{_money(converted.get('amount'), converted.get('currency'))}）" if converted else ""
        g = e["groups"]
        zh.append(f"读 {e['years']} 年预计全部费用约 {_money(e['total'], cur)}{home_zh}：学费 {_money(g['tuition'], cur)}，"
                  f"生活费 {_money(g['living'], cur)}，必要开支 {_money(g['essentials'], cur)}；"
                  f"区间 {_money(e['total_low'], cur)}–{_money(e['total_high'], cur)}，约 {Decimal(e['estimated_share']):.0f}% 为估算。")
        en.append(f"{e['years']} year(s) total about {_money(e['total'], cur)}{' ' + home_zh if home_zh else ''}: "
                  f"tuition {_money(g['tuition'], cur)}, living {_money(g['living'], cur)}, essentials "
                  f"{_money(g['essentials'], cur)}; range {_money(e['total_low'], cur)}-{_money(e['total_high'], cur)}, "
                  f"about {Decimal(e['estimated_share']):.0f}% estimated.")
        return True

    def _in_school_text(self, context, zh, en):
        shown = False
        recorded = _ok(context, "record_expense")
        if recorded:
            e = recorded.result.get("expense") or {}
            zh.append(f"已记下：{e.get('spent_on')} {_money(e.get('amount'), e.get('currency'))}"
                      f"（{CATEGORY_ZH.get(e.get('category'), e.get('category'))}）。")
            en.append(f"Recorded: {e.get('spent_on')} {_money(e.get('amount'), e.get('currency'))} ({e.get('category')}).")
        spending = (recorded.result if recorded else None) or (_ok(context, "get_spending").result
                                                               if _ok(context, "get_spending") else None)
        if spending:
            cur = spending.get("currency")
            zh.append(f"{spending.get('month')} 已花 {_money(spending.get('spent'), cur)}，月度生活预算 "
                      f"{_money(spending.get('budget'), cur)}，剩余 {_money(spending.get('remaining'), cur)}。")
            en.append(f"{spending.get('month')}: spent {_money(spending.get('spent'), cur)} of a "
                      f"{_money(spending.get('budget'), cur)} monthly living budget; "
                      f"{_money(spending.get('remaining'), cur)} left.")
            if spending.get("over_budget"):
                zh.append("本月已经超出预算，接下来几天可以控制一下。")
                en.append("You are over budget this month; ease off for the next few days.")
            shown = True
        listed = _ok(context, "list_bills")
        if listed:
            rows = listed.result.get("bills", [])[:4]
            if rows:
                zh.append("接下来的账单：" + "；".join(f"{b['due_date']} {b['label'].get('zh')} "
                                                     f"{_money(b['amount'], b['currency'])}" for b in rows) + "。")
                en.append("Upcoming bills: " + "; ".join(f"{b['due_date']} {b['label'].get('en')} "
                                                         f"{_money(b['amount'], b['currency'])}" for b in rows) + ".")
            else:
                zh.append("目前没有待付账单。")
                en.append("No bills are due.")
            shown = True
        return shown

    def _plan_text(self, context, m, zh, en):
        simulated = False
        saved = _ok(context, "simulate_loan") or _ok(context, "save_plan") or _ok(context, "get_plan")
        plan = (saved.result.get("plan") if saved else None) or None
        if plan:
            school = (plan.get("school") or {}).get("name", {})
            cur = plan.get("currency")
            years = plan.get("duration_months", plan.get("years", 1) * 12) / 12
            status = STATUS.get(plan.get("status"), (plan.get("status"), plan.get("status")))
            zh.append(f"计划：{school.get('zh', plan.get('school_key'))}，{years:g} 年，状态：{status[0]}，"
                      f"全部费用约 {_money(plan.get('total'), cur)}。")
            en.append(f"Plan: {school.get('en', plan.get('school_key'))}, {years:g} year(s), "
                      f"status: {status[1]}, total about {_money(plan.get('total'), cur)}.")
            zh.append("已将已知资料带入‘我的方案’，集中补齐必要信息即可比较贷款与还款负担。")
            en.append("Known details are in My plan. Complete the missing details together to compare loans and repayment capacity.")
        loan = _ok(context, "simulate_loan")
        if loan and not loan.result.get("open_assessment"):
            info = (loan.result.get("plan") or {}).get("loan") or {}
            zh.append(f"模拟贷款：本金 {_money(info.get('principal'), 'THB')}，{info.get('months')} 个月，"
                      f"年利率 {Decimal(str(info.get('annual_rate') or 0)) * 100:.1f}%，每月最多约 "
                      f"{_money(info.get('monthly_payment'), 'THB')}。确认没问题就说“确认计划”。")
            en.append(f"Simulated loan: principal {_money(info.get('principal'), 'THB')}, {info.get('months')} months, "
                      f"{Decimal(str(info.get('annual_rate') or 0)) * 100:.1f}% a year, up to about "
                      f"{_money(info.get('monthly_payment'), 'THB')} a month. Say \"confirm plan\" when ready.")
            simulated = True
        if _ok(context, "confirm_plan"):
            zh.append("已生成计划确认请求，请在下方卡片上确认。")
            en.append("A plan confirmation is ready; confirm it on the card below.")
        if _ok(context, "confirm_enrollment"):
            zh.append("已生成入学确认请求：确认后进入在校管理，学费和还款会按计划排进账单。请在卡片上确认。")
            en.append("An enrollment confirmation is ready: once confirmed, tuition and repayments move into your "
                      "in-school schedule. Confirm it on the card.")
        return simulated


def _FinanceRules():
    from studyflow_ai.agent.planner import RuleAgentProvider

    return RuleAgentProvider()
