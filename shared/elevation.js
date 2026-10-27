// Terrain elevation (RA2 style): plateaus with cliff edges and ramps, plus gentle hills.
// Heights live on tile corners ((w+1) x (h+1), in units of LEVEL_PX art pixels). A tile is:
//   flat  - all four corners equal (buildable)
//   slope - corners differ by 1 (passable, not buildable)
//   cliff - corners differ by 2+ (impassable; the terrain is set to T.CLIFF)
// Everything is derived from the already-symmetric terrain plus symmetric noise, so maps stay fair.
import { T, mulberry32, fractal, terrainPassable, MOVE } from './map.js';

export const LEVEL_PX = 12;
const PLATEAU = 2, HILL = 1;

// sym: 'point' (2-fold) or 'rot4'
export function elevate(map, seed, sym) {
  const { w, h, terrain } = map;
  const n = w, n1 = w - 1, CW = w + 1;
  const fwd = sym === 'rot4'
    ? [(x, y) => [x, y], (x, y) => [n1 - y, x], (x, y) => [n1 - x, n1 - y], (x, y) => [y, n1 - x]]
    : [(x, y) => [x, y], (x, y) => [n1 - x, n1 - y]];
  const canon = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = Infinity;
    for (const f of fwd) { const [a, b] = f(x, y); best = Math.min(best, b * w + a); }
    canon[y * w + x] = best;
  }

  // --- where relief is allowed: keep water, bridges, bases, towns, derricks and map edges flat ---
  const excl = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = terrain[y * w + x];
    if (t === T.WATER || t === T.BRIDGE || t === T.ICE || x < 2 || y < 2 || x > w - 3 || y > h - 3) excl[y * w + x] = 1;
  }
  // all symmetric images of the start (a 4-way map played 2-player still has 4 base sites)
  const allStarts = [];
  for (const f of fwd) { const [a, b] = f(map.starts[0].x, map.starts[0].y); allStarts.push({ x: a, y: b }); }
  const mark = (x0, y0, x1, y1) => { for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) excl[y * w + x] = 1; };
  for (const s of allStarts) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x + 0.5 - (s.x + 0.5), y + 0.5 - (s.y + 0.5)) < 13) excl[y * w + x] = 1;
  for (const d of map.derricks) mark(d.x - 2, d.y - 2, d.x + 3, d.y + 3);
  const SZ = { house: [2, 2], tenement: [2, 3], tenementB: [3, 2], office: [3, 3] };
  for (const c of map.civ || []) { const [fw, fh] = SZ[c.type] || [3, 3]; mark(c.x - 1, c.y - 1, c.x + fw, c.y + fh); }
  // a tile is excluded if any of its mirror images is (keeps heights symmetric even on uneven terrain)
  const img = i => { const x = i % w, y = (i - x) / w; return fwd.map(f => { const [a, b] = f(x, y); return b * w + a; }); };
  const ex2 = new Uint8Array(excl);
  for (let i = 0; i < w * h; i++) if (excl[i]) for (const j of img(i)) ex2[j] = 1;
  excl.set(ex2);
  // Chebyshev distance to the nearest excluded tile
  const dist = new Uint8Array(w * h).fill(255);
  const q = [];
  for (let i = 0; i < w * h; i++) if (excl[i]) { dist[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; q.push(j); }
    }
  }
  const land = t => t === T.GRASS || t === T.TREE || t === T.ROCK || t === T.SAND || t === T.RUIN;

  // --- plateau and hill masks from symmetric noise ---
  const pn = fractal(mulberry32((seed ^ 0x51ed27) >>> 0), w, 9);
  const hn = fractal(mulberry32((seed ^ 0x2c1b3) >>> 0), w, 5);
  let plat = new Uint8Array(w * h);
  const hill = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!img(i).every(j => land(terrain[j]))) continue;
    if (dist[i] >= 3 && pn[canon[i]] > 0.6) plat[i] = 1;
    if (dist[i] >= 2 && hn[canon[i]] > 0.66) hill[i] = 1;
  }
  // opening (erode then dilate) removes thin spurs so plateau tops are usable
  const morph = (m, erode) => {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = erode ? 1 : 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        const s = nx >= 0 && ny >= 0 && nx < w && ny < h ? m[ny * w + nx] : 0;
        if (erode && !s) v = 0;
        if (!erode && s) v = 1;
      }
      o[y * w + x] = v;
    }
    return o;
  };
  plat = morph(morph(plat, true), false);
  for (let i = 0; i < w * h; i++) if (plat[i] && dist[i] < 3) plat[i] = 0;
  const comps = components(plat, w, h).filter(c => c.length >= 14);
  plat.fill(0);
  comps.forEach((c, k) => { for (const i of c) plat[i] = k + 1; });

  const reachBefore = reach(terrain, w, h, map.starts[0]);

  // --- build corner heights for the current set of plateaus, cut ramps, verify, drop offenders ---
  let alive = new Set(comps.map((_, k) => k + 1));
  let hgt, terr;
  for (let iter = 0; iter < 12; iter++) {
    const target = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) target[i] = plat[i] && alive.has(plat[i]) ? PLATEAU : hill[i] ? HILL : 0;
    hgt = new Uint8Array(CW * (h + 1));
    for (let cy = 0; cy <= h; cy++) for (let cx = 0; cx <= w; cx++) {
      let m = 0;
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        if (tx >= 0 && ty >= 0 && tx < w && ty < h) m = Math.max(m, target[ty * w + tx]);
      }
      hgt[cy * CW + cx] = m;
    }
    cutRamps(hgt, target, plat, alive, w, h, canon, fwd, allStarts);
    terr = new Uint8Array(terrain);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (range(hgt, CW, x, y) >= 2 && land(terr[y * w + x])) terr[y * w + x] = T.CLIFF;
    }
    // every plateau must be reachable and nothing that was reachable may be cut off
    const r = reach(terr, w, h, map.starts[0]);
    const bad = new Set();
    const startsOk = map.starts.every(s => r[s.y * w + s.x]);
    for (let i = 0; i < w * h; i++) {
      const lost = reachBefore[i] && !r[i] && terrainPassable(terr[i], MOVE.GROUND);
      const strandedTop = plat[i] && alive.has(plat[i]) && !r[i] && terrainPassable(terr[i], MOVE.GROUND);
      if (strandedTop) bad.add(plat[i]);
      if (lost) {
        // blame plateaus near the cut-off tile
        const x = i % w, y = (i - x) / w;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && plat[ny * w + nx]) bad.add(plat[ny * w + nx]);
        }
      }
    }
    if (!startsOk) { alive = new Set(); continue; }
    if (!bad.size) break;
    // drop the offending plateaus together with their mirror images
    for (const b of [...bad]) for (const i of comps[b - 1]) for (const j of img(i)) if (plat[j]) bad.add(plat[j]);
    for (const b of bad) alive.delete(b);
    if (iter === 11) { alive = new Set(); }
  }
  map.terrain = terr;
  map.hgt = hgt;
  return map;
}

