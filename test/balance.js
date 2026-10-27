// Balance harness: hard-AI vs hard-AI games across country pairings and maps, run in parallel.
//   node test/balance.js [gamesPerCountry=8] [minutes=30] [workers=6]
// Reports faction/country win rates, game length, and per-unit "value destroyed per $ spent".
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { Game } from '../shared/game.js';
import { AI } from '../shared/ai.js';
import { MAPS } from '../shared/maps.js';
import * as D from '../shared/data.js';

const COUNTRIES = Object.keys(D.COUNTRIES);
const MAPS2 = MAPS.filter(m => m.players === 2).map(m => m.id);

function playGame({ a, b, map, seed, minutes }) {
  const g = new Game({
    seed, credits: 10000, map,
    players: [a, b].map((c, i) => ({ name: c, country: c, color: i, team: 0, ai: true, difficulty: 'hard' })),
  });
  const ais = g.players.map(p => new AI(g, p.id));
  const stat = {}; // type -> { built, spent, value }
  const S = t => (stat[t] ||= { built: 0, spent: 0, value: 0, cat: D.UNITS[t] ? D.UNITS[t].cat : D.BUILDINGS[t].cat });
  const costOf = e => (e.kind === 'u' ? D.unitDef(e.type, g.fac(e.owner)).cost : D.buildingDef(e.type, g.fac(e.owner)).cost) || 0;
  // value destroyed = damage dealt x (target cost / target max hp), credited to the shooter's type
  const dmg = g.damage.bind(g);
  g.damage = (e, amount, owner, src) => {
    if (!e.dead && amount > 0 && e.owner >= 0 && owner >= 0 && owner !== e.owner) {
      const s = src && g.entities.get(src);
      if (s && !D.isCivilian(s.type)) S(s.type).value += Math.min(amount, Math.max(0, e.hp)) * costOf(e) / (e.maxHp || 1);
    }
    return dmg(e, amount, owner, src);
  };
  const spawn = g.spawnUnit.bind(g);
  g.spawnUnit = (type, owner, x, y) => { const u = spawn(type, owner, x, y); if (g.tick > 0 && owner >= 0) { const n = D.UNITS[type].squad || 1; S(type).built += 1 / n; S(type).spent += costOf(u) / n; } return u; };
  const addB = g.addBuilding.bind(g);
  g.addBuilding = (type, owner, tx, ty) => { const b = addB(type, owner, tx, ty); if (g.tick > 0 && owner >= 0 && D.BUILDINGS[type].cat === 'defense') { S(type).built++; S(type).spent += costOf(b); } return b; };
  const limit = minutes * 60 * D.TICK_RATE;
  while (!g.over && g.tick < limit) { g.step(); for (const ai of ais) ai.update(); }
  // tie-break unfinished games on remaining asset value
  let winner = g.over && g.winners.length === 1 ? g.winners[0] : null;
  if (winner === null) {
    const worth = [0, 0];
    for (const e of g.entities.values()) if (e.owner >= 0) worth[e.owner] += costOf(e);
    winner = worth[0] > worth[1] * 1.25 ? 0 : worth[1] > worth[0] * 1.25 ? 1 : -1;
  }
  return { a, b, map, winner, decided: g.over, minutes: g.tick / D.TICK_RATE / 60, stat };
}

if (process.argv[2] === '--worker') {
  process.on('message', job => process.send(playGame(job)));
} else {
  const per = +process.argv[2] || 2, minutes = +process.argv[3] || 30, W = +process.argv[4] || 6;
  const jobs = [];
  let k = 0;
  // full NATO-vs-Pact round robin, both sides, repeated `per` times on rotating maps
  const nato = COUNTRIES.filter(c => D.COUNTRIES[c].faction === 'NATO'), pact = COUNTRIES.filter(c => D.COUNTRIES[c].faction === 'PACT');
  for (let r = 0; r < per; r++) for (const n of nato) for (const p of pact) {
    const [a, b] = (r + k) % 2 ? [n, p] : [p, n];
    jobs.push({ a, b, map: MAPS2[k++ % MAPS2.length], seed: 1000 + k * 7 + r, minutes });
  }
  const results = [];
  const t0 = Date.now();
  await new Promise(done => {
    let next = 0, live = 0;
    for (let w = 0; w < W; w++) {
      const cp = fork(fileURLToPath(import.meta.url), ['--worker']);
      const feed = () => { if (next < jobs.length) { live++; cp.send(jobs[next++]); } else { cp.kill(); if (!live) done(); } };
      cp.on('message', r => { results.push(r); live--;  if (results.length === jobs.length) { cp.kill(); done(); } else feed(); });
      feed();
    }
  });
  console.log(`\n${jobs.length} games in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const fac = c => D.COUNTRIES[c].faction;
  const wl = {}; const add = (key, w) => { wl[key] ||= { w: 0, l: 0, d: 0 }; wl[key][w]++; };
  let fx = { NATO: 0, PACT: 0, mirror: 0, draw: 0 };
  const len = [];
  for (const r of results) {
    len.push(r.minutes);
    const sides = [r.a, r.b];
    if (r.winner < 0) { add(r.a, 'd'); add(r.b, 'd'); fx.draw++; continue; }
    add(sides[r.winner], 'w'); add(sides[1 - r.winner], 'l');
    if (fac(r.a) === fac(r.b)) fx.mirror++; else fx[fac(sides[r.winner])]++;
  }
  len.sort((x, y) => x - y);
  console.log(`\nFaction (cross-faction games): NATO ${fx.NATO}  PACT ${fx.PACT}   (same-faction ${fx.mirror}, draws ${fx.draw})`);
  console.log(`Game length: median ${len[len.length >> 1].toFixed(1)} min, decided ${results.filter(r => r.decided).length}/${results.length}`);
  console.log('\nCountry       W  L  D   win%');
  for (const c of COUNTRIES.sort((x, y) => (wl[y].w / (wl[y].w + wl[y].l || 1)) - (wl[x].w / (wl[x].w + wl[x].l || 1)))) {
    const s = wl[c] || { w: 0, l: 0, d: 0 };
    console.log(`${c.padEnd(5)} ${fac(c).padEnd(5)} ${String(s.w).padStart(3)}${String(s.l).padStart(3)}${String(s.d).padStart(3)}   ${(100 * s.w / Math.max(1, s.w + s.l)).toFixed(0)}%`);
  }
  const agg = {};
  for (const r of results) for (const [t, s] of Object.entries(r.stat)) { const A = (agg[t] ||= { built: 0, spent: 0, value: 0, cat: s.cat }); A.built += s.built; A.spent += s.spent; A.value += s.value; }
  console.log('\nType          cat        built   spent$   value destroyed per $');
  for (const [t, A] of Object.entries(agg).filter(([, A]) => A.built >= 3).sort((x, y) => y[1].value / y[1].spent - x[1].value / x[1].spent)) {
    console.log(`${t.padEnd(13)} ${String(A.cat).padEnd(9)} ${String(Math.round(A.built)).padStart(6)} ${String(Math.round(A.spent)).padStart(8)}   ${(A.value / Math.max(1, A.spent)).toFixed(2)}`);
  }
}
