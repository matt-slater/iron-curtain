// Art index: sprite caching at pixel-art scale, terrain objects, sidebar cameos and flags.
import { BUILDINGS, UNITS } from './shared/data.js';
import { HW, HH, iso, shade, poly } from './art-core.js';
import { drawBuilding, drawBuildingDynamic } from './art-buildings.js';
import { drawUnit } from './art-units.js';

export { HW, HH, iso, shade, drawBuilding, drawBuildingDynamic, drawUnit };

export function buildingSpriteSize(type) {
  const d = BUILDINGS[type];
  return { w: (d.w + d.h) * HW + 8, h: (d.w + d.h) * HH + 100, ox: d.h * HW + 4, oy: 96 };
}

// Building sprites are rendered directly at the current art scale so pixels stay crisp.
const spriteCache = new Map();
export function buildingSprite(type, faction, color, scale = 1) {
  const key = `${type}|${faction}|${color}|${scale}`;
  let c = spriteCache.get(key);
  if (c) return c;
  const s = buildingSpriteSize(type);
  c = document.createElement('canvas');
  c.width = Math.ceil(s.w * scale); c.height = Math.ceil(s.h * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.translate(s.ox, s.oy);
  drawBuilding(ctx, type, faction, color, BUILDINGS[type].w * 7 + type.length);
  c.ox = s.ox * scale; c.oy = s.oy * scale;
  spriteCache.set(key, c);
  return c;
}

// ---------- terrain objects ----------
function conifer(ctx, sx, sy, v, snowy) {
  ctx.fillStyle = '#2a1f14'; ctx.fillRect(sx - 1, sy - 8, 3, 8);
  const h = 26 + (v % 12);
  const greens = snowy ? ['#1c2a20', '#22321f', '#1a261b', '#26361f'] : ['#1c2814', '#24331a', '#1a2412', '#2c3b1e'];
  for (let i = 0; i < 3; i++) {
    const w = 13 - i * 3.5, base = sy - 6 - i * (h / 3.2), top = sy - 6 - (i + 1) * (h / 3.2) - 4;
    ctx.fillStyle = greens[(v + i) % 4];
    ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx + w, base); ctx.lineTo(sx - w, base); ctx.closePath(); ctx.fill();
    ctx.fillStyle = snowy ? 'rgba(235,240,240,0.75)' : 'rgba(120,140,80,0.12)';
    ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx - w * 0.85, base - 1); ctx.lineTo(sx - w * 0.2, base - 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx + w, base); ctx.lineTo(sx + w * 0.4, base); ctx.closePath(); ctx.fill();
  }
}

