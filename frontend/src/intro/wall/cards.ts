import type { FeatureId } from "../features";
import { SCREENS_VERSION } from "./screens-version";

export type CardContent = { id: FeatureId; index: number; title: string; tags: string; color: string; lang: "en" | "zh" };

export const CARD_W = 1280;
export const CARD_H = 800;
const TECH = '"Chakra Petch", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** The captured app screen for a feature, from public/intro-assets (see scripts/capture-intro-screens.mjs). */
export function loadScreen(id: FeatureId, lang: "en" | "zh"): Promise<HTMLImageElement | null> {
  const key = `${id}-${lang}`;
  let pending = images.get(key);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = `/intro-assets/screens/${key}.jpg?v=${SCREENS_VERSION}`;
    });
    images.set(key, pending);
  }
  return pending;
}

/**
 * Composes one slab face: the real app screen, darkened towards the bottom, with the feature
 * index, title and tags set in the display face over it.
 */
export function drawCard(canvas: HTMLCanvasElement, card: CardContent, screen: HTMLImageElement | null) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0b1413";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (screen) ctx.drawImage(screen, 0, 0, CARD_W, CARD_H);

  const shade = ctx.createLinearGradient(0, CARD_H * 0.42, 0, CARD_H);
  shade.addColorStop(0, "rgba(3, 9, 9, 0)");
  shade.addColorStop(0.55, "rgba(3, 9, 9, 0.82)");
  shade.addColorStop(1, "rgba(3, 9, 9, 0.96)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const pad = 64;
  ctx.fillStyle = card.color;
  ctx.fillRect(pad, CARD_H - 236, 72, 4);
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 30px ${TECH}`;
  ctx.fillText(`${String(card.index + 1).padStart(2, "0")} / 07`, pad, CARD_H - 186);
  ctx.fillStyle = "#f2fbf8";
  ctx.font = `500 ${card.lang === "zh" ? 76 : 70}px ${TECH}`;
  ctx.fillText(card.lang === "zh" ? card.title : card.title.toUpperCase(), pad, CARD_H - 104, CARD_W - pad * 2);
  ctx.fillStyle = "rgba(220, 240, 234, 0.62)";
  ctx.font = `400 28px ${TECH}`;
  ctx.fillText(card.tags.toUpperCase(), pad, CARD_H - 56, CARD_W - pad * 2);
}
