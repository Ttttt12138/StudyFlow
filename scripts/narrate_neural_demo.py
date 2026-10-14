"""Send the explicitly authorized English narration to Microsoft online TTS."""
import argparse
import asyncio
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys

from neural_demo_story import paragraphs

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "output/demo-neural-video-20261014"
VOICE = {"voice": "en-US-AvaNeural", "rate": "-10%", "pitch": "+0Hz", "volume": "+0%"}


async def synthesize(client, paragraph):
    path = WORK / f"{paragraph['id']}.mp3"
    metadata = WORK / f"{paragraph['id']}.tts.json"
    key = hashlib.sha256((paragraph["spoken_text"] + json.dumps(VOICE)).encode()).hexdigest()
    if metadata.exists() and path.exists():
        old = json.loads(metadata.read_text(encoding="utf-8"))
        if old["request_sha256"] == key and old["audio_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest():
            return old
    speech = client.Communicate(paragraph["spoken_text"], **VOICE, boundary="WordBoundary",
                               connect_timeout=20, receive_timeout=60)
    events = []
    with path.open("wb") as audio:
        async for chunk in speech.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            else:
                events.append(chunk)
    assert path.stat().st_size > 5000 and events, paragraph["id"]
    result = {**paragraph, **VOICE, "request_sha256": key, "boundaries": events,
              "audio_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    metadata.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


async def main(deps):
    sys.path.insert(0, str(deps.resolve()))
    import edge_tts
    WORK.mkdir(parents=True, exist_ok=True)
    story = paragraphs()
    assert [shot["number"] for part in story for shot in part["shots"]] == list(range(1, 47))
    (WORK / "story.json").write_text(json.dumps(story, indent=2), encoding="utf-8")
    (WORK / "authorized-english-narration.txt").write_text(
        "\n\n".join(part["spoken_text"] for part in story) + "\n", encoding="utf-8")
    for part in story:
        await asyncio.wait_for(synthesize(edge_tts, part), timeout=120)
        print(f"{part['id']}: complete ({len(part['text'].split())} words)", flush=True)
    (WORK / "speech-service.json").write_text(json.dumps({
        "provider": "Microsoft Edge online neural TTS", "client": "edge-tts",
        "client_version": importlib.metadata.version("edge-tts"), **VOICE,
        "authorization": "User explicitly authorized sending the English script to Microsoft on 2026-10-14",
        "outbound_content": "Only the English narration text; no credentials, screenshots or recordings",
        "paragraph_count": len(story), "normal_post_tempo": 1.20, "numeric_sentence_post_tempo": 1.12,
        "brand_pronunciation": "Study Flow", "currency_pronunciation": "Thai baht; Chinese yuan; U.S. dollars",
        "numbers": "Written out in English; selected numeric sentences slightly slower"
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--deps", type=Path, required=True)
    asyncio.run(main(parser.parse_args().deps))
