// Extracts the outline of the intro monogram from Instrument Serif Italic (SIL OFL 1.1) into
// src/intro/cinema/monogram.json, so the browser can extrude it without shipping the font.
// Run: node scripts/build-monogram.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
const file = require.resolve('@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff');
const bytes = readFileSync(file);
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const path = font.getPath('S', 0, 0, 1);
const box = path.getBoundingBox();
const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2, scale = 1 / (box.y2 - box.y1);
// Centre on the origin, unit height, y up. Commands: [type, ...points].
const r = v => Math.round(v * 10000) / 10000;
const commands = path.commands.map(c => {
  const p = (x, y) => [r((x - cx) * scale), r(-(y - cy) * scale)];
  switch (c.type) {
    case 'M': case 'L': return [c.type, ...p(c.x, c.y)];
    case 'Q': return ['Q', ...p(c.x1, c.y1), ...p(c.x, c.y)];
    case 'C': return ['C', ...p(c.x1, c.y1), ...p(c.x2, c.y2), ...p(c.x, c.y)];
    default: return ['Z'];
  }
});
writeFileSync(new URL('../src/intro/cinema/monogram.json', import.meta.url), JSON.stringify({
  source: 'Instrument Serif Italic, glyph "S" — SIL Open Font License 1.1, Copyright 2022 The Instrument Serif Project Authors',
  width: r((box.x2 - box.x1) * scale), commands,
}));
console.log(`monogram.json: ${commands.length} commands`);
