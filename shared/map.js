// Deterministic, symmetric map generator.

export const T = { GRASS: 0, WATER: 1, ROCK: 2, TREE: 3, SAND: 4, ICE: 5, RUIN: 6, BRIDGE: 7 };
export const BIOMES = ['temperate', 'arctic', 'desert', 'jungle'];

// Movement classes: ground units, amphibious, forest walkers, mountain walkers.
export const MOVE = { GROUND: 0, AMPHIB: 1, FOREST: 2, MOUNTAIN: 3 };
export function terrainPassable(t, mc) {
  switch (t) {
    case T.GRASS: case T.SAND: case T.ICE: case T.BRIDGE: return true;
    case T.WATER: return mc === MOVE.AMPHIB;
    case T.TREE: return mc === MOVE.FOREST;
    case T.ROCK: return mc === MOVE.MOUNTAIN;
    default: return false;
  }
}
export function buildable(t) { return t === T.GRASS || t === T.SAND; }

// Destructible bridges: each 4-connected group of bridge tiles is one bridge. Both the server and the
// clients derive the same list (same order) from the generated terrain.
export function findBridges(terrain, w, h) {
  const seen = new Uint8Array(w * h), out = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || terrain[s] !== T.BRIDGE) continue;
    const tiles = [], stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop();
      tiles.push(i);
      const x = i % w, y = (i - x) / w;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && terrain[j] === T.BRIDGE) { seen[j] = 1; stack.push(j); }
      }
    }
    tiles.sort((a, b) => a - b);
    out.push({ tiles });
  }
  return out;
}

