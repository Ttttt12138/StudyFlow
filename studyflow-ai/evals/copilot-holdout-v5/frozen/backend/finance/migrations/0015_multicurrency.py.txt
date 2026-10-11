# Multi-currency wallet: foreign balances, corridors, reference rates, conversions.
# Existing ledger rows are THB; ADD COLUMN DEFAULT does not fire the immutable-history trigger.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


# Frozen copy of finance/corridors.py at the time of this migration; do not import app code here.
# (source, target, min, max, [(tier, fee_fixed, fee_percent, margin_bps, min_days, days)])
CORRIDORS = [
    ("CNY", "THB", "100", "50000", [("express", "30", "0.0050", 60, 0, 1),
        ("standard", "15", "0.0030", 40, 1, 2), ("economy", "0", "0.0015", 25, 3, 5)]),
    ("USD", "THB", "20", "10000", [("express", "15", "0.0050", 60, 0, 1),
        ("standard", "8", "0.0030", 40, 1, 3), ("economy", "0", "0.0015", 25, 3, 6)]),
    ("EUR", "THB", "20", "10000", [("express", "14", "0.0050", 60, 0, 1),
        ("standard", "7", "0.0030", 40, 1, 3), ("economy", "0", "0.0015", 25, 3, 6)]),
    ("THB", "CNY", "500", "300000", [("express", "150", "0.0050", 60, 0, 1),
        ("standard", "80", "0.0030", 40, 1, 2), ("economy", "0", "0.0015", 25, 3, 5)]),
]
PROVIDERS = {"express": "Demo Express Remit", "standard": "Demo Standard Transfer",
             "economy": "Demo Economy Wire"}


def seed_corridors(apps, schema_editor):
    Corridor = apps.get_model("finance", "Corridor")
    for source, target, low, high, tiers in CORRIDORS:
        for tier, fee, percent, margin, min_days, days in tiers:
            Corridor.objects.get_or_create(code=f"{source}-{target}-{tier}".lower(), defaults=dict(
                provider=PROVIDERS[tier], tier=tier, source_currency=source, target_currency=target,
                min_amount=low, max_amount=high, fee_fixed=fee, fee_percent=percent,
                fx_margin_bps=margin, settlement_min_days=min_days, settlement_days=days))


