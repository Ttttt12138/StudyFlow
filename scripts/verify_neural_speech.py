"""Optional offline intelligibility check with the already installed SenseVoice model."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "output/demo-neural-video-20261014"
FFMPEG = ROOT / "output/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"


def tokens(text):
    text = text.lower().replace("study flow", "studyflow").replace("u.s.", "us")
    replacements = [("six thousand five hundred", "6500"), ("twenty thousand", "20000"),
                    ("six thousand", "6000"), ("five hundred", "500"), ("sixty", "60"), ("thirty", "30")]
    for phrase, number in replacements:
        text = text.replace(phrase, number)
    text = re.sub(r"(?<=\d),(?=\d)", "", text)
    return re.findall(r"[a-z0-9]+", text)


def errors(expected, actual):
    previous = list(range(len(actual) + 1))
    for i, first in enumerate(expected, 1):
        current = [i]
        for j, second in enumerate(actual, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (first != second)))
        previous = current
    return previous[-1]


def recognize(model, paragraph, np):
    decoded = WORK / f"{paragraph['id']}-asr.wav"
    subprocess.run([str(FFMPEG), "-hide_banner", "-v", "error", "-y", "-i",
                    str(WORK / f"{paragraph['id']}.wav"), "-ar", "16000", "-ac", "1", str(decoded)], check=True)
    with wave.open(str(decoded)) as audio:
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
    raw = model.generate(input=samples, cache={}, language="en", use_itn=True,
                         batch_size_s=60, merge_vad=True, merge_length_s=15, disable_pbar=True)
    text = " ".join(re.sub(r"<\|[^|]*\|>", "", row.get("text", "")).strip() for row in raw)
    expected, actual = tokens(paragraph["text"]), tokens(text)
    result = {"id": paragraph["id"], "transcript": text, "expected": paragraph["text"],
              "word_errors": errors(expected, actual), "reference_words": len(expected),
              "numbers_expected": re.findall(r"\d+", " ".join(expected)),
              "numbers_observed": re.findall(r"\d+", " ".join(actual)),
              "clipped_sample_ratio": float((abs(samples) >= .9999).mean())}
    print(json.dumps(result), flush=True)
    return result


def main(models):
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY"):
        os.environ[key] = "1"
    for key in ("HF_HOME", "MODELSCOPE_CACHE", "NUMBA_CACHE_DIR", "TORCH_HOME"):
        os.environ[key] = str(WORK / "validation-cache" / key.lower())
    import numpy as np
    from funasr import AutoModel
    model = AutoModel(model=str(models / "sensevoice"), device="cpu", ncpu=4,
                      vad_model=str(models / "vad"), vad_kwargs={"max_single_segment_time": 30000, "device": "cpu"},
                      disable_update=True, disable_pbar=True, trust_remote_code=False)
    story = json.loads((WORK / "story.json").read_text(encoding="utf-8"))
    checks = [recognize(model, paragraph, np) for paragraph in story]
    report = {"method": "Offline SenseVoice ASR on all 12 mastered paragraphs; no audio uploaded",
              "limitation": "Recognition differences are not a human listening or phonetic alignment score",
              "word_error_rate": sum(row["word_errors"] for row in checks) / sum(row["reference_words"] for row in checks),
              "numbers_match": all(row["numbers_expected"] == row["numbers_observed"] for row in checks),
              "paragraphs": checks}
    (WORK / "candidate/speech-check.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", required=True, type=Path)
    main(parser.parse_args().models.resolve())
