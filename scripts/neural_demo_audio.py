"""Preserve paragraph speech while mapping provider word times through tempo edits."""
from array import array
import bisect
import json
import math
from pathlib import Path
import re
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "output/demo-neural-video-20261014"
FFMPEG = ROOT / "output/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"
RATE = 48000


def ffmpeg(args, **kwargs):
    return subprocess.run([str(FFMPEG), "-hide_banner", "-v", "error", "-y", *args],
                          cwd=WORK, check=True, **kwargs)


def read_pcm(path):
    with wave.open(str(path)) as track:
        assert track.getparams()[:3] == (1, 2, RATE), path
        return track.readframes(track.getnframes())


def write_pcm(path, data):
    with wave.open(str(path), "wb") as track:
        track.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        track.writeframes(data)


def normalized(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def word_spans(paragraph):
    events, position = [], 0
    for item in paragraph["boundaries"]:
        if item["type"] != "WordBoundary":
            continue
        count = len(normalized(item["text"]))
        events.append({"begin": position, "end": position + count,
                       "start": item["offset"] / 1e7,
                       "stop": (item["offset"] + item["duration"]) / 1e7})
        position += count
    observed = "".join(normalized(e["text"]) for e in paragraph["boundaries"])
    assert observed == normalized(paragraph["spoken_text"]), paragraph["id"]
    return events


def displayed_words(paragraph):
    events, position, words = word_spans(paragraph), 0, []
    for shot in paragraph["shots"]:
        for match in re.finditer(r"\S+", shot["text"]):
            value = match.group()
            end = position + len(normalized(value))
            selected = [event for event in events if event["begin"] < end and event["end"] > position]
            assert selected, (paragraph["id"], value)
            words.append({"text": value, "shot": shot["number"],
                          "raw_start": selected[0]["start"], "raw_end": selected[-1]["stop"]})
            position = end
    assert position == events[-1]["end"], paragraph["id"]
    return words


def quiet_cut(pcm, bounds):
    """Place a tempo change in the quietest 10 ms inside the sentence pause."""
    left, right = bounds
    middle = (left + right) / 2
    candidates = [middle + n / 1000 for n in range(-100, 101, 5)
                  if left <= middle + n / 1000 <= right]
    samples = array("h", pcm)
    def score(seconds):
        center = round(seconds * RATE)
        window = samples[max(0, center - 240):center + 240]
        return sum(v * v for v in window) / max(1, len(window)) + abs(seconds - middle)
    return min(candidates or [middle], key=score)


def tempo_regions(paragraph, words, pcm):
    end, cuts, tempos = len(pcm) / (RATE * 2), [0.0], []
    previous = paragraph["shots"][0]
    tempos.append(previous["tempo"])
    for shot in paragraph["shots"][1:]:
        if shot["tempo"] != previous["tempo"]:
            left = max(w["raw_end"] for w in words if w["shot"] == previous["number"])
            right = min(w["raw_start"] for w in words if w["shot"] == shot["number"])
            assert right >= left, (left, right)
            cuts.append(quiet_cut(pcm, (left, right)))
            tempos.append(shot["tempo"])
        previous = shot
    cuts.append(end)
    return [{"raw_start": a, "raw_end": b, "tempo": tempo}
            for a, b, tempo in zip(cuts, cuts[1:], tempos)]


def tempo_audio(name, regions):
    complete = bytearray()
    for index, region in enumerate(regions, 1):
        path = WORK / f"{name}-tempo-{index:02d}.wav"
        filters = (f"atrim=start={region['raw_start']}:end={region['raw_end']},"
                   f"asetpts=PTS-STARTPTS,atempo={region['tempo']}")
        ffmpeg(["-i", f"{name}-raw.wav", "-af", filters, "-ar", str(RATE), "-ac", "1", str(path)])
        pcm = read_pcm(path)
        region["start"] = len(complete) / (RATE * 2)
        region["duration"] = len(pcm) / (RATE * 2)
        complete.extend(pcm)
    write_pcm(WORK / f"{name}-tempo.wav", complete)
    return bytes(complete)


def warped(seconds, regions):
    index = bisect.bisect_right([region["raw_start"] for region in regions], seconds) - 1
    region = regions[max(0, index)]
    return region["start"] + min(region["duration"], (seconds - region["raw_start"]) / region["tempo"])


def master_paragraph(paragraph):
    name = paragraph["id"]
    ffmpeg(["-i", f"{name}.mp3", "-ar", str(RATE), "-ac", "1", f"{name}-raw.wav"])
    pcm, words = read_pcm(WORK / f"{name}-raw.wav"), displayed_words(paragraph)
    regions = tempo_regions(paragraph, words, pcm)
    tempo_audio(name, regions)
    ffmpeg(["-i", f"{name}-tempo.wav", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar", str(RATE), "-ac", "1", f"{name}.wav"])
    for word in words:
        word["start"], word["end"] = warped(word["raw_start"], regions), warped(word["raw_end"], regions)
    return read_pcm(WORK / f"{name}.wav"), words, regions


def assemble(story):
    chapters, all_words, complete = [], [], bytearray()
    for paragraph in story:
        pcm, words, regions = master_paragraph(paragraph)
        start = len(complete) / (RATE * 2)
        lead, tail = .12, .18
        frames = math.ceil((lead + len(pcm) / (RATE * 2) + tail) * 30)
        complete.extend(bytes(round(lead * RATE) * 2) + pcm)
        complete.extend(bytes(round((start + frames / 30) * RATE) * 2 - len(complete)))
        for word in words:
            word["start"] += start + lead
            word["end"] += start + lead
        all_words.extend(words)
        chapters.append({**paragraph, "start": start, "duration": frames / 30,
                         "audio_start": start + lead, "speech_duration": len(pcm) / (RATE * 2),
                         "tempo_regions": regions})
        print(f"{paragraph['id']}: {frames / 30:.2f}s; timeline {(start + frames / 30):.2f}s", flush=True)
    write_pcm(WORK / "continuous-narration.wav", complete)
    return chapters, all_words