// Widen 1-tile-wide corridors through trees, rocks and rubble so vehicles can pass each other.
// Decisions are computed from the unmodified terrain each pass (and both walls of a corridor are
// cleared), so the result stays symmetric on mirrored maps.
export function widenCorridors(terrain, w, h, passes = 2, keep = null) {
  const soft = t => t === T.TREE || t === T.ROCK;
  const open = t => terrainPassable(t, MOVE.GROUND);
  for (let p = 0; p < passes; p++) {
    const clear = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!open(terrain[i])) continue;
      const L = terrain[i - 1], R = terrain[i + 1], U = terrain[i - w], D = terrain[i + w];
      // blocked left+right but open up/down -> vertical 1-wide corridor
      if (!open(L) && !open(R) && (open(U) || open(D))) {
        if (soft(L) && !(keep && keep[i - 1])) clear.push(i - 1);
        if (soft(R) && !(keep && keep[i + 1])) clear.push(i + 1);
      }
      if (!open(U) && !open(D) && (open(L) || open(R))) {
        if (soft(U) && !(keep && keep[i - w])) clear.push(i - w);
        if (soft(D) && !(keep && keep[i + w])) clear.push(i + w);
      }
    }
    if (!clear.length) break;
    for (const i of clear) terrain[i] = terrain[i] === T.RUIN ? T.SAND : T.GRASS;
  }
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function valueNoise(rng, n, scale) {
  const gw = Math.ceil(n / scale) + 2;
  const grid = new Float32Array(gw * gw);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const out = new Float32Array(n * n);
  const sm = t => t * t * (3 - 2 * t);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = x / scale, fy = y / scale;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = sm(fx - ix), ty = sm(fy - iy);
      const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1];
      const c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
      out[y * n + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

export function fractal(rng, n, scale) {
  const a = valueNoise(rng, n, scale), b = valueNoise(rng, n, scale / 2);
  for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.7 + b[i] * 0.3;
  return a;
}

export function generateMap(seed, size, numPlayers) {
  const n = size;
  const rng = mulberry32(seed >>> 0);
  const fourWay = numPlayers > 2;
  // orbit of a tile under the map's symmetry group
  const orbit = (x, y) => {
    if (!fourWay) return [[x, y], [n - 1 - x, n - 1 - y]];
    return [[x, y], [n - 1 - y, x], [n - 1 - x, n - 1 - y], [y, n - 1 - x]];
  };

  const water = fractal(rng, n, 14);
  const rock = fractal(rng, n, 7);
  const tree = fractal(rng, n, 5);
  const raw = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    let t = T.GRASS;
    if (water[i] > 0.7) t = T.WATER;
    else if (water[i] > 0.65) t = T.SAND;
    else if (rock[i] > 0.76) t = T.ROCK;
    else if (tree[i] > 0.7) t = T.TREE;
    raw[i] = t;
  }
  const terrain = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let best = Infinity;
      for (const [ox, oy] of orbit(x, y)) best = Math.min(best, oy * n + ox);
      terrain[y * n + x] = raw[best];
    }
  }
  // border
  for (let i = 0; i < n; i++) {
    for (const [x, y] of [[i, 0], [i, n - 1], [0, i], [n - 1, i]]) {
      if (terrain[y * n + x] === T.WATER) terrain[y * n + x] = T.SAND;
    }
  }

  const ore = new Uint16Array(n * n);
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < n && y < n) terrain[y * n + x] = t; };
  const forOrbit = (x, y, fn) => { for (const [ox, oy] of orbit(x, y)) fn(ox, oy); };
  const disc = (cx, cy, r, fn) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (x >= 0 && y >= 0 && x < n && y < n && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) fn(x, y);
  };
  const line = (x0, y0, x1, y1, w, fn) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w, fn);
    }
  };

  const s0 = 9;
  const starts = orbit(s0, s0).map(([x, y]) => ({ x, y })).slice(0, numPlayers);
  const c = (n - 1) / 2;

  // carve guaranteed land routes from every start to the center and between neighbours
  forOrbit(s0, s0, (x, y) => line(x, y, c, c, 1.6, (px, py) => {
    const i = py * n + px;
    if (terrain[i] === T.WATER || terrain[i] === T.ROCK || terrain[i] === T.TREE) terrain[i] = terrain[i] === T.WATER ? T.SAND : T.GRASS;
  }));
  forOrbit(s0, s0, (x, y) => {
    const [nx, ny] = fourWay ? [n - 1 - y, x] : [n - 1 - s0, s0];
    if (!fourWay && !(x === s0 && y === s0)) return;
    line(x + 2, y + 2, nx, ny, 1.2, (px, py) => {
      const i = py * n + px;
      if (terrain[i] !== T.GRASS && terrain[i] !== T.SAND) terrain[i] = terrain[i] === T.WATER ? T.SAND : T.GRASS;
    });
  });
  // clear bases
  forOrbit(s0, s0, (x, y) => disc(x, y, 8, (px, py) => set(px, py, T.GRASS)));

  const oreField = (cx, cy, r, amount) => forOrbit(cx, cy, (ox, oy) => disc(ox, oy, r, (x, y) => {
    terrain[y * n + x] = T.GRASS;
    const d = Math.hypot(x - ox, y - oy) / r;
    ore[y * n + x] = Math.max(ore[y * n + x], Math.round(amount * (1.15 - d * 0.6)));
  }));
  oreField(s0 + 9, s0 + 2, 2.6, 600);
  oreField(s0 + 1, s0 + 10, 2.4, 600);
  oreField(Math.round(n * 0.38), Math.round(n * 0.22), 2.8, 700);
  oreField(c, c, fourWay ? 3.8 : 3.2, 900);

  const derricks = [];
  const dpos = [[Math.round(n * 0.22), Math.round(n * 0.45)]];
  for (const [dx, dy] of dpos) {
    forOrbit(dx, dy, (x, y) => {
      // keep 2x2 footprint consistent under rotation: anchor at top-left of the rotated block
      const ax = Math.min(x, x - (x > c ? 1 : 0)), ay = Math.min(y, y - (y > c ? 1 : 0));
      disc(ax + 1, ay + 1, 2.2, (px, py) => { set(px, py, T.GRASS); ore[py * n + px] = 0; });
      derricks.push({ x: ax, y: ay });
    });
  }

  const variant = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) variant[i] = Math.floor(rng() * 256);

  widenCorridors(terrain, n, n);
  const biome = BIOMES[(seed >>> 3) % 4];
  if (biome === 'arctic') {
    // freeze water within 2 tiles of shore (depends only on symmetric terrain, so stays fair)
    const near = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (terrain[y * n + x] !== T.WATER) continue;
      for (let dy = -2; dy <= 2 && !near[y * n + x]; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < n && ny < n && terrain[ny * n + nx] !== T.WATER && terrain[ny * n + nx] !== T.ICE) { near[y * n + x] = 1; break; }
      }
    }
    for (let i = 0; i < n * n; i++) if (near[i]) terrain[i] = T.ICE;
  }
  return { w: n, h: n, terrain, ore, starts, derricks, variant, biome, name: 'Random Theater' };
}
