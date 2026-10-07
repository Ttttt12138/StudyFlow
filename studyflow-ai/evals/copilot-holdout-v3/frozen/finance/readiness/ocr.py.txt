from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from studyflow_ai.parsing import InputError

from finance.models import AuditEvent
from finance.workflow_common import audit, require

from .models import ImportMaterial, ReadinessJob

NOTICE_VERSION = "gemini-ocr-v1"


def notice():
    return {
        "version": NOTICE_VERSION,
        "provider": "Google Gemini Developer API",
        "languages": ["zh", "en", "zh-en"],
        "enabled": settings.STUDYFLOW_OCR_ENABLED,
        "configured": bool(settings.GEMINI_API_KEY and settings.STUDYFLOW_OCR_MODEL),
        "policy_configured": bool(
            settings.STUDYFLOW_OCR_PAID_SERVICE_CONFIRMED
            and settings.STUDYFLOW_OCR_ADULT_ONLY_CONFIRMED
        ),
        "text_zh": "同意将此文件中待识别的页面发送至 Google Gemini 进行中英文转录。"
        "系统会移除可移除的文件元数据，但不会自动遮盖页面上的个人信息。"
        "转录文字会进入已配置的材料提取服务；live 模式可能涉及其他服务商。"
        "结果可能有误，须人工复核，不能直接授权付款。可改用人工输入。",
        "text_en": "Allow this document's pages to be sent to Google Gemini for Chinese/English "
        "transcription. Removable metadata is stripped; personal information visible "
        "on pages is not automatically redacted. Transcribed text goes to the configured "
        "extraction service; live mode may use other providers. Review all results; "
        "recognition does not authorize payment. Manual input remains available.",
        "retention_days": settings.STUDYFLOW_DOCUMENT_RETENTION_DAYS,
        "provider_zero_retention_guaranteed": False,
        "extraction_mode": settings.STUDYFLOW_AI_MODE,
        "requires_review": True,
    }


def consent_record(owner, data):
    accepted = bool(data.get("ocr_consent", False))
    require(
        not accepted or data.get("ocr_notice_version") == NOTICE_VERSION,
        "OCR_NOTICE_VERSION_MISMATCH",
    )
    return {
        "language": data.get("language", "zh-en"),
        "consent": {
            "accepted": accepted,
            "notice_version": NOTICE_VERSION,
            "accepted_at": timezone.now().isoformat() if accepted else None,
            "actor_id": str(owner.pk),
            "extraction_mode": settings.STUDYFLOW_AI_MODE,
        },
    }


def _policy_gate(material):
    if not settings.STUDYFLOW_OCR_ENABLED:
        raise InputError("OCR_NOT_CONFIGURED")
    consent = material.processing.get("consent", {})
    if not consent.get("accepted") or consent.get("notice_version") != NOTICE_VERSION:
        raise InputError("OCR_CONSENT_REQUIRED")
    if consent.get("extraction_mode") != settings.STUDYFLOW_AI_MODE:
        raise InputError("OCR_CONSENT_REQUIRED")
    if not (
        settings.STUDYFLOW_OCR_PAID_SERVICE_CONFIRMED
        and settings.STUDYFLOW_OCR_ADULT_ONLY_CONFIRMED
    ):
        raise InputError("OCR_POLICY_NOT_CONFIGURED")
    if not material.content or material.created_at < timezone.now() - timedelta(
        days=settings.STUDYFLOW_DOCUMENT_RETENTION_DAYS
    ):
        raise InputError("OCR_SOURCE_EXPIRED")


def recognize(material, job):
    from studyflow_ai.gemini_ocr import (
        GeminiDocumentTextExtractor,
        OcrResult,
        prepare_document,
    )

    _policy_gate(material)
    if material.processing.get("ocr"):
        return OcrResult.model_validate(material.processing["ocr"])
    provider = GeminiDocumentTextExtractor(
        api_key=settings.GEMINI_API_KEY,
        model=settings.STUDYFLOW_OCR_MODEL,
        timeout=settings.STUDYFLOW_OCR_TIMEOUT,
    )
    document = prepare_document(material.kind, bytes(material.content))
    _mark_attempt(material, job)
    result = provider.recognize(document)
    _save_ocr(material, job, result)
    return result


