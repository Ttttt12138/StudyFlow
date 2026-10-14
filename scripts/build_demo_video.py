"""Edit the recorded live journey into the English submission film; no generated app footage."""
import argparse
import hashlib
import json
import math
import re
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "output/demo-video-20261014"
EVIDENCE = ROOT / "evidence/demo-live-20261014"
FONT = Path("C:/Windows/Fonts")
NAVY = "#101E35"
BLUE = "#71ACFF"
WHITE = "#F7F9FC"
MUTED = "#B1C2D9"

# Source ranges are bounded by marks from the real browser recording.
SCENES = [
    ("intro", None, None, "LIVE AI DEMONSTRATION", "Know the cost.\nPlan the gap.", "StudyFlow", "International Track / Topic C",
     "StudyFlow helps students compare the cost of studying abroad, then plan how to cover a funding gap. This demonstration uses live AI guidance and simulated financial transactions."),
    ("opening", "opening", "prompt-1", "01 / START WITH COSTS", "One conversation", "10 schools", "Sourced sample catalogue",
     "We start in the English student workspace. The main action is a price question. Students can compare schools before providing financial information."),
    ("compare", "prompt-1", "prompt-2", "02 / COMPARE", "Whole-course\ncosts", "4 schools", "Duration and currency shown",
     "We ask the live model to compare four universities in Thailand. It returns whole-course estimates in Thai baht, with each course duration visible. PSU Phuket is the lowest current estimate in this comparison. These are sourced sample estimates, which students must check with the university."),
    ("funds", "prompt-2", "prompt-3", "03 / PLAN THE GAP", "Context is\nremembered", "10,000 THB", "Declared available study funds",
     "Next, we choose PSU Phuket and declare ten thousand baht in available study funds. The assistant saves this information and opens the funding options. The full-course estimate is one million, thirteen thousand, eight hundred baht. The resulting funding gap is one million, three thousand, eight hundred baht."),
    ("ceiling", "prompt-3", "prompt-4", "04 / EXPLAIN", "Guidance before\ncommitment", "1,003,800", "THB simulated gap-based ceiling",
     "We ask how much can be borrowed, without submitting an application. The live answer uses the server's pre-check result. This is a simulated ceiling based on the funding gap. It is not a bank offer or an assessment of the family's ability to repay."),
    ("safety", "prompt-4", "loan-selection", "05 / CONTROL", "No transfer\nfrom this request", "User control", "Observed in this recorded turn",
     "We also ask the assistant to skip confirmation and transfer money before enrollment. In this recorded response, it defers the transfer. No money tool executes and the plan remains a draft."),
    ("quote", "loan-selection", "confirm-plan", "06 / CHOOSE A LOAN", "Review the\nrepayment plan", "20,000 THB", "4.5% example rate / 60 months",
     "The student chooses a twenty thousand baht commercial study loan example, at four point five percent over sixty months. The server calculates the schedule and a monthly installment of three hundred seventy-two baht and eighty-six satang. This loan covers only part of the funding gap."),
    ("confirm", "confirm-plan", "documents", "07 / CONFIRM", "A deliberate\napplication", "One approval", "Simulated application",
     "The student reviews the confirmation dialog and explicitly confirms the plan and application. The simulated application is approved. The assistant has not submitted it on the student's behalf."),
    ("documents", "documents", "sign-dialog", "08 / PREPARE", "Review the\nchecklist", "3 items", "Declarations, not verified uploads",
     "Before signing, the student completes the displayed document checklist. These are demo declarations. They do not represent verification of uploaded identity, admission, or financial documents."),
    ("sign", "sign-dialog", "signed", "09 / SIGN", "Confirm the\nsimulated contract", "Explicit consent", "Student signs in the dialog",
     "Signing requires another explicit confirmation. The resulting loan schedules tuition payments to the school, rather than crediting the borrowed amount to the student's wallet."),
    ("payout", "signed", "repayment-ready", "10 / FOLLOW THE LOAN", "School-directed\npayouts", "20,000 THB", "Total scheduled school payout",
     "The signed state shows the school's payout schedule and the next repayment. For the repayment demonstration, we advance the isolated demo clock and add a separate ten thousand baht synthetic wallet top-up. No real funds are received or transferred."),
    ("repay", "repayment-ready", "repaid", "11 / AUTHORIZE", "Repayment needs\nconfirmation", "Password check", "Amount-bound authorization",
     "The student reviews the first installment and confirms repayment. A password check is required before the server executes this simulated payment. The live model does not type the password or authorize the transaction."),
    ("done", "repaid", "end", "12 / VERIFY", "The first\ninstallment is paid", "372.86 THB", "Recorded status: PAID",
     "The first installment is now marked paid. The recording is backed by browser assertions and saved model-call traces, linking the live conversation to the actual application state."),
    ("outro", None, None, "STUDYFLOW / INTERNATIONAL TRACK", "Cost clarity.\nInformed choices.\nUser control.", "Live AI. Simulated funds.", "English demonstration / 14 October 2026",
     "StudyFlow connects cost comparison, funding guidance, and a confirmed loan journey. Live AI explains the options. The server calculates the amounts, and the student confirms the financial actions."),
]


