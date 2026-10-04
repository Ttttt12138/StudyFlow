from django.urls import path
from . import workflow_serializers as s
from . import budget_services as b
from . import execution_services as e
from . import workflow_models as m
from .models import FinancialState,CalculationRun,AuditEvent
from .workflow_api import CommandView,ResourceView,ReadView

def resource(route,model,serializer,handler):
    view = type(model.__name__+"Resource",(ResourceView,),{
        "model":model,"serializer_class":serializer,"handler":staticmethod(handler)})
    return [path(route+"/",view.as_view(),name=route),
        path(route+"/<uuid:pk>/",ReadView.as_view(model=model),name=route+"-detail")]

def command(route,name,serializer,handler,target=None,operator=False):
    view = type(name,(CommandView,),{"serializer_class":serializer,
        "handler":staticmethod(handler),"target_model":target,"operator_only":operator})
    return path(route,view.as_view(),name=name)

urlpatterns = []
for args in [
    ("fx-quotes",m.FXQuote,s.FXInput,b.create_fx),
    ("scenarios",m.BudgetScenario,s.ScenarioInput,b.create_scenario),
    ("funding-sources",m.FundingSource,s.SourceInput,b.create_source),
    ("funding-plans",m.FundingPlan,s.PlanInput,b.create_plan),
    ("loans",m.LoanSimulation,s.LoanInput,b.create_loan),
    ("applications",m.SimulatedApplication,s.ApplicationInput,e.create_application),
    ("beneficiaries",m.Beneficiary,s.BeneficiaryInput,e.create_beneficiary),
    ("payments",m.Payment,s.PaymentInput,e.create_payment),
]: urlpatterns.extend(resource(*args))
urlpatterns += [
    command("loans/compare/","LoanCompare",s.CompareInput,b.compare_loans),
    command("funding-sources/<uuid:pk>/receive/","FundingReceive",s.ReceiveInput,e.receive_funding,m.FundingSource,True),
    path("scenarios/<uuid:pk>/calendar/",ReadView.as_view(model=m.BudgetScenario,calendar=True)),
    path("disbursements/",ReadView.as_view(model=m.Disbursement)),
    path("disbursements/<uuid:pk>/",ReadView.as_view(model=m.Disbursement)),
    path("demo/wallets/",ReadView.as_view(model=m.DemoWallet)),
    path("ledger/",ReadView.as_view(model=m.DemoLedgerEntry)),
    path("audit/",ReadView.as_view(model=AuditEvent)),
    path("state/history/",ReadView.as_view(model=FinancialState)),
    path("forecasts/history/",ReadView.as_view(model=CalculationRun)),
    command("demo/initialize/","DemoInitialize",s.InitializeInput,e.initialize),
    command("demo/clock/","DemoClock",s.ClockInput,e.advance_clock),
    command("applications/<uuid:pk>/action/","ApplicationAction",s.ApplicationAction,e.application_action,m.SimulatedApplication),
    command("applications/<uuid:pk>/decision/","ApplicationDecision",s.DecisionInput,e.application_decision,m.SimulatedApplication,True),
    command("disbursements/<uuid:pk>/action/","DisbursementAction",s.SettlementInput,e.disbursement_action,m.Disbursement,True),
    command("beneficiaries/<uuid:pk>/verify/","BeneficiaryVerify",s.VerifyInput,e.verify_beneficiary,m.Beneficiary,True),
    command("payments/<uuid:pk>/authorize/","PaymentAuthorize",s.AuthorizationInput,e.authorize,m.Payment),
    command("payments/<uuid:pk>/cancel/","PaymentCancel",s.EmptyInput,e.cancel,m.Payment),
    command("payments/<uuid:pk>/submit/","PaymentSubmit",s.EmptyInput,e.submit,m.Payment),
    command("payments/<uuid:pk>/adapter-event/","PaymentAdapterEvent",s.PaymentEventInput,e.payment_event,m.Payment,True),
    command("payments/<uuid:pk>/reconcile/","PaymentReconcile",s.EmptyInput,e.reconcile,m.Payment),
]
