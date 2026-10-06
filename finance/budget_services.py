from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
from django.utils import timezone
from django.db.models import Max
from .calculations import forecast
from .services import json_value
from . import money
from .workflow_models import Corridor,FXQuote,BudgetScenario,FundingSource,FundingPlan,LoanSimulation,Disbursement,SimulatedApplication
from .workflow_common import require,owned,current,audit,record,shift_date
from .loan_engine import loan_schedule

def create_fx(actor,data,obj=None):
    require(timezone.now() < data["expires_at"] <= timezone.now()+timedelta(days=30),
        "Mock quote validity must be in the next 30 days.")
    data = dict(data)
    source,target = data["source_currency"],data["target_currency"]
    require(source != target,"SAME_CURRENCY_QUOTE")
    money.require_precision(data["sender_fee"],source)
    money.require_precision(data["receiver_fee"],target)
    corridor_id = data.pop("corridor_id",None)
    if corridor_id:
        corridor = Corridor.objects.filter(pk=corridor_id).first()
        require(corridor is not None,"CORRIDOR_NOT_FOUND")
        require(corridor.enabled,"CORRIDOR_DISABLED")
        require((corridor.source_currency,corridor.target_currency) == (source,target),
            "CORRIDOR_CURRENCY_MISMATCH")
        data["corridor"] = corridor
    quote = FXQuote.objects.create(owner=actor,**data)
    audit(actor,actor,"fx.mock_quote_created",quote)
    return record(quote)

def convert(owner,amount,currency,quote_id=None,expense=False,consume=False):
    amount = money.require_precision(amount,currency)
    home = money.home_currency()
    if currency == home:
        require(not quote_id,f"Do not attach an FX quote to {home}.")
        return amount.quantize(Decimal(".01")),0,None
    require(quote_id is not None,"A valid FX quote is required for foreign currency.")
    quote = owned(FXQuote,owner,quote_id)
    require(quote.source_currency == currency and quote.target_currency == home,"FX currency direction mismatch.")
    require(quote.expires_at > timezone.now(),"FX quote expired; create a new quote and revision.")
    if consume:
        # Settlement uses a quote once; estimates (scenarios, comparisons) may reread it.
        require(quote.consumed_at is None,"QUOTE_CONSUMED")
        from .remittance_models import RemittanceOrder
        require(not RemittanceOrder.objects.filter(quote=quote).exists(),"QUOTE_IN_USE")
        quote.consumed_at = timezone.now()
        quote.save(update_fields=["consumed_at"])
    with localcontext() as context:
        context.prec = 48
        if expense:
            result = (amount+quote.sender_fee)*quote.rate+quote.receiver_fee
        else:
            require(amount > quote.sender_fee,"Sender fee consumes the allocation.")
            result = (amount-quote.sender_fee)*quote.rate-quote.receiver_fee
            require(result > 0,"Net funding must be positive after fees.")
        require(result <= Decimal("99999999999999.99"),"Converted amount exceeds supported monetary precision.")
        return result.quantize(Decimal(".01"),rounding=ROUND_HALF_UP),quote.settlement_days,quote

def scenario_snapshot(owner,data):
    state = current(owner,data["state_version"])
    snapshot = deepcopy(state.snapshot)
    mapping = {e["id"]:e for e in snapshot["events"]}
    seen, evidence = set(),[]
    for override in data.get("overrides",[]):
        key = override["event_id"]
        require(key not in seen,"Duplicate expense override.")
        seen.add(key)
        require(key in mapping and mapping[key]["kind"] == "expense","Override must reference an existing expense.")
        event = mapping[key]
        require("settled_sequence" not in event and not key.startswith("repayment:"),
                "Settled expenses and contractual loan repayments cannot be overridden.")
        amount = override["amount"]
        require(override["certainty"] != "confirmed" or amount is not None,"Confirmed expense amount cannot be missing.")
        if amount is not None:
            converted,days,quote = convert(owner,amount,override["currency"],override.get("fx_quote_id"),expense=True)
            event["amount"] = format(converted,".2f")
            if quote:
                evidence.append({"event_id":key,"quote_id":str(quote.id),"is_mock":True,
                    "rate":str(quote.rate),"currency":override["currency"],
                    "latest_initiation_date":shift_date(date.fromisoformat(event["date"]),-days).isoformat() if event["date"] else None})
        else:
            event["amount"] = None
        event["certainty"] = override["certainty"]
    return state,snapshot,evidence