def font(size, bold=False):
    return ImageFont.truetype(str(FONT / ("arialbd.ttf" if bold else "arial.ttf")), size)


def wrapped(draw, text, max_width, size):
    lines = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split():
            candidate = f"{line} {word}".strip()
            if line and draw.textlength(candidate, font=font(size)) > max_width:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
    return "\n".join(lines)


def draw_text(draw, xy, text, size, color=WHITE, bold=False, width=None):
    value = wrapped(draw, text, width, size) if width else text
    draw.multiline_text(xy, value, font=font(size, bold), fill=color, spacing=14)


def draw_title(scene):
    image = Image.new("RGB", (1920, 1080), NAVY)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((116, 120, 192, 196), radius=22, fill="#1876FF")
    draw.line((136, 161, 149, 145, 160, 163, 175, 156), fill=WHITE, width=5)
    draw_text(draw, (216, 132), "StudyFlow", 48, bold=True)
    draw_text(draw, (120, 255), scene[3], 24, BLUE)
    draw_text(draw, (115, 330), scene[4], 92, bold=True)
    draw_text(draw, (120, 731), scene[6], 29, MUTED)
    draw.rounded_rectangle((120, 810, 1440, 900), radius=16, fill="#20334E")
    draw_text(draw, (148, 835), "LIVE MODEL CALLS  /  SIMULATED FINANCIAL TRANSACTIONS", 28)
    draw_text(draw, (1530, 135), "ENGLISH\nDEMO", 32, MUTED)
    return image


def draw_frame(scene, index):
    image = Image.new("RGB", (1920, 1080), NAVY)
    draw = ImageDraw.Draw(image)
    draw_text(draw, (36, 18), "StudyFlow", 26, bold=True)
    draw_text(draw, (218, 24), "LIVE AI GUIDANCE  /  SIMULATED FUNDS", 18, MUTED)
    draw_text(draw, (1485, 24), "ENGLISH DEMO  |  14 OCT 2026", 18, MUTED)
    draw.rounded_rectangle((32, 62, 1480, 970), radius=8, fill="#D9E3F1")
    draw_text(draw, (1515, 90), scene[3], 20, BLUE)
    draw_text(draw, (1515, 148), scene[4], 38, bold=True, width=370)
    draw.line((1515, 320, 1875, 320), fill="#354966", width=2)
    draw_text(draw, (1515, 361), scene[5], 39, bold=True, width=370)
    draw_text(draw, (1515, 470), scene[6], 25, MUTED, width=350)
    draw_text(draw, (1515, 704), "Recorded in the app\nReal model responses\nUser-confirmed actions", 24, MUTED)
    draw_text(draw, (1515, 870), "Edited for pacing.\nIdle waits may be shortened.", 20, MUTED)
    for step in range(1, 13):
        x = 1515 + (step - 1) * 30
        draw.rounded_rectangle((x, 944, x + 22, 950), radius=3, fill=BLUE if step <= index else "#354966")
    return image


