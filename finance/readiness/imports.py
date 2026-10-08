import hashlib
import json
import tempfile
from copy import deepcopy
from pathlib import Path

from django.db import transaction
from django.utils import timezone

from finance.workflow_common import audit, owned, require

from .models import ImportMaterial, InvoiceIdentity, ReadinessJob
from .services import business_date, normalize_draft, persist_revision, versions


def material_record(material, *, include_ocr_text=False):
    job = (
        ReadinessJob.objects.filter(payload__material_id=str(material.id))
        .order_by("-created_at")
        .first()
    )
    processing = deepcopy(material.processing)
    if not include_ocr_text:
        for page in processing.get("ocr", {}).get("pages", []):
            page.pop("text", None)
    return {
        "id": str(material.id),
        "semester_id": str(material.semester_id),
        "status": material.status,
        "job_id": str(job.id) if job else None,
        "job_status": job.status if job else None,
        "error_code": job.error_code if job else None,
        "sha256": material.sha256,
        "kind": material.kind,
        "result": material.result,
        "state_version": material.state_version,
        "budget_version": material.budget_version,
        "processing": processing,
    }


def upload(owner, data, content):
    from .jobs import enqueue
    from .ocr import consent_record

    semester, state = versions(owner, data)
    require(0 < len(content) <= 5 * 1024 * 1024, "FILE_SIZE_LIMIT")
    validate_upload(data["kind"], content)
    fingerprint = hashlib.sha256(content).hexdigest()
    material, created = ImportMaterial.objects.get_or_create(
        semester=semester,
        sha256=fingerprint,
        defaults={
            "owner": owner,
            "kind": data["kind"],
            "content": content,
            "state_version": state.version,
            "budget_version": semester.version,
            "processing": consent_record(owner, data),
        },
    )
    if created:
        enqueue(
            owner,
            "import",
            "import:" + str(material.id),
            {"material_id": str(material.id)},
        )
        audit(
            owner,
            owner,
            "readiness.material_uploaded",
            material,
            {"consent": material.processing["consent"], "sha256": fingerprint},
        )
    return material_record(material)


def validate_upload(kind, content):
    from studyflow_ai.document_validation import prepare_document
    from studyflow_ai.parsing import InputError

    if kind != "text":
        try:
            prepare_document(kind, content)
        except InputError as exc:
            require(False, exc.code)


def extract(material, job):
    from studyflow_ai.readiness.models import ExtractionContext

    from .adapter import ai_client

    with tempfile.TemporaryDirectory(prefix="studyflow-material-") as folder:
        source = material_source(material, Path(folder) / "material.pdf", job)
        context = ExtractionContext(
            reference_date=business_date(material.owner),
            student_id=str(material.owner_id),
            language="zh" if material.processing.get("language") == "zh" else "en",
        )
        ai = ai_client()
        try:
            return ai.extract_semester_material(source, context)
        finally:
            ai.close()


def material_source(material, path, job):
    from studyflow_ai.document_text import TextLayerExtractor
    from studyflow_ai.parsing import InputError
    from studyflow_ai.readiness.models import MaterialSource

    if material.kind == "text" or material.result.get("manual_transcription"):
        text = material.result.get("manual_transcription") or bytes(
            material.content
        ).decode("utf-8-sig")
        return MaterialSource(source_id=str(material.id), kind="text", text=text)
    path.write_bytes(bytes(material.content))
    try:
        TextLayerExtractor().extract(material.kind, str(path))
    except InputError as exc:
        if exc.code != "OCR_NOT_CONFIGURED":
            raise
        from .ocr import recognize

        result = recognize(material, job)
        return MaterialSource(source_id=str(material.id), kind="text", text=result.text)
    return MaterialSource(source_id=str(material.id), kind="pdf", path=str(path))


def process_material(job):
    from studyflow_ai.parsing import InputError

    material = owned(ImportMaterial, job.owner, job.payload["material_id"])
    if material.status != "QUEUED":
        return material_record(material)
    try:
        result = extract(material, job)
    except InputError as exc:
        with transaction.atomic():
            locked = ReadinessJob.objects.select_for_update().get(pk=job.pk)
            if locked.lease_token != job.lease_token:
                return {"stale": True}
            ImportMaterial.objects.filter(pk=material.pk).exclude(
                status="COMMITTED"
            ).update(
                status="NEEDS_MANUAL_INPUT"
                if exc.code.startswith("OCR_")
                else "REJECTED",
                result={"issues": [{"code": exc.code}]},
            )
        return {
            "status": "NEEDS_MANUAL_INPUT"
            if exc.code.startswith("OCR_")
            else "REJECTED",
            "error_code": exc.code,
        }
    except UnicodeDecodeError:
        ImportMaterial.objects.filter(pk=material.pk).update(
            status="REJECTED", result={"issues": [{"code": "INVALID_UTF8"}]}
        )
        return {"status": "REJECTED"}
    payload = result.model_dump(mode="json")
    if material.result.get("manual_transcription"):
        payload["source_type"] = "user_transcription"
        payload["original_sha256"] = material.sha256
    elif material.processing.get("ocr"):
        payload["source_type"] = "gemini_ocr"
        payload["original_sha256"] = material.sha256
        payload["requires_review"] = True
        if any(p["uncertain"] for p in material.processing["ocr"]["pages"]):
            payload["issues"].append({"code": "OCR_UNCERTAIN_TEXT"})
    from .merging import propose

    payload["proposed_draft"], payload["merge_conflicts"] = propose(
        material.semester.draft, payload["draft"], str(material.id)
    )
    if any(call.error_code for call in result.calls):
        return {"retry_required": True, "calls": payload["calls"]}
    with transaction.atomic():
        locked = ReadinessJob.objects.select_for_update().get(pk=job.pk)
        if locked.lease_token != job.lease_token:
            return {"stale": True}
        material = ImportMaterial.objects.select_for_update().get(pk=material.pk)
        if material.status != "COMMITTED":
            material.result = payload
            material.status = (
                "REJECTED" if payload["status"] == "REJECTED" else "NEEDS_REVIEW"
            )
            material.save(update_fields=["result", "status"])
        return material_record(material)


