import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0019_agent_first_planning")]

    operations = [
        migrations.CreateModel(
            name="EmailOtpChallenge",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("email", models.EmailField(db_index=True, max_length=254)),
                ("purpose", models.CharField(choices=[("sign_up", "Sign up"), ("sign_in", "Sign in"), ("password_reset", "Password reset")], max_length=24)),
                ("code_digest", models.CharField(max_length=64)),
                ("expires_at", models.DateTimeField()),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"indexes": [models.Index(fields=["email", "purpose", "-created_at"], name="email_otp_lookup")]},
        ),
    ]
