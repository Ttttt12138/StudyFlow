"""Render short, word-timed narration over genuine accepted browser recordings."""
import argparse
import hashlib
import json
import math
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from full_demo_scenes import SCENES

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "output/demo-full-video-20261014"
DEST = ROOT / "evidence/demo-full-live-20261014"
NAVY, WHITE, BLUE, MUTED = "#101e35", "#f7f9fc", "#71acff", "#b1c2d9"


def font(size, bold=False):
    return ImageFont.truetype("C:/Windows/Fonts/" + ("arialbd.ttf" if bold else "arial.ttf"), size)


def write(draw, point, value, size, color=WHITE, width=350, bold=False):
    lines, line = [], ""
    for word in value.split():
        candidate = (line + " " + word).strip()
        if line and draw.textlength(candidate, font=font(size, bold)) > width:
            lines.append(line)
            line = word
        else:
            line = candidate
    lines.append(line)
    draw.multiline_text(point, "\n".join(lines), font=font(size, bold), fill=color, spacing=12)


def frame(scene, index):
    marker, role, chapter, title, _ = scene
    canvas = Image.new("RGB", (1920, 1080), NAVY)
    draw = ImageDraw.Draw(canvas)
    write(draw, (26, 13), "StudyFlow", 25, bold=True)
    write(draw, (205, 18), "LIVE AI / SIMULATED FINANCIAL TRANSACTIONS", 18, MUTED, 1000)
    if role == "title":
        write(draw, (120, 260), chapter, 30, BLUE, 1600)
        write(draw, (115, 350), title, 90, WHITE, 1550, True)
        write(draw, (120, 700), "International Track · Topic C", 32, MUTED, 1200)
        write(draw, (120, 770), "Current interface · Real model calls · Explicit user consent", 29, MUTED, 1600)
    else:
        write(draw, (1505, 90), chapter, 23, BLUE)
        write(draw, (1505, 150), title, 39, WHITE, 365, True)
        draw.line((1505, 365, 1870, 365), fill="#354966", width=2)
        write(draw, (1505, 400), "Recorded in the app", 26, WHITE)
        write(draw, (1505, 460), "Live AI guidance. Simulated funds.", 25, MUTED)
        write(draw, (1505, 725), "Waiting time shortened. Full acceptance footage retained.", 22, MUTED)
        write(draw, (1505, 895), f"{index:02d} / {len(SCENES):02d}", 25, BLUE)
    return canvas


def prepare():
    WORK.mkdir(parents=True, exist_ok=True)
    narration = []
    for index, scene in enumerate(SCENES, 1):
        name = f"shot-{index:02d}"
        frame(scene, index).save(WORK / f"{name}.png")
        narration.append({"id": name, "text": scene[-1]})
    (WORK / "narration.json").write_text(json.dumps(narration, indent=2), encoding="utf-8")
    print(f"Prepared {len(SCENES)} narration lines")


def duration(path):
    with wave.open(str(path)) as audio:
        return audio.getnframes() / audio.getframerate()


def stamp(seconds, ass=False):
    units = round(seconds * (100 if ass else 1000))
    fraction = units % (100 if ass else 1000)
    secs = units // (100 if ass else 1000)
    return f"{secs // 3600:01d}:{secs // 60 % 60:02d}:{secs % 60:02d}.{fraction:02d}" if ass else f"{secs // 3600:02d}:{secs // 60 % 60:02d}:{secs % 60:02d},{fraction:03d}"


def subtitles(name, text, audio_seconds):
    words = json.loads((WORK / f"{name}.words.json").read_text(encoding="utf-8-sig"))
    assert words and all(words[i]["seconds"] <= words[i + 1]["seconds"] for i in range(len(words) - 1))
    groups, start = [], 0
    while start < len(words):
        end = min(start + 9, len(words))
        if len(words) - end <= 2:
            end = len(words)
        for index in range(start + 3, end):
            last = words[index - 1]["position"] + words[index - 1]["length"]
            if text[last:last + 1] in ".?!;":
                end = index
                break
        end_pos = words[end]["position"] if end < len(words) else len(text)
        line = text[words[start]["position"]:end_pos].strip()
        begin = words[start]["seconds"] + .24
        finish = (words[end]["seconds"] if end < len(words) else audio_seconds) + .24
        groups.append((begin, finish, line))
        start = end
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,32,&H00FFFFFF,&H00FFFFFF,&H00101E35,&H00101E35,0,0,0,0,100,100,0,0,1,1,0,2,48,48,28,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = [f"Dialogue: 0,{stamp(a, True)},{stamp(b, True)},Default,,0,0,0,,{line}" for a, b, line in groups]
    (WORK / f"{name}.ass").write_text(header + "\n".join(events), encoding="utf-8-sig")
    return groups


