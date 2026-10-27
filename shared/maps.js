// Hand-designed scenario maps based on real Cold War flashpoints.
// Each map describes features once (canonical half/quadrant); the builder mirrors them
// (point symmetry for 2 players, 4-fold rotation for 4) so every start is equally fair.
import { T, mulberry32, fractal, generateMap, terrainPassable, buildable, widenCorridors, MOVE } from './map.js';
import { elevate } from './elevation.js';

function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function polyDist(px, py, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}

class MapBuilder {
  constructor(n, sym, seed) {
    this.n = n; this.n1 = n - 1; this.c = (n - 1) / 2;
    this.sym = sym;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.t = new Uint8Array(n * n);
    this.oreMap = new Uint16Array(n * n);
    this.derrickC = [];
    this.civC = [];
    this.noCiv = new Uint8Array(n * n);
    this.startC = [0, 0];
    this.wob = fractal(mulberry32(seed + 1), n, 6);
    const n1 = this.n1;
    this.fwd = sym === 'rot4'
      ? [(x, y) => [x, y], (x, y) => [n1 - y, x], (x, y) => [n1 - x, n1 - y], (x, y) => [y, n1 - x]]
      : [(x, y) => [x, y], (x, y) => [n1 - x, n1 - y]];
    this.inv = sym === 'rot4'
      ? [(x, y) => [x, y], (x, y) => [y, n1 - x], (x, y) => [n1 - x, n1 - y], (x, y) => [n1 - y, x]]
      : this.fwd;
    // street grid phase chosen so the grid maps onto itself under the map's symmetry
    for (let o = 0; o < 5; o++) if ((((n1 - 2 * o) % 5) + 5) % 5 === 1) this.go = o;
    // canonical tile = smallest index in its orbit (for symmetric noise)
    this.canon = new Int32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let best = Infinity;
      for (const f of this.fwd) { const [a, b] = f(x, y); best = Math.min(best, Math.round(b) * n + Math.round(a)); }
      this.canon[y * n + x] = best;
    }
  }
  f(v) { return v * this.n1; }
  get(x, y) { return this.t[y * this.n + x]; }
  wobble(x, y) {
    const xi = Math.max(0, Math.min(this.n1, Math.round(x))), yi = Math.max(0, Math.min(this.n1, Math.round(y)));
    return this.wob[yi * this.n + xi] - 0.5;
  }
  // Apply fn(x, y, px, py) for each tile whose canonical preimage (px, py) satisfies test.
  shape(test, fn) {
    const n = this.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      for (const inv of this.inv) {
        const [px, py] = inv(x, y);
        if (test(px, py)) { fn(x, y, px, py); break; }
      }
    }
  }
  set(x, y, t) { this.t[y * this.n + x] = t; }
  disc(cx, cy, r, type, wob = 0.4, only = null) {
    this.shape((px, py) => Math.hypot(px - cx, py - cy) <= r * (1 + wob * this.wobble(px, py) * 2),
      (x, y) => { if (only === null || only.includes(this.get(x, y))) this.set(x, y, type); });
  }
  line(pts, w, type, wob = 0.3, only = null) {
    this.shape((px, py) => polyDist(px, py, pts) <= w * (1 + wob * this.wobble(px, py) * 2),
      (x, y) => { if (only === null || only.includes(this.get(x, y))) this.set(x, y, type); });
  }
  river(pts, w) {
    this.line(pts, w + 1.3, T.SAND, 0.25, [T.GRASS, T.TREE, T.ROCK]);
    this.line(pts, w, T.WATER, 0.25);
  }
  // Flood the whole map (island maps start from open water).
  sea() { this.t.fill(T.WATER); }
  // Island of radius r with a sandy beach; only replaces water/beach so islands can overlap features.
  island(cx, cy, r, wob = 0.25, beach = 1.3) {
    this.disc(cx, cy, r + beach, T.SAND, wob, [T.WATER]);
    this.disc(cx, cy, r, T.GRASS, wob, [T.WATER, T.SAND]);
  }
  // Land where test(px, py) holds on the canonical side (coastlines), with a beach strip.
  land(test, beachTest = null) {
    this.shape((px, py) => (beachTest || test)(px, py), (x, y) => { if (this.get(x, y) === T.WATER) this.set(x, y, T.SAND); });
    this.shape(test, (x, y) => { if (this.get(x, y) === T.WATER || this.get(x, y) === T.SAND) this.set(x, y, T.GRASS); });
  }
  // RA2-style bridge: straight along one grid axis, 2 tiles wide, crossing the water near the midpoint
  // of a-b and ending in a ramp (abutment) row on dry land at both ends. Built on the canonical side
  // and copied to every mirror image, so it stays fair.
  bridge(a, b) {
    const n = this.n;
    const wet = t => t === T.WATER || t === T.ICE || t === T.BRIDGE;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const plan = ax => {
      const um = ax === 'x' ? mx : my, vm = ax === 'x' ? my : mx;
      const lo = Math.round(vm - 0.5);
      const at = (u, k) => { const x = ax === 'x' ? u : lo + k, y = ax === 'x' ? lo + k : u; return x < 0 || y < 0 || x >= n || y >= n ? -1 : this.get(x, y); };
      const rowWet = u => at(u, 0) >= 0 && at(u, 1) >= 0 && (wet(at(u, 0)) || wet(at(u, 1)));
      const rowLand = u => at(u, 0) >= 0 && at(u, 1) >= 0 && !wet(at(u, 0)) && !wet(at(u, 1));
      let st = null;
      for (let d = 0; d <= 4 && st === null; d++) for (const u of [Math.floor(um) + d, Math.floor(um) - d]) if (rowWet(u)) { st = u; break; }
      if (st === null) return null;
      let s0 = st, s1 = st;
      while (rowWet(s0 - 1)) s0--;
      while (rowWet(s1 + 1)) s1++;
      if (!rowLand(s0 - 1) || !rowLand(s1 + 1)) return null;
      return { ax, lo, s0, s1, len: s1 - s0 + 1 };
    };
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    const px = plan('x'), py = plan('y');
    let p = null;
    if (dx > dy * 1.4) p = px || py;
    else if (dy > dx * 1.4) p = py || px;
    else p = px && py ? (px.len <= py.len ? px : py) : px || py;
    if (!p) return;
    const put = (u, k, fn) => {
      const x = p.ax === 'x' ? u : p.lo + k, y = p.ax === 'x' ? p.lo + k : u;
      for (const f of this.fwd) { const [X, Y] = f(x, y); if (X >= 0 && Y >= 0 && X < n && Y < n) fn(X, Y); }
    };
    for (let u = p.s0; u <= p.s1; u++) for (const k of [0, 1]) put(u, k, (X, Y) => { this.set(X, Y, T.BRIDGE); this.noCiv[Y * n + X] = 1; });
    // ramps rest on a road row at each end; keep the approaches clear of town buildings
    for (const u of [p.s0 - 1, p.s1 + 1]) for (const k of [0, 1]) put(u, k, (X, Y) => this.set(X, Y, T.SAND));
    for (let u = p.s0 - 3; u <= p.s1 + 3; u++) for (let k = -1; k <= 2; k++) put(u, k, (X, Y) => { this.noCiv[Y * n + X] = 1; });
  }
  // Clear an area; nothing civilian is built there (bases, checkpoints, plazas).
  clear(cx, cy, r, type = T.GRASS) {
    this.shape((px, py) => Math.hypot(px - cx, py - cy) <= r * (1 + 0.15 * this.wobble(px, py) * 2),
      (x, y) => { this.set(x, y, type); this.noCiv[y * this.n + x] = 1; });
  }
  noise(type, scale, threshold, only = [T.GRASS]) {
    const field = fractal(mulberry32(this.seed + type * 31 + scale * 7 + Math.round(threshold * 100)), this.n, scale);
    for (let i = 0; i < this.t.length; i++) {
      if (field[this.canon[i]] > threshold && only.includes(this.t[i])) this.t[i] = type;
    }
  }
  street(v) { return ((v - this.go) % 5 + 5) % 5 <= 1; }

  // A town or city district: a grid of 2-tile-wide streets around 3x3 blocks holding garrisonable
  // civilian buildings (offices, apartment blocks, houses), rubble lots and small parks.
  city(cx, cy, r, density) {
    const { n, n1 } = this;
    const inCity = (x, y) => this.inv.some(inv => { const [px, py] = inv(x, y); return Math.hypot(px - cx, py - cy) <= r; });
    const keepT = t => t === T.WATER || t === T.BRIDGE || t === T.ICE;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if ((this.street(x) || this.street(y)) && inCity(x, y) && !keepT(this.get(x, y))) this.set(x, y, T.SAND);
    }
    const starts = [];
    for (let v = 0; v + 2 <= n1; v++) if (((v - this.go) % 5 + 5) % 5 === 2) starts.push(v);
    const img = (x, y, w, h, f) => {
      const a = f(x, y), b = f(x + w - 1, y + h - 1);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
    };
    for (const by of starts) for (const bx of starts) {
      if (!inCity(bx + 1, by + 1)) continue;
      const imgs = this.fwd.map(f => img(bx, by, 3, 3, f));
      const key = ([x, y]) => y * n + x;
      const rep = Math.min(...imgs.map(key));
      if (rep !== by * n + bx) continue; // only the canonical block of each mirrored set
      const selfSym = imgs.filter(p => key(p) === rep).length > 1;
      const h = hash2(bx * 7 + this.seed, by * 13 + 5), h2 = hash2(by + this.seed, bx * 3);
      const kind = selfSym ? (h < density ? 'office' : 'plaza')
        : h < density * 0.38 ? 'office' : h < density * 0.7 ? 'tenement' : h < density ? 'house' : h < density + 0.12 ? 'rubble' : 'park';
      const put = (lx, ly, t) => {
        for (const f of this.fwd) {
          const [x, y] = f(bx + lx, by + ly);
          if (!keepT(this.get(x, y))) this.set(x, y, t);
        }
      };
      for (let ly = 0; ly < 3; ly++) for (let lx = 0; lx < 3; lx++) put(lx, ly, kind === 'park' ? T.GRASS : T.SAND);
      if (kind === 'office') this.civC.push({ x: bx, y: by, w: 3, h: 3 });
      else if (kind === 'tenement') {
        if (h2 < 0.5) { this.civC.push({ x: bx + (h2 < 0.25 ? 0 : 1), y: by, w: 2, h: 3 }); }
        else { this.civC.push({ x: bx, y: by + (h2 < 0.75 ? 0 : 1), w: 3, h: 2 }); }
      } else if (kind === 'house') {
        const ox = h2 < 0.5 ? 0 : 1, oy = (h2 * 4) % 1 < 0.5 ? 0 : 1;
        this.civC.push({ x: bx + ox, y: by + oy, w: 2, h: 2 });
        if (h2 > 0.7) put(ox ? 0 : 2, oy ? 0 : 2, T.TREE);
      } else if (kind === 'rubble') {
        put(0, 0, T.RUIN); put(1, 0, T.RUIN); if (h2 < 0.5) put(0, 1, T.RUIN);
      } else if (kind === 'park') {
        put(1, 1, T.TREE); if (h2 < 0.4) put(0, 2, T.TREE);
      }
    }
  }

  // Civilian building footprints (all mirrored images), dropping any set that no longer fits
  // so every side of the map gets the same buildings.
  resolveCivilians(starts) {
    const { n } = this;
    const occ = new Uint8Array(n * n);
    const civ = [];
    const types = { '2x2': 'house', '2x3': 'tenement', '3x2': 'tenementB', '3x3': 'office' };
    for (const c of this.civC) {
      const seen = new Set(), imgs = [];
      for (const f of this.fwd) {
        const a = f(c.x, c.y), b = f(c.x + c.w - 1, c.y + c.h - 1);
        const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]) + 1, h = Math.abs(a[1] - b[1]) + 1;
        const k = `${x},${y},${w},${h}`;
        if (!seen.has(k)) { seen.add(k); imgs.push({ x, y, w, h }); }
      }
      let ok = true;
      for (const im of imgs) {
        for (let y = im.y; y < im.y + im.h && ok; y++) for (let x = im.x; x < im.x + im.w && ok; x++) {
          const i = y * n + x;
          if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1 || !buildable(this.t[i]) || this.noCiv[i] || this.oreMap[i] || occ[i]) ok = false;
        }
        for (const [sx, sy] of starts) if (Math.hypot(im.x + im.w / 2 - sx, im.y + im.h / 2 - sy) < 11) ok = false;
      }
      if (!ok) continue;
      for (const im of imgs) {
        for (let y = im.y; y < im.y + im.h; y++) for (let x = im.x; x < im.x + im.w; x++) occ[y * n + x] = 1;
        civ.push({ type: types[`${im.w}x${im.h}`], x: im.x, y: im.y });
      }
    }
    return { civ, occ };
  }

  ore(cx, cy, r, amount) {
    this.shape((px, py) => Math.hypot(px - cx, py - cy) <= r, (x, y, px, py) => {
      const t = this.get(x, y);
      if (t === T.WATER || t === T.BRIDGE) return;
      this.set(x, y, T.GRASS);
      const d = Math.hypot(px - cx, py - cy) / r;
      const i = y * this.n + x;
      this.oreMap[i] = Math.max(this.oreMap[i], Math.round(amount * (1.15 - d * 0.6)));
    });
  }
  derrick(x, y) { this.derrickC.push([Math.round(x), Math.round(y)]); }
  start(x, y) { this.startC = [Math.round(x), Math.round(y)]; }

  connected(starts, blocked = null) {
    const n = this.n, seen = new Uint8Array(n * n);
    const s0 = starts[0][1] * n + starts[0][0];
    const q = [s0]; seen[s0] = 1;
    while (q.length) {
      const i = q.pop();
      const x = i % n, y = (i - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (seen[j] || !terrainPassable(this.t[j], MOVE.GROUND) || (blocked && blocked[j])) continue;
        seen[j] = 1; q.push(j);
      }
    }
    return starts.every(([x, y]) => seen[y * n + x]);
  }

  finish(meta, np) {
    const { n, n1 } = this;
    const [sx, sy] = this.startC;
    let starts = this.fwd.map(f => f(sx, sy).map(Math.round));
    // with fewer players on a 4-way map, use opposite corners first
    if (starts.length === 4) starts = [starts[0], starts[2], starts[1], starts[3]];
    // clear bases
    this.clear(sx, sy, 9.5);
    widenCorridors(this.t, n, n);
    // guarantee a land route between all starts (bridges over water, cleared paths elsewhere)
    if (!this.connected(starts)) {
      this.shape((px, py) => segDist(px, py, sx, sy, this.c, this.c) <= 1.4, (x, y) => {
        const t = this.get(x, y);
        if (t === T.WATER || t === T.ICE) this.set(x, y, T.BRIDGE);
        else if (!terrainPassable(t, MOVE.GROUND)) this.set(x, y, T.SAND);
        this.noCiv[y * n + x] = 1;
      });
    }
    for (const [dx, dy] of this.derrickC) {
      this.shape((px, py) => px >= dx - 1 && px <= dx + 2 && py >= dy - 1 && py <= dy + 2, (x, y) => { this.noCiv[y * n + x] = 1; });
    }
    let { civ, occ } = this.resolveCivilians(starts);
    if (!this.connected(starts, occ)) {
      // buildings sealed a route: keep a symmetric avenue free of them
      this.shape((px, py) => segDist(px, py, sx, sy, this.c, this.c) <= 1.6, (x, y) => { this.noCiv[y * n + x] = 1; });
      ({ civ, occ } = this.resolveCivilians(starts));
    }
    const derricks = [];
    for (const [dx, dy] of this.derrickC) {
      for (const f of this.fwd) {
        const [ax, ay] = f(dx, dy), [bx, by] = f(dx + 1, dy + 1);
        const x = Math.min(ax, bx), y = Math.min(ay, by);
        for (let yy = y - 1; yy <= y + 2; yy++) for (let xx = x - 1; xx <= x + 2; xx++) {
          if (xx >= 0 && yy >= 0 && xx < n && yy < n) { this.t[yy * n + xx] = T.GRASS; this.oreMap[yy * n + xx] = 0; }
        }
        derricks.push({ x, y });
      }
    }
    // keep the map border walkable-looking
    for (let i = 0; i < n; i++) for (const [x, y] of [[i, 0], [i, n1], [0, i], [n1, i]]) {
      if (this.t[y * n + x] === T.RUIN) this.t[y * n + x] = T.SAND;
    }
    for (let i = 0; i < n * n; i++) if (this.oreMap[i] && this.t[i] !== T.GRASS && this.t[i] !== T.SAND) this.oreMap[i] = 0;
    const variant = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) variant[i] = Math.floor(this.rng() * 256);
    return { w: n, h: n, terrain: this.t, ore: this.oreMap, starts: starts.slice(0, np).map(([x, y]) => ({ x, y })), derricks, civ, variant, biome: meta.biome, name: meta.name };
  }
}

