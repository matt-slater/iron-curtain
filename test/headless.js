// Headless simulation smoke test: AI vs AI until someone wins or time runs out.
import { Game } from '../shared/game.js';
import { AI } from '../shared/ai.js';
import { TICK_RATE } from '../shared/data.js';

const seed = Number(process.argv[2] || 12345);
const players = Number(process.argv[3] || 2);
const minutes = Number(process.argv[4] || 25);
const countries = ['USA', 'USSR', 'UK', 'CUB', 'FRG', 'GDR', 'FRA', 'POL', 'ROK', 'PRK', 'ISR', 'EGY', 'RSA', 'VNM', 'AFG', 'IRQ'];
const mapId = process.argv[5] || 'random';
const setup = {
  seed, credits: 10000, map: mapId,
  players: Array.from({ length: players }, (_, i) => ({ name: `AI ${i}`, country: countries[(i + seed) % 16], color: i, team: 0, ai: true, difficulty: 'hard' })),
};
const g = new Game(setup);
const ais = g.players.map(p => new AI(g, p.id));
const t0 = Date.now();
let maxStep = 0, snapBytes = 0, snaps = 0;
for (let i = 0; i < minutes * 60 * TICK_RATE && !g.over; i++) {
  const s = performance.now();
  g.step();
  for (const ai of ais) ai.update();
  const snap = JSON.stringify(g.snapshot());
  maxStep = Math.max(maxStep, performance.now() - s);
  snapBytes += snap.length; snaps++;
  if (i % (TICK_RATE * 120) === 0) {
    const summary = g.players.map(p => {
      const mine = [...g.entities.values()].filter(e => e.owner === p.id);
      return `${p.country}: $${Math.floor(p.credits)} b=${mine.filter(e => e.kind === 'b').length} u=${mine.filter(e => e.kind === 'u').length} pw=${p.power}/${p.drain}`;
    }).join(' | ');
    console.log(`t=${(g.tick / TICK_RATE / 60).toFixed(1)}m ${summary}`);
  }
}
console.log('over:', g.over, 'winners:', g.winners, 'ticks:', g.tick);
console.log('stats:', g.players.map(p => `${p.country} ${JSON.stringify(p.stats)}`).join(' | '));
console.log(`wall ${(Date.now() - t0) / 1000}s, max step ${maxStep.toFixed(1)}ms, avg snapshot ${(snapBytes / snaps / 1024).toFixed(1)}KB`);
