from django.db import models

from .models import OwnedRecord


class AffordabilityProfile(OwnedRecord):
    version = models.PositiveIntegerField(default=1)
    months = models.JSONField(default=list)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner"], name="one_lending_profile")
        ]


class LoanAccount(OwnedRecord):
    disbursement = models.OneToOneField(
        "finance.Disbursement", on_delete=models.PROTECT
    )
    status = models.CharField(max_length=10, default="ACTIVE")
    version = models.PositiveIntegerField(default=1)
    outstanding_principal = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(outstanding_principal__gte=0),
                name="loan_principal_nonnegative",
            )
        ]


class LoanInstallment(OwnedRecord):
    account = models.ForeignKey(
        LoanAccount, related_name="installments", on_delete=models.PROTECT
    )
    number = models.PositiveSmallIntegerField()
    due_on = models.DateField()
    amount = models.DecimalField(max_digits=16, decimal_places=2)
    principal = models.DecimalField(max_digits=16, decimal_places=2)
    paid_on = models.DateField(null=True)

    class Meta:
        ordering = ["number"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "number"], name="one_loan_installment"
            ),
            models.CheckConstraint(
                condition=models.Q(amount__gt=0), name="installment_positive"
            ),
        ]
