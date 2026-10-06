import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import models, transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework.exceptions import PermissionDenied

from finance.models import OwnedRecord
from finance.services import VersionConflict
from finance.workflow_common import audit, record, require
from finance.workflow_models import FundingSource


class SponsorRequest(OwnedRecord):
    source = models.OneToOneField(FundingSource, on_delete=models.PROTECT)
    purpose = models.CharField(max_length=500)
    terms_version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=20, default="PENDING")
    token_generation = models.CharField(max_length=64, blank=True)
    token_digest = models.CharField(max_length=64, blank=True)
    token_expires_at = models.DateTimeField(null=True)
    confirmed_at = models.DateTimeField(null=True)
    confirmation = models.JSONField(default=dict)


def token_value(item):
    message = f"{item.id}:{item.terms_version}:{item.token_generation}"
    return salted_hmac("sponsor-invite-v1", message, algorithm="sha256").hexdigest()


def public_record(item):
    result = record(item)
    result["source"] = record(item.source)
    result["is_simulated"] = True
    if (
        item.status == "PENDING"
        and item.token_expires_at
        and item.token_expires_at <= timezone.now()
    ):
        result["status"] = "EXPIRED"
    return result


def create_request(owner, data, obj=None):
    from finance.budget_services import create_source

    source_data = {
        k: data[k] for k in ("economic_key", "currency", "amount", "available_on")
    }
    result = create_source(
        owner,
        {
            **source_data,
            "kind": "family",
            "certainty": "estimated",
            "already_in_opening": False,
        },
    )
    item = SponsorRequest.objects.create(
        owner=owner, source_id=result["id"], purpose=data["purpose"]
    )
    audit(owner, owner, "sponsor.requested", item)
    return public_record(item)


def revise_request(owner, data, item):
    require(not item.source.received, "RECEIVED_SUPPORT_IS_IMMUTABLE")
    if data["terms_version"] != item.terms_version:
        raise VersionConflict()
    item.terms_version += 1
    item.token_digest, item.token_generation, item.confirmation = "", "", {}
    item.confirmed_at, item.token_expires_at = None, None
    item.status = "REVOKED" if data["action"] == "revoke" else "PENDING"
    item.source.certainty = "estimated"
    if data["action"] == "revise":
        for field in ("amount", "currency", "available_on", "purpose"):
            require(field in data, "COMPLETE_TERMS_REQUIRED")
        item.purpose = data["purpose"]
        for field in ("amount", "currency", "available_on"):
            setattr(item.source, field, data[field])
        require(item.source.amount > 0, "POSITIVE_SUPPORT_REQUIRED")
        require(
            item.source.currency != "JPY"
            or item.source.amount == item.source.amount.to_integral_value(),
            "JPY_WHOLE_UNITS_REQUIRED",
        )
    item.source.save()
    item.save()
    audit(
        owner,
        owner,
        "sponsor." + data["action"],
        item,
        {"terms_version": item.terms_version},
    )
    return public_record(item)


def issue_link(actor, data, item):
    require(actor.is_staff, "OPERATOR_REQUIRED")
    require(item.status in {"PENDING", "EXPIRED"}, "REQUEST_NOT_PENDING")
    if data["terms_version"] != item.terms_version:
        raise VersionConflict()
    item.token_generation = secrets.token_hex(24)
    item.token_expires_at = timezone.now() + timedelta(hours=72)
    item.token_digest = hashlib.sha256(token_value(item).encode()).hexdigest()
    item.status = "PENDING"
    item.save()
    audit(
        item.owner,
        actor,
        "sponsor.link_issued",
        item,
        {"terms_version": item.terms_version},
    )
    # Only metadata is persisted in the command's idempotency response.
    return {
        "id": str(item.id),
        "terms_version": item.terms_version,
        "expires_at": item.token_expires_at.isoformat(),
        "generation": item.token_generation,
    }


def lookup_token(raw):
    require(isinstance(raw, str) and len(raw) == 64, "INVALID_SPONSOR_TOKEN")
    digest = hashlib.sha256(raw.encode()).hexdigest()
    item = SponsorRequest.objects.filter(token_digest=digest).first()
    if item is None or not constant_time_compare(item.token_digest, digest):
        raise PermissionDenied("INVALID_SPONSOR_TOKEN")
    require(
        item.token_expires_at and item.token_expires_at > timezone.now(),
        "SPONSOR_TOKEN_EXPIRED",
    )
    require(
        item.status in {"PENDING", "CONFIRMED", "REJECTED"}, "SPONSOR_TOKEN_REVOKED"
    )
    return item


def token_preview(raw):
    item = lookup_token(raw)
    require(item.status == "PENDING", "SPONSOR_TOKEN_USED")
    return {
        "request_id": str(item.id),
        "terms_version": item.terms_version,
        "amount": str(item.source.amount),
        "currency": item.source.currency,
        "available_on": str(item.source.available_on),
        "purpose": item.purpose,
        "expires_at": item.token_expires_at.isoformat(),
        "is_simulated": True,
    }


@transaction.atomic
def confirm_token(raw, data, key):
    require(1 <= len(key) <= 100, "IDEMPOTENCY_KEY_REQUIRED")
    item = lookup_token(raw)
    get_user_model().objects.select_for_update().get(pk=item.owner_id)
    item.refresh_from_db()
    # Revalidate after lock, including rotation/revocation races.
    require(
        item.token_digest == hashlib.sha256(raw.encode()).hexdigest(),
        "SPONSOR_TOKEN_REVOKED",
    )
    require(item.token_expires_at > timezone.now(), "SPONSOR_TOKEN_EXPIRED")
    expected = {"key_hash": hashlib.sha256(key.encode()).hexdigest(), **data}
    if item.status != "PENDING":
        require(item.confirmation == expected, "SPONSOR_TOKEN_USED")
        return {"request_id": str(item.id), "status": item.status, "is_simulated": True}
    require(data["terms_version"] == item.terms_version, "SPONSOR_TERMS_CHANGED")
    item.status = "CONFIRMED" if data["decision"] == "confirm" else "REJECTED"
    item.confirmed_at, item.confirmation = timezone.now(), expected
    item.source.certainty = "confirmed" if item.status == "CONFIRMED" else "estimated"
    item.source.save(update_fields=["certainty"])
    item.save()
    audit(
        item.owner,
        item.owner,
        "sponsor.link_response",
        item,
        {
            "actor_kind": "simulated_sponsor_link_holder",
            "decision": data["decision"],
            "terms_version": item.terms_version,
        },
    )
    return {"request_id": str(item.id), "status": item.status, "is_simulated": True}
