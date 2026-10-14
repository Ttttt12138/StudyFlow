"""Check cue clocks against screenshots of the same visible UI state before editing."""
import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

from full_demo_scenes import SCENES

ROOT = Path(__file__).resolve().parents[1]


def difference(actual, expected):
    with Image.open(actual) as frame, Image.open(expected) as screenshot:
        size = (720, 450)
        delta = ImageChops.difference(frame.convert("RGB").resize(size), screenshot.convert("RGB").resize(size))
        return sum(ImageStat.Stat(delta).mean) / 3


def align(ffmpeg, take):
    work = ROOT / "output/demo-full-alignment"
    work.mkdir(parents=True, exist_ok=True)
    checks = {}
    for marker, role, *_ in SCENES:
        expected = take / f"{marker}.png"
        if role == "title" or not expected.exists():
            continue
        prefix = "video" if role == "student" else role
        source = json.loads((take / f"{prefix}-source.json").read_text())["path"]
        marks = json.loads((take / f"{prefix}-marks.json").read_text())
        index = next(i for i, m in enumerate(marks) if m["name"] == marker)
        start = marks[index]["seconds"]
        end = marks[index + 1]["seconds"] if index + 1 < len(marks) else start + 6
        candidates = []
        for offset in (.4, 1.0, 2.0, 3.0):
            if start + offset >= end - .3:
                continue
            target = work / f"{marker}-{offset}.png"
            subprocess.run([ffmpeg, "-hide_banner", "-v", "error", "-y", "-ss", str(start + offset), "-i", source,
                            "-frames:v", "1", str(target)], check=True)
            error = difference(target, expected)
            candidates.append({"offset": offset, "mean_pixel_difference": error})
            if error < 4:
                break
        best = min(candidates, key=lambda c: c["mean_pixel_difference"])
        checks[marker] = {**best, "role": role, "screenshot": expected.name, "candidates": candidates}
        print(f"{marker}: offset {best['offset']}, pixel difference {best['mean_pixel_difference']:.2f}", flush=True)
    (take / "shot-alignments.json").write_text(json.dumps(checks, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--take", type=Path, required=True)
    args = parser.parse_args()
    align(str(args.ffmpeg.resolve()), args.take.resolve())
