from importlib.resources import files

from studyflow_ai.api import StudyFlowAI
from studyflow_ai.demo_backend import DEMO_NOW, DemoBackend
from studyflow_ai.import_jobs import Actor, Confirmation, confirmed_result
from studyflow_ai.models import IngestContext, Source


def run_demo(classifier, llm):
    backend = DemoBackend(seeded=False)
    ai = StudyFlowAI(classifier, llm, backend)
    context = IngestContext(reference_date=DEMO_NOW.date())
    resources = files("studyflow_ai.data")
    history = ai.ingest(
        Source(
            source_id="rent_history",
            kind="csv",
            text=resources.joinpath("rent_history.csv").read_text(encoding="utf-8"),
        ),
        context,
    )
    backend.accept_import("student_001", history)
    recurring = ai.detect_recurring(history.transactions, DEMO_NOW.date())
    backend.add_demo_recurring(recurring[0])
    invoice = ai.ingest(
        Source(
            source_id="tuition_invoice",
            kind="email",
            text=resources.joinpath("tuition.txt").read_text(encoding="utf-8"),
        ),
        context,
    )
    confirmed = confirmed_result(
        invoice, Confirmation(), Actor(actor_id="demo_user", student_id="student_001")
    )
    backend.accept_import("student_001", confirmed)
    before = backend.read_state("student_001")
    forecast = backend.forecast(before, DEMO_NOW)
    check = ai.run_check("student_001", "import", DEMO_NOW)
    repeated = ai.run_check("student_001", "timer", DEMO_NOW)
    balance_before_receipt = backend.read_state("student_001").balance
    backend.record_demo_receipt("receipt_demo_001", "10000")
    after = ai.run_check("student_001", "receipt", DEMO_NOW)
    return {
        "backend": "DEMO_ONLY",
        "integration_acceptance": False,
        "demo_time": DEMO_NOW.isoformat(),
        "history": history.model_dump(mode="json"),
        "invoice_before_confirmation": invoice.model_dump(mode="json"),
        "recurring": [r.model_dump(mode="json") for r in recurring],
        "forecast": forecast.model_dump(mode="json"),
        "check": check.model_dump(mode="json"),
        "repeat_reused": repeated.reused,
        "balance_before_receipt": f"{balance_before_receipt:.2f}",
        "balance_after_mock_receipt": f"{backend.state.balance:.2f}",
        "after_receipt": after.model_dump(mode="json"),
        "audit": [a.model_dump(mode="json") for a in backend.audits],
        "limitations": [
            "No actual authorization, payment or reconciliation is implemented in C",
            "Funding receipt and B financial engine are simulated",
        ],
    }
