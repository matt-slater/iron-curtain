// Tech airport + paradrops (RA2 style).
import { Game } from '../shared/game.js';
import { MAPS } from '../shared/maps.js';
import * as D from '../shared/data.js';

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const players = [
  { name: 'A', country: 'USA', color: 0, team: 0 },
  { name: 'B', country: 'USSR', color: 1, team: 0 },
];

let placed = 0;
for (const m of MAPS) {
  for (const np of m.players === 4 ? [2, 4] : [2]) {
    const g = new Game({ seed: 5, credits: 10000, map: m.id, players: np === 2 ? players : [...players, { name: 'C', country: 'UK', color: 2 }, { name: 'D', country: 'CUB', color: 3 }] });
    const port = [...g.entities.values()].find(e => e.type === 'techairport');
    if (port) placed++;
    else console.log(`  note: no airport on ${m.id} (${np}p)`);
  }
}
const setups = MAPS.reduce((n, m) => n + (m.players === 4 ? 2 : 1), 0);
check(placed === setups, `airport placed on ${placed}/${setups} map setups`);

const g = new Game({ seed: 5, credits: 10000, map: 'fulda', players });
const step = n => { for (let i = 0; i < n; i++) g.step(); };
const port = [...g.entities.values()].find(e => e.type === 'techairport');
check(port && port.owner === -1, 'airport starts neutral');

const eng = g.spawnUnit('engineer', 0, port.tx - 0.6, port.ty + 1.5);
g.command(0, { c: 'target', ids: [eng.id], target: port.id });
step(15 * 10);
check(port.owner === 0, 'engineer captures the airport');
check(g.players[0].paraCharge > 0, 'paradrop starts charging');

g.command(0, { c: 'para', x: 20, y: 40 });
check(g.drops.length === 0, 'cannot drop before fully charged');
g.players[0].paraCharge = D.PARA_CHARGE;
const before = [...g.entities.values()].filter(e => e.owner === 0 && e.type === 'rifleman').length;
g.command(0, { c: 'para', x: 40, y: 20 });
check(g.drops.length === 1 && g.players[0].paraCharge === 0, 'transport plane launched, charge spent');
check(g.snapshot().dr.length === 1, 'plane in snapshot');

// enemy shooting at the drop zone can't hit troopers mid-air
const enemy = g.spawnUnit('t72', 1, 43, 22);
let sawFalling = false, hitInAir = false;
for (let i = 0; i < 15 * 30; i++) {
  g.step();
  for (const e of g.entities.values()) if (e.para) { sawFalling = true; if (e.hp < e.maxHp) hitInAir = true; }
  if (!g.drops.length && sawFalling && ![...g.entities.values()].some(e => e.para)) break;
}
g.removeEntity(enemy);
const troopers = [...g.entities.values()].filter(e => e.owner === 0 && e.type === 'rifleman');
check(sawFalling, 'troopers fall under parachutes');
check(!hitInAir, 'falling troopers cannot be targeted');
check(troopers.length - before >= 5, `NATO gets riflemen (${troopers.length - before})`);
check(troopers.filter(t => !t.para).every(t => t.alt === 0), 'all landed');
const landed = troopers.slice(-6);
check(landed.every(t => Math.hypot(t.x - 40, t.y - 20) < 4), 'they land at the chosen spot');
check(g.drops.length === 0, 'plane leaves the map');

// Pact gets conscripts
const g2 = new Game({ seed: 5, credits: 10000, map: 'fulda', players });
const port2 = [...g2.entities.values()].find(e => e.type === 'techairport');
port2.owner = 1; g2.step();
g2.players[1].paraCharge = D.PARA_CHARGE;
const c0 = [...g2.entities.values()].filter(e => e.owner === 1 && e.type === 'conscript').length;
g2.command(1, { c: 'para', x: 30, y: 30 });
for (let i = 0; i < 15 * 30; i++) g2.step();
const c1 = [...g2.entities.values()].filter(e => e.owner === 1 && e.type === 'conscript').length;
check(c1 - c0 === D.PARA_SQUAD.PACT[1], `Pact gets ${c1 - c0} conscripts`);

// owning only the airport doesn't keep you alive; on defeat it goes back to neutral
for (const e of [...g2.entities.values()]) if (e.owner === 1 && e !== port2) g2.removeEntity(e);
g2.checkVictory();
check(g2.players[1].defeated && port2.owner === -1 && g2.entities.has(port2.id), 'airport alone does not prevent defeat; it reverts to neutral');

console.log(fails ? `${fails} FAILED` : 'all paradrop checks passed');
process.exit(fails ? 1 : 0);
