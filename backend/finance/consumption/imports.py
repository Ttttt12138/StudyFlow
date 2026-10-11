import hashlib
from datetime import date
from decimal import Decimal

from django.db import transaction
from studyflow_ai.bank_data import CsvTransactionAdapter, classify_transaction
from studyflow_ai.parsing import InputError

from finance.readiness.services import active, business_date
from finance.services import json_value
from finance.workflow_common import audit, owned, record, require

from .models import (
    AccountCoverage,
    BankAccount,
    ClassificationRevision,
    ObservedTransaction,
    TransactionImport,
)


def invalidate(owner):
    from finance.readiness.jobs import enqueue_check

    semester = active(owner)
    semester.analysis_version += 1
    semester.version += 1  # Existing C v2 cache keys use the budget context version.
    semester.save(update_fields=["analysis_version", "version"])
    transaction.on_commit(lambda: enqueue_check(owner, "consumption_changed"))
    return semester.analysis_version


def upload(owner, data, content):
    active(owner)
    digest = hashlib.sha256(content).hexdigest()
    previous = TransactionImport.objects.filter(owner=owner, sha256=digest).first()
    if previous:
        return record(previous)
    try:
        rows, issues = CsvTransactionAdapter().parse(content, digest)
    except InputError as exc:
        require(False, exc.code)
    preview = [preview_row(owner, row) for row in rows]
    batch = TransactionImport.objects.create(
        owner=owner,
        sha256=digest,
        source_type=data["source_type"],
        preview={"rows": preview, "issues": issues},
    )
    audit(owner, owner, "transactions.uploaded", batch)
    return record(batch)


def preview_row(owner, row):
    data = row.model_dump(mode="json")
    query = ObservedTransaction.objects.filter(
        owner=owner, account__external_id=row.account_id
    )
    data["duplicate"] = bool(
        row.transaction_id and query.filter(external_id=row.transaction_id).exists()
    )
    data["suspected_duplicate"] = query.filter(
        date=row.date,
        amount=row.amount,
        counterparty=row.counterparty,
        description=row.description,
    ).exists()
    data["classification"] = classify_transaction(row)
    return data


def confirm(owner, data, batch):
    require(batch.status == "NEEDS_REVIEW", "IMPORT_ALREADY_COMMITTED")
    rows = {row["locator"]: row for row in batch.preview["rows"]}
    selected = data["selected_rows"]
    require(
        len(selected) == len(set(selected)) and set(selected) <= rows.keys(),
        "INVALID_SELECTED_ROWS",
    )
    coverage = {c["account_id"]: c for c in data["coverage"]}
    require(len(coverage) == len(data["coverage"]), "DUPLICATE_COVERAGE_ACCOUNT")
    accounts = set()
    for locator in selected:
        row = rows[locator]
        require(row["account_id"] in coverage, "DECLARE_ACCOUNT_COVERAGE")
        scope = coverage[row["account_id"]]
        require(
            scope["start"]
            <= date.fromisoformat(row["date"])
            <= scope["end"]
            <= business_date(owner),
            "COVERAGE_DATE_MISMATCH",
        )
        accounts.add(row["account_id"])
        persist_row(owner, batch, row, data["keep_similar_rows"])
    require(accounts == coverage.keys(), "COVERAGE_REQUIRES_SELECTED_ACCOUNT")
    for account_id, scope in coverage.items():
        account = BankAccount.objects.get(owner=owner, external_id=account_id)
        if scope["complete"]:
            require(not batch.preview["issues"], "ERROR_ROWS_PREVENT_COMPLETE_COVERAGE")
            relevant = {
                r["locator"]
                for r in rows.values()
                if r["account_id"] == account_id
                and scope["start"] <= date.fromisoformat(r["date"]) <= scope["end"]
            }
            require(
                relevant <= set(selected),
                "PARTIAL_SELECTION_PREVENTS_COMPLETE_COVERAGE",
            )
        AccountCoverage.objects.create(
            owner=owner,
            account=account,
            batch=batch,
            start=scope["start"],
            end=scope["end"],
            complete=scope["complete"],
        )
    batch.status, batch.confirmation = "COMMITTED", json_value(data)
    batch.save(update_fields=["status", "confirmation"])
    version = invalidate(owner)
    audit(owner, owner, "transactions.confirmed", batch, {"analysis_version": version})
    return {**record(batch), "analysis_version": version, "is_simulated": True}


