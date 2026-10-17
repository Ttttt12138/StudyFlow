"""Live-model walk through the core flow (current planning prompt; each call records its prompt_version): each reply answers, then invites the next step.

Side questions (a ranking, food nearby) are answered and still lead back to the flow; a paused loan is not
pushed; the simulated-money note appears once. Run with DB_NAME=studyflow_loan_advice_browser_20261015 (migrated). Runs against a synthetic user in the dedicated browser database.
"""
import json
from datetime import date
import os
import re
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
from finance.planning import conversation
from studyflow_ai.agent import funnel

assert settings.DATABASES["default"]["NAME"] == "studyflow_loan_advice_browser_20261015"
INTERNAL = re.compile(r"[a-z]+_[a-z_]+|\b(DRAFT|CONFIRMED|ERROR|INVALID_[A-Z_]+)\b|下一步可|下一步：|请稍后再试")
# (message, a phrase the reply must contain to point at the expected next step, phrases it must not contain)
SCRIPT = [
    ("比较一下泰国的大学", ("选这所",), ("下一步可",)),
    ("朱拉隆功的QS排名怎么样", ("选这所",), ("哪一年", "哪个榜单")),
    ("普吉校区周边有什么好吃的", ("选这所",), ()),
    ("就选宋卡王子大学普吉校区", ("借多少",), ()),
    ("我想借30万泰铢", ("按此方案申请",), ()),
    ("月供太高了", ("按此方案申请",), ()),
    ("暂时不考虑贷款", ("学校",), ("借多少", "按此方案申请")),
    ("还有别的学校推荐吗", (), ("借多少", "按此方案申请")),
]
report = {"mode": "live", "database": settings.DATABASES["default"]["NAME"], "turns": []}
out = root / "evidence/agent" / f"planning-funnel-live-{date.today():%Y%m%d}.json"
failures = []
with override_settings(STUDYFLOW_AI_MODE="live"):
    user = get_user_model().objects.create_user("funnel-live-" + uuid4().hex)
    chat = conversation.start(user, "zh")
    for text, must, must_not in SCRIPT:
        turn, _ = conversation.send(chat, text, str(uuid4()))
        answer = turn.final_answer or ""
        steps = list(turn.steps.order_by("number"))
        checks = {"completed": turn.status == "COMPLETED",
                  "no_internal_words": not INTERNAL.search(answer),
                  "points_to_next_step": all(p in answer for p in must),
                  "avoids": not any(p in answer for p in must_not),
                  "one_question_at_most": answer.count("？") + answer.count("?") <= 1,
                  "plain_text": "**" not in answer and "|---" not in answer,
                  "no_json_fragment": not re.search(r'"\}\s*$|\{"', answer)}
        record = {"goal": text, "answer": answer, "checks": checks, "tools": [s.tool for s in steps if s.tool],
                  "calls": [{k: (s.call or {}).get(k) for k in ("mode", "attempts", "prompt_version", "raw_excerpt")}
                            for s in steps]}
        report["turns"].append(record)
        failures += [f"{text}: {name}" for name, ok in checks.items() if not ok]
        print(json.dumps({"goal": text, "checks": checks, "answer": answer}, ensure_ascii=False), flush=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
note = funnel.DISCLOSURE["zh"]
disclosed = [t["goal"] for t in report["turns"] if note in t["answer"]]
if disclosed != ["就选宋卡王子大学普吉校区"]:
    failures.append(f"simulated note shown in {disclosed}, expected once on choosing the school")
report["failures"], report["passed"] = failures, not failures
out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("PASSED" if not failures else "FAILED: " + "; ".join(failures), flush=True)
