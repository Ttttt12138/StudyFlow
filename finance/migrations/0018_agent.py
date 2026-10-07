# Agent sessions, append-only steps and pending T2 actions.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


def protect_steps(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute(
        "CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON finance_agentstep "
        "FOR EACH ROW EXECUTE FUNCTION studyflow_reject_history_change();")


def unprotect_steps(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute("DROP TRIGGER IF EXISTS immutable_history ON finance_agentstep;")


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0017_remittance_orders"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentSession",
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
                ("idempotency_key", models.CharField(max_length=100)),
                ("goal", models.CharField(max_length=2000)),
                (
                    "locale",
                    models.CharField(
                        choices=[("zh", "Chinese"), ("en", "English")], max_length=2
                    ),
                ),
                ("mode", models.CharField(max_length=10)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("RUNNING", "Running"),
                            ("COMPLETED", "Completed"),
                            ("FAILED", "Failed"),
                        ],
                        default="RUNNING",
                        max_length=20,
                    ),
                ),
                ("final_answer", models.TextField(blank=True)),
                ("error_code", models.CharField(blank=True, max_length=40)),
                ("write_count", models.PositiveSmallIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
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
            },
        ),
        migrations.CreateModel(
            name="AgentStep",
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
                ("number", models.PositiveSmallIntegerField()),
                ("tool", models.CharField(blank=True, max_length=40)),
                ("tier", models.CharField(blank=True, max_length=2)),
                ("arguments", models.JSONField(default=dict)),
                ("rationale", models.CharField(blank=True, max_length=300)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("OK", "Ok"),
                            ("ERROR", "Error"),
                            ("PROPOSED", "Proposed"),
                            ("DENIED", "Denied"),
                            ("FINAL", "Final"),
                        ],
                        max_length=10,
                    ),
                ),
                ("result", models.JSONField(default=dict)),
                ("call", models.JSONField(default=dict)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="steps",
                        to="finance.agentsession",
                    ),
                ),
            ],
            options={
                "ordering": ["number"],
            },
        ),
        migrations.CreateModel(
            name="AgentPendingAction",
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
                ("tool", models.CharField(max_length=40)),
                ("arguments", models.JSONField(default=dict)),
                ("target_id", models.UUIDField()),
                ("amount", models.DecimalField(decimal_places=2, max_digits=18)),
                ("currency", models.CharField(max_length=3)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PENDING", "Pending"),
                            ("CONFIRMED", "Confirmed"),
                            ("REJECTED", "Rejected"),
                            ("EXPIRED", "Expired"),
                            ("FAILED", "Failed"),
                        ],
                        default="PENDING",
                        max_length=20,
                    ),
                ),
                ("expires_at", models.DateTimeField()),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("result", models.JSONField(default=dict)),
                ("version", models.PositiveIntegerField(default=1)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pending_actions",
                        to="finance.agentsession",
                    ),
                ),
                (
                    "step",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        to="finance.agentstep",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="agentsession",
            constraint=models.UniqueConstraint(
                fields=("owner", "idempotency_key"), name="agent_session_key_unique"
            ),
        ),
        migrations.AddConstraint(
            model_name="agentsession",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", ["RUNNING", "COMPLETED", "FAILED"])),
                name="agent_session_status_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="agentstep",
            constraint=models.UniqueConstraint(
                fields=("session", "number"), name="agent_step_number_unique"
            ),
        ),
        migrations.AddConstraint(
            model_name="agentstep",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("status__in", ["OK", "ERROR", "PROPOSED", "DENIED", "FINAL"])
                ),
                name="agent_step_status_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="agentpendingaction",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "status__in",
                        ["PENDING", "CONFIRMED", "REJECTED", "EXPIRED", "FAILED"],
                    )
                ),
                name="agent_pending_status_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="agentpendingaction",
            constraint=models.CheckConstraint(
                condition=models.Q(("amount__gt", 0)),
                name="agent_pending_positive_amount",
            ),
        ),
        migrations.AddConstraint(
            model_name="agentpendingaction",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "PENDING")),
                fields=("owner", "action", "target_id"),
                name="agent_pending_one_open_per_target",
            ),
        ),
        migrations.RunPython(protect_steps, unprotect_steps),
    ]
