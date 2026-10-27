// Aircraft rules test (RA2-style jets with pads/ammo, helicopters, anti-air).
import { Game } from '../shared/game.js';
import { TICK_RATE, WEAPONS } from '../shared/data.js';

let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  (' + info + ')' : ''}`); if (!ok) failures++; };
const run = (g, secs, until) => { for (let t = 0; t < secs * TICK_RATE; t++) { g.step(); if (until && until()) return t / TICK_RATE; } return secs; };
const fresh = (c0 = 'USA', c1 = 'USSR') => {
  const g = new Game({ map: 'fulda', seed: 1, credits: 50000, players: [{ name: 'a', country: c0, color: 0 }, { name: 'b', country: c1, color: 1 }] });
  g.checkVictory = () => {};
  for (const e of [...g.entities.values()]) if (e.kind === 'u') g.removeEntity(e);
  return g;
};

{
  const g = fresh();
  const s0 = g.map.starts[0];
  for (const [t, x, y] of [['conyard', -1, -1], ['power', -4, -1], ['power', -4, 2], ['barracks', 3, -1], ['refinery', 3, 3], ['factory', -1, 3], ['radar', -5, 5]]) g.addBuilding(t, 0, s0.x + x, s0.y + y);
  g.updatePlayers();
  check('air units locked until an air base exists', !g.canBuild(g.players[0], 'a10'));
  const af = g.addBuilding('airfield', 0, s0.x + 1, s0.y + 7);
  g.updatePlayers();
  check('air base unlocks A-10 and Cobra', g.canBuild(g.players[0], 'a10') && g.canBuild(g.players[0], 'cobra'));
  g.command(0, { c: 'queue', type: 'a10', count: 5 });
  check('jets limited to 4 landing pads per air base', g.players[0].queues.air.length === 4, `queued ${g.players[0].queues.air.length}`);
  run(g, 60, () => g.jetCount(0) >= 4);
  const jets = [...g.entities.values()].filter(e => e.type === 'a10');
  check('four A-10s built, each parked on its own pad', jets.length === 4 && new Set(jets.map(j => j.pad.i)).size === 4 && jets.every(j => j.landed));
  g.command(0, { c: 'queue', type: 'cobra' });
  run(g, 30, () => [...g.entities.values()].some(e => e.type === 'cobra'));
  const cobra = [...g.entities.values()].find(e => e.type === 'cobra');
  check('helicopter built', !!cobra);

  // strike a column of enemy tanks far away
  const tanks = Array.from({ length: 3 }, (_, k) => g.spawnUnit('t72', 1, s0.x + 25 + k, s0.y + 25));
  const tankHp0 = tanks.reduce((a, t) => a + t.hp, 0);
  const jet = jets[0];
  g.command(0, { c: 'target', ids: [jet.id], target: tanks[0].id });
  run(g, 1);
  check('jet takes off on an attack order', !jet.landed && jet.alt > 0);
  let ammoDropped = false;
  run(g, 25, () => { if (jet.ammo < 4) ammoDropped = true; return jet.ammo === 0 || tanks[0].dead; });
  const dealt = tankHp0 - tanks.reduce((a, t) => a + (t.dead ? 0 : t.hp), 0);
  check('jet fires its ammo in strafing passes', ammoDropped && (jet.ammo === 0 || tanks[0].dead) && dealt > 300, `damage ${Math.round(dealt)}, ammo left ${jet.ammo}`);
  run(g, 0.5);
  check('jet heads home when out of ammo or its target is dead', jet.order.type === 'rtb' || jet.landed, jet.order.type);
  run(g, 30, () => jet.landed);
  const pp = g.padPos(af, jet.pad.i);
  check('jet lands on its own pad', jet.landed && Math.hypot(jet.x - pp.x, jet.y - pp.y) < 0.1);
  run(g, 8);
  check('jet rearms on the pad', jet.ammo === 4, `ammo ${jet.ammo}`);

  // helicopter flies over a river/forest straight to a point and hovers
  const tx = s0.x + 20, ty = s0.y + 3;
  g.command(0, { c: 'move', ids: [cobra.id], x: tx, y: ty });
  const tt = run(g, 30, () => Math.hypot(cobra.x - tx, cobra.y - ty) < 0.2);
  check('helicopter flies straight to its destination', Math.hypot(cobra.x - tx, cobra.y - ty) < 0.2 && tt < 9, `${tt.toFixed(1)}s`);
  check('helicopter hovers at altitude', cobra.alt > 20 && cobra.order.type === 'idle');

  // ground non-AA units cannot hit aircraft; AA can
  const rifle = g.spawnUnit('conscript', 1, cobra.x + 2, cobra.y);
  const t72 = g.spawnUnit('t72', 1, cobra.x + 3, cobra.y + 1);
  g.rebuildGrid();
  check('tanks/rifles cannot target aircraft', g.acquire(rifle, 6, g.weapon(rifle)) !== cobra && g.acquire(t72, 6, g.weapon(t72)) !== cobra);
  const hp0 = cobra.hp;
  const strela = g.spawnUnit('strela', 1, cobra.x + 4, cobra.y);
  run(g, 10);
  check('AA vehicle shoots the helicopter down', cobra.dead || cobra.hp < hp0 * 0.5, `cobra hp ${Math.round(cobra.hp)}/${hp0}`);
}
{
  // jets are hard to hit with machine guns, SAM sites wreck them
  const g = fresh('UK', 'GDR');
  const s1 = g.map.starts[1];
  g.addBuilding('power', 1, s1.x - 4, s1.y - 4); g.addBuilding('power', 1, s1.x - 4, s1.y - 1);
  const sam = g.addBuilding('samsite', 1, s1.x, s1.y);
  g.updatePlayers();
  const j = g.spawnUnit('a10', 0, s1.x - 9, s1.y); j.alt = 48;
  const tgt = g.addBuilding('power', 1, s1.x + 3, s1.y + 2);
  g.command(0, { c: 'target', ids: [j.id], target: tgt.id });
  const hp0 = j.hp;
  run(g, 8);
  check('SAM site engages jets', j.dead || j.hp < hp0, `a10 hp ${Math.round(j.hp)}/${hp0}`);
  const tank = g.spawnUnit('m60', 0, s1.x + 4, s1.y);
  g.rebuildGrid();
  check('SAM site never targets ground units', g.acquire(sam, 11, WEAPONS.samMissile) !== tank);
  // the same machine-gun burst does far less to a jet than to a helicopter
  const jet2 = g.spawnUnit('a10', 0, s1.x - 20, s1.y - 20), heli = g.spawnUnit('cobra', 0, s1.x - 22, s1.y - 20);
  g.hit(jet2, WEAPONS.hmg, 100, 1, 0); g.hit(heli, WEAPONS.hmg, 100, 1, 0);
  check('jets shrug off non-AA machine-gun fire (helicopters do not)', (jet2.maxHp - jet2.hp) < (heli.maxHp - heli.hp) * 0.5, `jet -${jet2.maxHp - jet2.hp}, heli -${heli.maxHp - heli.hp}`);
}
console.log(failures ? `${failures} FAILED` : 'all air checks passed');
process.exit(failures ? 1 : 0);
