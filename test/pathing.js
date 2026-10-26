// Pathing regression test: two-way army traffic through a map and harvesters running ore loops
// around a built-up base. Usage: node test/pathing.js [mapId ...]
import { Game } from '../shared/game.js';
import { AI } from '../shared/ai.js';
import { TICK_RATE } from '../shared/data.js';

const maps = process.argv.slice(2).length ? process.argv.slice(2) : ['berlin', 'budapest', 'prague', 'golan', 'panjshir', 'fulda', 'iadrang', 'khesanh'];
let fail = false;
for (const map of maps) {
  const g = new Game({ map, seed: 1, credits: 99999, players: [0, 1].map(i => ({ name: 'p' + i, country: i ? 'USSR' : 'USA', color: i, team: 1 })) });
  g.checkVictory = () => {};
  for (const e of [...g.entities.values()]) if (e.kind === 'u') g.removeEntity(e);
  // build a realistic base for player 0 using the AI's placement logic
  const s0 = g.map.starts[0], s1 = g.map.starts[1];
  g.addBuilding('conyard', 0, s0.x - 1, s0.y - 1);
  g.updatePlayers();
  const ai = new AI(g, 0);
  ai.base = [...g.entities.values()].find(e => e.type === 'conyard' && e.owner === 0);
  for (const t of ['power', 'refinery', 'barracks', 'power', 'factory', 'refinery', 'radar', 'power', 'tech', 'pillbox', 'atgun']) {
    const bs = [...g.entities.values()].filter(e => e.kind === 'b' && e.owner === 0);
    const spot = ai.findSpot(t, bs);
    if (spot) g.addBuilding(t, 0, spot.x, spot.y);
    g.updatePlayers();
  }
  const refs = [...g.entities.values()].filter(e => e.type === 'refinery' && e.owner === 0);
  for (let i = 0; i < 4; i++) { const ex = g.exitTile(refs[i % refs.length]); const h = g.spawnUnit('harvester', 0, ex.x + 0.5, ex.y + 0.5); g.orderHarvest(h, h.x, h.y); }
  const near = (x, y, k) => { const f = g.nearestFree(Math.floor(x + (k % 6) - 3), Math.floor(y + Math.floor(k / 6) - 3), false); return [f.x + 0.5, f.y + 0.5]; };
  const fac = [...g.entities.values()].find(e => e.type === 'factory' && e.owner === 0) || ai.base;
  const mk = (owner, types, x, y) => types.map((t, k) => g.spawnUnit(t, owner, ...near(x, y, k)));
  const A = mk(0, [...Array(16).fill('rifleman'), ...Array(8).fill('m60'), 'jeep', 'jeep'], fac.x, fac.y + 3);
  const B = mk(1, [...Array(16).fill('conscript'), ...Array(8).fill('t72'), 'brdm', 'brdm'], s1.x, s1.y);
  g.rebuildGrid();
  const send = (grp, owner, to) => g.command(owner, { c: 'move', ids: grp.map(u => u.id), x: to.x + 0.5, y: to.y + 0.5 });
  send(A, 0, s1); send(B, 1, s0);
  const c0 = g.players[0].credits;
  let stalls = 0, samples = 0;
  const last = new Map();
  const T = 260 * TICK_RATE;
  for (let t = 0; t < T; t++) {
    if (t === 130 * TICK_RATE) { send(A, 0, s0); send(B, 1, s1); }
    g.step();
    if (t % (TICK_RATE * 3) === 0) for (const u of [...A, ...B]) {
      const p = last.get(u.id); last.set(u.id, { x: u.x, y: u.y });
      if (p && u.path && u.path.length) { samples++; if (Math.hypot(u.x - p.x, u.y - p.y) < 0.2) stalls++; }
    }
  }
  const home = (grp, s) => grp.filter(u => Math.hypot(u.x - s.x, u.y - s.y) < 9).length;
  const a = home(A, s0), b = home(B, s1);
  const harvesting = [...g.entities.values()].filter(e => e.type === 'harvester' && e.order.type === 'harvest').length;
  const income = Math.round(g.players[0].credits - c0);
  const ok = a >= A.length - 1 && b >= B.length - 1 && income > 9000 && harvesting === 4;
  if (!ok) fail = true;
  console.log(`${map.padEnd(9)} round trip A ${a}/${A.length}  B ${b}/${B.length}  stalled ${(stalls / Math.max(1, samples) * 100).toFixed(1)}%  income $${income}  trucks harvesting ${harvesting}/4  ${ok ? 'OK' : 'FAIL'}`);
}
process.exit(fail ? 1 : 0);
