// Pre-rendered 3D sprites made by tools/sprites (Blender). Units without a sheet keep their procedural art.
// Sheets: sprites/<look>_<faction>.png with rows of frames (one column per direction) and a matching
// .mask.png marking team-colour pixels, which are tinted per player the first time a frame is drawn.
import { iso } from './art-core.js';

const sheets = new Map();
const ready = [];
let loaded = false;

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export async function loadSprites() {
  try {
    const man = await (await fetch('sprites/manifest.json', { cache: 'no-cache' })).json();
    await Promise.all(Object.entries(man).map(async ([key, meta]) => {
      try {
        const [img, mask] = await Promise.all([loadImage(`sprites/${key}.png`), loadImage(`sprites/${key}.mask.png`)]);
        sheets.set(key, { meta, img, mask, cache: new Map() });
      } catch { /* missing sheet: keep procedural art */ }
    }));
  } catch { /* no manifest */ }
  loaded = true;
  for (const fn of ready.splice(0)) fn();
}

export function onSpritesLoaded(fn) { if (loaded) fn(); else ready.push(fn); }

export function hasSprite(key) { return sheets.has(key); }

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

let scratch;
function frameCanvas(s, row, k, color) {
  const id = `${row}|${k}|${color}`;
  let c = s.cache.get(id);
  if (c) return c;
  const F = s.meta.frame, r = s.meta.rows[row].row;
  c = document.createElement('canvas');
  c.width = c.height = F;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(s.img, k * F, r * F, F, F, 0, 0, F, F);
  if (!scratch) { scratch = document.createElement('canvas'); }
  scratch.width = scratch.height = F;
  const sg = scratch.getContext('2d', { willReadFrequently: true });
  sg.clearRect(0, 0, F, F);
  sg.drawImage(s.mask, k * F, r * F, F, F, 0, 0, F, F);
  const m = sg.getImageData(0, 0, F, F).data;
  const img = g.getImageData(0, 0, F, F);
  const d = img.data;
  const [tr, tg, tb] = rgb(color);
  for (let i = 0; i < d.length; i += 4) {
    const a = m[i + 3] / 255 * (m[i] / 255);
    if (a <= 0) continue;
    // keep the rendered shading, swap the neutral grey for the player's colour
    const lum = Math.min(1.6, (d[i] + d[i + 1] + d[i + 2]) / (3 * 150));
    d[i] = d[i] * (1 - a) + Math.min(255, tr * lum) * a;
    d[i + 1] = d[i + 1] * (1 - a) + Math.min(255, tg * lum) * a;
    d[i + 2] = d[i + 2] * (1 - a) + Math.min(255, tb * lum) * a;
  }
  g.putImageData(img, 0, 0);
  s.cache.set(id, c);
  return c;
}

// Draws one sprite layer (e.g. 'body', 'turret', 'body.walk2') facing `dir` at world position x, y.
export function drawSprite(ctx, key, row, x, y, dir, color) {
  const s = sheets.get(key);
  const info = s && s.meta.rows[row];
  if (!info) return false;
  const n = info.dirs;
  const k = ((Math.round(dir / (Math.PI * 2) * n) % n) + n) % n;
  const c = frameCanvas(s, row, k, color);
  const sc = 1 / s.meta.scale, F = s.meta.frame;
  const [sx, sy] = iso(x, y);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, sx - s.meta.anchor[0] * sc, sy - s.meta.anchor[1] * sc, F * sc, F * sc);
  ctx.imageSmoothingEnabled = smooth;
  return true;
}

export function spriteRows(key) { return sheets.get(key)?.meta.rows; }
