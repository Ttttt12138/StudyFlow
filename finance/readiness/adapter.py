import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from finance.models import AuditEvent
from finance.workflow_common import current
from finance.workflow_models import FundingSource as BSource
from finance.workflow_models import SimulatedApplication

from .budget import project
from .models import CheckLease, ReadinessRun
from .services import active, budget_result, business_date, converted_draft


def ai_client(backend=None):
    from studyflow_ai.config import Settings
    from studyflow_ai.readiness.api import ReadinessAI

    return ReadinessAI.from_settings(
        Settings.from_env(settings.STUDYFLOW_AI_MODE), backend=backend
    )


def c_draft(draft):
    from studyflow_ai.readiness.models import CostItem, SemesterDraft, SemesterProfile

    profile = {
        k: v for k, v in draft["profile"].items() if k in SemesterProfile.model_fields
    }
    costs = [
        {k: v for k, v in c.items() if k in CostItem.model_fields}
        for c in draft["costs"]
    ]
    if draft.get("reserve") is not None:
        costs.append(
            {
                "cost_id": "reserve",
                "category": "reserve",
                "currency": "THB",
                "amount": draft["reserve"],
                "period": "once",
                "year": date_year(profile),
                "confidence_type": "UNCONFIRMED",
            }
        )
    return SemesterDraft(profile=profile, costs=costs)


def date_year(profile):
    return int(profile["start_date"][:4])


class DjangoReadinessBackend:
    def __init__(self, owner):
        self.owner, self.claims = owner, {}

    def read_readiness_state(self, student_id):
        from studyflow_ai.readiness.models import ReadinessState

        if str(student_id) != str(self.owner.pk):
            raise ValueError("Student mismatch")
        semester, state = active(self.owner), current(self.owner)
        return ReadinessState(
            student_id=str(self.owner.pk),
            state_version=state.version,
            budget_version=semester.version,
            draft=c_draft(semester.draft),
        )

    def calculate_budget(self, state, now):
        from studyflow_ai.readiness.models import (
            BudgetSnapshot,
            MoneyValue,
            PaymentPoint,
        )

        semester, financial = active(self.owner), current(self.owner)
        if (financial.version, semester.version) != (
            state.state_version,
            state.budget_version,
        ):
            raise ValueError("State changed")
        result = budget_result(self.owner, semester, financial, now.date())
        prediction = project(
            financial.snapshot, converted_draft(self.owner, semester.draft), now.date()
        )
        money = lambda value: MoneyValue(currency="THB", amount=value)
        return BudgetSnapshot(
            state_version=financial.version,
            budget_version=semester.version,
            report_currency="THB",
            complete=result["complete"],
            low=money(result["low"]),
            base=money(result["base"]),
            high=money(result["high"]),
            gap=money(
                max(Decimal(result["gap"]), Decimal(prediction["maximum_reserve_gap"]))
            ),
            payment_points=[
                PaymentPoint(
                    date=e["date"],
                    required=money(e["amount"]),
                    gap=money(e["reserve_gap"]),
                )
                for e in prediction["timeline"]
                if e["kind"] == "expense"
            ],
            risks=result["issues"],
            assumptions=result["assumptions"],
        )

    def funding_context(self, state, budget, now):
        from studyflow_ai.readiness.models import (
            FundingActionOption,
            FundingContext,
            FundingSource,
            MoneyValue,
        )

        from finance.c_adapter import export_application

        sources, quotes, applications = [], [], []
        kinds = {
            "external_savings": "existing_liquid_funds",
            "family": "family_support",
            "family_support": "family_support",
            "scholarship": "scholarship",
            "loan": "borrowing",
        }
        for source in BSource.objects.filter(
            owner=self.owner, received=False, already_in_opening=False
        ):
            if source.kind not in kinds or source.currency != "THB":
                continue
            quote_id = None
            if source.loan_id:
                app = SimulatedApplication.objects.filter(
                    owner=self.owner, loan=source.loan
                ).first()
                if not app or app.status in {"REJECTED", "CANCELLED", "DISBURSED"}:
                    continue
                exported = export_application(self.owner, app.id)
                quotes.append(exported["quote"])
                applications.append(exported["application"])
                quote_id = str(source.loan_id)
            sources.append(
                FundingSource(
                    funding_id=str(source.id),
                    kind=kinds[source.kind],
                    allocatable=MoneyValue(
                        currency=source.currency, amount=source.amount
                    ),
                    available_date=source.available_on,
                    conditions=[]
                    if source.certainty == "confirmed"
                    else ["RECEIPT_UNCONFIRMED"],
                    loan_quote_id=quote_id,
                )
            )
        actions = [
            FundingActionOption(
                action_id=key,
                kind=value["kind"],
                cost_id=value["cost_id"],
                conditions=["ACTION_ELIGIBILITY_REQUIRES_CONFIRMATION"],
            )
            for key, value in self.action_options(state).items()
        ]
        return FundingContext(
            student_id=str(self.owner.pk),
            now=now,
            budget=budget,
            sources=sources,
            loan_quotes=quotes,
            applications=applications,
            actions=actions,
        )

    def action_options(self, state):
        runs = ReadinessRun.objects.filter(
            owner=self.owner,
            kind="funding",
            state_version=state.state_version,
            budget_version=state.budget_version,
        ).order_by("-created_at")[:20]
        return {
            str(run.id) + ":" + str(index): action
            for run in runs
            for index, action in enumerate(run.inputs.get("actions", []))
        }

    def validate_funding(self, candidate, context):
        from studyflow_ai.models import Issue
        from studyflow_ai.readiness.models import MoneyValue

        from .funding import evaluate, recommend

        semester, state = active(self.owner), current(self.owner)
        if (state.version, semester.version) != (
            context.budget.state_version,
            context.budget.budget_version,
        ):
            candidate.validation = "STALE"
            return candidate
        actions = self.action_options(context.budget)
        if not set(candidate.action_ids).issubset(actions):
            candidate.validation = "INVALID"
            return candidate
        data = {
            "allocations": [
                {"source_id": a.funding_id, "amount": str(a.amount.amount)}
                for a in candidate.allocations
            ],
            "actions": [actions[key] for key in candidate.action_ids],
        }
        try:
            result = evaluate(self.owner, semester, state, data)
            candidate.validation = result["validation"]
            baseline = recommend(self.owner, semester, state, data["actions"])
            if Decimal(result["borrowing_net"]) > Decimal(
                baseline["recommended_borrowing_net"]
            ):
                candidate.validation = "INVALID"
                candidate.issues.append(
                    Issue(
                        code="EXCESS_BORROWING",
                        message="Use available nonloan funding and quote the remaining net gap",
                    )
                )
            for field in ("borrowing_net", "financing_cost", "remaining_gap"):
                setattr(
                    candidate, field, MoneyValue(currency="THB", amount=result[field])
                )
            candidate.conditions = list(
                dict.fromkeys(candidate.conditions + result["conditions"])
            )
        except ValidationError:
            candidate.validation = "INVALID"
            candidate.issues.append(
                Issue(
                    code="BACKEND_FUNDING_REJECTED",
                    message="Funding constraints failed",
                )
            )
        return candidate

    def get_readiness_check(self, key):
        from studyflow_ai.readiness.models import ReadinessResult

        lease = CheckLease.objects.filter(key=key, result__isnull=False).first()
        return ReadinessResult.model_validate(lease.result) if lease else None

    @transaction.atomic
    def claim_readiness_check(self, key):
        get_user_model().objects.select_for_update().get(pk=self.owner.pk)
        lease = CheckLease.objects.filter(key=key).first()
        now = timezone.now()
        if lease and (lease.result is not None or lease.expires_at > now):
            return False
        token = uuid.uuid4()
        CheckLease.objects.update_or_create(
            key=key, defaults={"token": token, "expires_at": now + timedelta(minutes=5)}
        )
        self.claims[key] = token
        return True

    def release_readiness_check(self, key):
        token = self.claims.pop(key, None)
        if token:
            CheckLease.objects.filter(key=key, token=token, result__isnull=True).update(
                expires_at=timezone.now()
            )

    @transaction.atomic
    def save_readiness_check(self, key, result):
        get_user_model().objects.select_for_update().get(pk=self.owner.pk)
        state, semester = current(self.owner), active(self.owner)
        if (state.version, semester.version) != (
            result.state_version,
            result.budget_version,
        ):
            return False
        lease = (
            CheckLease.objects.select_for_update()
            .filter(key=key, token=self.claims.get(key), expires_at__gt=timezone.now())
            .first()
        )
        if not lease:
            return False
        lease.result = result.model_dump(mode="json")
        lease.save(update_fields=["result"])
        run = ReadinessRun.objects.create(
            owner=self.owner,
            semester=semester,
            state_version=state.version,
            budget_version=semester.version,
            kind="check",
            result=lease.result,
        )
        AuditEvent.objects.create(
            owner=self.owner,
            action="readiness.check_saved",
            entity_id=run.id,
            details={
                "state_version": state.version,
                "budget_version": semester.version,
            },
        )
        return True

    def audit(self, event):
        AuditEvent.objects.create(
            owner=self.owner,
            action="readiness." + event.event,
            entity_id=active(self.owner).id,
            details=event.model_dump(mode="json"),
        )


