from typing import ClassVar

from django.db import models

from finance.models import OwnedRecord


class BankAccount(OwnedRecord):
    external_id = models.CharField(max_length=150)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["owner", "external_id"], name="bank_account_owner_key"
            )
        ]


class TransactionImport(OwnedRecord):
    sha256 = models.CharField(max_length=64)
    source_type = models.CharField(max_length=20, default="user_uploaded")
    status = models.CharField(max_length=25, default="NEEDS_REVIEW")
    preview = models.JSONField(default=dict)
    confirmation = models.JSONField(default=dict)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["owner", "sha256"], name="transaction_import_hash"
            )
        ]


class ObservedTransaction(OwnedRecord):
    account = models.ForeignKey(BankAccount, on_delete=models.PROTECT)
    batch = models.ForeignKey(TransactionImport, on_delete=models.PROTECT)
    external_id = models.CharField(max_length=200, null=True)
    locator = models.CharField(max_length=40)
    date = models.DateField()
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    currency = models.CharField(max_length=3, default="THB")
    counterparty = models.CharField(max_length=300)
    description = models.TextField(max_length=2000)
    category = models.CharField(max_length=25)
    classification = models.JSONField(default=dict)
    needs_review = models.BooleanField(default=False)
    cost_id = models.CharField(max_length=100, blank=True)
    refund_of = models.ForeignKey("self", null=True, on_delete=models.PROTECT)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["account", "external_id"],
                condition=models.Q(external_id__isnull=False),
                name="transaction_external_unique",
            ),
            models.UniqueConstraint(
                fields=["batch", "locator"], name="transaction_import_row"
            ),
        ]


class ClassificationRevision(OwnedRecord):
    transaction = models.ForeignKey(ObservedTransaction, on_delete=models.PROTECT)
    before = models.JSONField()
    after = models.JSONField()


class AccountCoverage(OwnedRecord):
    account = models.ForeignKey(BankAccount, on_delete=models.PROTECT)
    batch = models.ForeignKey(TransactionImport, on_delete=models.PROTECT)
    start = models.DateField()
    end = models.DateField()
    complete = models.BooleanField(default=False)


class RecurringExpense(OwnedRecord):
    account = models.ForeignKey(BankAccount, on_delete=models.PROTECT)
    merchant_key = models.CharField(max_length=300)
    result = models.JSONField(default=dict)
    decision = models.CharField(max_length=20, default="inferred")
    cost_id = models.CharField(max_length=100, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["account", "merchant_key"], name="recurring_account_merchant"
            )
        ]


class CalibrationRevision(OwnedRecord):
    semester = models.ForeignKey("finance.Semester", on_delete=models.PROTECT)
    analysis_version = models.PositiveIntegerField()
    budget_version = models.PositiveIntegerField()
    as_of = models.DateField()
    result = models.JSONField(default=dict)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=["semester", "analysis_version", "budget_version", "as_of"],
                name="calibration_input_revision",
            )
        ]


class BalanceConfirmation(OwnedRecord):
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    as_of = models.DateField()
    ledger_sequence = models.PositiveIntegerField(default=0)