// Shared helpers used by several maps.
function baseOre(b, s) {
  const f = v => b.f(v);
  b.ore(f(s + 0.14), f(s + 0.03), 2.6, 620);
  b.ore(f(s + 0.02), f(s + 0.15), 2.4, 620);
}

export const MAPS = [
  // ---------------- TEMPERATE ----------------
  {
    id: 'fulda', name: 'Fulda Gap', year: 1985, place: 'West Germany', biome: 'temperate', players: 2, n: 68, sym: 'point',
    desc: 'The expected invasion route into West Germany. Rolling farmland and woods split by the Fulda river and three bridges.',
    build(b) {
      const f = v => b.f(v), c = b.c, n1 = b.n1;
      b.start(f(0.13), f(0.13));
      b.noise(T.TREE, 6, 0.64);
      b.noise(T.ROCK, 5, 0.84);
      b.river([[0, n1], [f(0.2), f(0.84)], [f(0.33), f(0.64)], [c, c]], 1.3);
      b.bridge([f(0.2) - 3, f(0.82) - 3], [f(0.2) + 3, f(0.82) + 3], 1.1);
      b.bridge([c - 3, c - 3], [c + 3, c + 3], 1.2);
      b.city(f(0.33), f(0.3), 6.5, 0.8);
      b.city(f(0.12), f(0.5), 5.5, 0.75);
      baseOre(b, 0.13);
      b.ore(f(0.45), f(0.36), 3, 800);
      b.ore(f(0.06), f(0.7), 3, 900);
      b.derrick(f(0.32), f(0.48));
    },
  },
  {
    id: 'berlin', name: 'Berlin', year: 1961, place: 'Germany', biome: 'temperate', players: 2, n: 64, sym: 'point',
    desc: 'A divided city. Blocks of apartments and offices to garrison, the Spree, and the Wall cutting through the middle with only a few checkpoints open.',
    build(b) {
      const f = v => b.f(v), c = b.c, n1 = b.n1;
      b.start(f(0.12), f(0.12));
      b.city(c, c, b.n * 0.9, 0.72);
      b.disc(f(0.36), f(0.3), 3.6, T.TREE, 0.4, [T.GRASS, T.SAND]);
      b.river([[0, f(0.38)], [f(0.22), f(0.46)], [f(0.36), f(0.6)], [c, c]], 1.0);
      b.bridge([f(0.22) - 2.5, f(0.46) + 2.5], [f(0.22) + 2.5, f(0.46) - 2.5], 1.3);
      b.bridge([f(0.36) - 2.5, f(0.6) + 2.5], [f(0.36) + 2.5, f(0.6) - 2.5], 1.3);
      b.line([[0, n1], [c, c]], 0.6, T.RUIN, 0, [T.GRASS, T.SAND, T.TREE]);
      b.clear(f(0.25), f(0.75), 2.6, T.SAND);
      b.clear(f(0.1), f(0.9), 2.4, T.SAND);
      b.clear(c, c, 2.8, T.SAND);
      baseOre(b, 0.12);
      b.ore(f(0.42), f(0.14), 2.6, 800);
      b.derrick(f(0.14), f(0.4));
    },
  },
  {
    id: 'budapest', name: 'Budapest', year: 1956, place: 'Hungary', biome: 'temperate', players: 2, n: 68, sym: 'point',
    desc: 'The Hungarian Uprising. Buda and Pest face each other across the Danube, joined by the city bridges and Margaret Island.',
    build(b) {
      const f = v => b.f(v), c = b.c;
      b.start(f(0.12), f(0.88));
      b.noise(T.TREE, 6, 0.68);
      b.noise(T.ROCK, 5, 0.8);
      b.river([[0, 0], [f(0.2), f(0.24)], [f(0.34), f(0.32)], [c, c]], 1.7);
      b.disc(f(0.28), f(0.29), 1.6, T.GRASS, 0.1, [T.WATER]);
      b.bridge([f(0.18) - 3, f(0.22) + 3], [f(0.18) + 3, f(0.22) - 3], 1);
      b.bridge([f(0.28) - 3, f(0.29) + 3], [f(0.28) + 3, f(0.29) - 3], 1);
      b.bridge([c - 3, c + 3], [c + 3, c - 3], 1.2);
      b.city(f(0.32), f(0.5), 9, 0.8);
      b.city(f(0.15), f(0.42), 5.5, 0.75);
      b.ore(f(0.24), f(0.86), 2.6, 620);
      b.ore(f(0.1), f(0.74), 2.4, 620);
      b.ore(f(0.45), f(0.7), 3, 850);
      b.derrick(f(0.08), f(0.58));
    },
  },
  {
    id: 'prague', name: 'Prague Spring', year: 1968, place: 'Czechoslovakia', biome: 'temperate', players: 4, n: 84, sym: 'rot4',
    desc: 'Warsaw Pact tanks roll into Prague. The Vltava winds through the city, with the old town at its heart and wooded hills beyond.',
    build(b) {
      const f = v => b.f(v), c = b.c;
      b.start(f(0.12), f(0.12));
      b.noise(T.TREE, 6, 0.66);
      b.noise(T.ROCK, 5, 0.85);
      b.river([[c, c], [f(0.56), f(0.32)], [f(0.62), f(0.14)], [f(0.62), 0]], 1.3);
      b.bridge([f(0.58) - 3, f(0.24)], [f(0.58) + 3, f(0.24)], 1);
      b.city(c, c, 14, 0.8);
      b.clear(c, c, 2.2, T.SAND);
      baseOre(b, 0.12);
      b.ore(f(0.32), f(0.3), 3, 800);
      b.derrick(f(0.4), f(0.12));
    },
  },
  // ---------------- ARCTIC ----------------
  {
    id: 'kola', name: 'Kola Peninsula', year: 1983, place: 'Soviet Arctic', biome: 'arctic', players: 2, n: 68, sym: 'point',
    desc: "The Northern Fleet's home waters. Taiga, frozen lakes you can drive across, and the Barents Sea on both flanks.",
    build(b) {
      const f = v => b.f(v), c = b.c, n1 = b.n1;
      b.start(f(0.13), f(0.13));
      b.noise(T.TREE, 5, 0.62);
      b.noise(T.ROCK, 6, 0.8);
      b.disc(0, n1, 15, T.ICE, 0.3);
      b.disc(0, n1, 11, T.WATER, 0.3);
      b.disc(f(0.36), f(0.2), 4, T.ICE, 0.4);
      b.disc(f(0.2), f(0.42), 3.2, T.ICE, 0.4);
      b.disc(c, c, 5, T.ICE, 0.4);
      b.city(f(0.4), f(0.4), 6, 0.85);
      baseOre(b, 0.13);
      b.ore(f(0.45), f(0.3), 3, 850);
      b.derrick(f(0.3), f(0.45));
    },
  },
  {
    id: 'chosin', name: 'Chosin Reservoir', year: 1950, place: 'North Korea', biome: 'arctic', players: 2, n: 64, sym: 'point',
    desc: 'Frozen mountains in the Korean winter. Narrow valley roads run around a reservoir frozen hard enough to drive tanks across.',
    build(b) {
      const f = v => b.f(v), c = b.c;
      b.start(f(0.12), f(0.12));
      b.noise(T.ROCK, 7, 0.55);
      b.noise(T.TREE, 5, 0.72);
      b.line([[f(0.12), f(0.12)], [f(0.24), f(0.48)], [c, c]], 2.6, T.GRASS, 0.3);
      b.line([[f(0.12), f(0.12)], [f(0.48), f(0.24)], [c, c]], 2.6, T.GRASS, 0.3);
      b.disc(c, c, 7.5, T.ICE, 0.35);
      b.disc(c, c, 2.5, T.WATER, 0.3);
      b.city(f(0.24), f(0.3), 5, 0.85);
      baseOre(b, 0.12);
      b.ore(f(0.3), f(0.38), 2.6, 850);
      b.derrick(f(0.46), f(0.1));
    },
  },
  {
    id: 'finnmark', name: 'Finnmark', year: 1984, place: 'Norway', biome: 'arctic', players: 4, n: 80, sym: 'rot4',
    desc: "NATO's northern flank, bordering the USSR. Deep fjords cut inland, with ice crossings at their heads and snowbound forests.",
    build(b) {
      const f = v => b.f(v);
      b.start(f(0.12), f(0.12));
      b.noise(T.TREE, 5, 0.62);
      b.noise(T.ROCK, 6, 0.8);
      b.river([[f(0.5), 0], [f(0.45), f(0.16)], [f(0.5), f(0.3)]], 2.2);
      b.line([[f(0.38), f(0.24)], [f(0.6), f(0.24)]], 1.2, T.ICE, 0, [T.WATER]);
      b.disc(f(0.3), f(0.3), 3, T.ICE, 0.4);
      b.city(f(0.3), f(0.2), 6, 0.85);
      baseOre(b, 0.12);
      b.ore(f(0.28), f(0.42), 3, 820);
      b.derrick(f(0.2), f(0.36));
    },
  },
  {
    id: 'keflavik', name: 'Keflavik', year: 1973, place: 'Iceland', biome: 'arctic', players: 2, n: 64, sym: 'point',
    desc: 'The NATO air station guarding the GIUK gap. Black lava fields, geothermal pools, and a cold coastline.',
    build(b) {
      const f = v => b.f(v), c = b.c, n1 = b.n1;
      b.start(f(0.13), f(0.13));
      b.noise(T.ROCK, 4, 0.6);
      b.disc(n1, 0, 13, T.WATER, 0.35);
      b.disc(f(0.3), f(0.4), 1.8, T.WATER, 0.3);
      b.disc(c, c, 2.2, T.WATER, 0.3);
      b.line([[f(0.28), f(0.06)], [f(0.06), f(0.28)]], 0.9, T.SAND, 0, [T.GRASS, T.ROCK]);
      b.city(f(0.36), f(0.14), 6, 0.85);
      baseOre(b, 0.13);
      b.ore(f(0.4), f(0.22), 3, 820);
      b.derrick(f(0.48), f(0.3));
    },
  },
  // ---------------- DESERT ----------------
  {
    id: 'suez', name: 'Suez Canal', year: 1973, place: 'Egypt', biome: 'desert', players: 2, n: 68, sym: 'point',
    desc: 'The Yom Kippur War crossing. A straight canal with pontoon bridges, the Great Bitter Lakes, and oil fields in the sand.',
    build(b) {
      const f = v => b.f(v), c = b.c, n1 = b.n1;
      b.start(f(0.13), f(0.13));
      b.noise(T.SAND, 5, 0.58);
      b.noise(T.ROCK, 6, 0.82, [T.GRASS, T.SAND]);
      b.noise(T.TREE, 4, 0.82);
      b.river([[0, n1], [c, c]], 1.4);
      b.disc(f(0.36), f(0.64), 3.6, T.WATER, 0.3);
      b.bridge([f(0.2) - 3, f(0.8) - 3], [f(0.2) + 3, f(0.8) + 3], 1);
      b.bridge([c - 3, c - 3], [c + 3, c + 3], 1);
      b.city(f(0.3), f(0.36), 6, 0.85);
      baseOre(b, 0.13);
      b.ore(f(0.42), f(0.3), 3, 820);
      b.derrick(f(0.3), f(0.46));
      b.derrick(f(0.08), f(0.5));
    },
  },
  {
    id: 'golan', name: 'Golan Heights', year: 1973, place: 'Israel–Syria', biome: 'desert', players: 2, n: 64, sym: 'point',
    desc: 'A basalt plateau with steep escarpments and few passes. The ruined town of Quneitra stands in no man\'s land.',
    build(b) {
      const f = v => b.f(v), c = b.c;
      b.start(f(0.12), f(0.12));
      b.noise(T.ROCK, 5, 0.76);
      b.noise(T.TREE, 4, 0.82);
      b.line([[0, f(0.68)], [f(0.68), 0]], 1.3, T.ROCK, 0.3);
      b.clear(f(0.14), f(0.54), 2.2);
      b.clear(f(0.48), f(0.2), 2.2);
      b.clear(f(0.34), f(0.34), 2.0);
      b.disc(f(0.08), f(0.78), 4.5, T.WATER, 0.3);
      b.city(c, c, 7.5, 0.8);
      baseOre(b, 0.12);
      b.ore(f(0.38), f(0.5), 2.8, 820);
      b.derrick(f(0.5), f(0.38));
    },
  },
  {
    id: 'panjshir', name: 'Panjshir Valley', year: 1984, place: 'Afghanistan', biome: 'desert', players: 2, n: 68, sym: 'point',
    desc: 'The Soviet–Afghan War. A long valley between impassable mountains, ideal country for guerrilla fighters.',
    build(b) {
      const f = v => b.f(v), c = b.c;
      b.start(f(0.13), f(0.13));
      b.noise(T.ROCK, 6, 0.48);
      b.line([[0, 0], [f(0.22), f(0.2)], [c, c]], 4.2, T.GRASS, 0.3);
      b.line([[f(0.13), f(0.13)], [f(0.5), f(0.18)], [f(0.62), f(0.3)]], 2.2, T.GRASS, 0.3);
      b.line([[f(0.13), f(0.13)], [f(0.16), f(0.5)], [f(0.3), f(0.62)]], 2.2, T.GRASS, 0.3);
      b.noise(T.TREE, 4, 0.8);
      b.city(f(0.3), f(0.28), 5.5, 0.8);
      baseOre(b, 0.13);
      b.ore(f(0.48), f(0.18), 2.6, 850);
      b.ore(f(0.37), f(0.37), 2.4, 800);
      b.derrick(f(0.2), f(0.48));
    },
  },
  {
    id: 'ogaden', name: 'Ogaden', year: 1977, place: 'Ethiopia–Somalia', biome: 'desert', players: 4, n: 84, sym: 'rot4',
    desc: 'A war over dry scrubland on the Horn of Africa. Sandy riverbeds, scattered acacia, and rare waterholes.',
    build(b) {
      const f = v => b.f(v), c = b.c;
      b.start(f(0.12), f(0.12));
      b.noise(T.TREE, 4, 0.76);
      b.noise(T.ROCK, 6, 0.84);
      b.line([[c, c], [f(0.62), f(0.3)], [f(0.7), 0]], 1.6, T.SAND, 0.4);
      b.disc(f(0.3), f(0.5), 2, T.WATER, 0.3);
      b.city(f(0.3), f(0.3), 6.5, 0.85);
      baseOre(b, 0.12);
      b.ore(f(0.34), f(0.3), 3, 850);
      b.derrick(f(0.46), f(0.18));
    },
  },
  // ---------------- JUNGLE ----------------
  {
    id: 'iadrang', name: 'Ia Drang Valley', year: 1965, place: 'South Vietnam', biome: 'jungle', players: 2, n: 64, sym: 'point',
    desc: 'The first big battle of the Vietnam War. Thick jungle, a winding river, and landing-zone clearings such as LZ X-Ray.',
    build(b) {
      const f = v => b.f(v), c = b.c, n1 = b.n1;
      b.start(f(0.12), f(0.12));
      b.noise(T.TREE, 5, 0.44);
      b.noise(T.ROCK, 5, 0.84, [T.GRASS, T.TREE]);
      b.disc(f(0.08), f(0.6), 4, T.ROCK, 0.4);
      b.river([[0, n1], [f(0.24), f(0.72)], [f(0.38), f(0.6)], [c, c]], 1.2);
      b.bridge([f(0.24) - 2.5, f(0.72) - 2.5], [f(0.24) + 2.5, f(0.72) + 2.5], 1);
      b.clear(f(0.3), f(0.36), 4);
      b.clear(f(0.44), f(0.18), 3);
      b.line([[f(0.12), f(0.12)], [f(0.3), f(0.36)]], 1.3, T.SAND, 0.2, [T.TREE, T.GRASS]);
      b.line([[f(0.12), f(0.12)], [f(0.44), f(0.18)]], 1.3, T.SAND, 0.2, [T.TREE, T.GRASS]);
      b.city(f(0.2), f(0.44), 5.5, 0.85);
      baseOre(b, 0.12);
      b.ore(f(0.3), f(0.36), 2.6, 850);
      b.derrick(f(0.46), f(0.3));
    },
  },
  {
    id: 'mekong', name: 'Mekong Delta', year: 1968, place: 'South Vietnam', biome: 'jungle', players: 4, n: 84, sym: 'rot4',
    desc: 'The Tet Offensive in the delta. River channels, flooded paddies, and tangled riverbank jungle.',
    build(b) {
      const f = v => b.f(v), c = b.c, n1 = b.n1;
      b.start(f(0.12), f(0.12));
      b.noise(T.TREE, 5, 0.56);
      b.river([[c, c], [f(0.6), f(0.36)], [f(0.7), f(0.16)], [f(0.72), 0]], 1.3);
      b.river([[f(0.6), f(0.36)], [f(0.84), f(0.42)], [n1, f(0.38)]], 0.8);
      for (const [x, y] of [[0.3, 0.42], [0.38, 0.3], [0.22, 0.32], [0.46, 0.44]]) b.disc(f(x), f(y), 1.3, T.WATER, 0.2);
      b.bridge([f(0.66) - 3, f(0.24)], [f(0.66) + 3, f(0.24)], 1);
      b.bridge([f(0.76), f(0.4) - 3], [f(0.76), f(0.4) + 3], 1);
      b.city(f(0.36), f(0.36), 6, 0.85);
      baseOre(b, 0.12);
      b.ore(f(0.34), f(0.36), 2.8, 820);
      b.derrick(f(0.46), f(0.12));
    },
  },
  {
    id: 'cuito', name: 'Cuito Cuanavale', year: 1987, place: 'Angola', biome: 'jungle', players: 2, n: 68, sym: 'point',
    desc: "Africa's biggest tank battle since WWII. The Cuito river splits savanna woodland and swamp, with a vital bridge at its center.",
    build(b) {
      const f = v => b.f(v), c = b.c;
      b.start(f(0.12), f(0.88));
      b.noise(T.TREE, 5, 0.58);
      b.noise(T.ROCK, 6, 0.86, [T.GRASS, T.TREE]);
      b.river([[0, 0], [f(0.2), f(0.24)], [f(0.36), f(0.36)], [c, c]], 1.4);
      for (const [x, y] of [[0.3, 0.2], [0.16, 0.34], [0.42, 0.26]]) b.disc(f(x), f(y), 2, T.WATER, 0.4);
      b.bridge([c - 3, c + 3], [c + 3, c - 3], 1.2);
      b.bridge([f(0.2) - 3, f(0.24) + 3], [f(0.2) + 3, f(0.24) - 3], 1);
      b.city(f(0.4), f(0.56), 6, 0.85);
      b.ore(f(0.26), f(0.86), 2.6, 620);
      b.ore(f(0.1), f(0.72), 2.4, 620);
      b.ore(f(0.44), f(0.64), 3, 850);
      b.derrick(f(0.3), f(0.6));
    },
  },
  {
    id: 'khesanh', name: 'Khe Sanh', year: 1968, place: 'South Vietnam', biome: 'jungle', players: 2, n: 64, sym: 'point',
    desc: 'The siege of a hilltop Marine base. Jungle-covered hills, an exposed airstrip, and the Rao Quan river.',
    build(b) {
      const f = v => b.f(v), c = b.c, n1 = b.n1;
      b.start(f(0.13), f(0.13));
      b.noise(T.TREE, 5, 0.5);
      b.disc(f(0.32), f(0.15), 3.4, T.ROCK, 0.4);
      b.disc(f(0.15), f(0.34), 3, T.ROCK, 0.4);
      b.line([[f(0.3), f(0.03)], [f(0.03), f(0.3)]], 0.9, T.SAND, 0, [T.GRASS, T.TREE]);
      b.river([[0, n1], [f(0.3), f(0.62)], [c, c]], 1.0);
      b.bridge([f(0.3) - 2.5, f(0.62) - 2.5], [f(0.3) + 2.5, f(0.62) + 2.5], 1);
      b.city(f(0.38), f(0.38), 5.5, 0.85);
      baseOre(b, 0.13);
      b.ore(f(0.42), f(0.3), 2.8, 820);
      b.derrick(f(0.26), f(0.48));
    },
  },

  // ---------------- ISLANDS & STRAITS ----------------
  {
    id: 'danish', name: 'Danish Straits', year: 1983, place: 'Denmark', biome: 'temperate', players: 2, n: 72, sym: 'point',
    desc: 'The Baltic Approaches. Home islands linked by long road bridges to a central island town and contested islets with oil.',
    build(b) {
      b.sea();
      b.start(11, 11);
      b.island(11, 11, 14, 0.2);           // home island
      b.island(39, 9, 6.5);                 // north islet
      b.island(9, 39, 6.5);                 // west islet
      b.island(61, 11, 7);                  // far corner islet (contested, mirrored at 10,60)
      b.island(35.5, 35.5, 10, 0.2);        // central island (self-symmetric)
      b.noise(T.TREE, 5, 0.66);
      b.bridge([23, 10], [34, 9], 1);
      b.bridge([10, 23], [9, 34], 1);
      b.bridge([45, 10], [55, 11], 1);
      b.bridge([61, 18], [62, 27], 1);
      b.bridge([38, 15], [36, 27], 1);
      b.bridge([15, 38], [27, 36], 1);
      b.city(35.5, 35.5, 6.5, 0.8);
      baseOre(b, 0.13);
      b.ore(40, 8, 2.6, 800);
      b.ore(8, 40, 2.6, 800);
      b.ore(63, 9, 2.4, 900);
      b.derrick(59, 12);
    },
  },
  {
    id: 'kurils', name: 'Kuril Islands', year: 1978, place: 'Sea of Okhotsk', biome: 'arctic', players: 4, n: 84, sym: 'rot4',
    desc: 'A frozen archipelago claimed by both blocs. Four island bases ring a central volcano island, joined by a chain of bridges.',
    build(b) {
      b.sea();
      b.start(11, 11);
      b.island(11, 11, 14, 0.2);           // home island (one per corner)
      b.island(41.5, 10, 7);                // edge island between two bases
      b.island(41.5, 41.5, 11, 0.2);        // central island
      b.noise(T.TREE, 5, 0.64);
      b.noise(T.ROCK, 6, 0.78);
      b.bridge([24, 11], [35, 10], 1);
      b.bridge([48, 10], [59, 11], 1);
      b.bridge([41.5, 17], [41.5, 31], 1);
      b.disc(41.5, 41.5, 3, T.ROCK, 0.3, [T.GRASS, T.TREE]);
      baseOre(b, 0.12);
      b.ore(41.5, 8, 2.6, 820);
      b.ore(36, 46, 2.6, 900);
      b.derrick(30, 38);
    },
  },
  {
    id: 'shatt', name: 'Shatt al-Arab', year: 1980, place: 'Iran-Iraq border', biome: 'desert', players: 2, n: 68, sym: 'point',
    desc: 'The disputed delta at the head of the Persian Gulf. Wide channels split the marshland into islands linked by pontoon bridges.',
    build(b) {
      const c = b.c, n1 = b.n1;
      b.start(9, 9);
      b.noise(T.TREE, 4, 0.7);
      b.river([[0, 24], [20, 30], [c, c]], 2.4);
      b.river([[24, 0], [30, 20], [c, c]], 2.4);
      b.river([[0, 48], [18, 50], [30, 44]], 2.2);
      b.river([[48, 0], [50, 18], [44, 30]], 2.2);
      b.disc(c, c, 6, T.WATER, 0.3);
      b.island(c, c, 3, 0.2, 0.8);
      b.bridge([20, 26], [20, 35], 1);
      b.bridge([26, 20], [35, 20], 1);
      b.bridge([10, 44], [10, 54], 1);
      b.bridge([c - 9, c - 9], [c + 9, c + 9], 1);
      b.city(14, 32, 4.5, 0.75);
      baseOre(b, 0.12);
      b.ore(10, 38, 2.6, 800);
      b.ore(38, 10, 2.6, 800);
      b.derrick(26, 42);
    },
  },
  {
    id: 'quemoy', name: 'Quemoy Strait', year: 1958, place: 'Taiwan Strait', biome: 'jungle', players: 2, n: 68, sym: 'point',
    desc: 'The Second Taiwan Strait Crisis. Two coasts face each other across open sea, connected only through a chain of fortified islands.',
    build(b) {
      const c = b.c;
      b.sea();
      b.start(9, 9);
      const coast = (px, py) => 44 + b.wobble(px, py) * 9 + Math.sin(px * 0.35) * 2;
      b.land((px, py) => px + py < coast(px, py), (px, py) => px + py < coast(px, py) + 2.5);
      b.island(c, c, 6.5, 0.2);             // Kinmen
      b.island(21, 46, 4.5);                 // flank islets
      b.island(46, 21, 4.5);
      b.noise(T.TREE, 5, 0.55);
      b.bridge([18, 26], [28, 26], 1);     // home coast -> Kinmen
      b.bridge([16, 35], [16, 44], 1);     // home coast -> flank islet
      b.city(30, 8, 5, 0.75);
      baseOre(b, 0.12);
      b.ore(21, 46, 2.2, 900);
      b.ore(26, 6, 2.6, 800);
      b.derrick(c - 2, c - 2);
    },
  },
];

export const MAP_INDEX = Object.fromEntries(MAPS.map(m => [m.id, m]));

const cache = new Map();
// Builds the map for a game setup. Set maps are deterministic; random maps use the seed.
export function createMap(setup, numPlayers) {
  const def = setup.map && MAP_INDEX[setup.map];
  if (!def) return elevate(generateMap(setup.seed, setup.mapSize || (numPlayers > 2 ? 80 : 64), numPlayers), setup.seed >>> 0, numPlayers > 2 ? 'rot4' : 'point');
  const key = def.id + '|' + numPlayers;
  if (!cache.has(key)) {
    const b = new MapBuilder(def.n, def.sym, hashStr(def.id));
    def.build(b);
    cache.set(key, elevate(b.finish(def, numPlayers), hashStr(def.id), def.sym === 'rot4' ? 'rot4' : 'point'));
  }
  const m = cache.get(key);
  // hand out copies so games can't mutate the cached map
  return { ...m, terrain: new Uint8Array(m.terrain), hgt: new Uint8Array(m.hgt), ore: new Uint16Array(m.ore), derricks: m.derricks.map(d => ({ ...d })), civ: (m.civ || []).map(c => ({ ...c })), starts: m.starts.map(s => ({ ...s })) };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
