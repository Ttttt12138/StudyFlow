import type { FeatureId } from "../features";

/**
 * Drawn artwork for the seven features, used on the glass slabs and the fallback grid instead
 * of app screenshots. Every piece is drawn in a 1152 × 440 box, uses only numbers and currency
 * codes (so it reads the same in both languages) and takes the feature's accent colour.
 */
export const ART_W = 1152;
export const ART_H = 440;
export const TECH = '"Chakra Petch", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

type Ctx = CanvasRenderingContext2D;

const INK = "#f2fbf8";
const DARK = "#04110f";
const DIM = "rgba(220, 240, 234, 0.55)";
const FAINT = "rgba(220, 240, 234, 0.14)";

export function rgba(hex: string, alpha: number) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function path(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillBox(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
  path(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A frosted glass panel with an accent hairline. */
function glass(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, c: string, strength = 1) {
  const fill = ctx.createLinearGradient(x, y, x, y + h);
  fill.addColorStop(0, `rgba(255, 255, 255, ${0.075 * strength})`);
  fill.addColorStop(1, `rgba(255, 255, 255, ${0.02 * strength})`);
  path(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rgba(c, 0.32 * strength);
  ctx.lineWidth = 2;
  ctx.stroke();
}

function glow(ctx: Ctx, color: string, blur: number, draw: () => void) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

function label(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left", weight = 500) {
  ctx.font = `${weight} ${size}px ${TECH}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, x, y);
}

function dot(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function ring(ctx: Ctx, x: number, y: number, r: number, stroke: string, width = 2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function line(ctx: Ctx, points: [number, number][], stroke: string | CanvasGradient, width = 2, dash: number[] = []) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.setLineDash(dash);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.setLineDash([]);
}

function check(ctx: Ctx, x: number, y: number, r: number, fill: string, mark = DARK) {
  dot(ctx, x, y, r, fill);
  line(ctx, [[x - r * 0.42, y + r * 0.02], [x - r * 0.1, y + r * 0.34], [x + r * 0.45, y - r * 0.3]], mark, Math.max(2, r * 0.2));
}

/** Head and shoulders, clipped to a circle. */
function person(ctx: Ctx, x: number, y: number, r: number, fill: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  dot(ctx, x, y - r * 0.2, r * 0.3, fill);
  ctx.beginPath();
  ctx.arc(x, y + r * 0.72, r * 0.58, Math.PI, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

// ---------- 01 total price & comparison: a whole-course receipt and three schools side by side ----------
function budget(ctx: Ctx, c: string) {
  glass(ctx, 0, 0, 470, 440, 28, c);
  const rows: [string, number, number][] = [["412,000", 1, 150], ["96,000", 0.62, 110], ["138,000", 0.36, 130]];
  rows.forEach(([amount, alpha, bar], i) => {
    const y = 66 + i * 68;
    fillBox(ctx, 36, y - 16, 30, 30, 8, rgba(c, alpha));
    fillBox(ctx, 84, y - 7, bar, 14, 7, FAINT);
    label(ctx, amount, 434, y + 10, 32, INK, "right");
  });
  line(ctx, [[36, 262], [434, 262]], rgba(c, 0.45), 2, [8, 10]);
  label(ctx, "Σ", 36, 340, 56, c);
  glow(ctx, rgba(c, 0.7), 28, () => label(ctx, "646,000", 434, 340, 64, INK, "right"));
  ["THB", "CNY", "USD"].forEach((code, i) => {
    const x = 36 + i * 102;
    if (i === 0) fillBox(ctx, x, 374, 88, 38, 19, c);
    else { path(ctx, x, 374, 88, 38, 19); ctx.strokeStyle = rgba(c, 0.4); ctx.lineWidth = 2; ctx.stroke(); }
    label(ctx, code, x + 44, 401, 20, i === 0 ? DARK : DIM, "center", 600);
  });

  const base = 404;
  const totals = [646, 588, 712];
  const best = 1;
  const parts = [[0.64, 1], [0.15, 0.62], [0.21, 0.36]];
  for (let g = 0; g < 4; g++) line(ctx, [[560, base - g * 100], [1152, base - g * 100]], g ? "rgba(220, 240, 234, 0.06)" : FAINT, 2);
  totals.forEach((total, i) => {
    const x = 600 + i * 190;
    const h = (total / 712) * 320;
    let y = base;
    for (const [share, alpha] of parts) {
      const segment = h * share;
      y -= segment;
      fillBox(ctx, x, y, 124, segment - 4, 10, rgba(c, alpha * (i === best ? 1 : 0.55)));
    }
    if (i === best) {
      glow(ctx, rgba(c, 0.9), 30, () => { path(ctx, x - 10, base - h - 14, 144, h + 18, 16); ctx.strokeStyle = rgba(c, 0.9); ctx.lineWidth = 3; ctx.stroke(); });
      check(ctx, x + 134, base - h - 14, 22, c);
    }
    label(ctx, `${total}k`, x + 62, base - h - 30, 30, i === best ? INK : DIM, "center");
    label(ctx, "ABC"[i], x + 62, 438, 22, i === best ? c : DIM, "center", 600);
  });
}

// ---------- 02 loan amount & estimate: the amount typed against the full-course cap, a repayment curve, the documents ----------
function agent(ctx: Ctx, c: string) {
  const x0 = 0, x1 = 1152, y = 46, h = 66, split = x0 + (x1 - x0) * 0.62;
  path(ctx, x0, y, x1 - x0, h, 20);
  ctx.save();
  ctx.clip();
  const savings = ctx.createLinearGradient(x0, 0, split, 0);
  savings.addColorStop(0, rgba(c, 0.95));
  savings.addColorStop(1, rgba(c, 0.6));
  ctx.fillStyle = savings;
  ctx.fillRect(x0, y, split - x0, h);
  for (let x = split - h; x < x1; x += 20) line(ctx, [[x, y + h], [x + h, y]], rgba(c, 0.32), 3);
  ctx.restore();
  path(ctx, split, y, x1 - split, h, 0);
  line(ctx, [[split, y], [x1 - 20, y]], rgba(c, 0.85), 2, [10, 8]);
  line(ctx, [[split, y + h], [x1 - 20, y + h]], rgba(c, 0.85), 2, [10, 8]);
  label(ctx, "850,000", x0 + 30, y + 45, 32, DARK, "left", 600);
  line(ctx, [[split + 4, 30], [split + 4, 20], [x1 - 4, 20], [x1 - 4, 30]], rgba(c, 0.8), 2);
  glow(ctx, rgba(c, 0.8), 22, () => label(ctx, "≤ 2,351,350", (split + x1) / 2, 8, 30, c, "center"));

  glass(ctx, 0, 164, 720, 276, 24, c, 0.8);
  const left = 40, right = 680, top = 222, bottom = 404, n = 24;
  for (let k = 0; k < n; k++) {
    const x = left + (k / (n - 1)) * (right - left) - 9;
    fillBox(ctx, x, bottom - 40, 18, 40, 5, rgba(c, 0.3));
  }
  const curve: [number, number][] = [];
  for (let k = 0; k <= 48; k++) {
    const t = k / 48;
    const paid = (Math.pow(1.03, t * n) - 1) / (Math.pow(1.03, n) - 1);
    curve.push([left + t * (right - left), top + (bottom - top) * paid]);
  }
  const area = ctx.createLinearGradient(0, top, 0, bottom);
  area.addColorStop(0, rgba(c, 0.32));
  area.addColorStop(1, rgba(c, 0));
  ctx.beginPath();
  curve.forEach(([x, cy], i) => (i ? ctx.lineTo(x, cy) : ctx.moveTo(x, cy)));
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.fillStyle = area;
  ctx.fill();
  glow(ctx, rgba(c, 0.9), 18, () => line(ctx, curve, c, 4));
  dot(ctx, left, top, 9, INK);
  label(ctx, "3,850 × 24", right, 214, 32, INK, "right");
  label(ctx, "+ 7,200", right, 252, 22, c, "right");

  const me: [number, number] = [968, 246];
  // The application's documents: the admission notice attached automatically, then the two the family confirms.
  const documents: [number, number][] = [[852, 392], [968, 404], [1084, 392]];
  line(ctx, [[me[0], me[1] - 52], [me[0], y + h + 8]], rgba(c, 0.7), 2, [6, 8]);
  documents.forEach(([fx, fy], i) => {
    line(ctx, [[fx, fy], me], rgba(c, 0.5), 2, [6, 8]);
    dot(ctx, fx, fy, 34, "rgba(10, 26, 24, 0.95)");
    ring(ctx, fx, fy, 34, rgba(c, 0.55));
    check(ctx, fx, fy, 20, i === 0 ? c : rgba(c, 0.6));
  });
  glow(ctx, rgba(c, 0.8), 26, () => dot(ctx, me[0], me[1], 50, "rgba(10, 26, 24, 1)"));
  ring(ctx, me[0], me[1], 50, c, 3);
  ring(ctx, me[0], me[1], 64, rgba(c, 0.22), 2);
  person(ctx, me[0], me[1], 50, INK);
}

// ---------- 03 bills after enrollment: a ninety-day line with due bills and three month grids ----------
function calendar(ctx: Ctx, c: string) {
  const xa = 46, xb = 1106, ly = 196;
  const dayX = (d: number) => xa + ((xb - xa) * d) / 90;
  const rail = ctx.createLinearGradient(xa, 0, xb, 0);
  rail.addColorStop(0, rgba(c, 0.9));
  rail.addColorStop(1, rgba(c, 0.15));
  line(ctx, [[xa, ly], [xb, ly]], rail, 3);
  for (let d = 0; d <= 90; d++) {
    const major = d % 30 === 0;
    const h = major ? 20 : d % 7 === 0 ? 11 : 5;
    line(ctx, [[dayX(d), ly], [dayX(d), ly + h]], major ? DIM : FAINT, 2);
    if (major) label(ctx, `D+${d}`, dayX(d), ly + 48, 22, DIM, "center");
  }
  ring(ctx, dayX(0), ly, 30, rgba(c, 0.18));
  ring(ctx, dayX(0), ly, 20, rgba(c, 0.4));
  glow(ctx, c, 20, () => dot(ctx, dayX(0), ly, 9, c));

  const bills: { d: number; amount: string; h: number; kind: 0 | 1 | 2 }[] = [
    { d: 8, amount: "8,000", h: 74, kind: 1 }, { d: 21, amount: "186,000", h: 150, kind: 0 },
    { d: 38, amount: "8,000", h: 74, kind: 1 }, { d: 52, amount: "4,120", h: 56, kind: 2 },
    { d: 68, amount: "8,000", h: 74, kind: 1 }, { d: 82, amount: "4,120", h: 56, kind: 2 },
  ];
  ctx.font = `600 24px ${TECH}`;
  for (const bill of bills) {
    const x = dayX(bill.d);
    const top = ly - bill.h;
    line(ctx, [[x, ly], [x, top]], rgba(c, bill.kind === 0 ? 0.9 : 0.5), 2);
    ctx.font = `600 24px ${TECH}`;
    const w = ctx.measureText(bill.amount).width + 34;
    if (bill.kind === 0) glow(ctx, rgba(c, 0.9), 26, () => fillBox(ctx, x - w / 2, top - 44, w, 44, 22, c));
    else {
      fillBox(ctx, x - w / 2, top - 44, w, 44, 22, bill.kind === 1 ? rgba(c, 0.16) : "rgba(10, 26, 24, 0.9)");
      path(ctx, x - w / 2, top - 44, w, 44, 22);
      ctx.setLineDash(bill.kind === 2 ? [6, 6] : []);
      ctx.strokeStyle = rgba(c, 0.6);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    label(ctx, bill.amount, x, top - 14, 24, bill.kind === 0 ? DARK : INK, "center", 600);
    dot(ctx, x, ly, 6, bill.kind === 0 ? INK : c);
  }

  const due = [[8, 21], [8, 22], [8, 22]];
  ["01–30", "31–60", "61–90"].forEach((range, m) => {
    const x = m * 392, y = 280;
    glass(ctx, x, y, 368, 160, 20, c, m === 0 ? 1 : 0.6);
    label(ctx, range, x + 24, y + 34, 20, m === 0 ? c : DIM, "left", 600);
    for (let day = 1; day <= 30; day++) {
      const col = (day - 1) % 10, row = Math.floor((day - 1) / 10);
      const cx = x + 40 + col * 32, cy = y + 70 + row * 32;
      if (due[m].includes(day)) glow(ctx, c, 16, () => dot(ctx, cx, cy, 10, m === 0 && day === 21 ? c : rgba(c, 0.7)));
      else dot(ctx, cx, cy, 4, m === 0 && day < 4 ? rgba(c, 0.55) : FAINT);
    }
  });
}

// ---------- 04 multi-currency wallets: three fanned balance cards and one shared history ----------
function wallet(ctx: Ctx, c: string) {
  const cards: { code: string; symbol: string; dx: number; dy: number; rot: number; alpha: number; balance?: string }[] = [
    { code: "USD", symbol: "$", dx: 112, dy: -96, rot: 9, alpha: 0.22 },
    { code: "CNY", symbol: "¥", dx: 56, dy: -48, rot: 4, alpha: 0.32 },
    { code: "THB", symbol: "฿", dx: 0, dy: 0, rot: -3, alpha: 0.5, balance: "48,200.00" },
  ];
  for (const card of cards) {
    ctx.save();
    ctx.translate(290 + card.dx, 276 + card.dy);
    ctx.rotate((card.rot * Math.PI) / 180);
    const w = 460, h = 280;
    const fill = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    fill.addColorStop(0, rgba(c, card.alpha));
    fill.addColorStop(1, `rgba(8, 22, 21, 0.96)`);
    if (card.balance) glow(ctx, rgba(c, 0.6), 40, () => fillBox(ctx, -w / 2, -h / 2, w, h, 28, fill));
    else fillBox(ctx, -w / 2, -h / 2, w, h, 28, fill);
    path(ctx, -w / 2, -h / 2, w, h, 28);
    ctx.strokeStyle = rgba(c, card.balance ? 0.8 : 0.4);
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, card.code, -w / 2 + 32, -h / 2 + 58, 34, INK, "left", 600);
    label(ctx, card.symbol, w / 2 - 36, h / 2 - 34, 150, rgba(c, 0.16), "right", 600);
    if (card.balance) {
      fillBox(ctx, w / 2 - 92, -h / 2 + 30, 60, 44, 10, rgba(c, 0.55));
      line(ctx, [[w / 2 - 92, -h / 2 + 52], [w / 2 - 32, -h / 2 + 52]], "rgba(4, 17, 15, 0.5)", 2);
      label(ctx, card.balance, -w / 2 + 32, h / 2 - 40, 52, INK);
      fillBox(ctx, -w / 2 + 32, h / 2 - 120, 120, 12, 6, FAINT);
    }
    ctx.restore();
  }

  glass(ctx, 656, 0, 496, 440, 26, c);
  const history: [string, string, boolean, number][] = [
    ["THB", "+12,000.00", true, 150], ["THB", "−8,000.00", false, 110], ["CNY", "+2,600.00", true, 130],
    ["USD", "−45.00", false, 90], ["THB", "−1,280.00", false, 120],
  ];
  history.forEach(([code, amount, incoming, bar], i) => {
    const y = 56 + i * 82;
    if (i) line(ctx, [[688, y - 41], [1120, y - 41]], "rgba(220, 240, 234, 0.07)", 2);
    if (incoming) dot(ctx, 712, y, 22, c);
    else ring(ctx, 712, y, 21, rgba(c, 0.6));
    const tip = incoming ? 8 : -8;
    line(ctx, [[712, y - tip], [712, y + tip]], incoming ? DARK : c, 3);
    line(ctx, [[704, y + tip * 0.1], [712, y + tip], [720, y + tip * 0.1]], incoming ? DARK : c, 3);
    fillBox(ctx, 752, y - 16, bar, 12, 6, FAINT);
    label(ctx, code, 752, y + 22, 20, DIM, "left", 600);
    label(ctx, amount, 1120, y + 10, 30, incoming ? c : INK, "right");
  });
}

// ---------- 05 FX & remittance: a quoted transfer arc, the fee split out, and a four-step tracker ----------
function remit(ctx: Ctx, c: string) {
  const L: [number, number] = [170, 186], R: [number, number] = [982, 186], r = 92;
  const ctrl: [number, number] = [576, -6];
  const at = (t: number): [number, number] => [
    (1 - t) ** 2 * (L[0] + r) + 2 * (1 - t) * t * ctrl[0] + t * t * (R[0] - r),
    (1 - t) ** 2 * L[1] + 2 * (1 - t) * t * ctrl[1] + t * t * R[1],
  ];
  const arc = Array.from({ length: 61 }, (_, k) => at(k / 60));
  line(ctx, arc, rgba(c, 0.3), 3, [8, 10]);
  glow(ctx, rgba(c, 0.9), 18, () => line(ctx, arc.slice(0, 38), c, 4));
  const [mx, my] = at(0.62);
  ring(ctx, mx, my, 22, rgba(c, 0.25), 2);
  glow(ctx, c, 24, () => dot(ctx, mx, my, 10, INK));

  const [ax, ay] = at(0.5);
  line(ctx, [[ax, ay + 6], [ax, 214]], rgba(c, 0.5), 2, [5, 7]);
  dot(ctx, ax, 244, 30, "rgba(10, 26, 24, 0.95)");
  ring(ctx, ax, 244, 30, rgba(c, 0.6));
  label(ctx, "%", ax, 254, 28, c, "center", 600);
  label(ctx, "−48.60", ax, 310, 24, DIM, "center");

  ctx.font = `600 26px ${TECH}`;
  const quote = "1 CNY = 4.86 THB";
  const qw = ctx.measureText(quote).width + 48;
  glass(ctx, ax - qw / 2, -2, qw, 50, 25, c, 1.4);
  label(ctx, quote, ax, 32, 26, INK, "center", 600);

  ([[L, "CNY", "10,000.00"], [R, "THB", "48,551.40"]] as const).forEach(([[x, y], code, amount], i) => {
    const fill = ctx.createRadialGradient(x - 30, y - 30, 10, x, y, r);
    fill.addColorStop(0, rgba(c, i ? 0.4 : 0.22));
    fill.addColorStop(1, "rgba(8, 22, 21, 0.95)");
    glow(ctx, rgba(c, i ? 0.6 : 0.3), 30, () => dot(ctx, x, y, r, fill));
    ring(ctx, x, y, r, rgba(c, i ? 0.9 : 0.5), 3);
    label(ctx, code, x, y + 14, 40, INK, "center", 600);
    label(ctx, amount, x, y + r + 46, 28, i ? c : INK, "center");
  });

  const steps = [170, 440, 712, 982], sy = 400;
  line(ctx, [[steps[0], sy], [steps[2], sy]], c, 3);
  line(ctx, [[steps[2], sy], [steps[3], sy]], rgba(c, 0.4), 3, [8, 8]);
  steps.forEach((x, i) => {
    if (i < 3) check(ctx, x, sy, 20, c);
    else {
      dot(ctx, x, sy, 20, "rgba(10, 26, 24, 1)");
      ring(ctx, x, sy, 20, c, 3);
      ring(ctx, x, sy, 32, rgba(c, 0.3), 2);
      glow(ctx, c, 14, () => dot(ctx, x, sy, 7, c));
    }
  });
}

// ---------- 06 permission tiers: four rising steps from view-only to two-person approval ----------
function tiers(ctx: Ctx, c: string) {
  const base = 440, w = 252, heights = [130, 210, 290, 370];
  const tops: [number, number][] = [];
  heights.forEach((h, i) => {
    const x = i * 300, top = base - h;
    tops.push([x + w / 2, top - 28]);
    const fill = ctx.createLinearGradient(0, top, 0, base);
    fill.addColorStop(0, rgba(c, 0.1 + i * 0.09));
    fill.addColorStop(1, rgba(c, 0.02));
    const draw = () => fillBox(ctx, x, top, w, h, 24, fill);
    if (i === 3) glow(ctx, rgba(c, 0.6), 34, draw); else draw();
    path(ctx, x, top, w, h, 24);
    ctx.strokeStyle = rgba(c, 0.3 + i * 0.2);
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let ly = top + 100; ly < base - 16; ly += 30) line(ctx, [[x + 28, ly], [x + w - 28, ly]], "rgba(220, 240, 234, 0.05)", 2);
    label(ctx, `T${i}`, x + 28, top + 62, 48, i === 3 ? c : INK, "left", 600);
    icon(ctx, i, x + w - 58, top + 46, c);
  });
  glow(ctx, rgba(c, 0.8), 16, () => line(ctx, tops, rgba(c, 0.85), 3, [2, 10]));
  const [ex, ey] = tops[3];
  ring(ctx, ex, ey, 18, rgba(c, 0.3));
  glow(ctx, c, 18, () => dot(ctx, ex, ey, 8, c));
}

function icon(ctx: Ctx, tier: number, x: number, y: number, c: string) {
  if (tier === 0) {
    ctx.beginPath();
    ctx.moveTo(x - 28, y);
    ctx.quadraticCurveTo(x, y - 26, x + 28, y);
    ctx.quadraticCurveTo(x, y + 26, x - 28, y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
    dot(ctx, x, y, 8, c);
  } else if (tier === 1) {
    check(ctx, x, y, 22, c);
  } else if (tier === 2) {
    ctx.beginPath();
    ctx.arc(x, y - 10, 13, Math.PI, 0);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.stroke();
    line(ctx, [[x - 13, y - 10], [x - 13, y - 2]], INK, 4);
    line(ctx, [[x + 13, y - 10], [x + 13, y - 2]], INK, 4);
    fillBox(ctx, x - 24, y - 4, 48, 34, 7, c);
    [-12, 0, 12].forEach((dx) => dot(ctx, x + dx, y + 13, 3.5, DARK));
  } else {
    dot(ctx, x - 14, y, 22, "rgba(10, 26, 24, 1)");
    ring(ctx, x - 14, y, 22, INK, 2);
    person(ctx, x - 14, y, 22, INK);
    dot(ctx, x + 14, y, 22, "rgba(10, 26, 24, 1)");
    ring(ctx, x + 14, y, 22, c, 2);
    person(ctx, x + 14, y, 22, c);
  }
}

// ---------- 07 repayment: twelve installments paid bring the principal down, a progress gauge, the receipts ----------
function repay(ctx: Ctx, c: string) {
  glass(ctx, 0, 0, 760, 440, 26, c);
  const levels = [146, 218, 290, 362];
  levels.forEach(y => line(ctx, [[86, y], [724, y]], "rgba(220, 240, 234, 0.06)", 2));
  const mx = (m: number) => 100 + m * 56;
  const steps: [number, number][] = [];
  for (let m = 0; m < 12; m++) {
    const level = levels[Math.floor(m / 3)];
    steps.push([mx(m) - 28, level], [mx(m) + 28, level]);
  }
  for (let k = steps.length - 2; k > 0; k -= 2) if (steps[k][1] !== steps[k - 1][1]) steps.splice(k, 0, [steps[k][0], steps[k - 1][1]]);
  const area = ctx.createLinearGradient(0, 146, 0, 400);
  area.addColorStop(0, rgba(c, 0.3));
  area.addColorStop(1, rgba(c, 0));
  ctx.beginPath();
  steps.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(steps[steps.length - 1][0], 380);
  ctx.lineTo(steps[0][0], 380);
  ctx.closePath();
  ctx.fillStyle = area;
  ctx.fill();
  glow(ctx, rgba(c, 0.9), 18, () => line(ctx, steps, c, 4));
  for (let m = 0; m < 12; m++) check(ctx, mx(m), 404, 15, m === 11 ? c : rgba(c, 0.75));
  label(ctx, "12 / 48", 724, 62, 30, INK, "right");

  ["#3fa9e1", "#b7204c", "#08d6f3"].forEach((hash, i) => {
    const y = 26 + i * 44;
    label(ctx, hash, 816, y + 8, 20, DIM, "left", 600);
    fillBox(ctx, 940, y - 6, 150 - i * 30, 12, 6, FAINT);
    check(ctx, 1132, y, 12, rgba(c, 0.8));
  });

  const gx = 984, gy = 330, gr = 112, from = Math.PI * 0.75, to = Math.PI * 2.25;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(gx, gy, gr, from, to);
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 20;
  ctx.stroke();
  glow(ctx, rgba(c, 0.9), 24, () => {
    ctx.beginPath();
    ctx.arc(gx, gy, gr, from, from + (to - from) * 0.25);
    ctx.strokeStyle = c;
    ctx.lineWidth = 20;
    ctx.lineCap = "round";
    ctx.stroke();
  });
  label(ctx, "25%", gx, gy + 22, 72, INK, "center", 600);
  label(ctx, "3,850", gx, gy + 104, 26, c, "center");
}

const painters: Record<FeatureId, (ctx: Ctx, color: string) => void> = { budget, agent, calendar, wallet, remit, tiers, repay };

/** Draws one feature's artwork with its top-left corner at (x, y), scaled by `scale`. */
export function drawIllustration(ctx: Ctx, id: FeatureId, color: string, x: number, y: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  painters[id](ctx, color);
  ctx.restore();
}
