import json

from studyflow_ai.cli import main


def test_v2_cli_schema_and_demo(tmp_path):
    schema = tmp_path / "schema.json"
    assert main(["readiness-schemas", "--output", str(schema)]) == 0
    assert "FundingContext" in json.loads(schema.read_text())
    result = tmp_path / "demo.json"
    assert main(["--mode", "mock", "readiness-demo", "--output", str(result)]) == 0
    data = json.loads(result.read_text(encoding="utf-8"))
    assert data["repeat_reused"]
    assert data["application_transitions"][2]["demo_balance"] == "140200.00"


def test_explicit_env_file_does_not_execute_or_log_values(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text('OPENAI_MODEL="test-model"\nIGNORED_SECRET=secret\n', encoding="utf-8")
    monkeypatch.delenv("IGNORED_SECRET", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    out = tmp_path / "schema.json"
    assert main(["--env-file", str(env), "readiness-schemas", "--output", str(out)]) == 0
    import os

    assert os.environ["OPENAI_MODEL"] == "test-model"
    assert "IGNORED_SECRET" not in os.environ
