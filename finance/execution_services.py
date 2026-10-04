from copy import deepcopy
from datetime import date,timedelta
from decimal import Decimal
from django.db.models import Sum
from django.utils import timezone
from .workflow_models import (
    DemoWallet,LoanSimulation,SimulatedApplication,Disbursement,DemoLedgerEntry,
    Beneficiary,Payment,FundingPlan,FundingSource,
)
from .workflow_common import require,owned,current,audit,append_state,record,shift_date
from .budget_services import evaluate_plan,convert
from .services import VersionConflict

def wallet(owner):
    item = DemoWallet.objects.filter(owner=owner).first()
    require(item is not None,"Initialize the isolated demo wallet first.")
    return item

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

def create_application(actor,data,obj=None):
    loan = owned(LoanSimulation,actor,data["loan_id"])
    require(not SimulatedApplication.objects.filter(loan=loan).exists(),"Simulation already has an application.")
    application = SimulatedApplication.objects.create(owner=actor,loan=loan)
    audit(actor,actor,"application.created",application)
    return record(application)

def application_action(actor,data,obj):
    if data["action"] == "submit":
        require(obj.status == "draft","Only draft applications can be submitted.")
        obj.status = "submitted"
    else:
        require(obj.status in ["draft","submitted","under_review"],"Application cannot be cancelled in this state.")
        obj.status = "cancelled"
    obj.save(update_fields=["status"])
    audit(obj.owner,actor,"application."+obj.status,obj)
    return record(obj)

def application_decision(actor,data,obj):
    if data["action"] == "review":
        require(obj.status == "submitted","Only submitted applications can enter review.")
        obj.status = "under_review"
    else:
        require(obj.status == "under_review","Decision requires an application under review.")
        obj.status = "approved" if data["action"] == "approve" else "rejected"
    obj.decision_reason = data["reason"]
    obj.save(update_fields=["status","decision_reason"])
    if obj.status == "approved":
        require(obj.loan.result["currency"] == "THB","Demo execution supports THB; foreign loans are comparison-only.")
        Disbursement.objects.create(owner=obj.owner,application=obj,
            amount=obj.loan.result["net_proceeds"],scheduled_on=obj.loan.inputs["disbursement_date"])
    audit(obj.owner,actor,"application.mock_"+obj.status,obj)
    return record(obj)

