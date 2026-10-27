// Isometric canvas renderer.
import * as D from './shared/data.js';
import { T, buildable } from './shared/map.js';

// Terrain elevation: every world-space projection in this file sits on the ground surface.
let HG = null, HGW = 0, HGH = 0, BRS = null, BRIX = null;
const DECK = 9, DECK_T = 4; // bridge deck height above the water and its thickness (art px)
// Height of a bridge deck/ramp at a world position (0 off bridges). Ramps keep their shape when the span is destroyed.
function deckZ(x, y) {
  if (!BRIX) return 0;
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= HGW || ty >= HGH) return 0;
  const k = BRIX[ty * HGW + tx];
  if (!k) return 0;
  const b = BRS[k - 1], g = b.geom, u = g.ax === 'x' ? x : y;
  if (u < g.s0) return DECK * Math.max(0, u - (g.s0 - 1));
  if (u >= g.s1) return DECK * Math.max(0, 1 - (u - g.s1));
  return b.hp > 0 ? DECK : 0;
}
const gzGround = (x, y) => groundZ(HG, HGW, HGH, x, y);
const gz = (x, y) => gzGround(x, y) + deckZ(x, y);
const iso = (x, y, z = 0) => isoFlat(x, y, z + gz(x, y));
import { HW, HH, iso as isoFlat, shade, buildingSprite, drawBuildingDynamic, drawUnit, drawTree, drawRock, drawRuin } from './sprites.js';
import { groundZ, flatArea, LEVEL_PX } from './shared/elevation.js';
import { drawTransport } from './art-units.js';
import { Palette } from './palette.js';

export const ZOOMS = [1, 1.5, 2, 2.5, 3];
const BUILD_UP_MS = 1200;

// Units are drawn larger than their footprint so they read clearly against the terrain.
export const UNIT_SCALE = { infantry: 1.45, vehicle: 1.25 };
const uscale = type => UNIT_SCALE[D.UNITS[type].cat] || 1;

const CH = 8; // terrain chunk size (tiles)

