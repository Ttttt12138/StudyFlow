from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework.exceptions import PermissionDenied

from finance.services import VersionConflict, json_value
from finance.workflow_common import record, require

from .models import ReviewAction, ReviewItem


def upsert(owner, key, kind, entity_id, details):
    item, created = ReviewItem.objects.get_or_create(
        owner=owner,
        key=key,
        defaults={"kind": kind, "entity_id": entity_id, "details": json_value(details)},
    )
    if not created and (
        item.details != json_value(details) or item.status == "RESOLVED"
    ):
        before = record(item)
        item.details, item.status = json_value(details), "OPEN"
        item.version += 1
        item.save()
        history(item, owner, "reopened", "Underlying evidence changed", before)
    return item


def history(item, actor, action, reason, before):
    ReviewAction.objects.create(
        owner=item.owner,
        item=item,
        actor=actor,
        action=action,
        reason=reason,
        before=before,
        after=record(item),
    )


def classify(instance):
    name = type(instance).__name__
    if name == "ImportMaterial" and instance.status in {
        "NEEDS_REVIEW",
        "NEEDS_MANUAL_INPUT",
    }:
        return "material", {
            "status": instance.status,
            "conflicts": instance.result.get("merge_conflicts", {}),
            "issues": instance.result.get("issues", []),
            "next_action": "confirm_material"
            if instance.status == "NEEDS_REVIEW"
            else "transcribe",
        }
    if name == "SimulatedApplication" and instance.status == "UNDER_REVIEW":
        return "loan", {"assessment": instance.assessment, "next_action": "decide_loan"}
    if name == "Beneficiary" and not instance.verified:
        return "beneficiary", {
            "name": instance.name,
            "destination_label": instance.destination_label,
            "next_action": "verify_beneficiary",
        }
    if name == "Payment" and instance.status in {"failed", "reconciliation_exception"}:
        return "payment", {
            "status": instance.status,
            "next_action": "reconcile_payment"
            if instance.status == "reconciliation_exception"
            else "Inspect failure and create a new payment after correction",
        }
    if name == "RemittanceOrder" and instance.status in {"REFUNDED", "UNKNOWN"}:
        return "remittance", {
            "status": instance.status,
            "failure_reason": instance.failure_reason,
            "next_action": "Wait for the operator to resolve the transfer"
            if instance.status == "UNKNOWN"
            else "Funds were refunded; create a new order after correcting the cause",
        }
    if name == "ReadinessJob" and instance.status == "RETRY":
        return "model_failure", {
            "error_code": instance.error_code,
            "attempts": instance.attempts,
            "next_action": "Wait for worker retry or repair provider configuration",
        }
    return None


@transaction.atomic
def sync(instance):
    get_user_model().objects.select_for_update().get(pk=instance.owner_id)
    key = type(instance).__name__ + ":" + str(instance.id)
    finding = classify(instance)
    if finding:
        return upsert(instance.owner, key, finding[0], instance.id, finding[1])
    item = ReviewItem.objects.filter(owner=instance.owner, key=key).first()
    if type(instance).__name__ == "ImportMaterial" and instance.status != "COMMITTED":
        return item
    if type(instance).__name__ == "ReadinessJob" and instance.status != "DONE":
        return item
    if item and item.status != "RESOLVED":
        before = record(item)
        item.status, item.version = "RESOLVED", item.version + 1
        item.save()
        history(
            item,
            instance.owner,
            "resolved_by_domain",
            "Underlying workflow resolved the condition",
            before,
        )
    return item


def domain_action(actor, data, item):
    from finance import execution_services, lending_applications
    from finance import workflow_serializers as ws
    from finance.readiness import imports, ocr
    from finance.readiness import serializers as rs
    from finance.readiness.models import ImportMaterial
    from finance.workflow_models import Beneficiary, Payment, SimulatedApplication

    mapping = {
        "confirm_material": (
            "material",
            ImportMaterial,
            rs.ConfirmationInput,
            imports.confirm,
            False,
        ),
        "transcribe": (
            "material",
            ImportMaterial,
            rs.TranscriptionInput,
            imports.transcribe,
            False,
        ),
        "authorize_ocr": (
            "material",
            ImportMaterial,
            rs.OcrConsentInput,
            ocr.authorize,
            False,
        ),
        "decide_loan": (
            "loan",
            SimulatedApplication,
            ws.DecisionInput,
            lending_applications.application_decision,
            True,
        ),
        "verify_beneficiary": (
            "beneficiary",
            Beneficiary,
            ws.VerifyInput,
            execution_services.verify_beneficiary,
            True,
        ),
        "reconcile_payment": (
            "payment",
            Payment,
            ws.EmptyInput,
            execution_services.reconcile,
            False,
        ),
    }
    action = data.get("domain_action")
    require(action in mapping, "DOMAIN_ACTION_REQUIRED")
    kind, model, serializer, handler, staff = mapping[action]
    require(item.kind == kind, "REVIEW_ACTION_MISMATCH")
    if staff and not actor.is_staff:
        raise PermissionDenied("Operator review required")
    if not staff and actor.pk != item.owner_id:
        raise PermissionDenied("Student confirmation required")
    target = model.objects.get(pk=item.entity_id, owner=item.owner)
    checked = serializer(data=data["payload"])
    checked.is_valid(raise_exception=True)
    handler(actor, checked.validated_data, target)
    target.refresh_from_db()
    sync(target)


def act(actor, data, item):
    if item.version != data["expected_version"]:
        raise VersionConflict()
    before = record(item)
    action = data["action"]
    if (
        action in {"assign", "start", "request_information", "reject"}
        and not actor.is_staff
    ):
        raise PermissionDenied("Operator review required")
    if action == "assign":
        assignee = (
            get_user_model()
            .objects.filter(pk=data.get("assignee_id"), is_staff=True, is_active=True)
            .first()
        )
        require(assignee is not None, "ACTIVE_OPERATOR_REQUIRED")
        item.assignee = assignee
    elif action in {"start", "request_information", "reject"}:
        require(item.status != "RESOLVED", "REVIEW_ALREADY_RESOLVED")
        item.status = {
            "start": "IN_PROGRESS",
            "request_information": "WAITING_INFORMATION",
            "reject": "REJECTED",
        }[action]
    elif action == "domain_action":
        domain_action(actor, data, item)
        item.refresh_from_db()
    elif action == "recheck":
        recheck(item)
        item.refresh_from_db()
    item.version += 1
    item.save()
    history(item, actor, action, data["reason"], before)
    return record(item)


def recheck(item):
    from django.apps import apps

    if item.kind == "protected_cost":
        from finance.readiness.models import Semester

        from .models import WhatIfRun

        run = WhatIfRun.objects.get(pk=item.entity_id)
        semester = Semester.objects.get(pk=run.semester_id)
        costs = {c["cost_id"]: c for c in semester.draft["costs"]}
        resolved = all(
            costs.get(b["cost_id"]) != b["before"]
            and costs.get(b["cost_id"], {}).get("confidence_type") == "VERIFIED"
            and not costs.get(b["cost_id"], {}).get("conflict")
            and costs.get(b["cost_id"], {}).get("amount") == b["proposed"]["amount"]
            for b in item.details["blockers"]
        )
        require(resolved, "REPLACEMENT_EVIDENCE_REQUIRED")
        item.status = "RESOLVED"
        item.save()
    else:
        model = apps.get_model("finance", item.key.split(":", 1)[0])
        sync(model.objects.get(pk=item.entity_id, owner=item.owner))
