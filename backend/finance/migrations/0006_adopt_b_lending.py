from decimal import Decimal

from django.db import migrations


def adopt(apps, schema_editor):
    alias = schema_editor.connection.alias
    applications = apps.get_model("finance", "SimulatedApplication").objects.using(alias)
    disbursements = apps.get_model("finance", "Disbursement").objects.using(alias)
    accounts = apps.get_model("finance", "LoanAccount").objects.using(alias)
    installments = apps.get_model("finance", "LoanInstallment").objects.using(alias)
    ledger = apps.get_model("finance", "DemoLedgerEntry").objects.using(alias)
    if disbursements.filter(status__in=["processing", "unknown"]).exists():
        raise RuntimeError("Resolve legacy processing/unknown disbursements before replacing the lending engine.")
    for application in applications.all():
        application.status = application.status.upper()
        application.save(update_fields=["status"])
    for disbursement in disbursements.filter(status="settled").select_related("application__loan"):
        application = disbursement.application
        rows = [row for row in application.loan.result["schedule"] if Decimal(row["payment"]) > 0]
        account = accounts.create(owner_id=disbursement.owner_id, disbursement=disbursement,
                                  outstanding_principal=sum(Decimal(row["principal"]) for row in rows))
        for row in rows:
            event_id = f"repayment:{application.loan_id}:{row['number']}"
            receipt = ledger.filter(owner_id=disbursement.owner_id, payment__event_id=event_id).first()
            if receipt and receipt.amount != -Decimal(row["payment"]):
                raise RuntimeError("Legacy repayment ledger does not match the immutable loan schedule.")
            installments.create(owner_id=disbursement.owner_id, account=account, number=row["number"],
                                due_on=row["due_date"], amount=row["payment"], principal=row["principal"],
                                paid_on=receipt.effective_on if receipt else None)
            if receipt:
                account.outstanding_principal -= Decimal(row["principal"])
        account.status = "CLOSED" if account.outstanding_principal == 0 else "ACTIVE"
        account.save()
        application.status = "DISBURSED"
        application.save(update_fields=["status"])


def freeze(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for table in ("finance_loansimulation", "finance_idempotencyrecord"):
        schema_editor.execute(f"CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON {table} "
                              "FOR EACH ROW EXECUTE FUNCTION studyflow_reject_history_change();")


class Migration(migrations.Migration):
    dependencies = [("finance", "0005_affordabilityprofile_loanaccount_loaninstallment_and_more")]
    operations = [migrations.RunPython(adopt), migrations.RunPython(freeze)]