@transaction.atomic
def _mark_attempt(material, job):
    get_user_model().objects.select_for_update().get(pk=material.owner_id)
    locked_job = ReadinessJob.objects.select_for_update().get(pk=job.pk)
    locked = ImportMaterial.objects.select_for_update().get(pk=material.pk)
    if locked_job.lease_token != job.lease_token or locked.status != "QUEUED":
        raise InputError("OCR_STALE_TASK")
    if locked.processing.get("attempted_at"):
        raise InputError("OCR_ATTEMPT_REQUIRES_REVIEW")
    recent = AuditEvent.objects.filter(
        owner=material.owner,
        action="readiness.ocr_requested",
        created_at__gte=timezone.now() - timedelta(hours=1),
    ).count()
    if recent >= settings.STUDYFLOW_OCR_REQUESTS_PER_HOUR:
        raise InputError("OCR_USER_RATE_LIMITED")
    locked.processing["attempted_at"] = timezone.now().isoformat()
    locked.save(update_fields=["processing"])
    material.processing = locked.processing
    audit(material.owner, material.owner, "readiness.ocr_requested", locked)


@transaction.atomic
def _save_ocr(material, job, result):
    locked_job = ReadinessJob.objects.select_for_update().get(pk=job.pk)
    locked = ImportMaterial.objects.select_for_update().get(pk=material.pk)
    if locked_job.lease_token != job.lease_token or locked.status != "QUEUED":
        raise InputError("OCR_STALE_TASK")
    locked.processing["ocr"] = result.model_dump(mode="json")
    locked.processing["recognized_at"] = timezone.now().isoformat()
    locked.save(update_fields=["processing"])
    material.processing = locked.processing


def authorize(owner, data, material):
    from .jobs import enqueue
    from .services import versions

    semester, _ = versions(owner, data)
    require(material.semester_id == semester.id, "IMPORT_SEMESTER_MISMATCH")
    require(material.status == "NEEDS_MANUAL_INPUT", "OCR_RETRY_NOT_AVAILABLE")
    ensure_idle(material)
    require(bool(material.content), "OCR_SOURCE_EXPIRED")
    require(data["ocr_consent"], "OCR_CONSENT_REQUIRED")
    generation = material.processing.get("generation", 0) + 1
    material.processing = {**consent_record(owner, data), "generation": generation}
    material.result, material.status = {}, "QUEUED"
    material.save(update_fields=["processing", "result", "status"])
    enqueue(
        owner,
        "import",
        f"ocr:{material.id}:{generation}",
        {"material_id": str(material.id)},
    )
    audit(
        owner,
        owner,
        "readiness.ocr_consent",
        material,
        {
            "consent": material.processing["consent"],
            "sha256": material.sha256,
            "generation": generation,
        },
    )
    from .imports import material_record

    return material_record(material)


def ensure_idle(material):
    from finance.services import VersionConflict

    jobs = list(
        ReadinessJob.objects.select_for_update().filter(
            payload__material_id=str(material.id)
        )
    )
    if any(j.status == "RUNNING" for j in jobs):
        raise VersionConflict("DOCUMENT_PROCESSING_IN_PROGRESS")


def discard_source(owner, data, material):
    from .services import versions

    semester, _ = versions(owner, data)
    require(material.semester_id == semester.id, "IMPORT_SEMESTER_MISMATCH")
    purge_source(material)
    audit(owner, owner, "readiness.source_discarded", material)
    from .imports import material_record

    return material_record(material)


@transaction.atomic
def purge_source(material):
    get_user_model().objects.select_for_update().get(pk=material.owner_id)
    ensure_idle(material)
    material.refresh_from_db()
    require(material.status != "QUEUED", "DOCUMENT_PROCESSING_IN_PROGRESS")
    if not material.content:
        return
    material.content = b""
    material.processing.pop("ocr", None)
    material.processing["source_deleted_at"] = timezone.now().isoformat()
    material.save(update_fields=["content", "processing"])


def purge_expired_sources():
    from rest_framework.exceptions import APIException

    cutoff = timezone.now() - timedelta(days=settings.STUDYFLOW_DOCUMENT_RETENTION_DAYS)
    rows = ImportMaterial.objects.filter(created_at__lt=cutoff).exclude(status="QUEUED")
    count = 0
    for material in rows.iterator():
        if not material.content:
            continue
        try:
            purge_source(material)
            count += 1
        except APIException:
            continue
    return count
