from copy import deepcopy
from datetime import date,timedelta
from decimal import Decimal
from django.db.models import Sum
from django.utils import timezone
from .workflow_models import (
    DemoWallet,DemoLedgerEntry,Beneficiary,Payment,FundingPlan,
)
from .workflow_common import require,owned,current,audit,append_state,record,shift_date
from .budget_services import evaluate_plan,convert
from .services import VersionConflict
from . import money
from .wallets import wallet, post

def available(item):
    held = Payment.objects.filter(owner=item.owner,status__in=["pending","unknown"]).aggregate(
        total=Sum("amount"))["total"] or Decimal(0)
    return item.balance-held

def initialize(actor,data,obj=None):
    require(not DemoWallet.objects.filter(owner=actor).exists(),"Demo wallet is already initialized.")
    state = current(actor,data["state_version"])
    item = DemoWallet.objects.create(owner=actor,initial_state=state,
        balance=state.snapshot["opening_balance"],clock=state.snapshot["as_of"])
    audit(actor,actor,"demo.initialized",item,{"is_simulated":True})
    return record(item)

def advance_clock(actor,data,obj=None):
    item = wallet(actor)
    require(data["date"] >= item.clock,"Demo clock cannot move backward.")
    require((data["date"]-item.clock).days <= 730,"Advance at most 730 days per command.")
    item.clock = data["date"]
    item.save(update_fields=["clock"])
    audit(actor,actor,"demo.clock_advanced",item)
    return record(item)

def create_beneficiary(actor,data,obj=None):
    beneficiary = Beneficiary.objects.create(owner=actor,**data)
    audit(actor,actor,"beneficiary.created",beneficiary)
    return record(beneficiary)

def verify_beneficiary(actor,data,obj):
    obj.verified = data["verified"]
    obj.save(update_fields=["verified"])
    audit(obj.owner,actor,"beneficiary.mock_verification",obj)
    return record(obj)

def check_plan(plan):
    result = evaluate_plan(plan.owner,plan.scenario,plan.inputs["allocations"])
    require(result["feasibility"] == "feasible","Execution requires a complete feasible plan without uncertain funding.")
    require(all(event["certainty"] == "confirmed" for event in result["timeline"]),
        "Confirm expense estimates before execution.")
    return result

def create_payment(actor,data,obj=None):
    if data.get('readiness_plan_id'):
        from finance.readiness.payment_bridge import create
        payment = create(actor, data)
        audit(actor, actor, 'payment.created', payment)
        return record(payment)
    require(not data["event_id"].startswith("repayment:"), "Use the loan account repayment endpoint.")
    plan = owned(FundingPlan,actor,data["plan_id"])
    check_plan(plan)
    state = current(actor,plan.scenario.state.version)
    beneficiary = owned(Beneficiary,actor,data["beneficiary_id"])
    require(beneficiary.verified,"Beneficiary needs controlled mock verification.")
    event = next((e for e in state.snapshot["events"] if e["id"] == data["event_id"]),None)
    require(event is not None and event["kind"] == "expense" and event["certainty"] == "confirmed",
        "Payment requires a confirmed expense.")
    require(event.get("beneficiary_id") == str(beneficiary.id),
        "Confirm this beneficiary on the expense before creating a payment.")
    require(event["amount"] is not None and Decimal(event["amount"]) > 0 and event["date"],
        "Expense needs positive amount and due date.")
    require(event["date"] <= plan.scenario.inputs["end_date"],"Plan horizon does not cover the payment.")
    require(not Payment.objects.filter(owner=actor,event_id=event["id"]).exclude(
        status__in=["failed","cancelled","expired"]).exists(),"Expense already has an active or settled payment.")
    item = wallet(actor)
    require(item.clock <= date.fromisoformat(event["date"]),"Expense is overdue on the demo clock.")
    task = Payment.objects.create(owner=actor,plan=plan,state=state,beneficiary=beneficiary,
        event_id=event["id"],amount=event["amount"],due_on=event["date"])
    audit(actor,actor,"payment.created",task)
    return record(task)

