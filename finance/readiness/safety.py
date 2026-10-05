from finance.workflow_common import append_state, audit, current, record


def update_beneficiary(owner, data, beneficiary):
    state = current(owner, data["state_version"])
    changed = any(
        getattr(beneficiary, key) != data[key] for key in ("name", "destination_label")
    )
    if changed:
        beneficiary.name = data["name"]
        beneficiary.destination_label = data["destination_label"]
        beneficiary.verified = False
        beneficiary.save(update_fields=["name", "destination_label", "verified"])
        append_state(owner, state.snapshot, owner, "readiness.beneficiary_changed")
        audit(owner, owner, "readiness.beneficiary_verification_revoked", beneficiary)
    return record(beneficiary)