def persist_row(owner, batch, row, keep_similar):
    account, _ = BankAccount.objects.get_or_create(
        owner=owner, external_id=row["account_id"]
    )
    query = ObservedTransaction.objects.filter(account=account)
    external_id = row.get("transaction_id")
    if external_id:
        previous = query.filter(external_id=external_id).first()
        if previous:
            require(
                all(
                    str(getattr(previous, key)) == str(row[key])
                    for key in ("date", "currency", "counterparty", "description")
                )
                and previous.amount == Decimal(row["amount"]),
                "TRANSACTION_ID_CONFLICT",
            )
            return
    else:
        similar = query.filter(
            date=row["date"],
            amount=row["amount"],
            counterparty=row["counterparty"],
            description=row["description"],
        ).exists()
        require(
            not similar or row["locator"] in keep_similar, "REVIEW_SIMILAR_TRANSACTION"
        )
    fields = {
        k: row[k]
        for k in (
            "locator",
            "date",
            "amount",
            "currency",
            "counterparty",
            "description",
        )
    }
    classification = row["classification"]
    ObservedTransaction.objects.create(
        owner=owner,
        account=account,
        batch=batch,
        external_id=external_id,
        **fields,
        category=classification["category"],
        classification=classification,
        needs_review=classification["category"] in {"Other", "Refund"},
    )


def revise_transaction(owner, data, item):
    from decimal import Decimal

    before = record(item)
    if data.get("cost_id"):
        require(
            data["cost_id"] in {c["cost_id"] for c in active(owner).draft["costs"]},
            "UNKNOWN_COST",
        )
    item.category, item.cost_id = data["category"], data.get("cost_id", "")
    require(
        item.category == "Transfer"
        or (
            item.amount > 0
            if item.category in {"Income", "Refund"}
            else item.amount < 0
        ),
        "CATEGORY_AMOUNT_DIRECTION",
    )
    item.refund_of = None
    if data.get("refund_of"):
        target = owned(ObservedTransaction, owner, data["refund_of"])
        require(
            item.category == "Refund"
            and item.amount > 0
            and target.amount < 0
            and not target.needs_review
            and target.category not in {"Transfer", "Refund", "Income"},
            "INVALID_REFUND_LINK",
        )
        refunded = sum(
            ObservedTransaction.objects.filter(refund_of=target)
            .exclude(pk=item.pk)
            .values_list("amount", flat=True),
            Decimal(0),
        )
        require(refunded + item.amount <= abs(target.amount), "REFUND_EXCEEDS_PURCHASE")
        item.refund_of = target
    require(
        item.category != "Refund" or item.refund_of is not None, "REFUND_LINK_REQUIRED"
    )
    item.classification = {
        "source_type": "user_declared",
        "basis": data["reason"],
        "rule_version": "manual-1",
    }
    item.needs_review = False
    item.save()
    ClassificationRevision.objects.create(
        owner=owner, transaction=item, before=before, after=record(item)
    )
    invalidate(owner)
    return record(item)


def confirm_balance(owner, data, obj=None):
    from finance.workflow_common import current
    from finance.workflow_models import DemoLedgerEntry

    from .models import BalanceConfirmation

    current(owner, data["state_version"])
    require(data["as_of"] == business_date(owner), "CONFIRM_BALANCE_AS_OF_TODAY")
    last = DemoLedgerEntry.objects.filter(owner=owner).order_by("-sequence").first()
    item = BalanceConfirmation.objects.create(
        owner=owner,
        amount=data["amount"],
        as_of=data["as_of"],
        ledger_sequence=last.sequence if last else 0,
    )
    invalidate(owner)
    audit(
        owner, owner, "balance.user_confirmed", item, {"does_not_credit_wallet": True}
    )
    return {**record(item), "source_type": "user_declared", "is_simulated": True}
