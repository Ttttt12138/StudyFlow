"""Shared operator record presentation; commands remain on their business routes."""
from . import money, policy
from .policy_api import approval_record
from .remittance_models import RemittanceOrder
from .remittance_orders import order_record
from .workflow_common import record
from .workflow_models import Payment


def _student(obj):
    return {"owner": obj.owner_id, "owner_username": obj.owner.get_username()}


def _payment(payment):
    return {**record(payment), **_student(payment), "currency": money.home_currency(),
            "beneficiary_name": payment.beneficiary.name,
            "beneficiary_verified": payment.beneficiary.verified}


def _order(order):
    return {**order_record(order), **_student(order),
            "beneficiary_name": order.beneficiary.name if order.beneficiary_id else None}


def _application(application):
    result = application.loan.result
    return {**record(application), **_student(application), "quote": {
        key: result.get(key) for key in ("currency", "principal", "net_proceeds", "fees", "total_repayment",
                                         "maximum_installment", "affordability_status")} | {
        "months": application.loan.inputs.get("months"), "annual_rate": application.loan.inputs.get("annual_rate")}}


def _target(approval):
    """What the approval would release, so the operator decides on the real subject."""
    if approval.action == "payment.submit":
        payment = Payment.objects.select_related("owner", "beneficiary").filter(pk=approval.target_id).first()
        return payment and {"kind": "payment", **_payment(payment),
                            "payee_verified_by": policy.latest_verifier(payment.beneficiary_id)}
    if approval.action == "remittance.submit":
        order = RemittanceOrder.objects.select_related("owner", "beneficiary", "quote").filter(pk=approval.target_id).first()
        return order and {"kind": "remittance_order", **_order(order),
                          "payee_verified_by": policy.latest_verifier(order.beneficiary_id) if order.beneficiary_id else None}
    return None


def _approval(staff, approval):
    allowed = policy.separation_of_duties(staff, approval)
    blocked = None
    if not allowed:
        blocked = "OWN_REQUEST" if staff.pk in (approval.requested_by_id, approval.owner_id) else "VERIFIED_PAYEE"
    return {**approval_record(approval), **_student(approval),
            "requested_by_username": approval.requested_by.get_username(),
            "decided_by_username": approval.decided_by.get_username() if approval.decided_by_id else None,
            "can_decide": allowed and approval.status == "PENDING", "blocked_reason": blocked,
            "target": _target(approval)}