def recorded_range(take, scene):
    marker, role = scene[:2]
    if role == "title":
        return None
    marks_name = "video-marks.json" if role == "student" else f"{role}-marks.json"
    source_name = "video-source.json" if role == "student" else f"{role}-source.json"
    marks = json.loads((take / marks_name).read_text())
    position = next(i for i, item in enumerate(marks) if item["name"] == marker)
    align_path = take / "shot-alignments.json"
    alignment = json.loads(align_path.read_text()).get(marker, {}) if align_path.exists() else {}
    begin = marks[position]["seconds"] + alignment.get("offset", .4)
    next_at = marks[position + 1]["seconds"] if position + 1 < len(marks) else begin + 6
    # Keep each sentence on its own recorded state; do not include the next click
    # just because the following editorial marker was added several actions later.
    holds = {"cost-living": 4, "comparison-CNY": 4, "comparison-USD": 4,
             "comparison-THB": 4, "adjust-cost-assumption": 3, "expense-undone": 3,
             "credit-password": 4, "credit-restored": 4, "statement-tampering-rejected": 4,
             "precheck": 7, "loan-quote": 9, "documents": 5, "signed": 8,
             "password-check": 7, "repaid": 9}
    hold_end = marks[position]["seconds"] + holds.get(marker, 6)
    length = max(.25, min(6.5, hold_end - begin - .2, next_at - begin - .15))
    source = Path(json.loads((take / source_name).read_text())["path"])
    assert source.exists(), source
    return {"path": str(source), "start": begin, "available": length, "marker": marker}


def render_shot(ffmpeg, name, scene, source):
    seconds = duration(WORK / f"{name}.wav")
    length = math.ceil((seconds + .55) * 30) / 30
    groups = subtitles(name, scene[-1], seconds)
    cmd = [ffmpeg, "-hide_banner", "-v", "error", "-y", "-loop", "1", "-i", f"{name}.png"]
    if source:
        cmd += ["-ss", str(source["start"]), "-t", str(source["available"]), "-i", source["path"]]
        filters = f"[1:v]fps=30,setpts=PTS-STARTPTS,scale=1440:900,tpad=stop_mode=clone:stop_duration={length}[screen];[0:v][screen]overlay=24:58,subtitles={name}.ass[v]"
        audio_index = 2
    else:
        filters, audio_index = f"[0:v]subtitles={name}.ass[v]", 1
    cmd += ["-i", f"{name}.wav", "-filter_complex", filters, "-map", "[v]", "-map", f"{audio_index}:a",
            "-af", "adelay=240|240,apad,loudnorm=I=-16:TP=-1.5:LRA=11", "-t", str(length),
            "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", f"{name}.mp4"]
    subprocess.run(cmd, cwd=WORK, check=True)
    return length, groups


def continuous_narration(ffmpeg, rows):
    # Concatenating separately encoded AAC clips accumulates encoder padding.
    # Place original PCM speech on the exact 48 kHz / 30 fps timeline, then encode once.
    target = WORK / "continuous-narration.wav"
    with wave.open(str(target), "wb") as track:
        track.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
        for row in rows:
            voice = subprocess.run([ffmpeg, "-hide_banner", "-v", "error", "-i", str(WORK / f"{row['id']}.wav"),
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "1", "-f", "s16le", "-"],
                capture_output=True, check=True).stdout
            pcm = bytes(round(.24 * 48000) * 2) + voice
            length = round(row["duration"] * 48000) * 2
            assert len(pcm) <= length, row["id"]
            track.writeframes(pcm + bytes(length - len(pcm)))
    return target


def mux(ffmpeg, rows):
    (WORK / "concat.txt").write_text("\n".join(f"file '{row['id']}.mp4'\nduration {row['duration']:.6f}" for row in rows))
    narration = continuous_narration(ffmpeg, rows)
    output = DEST / "StudyFlow_Demo_EN.mp4"
    subprocess.run([ffmpeg, "-hide_banner", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "concat.txt",
        "-i", str(narration), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", str(output)], cwd=WORK, check=True)
    return output


def render(ffmpeg, take):
    trace = json.loads((take / "model-trace.json").read_text(encoding="utf-8"))
    browser = json.loads((take / "browser.json").read_text(encoding="utf-8"))
    assert trace["all_calls_live"] and browser["journeys"], "Only accepted live footage"
    rows, cues, total = [], [], 0
    for index, scene in enumerate(SCENES, 1):
        name = f"shot-{index:02d}"
        source = recorded_range(take, scene)
        length, groups = render_shot(ffmpeg, name, scene, source)
        rows.append({"id": name, "start": total, "duration": length, "source": source, "chapter": scene[2], "title": scene[3], "narration": scene[-1]})
        cues.extend((a + total, b + total, text) for a, b, text in groups)
        total += length
        print(f"{name} rendered; cumulative {total:.2f}s", flush=True)
    assert total < 300, total
    output = mux(ffmpeg, rows)
    srt = "\n\n".join(f"{i}\n{stamp(a)} --> {stamp(b)}\n{text}" for i, (a, b, text) in enumerate(cues, 1))
    (DEST / "StudyFlow_Demo_EN.srt").write_text(srt + "\n", encoding="utf-8")
    (DEST / "edit-manifest.json").write_text(json.dumps({"duration": total, "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "take": str(take), "sync": "SAPI SpeakProgress AudioPosition word times; 240ms audio lead-in; separate source range per sentence", "shots": rows}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "render", "mux"])
    parser.add_argument("--take", type=Path)
    parser.add_argument("--ffmpeg", type=Path)
    args = parser.parse_args()
    if args.action == "prepare":
        prepare()
    elif args.action == "mux":
        manifest = json.loads((DEST / "edit-manifest.json").read_text())
        output = mux(str(args.ffmpeg.resolve()), manifest["shots"])
        manifest["sha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
        manifest["audio_assembly"] = "Continuous PCM on exact scene boundaries, encoded to AAC once"
        (DEST / "edit-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    else:
        render(str(args.ffmpeg.resolve()), args.take.resolve())
