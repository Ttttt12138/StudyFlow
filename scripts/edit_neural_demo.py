"""Re-edit accepted footage around continuous paragraph narration and word cues."""
import argparse
import hashlib
import json
from pathlib import Path

from build_full_demo_video import frame, stamp
from full_demo_scenes import SCENES
from neural_demo_audio import WORK, ROOT, ffmpeg, assemble
from neural_demo_story import TITLES

DEST = WORK / "candidate"
PRIOR = ROOT / "evidence/demo-full-live-20261014/formal-zira-previous-20261014"
ASS_HEADER = """[Script Info]
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


def scene_timeline(chapters, words):
    original = json.loads((PRIOR / "edit-manifest.json").read_text(encoding="utf-8"))
    shots = []
    for chapter in chapters:
        starts = [chapter["start"]]
        for shot in chapter["shots"][1:]:
            first = next(word for word in words if word["shot"] == shot["number"])
            previous = max(word["end"] for word in words if word["shot"] == shot["number"] - 1)
            starts.append(round(max(previous, first["start"] - .09) * 30) / 30)
        ends = starts[1:] + [chapter["start"] + chapter["duration"]]
        for shot, start, end in zip(chapter["shots"], starts, ends):
            prior = original["shots"][shot["number"] - 1]
            shots.append({**prior, "title": TITLES[shot["number"] - 1], "start": start, "duration": round((end - start) * 30) / 30,
                          "narration": shot["text"], "paragraph": chapter["id"], "tempo": shot["tempo"]})
    assert len(shots) == 46 and min(s["duration"] for s in shots) >= 2, [(s["id"], s["duration"]) for s in shots]
    return original["take"], shots


def caption_groups(words, shots):
    groups = []
    for number, shot in enumerate(shots, 1):
        items = [word for word in words if word["shot"] == number]
        index = 0
        while index < len(items):
            stop = min(index + 9, len(items))
            if len(items) - stop <= 2:
                stop = len(items)
            for j in range(index + 3, stop):
                if items[j - 1]["text"][-1] in ".?!;:":
                    stop = j
                    break
            text = " ".join(item["text"] for item in items[index:stop])
            end = min(items[stop - 1]["end"] + .10, shot["start"] + shot["duration"])
            if stop < len(items):
                end = min(end, items[stop]["start"])
            groups.append({"shot": shot["id"], "start": max(items[index]["start"], shot["start"]),
                           "end": end, "text": text})
            index = stop
    assert all(0 <= g["start"] < g["end"] for g in groups)
    return groups


def save_subtitles(groups):
    ass = [f"Dialogue: 0,{stamp(g['start'], True)},{stamp(g['end'], True)},Default,,0,0,0,,{g['text']}" for g in groups]
    srt = [f"{i}\n{stamp(g['start'])} --> {stamp(g['end'])}\n{g['text']}" for i, g in enumerate(groups, 1)]
    (WORK / "captions.ass").write_text(ASS_HEADER + "\n".join(ass) + "\n", encoding="utf-8-sig")
    (DEST / "StudyFlow_Demo_EN.srt").write_text("\n\n".join(srt) + "\n", encoding="utf-8")


def prepare():
    DEST.mkdir(parents=True, exist_ok=True)
    story = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(WORK.glob("chapter-??.tts.json"))]
    assert len(story) == 12
    chapters, words = assemble(story)
    take, shots = scene_timeline(chapters, words)
    groups = caption_groups(words, shots)
    save_subtitles(groups)
    duration = sum(shot["duration"] for shot in shots)
    assert duration < 300, duration
    for index, scene in enumerate(SCENES, 1):
        updated = (*scene[:3], TITLES[index - 1], scene[4])
        frame(updated, index).save(WORK / f"shot-{index:02d}.png")
    manifest = {"duration": duration, "take": take, "shots": shots, "paragraphs": chapters,
                "word_timing": words, "captions": groups,
                "sync": "Microsoft WordBoundary events mapped through local tempo regions; cuts on 30 fps sentence anchors",
                "audio_assembly": "Twelve continuous paragraphs; PCM assembled once on the complete timeline, then one AAC encode"}
    (DEST / "edit-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Prepared {len(shots)} shots, {len(groups)} captions, {duration:.2f}s; shortest {min(s['duration'] for s in shots):.2f}s")


def render_shot(shot):
    name, source = shot["id"], shot["source"]
    args = ["-loop", "1", "-i", f"{name}.png"]
    if source:
        args += ["-ss", str(source["start"]), "-t", str(source["available"]), "-i", source["path"]]
        filters = (f"[1:v]fps=30,setpts=PTS-STARTPTS,scale=1440:900,"
                   f"tpad=stop_mode=clone:stop_duration={shot['duration']}[screen];[0:v][screen]overlay=24:58[v]")
    else:
        filters = "[0:v]null[v]"
    args += ["-filter_complex", filters, "-map", "[v]", "-an", "-frames:v", str(round(shot["duration"] * 30)),
             "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", f"{name}.mp4"]
    ffmpeg(args)
    print(f"Rendered {name}: {shot['duration']:.2f}s", flush=True)


def mux(manifest):
    (WORK / "concat.txt").write_text("\n".join(f"file '{shot['id']}.mp4'" for shot in manifest["shots"]), encoding="utf-8")
    output = DEST / "StudyFlow_Demo_EN.mp4"
    ffmpeg(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-i", "continuous-narration.wav",
            "-map", "0:v:0", "-map", "1:a:0", "-vf", "subtitles=captions.ass", "-r", "30",
            "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(output)])
    manifest["sha256"] = hashlib.sha256(output.read_bytes()).hexdigest()
    (DEST / "edit-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Candidate: {output} ({manifest['duration']:.2f}s)", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "render", "mux"])
    action = parser.parse_args().action
    if action == "prepare":
        prepare()
    else:
        edit = json.loads((DEST / "edit-manifest.json").read_text(encoding="utf-8"))
        if action == "render":
            for shot in edit["shots"]:
                render_shot(shot)
        mux(edit)