def protect_conversions(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute(
        "CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON finance_currencyconversion "
        "FOR EACH ROW EXECUTE FUNCTION studyflow_reject_history_change();")


def unprotect_conversions(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute("DROP TRIGGER IF EXISTS immutable_history ON finance_currencyconversion;")


def refuse_lossy_reverse(apps, schema_editor):
    # Runs first when unapplying: the old schema cannot represent conversions or foreign rows.
    Entry = apps.get_model("finance", "DemoLedgerEntry")
    if Entry.objects.exclude(currency="THB").exists() or Entry.objects.filter(conversion__isnull=False).exists():
        raise RuntimeError("Cannot unapply 0015: foreign-currency or conversion ledger rows exist.")


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0014_copilot_workflows"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Corridor",
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
                ("code", models.SlugField(unique=True)),
                ("provider", models.CharField(max_length=100)),
                (
                    "tier",
                    models.CharField(
                        choices=[
                            ("express", "Express"),
                            ("standard", "Standard"),
                            ("economy", "Economy"),
                        ],
                        max_length=20,
                    ),
                ),
                ("source_currency", models.CharField(max_length=3)),
                ("target_currency", models.CharField(max_length=3)),
                ("enabled", models.BooleanField(default=True)),
                ("min_amount", models.DecimalField(decimal_places=2, max_digits=16)),
                ("max_amount", models.DecimalField(decimal_places=2, max_digits=16)),
                (
                    "fee_fixed",
                    models.DecimalField(decimal_places=2, default=0, max_digits=16),
                ),
                (
                    "fee_percent",
                    models.DecimalField(decimal_places=4, default=0, max_digits=6),
                ),
                ("fx_margin_bps", models.PositiveIntegerField(default=0)),
                ("settlement_min_days", models.PositiveSmallIntegerField(default=0)),
                ("settlement_days", models.PositiveSmallIntegerField(default=0)),
                ("is_simulated", models.BooleanField(default=True)),
            ],
            options={
                "ordering": [
                    "source_currency",
                    "target_currency",
                    "settlement_days",
                    "code",
                ],
            },
        ),
        migrations.CreateModel(
            name="CurrencyConversion",
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
                ("source_currency", models.CharField(max_length=3)),
                ("source_amount", models.DecimalField(decimal_places=2, max_digits=18)),
                ("target_currency", models.CharField(max_length=3)),
                ("target_amount", models.DecimalField(decimal_places=2, max_digits=18)),
                ("rate", models.DecimalField(decimal_places=10, max_digits=24)),
                ("sender_fee", models.DecimalField(decimal_places=2, max_digits=16)),
                ("receiver_fee", models.DecimalField(decimal_places=2, max_digits=16)),
                ("effective_on", models.DateField()),
            ],
        ),
        migrations.CreateModel(
            name="FxRateSnapshot",
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
                ("base", models.CharField(max_length=3)),
                ("quote", models.CharField(max_length=3)),
                ("rate", models.DecimalField(decimal_places=10, max_digits=24)),
                ("rate_date", models.DateField()),
                ("fetched_at", models.DateTimeField()),
                (
                    "source",
                    models.CharField(
                        choices=[
                            ("frankfurter", "Frankfurter"),
                            ("fixture", "Fixture"),
                        ],
                        max_length=20,
                    ),
                ),
                ("basis", models.CharField(blank=True, max_length=300)),
            ],
        ),
        migrations.CreateModel(
            name="WalletBalance",
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
                ("currency", models.CharField(max_length=3)),
                (
                    "balance",
                    models.DecimalField(decimal_places=2, default=0, max_digits=18),
                ),
            ],
        ),
        migrations.RemoveConstraint(
            model_name="demoledgerentry",
            name="ledger_origin_and_sign",
        ),
        migrations.AddField(
            model_name="demoledgerentry",
            name="currency",
            field=models.CharField(default="THB", max_length=3),
        ),
        migrations.AddField(
            model_name="fxquote",
            name="consumed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="fxquote",
            name="mid_rate",
            field=models.DecimalField(
                blank=True, decimal_places=10, max_digits=24, null=True
            ),
        ),
        migrations.AddField(
            model_name="fxquote",
            name="quoted_amount",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=16, null=True),
        ),
        migrations.AddField(
            model_name="fxquote",
            name="rate_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="fxquote",
            name="rate_source",
            field=models.CharField(
                choices=[
                    ("manual", "Manual"),
                    ("frankfurter", "Frankfurter"),
                    ("fixture", "Fixture"),
                ],
                default="manual",
                max_length=20,
            ),
        ),
        migrations.AddConstraint(
            model_name="demowallet",
            constraint=models.CheckConstraint(
                condition=models.Q(("balance__gte", 0)),
                name="demo_wallet_balance_nonnegative",
            ),
        ),
        migrations.AddConstraint(
            model_name="corridor",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("source_currency", models.F("target_currency")), _negated=True
                ),
                name="corridor_distinct_currencies",
            ),
        ),
        migrations.AddConstraint(
            model_name="corridor",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("max_amount__gte", models.F("min_amount")), ("min_amount__gt", 0)
                ),
                name="corridor_amount_range",
            ),
        ),
        migrations.AddConstraint(
            model_name="corridor",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("settlement_min_days__lte", models.F("settlement_days"))
                ),
                name="corridor_settlement_range",
            ),
        ),
        migrations.AddConstraint(
            model_name="corridor",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("fee_fixed__gte", 0),
                    ("fee_percent__gte", 0),
                    ("fee_percent__lt", 1),
                ),
                name="corridor_fee_range",
            ),
        ),
        migrations.AddField(
            model_name="fxquote",
            name="corridor",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                to="finance.corridor",
            ),
        ),
        migrations.AddField(
            model_name="currencyconversion",
            name="owner",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="currencyconversion",
            name="quote",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, to="finance.fxquote"
            ),
        ),
        migrations.AddField(
            model_name="demoledgerentry",
            name="conversion",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="legs",
                to="finance.currencyconversion",
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
                        ("amount__gt", 0),
                    ),
                    models.Q(
                        ("conversion__isnull", True),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", True),
                        ("installment__isnull", True),
                        ("payment__isnull", False),
                        ("amount__lt", 0),
                    ),
                    models.Q(
                        ("conversion__isnull", True),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", False),
                        ("installment__isnull", True),
                        ("payment__isnull", True),
                        ("amount__gt", 0),
                    ),
                    models.Q(
                        ("conversion__isnull", True),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", True),
                        ("installment__isnull", False),
                        ("payment__isnull", True),
                        ("amount__lt", 0),
                    ),
                    models.Q(
                        ("conversion__isnull", False),
                        ("disbursement__isnull", True),
                        ("funding_source__isnull", True),
                        ("installment__isnull", True),
                        ("payment__isnull", True),
                        models.Q(("amount", 0), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="ledger_origin_and_sign",
            ),
        ),
        migrations.AddConstraint(
            model_name="demoledgerentry",
            constraint=models.UniqueConstraint(
                condition=models.Q(("conversion__isnull", False)),
                fields=("conversion", "currency"),
                name="ledger_conversion_leg_unique",
            ),
        ),
        migrations.AddIndex(
            model_name="fxratesnapshot",
            index=models.Index(
                fields=["base", "quote", "-fetched_at"], name="fx_snapshot_pair_latest"
            ),
        ),
        migrations.AddConstraint(
            model_name="fxratesnapshot",
            constraint=models.CheckConstraint(
                condition=models.Q(("rate__gt", 0)), name="fx_snapshot_positive_rate"
            ),
        ),
        migrations.AddConstraint(
            model_name="fxratesnapshot",
            constraint=models.CheckConstraint(
                condition=models.Q(("base", models.F("quote")), _negated=True),
                name="fx_snapshot_distinct_pair",
            ),
        ),
        migrations.AddField(
            model_name="walletbalance",
            name="owner",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="walletbalance",
            name="wallet",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="foreign_balances",
                to="finance.demowallet",
            ),
        ),
        migrations.AddConstraint(
            model_name="currencyconversion",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("source_currency", models.F("target_currency")), _negated=True
                ),
                name="conversion_distinct_currencies",
            ),
        ),
        migrations.AddConstraint(
            model_name="currencyconversion",
            constraint=models.CheckConstraint(
                condition=models.Q(("source_amount__gt", 0), ("target_amount__gt", 0)),
                name="conversion_positive_amounts",
            ),
        ),
        migrations.AddConstraint(
            model_name="walletbalance",
            constraint=models.UniqueConstraint(
                fields=("owner", "currency"),
                name="wallet_balance_owner_currency_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="walletbalance",
            constraint=models.CheckConstraint(
                condition=models.Q(("balance__gte", 0)),
                name="wallet_balance_nonnegative",
            ),
        ),
        migrations.RunPython(seed_corridors, migrations.RunPython.noop),
        migrations.RunPython(protect_conversions, unprotect_conversions),
        migrations.RunPython(migrations.RunPython.noop, refuse_lossy_reverse),
    ]
