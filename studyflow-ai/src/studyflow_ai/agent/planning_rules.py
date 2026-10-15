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
STATUS = {"DRAFT": ("草稿", "draft"), "CONFIRMED": ("已确认", "confirmed")}
SAMPLE = {"zh": "（示例数据，来自公开资料，付款前请向学校确认。）",
          "en": "(Sample data from public sources; confirm with the school before paying.)"}
SIMULATED = {"zh": "所有资金与贷款均为模拟。", "en": "All money and loans are simulated."}
AFTER_APPLICATION = {
    "zh": "钱包、换汇和汇款工具会在你于贷款面板提交贷款申请后开放。现在可以先查学校总价、比较几所学校，或打开贷款面板试算还款。",
    "en": "Wallet, currency exchange and remittance tools open after you submit the loan application in the loan "
          "panel. For now I can look up a school's total cost, compare schools, or open the loan panel to estimate "
          "repayments.",
}
HELP = {
    "zh": "告诉我想去的学校，我来算学费、住宿和生活费的全程总价；也可以比较几所学校。选定学校后，在贷款面板填写想借的金额，就能看到还款试算。",
    "en": "Tell me a school and I'll work out the full-course total for tuition, housing and living costs; "
          "I can also compare schools. Once you choose a school, type the amount to borrow in the loan panel "
          "to see the repayment estimate.",
}
LOAN_PANEL = {
    "zh": "下一步在贷款面板：填写想借的金额，选择产品、期限和还款方式，查看每月还款、总利息和总还款，然后确认计划并提交贷款申请；"
          "提交时会自动附上模拟录取通知。",
    "en": "Next, in the loan panel: type the amount to borrow, choose the product, term and repayment method, check "
          "the monthly payment, total interest and total repayment, then confirm the plan and submit the loan "
          "application. A simulated admission notice is attached automatically.",
}
AMOUNT_FILLED = {
    "zh": "已把贷款金额 {amount}{said} 填入贷款面板。下一步：在面板选择产品、期限和还款方式，查看每月还款、总利息和总还款，"
          "然后确认计划并提交贷款申请；提交时会自动附上模拟录取通知。",
    "en": "I've put the loan amount of {amount}{said} into the loan panel. Next, in the panel: choose the product, term "
          "and repayment method, check the monthly payment, total interest and total repayment, then confirm the plan "
          "and submit the loan application. A simulated admission notice is attached automatically.",
}
SUBMITTED = {
    "zh": "贷款申请已提交，可在待办里确认其余材料并签约；钱包、换汇和汇款工具已开放。",
    "en": "The loan application is submitted. Confirm the other documents and sign in your to-dos; wallet, "
          "currency exchange and remittance tools are open.",
}
NO_EXPENSES = {
    "zh": "这里不记录日常花销。我可以查看接下来的账单和还款，或在钱包里换汇、汇款。",
    "en": "Day-to-day spending is not recorded here. I can show upcoming bills and repayments, or exchange and "
          "send money from the wallet.",
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
            labels = {"principal": ("拟借金额", "borrowing amount")}
            return self._final(context, "仅需确认：" + "、".join(labels[k][0] for k in m.ambiguous) + "有多个数值或币种，应使用哪一个？其他已知资料会保留。",
                "Please clarify only " + ", ".join(labels[k][1] for k in m.ambiguous) + ": which amount and currency should I use? Other known details are retained.")
        guidance = preparation_reply(m.text, (m.plan or {}).get("status"), context.locale, m.plan)
        if guidance:
            return FinalStep(answer=guidance)
        finance = self._finance(context, m)
        if finance == "locked":
            return FinalStep(answer=AFTER_APPLICATION[context.locale])
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
            return FinalStep(answer=AFTER_APPLICATION[context.locale])
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
            return self._call("simulate_loan", "Open the loan panel for the chosen school")
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
                return None  # answer() asks for the school first
            if plan.get("status") == "CONFIRMED":
                return None  # answer() says the application is already submitted
            arguments = {"months": m.months} if m.months and 6 <= m.months <= 60 else {}
            return self._call("simulate_loan", "Open the loan panel", **arguments)
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
        simulated |= self._bills_text(context, zh, en)
        if sample:
            zh.append(SAMPLE["zh"])
            en.append(SAMPLE["en"])
        if simulated:
            zh.append(SIMULATED["zh"])
            en.append(SIMULATED["en"])
        if not zh:
            if _has(m.text, SPENT) and m.amount is not None:
                zh.append(NO_EXPENSES["zh"])
                en.append(NO_EXPENSES["en"])
            elif m.confirmed and (_has(m.text, LOAN) or _has(m.text, CONFIRM)):
                zh.append(SUBMITTED["zh"])
                en.append(SUBMITTED["en"])
            elif _has(m.text, LOAN) or _has(m.text, CONFIRM):
                zh.append("先告诉我选哪所学校。" + LOAN_PANEL["zh"])
                en.append("Tell me the school first. " + LOAN_PANEL["en"])
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

    def _bills_text(self, context, zh, en):
        shown = False
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
                zh.append(AMOUNT_FILLED["zh"].format(amount=_money(principal, "THB"), said=note[0]))
                en.append(AMOUNT_FILLED["en"].format(amount=_money(principal, "THB"), said=note[1]))
            else:
                zh.append(LOAN_PANEL["zh"])
                en.append(LOAN_PANEL["en"])
            simulated = True
        loan = _ok(context, "simulate_loan")
        if loan and not loan.result.get("open_assessment"):
            info = (loan.result.get("plan") or {}).get("loan") or {}
            zh.append(f"模拟贷款：本金 {_money(info.get('principal'), 'THB')}，{info.get('months')} 个月，"
                      f"年利率 {Decimal(str(info.get('annual_rate') or 0)) * 100:.1f}%，每月最多约 "
                      f"{_money(info.get('monthly_payment'), 'THB')}。确认无误后在贷款面板提交申请。")
            en.append(f"Simulated loan: principal {_money(info.get('principal'), 'THB')}, {info.get('months')} months, "
                      f"{Decimal(str(info.get('annual_rate') or 0)) * 100:.1f}% a year, up to about "
                      f"{_money(info.get('monthly_payment'), 'THB')} a month. Submit the application in the loan panel "
                      "when ready.")
            simulated = True
        return simulated


def _FinanceRules():
    from studyflow_ai.agent.planner import RuleAgentProvider

    return RuleAgentProvider()
