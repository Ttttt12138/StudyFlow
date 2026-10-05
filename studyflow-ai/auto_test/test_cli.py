import json

from studyflow_ai.cli import main


def test_cli_demo_and_schema_export(tmp_path):
    for command in ("demo", "schemas"):
        target = tmp_path / f"{command}.json"
        assert main(["--mode", "mock", command, "--output", str(target)]) == 0
        assert json.loads(target.read_text(encoding="utf-8"))


def test_cli_ingest_rejects_scanned_pdf(tmp_path):
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    source, target = tmp_path / "scan.pdf", tmp_path / "result.json"
    writer.write(source)
    assert main(["ingest", str(source), "--kind", "pdf", "--output", str(target)]) == 0
    result = json.loads(target.read_text())
    assert result["status"] == "REJECTED"
    assert result["issues"][0]["code"] == "PDF_NO_TEXT_LAYER"


def test_cli_requires_real_credentials(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    target = tmp_path / "verification.json"
    assert main(["--mode", "live", "verify-live", "--output", str(target)]) == 2
    assert json.loads(target.read_text())["status"] == "NOT_VERIFIED"


def test_cli_mock_cannot_verify_live(tmp_path):
    target = tmp_path / "verification.json"
    assert main(["--mode", "mock", "verify-live", "--output", str(target)]) == 2