def create_scenario(actor,data,obj=None):
    state,snapshot,evidence = scenario_snapshot(actor,data)
    try: result = forecast(snapshot,data["end_date"],data["include_estimates"])
    except ValueError as error: require(False,str(error))
    result["fx_evidence"] = evidence
    result["snapshot"] = snapshot
    last = BudgetScenario.objects.filter(owner=actor,kind=data["kind"]).aggregate(value=Max("revision"))["value"] or 0
    scenario = BudgetScenario.objects.create(owner=actor,state=state,kind=data["kind"],revision=last+1,
        inputs=json_value(data),result=result)
    audit(actor,actor,"scenario.created",scenario)
    return record(scenario)

def create_loan(actor,data,obj=None):
    from .lending_applications import business_date
    require(data["first_due_date"] > business_date(actor), "FIRST_DUE_DATE_NOT_FUTURE")
    try: result = loan_schedule(data)
    except ValueError as error: require(False,str(error))
    require(all(Decimal(row["amount"]) <= Decimal("99999999999999.99") for row in result["repayments"]),
            "Computed installment exceeds the shared Django monetary precision.")
    loan = LoanSimulation.objects.create(owner=actor,inputs=json_value(data),result=result)
    audit(actor,actor,"loan.simulated",loan)
    return record(loan)

def create_source(actor,data,obj=None):
    data = dict(data)
    require(data['kind'] not in {'family', 'family_support'} or data['certainty'] != 'confirmed',
            'FAMILY_SUPPORT_REQUIRES_SPONSOR_CONFIRMATION')
    loan_id = data.pop("loan_id",None)
    require(data["amount"] > 0,"Funding amount must be positive.")
    require(not FundingSource.objects.filter(owner=actor,economic_key=data["economic_key"]).exists(),
        "Economic source already exists; reuse it instead of creating a duplicate.")
    if data["currency"] == "JPY":
        require(data["amount"] == data["amount"].to_integral_value(),"JPY amount must be whole units.")
    loan = owned(LoanSimulation,actor,loan_id) if loan_id else None
    if data["kind"] == "loan":
        require(loan is not None,"Loan funding requires an owned simulation.")
        require(not FundingSource.objects.filter(loan=loan).exists(),"Loan already has a funding source.")
        require(data["currency"] == loan.result["currency"] and data["amount"] == Decimal(loan.result["net_proceeds"]),
            "Loan source must use its calculated net proceeds and currency.")
        require(data["available_on"] >= date.fromisoformat(current(actor).snapshot["as_of"]),
                "Loan availability cannot predate the financial snapshot.")
        require(data["certainty"] == "estimated","Undisbursed loans must remain estimated.")
        require(not data["already_in_opening"],"Undisbursed loan cannot be opening funds.")
    else:
        require(loan is None,"Only loan funding can reference a loan simulation.")
    source = FundingSource.objects.create(owner=actor,loan=loan,**data)
    audit(actor,actor,"funding.source_created",source)
    return record(source)

