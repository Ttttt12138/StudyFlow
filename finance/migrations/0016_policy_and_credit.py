# Policy tiers (limits, approvals, step-up grants) and simulated credit snapshots.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


# Frozen copy of finance/policy_defaults.py at the time of this migration.
LIMITS = {
    "THB": ("50000", "100000", "300000"), "CNY": ("10000", "20000", "60000"),
    "USD": ("1500", "3000", "9000"), "EUR": ("1400", "2800", "8400"),
    "GBP": ("1200", "2400", "7200"), "JPY": ("200000", "400000", "1200000"),
}


def seed_limits(apps, schema_editor):
    PolicyLimit = apps.get_model("finance", "PolicyLimit")
    for currency, (per_transaction, daily, monthly) in LIMITS.items():
        PolicyLimit.objects.get_or_create(action="outflow", currency=currency, defaults=dict(
            per_transaction=per_transaction, daily=daily, monthly=monthly))


def protect_credit(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute(
        "CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON finance_creditsnapshot "
        "FOR EACH ROW EXECUTE FUNCTION studyflow_reject_history_change();")


def unprotect_credit(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute("DROP TRIGGER IF EXISTS immutable_history ON finance_creditsnapshot;")


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0015_multicurrency"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="submitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="PolicyLimit",
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
                ("action", models.CharField(default="outflow", max_length=40)),
                ("currency", models.CharField(max_length=3)),
                (
                    "per_transaction",
                    models.DecimalField(decimal_places=2, max_digits=16),
                ),
                ("daily", models.DecimalField(decimal_places=2, max_digits=18)),
                ("monthly", models.DecimalField(decimal_places=2, max_digits=18)),
                ("enabled", models.BooleanField(default=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["action", "currency"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("action", "currency"),
                        name="policy_limit_action_currency_unique",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("daily__gte", models.F("per_transaction")),
                            ("monthly__gte", models.F("daily")),
                            ("per_transaction__gt", 0),
                        ),
                        name="policy_limit_ordered",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="StepUpGrant",
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
                ("nonce", models.CharField(max_length=64, unique=True)),
                ("action", models.CharField(max_length=40)),
                ("target_id", models.UUIDField()),
                ("amount", models.DecimalField(decimal_places=2, max_digits=18)),
                ("currency", models.CharField(max_length=3)),
                ("expires_at", models.DateTimeField()),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="ApprovalRequest",
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
                ("action", models.CharField(max_length=40)),
                ("target_id", models.UUIDField()),
                ("amount", models.DecimalField(decimal_places=2, max_digits=18)),
                ("currency", models.CharField(max_length=3)),
                ("reason", models.CharField(max_length=500)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PENDING", "Pending"),
                            ("APPROVED", "Approved"),
                            ("REJECTED", "Rejected"),
                            ("EXPIRED", "Expired"),
                            ("USED", "Used"),
                        ],
                        default="PENDING",
                        max_length=20,
                    ),
                ),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("decision_note", models.CharField(blank=True, max_length=500)),
                ("expires_at", models.DateTimeField()),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=1)),
                (
                    "decided_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "requested_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            ("decided_by__isnull", True),
                            models.Q(
                                ("decided_by", models.F("requested_by")), _negated=True
                            ),
                            _connector="OR",
                        ),
                        name="approval_decider_not_requester",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("amount__gt", 0)),
                        name="approval_positive_amount",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            (
                                "status__in",
                                ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "USED"],
                            )
                        ),
                        name="approval_status_valid",
                    ),
                    models.UniqueConstraint(
                        condition=models.Q(("status__in", ["PENDING", "APPROVED"])),
                        fields=("owner", "action", "target_id"),
                        name="approval_one_open_per_target",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="CreditSnapshot",
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
                    "level",
                    models.CharField(
                        choices=[
                            ("BUILDING", "Building"),
                            ("FAIR", "Fair"),
                            ("GOOD", "Good"),
                            ("AT_RISK", "At_Risk"),
                        ],
                        max_length=20,
                    ),
                ),
                ("on_time", models.PositiveIntegerField()),
                ("late", models.PositiveIntegerField()),
                ("overdue", models.PositiveIntegerField()),
                ("factors", models.JSONField(default=list)),
                ("evidence", models.JSONField(default=list)),
                ("as_of", models.DateField()),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(
                            ("level__in", ["BUILDING", "FAIR", "GOOD", "AT_RISK"])
                        ),
                        name="credit_level_valid",
                    )
                ],
            },
        ),
        migrations.RunPython(seed_limits, migrations.RunPython.noop),
        migrations.RunPython(protect_credit, unprotect_credit),
    ]