def invoice_fingerprint(cost):
    data = {
        key: cost.get(key)
        for key in ("amount", "currency", "due_date", "beneficiary_id")
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def check_invoice(owner, material, issuer, cost):
    if not cost.get("invoice_id"):
        return
    fingerprint = invoice_fingerprint(cost)
    existing = InvoiceIdentity.objects.filter(
        owner=owner, issuer=issuer.casefold().strip(), invoice_id=cost["invoice_id"]
    ).first()
    if existing:
        require(existing.fingerprint == fingerprint, "INVOICE_IDENTITY_CONFLICT")
        require(existing.material_id == material.id, "INVOICE_ALREADY_IMPORTED")
    else:
        InvoiceIdentity.objects.create(
            owner=owner,
            issuer=issuer.casefold().strip(),
            invoice_id=cost["invoice_id"],
            fingerprint=fingerprint,
            material=material,
        )


def check_similar(cost, previous, resolutions):
    if cost.get("invoice_id"):
        return
    signature = (cost.get("category"), cost.get("amount"), cost.get("due_date"))
    similar = [
        old
        for old in previous.values()
        if old["cost_id"] != cost["cost_id"]
        and (old.get("category"), old.get("amount"), old.get("due_date")) == signature
    ]
    require(
        not similar or bool(resolutions.get(cost["cost_id"])),
        "SIMILAR_INVOICE_REQUIRES_EXPLICIT_REVIEW",
    )


def confirm(owner, data, material):
    semester, state = versions(owner, data)
    require(material.semester_id == semester.id, "IMPORT_SEMESTER_MISMATCH")
    if material.status == "COMMITTED":
        require(material.confirmation == data, "IMPORT_ALREADY_COMMITTED")
        return material_record(material)
    require(material.status == "NEEDS_REVIEW", "IMPORT_NOT_REVIEWABLE")
    require(
        not any(
            i["code"] == "UNTRUSTED_INSTRUCTIONS"
            for i in material.result.get("issues", [])
        ),
        "UNTRUSTED_DOCUMENT_REJECTED",
    )
    draft = normalize_draft(owner, data["draft"], semester.draft)
    for field in material.result.get("merge_conflicts", {}):
        if field.startswith("profile."):
            require(
                bool(data["conflict_resolutions"].get(field)),
                "PROFILE_CONFLICT_REQUIRES_REVIEW",
            )
    ids = set(data["selected_cost_ids"])
    require(ids.issubset({c["cost_id"] for c in draft["costs"]}), "UNKNOWN_COST")
    prior = {c["cost_id"]: c for c in semester.draft["costs"]}
    for cost in draft["costs"]:
        if cost["cost_id"] not in ids:
            continue
        old = prior.get(cost["cost_id"])
        check_similar(cost, prior, data["conflict_resolutions"])
        changed = old and any(
            old.get(k) != cost.get(k) for k in ("amount", "beneficiary_id", "currency")
        )
        require(
            not (changed or cost.get("conflict"))
            or bool(data["conflict_resolutions"].get(cost["cost_id"])),
            "EXPLICIT_CONFLICT_RESOLUTION_REQUIRED",
        )
        check_invoice(owner, material, data["issuer"], cost)
        cost.update(
            confidence_type="VERIFIED",
            verification_reference=f"user:{owner.pk}:material:{material.id}",
            conflict=False,
            observed_at=timezone.now().isoformat(),
            verified_at=timezone.now().isoformat(),
            issuer=data["issuer"],
        )
        cost["source_refs"] = list(
            dict.fromkeys(cost.get("source_refs", []) + [str(material.id)])
        )
    result = persist_revision(owner, semester, state, draft)
    material.status, material.confirmation = "COMMITTED", deepcopy(data)
    from finance.services import json_value

    material.confirmation = json_value(material.confirmation)
    material.save(update_fields=["status", "confirmation"])
    return {**material_record(material), "semester": result}


def transcribe(owner, data, material):
    from .jobs import enqueue

    semester, _state = versions(owner, data)
    require(material.semester_id == semester.id, "IMPORT_SEMESTER_MISMATCH")
    require(material.status == "NEEDS_MANUAL_INPUT", "MANUAL_INPUT_NOT_REQUESTED")
    material.result = {
        "manual_transcription": data["text"],
        "source_type": "user_transcription",
        "original_sha256": material.sha256,
    }
    material.processing.pop("ocr", None)
    material.status = "QUEUED"
    material.save(update_fields=["result", "status", "processing"])
    enqueue(
        owner,
        "import",
        "transcription:" + str(material.id),
        {"material_id": str(material.id)},
    )
    audit(owner, owner, "readiness.manual_transcription", material)
    return material_record(material)
