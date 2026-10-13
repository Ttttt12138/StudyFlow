from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0024_planning_demo_date")]
    operations = [
        migrations.AddField(model_name="studytask", name="template_key",
                            field=models.CharField(blank=True, max_length=60)),
        migrations.AddField(model_name="reminderpreference", name="amount_override",
                            field=models.DecimalField(blank=True, decimal_places=2, max_digits=16, null=True)),
    ]
