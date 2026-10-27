// Faction-specific building art. NATO: clean prefab, hangars, radomes, sandbags.
// Warsaw Pact: brutalist stained concrete, rust, red stars, smokestacks, lattice radar.
import { BUILDINGS } from './shared/data.js';
import { iso, shade, hash, box, flat, gable, arch, sawtooth, cylinder, cone, dome, coolingTower, star, windows, windowsX, sandbags, hazard, pad, line, poly } from './art-core.js';
import { hasSprite, drawSprite, spriteMeta, spriteRows } from './sprite-art.js';

// Rendered building sheets are keyed <type>_<faction>, or <type>_<biome> for civilian buildings.
export function buildingKey(type, faction) { return type === 'derrick' || type === 'bridgehut' ? `${type}_ALL` : `${type}_${faction}`; }

const N = { wall: '#7b8176', wall2: '#686e64', roof: '#454b4b', pad: '#5c5e57', glass: '#3e5462', olive: '#4e5634', crane: '#c09a2a' };
const P = { wall: '#857a66', wall2: '#6d6352', roof: '#5e3e2c', pad: '#55514a', brick: '#6a3b2c', red: '#9e2a1e', rust: '#7a4a2e', green: '#4a5636' };

function nato(ctx, type, color, seed) {
  switch (type) {
    case 'conyard':
      pad(ctx, 3, 3, 4, N.pad, seed);
      box(ctx, 0.2, 0.2, 2.0, 1.8, 4, 28, N.wall, null, 0.5, seed);
      flat(ctx, 0.2, 1.5, 2.0, 1.8, 28.5, color);
      box(ctx, 0.45, 0.4, 0.95, 0.85, 28, 34, '#5a5f5c');
      box(ctx, 1.2, 0.45, 1.6, 0.8, 28, 32, '#5a5f5c');
      windows(ctx, 0.35, 1.9, 1.8, 20, 5, N.glass, 0.4, seed);
      windowsX(ctx, 2.0, 0.3, 1.7, 20, 3, N.glass, 0.4, seed);
      // gantry crane
      for (const [x, y] of [[2.25, 0.3], [2.75, 0.3], [2.25, 2.6], [2.75, 2.6]]) box(ctx, x - 0.05, y - 0.05, x + 0.05, y + 0.05, 4, 52, N.crane, null, 0);
      box(ctx, 2.15, 0.2, 2.85, 2.7, 52, 57, N.crane, null, 0);
      box(ctx, 2.4, 1.3, 2.6, 1.5, 40, 52, '#2a2b26', null, 0);
      box(ctx, 0.4, 2.15, 1.3, 2.75, 4, 11, '#6b6f5a', null, 0.3);
      flat(ctx, 0.4, 2.15, 1.3, 2.3, 11.5, color);
      break;
    case 'power':
      pad(ctx, 2, 2, 3, N.pad, seed);
      box(ctx, 0.12, 1.05, 1.88, 1.88, 3, 18, N.wall, null, 0.6, seed);
      flat(ctx, 0.12, 1.6, 1.88, 1.88, 18.5, color);
      windows(ctx, 0.3, 1.8, 1.88, 12, 4, N.glass, 0.5, seed);
      coolingTower(ctx, 0.6, 0.55, 0.42, 46, '#9a978a');
      coolingTower(ctx, 1.45, 0.6, 0.36, 38, '#9a978a');
      break;
    case 'refinery':
      pad(ctx, 3, 3, 4, N.pad, seed);
      box(ctx, 0.2, 0.2, 2.8, 1.5, 4, 24, N.wall, null, 0.6, seed);
      flat(ctx, 0.2, 1.25, 2.8, 1.5, 24.5, color);
      box(ctx, 0.5, 0.4, 1.4, 1.0, 24, 30, N.roof);
      windows(ctx, 0.4, 2.6, 1.5, 15, 6, N.glass, 0.3, seed);
      cylinder(ctx, 0.55, 2.2, 0.38, 4, 26, '#a8a596', '#8b887a');
      cylinder(ctx, 2.45, 2.35, 0.32, 4, 20, '#a8a596', '#8b887a');
      line(ctx, iso(0.55, 2.2, 22), iso(1.4, 1.5, 18), '#3a3c38', 3);
      flat(ctx, 1.15, 2.1, 1.85, 2.95, 4.5, '#2e302c');
      hazard(ctx, 1.15, 2.85, 1.85, 2.95, 4.7, 4);
      break;
    case 'barracks':
      pad(ctx, 2, 2, 2, '#4f4c40', seed);
      box(ctx, 0.2, 0.3, 1.8, 1.55, 2, 9, N.olive, null, 0.4, seed);
      arch(ctx, 0.2, 0.3, 1.8, 1.55, 9, 15, N.olive, 7);
      { const [dx, dy] = iso(1.8, 0.92, 2); ctx.fillStyle = '#1e1f1a'; ctx.fillRect(Math.round(dx - 2), Math.round(dy - 13), 7, 12); }
      sandbags(ctx, [[0.3, 1.85], [0.6, 1.85], [0.9, 1.85], [1.2, 1.85], [1.5, 1.85], [1.85, 1.6], [1.85, 1.3]], 2);
      { const [fx, fy] = iso(0.25, 1.85, 2); line(ctx, [fx, fy], [fx, fy - 46], '#8f8f86', 2); ctx.fillStyle = color; ctx.fillRect(fx + 1, fy - 46, 13, 8); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(fx + 1, fy - 43, 13, 2); }
      break;
    case 'factory':
      pad(ctx, 3, 3, 4, N.pad, seed);
      box(ctx, 0.15, 0.15, 2.85, 2.5, 4, 22, N.wall2, null, 0.7, seed);
      arch(ctx, 0.15, 0.15, 2.85, 2.5, 22, 18, '#5d625e', 9);
      { const p = [iso(0.85, 2.5, 4), iso(2.15, 2.5, 4), iso(2.15, 2.5, 21), iso(0.85, 2.5, 21)]; poly(ctx, p, '#2a2b27');
        for (let z = 7; z < 21; z += 3) line(ctx, iso(0.85, 2.5, z), iso(2.15, 2.5, z), 'rgba(160,160,140,0.18)'); }
      flat(ctx, 0.15, 2.5, 0.85, 2.5, 22, color);
      box(ctx, 0.15, 2.3, 0.75, 2.5, 4, 22, N.wall2, shade(color, 0.85), 0.5, seed + 3);
      box(ctx, 2.25, 2.3, 2.85, 2.5, 4, 22, N.wall2, shade(color, 0.85), 0.5, seed + 4);
      hazard(ctx, 0.85, 2.55, 2.15, 2.95, 4.5, 6);
      windowsX(ctx, 2.85, 0.4, 2.2, 15, 4, N.glass, 0.3, seed);
      break;
    case 'radar':
      pad(ctx, 2, 2, 3, N.pad, seed);
      box(ctx, 0.15, 0.9, 1.85, 1.85, 3, 16, N.wall, null, 0.6, seed);
      flat(ctx, 0.15, 1.6, 1.85, 1.85, 16.5, color);
      windows(ctx, 0.3, 1.7, 1.85, 10, 3, N.glass, 0.5, seed);
      for (const [x, y] of [[0.4, 0.3], [1.0, 0.3], [0.4, 0.85], [1.0, 0.85]]) line(ctx, iso(x, y, 3), iso(0.7, 0.58, 26), '#55574f', 2);
      dome(ctx, 0.7, 0.58, 0.42, 26, '#c8c4b4');
      break;
    case 'tech':
      pad(ctx, 2, 2, 3, N.pad, seed);
      box(ctx, 0.15, 0.15, 1.85, 1.85, 3, 20, '#8f948c', null, 0.5, seed);
      flat(ctx, 0.15, 1.55, 1.85, 1.85, 20.5, color);
      windows(ctx, 0.25, 1.75, 1.85, 13, 5, '#5b7482', 0.6, seed);
      windowsX(ctx, 1.85, 0.25, 1.75, 13, 4, '#5b7482', 0.6, seed);
      dome(ctx, 1.0, 1.0, 0.62, 20, '#5b7482', true);
      line(ctx, iso(1, 1, 38), iso(1, 1, 50), '#2a2b26', 2);
      break;
    case 'silo':
      pad(ctx, 2, 2, 5, '#4f504a', seed);
      hazard(ctx, 0.08, 0.08, 1.92, 0.22, 5.5, 8);
      for (const [cx, cy] of [[0.65, 0.95], [1.4, 1.05]]) {
        const [sx, sy] = iso(cx, cy, 5.5);
        ctx.fillStyle = '#2a2b27'; ctx.beginPath(); ctx.ellipse(sx, sy, 17, 8.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4a4c46'; ctx.beginPath(); ctx.ellipse(sx, sy - 1, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
        line(ctx, [sx - 14, sy - 1], [sx + 14, sy - 1], '#1a1a16');
      }
      for (let i = 0; i <= 4; i++) line(ctx, iso(0.05 + i * 0.47, 1.95, 5), iso(0.05 + i * 0.47, 1.95, 15), '#55574f');
      line(ctx, iso(0.05, 1.95, 13), iso(1.95, 1.95, 13), 'rgba(110,112,100,0.6)');
      box(ctx, 1.65, 0.35, 1.95, 0.7, 5, 13, '#5b5f58', shade(color, 0.85), 0.3, seed);
      break;
    case 'pillbox':
      sandbags(ctx, [[0.2, 0.3], [0.5, 0.15], [0.8, 0.3], [0.15, 0.6], [0.85, 0.6], [0.3, 0.88], [0.7, 0.88]], 0);
      sandbags(ctx, [[0.3, 0.4], [0.7, 0.4], [0.3, 0.75], [0.7, 0.75]], 5);
      flat(ctx, 0.35, 0.35, 0.65, 0.65, 9, shade(color, 0.8));
      break;
    case 'atgun':
      sandbags(ctx, [[0.15, 0.35], [0.4, 0.15], [0.7, 0.15], [0.9, 0.4], [0.15, 0.7], [0.9, 0.7], [0.4, 0.9], [0.7, 0.9]], 0);
      cylinder(ctx, 0.5, 0.5, 0.14, 0, 5, '#4a4c40', shade(color, 0.8));
      break;
  }
}

function pact(ctx, type, color, seed) {
  switch (type) {
    case 'conyard':
      pad(ctx, 3, 3, 4, P.pad, seed);
      box(ctx, 0.15, 0.2, 2.1, 1.85, 4, 22, P.wall, null, 0.9, seed);
      box(ctx, 0.4, 0.4, 1.7, 1.4, 22, 34, P.wall2, null, 0.8, seed + 1);
      flat(ctx, 0.4, 1.15, 1.7, 1.4, 34.5, color);
      windows(ctx, 0.3, 2.0, 1.85, 15, 6, '#3a3c36', 0.25, seed);
      { const [sx, sy] = iso(1.05, 1.4, 27); star(ctx, sx, sy, 6, P.red); }
      // rusty tower crane
      for (let z = 4; z < 66; z += 8) {
        line(ctx, iso(2.5, 0.5, z), iso(2.5, 0.5, z + 8), '#8a4a26', 2);
        line(ctx, iso(2.4, 0.4, z), iso(2.6, 0.6, z + 8), '#6a3a20', 1);
      }
      line(ctx, iso(2.5, 2.9, 66), iso(2.5, -0.1, 66), '#8a4a26', 3);
      line(ctx, iso(2.5, 0.5, 72), iso(2.5, 2.9, 66), '#5a3018', 1);
      line(ctx, iso(2.5, 2.4, 66), iso(2.5, 2.4, 40), '#1a1a16', 1);
      box(ctx, 2.35, -0.05, 2.65, 0.15, 60, 66, '#3a3c36', null, 0);
      box(ctx, 0.3, 2.2, 1.4, 2.8, 4, 10, '#4c5536', null, 0.4);
      flat(ctx, 0.3, 2.2, 1.4, 2.35, 10.5, color);
      break;
    case 'power':
      pad(ctx, 2, 2, 3, P.pad, seed);
      box(ctx, 0.12, 0.7, 1.88, 1.88, 3, 22, P.brick, null, 0.9, seed);
      sawtooth(ctx, 0.12, 0.7, 1.88, 1.88, 22, 3, 7, P.roof);
      flat(ctx, 0.12, 1.65, 1.88, 1.88, 22.2, color);
      windows(ctx, 0.3, 1.8, 1.88, 13, 4, '#3a3c36', 0.5, seed);
      for (const [x, y, h] of [[0.4, 0.35, 64], [0.95, 0.3, 58], [1.5, 0.35, 64]]) {
        cylinder(ctx, x, y, 0.12, 3, h, '#7a6e60');
        cylinder(ctx, x, y, 0.13, h - 14, h - 8, '#a8281e');
        cylinder(ctx, x, y, 0.13, h - 26, h - 20, '#a8281e');
      }
      { const [sx, sy] = iso(0.25, 0.4, 3); ctx.fillStyle = '#141412'; ctx.beginPath(); ctx.ellipse(sx, sy, 12, 6, 0, Math.PI, 0); ctx.fill(); }
      break;
    case 'refinery':
      pad(ctx, 3, 3, 4, P.pad, seed);
      box(ctx, 0.2, 1.2, 1.6, 2.0, 4, 18, P.brick, null, 0.9, seed);
      gable(ctx, 0.2, 1.2, 1.6, 2.0, 18, 8, P.roof);
      for (const [x, y, h] of [[0.5, 0.5, 40], [1.2, 0.45, 44], [1.95, 0.5, 40]]) {
        cylinder(ctx, x, y, 0.3, 4, h, P.rust, shade(P.rust, 0.8));
        cone(ctx, x, y, 0.3, h, h + 10, P.rust);
      }
      line(ctx, iso(0.5, 0.5, 30), iso(1.95, 0.5, 30), '#3a2a20', 3);
      line(ctx, iso(1.95, 0.5, 20), iso(2.6, 2.0, 8), '#3a2a20', 4);
      box(ctx, 2.2, 1.3, 2.85, 2.0, 4, 14, P.wall2, null, 0.8, seed + 2);
      flat(ctx, 2.2, 1.85, 2.85, 2.0, 14.5, color);
      flat(ctx, 1.15, 2.15, 1.85, 2.95, 4.5, '#2b2a26');
      hazard(ctx, 1.15, 2.85, 1.85, 2.95, 4.7, 4);
      { const [sx, sy] = iso(1.2, 0.45, 25); star(ctx, sx + 4, sy, 5, P.red); }
      break;
    case 'barracks':
      pad(ctx, 2, 2, 2, '#4d4a42', seed);
      box(ctx, 0.15, 0.25, 1.85, 1.6, 2, 24, P.wall, null, 1, seed);
      flat(ctx, 0.15, 0.25, 1.85, 1.6, 24, shade(P.wall2, 0.9));
      flat(ctx, 0.15, 1.35, 1.85, 1.6, 24.3, color);
      windows(ctx, 0.3, 1.75, 1.6, 18, 4, '#3a3c36', 0.3, seed);
      windows(ctx, 0.3, 1.75, 1.6, 10, 4, '#3a3c36', 0.3, seed + 1);
      { const [sx, sy] = iso(1.85, 0.9, 14); ctx.fillStyle = P.red; ctx.fillRect(sx - 1, sy - 9, 6, 18); star(ctx, sx + 2, sy - 4, 2.5, '#d8b860'); }
      for (let i = 0; i < 6; i++) line(ctx, iso(0.05 + i * 0.36, 1.92, 2), iso(0.05 + i * 0.36, 1.92, 9), '#4a4a42');
      line(ctx, iso(0.05, 1.92, 8), iso(1.85, 1.92, 8), 'rgba(90,90,80,0.7)');
      break;
    case 'factory':
      pad(ctx, 3, 3, 4, P.pad, seed);
      box(ctx, 0.15, 0.15, 2.85, 2.5, 4, 24, P.wall, null, 1, seed);
      sawtooth(ctx, 0.15, 0.15, 2.85, 2.5, 24, 5, 10, P.roof);
      { const p = [iso(0.85, 2.5, 4), iso(2.15, 2.5, 4), iso(2.15, 2.5, 20), iso(0.85, 2.5, 20)]; poly(ctx, p, '#262420');
        for (let z = 7; z < 20; z += 3) line(ctx, iso(0.85, 2.5, z), iso(2.15, 2.5, z), 'rgba(120,90,60,0.25)'); }
      flat(ctx, 0.15, 2.3, 2.85, 2.5, 24.3, color);
      cylinder(ctx, 0.45, 0.4, 0.15, 24, 62, '#6e6252');
      { const [sx, sy] = iso(1.5, 2.5, 23); star(ctx, sx, sy, 5, P.red); }
      hazard(ctx, 0.85, 2.55, 2.15, 2.95, 4.5, 6);
      break;
    case 'radar':
      pad(ctx, 2, 2, 3, P.pad, seed);
      box(ctx, 0.2, 0.9, 1.6, 1.85, 3, 14, P.wall, null, 0.9, seed);
      flat(ctx, 0.2, 1.6, 1.6, 1.85, 14.5, color);
      box(ctx, 0.9, 0.35, 1.2, 0.65, 3, 30, '#5c5446', null, 0.5);
      windows(ctx, 0.35, 1.5, 1.85, 9, 3, '#3a3c36', 0.3, seed);
      break;
    case 'tech':
      pad(ctx, 2, 2, 3, P.pad, seed);
      box(ctx, 0.15, 0.15, 1.85, 1.85, 3, 18, P.wall, null, 1, seed);
      flat(ctx, 0.15, 1.55, 1.85, 1.85, 18.5, color);
      windows(ctx, 0.25, 1.75, 1.85, 11, 5, '#3a3c36', 0.4, seed);
      box(ctx, 0.75, 0.75, 1.25, 1.25, 18, 46, P.wall2, null, 0.8, seed + 1);
      cylinder(ctx, 1.0, 1.0, 0.32, 46, 52, '#7a7060');
      line(ctx, iso(1, 1, 52), iso(1, 1, 82), '#3a3a34', 2);
      { const [sx, sy] = iso(1.35, 0.5, 26); ctx.fillStyle = '#a8a08c'; ctx.beginPath(); ctx.ellipse(sx, sy, 9, 6, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#2a2a26'; ctx.stroke(); }
      break;
    case 'silo':
      pad(ctx, 2, 2, 6, '#4a463e', seed);
      box(ctx, 0.25, 0.25, 1.75, 1.75, 6, 12, P.wall2, null, 0.6, seed);
      flat(ctx, 0.35, 0.35, 0.98, 1.65, 12.3, '#4c463a');
      flat(ctx, 1.02, 0.35, 1.65, 1.65, 12.3, '#4c463a');
      { const [sx, sy] = iso(1, 1, 12.5); star(ctx, sx, sy, 8, P.red); }
      hazard(ctx, 0.08, 1.8, 1.92, 1.95, 6.5, 8);
      box(ctx, 1.75, 0.2, 1.97, 0.55, 6, 14, P.rust, shade(color, 0.85), 0.5);
      break;
    case 'pillbox':
      cylinder(ctx, 0.5, 0.5, 0.42, 0, 7, '#6f685a', '#5e5849');
      dome(ctx, 0.5, 0.5, 0.36, 7, '#6f685a');
      { const [sx, sy] = iso(0.5, 0.5, 9); ctx.fillStyle = '#0d0d0b'; ctx.fillRect(Math.round(sx - 9), Math.round(sy), 18, 2); }
      { const [sx, sy] = iso(0.5, 0.5, 16); ctx.fillStyle = shade(color, 0.85); ctx.fillRect(Math.round(sx - 3), Math.round(sy - 1), 6, 2); }
      break;
    case 'atgun':
      flat(ctx, 0.1, 0.1, 0.9, 0.9, 0.5, '#3a3226');
      for (const [x, y] of [[0.2, 0.75], [0.8, 0.75]]) line(ctx, iso(0.5, 0.5, 2), iso(x, y, 0), '#3c4430', 2);
      cylinder(ctx, 0.5, 0.5, 0.1, 0, 5, P.green, shade(color, 0.8));
      break;
  }
}

function derrick(ctx, color, seed) {
  pad(ctx, 2, 2, 2, '#4a3a28', seed);
  for (let k = 0; k < 6; k++) { const [sx, sy] = iso(0.3 + hash(k, 3) * 1.4, 0.3 + hash(3, k) * 1.4, 2); ctx.fillStyle = 'rgba(8,8,6,0.6)'; ctx.beginPath(); ctx.ellipse(sx, sy, 5 + k, 2.5 + k / 2, 0, 0, Math.PI * 2); ctx.fill(); }
  cylinder(ctx, 1.45, 0.55, 0.32, 2, 22, '#6a5a44', '#4a3e2e');
  box(ctx, 0.25, 1.2, 0.75, 1.75, 2, 10, '#4c4a42', null, 0.8);
  const base = iso(0.7, 0.9, 2), top = iso(0.7, 0.9, 30);
  line(ctx, [base[0] - 8, base[1]], top, '#2c2a24', 3);
  line(ctx, [base[0] + 8, base[1]], top, '#2c2a24', 3);
  if (color) flat(ctx, 1.3, 1.5, 1.8, 1.8, 2.5, color);
}

// ---------- civilian (garrisonable) buildings, styled per biome ----------
const CIV = {
  temperate: { walls: ['#8a8270', '#7d7466', '#6a6a64'], roof: '#6e3426', flat: '#4a4844', pave: '#5c5a52', glass: '#3e5462' },
  arctic: { walls: ['#4e3e2e', '#7e817e', '#6e716e'], roof: '#d2d6d4', flat: '#c6cbc9', pave: '#8e9290', glass: '#3e5462' },
  desert: { walls: ['#a8885e', '#ad9670', '#b3ab98'], roof: '#8a6e48', flat: '#9a7e58', pave: '#8a7454', glass: '#2a2620' },
  jungle: { walls: ['#5a4630', '#86846a', '#8a866e'], roof: '#7a4a2e', flat: '#6a4a30', pave: '#5a4632', glass: '#2a2a22' },
};

function facadeWindows(ctx, W, H, m, z0, levels, step, P, seed, lit) {
  for (let k = 0; k < levels; k++) {
    const z = z0 + k * step;
    windows(ctx, m + 0.1, W - m - 0.1, H - m, z, Math.max(2, Math.round((W - 2 * m) * 2.4)), P.glass, lit, seed + k);
    windowsX(ctx, W - m, m + 0.1, H - m - 0.1, z, Math.max(2, Math.round((H - 2 * m) * 2.4)), P.glass, lit, seed + 31 + k);
  }
}

function roofFlag(ctx, x, y, z, color) {
  const [fx, fy] = iso(x, y, z);
  line(ctx, [fx, fy], [fx, fy - 18], '#8f8f86', 2);
  ctx.fillStyle = color; ctx.fillRect(Math.round(fx + 1), Math.round(fy - 18), 10, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(Math.round(fx + 1), Math.round(fy - 13), 10, 1);
}

export function drawCivilian(ctx, type, biome, color, seed) {
  const d = BUILDINGS[type];
  const W = d.w, H = d.h, m = 0.14;
  const P = CIV[biome] || CIV.temperate;
  pad(ctx, W, H, 2, P.pave, seed);
  let top = 0;
  if (type === 'house') {
    if (biome === 'jungle') {
      // stilt hut with thatch
      for (const [x, y] of [[m + 0.1, m + 0.1], [W - m - 0.1, m + 0.1], [m + 0.1, H - m - 0.1], [W - m - 0.1, H - m - 0.1]]) line(ctx, iso(x, y, 2), iso(x, y, 10), '#3a2a1a', 2);
      box(ctx, m + 0.1, m + 0.1, W - m - 0.1, H - m - 0.1, 10, 20, P.walls[0], null, 0.5, seed);
      windows(ctx, m + 0.3, W - m - 0.3, H - m - 0.1, 16, 2, '#1a1610', 0.2, seed);
      gable(ctx, m - 0.05, m - 0.05, W - m + 0.05, H - m + 0.05, 20, 14, '#8a7444');
      top = 34;
    } else {
      const wall = P.walls[0];
      box(ctx, m, m, W - m, H - m, 2, 18, wall, null, 0.6, seed);
      windows(ctx, m + 0.2, W - m - 0.2, H - m, 12, 2, P.glass, 0.4, seed);
      windowsX(ctx, W - m, m + 0.2, H - m - 0.2, 12, 2, P.glass, 0.4, seed + 3);
      { const [dx, dy] = iso(W / 2, H - m, 2); ctx.fillStyle = '#241e16'; ctx.fillRect(Math.round(dx - 2), Math.round(dy - 9), 5, 8); }
      if (biome === 'desert') {
        flat(ctx, m, m, W - m, H - m, 18.2, P.flat);
        box(ctx, m, H - m - 0.12, W - m, H - m, 18, 21, wall, null, 0);
        box(ctx, W - m - 0.12, m, W - m, H - m, 18, 21, wall, null, 0);
        cylinder(ctx, m + 0.45, m + 0.45, 0.16, 18, 24, '#5a5a52');
        top = 24;
      } else {
        gable(ctx, m - 0.05, m - 0.05, W - m + 0.05, H - m + 0.05, 18, 12, P.roof);
        box(ctx, W - m - 0.5, m + 0.25, W - m - 0.3, m + 0.45, 22, 32, biome === 'arctic' ? '#4a4038' : '#5a3a2e', null, 0);
        top = 30;
      }
    }
  } else if (type === 'tenement' || type === 'tenementB') {
    const wall = P.walls[1], levels = 4, step = 8;
    box(ctx, m, m, W - m, H - m, 2, 2 + levels * step, wall, null, 0.9, seed);
    facadeWindows(ctx, W, H, m, 7, levels, step, P, seed, 0.35);
    for (let k = 1; k < levels; k++) line(ctx, iso(m, H - m, 2 + k * step), iso(W - m, H - m, 2 + k * step), 'rgba(20,18,14,0.45)');
    const z = 2 + levels * step;
    if (biome === 'jungle') { gable(ctx, m - 0.05, m - 0.05, W - m + 0.05, H - m + 0.05, z, 10, '#7a4a2e'); top = z + 10; }
    else {
      flat(ctx, m, m, W - m, H - m, z + 0.2, P.flat);
      box(ctx, m + 0.3, m + 0.3, m + 0.75, m + 0.75, z, z + 6, P.flat, null, 0);
      if (biome !== 'desert') box(ctx, W - m - 0.6, m + 0.3, W - m - 0.4, m + 0.5, z, z + 8, '#4a4038', null, 0);
      top = z + 6;
    }
    { const [dx, dy] = iso(W / 2, H - m, 2); ctx.fillStyle = '#1e1a14'; ctx.fillRect(Math.round(dx - 3), Math.round(dy - 10), 7, 9); }
  } else {
    // office / government block
    const wall = P.walls[2], levels = biome === 'jungle' ? 3 : 6, step = biome === 'jungle' ? 10 : 7.5;
    const zt = 2 + levels * step;
    box(ctx, m, m, W - m, H - m, 2, zt, wall, null, 0.9, seed);
    facadeWindows(ctx, W, H, m, 7, levels, step, P, seed, 0.3);
    if (biome === 'jungle') {
      // colonial veranda with columns and a tin roof
      for (let i = 0; i <= 5; i++) line(ctx, iso(m + (W - 2 * m) * i / 5, H - m + 0.25, 2), iso(m + (W - 2 * m) * i / 5, H - m + 0.25, 12), '#d0c8b0', 2);
      gable(ctx, m - 0.1, m - 0.1, W - m + 0.1, H - m + 0.35, zt, 12, '#7a4a2e');
      top = zt + 12;
    } else {
      flat(ctx, m, m, W - m, H - m, zt + 0.2, P.flat);
      if (biome === 'desert') { dome(ctx, W / 2, H / 2, 0.55, zt, '#b8a888'); top = zt + 26; }
      else {
        box(ctx, m + 0.4, m + 0.4, m + 1.2, m + 1.0, zt, zt + 7, P.flat, null, 0);
        line(ctx, iso(W - m - 0.4, m + 0.4, zt), iso(W - m - 0.4, m + 0.4, zt + 20), '#2a2a26', 1);
        top = zt + 7;
      }
    }
    { const [dx, dy] = iso(W / 2, H - m, 2); ctx.fillStyle = '#1e1a14'; ctx.fillRect(Math.round(dx - 4), Math.round(dy - 11), 9, 10); }
  }
  if (biome === 'arctic' && type !== 'house') flat(ctx, m + 0.05, m + 0.05, W - m - 0.05, H - m - 0.05, top - (type === 'office' ? 7 : 6) + 0.4, 'rgba(225,230,228,0.75)');
  if (color) roofFlag(ctx, W - m - 0.3, H - m - 0.3, top, color);
}

// Air base: 4 landing pads (matching game.padPos) around a small control tower.
function airfield(ctx, pactF, color, seed) {
  pad(ctx, 3, 3, 2, pactF ? '#4a473f' : '#565852', seed);
  for (const [cx, cy] of [[0.8, 0.8], [2.2, 0.8], [0.8, 2.2], [2.2, 2.2]]) {
    const [sx, sy] = iso(cx, cy, 2.2);
    ctx.fillStyle = pactF ? '#3a372f' : '#41433e';
    ctx.beginPath(); ctx.ellipse(sx, sy, 34, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pactF ? '#9a8a3a' : '#c8c4a8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(sx, sy, 28, 14, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    if (pactF) star(ctx, sx, sy, 7, '#7a2a1e');
    else { ctx.fillStyle = '#c8c4a8'; ctx.fillRect(Math.round(sx - 5), Math.round(sy - 1), 11, 2); ctx.fillRect(Math.round(sx - 5), Math.round(sy - 5), 2, 10); ctx.fillRect(Math.round(sx + 4), Math.round(sy - 5), 2, 10); }
  }
  hazard(ctx, 0.05, 1.45, 0.4, 1.55, 2.3, 3);
  hazard(ctx, 2.6, 1.45, 2.95, 1.55, 2.3, 3);
  // control tower
  if (pactF) {
    box(ctx, 1.32, 1.32, 1.68, 1.68, 2, 12, P.wall, null, 0.9, seed);
    box(ctx, 1.24, 1.24, 1.76, 1.76, 12, 17, '#3a3c36', shade(color, 0.85), 0.3, seed + 1);
    line(ctx, iso(1.5, 1.5, 17), iso(1.5, 1.5, 28), '#2a2a24', 2);
  } else {
    box(ctx, 1.34, 1.34, 1.66, 1.66, 2, 11, N.wall, null, 0.5, seed);
    box(ctx, 1.26, 1.26, 1.74, 1.74, 11, 16, N.glass, shade(color, 0.85), 0.2, seed + 1);
    dome(ctx, 1.6, 1.4, 0.1, 16, '#c8c4b4');
  }
}

function samsite(ctx, pactF, color, seed) {
  if (pactF) {
    // SA-2 style: dug-in circular revetment
    flat(ctx, 0.1, 0.1, 1.9, 1.9, 0.5, '#3a3226');
    sandbags(ctx, [[0.3, 0.2], [0.7, 0.1], [1.2, 0.1], [1.65, 0.25], [1.9, 0.7], [1.9, 1.2], [1.7, 1.7], [0.25, 1.65], [0.1, 1.2], [0.1, 0.7]], 0, '#6a6048');
    cylinder(ctx, 1, 1, 0.3, 0, 5, P.green, shade(color, 0.8));
  } else {
    pad(ctx, 2, 2, 2, N.pad, seed);
    hazard(ctx, 0.1, 1.8, 1.9, 1.92, 2.3, 7);
    cylinder(ctx, 1, 1, 0.3, 2, 6, N.olive, shade(color, 0.8));
    // acquisition radar box in the corner
    box(ctx, 0.15, 0.15, 0.55, 0.55, 2, 9, N.wall2, shade(color, 0.85), 0.4, seed);
  }
}

export function drawBuilding(ctx, type, faction, color, seed = 7) {
  const key = buildingKey(type, faction);
  if (hasSprite(key)) {
    const d = BUILDINGS[type];
    drawSprite(ctx, key, 'body', d.w / 2, d.h / 2, 0, BUILDINGS[type].civilian ? null : color);
    const m = spriteMeta(key);
    // garrisoned civilian buildings fly the occupier's flag
    if (BUILDINGS[type].civilian && color && m.flag) roofFlag(ctx, m.flag[0], m.flag[1], m.roof, color);
    return;
  }
  if (type === 'derrick') return derrick(ctx, color, seed);
  if (type === 'bridgehut') {
    box(ctx, 0.15, 0.15, 0.85, 0.85, 0, 11, '#8a8676', null, 0.6, seed);
    flat(ctx, 0.1, 0.1, 0.9, 0.9, 11.5, '#4c4a42');
    const [dx, dy] = iso(0.5, 0.85, 0); ctx.fillStyle = '#2a2620'; ctx.fillRect(Math.round(dx - 2), Math.round(dy - 8), 5, 7);
    hazard(ctx, 0.15, 0.85, 0.85, 0.92, 0.5, 4);
    return;
  }
  if (type === 'airfield') return airfield(ctx, faction === 'PACT', color, seed);
  if (type === 'samsite') return samsite(ctx, faction === 'PACT', color, seed);
  if (BUILDINGS[type].civilian) return drawCivilian(ctx, type, faction, color, seed);
  if (faction === 'PACT') pact(ctx, type, color, seed);
  else nato(ctx, type, color, seed);
}

// Per-frame animated parts (world coords, footprint origin at tx, ty).
export function drawBuildingDynamic(ctx, b, color, time, powered, faction) {
  const { tx, ty } = b;
  const key = buildingKey(b.type, faction);
  if (hasSprite(key)) {
    const rows = spriteRows(key), cx = tx + b.w / 2, cy = ty + b.h / 2;
    if (rows.turret) drawSprite(ctx, key, 'turret', cx, cy, b.turret, color);
    // the antenna sheet is a 16-frame rotation; it stops turning when the power is down
    if (rows.dish) drawSprite(ctx, key, 'dish', cx, cy, powered ? time * 1.4 : 0.7, color);
    if (rows['pump.p0']) drawSprite(ctx, key, `pump.p${Math.floor(time * 5) & 7}`, cx, cy, 0, color);
    return;
  }
  const pactF = faction === 'PACT';
  if (b.type === 'radar') {
    const a = powered ? time * 1.4 : 0.7;
    if (pactF) {
      // big rotating lattice antenna on mast
      const cx = tx + 1.05, cy = ty + 0.5, z = 32;
      const hx = Math.cos(a) * 0.55, hy = Math.sin(a) * 0.55;
      const p1 = iso(cx - hx, cy - hy, z), p2 = iso(cx + hx, cy + hy, z), p3 = iso(cx + hx, cy + hy, z + 14), p4 = iso(cx - hx, cy - hy, z + 14);
      poly(ctx, [p1, p2, p3, p4], 'rgba(60,56,46,0.55)');
      for (let i = 1; i < 6; i++) { const f = i / 6; line(ctx, [p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f], [p4[0] + (p3[0] - p4[0]) * f, p4[1] + (p3[1] - p4[1]) * f], '#2a2822'); }
      line(ctx, [(p1[0] + p4[0]) / 2, (p1[1] + p4[1]) / 2], [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2], '#2a2822');
    } else {
      const [sx, sy] = iso(tx + 1.4, ty + 1.35, 18);
      const c = Math.cos(a);
      ctx.fillStyle = '#9c9888'; ctx.strokeStyle = '#2a2a24';
      ctx.beginPath(); ctx.ellipse(sx, sy - 6, 9 * Math.abs(c) + 2, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      line(ctx, [sx, sy], [sx, sy - 6], '#2a2a24', 2);
    }
    if (powered && Math.floor(time * 2) % 2) { const [lx, ly] = iso(tx + 0.7, ty + 0.58, pactF ? 50 : 52); ctx.fillStyle = '#e04030'; ctx.fillRect(Math.round(lx - 1), Math.round(ly - 1), 2, 2); }
  } else if (b.type === 'pillbox' || b.type === 'atgun') {
    const cx = tx + 0.5, cy = ty + 0.5;
    const d = b.turret;
    if (b.type === 'pillbox') {
      const z = pactF ? 9 : 10;
      const a = iso(cx, cy, z), e = iso(cx + Math.cos(d) * 0.38, cy + Math.sin(d) * 0.38, z);
      line(ctx, a, e, '#141412', 2);
    } else if (pactF) {
      // towed AT gun: shield + long barrel
      const a = iso(cx, cy, 7), e = iso(cx + Math.cos(d) * 0.7, cy + Math.sin(d) * 0.7, 8);
      line(ctx, a, e, '#1c1d18', 3);
      const px = -Math.sin(d) * 0.18, py = Math.cos(d) * 0.18;
      poly(ctx, [iso(cx + px, cy + py, 4), iso(cx - px, cy - py, 4), iso(cx - px, cy - py, 12), iso(cx + px, cy + py, 12)], '#4a5636');
    } else {
      // TOW launcher on tripod
      const a = iso(cx - Math.cos(d) * 0.15, cy - Math.sin(d) * 0.15, 11), e = iso(cx + Math.cos(d) * 0.35, cy + Math.sin(d) * 0.35, 12);
      line(ctx, iso(cx, cy, 3), iso(cx, cy, 10), '#2a2a24', 2);
      line(ctx, a, e, '#3e4430', 4);
      ctx.fillStyle = '#1c1d18'; ctx.fillRect(Math.round(e[0] - 1), Math.round(e[1] - 1), 3, 3);
    }
  } else if (b.type === 'samsite') {
    // traversing missile launcher rails, elevated toward the sky
    const cx = tx + 1, cy = ty + 1, d = b.turret, z0 = pactF ? 6 : 7;
    const n = pactF ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const q = (i - (n - 1) / 2) * 0.16;
      const ox = -Math.sin(d) * q, oy = Math.cos(d) * q;
      const a = iso(cx + ox - Math.cos(d) * 0.4, cy + oy - Math.sin(d) * 0.4, z0 + 3);
      const e = iso(cx + ox + Math.cos(d) * 0.6, cy + oy + Math.sin(d) * 0.6, z0 + 24);
      line(ctx, iso(cx + ox, cy + oy, z0), iso(cx + ox, cy + oy, z0 + 12), '#22241e', 2);
      line(ctx, a, e, '#22241e', pactF ? 7 : 5);
      line(ctx, [a[0], a[1] - 1], [e[0], e[1] - 1], pactF ? '#c8c4b0' : '#d8d4c4', pactF ? 5 : 3);
      ctx.fillStyle = pactF ? '#9e2a1e' : '#3a3c36'; ctx.fillRect(Math.round(e[0] - 2), Math.round(e[1] - 3), 4, 4);
    }
    if (!pactF) {
      const r = powered ? time * 2 : 0.5;
      const [sx, sy] = iso(tx + 0.35, ty + 0.35, 13);
      ctx.fillStyle = '#9c9888'; ctx.strokeStyle = '#2a2a24';
      ctx.beginPath(); ctx.ellipse(sx, sy, 6 * Math.abs(Math.cos(r)) + 1.5, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  } else if (b.type === 'derrick') {
    const ph = Math.sin(time * 2.5);
    const piv = iso(tx + 0.7, ty + 0.9, 30);
    line(ctx, [piv[0] - 22, piv[1] + 8 + ph * 7], [piv[0] + 18, piv[1] - 6 - ph * 7], '#1a1916', 4);
    ctx.fillStyle = '#6a2015'; ctx.fillRect(Math.round(piv[0] - 26), Math.round(piv[1] + 4 + ph * 7), 8, 9);
  } else if (b.type === 'tech' && pactF) {
    if (Math.floor(time * 1.5) % 2) { const [lx, ly] = iso(tx + 1, ty + 1, 82); ctx.fillStyle = '#e04030'; ctx.fillRect(Math.round(lx - 1), Math.round(ly - 2), 3, 3); }
  } else if (b.type === 'factory' || b.type === 'refinery' || b.type === 'conyard') {
    if (Math.floor(time * 1.5 + b.id) % 2 === 0) {
      const [sx, sy] = iso(tx + b.w - 0.2, ty + 0.2, BUILDINGS[b.type].height + 6);
      ctx.fillStyle = '#e04030';
      ctx.fillRect(Math.round(sx - 1), Math.round(sy - 1), 2, 2);
    }
  }
}