def disbursement_action(actor,data,obj):
    action = data["action"]
    if action == "settle" and obj.status == "settled": return record(obj)
    require(obj.application.status == "approved","Application is not approved.")
    if action == "process":
        require(obj.status == "scheduled","Only scheduled disbursements can process.")
        obj.status = "processing"
    elif action == "unknown":
        require(obj.status == "processing","Timeout requires a processing disbursement.")
        obj.status = "unknown"
    elif action == "fail":
        require(obj.status in ["processing","unknown"],"Cannot fail this disbursement.")
        obj.status = "failed"
    else:
        require(obj.status in ["processing","unknown"],"Settlement requires processing or status resolution.")
        item = wallet(obj.owner)
        require(item.clock >= obj.scheduled_on,"Disbursement cannot settle before its scheduled date.")
        state = current(obj.owner)
        snapshot = deepcopy(state.snapshot)
        event_id = "loan:"+str(obj.application.loan_id)
        require(not any(e["id"] == event_id for e in snapshot["events"]),"Loan already represented in state.")
        sequence = DemoLedgerEntry.objects.filter(owner=obj.owner).count()+1
        DemoLedgerEntry.objects.create(owner=obj.owner,disbursement=obj,amount=obj.amount,
            effective_on=item.clock,sequence=sequence)
        require(item.balance+obj.amount <= Decimal("9999999999999999.99"),"Wallet precision limit exceeded.")
        item.balance += obj.amount
        item.save(update_fields=["balance"])
        snapshot["events"].append({"id":event_id,"label":"Simulated loan disbursement","kind":"income",
            "amount":format(obj.amount,".2f"),"date":item.clock.isoformat(),"certainty":"confirmed",
            "settled_sequence":sequence})
        for row in obj.application.loan.result["schedule"]:
            if Decimal(row["payment"]) > 0:
                snapshot["events"].append({"id":"repayment:"+str(obj.application.loan_id)+":"+str(row["number"]),
                    "label":"Simulated loan repayment","kind":"expense","amount":row["payment"],
                    "date":row["due_date"],"certainty":"confirmed"})
        append_state(obj.owner,snapshot,actor,"state.disbursement_received")
        obj.status = "settled"
    obj.save(update_fields=["status"])
    audit(obj.owner,actor,"disbursement."+obj.status,obj,{"is_simulated":True})
    return record(obj)

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
    check_plan(obj.plan)
    require(obj.beneficiary.verified,"Beneficiary verification was revoked.")
    obj.authorized_until = timezone.now()+timedelta(seconds=data["expires_in_seconds"])
    obj.status = "authorized"
    obj.save(update_fields=["authorized_until","status"])
    audit(obj.owner,actor,"payment.authorized",obj,{
        "state_version":state.version,"plan_id":str(obj.plan_id),
        "beneficiary_id":str(obj.beneficiary_id),"amount":str(obj.amount),"currency":"THB",
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
    if obj.status in ["pending","unknown","settled","reconciled"]: return record(obj)
    require(obj.status == "authorized","Payment needs authorization.")
    require(obj.authorized_until and obj.authorized_until > timezone.now(),"Authorization expired.")
    state = current(obj.owner,obj.state.version)
    check_plan(obj.plan)
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
    if outcome == "settled" and obj.status in ["settled","reconciled"]: return record(obj)
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
        sequence = DemoLedgerEntry.objects.filter(owner=obj.owner).count()+1
        DemoLedgerEntry.objects.create(owner=obj.owner,payment=obj,amount=-obj.amount,
            effective_on=item.clock,sequence=sequence)
        item.balance -= obj.amount
        item.save(update_fields=["balance"])
        event["date"] = item.clock.isoformat()
        event["settled_sequence"] = sequence
        append_state(obj.owner,snapshot,actor,"state.payment_settled")
        obj.receipt = {"reference":"mock:"+str(obj.id),"operation_key":str(obj.id),
            "event_id":obj.event_id,"amount":format(obj.amount,".2f"),"currency":"THB",
            "beneficiary_id":str(obj.beneficiary_id),"is_simulated":True,
            "settled_on":item.clock.isoformat()}
        obj.status = "settled"
    obj.save(update_fields=["status","receipt"])
    audit(obj.owner,actor,"payment.mock_"+obj.status,obj)
    return record(obj)

def reconcile(actor,data,obj):
    if obj.status == "reconciled": return record(obj)
    require(obj.status == "settled" and obj.receipt is not None,"Settlement receipt required.")
    receipt = obj.receipt
    require(receipt["event_id"] == obj.event_id and Decimal(receipt["amount"]) == obj.amount
        and receipt["beneficiary_id"] == str(obj.beneficiary_id),"Receipt does not match obligation.")
    require(DemoLedgerEntry.objects.filter(payment=obj,amount=-obj.amount).exists(),"Ledger settlement missing.")
    obj.status = "reconciled"
    obj.save(update_fields=["status"])
    audit(obj.owner,actor,"payment.reconciled",obj,{"receipt":receipt["reference"]})
    return record(obj)

def receive_funding(actor,data,obj):
    if obj.received: return record(obj)
    require(obj.kind != "loan","Loans must use the application/disbursement flow.")
    require(not obj.already_in_opening,"Opening funds cannot be received twice.")
    item = wallet(obj.owner)
    amount,days,_ = convert(obj.owner,obj.amount,obj.currency,data.get("fx_quote_id"))
    require(item.clock >= shift_date(obj.available_on,days),"Funding has not reached its availability/settlement date.")
    state = current(obj.owner)
    require(not any(event["id"] == obj.economic_key for event in state.snapshot["events"]),
        "Funding is already represented in state.")
    sequence = DemoLedgerEntry.objects.filter(owner=obj.owner).count()+1
    DemoLedgerEntry.objects.create(owner=obj.owner,funding_source=obj,amount=amount,
        effective_on=item.clock,sequence=sequence)
    require(item.balance+amount <= Decimal("9999999999999999.99"),"Wallet precision limit exceeded.")
    item.balance += amount
    item.save(update_fields=["balance"])
    snapshot = deepcopy(state.snapshot)
    snapshot["events"].append({"id":"received:"+str(obj.id),"label":"Simulated "+obj.kind,
        "kind":"income","amount":format(amount,".2f"),"date":item.clock.isoformat(),"certainty":"confirmed",
        "settled_sequence":sequence})
    append_state(obj.owner,snapshot,actor,"state.funding_received")
    obj.received = True
    obj.save(update_fields=["received"])
    audit(obj.owner,actor,"funding.mock_received",obj,{"is_simulated":True})
    return record(obj)
