from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import migrations


DEMO_EMAIL = "admin@gmail.com"


def seed_demo_account(apps, schema_editor):
    app_label, model_name = settings.AUTH_USER_MODEL.split(".")
    User = apps.get_model(app_label, model_name)
    user = User.objects.filter(username=DEMO_EMAIL).first() or User.objects.filter(email__iexact=DEMO_EMAIL).first()
    if user is None:
        user = User(username=DEMO_EMAIL)
    user.username = DEMO_EMAIL
    user.email = DEMO_EMAIL
    user.first_name = "Demo"
    user.last_name = "Admin"
    user.is_active = True
    user.is_staff = False
    user.is_superuser = False
    user.password = make_password("Admin123")
    user.save()


class Migration(migrations.Migration):
    dependencies = [("finance", "0019_emailotpchallenge")]
    operations = [migrations.RunPython(seed_demo_account, migrations.RunPython.noop)]
