"""Faults are confined to the CLI's isolated synthetic identities, never public API switches."""

import io
from unittest.mock import patch
from uuid import uuid4

from django.test import override_settings
from PIL import Image

from finance.management.commands.demo_readiness import require
from finance.workflow_models import DemoLedgerEntry

SCENARIOS = [
    "conflicting_tuition",
    "abnormal_amount",
    "duplicate_payment",
    "insufficient_funds",
    "beneficiary_changed",
    "model_failure",
    "payment_failure",
    "ocr_failure",
    "stale_version",
    "reconciliation_mismatch",
]


def rejected(demo, route, body, statuses=(400, 409)):
    before = DemoLedgerEntry.objects.filter(owner=demo.student).count()
    response = demo.http.post(
        route + "/",
        json=body,
        headers={
            "Authorization": "Token " + demo.tokens["student"],
            "Idempotency-Key": uuid4().hex,
        },
    )
    require(
        response.status_code in statuses,
        f"Expected rejection at {route}: {response.status_code}",
    )
    require(
        DemoLedgerEntry.objects.filter(owner=demo.student).count() == before,
        "Rejected action posted ledger",
    )
    result = {
        "route": route,
        "http_status": response.status_code,
        "error": response.json(),
        "ledger_unchanged": True,
    }
    demo.steps.append({**result, "status": "EXPECTED_REJECTION"})
    return result


def run_failure(demo, name):
    demo.prepare()
    if name == "abnormal_amount":
        return rejected(
            demo,
            "loans",
            {
                "principal": "-1.00",
                "fees": "0",
                "annual_rate": "0",
                "months": 12,
                "first_due_date": "2026-09-05",
            },
        )
    if name == "stale_version":
        context = demo.context()
        demo.request("demo/clock", {"date": "2026-08-02"})
        return rejected(demo, "readiness/budgets", context, (409,))
    if name == "model_failure":
        demo.request("demo/clock", {"date": "2026-08-02"})
        job = demo.request("readiness/checks", demo.context())
        with patch(
            "finance.readiness.adapter.run_check",
            side_effect=RuntimeError("Injected provider failure"),
        ):
            result = demo.drain(job["id"])
        require(result["status"] == "RETRY", "Failed model did not enter retry")
        require(
            not DemoLedgerEntry.objects.filter(owner=demo.student).exists(),
            "Model failure moved funds",
        )
        return {"fault_injection": True, "job": result, "ledger_unchanged": True}
    if name == "ocr_failure":
        return ocr_failure(demo)
    if name == "conflicting_tuition":
        return conflicting_tuition(demo)
    if name == "insufficient_funds":
        plan = demo.request(
            "readiness/funding-plans", {**demo.context(), "allocations": []}
        )
        require(plan["result"]["validation"] == "INVALID", "Underfunded plan passed")
        return rejected(
            demo,
            "payments",
            {
                "readiness_plan_id": plan["id"],
                "event_id": "cost:tuition:2026-08-10",
                "beneficiary_id": demo.beneficiary["id"],
            },
        )
    demo.sponsor()
    demo.borrow()
    payment, body = demo.create_payment()
    if name == "duplicate_payment":
        return rejected(demo, "payments", body)
    route = "payments/" + payment["id"]
    demo.request(
        route + "/authorize", {"state_version": demo.context()["state_version"]}
    )
    if name == "beneficiary_changed":
        demo.request(
            "readiness/beneficiaries/" + demo.beneficiary["id"] + "/update",
            {
                "state_version": demo.context()["state_version"],
                "name": "Changed payee",
                "destination_label": "CHANGED",
            },
        )
        return rejected(demo, route + "/submit", {})
    demo.request(route + "/submit", {})
    if name == "payment_failure":
        before = DemoLedgerEntry.objects.filter(owner=demo.student).count()
        result = demo.request(
            route + "/adapter-event", {"outcome": "failed"}, operator=True
        )
        require(result["status"] == "failed", "Failed adapter accepted")
        require(
            DemoLedgerEntry.objects.filter(owner=demo.student).count() == before,
            "Failed payment posted ledger",
        )
        return {"payment": result, "ledger_unchanged": True}
    demo.request(route + "/adapter-event", {"outcome": "settled"}, operator=True)
    with patch(
        "finance.readiness.payment_bridge.reconcile_invoice", return_value=False
    ):
        result = demo.request(route + "/reconcile", {})
    require(
        result["status"] == "reconciliation_exception",
        "Receipt mismatch not held for review",
    )
    return {"fault_injection": True, "payment": result}


def ocr_failure(demo):
    buffer = io.BytesIO()
    Image.new("RGB", (80, 80), "white").save(buffer, format="PNG")
    with override_settings(STUDYFLOW_OCR_ENABLED=False):
        material = demo.request(
            "readiness/imports",
            data={**demo.context(), "kind": "image"},
            files={"file": ("blank-synthetic.png", buffer.getvalue(), "image/png")},
        )
        demo.drain()
        result = demo.request("readiness/imports/" + material["id"])
    require(
        result["status"] == "NEEDS_MANUAL_INPUT",
        "OCR unavailable did not request manual input",
    )
    return {"fault_injection": True, "fault": "OCR_DISABLED", "material": result}


def conflicting_tuition(demo):
    material = demo.request(
        "readiness/imports",
        data={**demo.context(), "kind": "text"},
        files={
            "file": (
                "conflict.txt",
                b"Tuition: THB 190000 per semester; unpaid; due 2026-08-10; invoice_id DEMO-175",
                "text/plain",
            )
        },
    )
    demo.drain()
    semester = demo.request("readiness/semesters/" + demo.context()["semester_id"])
    draft = semester["draft"]
    cost = next(c for c in draft["costs"] if c["cost_id"] == "tuition")
    cost.update(amount="190000.00", confidence_type="UNCONFIRMED", conflict=True)
    return rejected(
        demo,
        "readiness/imports/" + material["id"] + "/confirm",
        {
            **demo.context(),
            "draft": draft,
            "issuer": "SYNTHETIC PSU integration fixture",
            "selected_cost_ids": ["tuition"],
            "conflict_resolutions": {},
        },
    )
