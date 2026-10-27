// Drawing primitives for the isometric pixel-art renderer.
// World (x, y, z) -> iso pixels: X = (x - y) * 32, Y = (x + y) * 16 - z.

export const HW = 32, HH = 16;
export const iso = (x, y, z = 0) => [(x - y) * HW, (x + y) * HH - z];

const shadeCache = new Map();
export function shade(hex, f) {
  const k = hex + f;
  let v = shadeCache.get(k);
  if (v) return v;
  let r, g, b;
  if (hex[0] === '#') {
    const n = parseInt(hex.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    // already-shaded "rgb(r,g,b)" colours can be shaded again
    [r, g, b] = hex.match(/\d+/g).map(Number);
  }
  if (f >= 1) { r += (255 - r) * (f - 1); g += (255 - g) * (f - 1); b += (255 - b) * (f - 1); }
  else { r *= f; g *= f; b *= f; }
  v = `rgb(${r | 0},${g | 0},${b | 0})`;
  shadeCache.set(k, v);
  return v;
}

export function hash(a, b = 0) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const OUTLINE = 'rgba(6,7,5,0.75)';

export function poly(ctx, pts, fill, stroke = OUTLINE) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

export function line(ctx, a, b, color, w = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.lineWidth = 1;
}

// Rain streaks and grime on a vertical face from world point a to b, between heights z0..z1.
function grimeFace(ctx, ax, ay, bx, by, z0, z1, seed, amount) {
  const n = Math.round(amount * Math.hypot(bx - ax, by - ay) * 4);
  for (let k = 0; k < n; k++) {
    const t = hash(seed, k) * 0.94 + 0.03;
    const len = (z1 - z0) * (0.2 + hash(k, seed) * 0.7);
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    line(ctx, iso(px, py, z1 - 1), iso(px, py, z1 - len), `rgba(20,16,10,${0.18 + hash(seed + 7, k) * 0.2})`, 1 + (k % 3 === 0 ? 1 : 0));
  }
  for (let k = 0; k < n; k++) {
    const t = hash(seed + 3, k), zz = z0 + (z1 - z0) * hash(k, seed + 5) * 0.4;
    const [sx, sy] = iso(ax + (bx - ax) * t, ay + (by - ay) * t, zz);
    ctx.fillStyle = 'rgba(30,22,12,0.3)';
    ctx.fillRect(sx, sy, 2, 2);
  }
}

// Axis-aligned box. grime: 0..1 weathering amount.
export function box(ctx, x0, y0, x1, y1, z0, z1, color, top, grime = 0.6, seed = 1) {
  poly(ctx, [iso(x0, y1, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x0, y1, z1)], shade(color, 0.78));
  if (grime) grimeFace(ctx, x0, y1, x1, y1, z0, z1, seed, grime);
  poly(ctx, [iso(x1, y0, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x1, y0, z1)], shade(color, 0.55));
  if (grime) grimeFace(ctx, x1, y0, x1, y1, z0, z1, seed + 11, grime);
  poly(ctx, [iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)], top || shade(color, 1.04));
}

export function flat(ctx, x0, y0, x1, y1, z, color, stroke = null) {
  poly(ctx, [iso(x0, y0, z), iso(x1, y0, z), iso(x1, y1, z), iso(x0, y1, z)], color, stroke);
}

// Gable roof with ridge along x.
export function gable(ctx, x0, y0, x1, y1, z, rise, color) {
  const ym = (y0 + y1) / 2;
  poly(ctx, [iso(x0, y0, z), iso(x1, y0, z), iso(x1, ym, z + rise), iso(x0, ym, z + rise)], shade(color, 1.15));
  poly(ctx, [iso(x0, ym, z + rise), iso(x1, ym, z + rise), iso(x1, y1, z), iso(x0, y1, z)], shade(color, 0.9));
  poly(ctx, [iso(x1, y0, z), iso(x1, ym, z + rise), iso(x1, y1, z)], shade(color, 0.6));
}

