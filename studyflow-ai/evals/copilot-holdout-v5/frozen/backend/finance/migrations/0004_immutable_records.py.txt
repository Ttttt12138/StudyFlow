from django.db import migrations

TABLES = ["finance_demoledgerentry", "finance_auditevent", "finance_financialstate"]

def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    schema_editor.execute("""
        CREATE FUNCTION studyflow_reject_history_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'StudyFlow financial history is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    for table in TABLES:
        schema_editor.execute(f"""
            CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION studyflow_reject_history_change();
        """)

def remove(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql": return
    for table in TABLES:
        schema_editor.execute(f"DROP TRIGGER IF EXISTS immutable_history ON {table};")
    schema_editor.execute("DROP FUNCTION IF EXISTS studyflow_reject_history_change();")

class Migration(migrations.Migration):
    dependencies = [("finance","0003_demoledgerentry_sequence_and_more")]
    operations = [migrations.RunPython(install, remove)]
