import type { FeatureId } from "../features";
import { ART_H, ART_W, TECH, drawIllustration, rgba } from "./illustrations";

export type CardContent = { id: FeatureId; index: number; title: string; tags: string; color: string; lang: "en" | "zh" };

export const CARD_W = 1280;
export const CARD_H = 800;
const COUNT = 7;

/**
 * Composes one slab face: a dark field lit in the feature's accent, the index and title along
 * the top, the feature's drawn artwork in the middle and its tags with a step marker below.
 */
export function drawCard(canvas: HTMLCanvasElement, card: CardContent) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;
  const c = card.color;

  const field = ctx.createLinearGradient(0, 0, 0, CARD_H);
  field.addColorStop(0, "#0a1614");
  field.addColorStop(1, "#050b0a");
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const light = ctx.createRadialGradient(CARD_W * 0.7, CARD_H * 0.38, 0, CARD_W * 0.7, CARD_H * 0.38, CARD_W * 0.62);
  light.addColorStop(0, rgba(c, 0.2));
  light.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = "rgba(220, 240, 234, 0.05)";
  for (let y = 20; y < CARD_H; y += 40) for (let x = 20; x < CARD_W; x += 40) ctx.fillRect(x - 1, y - 1, 2, 2);

  const pad = 64;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = c;
  ctx.fillRect(pad, 58, 48, 4);
  ctx.font = `600 28px ${TECH}`;
  ctx.fillText(`${String(card.index + 1).padStart(2, "0")} / ${String(COUNT).padStart(2, "0")}`, pad, 108);
  ctx.fillStyle = "#f2fbf8";
  ctx.font = `500 ${card.lang === "zh" ? 40 : 36}px ${TECH}`;
  ctx.textAlign = "right";
  ctx.fillText(card.lang === "zh" ? card.title : card.title.toUpperCase(), CARD_W - pad, 108, CARD_W - pad * 2 - 220);

  drawIllustration(ctx, card.id, c, (CARD_W - ART_W) / 2, 186);

  const footer = 186 + ART_H + 56;
  ctx.fillStyle = "rgba(220, 240, 234, 0.1)";
  ctx.fillRect(pad, footer, CARD_W - pad * 2, 2);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(220, 240, 234, 0.62)";
  ctx.font = `500 24px ${TECH}`;
  ctx.fillText(card.tags.toUpperCase(), pad, footer + 54, CARD_W - pad * 2 - 260);
  for (let i = 0; i < COUNT; i++) {
    const active = i === card.index;
    const right = CARD_W - pad - (COUNT - 1 - i) * 34;
    ctx.fillStyle = active ? c : "rgba(220, 240, 234, 0.2)";
    ctx.fillRect(right - (active ? 26 : 10), footer + 40, active ? 26 : 10, 6);
  }
}
