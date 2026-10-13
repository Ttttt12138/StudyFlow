from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0023_study_life_reminders")]
    operations = [migrations.AddField(model_name="planningprofile", name="demo_date",
                                     field=models.DateField(blank=True, null=True))]