def authorize(actor,data,obj):
    require(obj.status == "draft","Only draft payments can be authorized.")
    state = current(obj.owner,data["state_version"])
    if state.id != obj.state_id: raise VersionConflict()
    check_payment_plan(obj)
    require(obj.beneficiary.verified,"Beneficiary verification was revoked.")
    obj.authorized_until = timezone.now()+timedelta(seconds=data["expires_in_seconds"])
    obj.status = "authorized"
    obj.save(update_fields=["authorized_until","status"])
    audit(obj.owner,actor,"payment.authorized",obj,{
        "state_version":state.version,"plan_id":str(obj.plan_id or obj.readiness_plan_id),
        "beneficiary_id":str(obj.beneficiary_id),"amount":str(obj.amount),"currency":money.home_currency(),
        "mock_fee":"0.00","expires_at":obj.authorized_until.isoformat(),
    })
    return record(obj)

def cancel(actor,data,obj):
    require(obj.status in ["draft","authorized"],"Submitted payments cannot be cancelled without adapter resolution.")
    obj.status = "cancelled"
    obj.authorized_until = None
    obj.save(update_fields=["status","authorized_until"])
    audit(obj.owner,actor,"payment.authorization_revoked",obj)
    return record(obj)

def submit(actor,data,obj):
    if obj.status in ["pending","unknown","settled","reconciled","reconciliation_exception"]: return record(obj)
    require(obj.status == "authorized","Payment needs authorization.")
    require(obj.authorized_until and obj.authorized_until > timezone.now(),"Authorization expired.")
    state = current(obj.owner,obj.state.version)
    check_payment_plan(obj)
    require(obj.beneficiary.verified,"Beneficiary verification was revoked.")
    item = wallet(obj.owner)
    require(item.clock <= obj.due_on,"Payment deadline passed.")
    require(available(item)-obj.amount >= Decimal(state.snapshot["reserve"]),
        "Available settled demo funds cannot cover payment and reserve; promises are not balance.")
    obj.status = "pending"
    obj.save(update_fields=["status"])
    audit(obj.owner,actor,"payment.mock_submitted",obj,{"operation_key":str(obj.id)})
    return record(obj)

def payment_event(actor,data,obj):
    outcome = data["outcome"]
    if outcome == "settled" and obj.status in ["settled","reconciled","reconciliation_exception"]: return record(obj)
    require(obj.status in ["pending","unknown"],"Adapter result requires a submitted task.")
    if outcome == "unknown":
        obj.status = "unknown"
    elif outcome == "failed":
        obj.status = "failed"
    else:
        item = wallet(obj.owner)
        require(item.balance >= obj.amount,"Demo ledger balance invariant failed.")
        state = current(obj.owner)
        snapshot = deepcopy(state.snapshot)
        event = next((e for e in snapshot["events"] if e["id"] == obj.event_id),None)
        require(event is not None and Decimal(event["amount"]) == obj.amount,
            "Submitted obligation was changed; resolve state before processing adapter evidence.")
        sequence = post(item,money.home_currency(),-obj.amount,{"payment":obj}).sequence
        event["date"] = item.clock.isoformat()
        event["settled_sequence"] = sequence
        append_state(obj.owner,snapshot,actor,"state.payment_settled")
        obj.receipt = {"reference":"mock:"+str(obj.id),"operation_key":str(obj.id),
            "event_id":obj.event_id,"amount":format(obj.amount,".2f"),"currency":money.home_currency(),
            "beneficiary_id":str(obj.beneficiary_id),"is_simulated":True,
            "settled_on":item.clock.isoformat()}
        if obj.invoice_snapshot:
            obj.receipt.update({k: obj.invoice_snapshot[k] for k in ('invoice_id', 'issuer')})
        obj.status = "settled"
    obj.save(update_fields=["status","receipt"])
    audit(obj.owner,actor,"payment.mock_"+obj.status,obj)
    return record(obj)