def prepare():
    WORK.mkdir(parents=True, exist_ok=True)
    narration = []
    for index, scene in enumerate(SCENES):
        image = draw_title(scene) if scene[1] is None else draw_frame(scene, index)
        image.save(WORK / f"{scene[0]}.png")
        narration.append({"id": scene[0], "text": scene[7], "voice": "Microsoft Zira Desktop"})
    (WORK / "narration.json").write_text(json.dumps(narration, indent=2), encoding="utf-8")
    print(f"Prepared {len(SCENES)} scenes in {WORK}")


def timestamp(seconds):
    total = round(seconds * 1000)
    return f"{total // 3600000:02}:{total // 60000 % 60:02}:{total // 1000 % 60:02},{total % 1000:03}"


def captions(text, duration, offset=0):
    # Keep captions short and synchronized to the spoken text by word proportion.
    chunks = []
    for sentence in re.split(r"(?<=[.!?]) +", text):
        words = sentence.split()
        while words:
            size = min(13, len(words))
            chunks.append(" ".join(words[:size]))
            words = words[size:]
    total_words = sum(len(c.split()) for c in chunks)
    current = offset
    rows = []
    for chunk in chunks:
        end = current + duration * len(chunk.split()) / total_words
        rows.append((current, end, chunk))
        current = end
    return rows


def write_srt(path, rows):
    path.write_text("\n\n".join(f"{i}\n{timestamp(a)} --> {timestamp(b)}\n{text}"
                                  for i, (a, b, text) in enumerate(rows, 1)) + "\n", encoding="utf-8")


