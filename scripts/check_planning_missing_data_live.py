"""Live-model regression: questions the school data cannot answer (current planning prompt; each call records its prompt_version).

Each answer must state the gap without a tool call, name where to check, and not end on a question.
Run with DB_NAME=studyflow_loan_advice_browser_20261015 (migrated). Runs against synthetic users in the dedicated browser database.
"""
import json
from datetime import date
import os
import sys
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import override_settings
from finance.agent_runner import URL
from finance.planning import catalog, conversation

assert settings.DATABASES["default"]["NAME"] == "studyflow_loan_advice_browser_20261015"
SCRIPTS = {
    "ranking": ["曼彻斯特大学和墨尔本大学哪个排名更高", "qs", "现有的"],
    "admission": ["朱拉隆功大学的录取要求是什么", "雅思要多少分"],
    "visa": ["去泰国读书的学生签证怎么办"],
}
WEBSITES = {str(entry.school.website) for entry in catalog.schools()}
GAP_QUESTIONS = ("哪一年", "哪个榜单", "哪种排名", "哪个排名", "你能提供", "请提供", "告诉我排名")
SOURCE = ("官网", "官方", "网站", "http", "使馆", "领事馆", "使领馆", "移民局", "QS")
report = {"mode": "live", "database": settings.DATABASES["default"]["NAME"], "conversations": {}}
out = root / "evidence/agent" / f"planning-missing-data-live-{date.today():%Y%m%d}.json"
failures = []
with override_settings(STUDYFLOW_AI_MODE="live"):
    for name, messages in SCRIPTS.items():
        user = get_user_model().objects.create_user("missing-data-live-" + uuid4().hex)
        chat = conversation.start(user, "zh")
        turns = report["conversations"][name] = []
        for text in messages:
            turn, _ = conversation.send(chat, text, str(uuid4()))
            answer = turn.final_answer or ""
            steps = list(turn.steps.order_by("number"))
            record = {"goal": text, "status": turn.status, "error": turn.error_code, "answer": answer,
                      "tools": [s.tool for s in steps if s.tool],
                      "calls": [{k: (s.call or {}).get(k) for k in ("mode", "attempts", "prompt_version")}
                                for s in steps]}
            checks = {"completed": turn.status == "COMPLETED", "no_tool_call": not record["tools"],
                      "names_a_source": any(word in answer for word in SOURCE),
                      # planning-2.4 ends on one question that invites the next step; it must not ask
                      # about the missing data itself (which list, which year) or ask the user to supply it.
                      "no_question_about_the_gap": not any(w in answer for w in GAP_QUESTIONS),
                      "only_catalog_links": all(url.rstrip(".,;") in WEBSITES for url in URL.findall(answer))}
            record["checks"] = checks
            turns.append(record)
            failures += [f"{name}/{text}: {check}" for check, ok in checks.items() if not ok]
            print(json.dumps({"goal": text, "checks": checks, "answer": answer}, ensure_ascii=False), flush=True)
            out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
report["failures"] = failures
report["passed"] = not failures
out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("PASSED" if not failures else "FAILED: " + "; ".join(failures), flush=True)
