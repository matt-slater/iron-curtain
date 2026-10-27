// Pre-rendered 3D sprites made by tools/sprites (Blender). Units without a sheet keep their procedural art.
// Sheets: sprites/<look>_<faction>.png with rows of frames (one column per direction) and a matching
// .mask.png marking team-colour pixels, which are tinted per player the first time a frame is drawn.
import { iso } from './art-core.js';

const sheets = new Map();  // loaded sheets
const manifest = new Map(); // everything that exists on the server
const pending = new Set();
const listeners = [];
const SAT = 1.3;
// Baked ground shadows (pure black, semi-transparent pixels) are drawn at this strength and blurred slightly.
const SHADOW = 0.45;

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Only the small manifest is fetched up front; each sheet downloads the first time its unit is drawn.
export async function loadSprites() {
  try {
    const man = await (await fetch('sprites/manifest.json', { cache: 'no-cache' })).json();
    for (const [key, meta] of Object.entries(man)) manifest.set(key, meta);
  } catch { /* no manifest: everything keeps its procedural art */ }
}

function request(key) {
  if (pending.has(key) || !manifest.has(key)) return;
  pending.add(key);
  Promise.all([loadImage(`sprites/${key}.png`), loadImage(`sprites/${key}.mask.png`)]).then(([img, mask]) => {
    sheets.set(key, { meta: manifest.get(key), img, mask, cache: new Map() });
    for (const fn of listeners) fn(key);
  }).catch(() => { /* keep procedural art */ });
}

// Called whenever a sheet finishes loading (used to refresh sidebar pictures).
export function onSpritesLoaded(fn) { listeners.push(fn); }

export function hasSprite(key) {
  if (sheets.has(key)) return true;
  request(key);
  return false;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

let scratch;
function frameCanvas(s, row, k, color) {
  const id = `${row}|${k}|${color}`;
  let c = s.cache.get(id);
  if (c) return c;
  const FW = s.meta.fw || s.meta.frame, FH = s.meta.fh || s.meta.frame, r = s.meta.rows[row].row;
  c = document.createElement('canvas');
  c.width = FW; c.height = FH;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(s.img, k * FW, r * FH, FW, FH, 0, 0, FW, FH);
  if (!scratch) { scratch = document.createElement('canvas'); }
  scratch.width = FW; scratch.height = FH;
  const sg = scratch.getContext('2d', { willReadFrequently: true });
  sg.clearRect(0, 0, FW, FH);
  sg.drawImage(s.mask, k * FW, r * FH, FW, FH, 0, 0, FW, FH);
  const m = sg.getImageData(0, 0, FW, FH).data;
  const img = g.getImageData(0, 0, FW, FH);
  const d = img.data;
  // untinted sprites (neutral civilian buildings) keep their neutral grey trim
  const [tr, tg, tb] = color ? rgb(color) : [150, 148, 140];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    // push colour away from grey so models survive the game's gritty palette
    const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
    d[i] = Math.max(0, Math.min(255, avg + (d[i] - avg) * SAT));
    d[i + 1] = Math.max(0, Math.min(255, avg + (d[i + 1] - avg) * SAT));
    d[i + 2] = Math.max(0, Math.min(255, avg + (d[i + 2] - avg) * SAT));
    const a = m[i + 3] / 255 * (m[i] / 255);
    if (a <= 0) continue;
    // keep the rendered shading, swap the neutral grey for the player's colour
    const lum = Math.min(1.6, (d[i] + d[i + 1] + d[i + 2]) / (3 * 150));
    d[i] = d[i] * (1 - a) + Math.min(255, tr * lum) * a;
    d[i + 1] = d[i + 1] * (1 - a) + Math.min(255, tg * lum) * a;
    d[i + 2] = d[i + 2] * (1 - a) + Math.min(255, tb * lum) * a;
  }
  softenShadow(d, FW, FH);
  g.putImageData(img, 0, 0);
  s.cache.set(id, c);
  return c;
}

function softenShadow(d, w, h) {
  const n = w * h, sh = new Float32Array(n);
  let any = false;
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    const a = d[i + 3];
    if (a > 0 && a < 248 && d[i] < 14 && d[i + 1] < 14 && d[i + 2] < 14) { sh[p] = a; any = true; }
  }
  if (!any) return;
  // 3x3 box blur of the shadow alpha (sprites are 2x resolution, so this is a sub-pixel soft edge in game)
  const out = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    out[p] = (sh[p - w - 1] + sh[p - w] + sh[p - w + 1] + sh[p - 1] + sh[p] + sh[p + 1] + sh[p + w - 1] + sh[p + w] + sh[p + w + 1]) / 9;
  }
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    const a = d[i + 3];
    const isShadow = a === 0 || (a < 248 && d[i] < 14 && d[i + 1] < 14 && d[i + 2] < 14);
    if (!isShadow || out[p] <= 0) continue;
    // cool, faintly tinted shadow instead of pure black
    d[i] = 8; d[i + 1] = 12; d[i + 2] = 18;
    d[i + 3] = Math.round(out[p] * SHADOW);
  }
}

// Draws one sprite layer (e.g. 'body', 'turret', 'body.walk2') facing `dir` at world position x, y.
export function drawSprite(ctx, key, row, x, y, dir, color) {
  const s = sheets.get(key);
  const info = s && s.meta.rows[row];
  if (!info) return false;
  const n = info.dirs;
  const k = ((Math.round(dir / (Math.PI * 2) * n) % n) + n) % n;
  const c = frameCanvas(s, row, k, color);
  const sc = 1 / s.meta.scale;
  const [sx, sy] = iso(x, y);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, sx - s.meta.anchor[0] * sc, sy - s.meta.anchor[1] * sc, c.width * sc, c.height * sc);
  ctx.imageSmoothingEnabled = smooth;
  return true;
}

export function spriteRows(key) { return sheets.get(key)?.meta.rows; }

export function spriteMeta(key) { return sheets.get(key)?.meta; }

// Forward offset (tiles) of the turret pivot from the unit centre.
export function spritePivot(key) { return sheets.get(key)?.meta.pivot || 0; }