// Per-biome terrain colors.
export const BIOME = {
  temperate: { ground: '#3d4a26', sand: '#6e5a3e', water: '#1c3442', rock: '#4a453a', tree: '#2e3c1e', ice: '#7d929a', rubble: '#4a4842', shore: 'rgba(70,56,36,0.95)' },
  arctic: { ground: '#a6abaa', sand: '#6f6d64', water: '#24404f', rock: '#5d6064', tree: '#868c8a', ice: '#7f99a6', rubble: '#6a6a66', shore: 'rgba(190,196,196,0.9)' },
  desert: { ground: '#a08560', sand: '#7c6446', water: '#21403f', rock: '#7a5a3e', tree: '#977f58', ice: '#8aa3ae', rubble: '#8a7658', shore: 'rgba(140,116,80,0.95)' },
  jungle: { ground: '#2a4020', sand: '#6a4430', water: '#2a3828', rock: '#3c4232', tree: '#1c3016', ice: '#7d929a', rubble: '#4a4436', shore: 'rgba(80,52,32,0.95)' },
};

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.s = state;
    this.zoom = 2;
    this.camX = 0; this.camY = 0;
    this.low = document.createElement('canvas');
    this.lctx = this.low.getContext('2d', { willReadFrequently: true });
    this.palette = new Palette(state.players.map(p => p.color));
    this.chunks = new Map();
    this.time = 0;
    this.flash = 0;
    this.shake = 0;
    state.on('nuke', () => { this.flash = 1; this.shake = 1; });
  }

  resize(w, h) {
    const dpr = window.devicePixelRatio || 1;
    this.vw = w; this.vh = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    // device pixels per art pixel: chunky ~2 CSS px pixels
    this.px = Math.max(2, Math.round(2 * dpr));
    this.lw = Math.ceil(w * dpr / this.px);
    this.lh = Math.ceil(h * dpr / this.px);
    this.low.width = this.lw; this.low.height = this.lh;
    this.artPerCss = dpr / this.px;
    this.post = null;
    this.clampCam();
  }

  // Overlay with CRT scanlines + vignette, rebuilt on resize.
  buildPost() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width; c.height = this.canvas.height;
    const g = c.getContext('2d');
    // light scanlines only; the page-wide CSS overlay already supplies the vignette
    g.fillStyle = 'rgba(0,0,0,0.07)';
    for (let y = this.px - 1; y < c.height; y += this.px) g.fillRect(0, y, c.width, 1);
    this.post = c;
  }

  // Inverse projection onto the (raised) ground surface: a few fixed-point steps on the height.
  screenToWorld(sx, sy) {
    HG = this.s.hgt; HGW = this.s.w; HGH = this.s.h;
    this.indexBridges();
    const X = sx / this.zoom + this.camX, Y0 = sy / this.zoom + this.camY;
    let x = (X / HW + Y0 / HH) / 2, y = (Y0 / HH - X / HW) / 2;
    for (let k = 0; k < 4 && HG; k++) {
      const Y = Y0 + gz(x, y);
      x = (X / HW + Y / HH) / 2; y = (Y / HH - X / HW) / 2;
    }
    return { x, y };
  }
  worldToScreen(x, y, z = 0) {
    const [X, Y] = iso(x, y, z);
    return { x: (X - this.camX) * this.zoom, y: (Y - this.camY) * this.zoom };
  }
  centerOn(x, y) {
    const [X, Y] = iso(x, y);
    this.camX = X - this.vw / 2 / this.zoom;
    this.camY = Y - this.vh / 2 / this.zoom;
    this.clampCam();
  }
  clampCam() {
    const { w, h } = this.s;
    const minX = -h * HW - 100, maxX = w * HW + 100 - this.vw / this.zoom;
    const minY = -150, maxY = (w + h) * HH + 100 - this.vh / this.zoom;
    this.camX = Math.max(minX, Math.min(Math.max(minX, maxX), this.camX));
    this.camY = Math.max(minY, Math.min(Math.max(minY, maxY), this.camY));
  }
  setZoom(z, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    const i = ZOOMS.indexOf(this.zoom);
    const next = z > this.zoom ? ZOOMS[Math.min(ZOOMS.length - 1, i + 1)] : z < this.zoom ? ZOOMS[Math.max(0, i - 1)] : this.zoom;
    if (next === this.zoom) return;
    this.zoom = next;
    const [X, Y] = iso(before.x, before.y);
    this.camX = X - sx / this.zoom;
    this.camY = Y - sy / this.zoom;
    this.clampCam();
  }

  // ---------- terrain ----------
  tileColor(x, y) {
    const s = this.s;
    const t = s.terrain[y * s.w + x];
    const B = BIOME[s.biome] || BIOME.temperate;
    const n = hash(x, y);
    const low = (Math.sin(x * 0.21 + y * 0.13) + Math.sin(x * 0.07 - y * 0.19) + Math.sin(x * 0.43 + y * 0.37) * 0.5) * 0.045;
    switch (t) {
      case T.WATER: case T.BRIDGE: return shade(B.water, 0.95 + n * 0.04 + low);
      case T.SAND: return shade(B.sand, 0.94 + n * 0.05 + low);
      case T.ROCK: return shade(B.rock, 0.92 + n * 0.06 + low);
      case T.TREE: return shade(B.tree, 0.92 + n * 0.05 + low);
      case T.ICE: return shade(B.ice, 0.95 + n * 0.05 + low);
      case T.RUIN: return shade(B.rubble, 0.92 + n * 0.06 + low);
      case T.CLIFF: return shade(B.rock, 0.78 + n * 0.08 + low);
      default: return shade(B.ground, 0.92 + n * 0.06 + low * 1.4);
    }
  }

  buildChunk(cx, cy, S) {
    const s = this.s;
    const c = document.createElement('canvas');
    const W = CH * 2 * HW, H = CH * 2 * HH;
    const TOP = 3 * LEVEL_PX + 4; // headroom for raised ground
    c.width = Math.ceil((W + 2) * S); c.height = Math.ceil((H + 2 + TOP) * S);
    const ctx = c.getContext('2d');
    const ox = (cx - cy) * CH * HW, oy = (cx + cy) * CH * HH;
    ctx.scale(S, S);
    // the chunk's leftmost point is at tile (cx*CH, cy*CH + CH)
    ctx.translate(-(ox - CH * HW) + 1, -oy + 1 + TOP);
    const HGT = s.hgt, CW = s.w + 1;
    const cz = (x, y) => (HGT ? HGT[y * CW + x] * LEVEL_PX : 0);
    const dot = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w / S, h / S); };
    for (let y = cy * CH; y < Math.min(s.h, cy * CH + CH); y++) {
      for (let x = cx * CH; x < Math.min(s.w, cx * CH + CH); x++) {
        const [px, py] = isoFlat(x, y);
        const t = s.terrain[y * s.w + x];
        const za = cz(x, y), zb = cz(x + 1, y), zc = cz(x + 1, y + 1), zd = cz(x, y + 1);
        // slope lighting: light comes from the upper left of the screen (the -x side)
        const gx = (zb + zc - za - zd) / (2 * LEVEL_PX), gy = (zc + zd - za - zb) / (2 * LEVEL_PX);
        const avg = (za + zb + zc + zd) / 4;
        const lit = Math.max(0.55, Math.min(1.35, 1 + 0.16 * gx - 0.1 * gy)) * (1 + 0.035 * avg / LEVEL_PX);
        ctx.fillStyle = shade(this.tileColor(x, y), lit);
        ctx.beginPath();
        ctx.moveTo(px, py - za - 0.7); ctx.lineTo(px + HW + 0.7, py + HH - zb); ctx.lineTo(px, py + 2 * HH - zc + 0.7); ctx.lineTo(px - HW - 0.7, py + HH - zd);
        ctx.closePath(); ctx.fill();
        ctx.save(); ctx.clip();
        if (t === T.CLIFF) {
          // rock strata running along the cliff face
          ctx.strokeStyle = 'rgba(20,18,14,0.45)'; ctx.lineWidth = 1.5;
          for (let k = 1; k < 4; k++) {
            const f = k / 4;
            ctx.beginPath(); ctx.moveTo(px - HW, py + HH - zd + (za - zd) * 0 - f * (Math.max(za, zb, zc, zd) - Math.min(za, zb, zc, zd)) + 6 * f);
            ctx.lineTo(px + HW, py + HH - zb - f * (Math.max(za, zb, zc, zd) - Math.min(za, zb, zc, zd)) + 6 * f); ctx.stroke();
          }
          ctx.lineWidth = 1;
        }
        ctx.translate(0, -avg);
        const v = s.map.variant[y * s.w + x];
        const R = (k, m) => hash(x * 31 + k, y * 17 + m);
        if (t === T.GRASS || t === T.TREE) {
          const B = BIOME[s.biome] || BIOME.temperate;
          const dark = shade(B.ground, 0.62), light = shade(B.ground, 1.18), mid = shade(B.sand, 0.9);
          ctx.globalAlpha = 0.45;
          for (let k = 0; k < 40; k++) {
            const rx = R(k, 1) - 0.5, ry = R(2, k) - 0.5, q = R(k, k);
            dot(px + rx * HW * 2, py + HH + ry * HH * 2, 1 + (k % 3 === 0), 1, q < 0.4 ? dark : q < 0.75 ? light : mid);
          }
          ctx.globalAlpha = 1;
          if (s.biome === 'desert' && v % 5 === 0) { ctx.strokeStyle = 'rgba(70,52,30,0.35)'; ctx.beginPath(); ctx.moveTo(px - 18, py + HH - 3); ctx.quadraticCurveTo(px, py + HH - 8, px + 18, py + HH + 2); ctx.stroke(); }
          if (s.biome === 'arctic' && v % 6 === 0) { ctx.fillStyle = 'rgba(240,244,244,0.35)'; ctx.beginPath(); ctx.ellipse(px, py + HH, 14, 5, 0, 0, Math.PI * 2); ctx.fill(); }
          if (v % 13 === 0 && (s.biome === 'temperate' || s.biome === 'jungle')) { ctx.fillStyle = 'rgba(58,44,24,0.3)'; ctx.beginPath(); ctx.ellipse(px + (v % 7) - 3, py + HH, 18, 7, 0, 0, Math.PI * 2); ctx.fill(); }
          if (v % 53 === 0) {
            // shell crater
            ctx.fillStyle = 'rgba(18,14,8,0.7)'; ctx.beginPath(); ctx.ellipse(px, py + HH, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(70,60,40,0.6)'; ctx.beginPath(); ctx.ellipse(px + 1, py + HH + 1, 7, 3, 0, 0, Math.PI); ctx.fill();
          }
        } else if (t === T.SAND) {
          for (let k = 0; k < 30; k++) dot(px + (R(k, 3) - 0.5) * HW * 2, py + HH + (R(4, k) - 0.5) * HH * 2, 1, 1, R(k, 5) < 0.5 ? 'rgba(30,20,10,0.4)' : 'rgba(140,120,80,0.3)');
          if (v % 9 === 0) { ctx.strokeStyle = 'rgba(30,22,12,0.5)'; ctx.beginPath(); ctx.moveTo(px - 20, py + HH - 2); ctx.lineTo(px + 18, py + HH + 4); ctx.stroke(); }
        } else if (t === T.WATER || t === T.BRIDGE) {
          for (let k = 0; k < 8; k++) dot(px + (R(k, 6) - 0.5) * HW * 1.6, py + HH + (R(7, k) - 0.5) * HH * 1.6, 3, 1, 'rgba(90,120,130,0.25)');
          const land = (nx, ny) => { if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) return false; const tt = s.terrain[ny * s.w + nx]; return tt !== T.WATER && tt !== T.BRIDGE && tt !== T.ICE; };
          const edges = [[x - 1, y, [px - HW, py + HH], [px, py]], [x, y - 1, [px, py], [px + HW, py + HH]], [x + 1, y, [px + HW, py + HH], [px, py + 2 * HH]], [x, y + 1, [px, py + 2 * HH], [px - HW, py + HH]]];
          for (const [nx, ny, a, b] of edges) {
            if (!land(nx, ny)) continue;
            ctx.strokeStyle = (BIOME[s.biome] || BIOME.temperate).shore; ctx.lineWidth = 10;
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
            ctx.strokeStyle = 'rgba(30,24,14,0.6)'; ctx.lineWidth = 3;
            const k = 0.18, cxp = px, cyp = py + HH;
            ctx.beginPath(); ctx.moveTo(a[0] + (cxp - a[0]) * k, a[1] + (cyp - a[1]) * k); ctx.lineTo(b[0] + (cxp - b[0]) * k, b[1] + (cyp - b[1]) * k); ctx.stroke();
          }
          ctx.lineWidth = 1;
          if (s.brokenBridgeTile(y * s.w + x)) {
            // wreckage of a destroyed bridge: broken pilings and floating planks
            for (let k = 0; k < 2; k++) {
              const bx = px + (R(k, 11) - 0.5) * HW, by = py + HH + (R(12, k) - 0.5) * HH;
              ctx.fillStyle = '#2a2016'; ctx.fillRect(bx - 2, by - 9, 4, 10);
              ctx.fillStyle = '#4a3a28'; ctx.fillRect(bx - 2, by - 10, 4, 2);
            }
            ctx.strokeStyle = '#3a2c1c'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(px - 10, py + HH + 2 + (v % 5)); ctx.lineTo(px + 6, py + HH - 3); ctx.stroke();
            ctx.lineWidth = 1;
          }
        } else if (t === T.ICE) {
          ctx.strokeStyle = 'rgba(230,240,245,0.35)';
          ctx.beginPath(); ctx.moveTo(px - 14 + (v % 9), py + HH - 4); ctx.lineTo(px + 2, py + HH + 1); ctx.lineTo(px + 16, py + HH - 3 + (v % 5)); ctx.stroke();
          ctx.strokeStyle = 'rgba(20,40,50,0.3)';
          ctx.beginPath(); ctx.moveTo(px - 6, py + HH + 6); ctx.lineTo(px + 8, py + HH + 3); ctx.stroke();
          for (let k = 0; k < 10; k++) dot(px + (R(k, 4) - 0.5) * HW * 1.8, py + HH + (R(3, k) - 0.5) * HH * 1.8, 2, 1, 'rgba(220,235,240,0.3)');
        } else if (false) {
          ctx.fillStyle = '#4a3a28';
          ctx.beginPath(); ctx.moveTo(px, py + 3); ctx.lineTo(px + HW - 4, py + HH); ctx.lineTo(px, py + 2 * HH - 3); ctx.lineTo(px - HW + 4, py + HH); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(20,14,8,0.6)';
          for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(px + k * 6 - 10, py + HH + k * 3 - 5); ctx.lineTo(px + k * 6 + 10, py + HH + k * 3 + 5); ctx.stroke(); }
          ctx.strokeStyle = 'rgba(150,140,120,0.5)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(px - HW + 4, py + HH); ctx.lineTo(px, py + 3); ctx.moveTo(px, py + 2 * HH - 3); ctx.lineTo(px + HW - 4, py + HH); ctx.stroke();
          ctx.lineWidth = 1;
        } else if (t === T.RUIN) {
          for (let k = 0; k < 24; k++) dot(px + (R(k, 6) - 0.5) * HW * 2, py + HH + (R(5, k) - 0.5) * HH * 2, 2, 2, R(k, 1) < 0.5 ? 'rgba(20,18,14,0.5)' : 'rgba(150,145,130,0.35)');
        } else if (t === T.ROCK) {
          for (let k = 0; k < 30; k++) dot(px + (R(k, 8) - 0.5) * HW * 2, py + HH + (R(9, k) - 0.5) * HH * 2, 2, 1, R(k, 2) < 0.5 ? 'rgba(15,14,10,0.5)' : 'rgba(110,105,90,0.3)');
        }
        ctx.restore();
      }
    }
    c.ox = ox - CH * HW - 1; c.oy = oy - 1 - TOP;
    return c;
  }

  // ---------- main draw ----------
  draw(now, ui) {
    const s = this.s;
    HG = s.hgt; HGW = s.w; HGH = s.h;
    this.indexBridges();
    const ctx = this.lctx;
    this.time = now / 1000;
    s.interpolate(now);
    const S = this.zoom * this.artPerCss;
    this.S = S;
    let shx = 0, shy = 0;
    if (this.shake > 0) { shx = (Math.random() - 0.5) * 8 * this.shake; shy = (Math.random() - 0.5) * 8 * this.shake; this.shake = Math.max(0, this.shake - 0.01); }
    const offX = Math.round(this.camX * S + shx), offY = Math.round(this.camY * S + shy);
    this.off = [offX, offY];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.lw, this.lh);
    ctx.setTransform(S, 0, 0, S, -offX, -offY);

    // view bounds in tiles
    const corners = [this.screenToWorld(0, 0), this.screenToWorld(this.vw, 0), this.screenToWorld(0, this.vh), this.screenToWorld(this.vw, this.vh)];
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c.x))) - 2), x1 = Math.min(s.w - 1, Math.ceil(Math.max(...corners.map(c => c.x))) + 2);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c.y))) - 2), y1 = Math.min(s.h - 1, Math.ceil(Math.max(...corners.map(c => c.y))) + 3);
    const viewL = this.camX - 80, viewR = this.camX + this.vw / this.zoom + 80, viewT = this.camY - 120, viewB = this.camY + this.vh / this.zoom + 60;
    const onScreen = (x, y) => { const [X, Y] = iso(x, y); return X > viewL && X < viewR && Y > viewT && Y < viewB; };

    // terrain chunks (cached per art scale, blitted on whole art pixels); bridges falling or being rebuilt invalidate them
    if (this.terrainVer !== s.terrainVersion) { this.terrainVer = s.terrainVersion; this.chunks.clear(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) {
      for (let cx = Math.floor(x0 / CH); cx <= Math.floor(x1 / CH); cx++) {
        const key = `${S}|${cy}|${cx}`;
        let c = this.chunks.get(key);
        if (!c) { c = this.buildChunk(cx, cy, S); this.chunks.set(key, c); }
        if (c.ox > viewR || c.ox + c.width / S < viewL || c.oy > viewB || c.oy + c.height / S < viewT) continue;
        ctx.drawImage(c, Math.round(c.ox * S) - offX, Math.round(c.oy * S) - offY);
      }
    }
    ctx.setTransform(S, 0, 0, S, -offX, -offY);

    // ore + decals
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * s.w + x;
      if (!s.ore[i] || !s.explored[i] || !onScreen(x + 0.5, y + 0.5)) continue;
      this.drawOre(ctx, x, y, s.ore[i]);
    }
    const nowMs = now;
    for (const fx of s.effects) {
      if (fx.kind === 'corpse' || fx.kind === 'wreck' || fx.kind === 'rubble') this.drawDecal(ctx, fx, (nowMs - fx.t0) / fx.dur);
    }

    // selection markers on ground
    for (const id of ui.selection) {
      const e = s.ents.get(id);
      if (!e) continue;
      if (e.kind === 'u') {
        const [sx, sy] = iso(e.x, e.y, e.alt || 0);
        const r = (D.UNITS[e.type].cat === 'infantry' ? 9 : 22) * uscale(e.type);
        ctx.strokeStyle = '#7fe07a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(sx, sy, r, r / 2, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        if (e.owner >= 0 && D.buildingDef(e.type, s.players[e.owner].faction).weapon) {
          const own = s.players[e.owner];
          const powered = !D.BUILDINGS[e.type].powered || (own.power >= own.drain && !own.blackout);
          this.drawRange(ctx, e.type, own.faction, e.x, e.y, powered);
        }
        const pts = [iso(e.tx, e.ty), iso(e.tx + e.w, e.ty), iso(e.tx + e.w, e.ty + e.h), iso(e.tx, e.ty + e.h)];
        ctx.strokeStyle = '#7fe07a'; ctx.setLineDash([6, 4]);
        ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
        if (e.rally && e.owner === s.you) {
          const a = iso(e.x, e.y), b = iso(e.rally.x, e.rally.y);
          ctx.strokeStyle = 'rgba(120,255,120,0.7)'; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#7f7'; ctx.fillRect(b[0], b[1] - 14, 8, 6); ctx.fillStyle = '#ccc'; ctx.fillRect(b[0] - 1, b[1] - 14, 1.5, 14);
        }
      }
    }
    // move/attack order pings
    for (const p of ui.pings) {
      const k = (nowMs - p.t0) / 600;
      if (k > 1) continue;
      const [sx, sy] = iso(p.x, p.y);
      ctx.strokeStyle = p.attack ? `rgba(255,80,60,${1 - k})` : `rgba(120,255,120,${1 - k})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, 16 * (1 - k * 0.6), 8 * (1 - k * 0.6), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }

    // collect sortable objects
    const objs = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = s.terrain[y * s.w + x];
      if ((t === T.TREE || t === T.ROCK || t === T.RUIN) && s.explored[y * s.w + x] && onScreen(x + 0.5, y + 0.5)) objs.push({ d: x + y + 1, k: 't', x, y, t });
    }
    for (const b of s.bridges) {
      if (!b.geom) continue;
      const g = b.geom;
      for (let u = g.s0 - 1; u <= g.s1; u++) {
        const ramp = u < g.s0 || u >= g.s1;
        if (!ramp && b.hp <= 0) continue;
        const cx = g.ax === 'x' ? u + 0.5 : (g.l0 + g.l1) / 2, cy = g.ax === 'x' ? (g.l0 + g.l1) / 2 : u + 0.5;
        const ti = Math.floor(cy) * s.w + Math.floor(cx);
        if (!s.explored[ti] || !onScreen(cx, cy)) continue;
        objs.push({ d: cx + cy - 0.9, k: 'br', b, u });
      }
    }
    const air = [];
    for (const e of s.ents.values()) {
      if (e.kind === 'b') {
        if (!s.isAlly(s.you, e.owner) && !s.buildingVisible(e)) continue;
        if (!onScreen(e.x, e.y)) continue;
        objs.push({ d: e.tx + e.ty + (e.w + e.h) / 2, k: 'b', e });
      } else {
        if (!s.canSee(e) || !onScreen(e.x, e.y)) continue;
        // aircraft (including jets parked on airfield pads) are drawn in a separate pass above everything else
        if (e.air || e.alt > 1) air.push(e);
        else objs.push({ d: e.x + e.y, k: 'u', e });
      }
    }
    for (const g of s.ghosts.values()) {
      const live = s.ents.get(g.id);
      if (live && s.buildingVisible(live)) continue;
      if (!onScreen(g.x, g.y)) continue;
      objs.push({ d: g.tx + g.ty + (g.w + g.h) / 2, k: 'g', e: g });
    }
    objs.sort((a, b) => a.d - b.d);
    for (const o of objs) {
      if (o.k === 't') {
        const v = s.map.variant[o.y * s.w + o.x];
        ctx.save(); ctx.translate(0, -gz(o.x + 0.5, o.y + 0.5));
        if (o.t === T.TREE) drawTree(ctx, o.x + 0.5 + (v % 5 - 2) * 0.05, o.y + 0.5, v, s.biome);
        else if (o.t === T.RUIN) drawRuin(ctx, o.x, o.y, v, s.biome);
        else drawRock(ctx, o.x + 0.5, o.y + 0.5, v, s.biome);
        ctx.restore();
      } else if (o.k === 'br') this.drawBridgeSlice(ctx, o.b, o.u);
      else if (o.k === 'b' || o.k === 'g') this.drawBuilding(ctx, o.e, o.k === 'g', ui);
      else this.drawUnitEnt(ctx, o.e, ui);
    }

    // aircraft: ground shadows first, then the aircraft at altitude (back to front)
    air.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const e of air) {
      if (!(e.alt > 2)) continue;
      const [sx, sy] = iso(e.x, e.y);
      const r = e.air === 'jet' ? 18 : e.air ? 14 : 5;
      ctx.fillStyle = `rgba(8,12,18,${0.24 * Math.max(0.35, 1 - e.alt / 90)})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, r, r / 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const e of air) {
      if (!e.air) this.drawParachute(ctx, e, s.players[e.owner]?.color);
      this.drawUnitEnt(ctx, e, ui);
    }
    this.drawPlanes(ctx);

    this.drawBridgeDamage(ctx, ui);
    this.drawOrderLines(ctx, ui, nowMs);

    // projectiles
    for (const p of s.projs.values()) {
      if (!s.tileVisible(p.x, p.y) && p.kind !== 'nuke') continue;
      this.drawProjectile(ctx, p);
    }

    // effects
    s.effects = s.effects.filter(fx => nowMs - fx.t0 < fx.dur);
    for (const fx of s.effects) {
      if (fx.kind === 'corpse' || fx.kind === 'wreck' || fx.kind === 'rubble') continue;
      this.drawEffect(ctx, fx, (nowMs - fx.t0) / fx.dur);
    }

    // health bars
    for (const o of [...objs, ...air.map(e => ({ k: 'u', e }))]) {
      if (o.k !== 'u' && o.k !== 'b') continue;
      const e = o.e;
      const show = ui.selection.has(e.id) || ui.hover === e.id || (e.kind === 'b' && e.hp < e.maxHp && e.owner >= 0) || (e.kind === 'u' && e.hp < e.maxHp * 0.99 && s.isAlly(s.you, e.owner) && ui.showAllHealth);
      if (show) this.drawHealth(ctx, e);
    }

    // fog of war
    this.drawFog(ctx, x0, x1, y0, y1, onScreen);

    // placement ghost
    if (ui.placing && ui.mouseWorld) this.drawPlacement(ctx, ui);
    if (ui.mode === 'para' && ui.mouseWorld) {
      const [sx, sy] = iso(ui.mouseWorld.x, ui.mouseWorld.y);
      ctx.strokeStyle = 'rgba(120,230,120,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.ellipse(sx, sy, 2.2 * HW * 1.41, 2.2 * HH * 1.41, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    if (ui.mode === 'nuke' && ui.mouseWorld) {
      const [sx, sy] = iso(ui.mouseWorld.x, ui.mouseWorld.y);
      ctx.strokeStyle = 'rgba(255,60,40,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, D.NUKE.radius * HW * 1.41, D.NUKE.radius * HH * 1.41, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }

    // quantize to the gritty palette, then upscale with hard pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (s.me.blackout || s.me.power < s.me.drain) {
      ctx.fillStyle = 'rgba(0,0,20,0.18)';
      ctx.fillRect(0, 0, this.lw, this.lh);
    }
    this.palette.apply(ctx, this.lw, this.lh);
    const out = this.ctx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.imageSmoothingEnabled = false;
    out.drawImage(this.low, 0, 0, this.lw * this.px, this.lh * this.px);
    if (!this.post) this.buildPost();
    out.drawImage(this.post, 0, 0);

    // screen space overlays (CSS px)
    const dpr = this.dpr;
    out.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.drag) {
      const r = ui.drag;
      const lw = this.px / dpr;
      out.strokeStyle = '#4dff6a'; out.lineWidth = lw;
      out.setLineDash([lw * 3, lw * 2]);
      out.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      out.setLineDash([]);
      out.fillStyle = 'rgba(60,255,100,0.06)';
      out.fillRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
    }
    this.drawNameTags(out, ui);
    if (this.flash > 0) {
      out.fillStyle = `rgba(255,250,235,${Math.min(1, this.flash)})`;
      out.fillRect(0, 0, this.vw, this.vh);
      this.flash -= 0.012;
    }
  }

  // RA2-style unit name tags: the unit under the cursor, or every visible unit while Alt is held.
  drawNameTags(out, ui) {
    const s = this.s;
    const all = ui.keys.has('AltLeft') || ui.keys.has('AltRight');
    const list = [];
    if (all) {
      for (const e of s.ents.values()) if (e.kind === 'u' && s.canSee(e)) list.push(e);
    } else if (ui.hover != null && !ui.drag) {
      const e = s.ents.get(ui.hover);
      if (e && e.kind === 'u' && s.canSee(e)) list.push(e);
    }
    if (!list.length) return;
    out.font = '15px VT323, monospace';
    out.textAlign = 'center'; out.textBaseline = 'bottom';
    for (const e of list) {
      const owner = s.players[e.owner];
      const p = this.worldToScreen(e.x, e.y, 30 * uscale(e.type) + (e.alt || 0));
      if (p.x < -40 || p.y < -20 || p.x > this.vw + 40 || p.y > this.vh + 20) continue;
      const text = D.typeName(e.type, owner.faction).toUpperCase();
      const w = out.measureText(text).width + 8;
      out.fillStyle = 'rgba(0,0,0,0.78)';
      out.fillRect(Math.round(p.x - w / 2), Math.round(p.y - 15), Math.round(w), 15);
      out.fillStyle = owner.color;
      out.fillRect(Math.round(p.x - w / 2), Math.round(p.y - 15), 2, 15);
      out.fillStyle = e.owner === s.you ? '#d8ffd8' : s.isAlly(s.you, e.owner) ? '#d8e8ff' : '#ffd0c8';
      out.fillText(text, Math.round(p.x + 1), Math.round(p.y));
    }
    out.textBaseline = 'alphabetic';
  }

  // Lines from ordered units to where they're going (green) or what they're attacking (red),
  // drawn over units like RA2 and fading out after ~1.5s.
  drawOrderLines(ctx, ui, now) {
    const s = this.s;
    // sizes in art pixels so lines stay crisp and survive the palette pass at every zoom
    const lw = 1.25 / this.S;
    for (const l of ui.orderLines) {
      const u = s.ents.get(l.id);
      if (!u) continue;
      const k = (now - l.t0) / 1600;
      if (k >= 1) continue;
      let tx = l.x, ty = l.y;
      if (l.target != null) {
        const t = s.ents.get(l.target);
        if (t && (t.owner === s.you || s.canSee(t))) { tx = t.x; ty = t.y; }
      }
      const inf = D.UNITS[u.type].cat === 'infantry';
      const a = iso(u.x, u.y, (inf ? 8 : 10) * uscale(u.type) + (u.alt || 0)), b = iso(tx, ty, 2);
      const alpha = k < 0.6 ? 0.9 : 0.9 * (1 - (k - 0.6) / 0.4);
      const col = l.attack ? `rgba(255,60,40,${alpha})` : `rgba(80,255,90,${alpha})`;
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      // endpoint markers: small square at both ends like RA2
      ctx.fillStyle = col;
      const m = 2 / this.S;
      ctx.fillRect(a[0] - m / 2, a[1] - m / 2, m, m);
      ctx.fillRect(b[0] - m, b[1] - m, m * 2, m * 2);
    }
    ctx.lineWidth = 1;
  }

  drawOre(ctx, x, y, amt) {
    const n = Math.min(7, Math.ceil(amt / 130));
    for (let k = 0; k < n; k++) {
      const rx = hash(x * 13 + k, y * 7) * 0.8 + 0.1, ry = hash(x * 5, y * 17 + k) * 0.8 + 0.1;
      const [sx, sy] = iso(x + rx, y + ry);
      const h = 4 + hash(x + k, y - k) * 6;
      const glint = 0.85 + 0.25 * Math.sin(this.time * 2 + x + k);
      ctx.fillStyle = shade('#c99a2a', 0.75);
      ctx.beginPath(); ctx.moveTo(sx, sy - h); ctx.lineTo(sx + 3.5, sy - h * 0.3); ctx.lineTo(sx, sy + 1.5); ctx.lineTo(sx - 3.5, sy - h * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade('#ecc44a', glint);
      ctx.beginPath(); ctx.moveTo(sx, sy - h); ctx.lineTo(sx - 3.5, sy - h * 0.3); ctx.lineTo(sx, sy - h * 0.15); ctx.closePath(); ctx.fill();
    }
  }

  drawDecal(ctx, fx, k) {
    k = Math.max(0, Math.min(1, k));
    const [sx, sy] = iso(fx.x, fx.y);
    const a = k > 0.8 ? (1 - k) / 0.2 : 1;
    if (fx.kind === 'corpse') {
      ctx.fillStyle = `rgba(90,20,15,${0.5 * a})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
    } else if (fx.kind === 'wreck') {
      ctx.fillStyle = `rgba(25,22,20,${0.75 * a})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, 20, 10, 0, 0, Math.PI * 2); ctx.fill();
      if (k < 0.6 && Math.random() < 0.15) this.s.addEffect({ kind: 'smoke', x: fx.x, y: fx.y, dur: 1800, z: 6 });
    } else {
      ctx.fillStyle = `rgba(40,36,30,${0.7 * a})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, fx.w * 32, fx.w * 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(90,85,75,${0.8 * a})`;
      for (let i = 0; i < 8; i++) ctx.fillRect(sx + (hash(i, fx.x * 10) - 0.5) * fx.w * 50, sy + (hash(fx.y * 10, i) - 0.5) * fx.w * 22, 5, 3);
    }
  }

  // Draw a pre-scaled sprite whose anchor is tile (tx, ty), on whole art pixels.
  // rise (0..1) reveals the sprite from the ground up for the build-up animation
  blit(ctx, spr, tx, ty, rise = null) {
    const [X, Y] = iso(tx, ty);
    const [offX, offY] = this.off;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dx = Math.round(X * this.S - spr.ox) - offX, dy = Math.round(Y * this.S - spr.oy) - offY;
    if (rise != null) {
      const e = 1 - (1 - rise) ** 2, cut = Math.round(spr.height * (1 - e));
      ctx.beginPath(); ctx.rect(dx, dy + cut, spr.width, spr.height - cut); ctx.clip();
      // building slides up out of the ground while the scaffold reveal sweeps upward
      ctx.drawImage(spr, dx, dy + Math.round((1 - e) * 10 * this.S));
      ctx.restore();
      return;
    }
    ctx.drawImage(spr, dx, dy);
    ctx.restore();
  }

  drawBuilding(ctx, b, ghost, ui) {
    const s = this.s;
    const owner = s.players[b.owner];
    const civ = D.BUILDINGS[b.type].civilian;
    // civilian buildings are styled by the map's biome and only show a team flag when garrisoned
    const faction = civ ? s.biome : owner ? owner.faction : 'NATO';
    const color = owner ? owner.color : civ ? null : '#888888';
    const spr = buildingSprite(b.type, faction, color, this.S);
    if (ghost) ctx.globalAlpha = 0.85;
    const t0 = !ghost && s.rising.get(b.id);
    const k = t0 ? Math.min(1, (performance.now() - t0) / BUILD_UP_MS) : 1;
    if (k >= 1 && t0) s.rising.delete(b.id);
    this.blit(ctx, spr, b.tx, b.ty, k < 1 ? k : null);
    const powered = !owner || (owner.power >= owner.drain && !owner.blackout);
    if (!civ && k >= 1) { ctx.save(); ctx.translate(0, -gz(b.tx, b.ty)); drawBuildingDynamic(ctx, b, color, this.time, powered, faction); ctx.restore(); }
    ctx.globalAlpha = 1;
    if (ghost) return;
    if (civ && (b.occ > 0 || ui.selection.has(b.id) || ui.hover === b.id)) this.drawPips(ctx, b, owner);
    const hpf = b.hp / b.maxHp;
    if (hpf < 0.5 && Math.random() < (hpf < 0.25 ? 0.25 : 0.1)) {
      this.s.addEffect({ kind: hpf < 0.25 ? 'fire' : 'smoke', x: b.tx + Math.random() * b.w, y: b.ty + Math.random() * b.h, z: D.BUILDINGS[b.type].height * 0.8, dur: hpf < 0.25 ? 700 : 2200 });
    }
    if (b.type === 'power' && powered && Math.random() < 0.08 && owner?.faction === 'PACT') {
      this.s.addEffect({ kind: 'smoke', x: b.tx + 0.45 + Math.floor(Math.random() * 3) * 0.55, y: b.ty + 0.33, z: 58, dur: 2600, light: true });
    }
    if (b.type === 'power' && powered && Math.random() < 0.06 && owner?.faction === 'NATO') {
      this.s.addEffect({ kind: 'smoke', x: b.tx + 0.6, y: b.ty + 0.55, z: 46, dur: 3000, light: true });
    }
    if (b.repairing) {
      const [sx, sy] = iso(b.x, b.y, D.BUILDINGS[b.type].height + 18);
      ctx.fillStyle = Math.floor(this.time * 3) % 2 ? '#ffd75e' : '#fff';
      ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🔧', sx, sy);
    }
    if (b.c4) {
      const [sx, sy] = iso(b.x, b.y, 10);
      ctx.fillStyle = Math.floor(this.time * 8) % 2 ? '#f33' : '#600';
      ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (owner && !powered && (D.BUILDINGS[b.type].powered || b.type === 'radar') && Math.floor(this.time * 2) % 2) {
      const [sx, sy] = iso(b.x, b.y, D.BUILDINGS[b.type].height + 14);
      ctx.fillStyle = '#ffd75e'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('⚡', sx, sy);
    }
    if (b.primary && ui.selection.has(b.id)) {
      const [sx, sy] = iso(b.x, b.y, D.BUILDINGS[b.type].height + 30);
      ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PRIMARY', sx, sy);
    }
  }

  drawUnitEnt(ctx, e, ui) {
    const s = this.s;
    const owner = s.players[e.owner];
    const firing = performance.now() - (s.firing.get(e.id) || 0) < 120;
    if (e.cloaked) ctx.globalAlpha = s.isAlly(s.you, e.owner) ? 0.45 : 0.6;
    // snap to whole art pixels so units don't shimmer
    const [X, Y] = isoFlat(e.x, e.y);
    const Xs = Math.round(X * this.S) / this.S, Ys = Math.round(Y * this.S) / this.S;
    const ux = (Xs / HW + Ys / HH) / 2, uy = (Ys / HH - Xs / HW) / 2;
    const k = uscale(e.type);
    const [gx, gy] = isoFlat(ux, uy);
    ctx.save();
    const lift = (e.alt || 0) + gz(e.x, e.y);
    if (lift) ctx.translate(0, -Math.round(lift * this.S) / this.S);
    ctx.translate(gx, gy); ctx.scale(k, k); ctx.translate(-gx, -gy);
    drawUnit(ctx, e.type, ux, uy, e.dir, e.turret, owner.color, owner.faction, this.time, e.flags, e.cargo, firing);
    ctx.restore();
    ctx.globalAlpha = 1;
    if (e.hp < e.maxHp * 0.35 && D.UNITS[e.type].cat !== 'infantry' && Math.random() < 0.08) {
      s.addEffect({ kind: 'smoke', x: e.x, y: e.y, z: 12 + (e.alt || 0), dur: 1400 });
    }
    if (ui.groupOf && ui.groupOf.has(e.id) && ui.selection.has(e.id)) {
      const [sx, sy] = iso(e.x, e.y, 0);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(ui.groupOf.get(e.id), sx + 10, sy + 4);
    }
  }

  // RA2-style occupancy pips above a garrisonable building.
  drawPips(ctx, b, owner) {
    const cap = D.BUILDINGS[b.type].garrison;
    const [sx, sy] = iso(b.x, b.y, D.BUILDINGS[b.type].height + 14);
    const w = cap * 5 - 1;
    const x0 = Math.round(sx - w / 2), y0 = Math.round(sy);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x0 - 2, y0 - 2, w + 4, 7);
    for (let k = 0; k < cap; k++) {
      ctx.fillStyle = k < b.occ ? (owner ? owner.color : '#d8d8d0') : '#2a2a26';
      ctx.fillRect(x0 + k * 5, y0, 4, 3);
    }
  }

  // Parachute canopy above a falling paratrooper.
  drawParachute(ctx, e, color) {
    const k = uscale(e.type);
    const [gx, gy] = iso(e.x, e.y, e.alt + 22 * k);
    const [hx, hy] = iso(e.x, e.y, e.alt + 10 * k);
    const sway = Math.sin(this.time * 2 + e.id) * 2;
    ctx.strokeStyle = 'rgba(40,40,34,0.9)'; ctx.lineWidth = 1 / this.S * 2;
    for (const dx of [-9, -3, 3, 9]) { ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(gx + dx * k + sway, gy + 1); ctx.stroke(); }
    ctx.fillStyle = '#c8c2a8';
    ctx.beginPath(); ctx.ellipse(gx + sway, gy, 11 * k, 6 * k, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = color || '#8a8a7a';
    ctx.beginPath(); ctx.ellipse(gx + sway, gy, 4 * k, 6 * k, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(30,30,24,0.7)'; ctx.beginPath(); ctx.ellipse(gx + sway, gy, 11 * k, 6 * k, 0, Math.PI, 0); ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Paradrop transport planes: rendered sprite when available, simple silhouette otherwise.
  drawPlanes(ctx) {
    const s = this.s;
    for (const pl of s.planes.values()) {
      const z = 70;
      const [sx, sy] = iso(pl.x, pl.y);
      ctx.fillStyle = 'rgba(8,12,18,0.18)';
      ctx.beginPath(); ctx.ellipse(sx, sy, 34, 17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(0, -z - gz(pl.x, pl.y));
      if (!drawTransport(ctx, pl.x, pl.y, pl.dir, this.time)) {
        const c = Math.cos(pl.dir), sn = Math.sin(pl.dir);
        const P = (f, q) => isoFlat(pl.x + c * f - sn * q, pl.y + sn * f + c * q);
        ctx.fillStyle = '#6a6e64';
        for (const shape of [[[0.9, 0], [-0.8, 0.08], [-0.8, -0.08]], [[0.15, 0.9], [-0.15, 0.9], [-0.1, -0.9], [0.15, -0.9]], [[-0.65, 0.35], [-0.8, 0.35], [-0.8, -0.35], [-0.65, -0.35]]]) {
          ctx.beginPath(); shape.forEach(([f, q], i) => { const [x, y] = P(f, q); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  indexBridges() {
    const s = this.s;
    if (this.brIndexFor === s) { BRS = s.bridges; BRIX = this.brIx; return; }
    const ix = new Uint16Array(s.w * s.h);
    s.bridges.forEach((b, k) => {
      if (!b.geom) return;
      const g = b.geom;
      for (let u = g.s0 - 1; u <= g.s1; u++) for (let v = g.l0; v < g.l1; v++) {
        const x = g.ax === 'x' ? u : v, y = g.ax === 'x' ? v : u;
        if (x >= 0 && y >= 0 && x < s.w && y < s.h) ix[y * s.w + x] = k + 1;
      }
    });
    this.brIndexFor = s; this.brIx = ix; BRS = s.bridges; BRIX = ix;
  }

  // One 1-tile slice (across the full 2-tile width) of an RA2-style bridge: piers, deck, railings.
  drawBridgeSlice(ctx, b, u) {
    const g = b.geom;
    const P = (uu, v, z) => { const x = g.ax === 'x' ? uu : v, y = g.ax === 'x' ? v : uu; return isoFlat(x, y, z + gzGround(x, y)); };
    const zAt = uu => uu <= g.s0 - 1 ? 0 : uu < g.s0 ? DECK * (uu - (g.s0 - 1)) : uu <= g.s1 ? DECK : DECK * Math.max(0, 1 - (uu - g.s1));
    const ramp = u < g.s0 || u >= g.s1;
    const u0 = u, u1 = u + 1, z0 = zAt(u0), z1 = zAt(u1);
    const l0 = g.l0 - 0.08, l1 = g.l1 + 0.08;
    const quad = (pts, fill) => { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); };
    const concrete = '#8a867a', dark = '#4c4a44', deckC = '#5e5c56';
    // piers every other tile under the span
    if (!ramp && (u - g.s0) % 2 === 0) {
      for (const v of [g.l0 + 0.35, g.l1 - 0.35]) {
        const a = P(u0 + 0.35, v - 0.18, -3), bb = P(u0 + 0.65, v - 0.18, -3), c = P(u0 + 0.65, v + 0.18, -3);
        quad([a, bb, [bb[0], bb[1] - DECK + 1], [a[0], a[1] - DECK + 1]], '#6a665c');
        quad([bb, c, [c[0], c[1] - DECK + 1], [bb[0], bb[1] - DECK + 1]], '#4e4b44');
      }
    }
    // deck underside / front side faces (visible sides face +u for x-axis bridges and +v)
    const sideV = [P(u0, l1, z0), P(u1, l1, z1), P(u1, l1, z1 - DECK_T), P(u0, l1, z0 - DECK_T)];
    if (z0 > 0 || z1 > 0) quad(sideV, dark);
    if (u === g.s1 && b.hp > 0) quad([P(u0, l0, z0), P(u0, l1, z0), P(u0, l1, z0 - DECK_T), P(u0, l0, z0 - DECK_T)], '#3e3c38');
    // deck surface
    quad([P(u0, l0, z0), P(u1, l0, z1), P(u1, l1, z1), P(u0, l1, z0)], ramp ? concrete : deckC);
    // lane markings and expansion joints
    ctx.strokeStyle = 'rgba(210,190,110,0.55)'; ctx.lineWidth = 1.2;
    const mid = (g.l0 + g.l1) / 2;
    const m0 = P(u0 + 0.2, mid, z0 + (z1 - z0) * 0.2), m1 = P(u0 + 0.6, mid, z0 + (z1 - z0) * 0.6);
    ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.lineTo(m1[0], m1[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,20,18,0.35)'; ctx.lineWidth = 1;
    const j0 = P(u0, l0, z0), j1 = P(u0, l1, z0);
    ctx.beginPath(); ctx.moveTo(j0[0], j0[1]); ctx.lineTo(j1[0], j1[1]); ctx.stroke();
    // railings with posts on both edges
    for (const v of [l0 + 0.04, l1 - 0.04]) {
      const a = P(u0, v, z0 + 4), c = P(u1, v, z1 + 4);
      ctx.strokeStyle = v < mid ? '#9a968a' : '#b4b0a2'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      for (const f of [0, 0.5]) {
        const pb = P(u0 + f, v, z0 + (z1 - z0) * f), pt = P(u0 + f, v, z0 + (z1 - z0) * f + 4);
        ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(pb[0], pb[1]); ctx.lineTo(pt[0], pt[1]); ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
  }

  // Damaged bridges smoke and show a health bar; hovering a bridge with Ctrl held shows it too.
  drawBridgeDamage(ctx, ui) {
    const s = this.s;
    const hov = ui.mouseWorld && (ui.mouse.force || ui.keys.has('ControlLeft') || ui.keys.has('ControlRight')) ? s.bridgeAt(ui.mouseWorld.x, ui.mouseWorld.y) : null;
    for (const b of s.bridges) {
      if (b.hp <= 0 || (b.hp >= 100 && b !== hov)) continue;
      const mid = b.tiles[Math.floor(b.tiles.length / 2)];
      if (!s.explored[mid]) continue;
      const mx = mid % s.w + 0.5, my = Math.floor(mid / s.w) + 0.5;
      if (b.hp < 50 && Math.random() < 0.05) {
        const t = b.tiles[Math.floor(Math.random() * b.tiles.length)];
        s.addEffect({ kind: b.hp < 25 ? 'fire' : 'smoke', x: t % s.w + 0.5, y: Math.floor(t / s.w) + 0.5, z: 4, dur: 1600 });
      }
      const [sx, sy] = iso(mx, my, 14);
      const w = 40, f = b.hp / 100;
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5);
      ctx.fillStyle = f > 0.6 ? '#3fd84a' : f > 0.3 ? '#e8d43a' : '#e8403a';
      ctx.fillRect(sx - w / 2, sy, w * f, 3);
    }
  }

  drawHealth(ctx, e) {
    const isB = e.kind === 'b';
    const z = isB ? D.BUILDINGS[e.type].height + 22 : 24 * uscale(e.type) + (e.alt || 0);
    const [sx, sy] = iso(e.x, e.y, z);
    const w = isB ? 18 * e.w : D.UNITS[e.type].cat === 'infantry' ? 18 : 32;
    const f = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5);
    ctx.fillStyle = f > 0.6 ? '#3fd84a' : f > 0.3 ? '#e8d43a' : '#e8403a';
    ctx.fillRect(sx - w / 2, sy, w * f, 3);
    // segment ticks like RA2 pips
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 1; i < w / 4; i++) ctx.fillRect(sx - w / 2 + i * 4, sy, 1, 3);
    if (e.kind === 'u' && e.type === 'harvester' && e.owner === this.s.you) {
      const cf = Math.min(1, e.cargo / D.unitDef(e.type, this.s.me.faction).capacity);
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(sx - w / 2 - 1, sy + 4, w + 2, 4);
      ctx.fillStyle = '#ecc44a'; ctx.fillRect(sx - w / 2, sy + 5, w * cf, 2);
    }
    // jet ammo pips (RA2 shows remaining missiles under the health bar)
    if (e.kind === 'u' && e.air === 'jet' && e.owner === this.s.you) {
      const max = D.UNITS[e.type].ammo;
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(sx - w / 2 - 1, sy + 4, max * 5 + 1, 5);
      for (let i = 0; i < max; i++) { ctx.fillStyle = i < e.ammo ? '#e8d43a' : '#3a3a30'; ctx.fillRect(sx - w / 2 + i * 5, sy + 5, 4, 3); }
    }
  }

  drawProjectile(ctx, p) {
    const dist = Math.hypot(p.tx - p.sx, p.ty - p.sy);
    const f = Math.max(0, Math.min(1, p.f ?? 0));
    const arc = p.kind === 'arty' || p.kind === 'grad' || p.kind === 'missile' || p.kind === 'nuke';
    const H = p.kind === 'nuke' ? 400 : p.kind === 'missile' ? 120 + dist * 6 : dist * 5;
    // projectiles climb from the shooter's altitude to the target's (anti-air fire, air strikes)
    const z = (arc ? Math.sin(Math.PI * f) * H : 0) + 10 + (p.zs || 0) + ((p.zt || 0) - (p.zs || 0)) * f;
    // ground under the flight path: straight line between shooter's and target's ground heights
    const g0 = gz(p.sx, p.sy), g1 = gz(p.tx, p.ty);
    const [sx, sy] = isoFlat(p.x, p.y, z + g0 + (g1 - g0) * f);
    const dx = p.tx - p.sx, dy = p.ty - p.sy, dl = Math.hypot(dx, dy) || 1;
    const sdx = (dx - dy) / dl * HW, sdy = (dx + dy) / dl * HH;
    const zslope = arc ? Math.cos(Math.PI * f) * H * Math.PI / Math.max(1, dist) / 30 : 0;
    switch (p.kind) {
      case 'bullet':
        ctx.strokeStyle = 'rgba(255,240,150,0.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - sdx * 0.3, sy - sdy * 0.3); ctx.stroke();
        break;
      case 'shell':
        ctx.fillStyle = '#ffe9a0';
        ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,120,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - sdx * 0.25, sy - sdy * 0.25); ctx.stroke();
        break;
      case 'rocket':
      case 'grad':
      case 'missile':
      case 'nuke':
      case 'arty': {
        const big = p.kind === 'missile' || p.kind === 'nuke';
        if (p.kind !== 'arty' && Math.random() < (big ? 1 : 0.6)) this.s.addEffect({ kind: 'smoke', x: p.x, y: p.y, z, dur: big ? 1600 : 700, small: !big });
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.atan2(sdy - zslope * 30, sdx));
        if (p.kind === 'arty') { ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill(); }
        else {
          const L = p.kind === 'nuke' ? 22 : big ? 14 : 7;
          ctx.fillStyle = p.kind === 'nuke' ? '#e8e8e0' : '#ccc';
          ctx.fillRect(-L, -1.5 * (big ? 2 : 1), L * 1.4, 3 * (big ? 2 : 1));
          ctx.fillStyle = '#ff9a2a';
          ctx.beginPath(); ctx.arc(-L, 0, big ? 5 : 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        break;
      }
    }
    ctx.lineWidth = 1;
  }

  drawEffect(ctx, fx, k) {
    k = Math.max(0, Math.min(1, k));
    switch (fx.kind) {
      case 'muzzle': {
        const [sx, sy] = iso(fx.x, fx.y, fx.z);
        ctx.fillStyle = `rgba(255,230,120,${1 - k})`;
        ctx.beginPath(); ctx.arc(sx, sy, fx.big ? 6 : 3, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'spark': {
        const [sx, sy] = iso(fx.x, fx.y, 4);
        ctx.fillStyle = `rgba(255,220,140,${1 - k})`;
        for (let i = 0; i < 3; i++) ctx.fillRect(sx + (hash(i, fx.t0) - 0.5) * 8 * (1 + k), sy - k * 6 + (hash(fx.t0, i) - 0.5) * 4, 1.5, 1.5);
        break;
      }
      case 'explosion': {
        const [sx, sy] = iso(fx.x, fx.y, 4);
        const r = 10 * fx.size * (0.4 + k);
        if (k < 0.6) {
          const g = ctx.createRadialGradient(sx, sy - r * 0.5, 1, sx, sy - r * 0.5, r);
          g.addColorStop(0, `rgba(255,255,220,${1 - k / 0.6})`);
          g.addColorStop(0.4, `rgba(255,170,40,${0.9 - k})`);
          g.addColorStop(1, 'rgba(180,40,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(sx, sy - r * 0.5, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `rgba(50,45,40,${0.5 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(sx + 3, sy - r - k * 20, r * 0.7, 0, Math.PI * 2); ctx.fill();
        if (k < 0.05 && !fx.spawned) {
          fx.spawned = true;
          for (let i = 0; i < 2 + fx.size; i++) this.s.addEffect({ kind: 'smoke', x: fx.x + (Math.random() - 0.5) * 0.5, y: fx.y + (Math.random() - 0.5) * 0.5, z: 8, dur: 1500 });
        }
        break;
      }
      case 'smoke': {
        const [sx, sy] = iso(fx.x, fx.y, fx.z + k * 40);
        const r = (fx.small ? 3 : 6) + k * (fx.small ? 6 : 14);
        const c = fx.light ? '220,220,215' : '60,58,55';
        ctx.fillStyle = `rgba(${c},${0.45 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(sx + k * 14, sy, r, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'fire': {
        const [sx, sy] = iso(fx.x, fx.y, fx.z + k * 12);
        ctx.fillStyle = `rgba(255,${120 + 100 * (1 - k) | 0},30,${0.8 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(sx, sy, 5 * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'text': {
        const [sx, sy] = iso(fx.x, fx.y, 20 + k * 30);
        ctx.fillStyle = `rgba(255,220,90,${1 - k})`;
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(fx.text, sx, sy);
        break;
      }
      case 'nuke': {
        const [sx, sy] = iso(fx.x, fx.y);
        const R = D.NUKE.radius;
        // shockwave
        const sw = Math.min(1, k * 3);
        ctx.strokeStyle = `rgba(255,240,200,${1 - sw})`; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.8 * HW * sw, R * 1.8 * HH * sw, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
        // ground fire
        const g = ctx.createRadialGradient(sx, sy, 5, sx, sy, R * HW * 1.4);
        g.addColorStop(0, `rgba(255,240,180,${(1 - k) * 0.9})`);
        g.addColorStop(0.5, `rgba(255,120,30,${(1 - k) * 0.6})`);
        g.addColorStop(1, 'rgba(120,20,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(sx, sy, R * HW * 1.4, R * HH * 1.4, 0, 0, Math.PI * 2); ctx.fill();
        // mushroom
        const rise = Math.min(1, k * 2.5);
        const stemH = 200 * rise;
        ctx.fillStyle = `rgba(120,80,60,${0.8 * (1 - k)})`;
        ctx.beginPath(); ctx.moveTo(sx - 18, sy); ctx.quadraticCurveTo(sx - 8, sy - stemH / 2, sx - 14, sy - stemH); ctx.lineTo(sx + 14, sy - stemH); ctx.quadraticCurveTo(sx + 8, sy - stemH / 2, sx + 18, sy); ctx.fill();
        const cap = ctx.createRadialGradient(sx, sy - stemH, 5, sx, sy - stemH, 90 * rise + 10);
        cap.addColorStop(0, `rgba(255,230,160,${1 - k})`);
        cap.addColorStop(0.4, `rgba(230,110,40,${0.9 * (1 - k)})`);
        cap.addColorStop(1, `rgba(80,50,40,${0.6 * (1 - k)})`);
        ctx.fillStyle = cap;
        ctx.beginPath(); ctx.ellipse(sx, sy - stemH, 90 * rise + 10, 50 * rise + 6, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
    }
  }

  drawFog(ctx, x0, x1, y0, y1, onScreen) {
    const s = this.s;
    // RA2-style shroud: only never-explored tiles are covered; explored ground stays fully open
    // (enemy units are still only shown where you currently have vision).
    const black = new Path2D();
    let nb = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * s.w + x;
      if (s.explored[i] || !onScreen(x + 0.5, y + 0.5)) continue;
      const [px, py] = isoFlat(x, y);
      black.moveTo(px, py - 1.5); black.lineTo(px + HW + 2, py + HH); black.lineTo(px, py + 2 * HH + 1.5); black.lineTo(px - HW - 2, py + HH); black.closePath();
      if (HG) {
        const a = iso(x, y), b = iso(x + 1, y), c = iso(x + 1, y + 1), d = iso(x, y + 1);
        black.moveTo(a[0], a[1] - 1.5); black.lineTo(b[0] + 2, b[1]); black.lineTo(c[0], c[1] + 1.5); black.lineTo(d[0] - 2, d[1]); black.closePath();
      }
      nb++;
    }
    if (nb) { ctx.fillStyle = '#000'; ctx.fill(black); }
  }

  placementValid(type, tx, ty) {
    const s = this.s;
    const d = D.BUILDINGS[type];
    const cells = [];
    let ok = true;
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
      let good = x >= 0 && y >= 0 && x < s.w && y < s.h;
      if (good) {
        const i = y * s.w + x;
        const t = s.terrain[i];
        good = !s.bmap[i] && buildable(t) && s.explored[i] && flatArea(s.hgt, s.w, x, y, 1, 1);
        if (good) for (const e of s.ents.values()) if (e.kind === 'u' && e.x >= x - 0.1 && e.x <= x + 1.1 && e.y >= y - 0.1 && e.y <= y + 1.1 && s.canSee(e)) { good = false; break; }
      }
      cells.push([x, y, good]);
      if (!good) ok = false;
    }
    // the whole footprint must also sit on one level (no straddling a cliff)
    if (ok && tx >= 0 && ty >= 0 && tx + d.w <= s.w && ty + d.h <= s.h && !flatArea(s.hgt, s.w, tx, ty, d.w, d.h)) { ok = false; for (const c of cells) c[2] = false; }
    let near = false;
    for (const e of s.ents.values()) {
      if (e.kind !== 'b' || !D.extendsBase(e, s.you, o => s.isAlly(s.you, o))) continue;
      const gx = Math.max(e.tx - (tx + d.w), tx - (e.tx + e.w), 0);
      const gy = Math.max(e.ty - (ty + d.h), ty - (e.ty + e.h), 0);
      if (Math.max(gx, gy) <= D.BUILD_RADIUS) { near = true; break; }
    }
    return { ok: ok && near, cells, near };
  }

  drawPlacement(ctx, ui) {
    const type = ui.placing;
    const d = D.BUILDINGS[type];
    const tx = Math.floor(ui.mouseWorld.x - d.w / 2 + 0.5), ty = Math.floor(ui.mouseWorld.y - d.h / 2 + 0.5);
    const v = this.placementValid(type, tx, ty);
    ui.placeAt = { x: tx, y: ty, ok: v.ok };
    ctx.globalAlpha = 0.55;
    const spr = buildingSprite(type, this.s.me.faction, this.s.me.color, this.S);
    this.blit(ctx, spr, tx, ty);
    ctx.globalAlpha = 1;
    for (const [x, y, good] of v.cells) {
      const a = iso(x, y), b = iso(x + 1, y), c = iso(x + 1, y + 1), d = iso(x, y + 1);
      ctx.fillStyle = good && v.near ? 'rgba(80,255,80,0.35)' : 'rgba(255,60,60,0.45)';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
    }
    this.drawRange(ctx, type, this.s.me.faction, tx + d.w / 2, ty + d.h / 2, v.ok);
  }

  // RA2-style weapon range ring for stationary defences (shown while placing and when selected).
  drawRange(ctx, type, faction, cx, cy, ok = true) {
    const def = D.buildingDef(type, faction);
    const w = def.weapon && D.WEAPONS[def.weapon];
    if (!w) return;
    // targets are measured from the building's edge, so the ring reaches range + half the footprint
    const r = w.range + Math.max(def.w, def.h) / 2;
    const [sx, sy] = iso(cx, cy);
    const rx = r * HW * Math.SQRT2, ry = r * HH * Math.SQRT2;
    const col = ok ? '120,255,120' : '255,90,70';
    ctx.fillStyle = `rgba(${col},0.07)`;
    ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${col},0.85)`;
    ctx.lineWidth = 1.25 / this.S;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -this.time * 12;
    ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.lineWidth = 1;
  }

  // Entity under a screen point.
  pick(sx, sy) {
    const s = this.s;
    const w = this.screenToWorld(sx, sy);
    let best = null, bd = Infinity;
    for (const e of s.ents.values()) {
      if (e.kind !== 'u' || !s.canSee(e)) continue;
      const p = this.worldToScreen(e.x, e.y, (D.UNITS[e.type].cat === 'infantry' ? 9 : 8) * uscale(e.type) + (e.alt || 0));
      const d = Math.hypot(p.x - sx, p.y - sy) / this.zoom;
      const r = (D.UNITS[e.type].cat === 'infantry' ? 11 : 20) * uscale(e.type);
      if (d < r && d < bd) { bd = d; best = e; }
    }
    if (best) return best;
    // buildings: footprint or sprite body
    let bb = null, bdepth = -Infinity;
    for (const e of s.ents.values()) {
      if (e.kind !== 'b') continue;
      if (!s.isAlly(s.you, e.owner) && !s.buildingVisible(e)) continue;
      const inFoot = w.x >= e.tx && w.x < e.tx + e.w && w.y >= e.ty && w.y < e.ty + e.h;
      let inBody = false;
      if (!inFoot) {
        const H = D.BUILDINGS[e.type].height;
        for (let z = 8; z <= H; z += 8) {
          const q = this.screenToWorld(sx, sy + z * this.zoom);
          if (q.x >= e.tx && q.x < e.tx + e.w && q.y >= e.ty && q.y < e.ty + e.h) { inBody = true; break; }
        }
      }
      if ((inFoot || inBody) && e.tx + e.ty > bdepth) { bdepth = e.tx + e.ty; bb = e; }
    }
    return bb;
  }
}