function deadTree(ctx, sx, sy, v, col = '#2a2016') {
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 28); ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const h = 10 + i * 5, d = (i % 2 ? 1 : -1) * (6 + (v + i) % 5);
    ctx.beginPath(); ctx.moveTo(sx, sy - h); ctx.lineTo(sx + d, sy - h - 6); ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function palm(ctx, sx, sy, v, frond) {
  const lean = ((v % 5) - 2) * 2;
  ctx.strokeStyle = '#4a3a24'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + lean, sy - 18, sx + lean * 2, sy - 32); ctx.stroke();
  ctx.lineWidth = 1;
  const tx = sx + lean * 2, ty = sy - 32;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + v;
    ctx.strokeStyle = i % 2 ? frond : shade(frond, 0.7); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + Math.cos(a) * 9, ty - 6, tx + Math.cos(a) * 15, ty + 4 + Math.abs(Math.sin(a)) * 4); ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function canopy(ctx, sx, sy, v) {
  ctx.fillStyle = '#2a1f14'; ctx.fillRect(sx - 2, sy - 12, 4, 12);
  const cols = ['#142410', '#1c3216', '#24401a', '#183014'];
  for (let i = 0; i < 5; i++) {
    const ox = ((v * (i + 3)) % 15) - 7, oy = -18 - ((v * (i + 1)) % 10);
    ctx.fillStyle = cols[(v + i) % 4];
    ctx.beginPath(); ctx.ellipse(sx + ox, sy + oy, 10 + (i % 3) * 2, 7 + (i % 2) * 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(120,160,80,0.18)';
  ctx.beginPath(); ctx.ellipse(sx - 4, sy - 26, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
}

function scrub(ctx, sx, sy, v) {
  if (v % 3 === 0) {
    // cactus / thorn bush
    ctx.fillStyle = '#4a5530'; ctx.fillRect(sx - 2, sy - 16, 4, 16);
    ctx.fillRect(sx - 7, sy - 11, 3, 6); ctx.fillRect(sx - 7, sy - 8, 6, 2);
    ctx.fillRect(sx + 5, sy - 13, 3, 6); ctx.fillRect(sx + 2, sy - 9, 6, 2);
    return;
  }
  ctx.fillStyle = '#3e3a22';
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(sx + (i - 1.5) * 5, sy - 4 - (i % 2) * 3, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(160,150,90,0.3)';
  ctx.beginPath(); ctx.ellipse(sx - 3, sy - 8, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawTree(ctx, x, y, v, biome = 'temperate') {
  const [sx0, sy0] = iso(x, y);
  const sx = Math.round(sx0), sy = Math.round(sy0);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(sx + 5, sy + 1, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
  switch (biome) {
    case 'arctic': return v % 9 === 0 ? deadTree(ctx, sx, sy, v, '#3a342c') : conifer(ctx, sx, sy, v, true);
    case 'desert': return v % 4 === 0 ? palm(ctx, sx, sy, v, '#4e5a2c') : scrub(ctx, sx, sy, v);
    case 'jungle': return v % 4 === 0 ? palm(ctx, sx, sy, v, '#2c4a1c') : canopy(ctx, sx, sy, v);
    default: return v % 7 === 0 ? deadTree(ctx, sx, sy, v) : conifer(ctx, sx, sy, v, false);
  }
}

const ROCKS = {
  temperate: ['#55524a', '#4a4840', '#5e5a50'],
  arctic: ['#5a5e62', '#4e5256', '#666a6c'],
  desert: ['#7d5c3e', '#6e5034', '#8a6a48'],
  jungle: ['#4a4a3c', '#404232', '#525444'],
};

export function drawRock(ctx, x, y, v, biome = 'temperate') {
  const [sx0, sy0] = iso(x, y);
  const sx = Math.round(sx0), sy = Math.round(sy0);
  const r = 12 + (v % 6);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(sx + 3, sy + 2, r * 1.2, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  const base = (ROCKS[biome] || ROCKS.temperate)[v % 3];
  ctx.fillStyle = shade(base, 0.6);
  ctx.beginPath(); ctx.moveTo(sx - r, sy); ctx.lineTo(sx - r * 0.6, sy - r * 1.1); ctx.lineTo(sx + r * 0.2, sy - r * 1.4); ctx.lineTo(sx + r, sy - r * 0.5); ctx.lineTo(sx + r * 0.8, sy + 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.moveTo(sx - r, sy); ctx.lineTo(sx - r * 0.6, sy - r * 1.1); ctx.lineTo(sx + r * 0.2, sy - r * 1.4); ctx.lineTo(sx - r * 0.05, sy - r * 0.3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  if (biome === 'arctic') {
    ctx.fillStyle = 'rgba(232,236,236,0.85)';
    ctx.beginPath(); ctx.moveTo(sx - r * 0.6, sy - r * 1.1); ctx.lineTo(sx + r * 0.2, sy - r * 1.4); ctx.lineTo(sx + r * 0.5, sy - r * 1.0); ctx.lineTo(sx - r * 0.1, sy - r * 0.85); ctx.closePath(); ctx.fill();
  } else if (biome === 'jungle') {
    ctx.fillStyle = 'rgba(60,90,30,0.6)';
    ctx.fillRect(sx - r * 0.5, sy - r * 0.6, 4, 3); ctx.fillRect(sx + r * 0.1, sy - r * 1.0, 3, 3); ctx.fillRect(sx - r * 0.2, sy - r * 1.2, 3, 2);
  } else {
    ctx.fillStyle = 'rgba(70,80,40,0.5)';
    ctx.fillRect(sx - r * 0.5, sy - r * 0.6, 3, 2);
  }
}

// Ruined building block: broken walls, empty windows, rubble.
export function drawRuin(ctx, tx, ty, v, biome = 'temperate') {
  const wall = biome === 'desert' ? '#9a8562' : biome === 'arctic' ? '#7a7a76' : biome === 'jungle' ? '#6e6a58' : '#6e6a60';
  const h1 = 10 + (v % 4) * 5, h2 = 6 + ((v >> 2) % 4) * 6;
  const x0 = tx + 0.12, y0 = ty + 0.12, x1 = tx + 0.88, y1 = ty + 0.88;
  // two broken walls along the back edges, rubble in front
  poly(ctx, [iso(x0, y0, 0), iso(x1, y0, 0), iso(x1, y0, h1), iso((x0 + x1) / 2, y0, h1 - 5), iso(x0, y0, h2)], shade(wall, 0.85));
  poly(ctx, [iso(x0, y0, 0), iso(x0, y1, 0), iso(x0, y1, h2 * 0.6), iso(x0, (y0 + y1) / 2, h2 + 3), iso(x0, y0, h2)], shade(wall, 0.65));
  for (let i = 0; i < 3; i++) {
    const [wx, wy] = iso(x0 + 0.2 + i * 0.22, y0, h1 * 0.55);
    ctx.fillStyle = '#121210'; ctx.fillRect(Math.round(wx - 1), Math.round(wy - 3), 3, 4);
  }
  for (let k = 0; k < 6; k++) {
    const [rx, ry] = iso(tx + 0.3 + ((v * (k + 1)) % 7) / 10, ty + 0.3 + ((v * (k + 2)) % 6) / 10, 1);
    ctx.fillStyle = k % 2 ? shade(wall, 0.55) : shade(wall, 0.9);
    ctx.fillRect(Math.round(rx - 3), Math.round(ry - 2), 5 + (k % 3), 3);
  }
  if (biome === 'arctic') { const [sx, sy] = iso(x1 - 0.2, y0, h1); ctx.fillStyle = 'rgba(235,240,240,0.8)'; ctx.fillRect(Math.round(sx - 6), Math.round(sy - 1), 8, 2); }
}

// ---------- cameos ----------
// Draws a sidebar cameo into a small canvas (art pixels), then quantizes it to the game palette.
export function drawCameo(canvas, type, faction, color, palette) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0e1a12'); g.addColorStop(1, '#1d2a1a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(80,255,120,0.10)';
  for (let y = 0; y < H; y += 4) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
  ctx.save();
  if (BUILDINGS[type]) {
    const d = BUILDINGS[type];
    const s = buildingSpriteSize(type);
    const sc = Math.min(W / s.w, (H - 4) / (s.h - 40)) * 0.95;
    ctx.translate(W / 2, H - 5);
    ctx.scale(sc, sc);
    ctx.translate(-((d.w - d.h) * HW) / 2, -((d.w + d.h) * HH));
    drawBuilding(ctx, type, faction, color, d.w * 7 + type.length);
  } else {
    const inf = UNITS[type].cat === 'infantry';
    const air = UNITS[type].cat === 'air';
    const sc = inf ? 1.25 : air ? 0.7 : 0.85;
    ctx.translate(W / 2, H / 2 + (inf ? 10 : air ? 8 : 2));
    ctx.scale(sc, sc);
    const [ox, oy] = iso(5, 5);
    ctx.translate(-ox, -oy);
    drawUnit(ctx, type, 5, 5, Math.PI * 0.15, Math.PI * 0.15, color, faction, 0, 0, type === 'harvester' ? 500 : 0, false);
  }
  ctx.restore();
  if (palette) palette.apply(ctx, W, H, 10);
}

export function drawFlag(canvas, country) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const hs = (cols) => cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * H / cols.length, W, H / cols.length + 1); });
  const vs = (cols) => cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * W / cols.length, 0, W / cols.length + 1, H); });
  ctx.clearRect(0, 0, W, H);
  switch (country) {
    case 'USA':
      for (let i = 0; i < 13; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#b22234'; ctx.fillRect(0, i * H / 13, W, H / 13 + 1); }
      ctx.fillStyle = '#3c3b6e'; ctx.fillRect(0, 0, W * 0.42, H * 7 / 13);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) ctx.fillRect(2 + i * W * 0.1, 2 + j * H * 0.16, 1.2, 1.2);
      break;
    case 'UK':
      ctx.fillStyle = '#012169'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = H * 0.2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, H); ctx.moveTo(W, 0); ctx.lineTo(0, H); ctx.stroke();
      ctx.strokeStyle = '#c8102e'; ctx.lineWidth = H * 0.08;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, H); ctx.moveTo(W, 0); ctx.lineTo(0, H); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillRect(W * 0.4, 0, W * 0.2, H); ctx.fillRect(0, H * 0.35, W, H * 0.3);
      ctx.fillStyle = '#c8102e'; ctx.fillRect(W * 0.45, 0, W * 0.1, H); ctx.fillRect(0, H * 0.4, W, H * 0.2);
      break;
    case 'FRG': hs(['#000', '#dd0000', '#ffce00']); break;
    case 'GDR':
      hs(['#000', '#dd0000', '#ffce00']);
      ctx.fillStyle = '#e8c840'; ctx.strokeStyle = '#333';
      ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 'FRA': vs(['#0055a4', '#fff', '#ef4135']); break;
    case 'USSR':
      ctx.fillStyle = '#cc0000'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffd700';
      ctx.font = `${Math.round(H * 0.4)}px sans-serif`; ctx.fillText('☭', W * 0.06, H * 0.42);
      break;
    case 'POL': hs(['#fff', '#dc143c']); break;
    case 'CUB': {
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#002a8f'; ctx.fillRect(0, i * H / 5, W, H / 5 + 1); }
      ctx.fillStyle = '#cf142b';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.45, H / 2); ctx.lineTo(0, H); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `${Math.round(H * 0.32)}px sans-serif`; ctx.fillText('★', W * 0.05, H * 0.62);
      break;
    }
    case 'ROK': {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      const r = H * 0.24;
      ctx.fillStyle = '#c60c30'; ctx.beginPath(); ctx.arc(W / 2, H / 2, r, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#003478'; ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#000';
      for (const [x, y] of [[0.16, 0.2], [0.84, 0.2], [0.16, 0.8], [0.84, 0.8]]) ctx.fillRect(W * x - 2, H * y - 3, 4, 6);
      break;
    }
    case 'ISR': {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0038b8'; ctx.fillRect(0, H * 0.12, W, H * 0.13); ctx.fillRect(0, H * 0.75, W, H * 0.13);
      ctx.strokeStyle = '#0038b8'; ctx.lineWidth = 1.2;
      const cx = W / 2, cy = H / 2, r = H * 0.2;
      for (const off of [-Math.PI / 2, Math.PI / 2]) {
        ctx.beginPath();
        for (let i = 0; i < 3; i++) { const a = off + i * Math.PI * 2 / 3; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
        ctx.closePath(); ctx.stroke();
      }
      break;
    }
    case 'RSA': hs(['#ff7f00', '#fff', '#00247d']); break;
    case 'AFG': hs(['#007a36', '#fff', '#000']); break;
    case 'PRK': {
      hs(['#024fa2', '#fff', '#be0000', '#be0000', '#be0000', '#fff', '#024fa2']);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W * 0.33, H / 2, H * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#be0000'; ctx.font = `${Math.round(H * 0.34)}px sans-serif`; ctx.fillText('★', W * 0.33 - H * 0.16, H * 0.62);
      break;
    }
    case 'VNM':
      ctx.fillStyle = '#da251d'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffcd00'; ctx.font = `${Math.round(H * 0.6)}px sans-serif`; ctx.fillText('★', W / 2 - H * 0.3, H * 0.72);
      break;
    case 'EGY':
      hs(['#ce1126', '#fff', '#000']);
      ctx.fillStyle = '#c09300'; ctx.fillRect(W / 2 - 2, H * 0.38, 4, H * 0.24);
      break;
    case 'IRQ':
      hs(['#ce1126', '#fff', '#000']);
      ctx.fillStyle = '#007a3d';
      for (const x of [0.3, 0.5, 0.7]) { ctx.font = `${Math.round(H * 0.26)}px sans-serif`; ctx.fillText('★', W * x - H * 0.12, H * 0.6); }
      break;
  }
}
