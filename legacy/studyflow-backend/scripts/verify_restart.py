"""Capture/verify durable demo state on either side of an operator-controlled DB restart."""

import argparse
import hashlib
import json
import os
from pathlib import Path

from sqlalchemy import select

from studyflow_backend.database import make_engine, sessions
from studyflow_backend.models import Actor, Audit, Idempotency, Ledger, Loan, Wallet
from studyflow_backend.transactions import Command, execute


def snapshot(factory, student_id):
    with factory.begin() as session:
        wallet = session.get(Wallet, student_id)
        loans = session.scalars(select(Loan).where(Loan.student_id == student_id)).all()
        ledger = session.scalars(
            select(Ledger).where(Ledger.student_id == student_id).order_by(Ledger.sequence)
        ).all()
        audits = session.scalars(select(Audit).where(Audit.student_id == student_id)).all()
        return {
            "balance": str(wallet.balance),
            "wallet_version": wallet.version,
            "loans": sorted([(r.id, r.status, str(r.outstanding_principal)) for r in loans]),
            "ledger": [(r.id, str(r.amount), str(r.balance_after)) for r in ledger],
            "audit_ids": sorted(row.id for row in audits),
        }


def replay(factory, report):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    admin_id = "demo_admin_" + report["run_id"]
    application = report["approved"]
    with factory() as session:
        assert session.get(Actor, admin_id)
        original = session.get(Idempotency, (admin_id, "demo-disburse")).response
    request = Command(
        admin_id,
        f"/api/v1/admin/loan-applications/{application['application_id']}/disburse",
        "demo-disburse",
        {"expected_version": application["version"]},
        datetime.now(ZoneInfo("Asia/Bangkok")),
        "restart-check",
    )

    def should_not_execute(session):
        raise RuntimeError("Replay record was lost across restart")

    if execute(factory, request, should_not_execute) != original:
        raise RuntimeError("Replay response changed after restart")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["capture", "verify"])
    parser.add_argument("--report", type=Path, default=Path("output/demo-with-c.json"))
    parser.add_argument("--snapshot", type=Path, default=Path("output/restart-snapshot.json"))
    args = parser.parse_args()
    engine = make_engine(os.environ["DEMO_DATABASE_URL"])
    if not engine.url.database.endswith("_demo"):
        raise ValueError("Only dedicated demo databases are supported")
    try:
        report = json.loads(args.report.read_text(encoding="utf-8"))
        data = snapshot(sessions(engine), report["student_id"])
        digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        if args.mode == "capture":
            args.snapshot.write_text(json.dumps({"sha256": digest}), encoding="utf-8")
        else:
            if json.loads(args.snapshot.read_text())["sha256"] != digest:
                raise RuntimeError("Durable state changed after database restart")
            replay(sessions(engine), report)
        print(json.dumps({"mode": args.mode, "passed": True}))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