// Half-cylinder (quonset / hangar) roof with axis along x.
export function arch(ctx, x0, y0, x1, y1, z, rise, color, ribs = 6) {
  const ym = (y0 + y1) / 2, hw = (y1 - y0) / 2;
  const N = 8;
  const prof = [];
  for (let i = 0; i <= N; i++) {
    const a = Math.PI - (i / N) * Math.PI;
    prof.push([ym + Math.cos(a) * hw, z + Math.sin(a) * rise]);
  }
  for (let i = 0; i < N; i++) {
    const [ya, za] = prof[i], [yb, zb] = prof[i + 1];
    const slope = (zb - za) / Math.max(0.001, yb - ya);
    const f = 0.75 + Math.max(-0.25, Math.min(0.35, slope * 0.02));
    poly(ctx, [iso(x0, ya, za), iso(x1, ya, za), iso(x1, yb, zb), iso(x0, yb, zb)], shade(color, f), null);
  }
  // corrugation ribs
  for (let r = 1; r < ribs; r++) {
    const x = x0 + (x1 - x0) * r / ribs;
    ctx.strokeStyle = 'rgba(10,10,8,0.35)';
    ctx.beginPath();
    prof.forEach(([y, zz], i) => { const p = iso(x, y, zz); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.stroke();
  }
  // end cap facing +x
  poly(ctx, prof.map(([y, zz]) => iso(x1, y, zz)).concat([iso(x1, y1, z), iso(x1, y0, z)]), shade(color, 0.5));
}

// Sawtooth factory roof; teeth along x, glazing faces +x.
export function sawtooth(ctx, x0, y0, x1, y1, z, teeth, rise, color) {
  const w = (x1 - x0) / teeth;
  for (let i = 0; i < teeth; i++) {
    const xa = x0 + i * w, xb = xa + w;
    poly(ctx, [iso(xa, y0, z), iso(xb, y0, z + rise), iso(xb, y1, z + rise), iso(xa, y1, z)], shade(color, 1.02));
    poly(ctx, [iso(xa, y1, z), iso(xb, y1, z), iso(xb, y1, z + rise)], shade(color, 0.72));
    poly(ctx, [iso(xb, y0, z), iso(xb, y1, z), iso(xb, y1, z + rise), iso(xb, y0, z + rise)], '#2b3a44');
    line(ctx, iso(xb, (y0 + y1) / 2, z), iso(xb, (y0 + y1) / 2, z + rise), 'rgba(140,170,180,0.35)');
  }
}

export function cylinder(ctx, cx, cy, r, z0, z1, color, top) {
  const [sx, sy] = iso(cx, cy);
  const rx = r * HW * Math.SQRT2, ry = r * HH * Math.SQRT2;
  const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
  g.addColorStop(0, shade(color, 0.8)); g.addColorStop(0.3, shade(color, 1.1)); g.addColorStop(1, shade(color, 0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(sx, sy - z0, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(sx - rx, sy - z1);
  ctx.ellipse(sx, sy - z1, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(sx, sy - z1, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = top || shade(color, 1.05);
  ctx.fill(); ctx.stroke();
}

export function cone(ctx, cx, cy, r, z0, z1, color) {
  const [sx, sy] = iso(cx, cy);
  const rx = r * HW * Math.SQRT2, ry = r * HH * Math.SQRT2;
  ctx.fillStyle = shade(color, 0.85);
  ctx.beginPath(); ctx.ellipse(sx, sy - z0, rx, ry, 0, 0, Math.PI); ctx.lineTo(sx, sy - z1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(color, 1.1);
  ctx.beginPath(); ctx.moveTo(sx - rx, sy - z0); ctx.lineTo(sx, sy - z1); ctx.lineTo(sx - rx * 0.1, sy - z0 + ry); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath(); ctx.moveTo(sx - rx, sy - z0); ctx.lineTo(sx, sy - z1); ctx.lineTo(sx + rx, sy - z0); ctx.stroke();
}

export function dome(ctx, cx, cy, r, z, color, glassy = false) {
  const [sx, sy0] = iso(cx, cy, z);
  const rx = r * HW * Math.SQRT2, ry = r * HH * Math.SQRT2;
  const g = ctx.createRadialGradient(sx - rx * 0.35, sy0 - rx * 0.55, 1, sx, sy0 - rx * 0.2, rx * 1.2);
  g.addColorStop(0, glassy ? '#c9e0e6' : shade(color, 1.25)); g.addColorStop(0.5, shade(color, 0.95)); g.addColorStop(1, shade(color, 0.45));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(sx, sy0, rx, ry, 0, 0, Math.PI); ctx.ellipse(sx, sy0, rx, rx * 0.95, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.stroke();
}

// Hyperboloid cooling tower.
export function coolingTower(ctx, cx, cy, r, h, color) {
  const [sx, sy] = iso(cx, cy);
  const k = HW * Math.SQRT2, kr = HH * Math.SQRT2;
  const g = ctx.createLinearGradient(sx - r * k, 0, sx + r * k, 0);
  g.addColorStop(0, shade(color, 0.75)); g.addColorStop(0.3, shade(color, 1.05)); g.addColorStop(1, shade(color, 0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * k, r * kr, 0, 0, Math.PI);
  ctx.quadraticCurveTo(sx - r * k * 0.5, sy - h * 0.6, sx - r * k * 0.68, sy - h);
  ctx.lineTo(sx + r * k * 0.68, sy - h);
  ctx.quadraticCurveTo(sx + r * k * 0.5, sy - h * 0.6, sx + r * k, sy);
  ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const x = sx + (hash(i, cx * 10) - 0.5) * r * k * 1.1;
    line(ctx, [x, sy - h + 2], [x, sy - h * (0.3 + hash(cx, i) * 0.4)], 'rgba(30,25,18,0.3)', 2);
  }
  ctx.beginPath();
  ctx.ellipse(sx, sy - h, r * k * 0.68, r * kr * 0.68, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#141614'; ctx.fill(); ctx.stroke();
}

export function star(ctx, sx, sy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

// Small lit windows on a +y-facing wall.
export function windows(ctx, x0, x1, y, z, n, color = '#7d97a0', lit = 0.35, seed = 1) {
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * (i + 0.5) / n;
    const [sx, sy] = iso(x, y, z);
    ctx.fillStyle = hash(seed, i) < lit ? '#d8b860' : color;
    ctx.fillRect(Math.round(sx - 2), Math.round(sy - 4), 4, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(Math.round(sx - 2), Math.round(sy), 4, 1);
  }
}

// Same on a +x-facing wall.
export function windowsX(ctx, x, y0, y1, z, n, color = '#7d97a0', lit = 0.35, seed = 2) {
  for (let i = 0; i < n; i++) {
    const y = y0 + (y1 - y0) * (i + 0.5) / n;
    const [sx, sy] = iso(x, y, z);
    ctx.fillStyle = hash(seed, i) < lit ? '#d8b860' : color;
    ctx.fillRect(Math.round(sx - 2), Math.round(sy - 4), 4, 4);
  }
}

export function sandbags(ctx, pts, z = 0, color = '#8a7a52') {
  for (const [x, y] of pts) {
    const [sx, sy] = iso(x, y, z);
    ctx.fillStyle = shade(color, 0.7);
    ctx.beginPath(); ctx.ellipse(sx, sy - 2, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(sx - 1, sy - 4, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  }
}

export function hazard(ctx, x0, y0, x1, y1, z, n) {
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 0.5) / n;
    flat(ctx, x0 + (x1 - x0) * a, y0, x0 + (x1 - x0) * b, y1, z, '#c9a227');
    flat(ctx, x0 + (x1 - x0) * b, y0, x0 + (x1 - x0) * Math.min(1, b + 0.5 / n), y1, z, '#1a1a16');
  }
}

// Concrete pad with seams, cracks and oil stains.
export function pad(ctx, w, h, z, color, seed) {
  box(ctx, 0, 0, w, h, 0, z, color, null, 0.3, seed);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  for (let i = 1; i < w; i++) line(ctx, iso(i, 0, z), iso(i, h, z), 'rgba(0,0,0,0.22)');
  for (let i = 1; i < h; i++) line(ctx, iso(0, i, z), iso(w, i, z), 'rgba(0,0,0,0.22)');
  for (let k = 0; k < w * h * 2; k++) {
    const [sx, sy] = iso(hash(seed, k) * w, hash(k, seed) * h, z);
    ctx.fillStyle = k % 3 ? 'rgba(20,18,14,0.35)' : 'rgba(40,30,18,0.4)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 2 + hash(k, k) * 6, 1 + hash(k, 2) * 3, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// Extruded convex polygon in a rotated local frame (f = forward, q = side).
export function prism(ctx, cx, cy, dir, pts, z0, z1, color, top) {
  const c = Math.cos(dir), s = Math.sin(dir);
  const wp = pts.map(([f, q]) => [cx + c * f - s * q, cy + s * f + c * q]);
  let area = 0;
  for (let i = 0; i < wp.length; i++) { const a = wp[i], b = wp[(i + 1) % wp.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < wp.length; i++) {
    const a = wp[i], b = wp[(i + 1) % wp.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = dy / l * sign, ny = -dx / l * sign;
    if (nx + ny <= 0) continue;
    const light = 0.6 + 0.3 * Math.max(-1, Math.min(1, -nx * 0.7 + ny * 0.7));
    poly(ctx, [iso(a[0], a[1], z0), iso(b[0], b[1], z0), iso(b[0], b[1], z1), iso(a[0], a[1], z1)], shade(color, light));
  }
  poly(ctx, wp.map(p => iso(p[0], p[1], z1)), top || shade(color, 1.06));
  return wp;
}

export function rect(L0, L1, W) { return [[L0, -W / 2], [L1, -W / 2], [L1, W / 2], [L0, W / 2]]; }

export function octagon(r, stretch = 1) {
  const out = [];
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; out.push([Math.cos(a) * r * stretch, Math.sin(a) * r]); }
  return out;
}

// Local-frame point to world.
export function local(cx, cy, dir, f, q) {
  const c = Math.cos(dir), s = Math.sin(dir);
  return [cx + c * f - s * q, cy + s * f + c * q];
}

export function barrel(ctx, cx, cy, dir, from, len, z, width, color = '#1c1d18') {
  const a = iso(cx + Math.cos(dir) * from, cy + Math.sin(dir) * from, z);
  const b = iso(cx + Math.cos(dir) * (from + len), cy + Math.sin(dir) * (from + len), z);
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = width + 2; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.lineWidth = 1;
  return b;
}

export function shadow(ctx, x, y, r) {
  const [sx, sy] = iso(x, y);
  ctx.fillStyle = 'rgba(8,12,18,0.24)';
  ctx.beginPath(); ctx.ellipse(sx + 2, sy + 1, r * 45, r * 22, 0, 0, Math.PI * 2); ctx.fill();
}

export function turretFirst(dir) { return Math.cos(dir) + Math.sin(dir) < 0; }
