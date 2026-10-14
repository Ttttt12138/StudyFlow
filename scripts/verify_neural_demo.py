"""Validate the delivered media clock, preserved coverage, subtitles and audio placement."""
from array import array
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

from PIL import Image

from edit_neural_demo import DEST, PRIOR
from neural_demo_audio import WORK, ROOT, FFMPEG, read_pcm, normalized
import verify_full_demo as original_checks


def inspect(args, filename):
    return original_checks.run(str(FFMPEG), args, DEST / filename)


def verify_story(edit):
    old = json.loads((PRIOR / "edit-manifest.json").read_text(encoding="utf-8"))
    assert len(edit["shots"]) == len(old["shots"]) == 46
    assert len(edit["paragraphs"]) == 12
    for first, second in zip(edit["shots"], old["shots"]):
        assert first["id"] == second["id"] and first["source"] == second["source"], first["id"]
    assert normalized(" ".join(c["text"] for c in edit["captions"])) == normalized(
        " ".join(p["text"] for p in edit["paragraphs"]))
    previous_end = 0
    for caption in edit["captions"]:
        shot = next(s for s in edit["shots"] if s["id"] == caption["shot"])
        assert previous_end <= caption["start"] < caption["end"] <= shot["start"] + shot["duration"] + 1e-7
        assert caption["start"] >= shot["start"]
        previous_end = caption["end"]
    for shot in edit["shots"]:
        assert abs(shot["start"] * 30 - round(shot["start"] * 30)) < .001
    return {"shots_preserved": 46, "original_recorded_ranges_identical": True,
            "continuous_paragraphs": 12, "caption_groups": len(edit["captions"]),
            "captions_within_matching_shot": True, "caption_text_matches_narration": True}


def samples(path):
    result = subprocess.run([str(FFMPEG), "-hide_banner", "-v", "error", "-i", str(path),
                             "-vn", "-ac", "1", "-ar", "1000", "-f", "s16le", "-"], capture_output=True, check=True)
    return array("h", result.stdout)


def best_offset(actual, reference, expected):
    norm, best = sum(value * value for value in reference), (-1, 0)
    for offset in range(-100, 101):
        observed = actual[expected + offset:expected + offset + len(reference)]
        denominator = math.sqrt(norm * sum(value * value for value in observed))
        score = sum(a * b for a, b in zip(reference, observed)) / denominator if denominator else 0
        if score > best[0]:
            best = (score, offset)
    return best


def verify_waveform(movie, shots):
    actual, planned = samples(movie), samples(WORK / "continuous-narration.wav")
    checks = []
    for shot in shots:
        expected = round((shot["start"] + .30) * 1000)
        length = min(1800, round((shot["duration"] - .40) * 1000))
        score, offset = best_offset(actual, planned[expected:expected + length], expected)
        check = {"shot": shot["id"], "correlation": score, "offset_seconds": offset / 1000}
        assert score > .98 and abs(offset) <= 30, check
        checks.append(check)
    return checks


def verify_clock(movie, duration):
    decode = inspect(["-v", "error", "-i", str(movie), "-f", "null", "-"], "decode.log")
    assert not decode.strip(), decode
    video = inspect(["-v", "info", "-i", str(movie), "-map", "0:v:0", "-vf", "showinfo", "-an", "-f", "null", "-"], "video-timestamps.log")
    audio = inspect(["-v", "info", "-i", str(movie), "-map", "0:a:0", "-af", "ashowinfo", "-vn", "-f", "null", "-"], "audio-timestamps.log")
    frames = re.findall(r"\bn:\s*\d+\s+pts:\s*\d+\s+pts_time:([\d.]+)", video)
    packets = re.findall(r"pts_time:([\d.]+).*?nb_samples:(\d+)", audio)
    video_end = float(frames[-1]) + 1 / 30
    audio_end = float(packets[-1][0]) + int(packets[-1][1]) / 48000
    assert len(frames) == round(duration * 30)
    assert abs(video_end - duration) < .04 and abs(video_end - audio_end) < .04
    assert video_end < 300
    (DEST / "media-inspection.txt").write_text("\n".join(video.splitlines()[:24]), encoding="utf-8")
    return {"duration_seconds": video_end, "audio_end_seconds": audio_end,
            "av_endpoint_difference_seconds": abs(video_end - audio_end), "video_frames": len(frames), "decode_errors": 0}


def verify_levels(movie):
    data = inspect(["-i", str(movie), "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], "audio-inspection.txt")
    levels = json.loads(data[data.rfind("{"):data.rfind("}") + 1])
    assert float(levels["input_tp"]) < -.5, levels
    pcm = array("h", read_pcm(WORK / "continuous-narration.wav"))
    assert max(abs(value) for value in pcm) < 32767
    return {"integrated_loudness_lufs": float(levels["input_i"]),
            "true_peak_dbfs": float(levels["input_tp"]), "loudness_range_lu": float(levels["input_lra"]),
            "clipped_pcm_samples": 0}


def main():
    edit = json.loads((DEST / "edit-manifest.json").read_text(encoding="utf-8"))
    movie = DEST / "StudyFlow_Demo_EN.mp4"
    coverage = verify_story(edit)
    clock = verify_clock(movie, edit["duration"])
    placement = verify_waveform(movie, edit["shots"])
    levels = verify_levels(movie)
    count = original_checks.verify_source(ROOT / "evidence/demo-full-live-20261014/take-07")
    original_checks.DEST = DEST
    sheets = original_checks.frame_contact(str(FFMPEG), movie, edit["shots"])
    with Image.open(DEST / "qa-shot-01.png") as poster:
        poster.save(DEST / "StudyFlow_Demo_EN_Poster.png")
    trace = json.loads((ROOT / "evidence/demo-full-live-20261014/take-07/model-trace.json").read_text(encoding="utf-8"))
    report = {"passed": True, **clock, **coverage, **levels, "source_files_verified": count,
              "all_calls_live": trace["all_calls_live"], "model_calls": trace["model_calls"], "models": trace["models"],
              "footage_acceptance": "Existing take-07 retained; narration revision does not claim a new AI acceptance run",
              "sha256": hashlib.sha256(movie.read_bytes()).hexdigest(), "narration_alignment": placement,
              "max_narration_offset_seconds": max(abs(item["offset_seconds"]) for item in placement),
              "timing_method": "Provider word events mapped through actual PCM tempo regions; 30 fps shot boundaries; final audio compared to scheduled PCM",
              "timing_limit": "Audio placement is measured at 1 ms resolution; provider word events are not independent phonetic ground truth",
              "contact_sheets": [Path(p).name for p in sheets]}
    (DEST / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in ("narration_alignment", "contact_sheets")}, indent=2), flush=True)


if __name__ == "__main__":
    main()
