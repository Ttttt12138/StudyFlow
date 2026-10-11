# Remittance orders with an append-only status history and remittance ledger legs.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


def protect_history(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute(
        "CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON finance_remittancestatusevent "
        "FOR EACH ROW EXECUTE FUNCTION studyflow_reject_history_change();")


def unprotect_history(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute("DROP TRIGGER IF EXISTS immutable_history ON finance_remittancestatusevent;")


def refuse_lossy_reverse(apps, schema_editor):
    if apps.get_model("finance", "DemoLedgerEntry").objects.filter(remittance_order__isnull=False).exists():
        raise RuntimeError("Cannot unapply 0017: remittance ledger rows exist.")


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0016_policy_and_credit"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RemittanceOrder",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "recipient",
                    models.CharField(
                        choices=[("SELF", "Self"), ("BENEFICIARY", "Beneficiary")],
                        max_length=20,
                    ),
                ),
                (
                    "purpose",
                    models.CharField(
                        choices=[
                            ("tuition", "Tuition"),
                            ("living", "Living"),
                            ("family_support", "Family Support"),
                            ("other", "Other"),
                        ],
                        max_length=20,
                    ),
                ),
                ("reference", models.CharField(blank=True, max_length=140)),
                ("send_currency", models.CharField(max_length=3)),
                ("send_amount", models.DecimalField(decimal_places=2, max_digits=16)),
                ("sender_fee", models.DecimalField(decimal_places=2, max_digits=16)),
                ("rate", models.DecimalField(decimal_places=10, max_digits=24)),
                ("mid_rate", models.DecimalField(decimal_places=10, max_digits=24)),
                ("receive_currency", models.CharField(max_length=3)),
                (
                    "receive_amount",
                    models.DecimalField(decimal_places=2, max_digits=18),
                ),
                ("deadline", models.DateField(blank=True, null=True)),
                ("expected_earliest", models.DateField(blank=True, null=True)),
                ("expected_latest", models.DateField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("CREATED", "Created"),
                            ("SUBMITTED", "Submitted"),
                            ("IN_TRANSIT", "In_Transit"),
                            ("DELIVERED", "Delivered"),
                            ("RECONCILED", "Reconciled"),
                            ("CANCELLED", "Cancelled"),
                            ("EXPIRED", "Expired"),
                            ("UNKNOWN", "Unknown"),
                            ("REFUNDED", "Refunded"),
                        ],
                        default="CREATED",
                        max_length=20,
                    ),
                ),
                ("version", models.PositiveIntegerField(default=1)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("delivered_on", models.DateField(blank=True, null=True)),
                ("failure_reason", models.CharField(blank=True, max_length=200)),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="RemittanceStatusEvent",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("from_status", models.CharField(blank=True, max_length=20)),
                ("to_status", models.CharField(max_length=20)),
                ("version", models.PositiveIntegerField()),
                ("note", models.CharField(blank=True, max_length=500)),
                ("details", models.JSONField(default=dict)),
            ],
            options={
                "ordering": ["created_at", "version"],
            },
        ),
        migrations.RemoveConstraint(
            model_name="demoledgerentry",
            name="ledger_origin_and_sign",
        ),
        migrations.AddField(
            model_name="demoledgerentry",
            name="remittance_leg",
            field=models.CharField(
                blank=True,
                choices=[
                    ("debit", "Debit"),
                    ("refund", "Refund"),
                    ("credit", "Credit"),
                ],
                max_length=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="remittanceorder",
            name="beneficiary",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                to="finance.beneficiary",
            ),
        ),
        migrations.AddField(
            model_name="remittanceorder",
            name="corridor",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, to="finance.corridor"
            ),
        ),
        migrations.AddField(
            model_name="remittanceorder",
            name="owner",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="remittanceorder",
            name="quote",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, to="finance.fxquote"
            ),
        ),
        migrations.AddField(
            model_name="demoledgerentry",
            name="remittance_order",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="legs",
                to="finance.remittanceorder",
            ),
        ),
        migrations.AddConstraint(
            model_name="demoledgerentry",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("conversion__isnull", True),
                        ("disbursement__isnull", False),
                        ("funding_source__isnull", True),
                        ("installment__isnull", True),
                        ("payment__isnull", True),
                        ("remittance_order__isnull", True),
                        ("amount__gt", 0),
                    ),
                    models.Q(
                        ("conversion__isnull", True),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", True),
                        ("installment__isnull", True),
                        ("payment__isnull", False),
                        ("remittance_order__isnull", True),
                        ("amount__lt", 0),
                    ),
                    models.Q(
                        ("conversion__isnull", True),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", False),
                        ("installment__isnull", True),
                        ("payment__isnull", True),
                        ("remittance_order__isnull", True),
                        ("amount__gt", 0),
                    ),
                    models.Q(
                        ("conversion__isnull", True),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", True),
                        ("installment__isnull", False),
                        ("payment__isnull", True),
                        ("remittance_order__isnull", True),
                        ("amount__lt", 0),
                    ),
                    models.Q(
                        ("conversion__isnull", False),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", True),
                        ("installment__isnull", True),
                        ("payment__isnull", True),
                        ("remittance_order__isnull", True),
                        models.Q(("amount", 0), _negated=True),
                    ),
                    models.Q(
                        ("conversion__isnull", True),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", True),
                        ("installment__isnull", True),
                        ("payment__isnull", True),
                        ("remittance_order__isnull", False),
                        models.Q(
                            models.Q(("amount__lt", 0), ("remittance_leg", "debit")),
                            models.Q(
                                ("amount__gt", 0),
                                ("remittance_leg__in", ["refund", "credit"]),
                            ),
                            _connector="OR",
                        ),
                    ),
                    _connector="OR",
                ),
                name="ledger_origin_and_sign",
            ),
        ),
        migrations.AddConstraint(
            model_name="demoledgerentry",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("remittance_leg__isnull", True),
                        ("remittance_order__isnull", True),
                    ),
                    models.Q(
                        ("remittance_leg__isnull", False),
                        ("remittance_order__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="ledger_remittance_leg_pairing",
            ),
        ),
        migrations.AddConstraint(
            model_name="demoledgerentry",
            constraint=models.UniqueConstraint(
                condition=models.Q(("remittance_order__isnull", False)),
                fields=("remittance_order", "remittance_leg"),
                name="ledger_remittance_leg_unique",
            ),
        ),
        migrations.AddField(
            model_name="remittancestatusevent",
            name="actor",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="remittancestatusevent",
            name="order",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="history",
                to="finance.remittanceorder",
            ),
        ),
        migrations.AddField(
            model_name="remittancestatusevent",
            name="owner",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddConstraint(
            model_name="remittanceorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "status__in",
                        [
                            "CREATED",
                            "SUBMITTED",
                            "IN_TRANSIT",
                            "DELIVERED",
                            "RECONCILED",
                            "CANCELLED",
                            "EXPIRED",
                            "UNKNOWN",
                            "REFUNDED",
                        ],
                    )
                ),
                name="remittance_status_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="remittanceorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("beneficiary__isnull", True), ("recipient", "SELF")),
                    models.Q(
                        ("beneficiary__isnull", False), ("recipient", "BENEFICIARY")
                    ),
                    _connector="OR",
                ),
                name="remittance_recipient_consistent",
            ),
        ),
        migrations.AddConstraint(
            model_name="remittanceorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("receive_amount__gt", 0),
                    ("send_amount__gt", 0),
                    ("sender_fee__gte", 0),
                ),
                name="remittance_positive_amounts",
            ),
        ),
        migrations.AddConstraint(
            model_name="remittanceorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("send_currency", models.F("receive_currency")), _negated=True
                ),
                name="remittance_distinct_currencies",
            ),
        ),
        migrations.AddConstraint(
            model_name="remittancestatusevent",
            constraint=models.UniqueConstraint(
                fields=("order", "version"), name="remittance_event_version_unique"
            ),
        ),
        migrations.RunPython(protect_history, unprotect_history),
        migrations.RunPython(migrations.RunPython.noop, refuse_lossy_reverse),
    ]
