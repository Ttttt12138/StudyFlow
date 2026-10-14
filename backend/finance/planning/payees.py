"""The school's tuition account for a study plan (simulated).

Every catalog school has one seeded tuition account, verified when it was registered. A plan copies it into a
`Beneficiary` the student owns, so operators can revoke or restore it through the existing
`beneficiaries/{id}/verify/` command. Money to the school (wallet tuition payments, loan signing and every loan
payout) requires the account to be verified at the moment it moves. These are not real bank details.
"""

from finance.workflow_common import audit, require
from finance.workflow_models import Beneficiary

from . import catalog

ACCOUNT_LABEL = "Tuition account (simulated)"
# Catalog schools whose seeded tuition account is verified. A school missing here gets an unverified account.
VERIFIED = frozenset({
    "chulalongkorn", "mahidol", "malaya", "manchester", "melbourne",
    "nus", "psu-hatyai", "psu-phuket", "thammasat", "waseda",
})


def school_payee(plan):
    """The plan's school account, created from the seed the first time a plan needs it."""
    if plan.school_payee_id:
        return plan.school_payee
    entry = catalog.school(plan.school_key)
    name = entry.school.name.en if entry else plan.school_key
    verified = plan.school_key in VERIFIED
    payee = Beneficiary.objects.create(owner=plan.owner, name=name[:150], destination_label=ACCOUNT_LABEL,
                                       verified=verified)
    audit(plan.owner, plan.owner, "beneficiary.school_seeded", payee,
          {"school_key": plan.school_key, "verified": verified})
    plan.school_payee = payee
    plan.save(update_fields=["school_payee"])
    return payee


def require_verified(plan):
    require(school_payee(plan).verified, "SCHOOL_PAYEE_NOT_VERIFIED")


def payee_record(plan):
    """None while a draft plan has no account yet: drafts can still switch school."""
    if plan.status == "DRAFT" and not plan.school_payee_id:
        return None
    payee = school_payee(plan)
    return {"id": str(payee.id), "name": payee.name, "account": payee.destination_label, "verified": payee.verified}
