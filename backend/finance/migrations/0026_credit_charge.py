import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0025_life_checklist_amounts"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="CreditCharge",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=16)),
                ("currency", models.CharField(max_length=3)),
                ("charged_on", models.DateField()),
                ("due_date", models.DateField()),
                ("repaid_on", models.DateField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=1)),
                ("bill", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="credit_charge", to="finance.planbill")),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
                ("plan", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="finance.studyplan")),
            ],
            options={"constraints": [models.CheckConstraint(condition=models.Q(("amount__gt", 0)), name="credit_charge_positive")]},
        ),
    ]
