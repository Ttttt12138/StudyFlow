from unittest.mock import patch

from studyflow_ai.config import load_env_file
from studyflow_ai.ocr_config import OcrSettings


def test_c_env_loads_secrets_without_exposing_them(tmp_path):
    path = tmp_path / ".env"
    path.write_text(
        'GEMINI_API_KEY="private-test-key"\nSTUDYFLOW_OCR_MODEL=gemini-test\n'
        "STUDYFLOW_OCR_ENABLED=true\n",
        encoding="utf-8",
    )
    with patch.dict("os.environ", {}, clear=True):
        settings = OcrSettings.from_env(path)
    assert settings.api_key == "private-test-key"
    assert settings.model == "gemini-test"
    assert settings.enabled is True
    assert "private-test-key" not in repr(settings)


def test_process_env_overrides_c_file(tmp_path):
    path = tmp_path / ".env"
    path.write_text("STUDYFLOW_OCR_MODEL=gemini-file\n", encoding="utf-8")
    with patch.dict("os.environ", {"STUDYFLOW_OCR_MODEL": "gemini-process"}, clear=True):
        assert OcrSettings.from_env(path).model == "gemini-process"


def test_absent_c_file_does_not_read_cwd_env(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("GEMINI_API_KEY=wrong-root-secret", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    with patch.dict("os.environ", {}, clear=True):
        settings = OcrSettings.from_env(tmp_path / "missing" / ".env")
    assert not settings.api_key
    assert not settings.enabled


def test_explicit_c_env_loader_includes_ocr_settings(tmp_path):
    import os

    path = tmp_path / ".env"
    path.write_text(
        "GEMINI_API_KEY=explicit-secret\nDJANGO_SECRET_KEY=must-not-load\n", encoding="utf-8"
    )
    with patch.dict("os.environ", {}, clear=True):
        load_env_file(path)
        assert os.environ["GEMINI_API_KEY"] == "explicit-secret"
        assert "DJANGO_SECRET_KEY" not in os.environ