def write_ass(path, rows):
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,32,&H00FFFFFF,&H00FFFFFF,&H00351E10,&H00351E10,0,0,0,0,100,100,0,0,1,1,0,2,80,80,27,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    def ass_time(value):
        return timestamp(value)[1:-1].replace(",", ".")
    events = [f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Default,,0,0,0,,{text}" for a, b, text in rows]
    path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")


def source_ranges(scene, marks):
    # Prompt marks follow typing, and dialog marks follow opening: stop before that next action.
    next_action = scene[2].startswith("prompt-") or scene[2] in {"confirm-plan", "sign-dialog"}
    start = marks[scene[1]] + 0.25
    end = marks[scene[2]] - (0.8 if next_action else 0.08)
    if scene[1].startswith("prompt-"):
        answer = marks[scene[1].replace("prompt", "answer")]
        if answer - start > 6:
            return [(start, start + 3.3), (answer - 0.25, end)]
    return [(start, end)]


def encode_scene(ffmpeg, source, scene, marks, index):
    name = scene[0]
    with wave.open(str(WORK / f"{name}.wav")) as audio:
        spoken = audio.getnframes() / audio.getframerate()
    ranges = source_ranges(scene, marks) if scene[1] else []
    footage = sum(b - a for a, b in ranges)
    duration = math.ceil(max(spoken + 0.6, footage) * 30) / 30
    rows = captions(scene[7], spoken)
    write_srt(WORK / f"{name}.srt", rows)
    write_ass(WORK / f"{name}.ass", rows)
    inputs = ["-i", str(source)] if ranges else []
    inputs += ["-loop", "1", "-framerate", "30", "-i", f"{name}.png", "-i", f"{name}.wav"]
    filters = []
    if ranges:
        for part, (start, end) in enumerate(ranges):
            filters.append(f"[0:v]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS[v{part}]")
        joined = "".join(f"[v{n}]" for n in range(len(ranges)))
        filters.append(f"{joined}concat=n={len(ranges)}:v=1:a=0,fps=30,scale=1440:900,setsar=1,tpad=stop_mode=clone:stop_duration={duration}[screen]")
        filters.append("[1:v][screen]overlay=36:66:shortest=1[frame]")
    else:
        filters.append("[0:v]null[frame]")
    filters.append(f"[frame]ass={name}.ass,format=yuv420p[video]")
    audio_input = 2 if ranges else 1
    filters.append(f"[{audio_input}:a]loudnorm=I=-16:TP=-1.5:LRA=11,apad[audio]")
    args = [str(ffmpeg), "-y", "-hide_banner", "-loglevel", "warning", *inputs, "-filter_complex", ";".join(filters),
            "-map", "[video]", "-map", "[audio]", "-t", str(duration), "-c:v", "libx264", "-preset", "fast",
            "-crf", "19", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", f"{name}.mp4"]
    with (WORK / f"{name}-encode.log").open("w", encoding="utf-8") as log:
        subprocess.run(args, cwd=WORK, stdout=log, stderr=log, check=True)
    print(f"{index + 1}/{len(SCENES)} {name}: {duration:.2f}s", flush=True)
    return {"id": name, "duration": duration, "audio_seconds": spoken, "source_ranges": ranges, "captions": rows}


def render(ffmpeg, take):
    results = json.loads((take / "browser.json").read_text(encoding="utf-8"))
    trace = json.loads((take / "model-trace.json").read_text(encoding="utf-8"))
    english = next(j for j in results["journeys"] if j["language"] == "en-US")
    assert trace["all_calls_live"] and english["firstInstallment"] == "PAID"
    assert english["principal"] == "20000.00" and english["firstAmount"] == "372.86"
    raw = json.loads((take / "video-source.json").read_text(encoding="utf-8"))
    marks = {v["name"]: v["seconds"] for v in json.loads((take / "video-marks.json").read_text())}
    clips = [encode_scene(ffmpeg, Path(raw["path"]), s, marks, i) for i, s in enumerate(SCENES)]
    elapsed, all_captions = 0, []
    for clip in clips:
        clip["start"] = elapsed
        all_captions.extend((a + elapsed, b + elapsed, text) for a, b, text in clip.pop("captions"))
        elapsed += clip["duration"]
    assert elapsed < 300, f"Submission limit exceeded: {elapsed:.2f}s"
    write_srt(EVIDENCE / "StudyFlow_Demo_EN.srt", all_captions)
    (WORK / "concat.txt").write_text("".join(f"file '{s[0]}.mp4'\n" for s in SCENES), encoding="utf-8")
    destination = EVIDENCE / "StudyFlow_Demo_EN.mp4"
    subprocess.run([str(ffmpeg), "-y", "-hide_banner", "-loglevel", "warning", "-f", "concat", "-safe", "0",
                    "-i", "concat.txt", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
                    "-af", "aresample=async=1:first_pts=0", "-movflags", "+faststart", str(destination)], cwd=WORK, check=True)
    manifest = {"duration_seconds": elapsed, "resolution": "1920x1080", "fps": 30, "language": "en",
                "voice": "Microsoft Zira Desktop (synthetic narration)", "raw_video": str(Path(raw["path"]).relative_to(ROOT)),
                "editing": "Actual browser footage; idle wait cuts and final-frame holds; no substituted AI answers or UI results.",
                "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "scenes": clips}
    (EVIDENCE / "edit-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Final film: {destination} ({elapsed:.2f}s)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "render"])
    parser.add_argument("--ffmpeg", type=Path)
    parser.add_argument("--take", type=Path, default=EVIDENCE / "take-04")
    args = parser.parse_args()
    if args.action == "prepare":
        prepare()
    else:
        if not args.ffmpeg or not args.ffmpeg.is_file():
            parser.error("--ffmpeg must point to an installed FFmpeg with libx264 and libass")
        render(args.ffmpeg.resolve(), args.take.resolve())
