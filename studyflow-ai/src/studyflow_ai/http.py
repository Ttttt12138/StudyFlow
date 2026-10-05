"""Optional router to mount in B's authenticated FastAPI app; no standalone server."""

import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from studyflow_ai.import_jobs import Actor, Confirmation, ImportJob
from studyflow_ai.models import PlanResult, Source
from studyflow_ai.parsing import MAX_BYTES


def _process_upload(service, job, kind, content, now):
    if kind != "pdf":
        try:
            text = content.decode("utf-8-sig")
        except UnicodeError:
            job.stage, job.error_code = "REJECTED", "INVALID_UTF8"
            service.store.put(job)
            return
        service.process(job.job_id, Source(source_id=job.job_id, kind=kind, text=text), now)
        return
    with tempfile.TemporaryDirectory(prefix="studyflow-") as directory:
        path = Path(directory) / "source.pdf"
        path.write_bytes(content)
        service.process(job.job_id, Source(source_id=job.job_id, kind="pdf", path=str(path)), now)


def create_router(service, actor_dependency, clock=None):
    """B supplies authentication; request bodies never set trusted-source flags."""
    router = APIRouter()
    clock = clock or (lambda: datetime.now(ZoneInfo("Asia/Bangkok")))

    @router.post("/imports", response_model=ImportJob, status_code=202)
    async def submit(
        background: BackgroundTasks,
        file: UploadFile = File(...),
        kind: Literal["csv", "email", "pdf"] = Form(...),
        reference_date: date = Form(...),
        actor: Actor = Depends(actor_dependency),
    ):
        content = await file.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise HTTPException(413, "INPUT_TOO_LARGE")
        job = service.create(actor, reference_date)
        background.add_task(_process_upload, service, job, kind, content, clock())
        return job

    @router.get("/imports/{job_id}", response_model=ImportJob)
    def get_import(job_id: str, actor: Actor = Depends(actor_dependency)):
        try:
            return service.get(job_id, actor)
        except KeyError:
            raise HTTPException(404, "IMPORT_NOT_FOUND") from None

    @router.post("/imports/{job_id}/confirm", response_model=ImportJob)
    def confirm(job_id: str, body: Confirmation, actor: Actor = Depends(actor_dependency)):
        try:
            return service.confirm(job_id, body, actor, clock())
        except KeyError:
            raise HTTPException(404, "IMPORT_NOT_FOUND") from None
        except ValueError:
            raise HTTPException(422, "INVALID_CONFIRMATION") from None

    @router.post("/plans", response_model=list[PlanResult])
    def plans(actor: Actor = Depends(actor_dependency)):
        result = service.ai.run_check(actor.student_id, "manual", clock())
        return result.planning

    return router