def evaluate_plan(owner,scenario,allocations):
    current(owner,scenario.state.version)
    _,snapshot,evidence = scenario_snapshot(owner,scenario.inputs)
    seen, assumptions, converted = set(),[],[]
    existing_ids = {e["id"] for e in snapshot["events"]}
    for allocation in allocations:
        source = owned(FundingSource,owner,allocation["source_id"])
        require(source.id not in seen,"Funding source allocated twice in one plan.")
        seen.add(source.id)
        require(not source.received,"Source is already received; use the updated state.")
        require(not source.already_in_opening,"Opening funds cannot be counted as new funding.")
        require(source.economic_key not in existing_ids,"Source already appears in the financial state.")
        if source.loan_id:
            require(not SimulatedApplication.objects.filter(loan=source.loan,
                    status__in=["CANCELLED", "REJECTED"]).exists(),
                    "Cancelled or rejected borrowing cannot fund a plan.")
            require(not Disbursement.objects.filter(application__loan=source.loan,status="settled").exists(),
                "Loan is already received; use the updated state, not another funding allocation.")
        amount = Decimal(allocation["amount"])
        require(Decimal("0") < amount <= source.amount,"Allocation exceeds source capacity or is not positive.")
        net,days,quote = convert(owner,amount,source.currency,allocation.get("fx_quote_id"))
        arrival = shift_date(source.available_on,days)
        require(arrival >= date.fromisoformat(snapshot["as_of"]),"Funding predates the opening snapshot.")
        certainty = source.certainty
        if certainty != "confirmed": assumptions.append(str(source.id))
        event = {"id":"funding:"+str(source.id),"label":source.kind,"kind":"income",
            "amount":format(net,".2f"),"date":arrival.isoformat(),"certainty":certainty}
        snapshot["events"].append(event)
        if source.loan_id:
            for row in source.loan.result["schedule"]:
                if Decimal(row["payment"]) > 0:
                    repayment,_,_ = convert(owner,Decimal(row["payment"]),source.currency,allocation.get("fx_quote_id"),expense=True)
                    snapshot["events"].append({"id":"repayment:"+str(source.loan_id)+":"+str(row["number"]),
                        "label":"Simulated loan repayment","kind":"expense","amount":format(repayment,".2f"),
                        "date":row["due_date"],"certainty":source.certainty})
        converted.append({"source_id":str(source.id),"net_thb":format(net,".2f"),
            "arrival_date":arrival.isoformat(),"quote_id":str(quote.id) if quote else None})
    result = forecast(snapshot,scenario.inputs["end_date"],scenario.inputs["include_estimates"])
    if result["status"] == "incomplete": feasibility = "incomplete"
    elif Decimal(result["maximum_reserve_gap"]) > 0: feasibility = "funding_gap"
    elif assumptions: feasibility = "feasible_under_assumptions"
    else: feasibility = "feasible"
    return {**result,"feasibility":feasibility,"allocations":converted,
        "uncertain_source_ids":assumptions,"is_simulated":True,"fx_evidence":evidence}

def create_plan(actor,data,obj=None):
    scenario = owned(BudgetScenario,actor,data["scenario_id"])
    result = evaluate_plan(actor,scenario,data["allocations"])
    plan = FundingPlan.objects.create(owner=actor,scenario=scenario,inputs=json_value(data),result=result)
    audit(actor,actor,"funding.plan_validated",plan)
    return record(plan)

def compare_loans(actor,data,obj=None):
    require(len(set(data["loan_ids"])) == len(data["loan_ids"]),"Duplicate loan comparison IDs.")
    loans = [owned(LoanSimulation,actor,key) for key in data["loan_ids"]]
    basis = {(loan.result["currency"],loan.result["net_proceeds"]) for loan in loans}
    return {"is_simulated":True,"same_net_receipt_basis":len(basis)==1,
        "ranking":None,"note":"Compare repayment timing and affordability as well as total cost; no automatic recommendation.",
        "loans":[{"id":str(loan.id),"product_name":loan.inputs.get("product_name", "Simulated B loan"),
            **{key:loan.result[key] for key in [
                "currency","net_proceeds","total_repayment","total_cost_over_net_proceeds",
                "maximum_installment","affordability_status"]}} for loan in loans]}
