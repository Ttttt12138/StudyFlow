from fastapi import FastAPI
from fastapi.testclient import TestClient

from studyflow_ai.api import StudyFlowAI
from studyflow_ai.demo_backend import DEMO_NOW, DemoBackend
from studyflow_ai.http import create_router
from studyflow_ai.import_jobs import Actor, ImportService, MemoryJobStore
from studyflow_ai.providers.rules import RuleProvider


def client():
    backend = DemoBackend(seeded=False)
    service = ImportService(StudyFlowAI(RuleProvider(), RuleProvider(), backend), MemoryJobStore())
    app = FastAPI()
    app.include_router(
        create_router(
            service, lambda: Actor(actor_id="user1", student_id="student_001"), lambda: DEMO_NOW
        )
    )
    return TestClient(app), backend, service


def test_upload_confirm_then_idempotent_commit():
    http, backend, _ = client()
    response = http.post(
        "/imports",
        data={"kind": "email", "reference_date": "2026-10-02"},
        files={"file": ("invoice.txt", b"Tuition THB 65000 due 2026-10-15. Beneficiary: PSU")},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    job = http.get(f"/imports/{job_id}").json()
    assert job["stage"] == "NEEDS_REVIEW"
    assert backend.state.obligations == []
    response = http.post(f"/imports/{job_id}/confirm", json={})
    assert response.status_code == 200
    assert response.json()["stage"] == "COMMITTED"
    http.post(f"/imports/{job_id}/confirm", json={})
    assert len(backend.state.obligations) == 1
    assert backend.state.balance == 80000


def test_confirmation_does_not_accept_invalid_currency():
    http, _, _ = client()
    response = http.post(
        "/imports",
        data={"kind": "email", "reference_date": "2026-10-02"},
        files={"file": ("invoice.txt", b"Tuition USD 65000 due 2026-10-15. Beneficiary: PSU")},
    )
    job_id = response.json()["job_id"]
    assert http.post(f"/imports/{job_id}/confirm", json={}).json()["stage"] == "NEEDS_REVIEW"


def test_job_authorization():
    _, _, service = client()
    actor = Actor(actor_id="a", student_id="student_001")
    job = service.create(actor, DEMO_NOW.date())
    import pytest

    with pytest.raises(KeyError):
        service.get(job.job_id, Actor(actor_id="b", student_id="student_002"))
