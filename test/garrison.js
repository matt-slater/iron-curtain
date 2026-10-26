// Garrison rules test (RA2-style civilian building occupation).
import { Game } from '../shared/game.js';
import { TICK_RATE, BUILDINGS, resolveAction } from '../shared/data.js';

let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`); if (!ok) failures++; };
const run = (g, secs) => { for (let t = 0; t < secs * TICK_RATE; t++) g.step(); };
const fresh = (c0 = 'USA', c1 = 'UK') => {
  const g = new Game({ map: 'berlin', seed: 1, credits: 0, players: [{ name: 'a', country: c0, color: 0 }, { name: 'b', country: c1, color: 1 }] });
  g.checkVictory = () => {};
  for (const e of [...g.entities.values()]) if (e.kind === 'u') g.removeEntity(e);
  return g;
};
const civs = g => [...g.entities.values()].filter(e => e.kind === 'b' && BUILDINGS[e.type].civilian);
const spawnAt = (g, type, owner, x, y) => { const f = g.nearestFree(x, y, false); return g.spawnUnit(type, owner, f.x + 0.5, f.y + 0.5); };

{
  const g = fresh();
  check('Berlin has garrisonable buildings', civs(g).length >= 30, civs(g).length + ' buildings');
  const b = civs(g).find(e => e.type === 'house');
  const inf = Array.from({ length: 6 }, (_, k) => spawnAt(g, 'rifleman', 0, b.tx + b.w + 1 + (k % 3), b.ty + b.h + 1));
  g.rebuildGrid();
  g.command(0, { c: 'target', ids: inf.map(u => u.id), target: b.id });
  run(g, 25);
  check('infantry garrisons a house up to its capacity', b.occ === BUILDINGS.house.garrison, `occ ${b.occ}/${BUILDINGS.house.garrison}`);
  check('building switches to the occupier', b.owner === 0);
  const left = inf.filter(u => g.entities.has(u.id)).length;
  check('extra infantry stay outside when full', left === 6 - BUILDINGS.house.garrison, `${left} outside`);
  for (const u of inf) if (g.entities.has(u.id)) g.removeEntity(u);

  const enemies = Array.from({ length: 5 }, (_, k) => spawnAt(g, 'rifleman', 1, b.tx + b.w + 4, b.ty + k));
  run(g, 15);
  const dead = enemies.filter(u => !g.entities.has(u.id)).length;
  check('garrison fires on enemies in range', dead >= 3, `${dead}/5 enemy riflemen killed`);
  check('occupants are protected from rifle fire', b.occ === BUILDINGS.house.garrison, `occ ${b.occ}`);

  check('engineers cannot capture civilian buildings', resolveAction('engineer', b, 'enemy', 'NATO') !== 'capture' && resolveAction('engineer', b, 'neutral', 'NATO') !== 'capture');

  const tanks = Array.from({ length: 4 }, (_, k) => spawnAt(g, 'm60', 1, b.tx + b.w + 5, b.ty + b.h + 3 + k));
  g.command(1, { c: 'target', ids: tanks.map(u => u.id), target: b.id });
  const occBefore = b.occ;
  let t = 0;
  while (g.entities.has(b.id) && t++ < 60 * TICK_RATE) g.step();
  const spilled = [...g.entities.values()].filter(e => e.kind === 'u' && e.owner === 0 && e.type === 'rifleman' && Math.hypot(e.x - b.x, e.y - b.y) < 3.5).length;
  check('tanks can destroy a garrisoned building', !g.entities.has(b.id), `${(t / TICK_RATE).toFixed(0)}s`);
  check('occupants survive and exit when the building falls', spilled === occBefore, `${spilled}/${occBefore} came out`);
}
{
  const g = fresh();
  const b = civs(g).find(e => e.type === 'office');
  const inf = Array.from({ length: 4 }, (_, k) => spawnAt(g, 'rifleman', 0, b.tx + b.w + 1 + k, b.ty + b.h + 1));
  g.rebuildGrid();
  g.command(0, { c: 'target', ids: inf.map(u => u.id), target: b.id });
  run(g, 25);
  check('office garrisoned', b.occ === 4, `occ ${b.occ}`);
  g.command(0, { c: 'evacuate', id: b.id });
  g.step();
  const out = [...g.entities.values()].filter(e => e.kind === 'u' && e.owner === 0);
  check('evacuate releases all occupants', b.occ === 0 && out.length === 4 && b.owner === -1, `occ ${b.occ}, outside ${out.length}, owner ${b.owner}`);
  for (const u of out) g.garrison(u, b);
  const sas = spawnAt(g, 'sas', 1, b.tx + b.w + 5, b.ty + 1);
  g.command(1, { c: 'target', ids: [sas.id], target: b.id });
  run(g, 20);
  check('a sniper clears a garrison without destroying the building', b.occ === 0 && g.entities.has(b.id) && b.owner === -1 && b.hp === b.maxHp, `occ ${b.occ}, hp ${Math.round(b.hp)}/${b.maxHp}, owner ${b.owner}`);
  check('attack order ends once the cleared building turns neutral', sas.order.type === 'idle' && g.distTo(sas, b) > 2, `order ${sas.order.type}, dist ${g.distTo(sas, b).toFixed(1)}`);
}
{
  const g = fresh('USSR', 'USA');
  const b = civs(g).find(e => e.type === 'tenement' || e.type === 'tenementB');
  for (let k = 0; k < 3; k++) g.garrison(spawnAt(g, 'conscript', 0, b.tx + b.w + 1 + k, b.ty), b);
  const arty = spawnAt(g, 'm109', 1, b.tx + b.w + 8, b.ty + b.h + 4);
  g.command(1, { c: 'target', ids: [arty.id], target: b.id });
  run(g, 40);
  check('artillery wears down occupants and the building', b.occ < 3 || !g.entities.has(b.id), `occ ${b.occ}, hp ${Math.round(b.hp)}`);
}
{
  const g = new Game({ map: 'berlin', seed: 1, credits: 0, players: [{ name: 'a', country: 'USA', color: 0 }, { name: 'b', country: 'UK', color: 1 }] });
  for (const e of [...g.entities.values()]) if (e.owner === 1) g.removeEntity(e);
  const b = civs(g)[0];
  g.garrison(spawnAt(g, 'conscript', 1, b.tx + b.w + 1, b.ty), b);
  run(g, 2);
  check('a garrisoned building alone does not keep a player alive', g.over && g.winners.includes(0));
}
console.log(failures ? `${failures} FAILED` : 'all garrison checks passed');
process.exit(failures ? 1 : 0);
