"""Explicit reminders only; ambiguous dates stay unknown for the user to complete."""
import json
import re
from datetime import date, timedelta

from .models import FinalStep, ToolCallStep


def labelled_payment(text):
    currencies = {"thb": "THB", "泰铢": "THB", "baht": "THB", "cny": "CNY", "人民币": "CNY",
                  "usd": "USD", "美元": "USD", "gbp": "GBP", "英镑": "GBP", "jpy": "JPY", "日元": "JPY",
                  "aud": "AUD", "澳元": "AUD", "sgd": "SGD", "新币": "SGD", "myr": "MYR", "令吉": "MYR", "eur": "EUR", "欧元": "EUR"}
    code = "|".join(currencies)
    number = r"(\d[\d,]*(?:\.\d+)?)"
    found = {(value.replace(",", ""), currencies[cur]) for value, cur in re.findall(number + rf"\s*({code})", text)}
    found.update((value.replace(",", ""), currencies[cur]) for cur, value in re.findall(rf"({code})\s*" + number, text))
    if len(found) == 1:
        amount, currency = found.pop()
        return {"amount": amount, "currency": currency}
    return {}


def due_date(text, today):
    explicit = re.findall(r"(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)", text)
    if explicit:
        try:
            return date.fromisoformat(explicit[0]).isoformat() if len(set(explicit)) == 1 else None
        except ValueError:
            return None
    try:
        base = date.fromisoformat(today)
    except (TypeError, ValueError):
        return None
    relative = [(word, days) for word, days in (("今天", 0), ("明天", 1), ("后天", 2), ("today", 0), ("tomorrow", 1)) if word in text]
    if len(relative) == 1:
        return (base + timedelta(days=relative[0][1])).isoformat()
    weekday = re.search(r"(下周|本周|这周)([一二三四五六日天])", text)
    if weekday:
        day = "一二三四五六日天".index(weekday[2]) % 7
        if weekday[2] == "天":
            day = 6
        return (base + timedelta(days=day - base.weekday() + (7 if weekday[1] == "下周" else 0))).isoformat()
    return None


def life_reply(context):
    text = context.goal.lower()
    create = any(word in text for word in ("提醒我", "添加待办", "新增待办", "remind me", "add task", "add a task"))
    listing = any(word in text for word in ("待办", "有哪些提醒", "我的提醒", "my reminders", "my tasks", "what is due"))
    if not (create or listing):
        return None
    zh = context.locale == "zh"
    tool = "create_study_task" if create else "get_study_life"
    observed = next((o for o in reversed(context.observations) if o.tool == tool), None)
    if observed:
        if observed.status != "OK":
            return FinalStep(answer="待办未保存，请在待办面板重试。" if zh else "The request failed. Retry in the tasks panel.")
        result = observed.result or {}
        if create:
            when = result.get("due_date") or ("日期待补，可在待办面板修改" if zh else "date unknown; edit it in the tasks panel")
            return FinalStep(answer=(f"已添加应用内待办：{result.get('title', '')}。{when}。" if zh else
                                     f"In-app reminder saved: {result.get('title', '')}. {when}."))
        items = result.get("upcoming", [])
        lines = []
        for item in items:
            title = item.get("title", "")
            if isinstance(title, dict):
                title = title.get(context.locale, title.get("en", ""))
            lines.append(f"{item.get('due_date') or ('日期待补' if zh else 'Date unknown')} · {title}")
        return FinalStep(answer="\n".join(lines) or ("暂无近期未完成待办。" if zh else "No upcoming unfinished tasks."))
    if not context.steps_remaining or tool not in {t.name for t in context.tools}:
        return FinalStep(answer="请打开待办面板继续。" if zh else "Open the tasks panel to continue.")
    if create and not context.memory.get("plan"):
        return FinalStep(answer="先选择计划中的学校，再为这份计划添加待办。" if zh else "Choose a school for your plan before adding tasks.")
    arguments = {"title": context.goal[:200], "source_text": context.goal,
                 "due_date": due_date(text, context.memory.get("today")), **labelled_payment(text)} if create else {}
    return ToolCallStep(tool=tool, arguments_json=json.dumps(arguments), rationale="User requested in-app tasks")
