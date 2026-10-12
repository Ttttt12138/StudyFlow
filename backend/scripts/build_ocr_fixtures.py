"""Build clearly synthetic Chinese/English raster documents for live OCR acceptance."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CASES = {
    "en": [
        "SYNTHETIC DEMO - NOT A REAL INVOICE",
        "StudyFlow Demo School",
        "Invoice: DEMO-EN-001",
        "Tuition: THB 10000.00",
        "Due date: 2026-11-10",
    ],
    "zh": [
        "合成演示文件：非真实发票",
        "示例学校",
        "发票号：DEMO-ZH-001",
        "学费：10000.00 泰铢",
        "截止日期：2026年11月10日",
    ],
    "zh-en": [
        "合成演示 SYNTHETIC DEMO",
        "示例学校 Demo School",
        "发票 Invoice: DEMO-MIX-001",
        "学费 Tuition: THB 10000.00",
        "截止日期 Due date: 2026-11-10",
    ],
}


def build(destination, font_path):
    destination.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(font_path), 36)
    manifest = {"version": "ocr-demo-v1", "synthetic": True, "files": []}
    for language, lines in CASES.items():
        image = Image.new("RGB", (1400, 800), "white")
        draw = ImageDraw.Draw(image)
        for index, line in enumerate(lines):
            draw.text((50, 60 + 110 * index), line, font=font, fill="black")
        for extension in ("png", "pdf"):
            path = destination / f"invoice-{language}.{extension}"
            image.save(path)
            manifest["files"].append(
                {
                    "path": path.name,
                    "kind": "pdf" if extension == "pdf" else "image",
                    "language": language,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "expected_tokens": [
                        "10000.00",
                        "DEMO-ZH-001"
                        if language == "zh"
                        else "DEMO-EN-001"
                        if language == "en"
                        else "DEMO-MIX-001",
                        "2026年11月10日" if language == "zh" else "2026-11-10",
                    ],
                }
            )
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--font", type=Path, required=True, help="Local Chinese/English font"
    )
    parser.add_argument("--output", type=Path, default=Path("examples/ocr/v1"))
    args = parser.parse_args()
    build(args.output, args.font)