def run_check(job):
    from .jobs import update_risks

    backend = DjangoReadinessBackend(job.owner)
    semester, state = active(job.owner), current(job.owner)
    if (job.payload.get("state_version"), job.payload.get("budget_version")) != (
        state.version,
        semester.version,
    ):
        return {"superseded": True}
    now = timezone.make_aware(datetime.combine(business_date(job.owner), time(12)))
    # Risk persistence never depends on a model being available.
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=job.owner_id)
        semester, state = active(job.owner), current(job.owner)
        budget = budget_result(job.owner, semester, state, now.date())
        prediction = project(
            state.snapshot, converted_draft(job.owner, semester.draft), now.date()
        )
        update_risks(job.owner, semester, budget, prediction)
    ai = ai_client(backend)
    try:
        routing = None
        if ai.classifier:
            from studyflow_ai.models import RouteContext
            from studyflow_ai.routing import Router

            route = Router(ai.classifier).route(
                RouteContext(
                    text="Semester funding risk assessment",
                    state_version=state.version,
                    source_refs=[],
                    deterministic_risk=Decimal(budget["gap"]) > 0
                    or Decimal(prediction["maximum_reserve_gap"]) > 0,
                )
            )
            routing = route.model_dump(mode="json")
        result = ai.run_readiness_check(
            str(job.owner_id), job.payload.get("trigger", "manual"), now
        )
        payload = result.model_dump(mode="json")
        payload["routing"] = routing
        payload["mode"] = settings.STUDYFLOW_AI_MODE
        from .funding import recommend

        latest, financial = active(job.owner), current(job.owner)
        if (financial.version, latest.version) == (
            result.state_version,
            result.budget_version,
        ):
            payload["recommendation"] = recommend(job.owner, latest, financial)
        payload["retry_required"] = result.stale or any(
            i.code.endswith("UNAVAILABLE") for i in result.issues
        )
        if routing:
            payload["retry_required"] |= any(
                call.get("error_code") for call in routing.get("calls", [])
            )
        if result.funding:
            payload["retry_required"] |= any(
                call.error_code for call in result.funding.calls
            )
        return payload
    finally:
        ai.close()