def reconcile(actor,data,obj):
    if obj.status == "reconciled": return record(obj)
    require(obj.status in {'settled', 'reconciliation_exception'} and obj.receipt is not None,"Settlement receipt required.")
    if obj.readiness_plan_id:
        from finance.readiness.payment_bridge import reconcile_invoice
        if not reconcile_invoice(obj):
            obj.status = 'reconciliation_exception'
            obj.save(update_fields=['status'])
            audit(obj.owner, actor, 'payment.invoice_mismatch', obj)
            return record(obj)
    receipt = obj.receipt
    require(receipt["event_id"] == obj.event_id and Decimal(receipt["amount"]) == obj.amount
        and receipt["beneficiary_id"] == str(obj.beneficiary_id),"Receipt does not match obligation.")
    require(DemoLedgerEntry.objects.filter(payment=obj,amount=-obj.amount).exists(),"Ledger settlement missing.")
    obj.status = "reconciled"
    obj.save(update_fields=["status"])
    audit(obj.owner,actor,"payment.reconciled",obj,{"receipt":receipt["reference"]})
    from finance.readiness.jobs import enqueue_check
    enqueue_check(obj.owner, 'invoice_reconciled')
    return record(obj)


def check_payment_plan(payment):
    if payment.readiness_plan_id:
        from finance.readiness.payment_bridge import check
        return check(payment)
    return check_plan(payment.plan)

def receive_funding(actor,data,obj):
    if obj.received: return record(obj)
    if obj.kind in {'family', 'family_support'}:
        from finance.sponsorship import SponsorRequest
        require(SponsorRequest.objects.filter(source=obj, status='CONFIRMED').exists(), 'SPONSOR_CONFIRMATION_REQUIRED')
    require(obj.kind != "loan","Loans must use the application/disbursement flow.")
    require(not obj.already_in_opening,"Opening funds cannot be received twice.")
    item = wallet(obj.owner)
    hold = data.get("hold_in_source_currency", False)
    if hold:
        # Foreign holdings stay outside the home-currency cash-flow state until converted.
        require(obj.currency != money.home_currency(),"HOLD_REQUIRES_FOREIGN_CURRENCY")
        require(not data.get("fx_quote_id"),"HOLD_WITHOUT_QUOTE")
        money.require_supported(obj.currency)
        amount,days,currency = money.require_precision(obj.amount,obj.currency),0,obj.currency
    else:
        amount,days,_ = convert(obj.owner,obj.amount,obj.currency,data.get("fx_quote_id"),consume=True)
        currency = money.home_currency()
    require(item.clock >= shift_date(obj.available_on,days),"Funding has not reached its availability/settlement date.")
    state = current(obj.owner)
    require(not any(event["id"] == obj.economic_key for event in state.snapshot["events"]),
        "Funding is already represented in state.")
    require(hold or item.balance+amount <= money.MAX_BALANCE,"Wallet precision limit exceeded.")
    sequence = post(item,currency,amount,{"funding_source":obj}).sequence
    if not hold:
        snapshot = deepcopy(state.snapshot)
        snapshot["events"].append({"id":"received:"+str(obj.id),"label":"Simulated "+obj.kind,
            "kind":"income","amount":format(amount,".2f"),"date":item.clock.isoformat(),"certainty":"confirmed",
            "settled_sequence":sequence})
        append_state(obj.owner,snapshot,actor,"state.funding_received")
    obj.received = True
    obj.save(update_fields=["received"])
    if obj.kind in {'family', 'family_support'}:
        SponsorRequest.objects.filter(source=obj).update(status='RECEIVED')
    audit(obj.owner,actor,"funding.mock_received",obj,{"is_simulated":True,"currency":currency,
        "amount":money.fmt(amount,currency),"held_in_source_currency":hold})
    return record(obj)
