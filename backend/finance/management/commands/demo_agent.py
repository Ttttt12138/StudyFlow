"""Synthetic agent flow over real HTTP: plan with tools, propose, confirm with step-up (docs/agent.md)."""

from pathlib import Path

from django.core.management.base import BaseCommand

from finance.management.commands.demo_readiness import require
from finance.management.commands.demo_remittance import RemittanceDemo, serve


class AgentDemo(RemittanceDemo):
    def session(self, goal, locale):
        return self.request("agent/sessions", {"goal": goal, "locale": locale})

    def run(self):
        self.setup_wallet()
        zh = self.session("帮我把5000元人民币汇到泰铢，比较一下渠道", "zh")
        require(zh["status"] == "COMPLETED", "Agent session did not complete")
        statuses = [(s["tool"], s["status"]) for s in zh["steps"]]
        require(("submit_remittance_order", "PROPOSED") in statuses, "Agent did not propose the submission")
        require(self.balance("CNY") == "40000.00", "Agent moved money before confirmation")
        pending = zh["pending_actions"][0]
        confirmed = self.request(f"agent/pending-actions/{pending['id']}/confirm", {})
        require(confirmed["status"] == "CONFIRMED" and self.balance("CNY") == "35000.00",
                "Confirmation did not submit the order")
        en = self.session("Convert 2000 CNY to THB", "en")
        proposal = en["pending_actions"][0]
        rejected = self.request(f"agent/pending-actions/{proposal['id']}/reject", {})
        require(rejected["status"] == "REJECTED" and self.balance("CNY") == "35000.00",
                "Rejected proposal changed the wallet")
        query = self.session("我的汇款订单到账了吗", "zh")
        return {
            "run_id": self.run_id,
            "remittance_session": {"steps": statuses, "answer": zh["final_answer"],
                                   "confirmed": confirmed["status"]},
            "conversion_session": {"steps": [(s["tool"], s["status"]) for s in en["steps"]],
                                   "answer": en["final_answer"], "decision": rejected["status"]},
            "status_query": {"steps": [(s["tool"], s["status"]) for s in query["steps"]],
                             "answer": query["final_answer"]},
            "policy": self.policy.log, "planner_mode": "mock", "is_simulated": True,
        }


class Command(BaseCommand):
    help = "Run agent sessions (zh/en), confirm one proposal with step-up and reject another, over HTTP."

    def add_arguments(self, parser):
        parser.add_argument("--runs", type=int, default=3)
        parser.add_argument("--output", type=Path, default=Path("output/agent-http-demo.json"))

    def handle(self, *args, **options):
        self.stdout.write(serve(AgentDemo, options, "Agent HTTP demo"))
