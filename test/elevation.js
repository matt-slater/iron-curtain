// Terrain elevation: fair (symmetric) heights, cliffs impassable, flat-only building,
// plateaus reachable by ramps, and building off allies / captured tech buildings.
import { Game } from '../shared/game.js';
import { MAPS, createMap } from '../shared/maps.js';
import { T, terrainPassable, MOVE } from '../shared/map.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const players = [{ name: 'A', country: 'USA', color: 0, team: 1 }, { name: 'B', country: 'UK', color: 1, team: 1 }];

let asym = 0, unreachable = 0, raised = 0, cliffs = 0;
const setups = [];
for (const m of MAPS) for (const np of m.players === 4 ? [2, 4] : [2]) setups.push({ map: m.id, np, sym: m.sym });
for (const s of [11, 22, 33]) for (const np of [2, 4]) setups.push({ seed: s, np, sym: np > 2 ? 'rot4' : 'point' });
for (const st of setups) {
  const mp = createMap({ map: st.map, seed: st.seed, mapSize: st.np > 2 ? 80 : 64 }, st.np);
  const { w, hgt, terrain } = mp, CW = w + 1;
  for (let y = 0; y <= w; y++) for (let x = 0; x <= w; x++) {
    const imgs = st.sym === 'rot4' ? [[w - y, x], [w - x, w - y], [y, w - x]] : [[w - x, w - y]];
    for (const [a, b] of imgs) if (hgt[b * CW + a] !== hgt[y * CW + x]) asym++;
  }
  for (let i = 0; i < hgt.length; i++) if (hgt[i] >= 2) raised++;
  for (let i = 0; i < terrain.length; i++) if (terrain[i] === T.CLIFF) cliffs++;
  // every passable tile is reachable from the first start
  const seen = new Uint8Array(w * w), q = [mp.starts[0].y * w + mp.starts[0].x]; seen[q[0]] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w, y = (i - x) / w;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= w) continue;
      const j = ny * w + nx;
      if (!seen[j] && terrainPassable(terrain[j], MOVE.GROUND)) { seen[j] = 1; q.push(j); }
    }
  }
  for (let i = 0; i < w * w; i++) {
    const x = i % w, y = (i - x) / w;
    if (hgt[y * CW + x] >= 2 && hgt[y * CW + x + 1] >= 2 && hgt[(y + 1) * CW + x] >= 2 && hgt[(y + 1) * CW + x + 1] >= 2 && terrainPassable(terrain[i], MOVE.GROUND) && !seen[i]) unreachable++;
  }
}
check(asym === 0, `heights are symmetric on all ${setups.length} map setups (${asym} mismatches)`);
check(cliffs > 0 && raised > 0, `maps have plateaus (${raised} raised corners) and cliffs (${cliffs} tiles)`);
check(unreachable === 0, 'every plateau top is reachable by a ramp');

// building rules
const g = new Game({ seed: 3, credits: 10000, map: 'kola', players });
const CW = g.w + 1;
const flat = (x, y) => { const a = g.hgt[y * CW + x]; return [g.hgt[y * CW + x + 1], g.hgt[(y + 1) * CW + x], g.hgt[(y + 1) * CW + x + 1]].every(v => v === a); };
let slope = null, top = null;
for (let y = 2; y < g.h - 3 && (!slope || !top); y++) for (let x = 2; x < g.w - 3; x++) {
  const t = g.terrain[y * g.w + x];
  if (!slope && (t === T.GRASS || t === T.SAND) && !flat(x, y)) slope = [x, y];
  if (!top && g.hgt[y * CW + x] === 2 && g.canPlaceRaw('pillbox', x, y)) top = [x, y];
}
check(slope && !g.canPlaceRaw('pillbox', slope[0], slope[1]), 'cannot build on a slope');
check(top && g.canPlaceRaw('pillbox', top[0], top[1]), 'can build on a flat plateau top');
const cliffTile = [...g.terrain.keys()].find(i => g.terrain[i] === T.CLIFF);
check(cliffTile != null && !g.passable(cliffTile, MOVE.GROUND) && g.passable(cliffTile, 4), 'cliffs block ground units but not aircraft');

// build radius: own base, ally base, captured tech building
const near = (b, dx) => [b.tx + b.w + dx, b.ty];
const findSpot = (from, minD, maxD) => {
  for (let d = minD; d <= maxD; d++) for (let dy = -3; dy <= 3; dy++) {
    const x = from.tx + from.w + d, y = from.ty + dy;
    if (g.canPlaceRaw('pillbox', x, y)) return [x, y];
  }
  return null;
};
for (const e of [...g.entities.values()]) if (e.type === 'mcv') g.removeEntity(e);
const s1 = g.map.starts[1];
const allyYard = g.addBuilding('conyard', 1, s1.x - 1, s1.y - 1);
const spot = findSpot(allyYard, 1, 3);
check(spot && g.canPlace(0, 'pillbox', spot[0], spot[1]), 'can build next to an ally\'s base');
g.players[1].team = 2; g.players[0].team = 1;
check(spot && !g.canPlace(0, 'pillbox', spot[0], spot[1]), 'cannot build next to an enemy base');
const derr = [...g.entities.values()].find(e => e.type === 'derrick');
const ds = findSpot(derr, 1, 4);
check(ds && !g.canPlace(0, 'pillbox', ds[0], ds[1]), 'neutral derrick does not extend your base');
derr.owner = 0;
check(ds && g.canPlace(0, 'pillbox', ds[0], ds[1]), 'captured derrick extends your base');

console.log(fails ? `${fails} FAILED` : 'all elevation checks passed');
process.exit(fails ? 1 : 0);
