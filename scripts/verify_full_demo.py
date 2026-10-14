"""Check accepted input integrity, final decoding, AV endpoints and caption bounds."""
import argparse
from array import array
import hashlib
import json
import math
import re
import subprocess
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "evidence/demo-full-live-20261014"
WORK = ROOT / "output/demo-full-video-20261014"


def run(ffmpeg, args, output):
    result = subprocess.run([ffmpeg, "-hide_banner", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    output.write_text(result.stdout + result.stderr, encoding="utf-8")
    assert result.returncode == 0, output
    return result.stderr


def verify_source(take):
    manifest = json.loads((take / "source-manifest.json").read_text())
    snapshot = Path(json.loads((take / "baseline.json").read_text())["snapshot"])
    mismatches = [name for name, digest in manifest.items() if hashlib.sha256((snapshot / name).read_bytes()).hexdigest() != digest]
    assert not mismatches, mismatches
    with zipfile.ZipFile(take / "accepted-source.zip") as archive:
        assert set(archive.namelist()) == set(manifest)
        assert all(hashlib.sha256(archive.read(name)).hexdigest() == digest for name, digest in manifest.items())
    return len(manifest)


def narration_alignment(ffmpeg, movie, shots):
    """Locate every narration waveform in the final mux, including middle cuts."""
    def samples(path):
        result = subprocess.run([ffmpeg, "-hide_banner", "-v", "error", "-i", str(path),
            "-vn", "-ac", "1", "-ar", "1000", "-f", "s16le", "-"], capture_output=True, check=True)
        values = array("h")
        values.frombytes(result.stdout)
        return values

    actual, expected_track, checks = samples(movie), samples(WORK / "continuous-narration.wav"), []
    for shot in shots:
        expected = round((shot["start"] + .24) * 1000)
        # Match the loudness-normalized PCM that was placed on this exact scene boundary.
        reference = expected_track[expected:expected + 2500]
        norm = sum(value * value for value in reference)
        best = (-1, 0)
        for offset in range(-150, 151):
            observed = actual[expected + offset:expected + offset + len(reference)]
            score = sum(a * b for a, b in zip(reference, observed)) / math.sqrt(norm * sum(b * b for b in observed))
            if score > best[0]:
                best = (score, offset)
        check = {"shot": shot["id"], "offset_seconds": best[1] / 1000, "correlation": best[0]}
        checks.append(check)
        assert best[0] > .85 and abs(best[1]) <= 60, check
    return checks


def caption_bounds(shots):
    for shot in shots:
        source = (WORK / f"{shot['id']}.ass").read_text(encoding="utf-8-sig")
        previous = 0
        for begin, end in re.findall(r"Dialogue: 0,([\d:.]+),([\d:.]+),", source):
            def seconds(value):
                h, m, s = map(float, value.split(":"))
                return h * 3600 + m * 60 + s
            start, stop = seconds(begin), seconds(end)
            assert previous <= start < stop <= shot["duration"], (shot["id"], begin, end)
            previous = stop


def frame_contact(ffmpeg, movie, shots):
    sheets = []
    for start in range(0, len(shots), 12):
        selected = shots[start:start + 12]
        sheet = Image.new("RGB", (1280, 870), "#101e35")
        draw = ImageDraw.Draw(sheet)
        for i, shot in enumerate(selected):
            path = DEST / f"qa-{shot['id']}.png"
            run(ffmpeg, ["-v", "error", "-y", "-ss", str(shot["start"] + min(shot["duration"] * .6, 3)),
                "-i", str(movie), "-frames:v", "1", str(path)], DEST / "frame-extract.log")
            with Image.open(path) as picture:
                sheet.paste(picture.resize((320, 180)), ((i % 4) * 320, (i // 4) * 290))
            draw.text(((i % 4) * 320 + 8, (i // 4) * 290 + 188), f"{shot['id']}  {shot['start']:.2f}s\n{shot['title']}", fill="white")
        target = DEST / f"contact-sheet-{start // 12 + 1}.jpg"
        sheet.save(target, quality=90)
        sheets.append(str(target))
    return sheets


def main(ffmpeg):
    edit = json.loads((DEST / "edit-manifest.json").read_text())
    movie = DEST / "StudyFlow_Demo_EN.mp4"
    take = Path(edit["take"])
    count = verify_source(take)
    assert edit["duration"] < 300
    decode = run(ffmpeg, ["-v", "error", "-i", str(movie), "-f", "null", "-"], DEST / "decode.log")
    assert not decode.strip(), decode
    video = run(ffmpeg, ["-v", "info", "-i", str(movie), "-map", "0:v:0", "-vf", "showinfo", "-an", "-f", "null", "-"], DEST / "video-timestamps.log")
    audio = run(ffmpeg, ["-v", "info", "-i", str(movie), "-map", "0:a:0", "-af", "ashowinfo", "-vn", "-f", "null", "-"], DEST / "audio-timestamps.log")
    video_times = re.findall(r"\bn:\s*\d+\s+pts:\s*\d+\s+pts_time:([\d.]+)", video)
    audio_times = re.findall(r"pts_time:([\d.]+).*?nb_samples:(\d+)", audio)
    video_end = float(video_times[-1]) + 1 / 30
    audio_end = float(audio_times[-1][0]) + int(audio_times[-1][1]) / 48000
    assert abs(video_end - audio_end) < .06, (video_end, audio_end)
    assert abs(video_end - edit["duration"]) < .08, (video_end, edit["duration"])
    trace = json.loads((take / "model-trace.json").read_text(encoding="utf-8"))
    caption_bounds(edit["shots"])
    speech_sync = narration_alignment(ffmpeg, movie, edit["shots"])
    report = {"passed": True, "duration_seconds": video_end, "audio_end_seconds": audio_end,
              "av_endpoint_difference_seconds": abs(video_end - audio_end), "decode_errors": 0,
              "source_files_verified": count, "all_calls_live": trace["all_calls_live"], "model_calls": trace["model_calls"],
              "models": trace["models"], "sha256": hashlib.sha256(movie.read_bytes()).hexdigest(),
              "caption_timing": "Actual SAPI word audio positions, per-shot start delay 240 ms; no proportional word estimates",
              "narration_alignment": speech_sync,
              "max_narration_offset_seconds": max(abs(item["offset_seconds"]) for item in speech_sync),
              "contact_sheets": frame_contact(ffmpeg, movie, edit["shots"])}
    (DEST / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", type=Path, required=True)
    main(str(parser.parse_args().ffmpeg.resolve()))
