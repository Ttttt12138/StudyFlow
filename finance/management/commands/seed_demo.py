import json
import secrets
from copy import deepcopy
from pathlib import Path
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand,CommandError
from django.db import transaction
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from uuid import uuid4

class Command(BaseCommand):
    help = "Create isolated mock student/operator, three budgets and loan examples; never reset existing users."

    @transaction.atomic
    def handle(self,*args,**options):
        User = get_user_model()
        if User.objects.filter(username__in=["demo-student","demo-operator"]).exists():
            raise CommandError("Demo users already exist. Existing records and credentials were preserved.")
        student_password,operator_password = secrets.token_urlsafe(18),secrets.token_urlsafe(18)
        student = User.objects.create_user(username="demo-student",password=student_password)
        operator = User.objects.create_user(username="demo-operator",password=operator_password,is_staff=True)
        credentials = {}
        for label,user,password in [("student",student,student_password),("operator",operator,operator_password)]:
            credentials[label]={"username":user.username,"password":password,"token":Token.objects.create(user=user).key}
        client = APIClient(HTTP_HOST="localhost")
        client.force_authenticate(student)
        def post(path,payload):
            response = client.post("/api/v2/"+path+"/",payload,format="json",HTTP_IDEMPOTENCY_KEY=str(uuid4()))
            if response.status_code != 201: raise CommandError("Seed request failed: "+str(response.data))
            return response.data.get("data",response.data)
        snapshot = {
            "currency":"THB","as_of":"2026-10-02","opening_balance":"80000.00","reserve":"15000.00",
            "events":[
                {"id":"rent","label":"Mock rent","kind":"expense","amount":"9000.00","date":"2026-10-05","certainty":"confirmed"},
                {"id":"living","label":"Mock living costs","kind":"expense","amount":"9400.00","date":"2026-10-14","certainty":"confirmed"},
                {"id":"tuition","label":"Mock tuition","kind":"expense","amount":"65000.00","date":"2026-10-15","certainty":"confirmed"},
            ],
        }
        beneficiary = post("beneficiaries",{"name":"Mock university and demo expenses","destination_label":"MOCK-ONLY"})
        client.force_authenticate(operator)
        post("beneficiaries/"+beneficiary["id"]+"/verify",{"verified":True})
        client.force_authenticate(student)
        for event in snapshot["events"]: event["beneficiary_id"] = beneficiary["id"]
        post("state",{"expected_version":0,"snapshot":snapshot})
        wallet = post("demo/initialize",{"state_version":1})
        budgets = {}
        for kind,estimate in [("essential","6000.00"),("expected",None),("higher_cost","12400.00")]:
            overrides = [] if estimate is None else [{
                "event_id":"living","amount":estimate,"currency":"THB","certainty":"estimated"}]
            budgets[kind]=post("scenarios",{"state_version":1,"kind":kind,"end_date":"2026-10-31",
                "include_estimates":True,"overrides":overrides})
        loans = []
        for label,rate in [("Mock loan A","8"),("Mock loan B","12")]:
            loans.append(post("loans",{"product_name":label,"currency":"THB","principal":"20000.00",
                "annual_rate_percent":rate,"repayment_months":12,"grace_months":0,
                "withheld_fee":"1600.00","disbursement_date":"2026-10-02",
                "monthly_income":None,"monthly_essential_expenses":None,"income_confirmed":False}))
        public = {"is_simulated":True,"wallet_id":wallet["id"],
            "beneficiary_id":beneficiary["id"],
            "scenario_ids":{name:value["id"] for name,value in budgets.items()},
            "loan_ids":[loan["id"] for loan in loans],
            "expected_gap_thb":budgets["expected"]["result"]["maximum_reserve_gap"]}
        def write_local():
            root = Path(settings.BASE_DIR)
            (root/".demo-credentials.json").write_text(json.dumps(credentials,indent=2),encoding="utf-8")
            (root/"examples"/"demo-ids.json").write_text(json.dumps(public,indent=2),encoding="utf-8")
        transaction.on_commit(write_local)
        self.stdout.write(self.style.SUCCESS("Demo created. Private login/token details: .demo-credentials.json (gitignored)."))
        self.stdout.write("Expected budget gap: 18,400 THB. No loans approved, funds received, or payments executed.")
