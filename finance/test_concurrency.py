from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from decimal import Decimal
from threading import Barrier
from uuid import uuid4
from unittest import skipUnless
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.db import connection,connections,transaction,DatabaseError
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from .tests import BASE
from .test_workflows import LOAN
from .models import FinancialState
from .workflow_models import DemoWallet,DemoLedgerEntry,LoanSimulation
from .workflow_common import current

@skipUnless(connection.vendor == "postgresql", "Requires real PostgreSQL locking and triggers")
class PostgresConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="parallel-student")
        self.operator = get_user_model().objects.create_user(username="parallel-operator",is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/v2/state/",{"expected_version":0,"snapshot":deepcopy(BASE)},format="json")
        self.assertEqual(response.status_code,201)
        self.command("demo/initialize",{"state_version":1})

    def command(self,path,body,operator=False):
        self.client.force_authenticate(self.operator if operator else self.user)
        response = self.client.post("/api/v2/"+path+"/",body,format="json",HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(response.status_code,201,str(response.data))
        self.client.force_authenticate(self.user)
        return response.data.get("data",response.data)

    def parallel(self,paths,bodies,operator=False,same_key=False):
        actor_id = self.operator.pk if operator else self.user.pk
        barrier = Barrier(2)
        key = str(uuid4())
        def work(index):
            try:
                actor = get_user_model().objects.get(pk=actor_id)
                client = APIClient()
                client.force_authenticate(actor)
                barrier.wait(timeout=10)
                response = client.post("/api/v2/"+paths[index]+"/",bodies[index],format="json",
                    HTTP_IDEMPOTENCY_KEY=key if same_key else str(uuid4()))
                return response.status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as executor:
            return sorted(executor.map(work,range(2)))

    def test_concurrent_receipt_creates_one_credit(self):
        source = self.command("funding-sources",{"economic_key":"parent","kind":"external_savings","currency":"THB",
            "amount":"9000","available_on":"2026-10-02","certainty":"confirmed"})
        path = "funding-sources/"+source["id"]+"/receive"
        self.assertEqual(self.parallel([path,path],[{},{}],operator=True),[201,201])
        self.assertEqual(DemoLedgerEntry.objects.count(),1)
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance,Decimal("89000"))
        self.assertEqual(FinancialState.objects.filter(owner=self.user).count(),2)

    def test_same_idempotency_key_creates_one_loan(self):
        self.assertEqual(self.parallel(["loans","loans"],[LOAN,LOAN],same_key=True),[200,201])
        self.assertEqual(LoanSimulation.objects.count(),1)

    def test_concurrent_state_updates_reject_stale_version(self):
        body = {"expected_version":1,"snapshot":deepcopy(BASE)}
        self.assertEqual(self.parallel(["state","state"],[body,body]),[201,409])
        self.assertEqual(FinancialState.objects.filter(owner=self.user).count(),2)

    def test_concurrent_payments_cannot_overspend_holds(self):
        source = self.command("funding-sources",{"economic_key":"promise","kind":"external_savings","currency":"THB",
            "amount":"9000","available_on":"2026-10-03","certainty":"confirmed"})
        beneficiary = self.command("beneficiaries",{"name":"Mock school","destination_label":"MOCK"})
        self.command("beneficiaries/"+beneficiary["id"]+"/verify",{"verified":True},operator=True)
        snapshot = deepcopy(BASE)
        for event in snapshot["events"]: event["beneficiary_id"] = beneficiary["id"]
        self.command("state",{"expected_version":1,"snapshot":snapshot})
        scenario = self.command("scenarios",{"state_version":2,"kind":"expected","end_date":"2026-10-31"})
        plan = self.command("funding-plans",{"scenario_id":scenario["id"],
            "allocations":[{"source_id":source["id"],"amount":"9000"}]})
        paths = []
        for event in ["rent","tuition"]:
            payment = self.command("payments",{"plan_id":plan["id"],"beneficiary_id":beneficiary["id"],"event_id":event})
            self.command("payments/"+payment["id"]+"/authorize",{"state_version":2})
            paths.append("payments/"+payment["id"]+"/submit")
        self.assertEqual(self.parallel(paths,[{},{}]),[201,400])
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance,Decimal("80000"))

    def test_database_history_is_immutable(self):
        state = current(self.user)
        with self.assertRaises(DatabaseError), transaction.atomic():
            FinancialState.objects.filter(pk=state.pk).update(snapshot={})
        state.refresh_from_db()
        self.assertEqual(state.snapshot["opening_balance"],"80000.00")

    def test_failed_audit_rolls_back_credit_and_version(self):
        source = self.command("funding-sources",{"economic_key":"rollback","kind":"external_savings","currency":"THB",
            "amount":"9000","available_on":"2026-10-02","certainty":"confirmed"})
        self.client.force_authenticate(self.operator)
        with patch("finance.workflow_common.AuditEvent.objects.create",side_effect=RuntimeError("test fault")):
            with self.assertRaises(RuntimeError):
                self.client.post("/api/v2/funding-sources/"+source["id"]+"/receive/",{},format="json",
                    HTTP_IDEMPOTENCY_KEY=str(uuid4()))
        self.assertEqual(DemoLedgerEntry.objects.count(),0)
        self.assertEqual(DemoWallet.objects.get(owner=self.user).balance,Decimal("80000"))
        self.assertEqual(FinancialState.objects.filter(owner=self.user).count(),1)
