from django.db import migrations


def downgrade_unconfirmed(apps, schema_editor):
    source = apps.get_model('finance', 'FundingSource')
    source.objects.filter(kind__in=['family', 'family_support'], received=False,
                          already_in_opening=False, certainty='confirmed').update(certainty='estimated')


class Migration(migrations.Migration):
    dependencies = [('finance', '0009_consumption_and_execution')]
    operations = [migrations.RunPython(downgrade_unconfirmed, migrations.RunPython.noop)]
