// AI-vs-AI pathing health: units giving up mid-route, harvester productivity.
// Usage: node test/pathing-ai.js [mapId ...]
import { Game } from '../shared/game.js';
import { AI } from '../shared/ai.js';
import { TICK_RATE } from '../shared/data.js';
const maps = process.argv.slice(2).length ? process.argv.slice(2) : ['berlin'];
for (const map of maps) {
  let giveUps = 0, harvSamples = 0, harvStuck = 0, income = 0, unitMin = 0, garrisoned = 0, winners = [];
  for (const seed of [1, 2, 3]) {
    const cs = seed % 2 ? ['USA', 'USSR'] : ['PRK', 'FRG'];
    const g = new Game({ map, seed, credits: 10000, players: cs.map((c, i) => ({ name: c, country: c, color: i, ai: true, difficulty: 'hard' })) });
    const ais = g.players.map(p => new AI(g, p.id));
    const last = new Map();
    for (let t = 0; t < 12 * 60 * TICK_RATE && !g.over; t++) {
      g.step(); for (const a of ais) a.update();
      if (t % (TICK_RATE * 5) === 0) {
        for (const e of g.entities.values()) if (e.kind === 'b' && e.occ) garrisoned = Math.max(garrisoned, e.occ);
        for (const e of g.entities.values()) {
          if (e.kind !== 'u') continue;
          const p = last.get(e.id);
          last.set(e.id, { x: e.x, y: e.y });
          if (!p) continue;
          const still = Math.hypot(e.x - p.x, e.y - p.y) < 0.25;
          const o = e.order;
          if (e.type === 'harvester') {
            harvSamples++;
            if (still && o.state !== 'mine' && o.state !== 'unload') harvStuck++;
          } else if ((o.type === 'move' || o.type === 'attackMove') && e.path && e.path.length) {
            unitMin++;
            if (still && !e.target) giveUps++;
          }
        }
      }
    }
    income += g.players.reduce((a, p) => a + p.stats.built, 0);
    winners.push(g.over ? (g.winners.length ? g.players[g.winners[0]].country : 'draw') : 'timeout');
  }
  console.log(`${map.padEnd(9)} moving units stalled: ${(giveUps / Math.max(1, unitMin) * 100).toFixed(1)}% of samples  harvesters stalled: ${(harvStuck / Math.max(1, harvSamples) * 100).toFixed(1)}% of samples  units built: ${income}  max garrison seen: ${garrisoned}  results: ${winners.join(',')}`);
}