function range(hgt, CW, x, y) {
  const a = hgt[y * CW + x], b = hgt[y * CW + x + 1], c = hgt[(y + 1) * CW + x], d = hgt[(y + 1) * CW + x + 1];
  return Math.max(a, b, c, d) - Math.min(a, b, c, d);
}

function components(mask, w, h) {
  const seen = new Uint8Array(w * h), out = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const c = [s]; seen[s] = 1;
    for (let k = 0; k < c.length; k++) {
      const i = c[k], x = i % w, y = (i - x) / w;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mask[j] && !seen[j]) { seen[j] = 1; c.push(j); }
      }
    }
    out.push(c);
  }
  return out;
}

function reach(terrain, w, h, s) {
  const r = new Uint8Array(w * h), q = [s.y * w + s.x];
  r[q[0]] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w, y = (i - x) / w;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!r[j] && terrainPassable(terrain[j], MOVE.GROUND)) { r[j] = 1; q.push(j); }
    }
  }
  return r;
}

// Three-tile-wide ramps where a straight plateau edge meets open low ground. Each ramp is placed
// together with all its mirror images, and choices are ranked by symmetry-invariant keys.
function cutRamps(hgt, target, plat, alive, w, h, canon, fwd, starts) {
  const CW = w + 1;
  const T_ = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? target[y * w + x] : -1);
  const valid = (x, y, dx, dy) => {
    const px = -dy, py = dx, lx = x + dx, ly = y + dy;
    for (const s of [-1, 0, 1]) {
      if (T_(x + px * s, y + py * s) !== PLATEAU) return false;
      if (T_(lx + px * s, ly + py * s) !== 0) return false;
      if (T_(lx + dx + px * s, ly + dy + py * s) !== 0) return false; // room to drive off the ramp
    }
    return true;
  };
  const make = (x, y, dx, dy) => {
    const px = -dy, py = dx, lx = x + dx, ly = y + dy;
    const corners = [];
    for (let k = -1; k <= 2; k++) corners.push(dx !== 0 ? [dx === 1 ? x + 1 : x, y + k] : [x + k, dy === 1 ? y + 1 : y]);
    const rows = [-1, 0, 1].flatMap(s => [[x + px * s, y + py * s], [lx + px * s, ly + py * s]]);
    return { x, y, lx, ly, corners, rows, comp: plat[y * w + x] };
  };
  // one representative per mirror orbit of (plateau tile, low tile) pairs
  const groups = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = plat[y * w + x];
    if (!p || !alive.has(p) || target[y * w + x] !== PLATEAU) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!valid(x, y, dx, dy)) continue;
      const imgs = fwd.map(f => { const [a, b] = f(x, y), [c, d] = f(x + dx, y + dy); return [a, b, c - a, d - b]; });
      const key = Math.min(...imgs.map(([a, b, ddx, ddy]) => ((b * w + a) * 4 + (ddx === 1 ? 0 : ddx === -1 ? 1 : ddy === 1 ? 2 : 3))));
      if (groups.has(key)) continue;
      const parts = [], seen = new Set();
      for (const [a, b, ddx, ddy] of imgs) {
        const k2 = `${a},${b},${ddx},${ddy}`;
        if (seen.has(k2)) continue;
        seen.add(k2);
        parts.push(make(a, b, ddx, ddy));
      }
      const face = Math.min(...starts.map(st => Math.hypot(st.x - (x + dx), st.y - (y + dy))));
      groups.set(key, { key, face, parts });
    }
  }
  const list = [...groups.values()].sort((a, b) => a.face - b.face || a.key - b.key);
  const chosen = new Map(); // component -> ramps placed
  for (const g of list) {
    if (g.parts.some(c => (chosen.get(c.comp) || []).length >= 2)) continue;
    if (g.parts.some(c => (chosen.get(c.comp) || []).some(o => Math.hypot(o.lx - c.lx, o.ly - c.ly) < 6))) continue;
    const saved = [];
    for (const c of g.parts) for (const [cx, cy] of c.corners) { saved.push([cy * CW + cx, hgt[cy * CW + cx]]); hgt[cy * CW + cx] = 1; }
    // every ramp tile must end up a gentle slope, otherwise undo the whole group
    if (!g.parts.every(c => c.rows.every(([tx, ty]) => range(hgt, CW, tx, ty) <= 1))) {
      for (let k = saved.length - 1; k >= 0; k--) hgt[saved[k][0]] = saved[k][1];
      continue;
    }
    for (const c of g.parts) { if (!chosen.has(c.comp)) chosen.set(c.comp, []); chosen.get(c.comp).push(c); }
  }
}

// Ground height (art px) at a world position, bilinear across the tile's corners.
export function groundZ(hgt, w, h, x, y) {
  if (!hgt) return 0;
  const CW = w + 1;
  const tx = Math.max(0, Math.min(w - 1, Math.floor(x))), ty = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - tx)), fy = Math.max(0, Math.min(1, y - ty));
  const a = hgt[ty * CW + tx], b = hgt[ty * CW + tx + 1], c = hgt[(ty + 1) * CW + tx], d = hgt[(ty + 1) * CW + tx + 1];
  return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * LEVEL_PX;
}

// True when every tile in the footprint is flat and at the same height.
export function flatArea(hgt, w, tx, ty, fw, fh) {
  if (!hgt) return true;
  const CW = w + 1, v = hgt[ty * CW + tx];
  for (let y = ty; y <= ty + fh; y++) for (let x = tx; x <= tx + fw; x++) if (hgt[y * CW + x] !== v) return false;
  return true;
}
