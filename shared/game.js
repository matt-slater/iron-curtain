// Authoritative game simulation. Runs on the server (online) or in the browser (skirmish).
import * as D from './data.js';
import { T, mulberry32, MOVE, terrainPassable, buildable, findBridges } from './map.js';
import { createMap } from './maps.js';
import { PathFinder } from './pathfinding.js';

const { UNITS, BUILDINGS, WEAPONS, DT, TICK_RATE } = D;
const CELL = 4;
const CATS = ['building', 'defense', 'infantry', 'vehicle', 'air'];
const AIR = 4; // movement class for aircraft

function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function turnTo(a, b, max) {
  const d = angDiff(a, b);
  if (Math.abs(d) <= max) return b;
  return a + Math.sign(d) * max;
}

export class Game {
  // setup: { seed, mapSize, credits, players: [{ name, country, color, team, ai, difficulty }] }
  constructor(setup) {
    this.setup = setup;
    this.tick = 0;
    this.rng = mulberry32((setup.seed ^ 0x9e3779b9) >>> 0);
    const np = setup.players.length;
    const size = setup.mapSize || (np > 2 ? 80 : 64);
    this.map = createMap({ ...setup, mapSize: size }, np);
    this.w = this.map.w; this.h = this.map.h;
    this.terrain = this.map.terrain;
    this.oreBase = this.map.ore;
    this.ore = new Uint16Array(this.map.ore);
    this.bmap = new Int32Array(this.w * this.h);
    this.entities = new Map();
    this.nextId = 1;
    this.projectiles = [];
    this.events = [];
    this.oreDirty = new Set();
    this.pf = new PathFinder(this.w, this.h);
    this.cw = Math.ceil(this.w / CELL); this.ch = Math.ceil(this.h / CELL);
    this.grid = Array.from({ length: this.cw * this.ch }, () => []);
    this.vis = [];
    this.over = false;
    this.winners = null;

    this.players = setup.players.map((s, i) => ({
      id: i,
      name: s.name,
      country: s.country,
      faction: D.COUNTRIES[s.country].faction,
      color: s.color,
      team: s.team || 0,
      ai: !!s.ai,
      difficulty: s.difficulty || 'normal',
      credits: setup.credits ?? 10000,
      power: 0, drain: 0,
      counts: {},
      unitCounts: {},
      queues: { building: [], defense: [], infantry: [], vehicle: [], air: [] },
      superCharge: 0,
      blackout: 0,
      defeated: false,
      incomeMult: s.ai ? ({ easy: 0.8, normal: 1, hard: 1.3 }[s.difficulty] || 1) : 1,
      stats: { built: 0, killed: 0, lost: 0 },
    }));
    for (const p of this.players) this.vis.push(new Uint8Array(this.w * this.h));

    this.players.forEach((p, i) => {
      const s = this.map.starts[i];
      this.spawnUnit('mcv', i, s.x + 0.5, s.y + 0.5);
      const inf = p.faction === 'NATO' ? 'rifleman' : 'conscript';
      for (let k = 0; k < 3; k++) this.spawnUnit(inf, i, s.x + 2.5 + k * 0.6, s.y + 3.5);
      this.spawnUnit(p.faction === 'NATO' ? 'jeep' : 'brdm', i, s.x + 3.5, s.y + 1.5);
    });
    for (const c of this.map.civ || []) {
      if (this.canPlaceRaw(c.type, c.x, c.y)) this.addBuilding(c.type, -1, c.x, c.y);
    }
    for (const d of this.map.derricks) {
      if (this.canPlaceRaw('derrick', d.x, d.y)) this.addBuilding('derrick', -1, d.x, d.y);
    }
    this.setupBridges();
    this.updateVisibility();
  }

  // ---------- bridges (RA2 style: destructible, rebuilt by an engineer at either repair hut) ----------
  setupBridges() {
    this.bridges = findBridges(this.terrain, this.w, this.h).map((b, i) => ({ ...b, id: i, hp: D.BRIDGE_HP, maxHp: D.BRIDGE_HP, huts: [] }));
    for (const br of this.bridges) {
      if (br.tiles.length < 3) continue;
      // the two tiles farthest apart are the ends; each end gets a hut on the bank beside the road
      const xy = i => [i % this.w, Math.floor(i / this.w)];
      let a = br.tiles[0], b = a, best = -1;
      for (const i of br.tiles) for (const j of br.tiles) {
        const [x1, y1] = xy(i), [x2, y2] = xy(j), d = (x1 - x2) ** 2 + (y1 - y2) ** 2;
        if (d > best) { best = d; a = i; b = j; }
      }
      const [ax, ay] = xy(a), [bx, by] = xy(b);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const dx = (bx - ax) / len, dy = (by - ay) / len;
      for (const [ex, ey, sx] of [[ax, ay, -1], [bx, by, 1]]) {
        const hut = this.placeHut(ex, ey, dx * sx, dy * sx, br);
        if (hut) br.huts.push(hut.id);
      }
    }
  }

  placeHut(ex, ey, dx, dy, br) {
    const px = -dy, py = dx;
    const onBridge = new Set(br.tiles);
    for (let k = 1; k <= 4; k++) for (const m of [2, -2, 3, -3, 4, -4]) {
      const x = Math.round(ex + dx * k + px * m), y = Math.round(ey + dy * k + py * m);
      if (!this.inb(x, y) || onBridge.has(this.idx(x, y)) || !buildable(this.terrain[this.idx(x, y)])) continue;
      if (!this.canPlaceRaw('bridgehut', x, y)) continue;
      const h = this.addBuilding('bridgehut', -1, x, y);
      h.bridge = br.id;
      return h;
    }
    return null;
  }

  bridgeAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!this.inb(tx, ty) || this.terrain[this.idx(tx, ty)] !== T.BRIDGE) return null;
    const i = this.idx(tx, ty);
    return this.bridges.find(b => b.hp > 0 && b.tiles.includes(i)) || null;
  }

  damageBridge(br, amount, owner) {
    if (!br || br.hp <= 0 || amount <= 0) return;
    br.hp -= amount;
    if (br.hp > 0) return;
    br.hp = 0;
    for (const i of br.tiles) this.terrain[i] = T.WATER;
    this.bmapVer = (this.bmapVer || 0) + 1;
    // ground vehicles and infantry on the deck go down with it
    const onDeck = new Set(br.tiles);
    for (const e of [...this.entities.values()]) {
      if (e.kind !== 'u' || UNITS[e.type].air || this.mc(e) === MOVE.AMPHIB) continue;
      if (onDeck.has(this.idx(Math.floor(e.x), Math.floor(e.y)))) this.kill(e, owner);
    }
    for (const id of br.huts) { const h = this.entities.get(id); if (h) h.broken = true; }
    this.events.push(['bridge', br.id, 0]);
    for (const p of this.players) this.msg(p.id, 'Bridge destroyed', 'error');
  }

  repairBridge(br) {
    if (!br || br.hp > 0) return false;
    for (const i of br.tiles) this.terrain[i] = T.BRIDGE;
    br.hp = br.maxHp;
    this.bmapVer = (this.bmapVer || 0) + 1;
    for (const id of br.huts) { const h = this.entities.get(id); if (h) h.broken = false; }
    this.events.push(['bridge', br.id, 1]);
    return true;
  }

  // Explosions landing on a bridge deck hurt the bridge.
  blastBridges(x, y, r, w, owner) {
    const amt = w.dmg * D.bridgeDamage(w);
    if (amt <= 0) return;
    const hit = new Set();
    const rr = Math.max(0.5, r || 0);
    for (let ty = Math.floor(y - rr); ty <= Math.floor(y + rr); ty++) for (let tx = Math.floor(x - rr); tx <= Math.floor(x + rr); tx++) {
      const b = this.bridgeAt(tx + 0.5, ty + 0.5);
      if (b && Math.hypot(tx + 0.5 - x, ty + 0.5 - y) <= rr + 0.5) hit.add(b);
    }
    for (const b of hit) this.damageBridge(b, amt, owner);
  }

  // ---------- helpers ----------
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  idx(x, y) { return y * this.w + x; }
  rand() { return this.rng(); }

  // mc: movement class (MOVE.*); booleans are accepted (false = ground, true = amphibious)
  terrainPassable(i, mc) { return terrainPassable(this.terrain[i], mc | 0); }
  passable(i, mc) { return mc === AIR || (this.bmap[i] === 0 && this.terrainPassable(i, mc)); }
  mc(u) { return D.moveClass(this.ud(u)); }
  passableAt(x, y, amphib) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!this.inb(tx, ty)) return false;
    return this.passable(this.idx(tx, ty), amphib);
  }

  isEnemy(a, b) {
    if (a < 0 || b < 0 || a === b) return false;
    const ta = this.players[a].team, tb = this.players[b].team;
    return ta === 0 || tb === 0 || ta !== tb;
  }
  isAlly(a, b) { return a >= 0 && b >= 0 && !this.isEnemy(a, b); }
  relation(pid, e) {
    if (e.owner === pid) return 'own';
    if (e.owner < 0) return 'neutral';
    return this.isEnemy(pid, e.owner) ? 'enemy' : 'ally';
  }

  distTo(a, e) {
    if (e.kind === 'b') {
      const dx = Math.max(e.tx - a.x, 0, a.x - (e.tx + e.w));
      const dy = Math.max(e.ty - a.y, 0, a.y - (e.ty + e.h));
      return Math.hypot(dx, dy);
    }
    return Math.hypot(e.x - a.x, e.y - a.y);
  }

  visibleTo(pid, x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!this.inb(tx, ty)) return false;
    const i = this.idx(tx, ty);
    for (const p of this.players) if (this.isAlly(pid, p.id) && this.vis[p.id][i]) return true;
    return false;
  }

  detected(pid, u) {
    if (!u.cloaked) return true;
    let found = false;
    this.query(u.x, u.y, 2.5, e => { if (!found && e.owner >= 0 && this.isAlly(pid, e.owner)) found = true; });
    return found;
  }

  canTarget(pid, t) {
    if (!t || t.dead) return false;
    if (t.kind === 'u' && !this.detected(pid, t)) return false;
    return true;
  }

  // ---------- entity creation ----------
  // ---------- faction-resolved stats ----------
  fac(owner) { return owner >= 0 ? this.players[owner].faction : 'NATO'; }
  ud(e) { return D.unitDef(e.type, this.fac(e.owner)); }
  bd(e) { return D.buildingDef(e.type, this.fac(e.owner)); }
  weapon(u, target) { return D.weaponFor(this.ud(u), target, u.deployed); }

  spawnUnit(type, owner, x, y) {
    const d = D.unitDef(type, this.fac(owner));
    const u = {
      id: this.nextId++, kind: 'u', type, owner, x, y,
      hp: d.hp, maxHp: d.hp, dir: Math.PI * 0.25, turret: Math.PI * 0.25,
      order: { type: 'idle' }, path: null, pi: 0, target: null,
      cooldown: 0, burstLeft: 0, burstTimer: 0, cargo: 0,
      guardX: x, guardY: y, cloaked: d.cloak === true, lastFire: -9999,
      moving: false, scan: Math.floor(this.rand() * 8), stuck: 0, repath: 0,
      deployed: false, deployT: 0,
      alt: 0, ammo: d.ammo || 0, landed: false, pad: null,
    };
    this.entities.set(u.id, u);
    return u;
  }

  addBuilding(type, owner, tx, ty) {
    const d = D.buildingDef(type, this.fac(owner));
    const b = {
      id: this.nextId++, kind: 'b', type, owner, tx, ty, w: d.w, h: d.h,
      x: tx + d.w / 2, y: ty + d.h / 2,
      hp: d.hp, maxHp: d.hp, turret: Math.PI * 0.25, target: null, cooldown: 0,
      repairing: false, rally: null, c4: 0, scan: Math.floor(this.rand() * 8), income: 0, built: this.tick,
    };
    if (d.civilian) { b.occupants = []; b.occ = 0; }
    if (d.pads) b.pads = new Array(d.pads).fill(0);
    this.bmapVer = (this.bmapVer || 0) + 1;
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
      const i = this.idx(x, y);
      this.bmap[i] = b.id;
      if (this.ore[i]) { this.ore[i] = 0; this.oreDirty.add(i); }
    }
    this.entities.set(b.id, b);
    return b;
  }

  canPlaceRaw(type, tx, ty, ignoreId = 0) {
    const d = BUILDINGS[type];
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
      if (!this.inb(x, y)) return false;
      const i = this.idx(x, y);
      if (this.bmap[i]) return false;
      const t = this.terrain[i];
      if (!buildable(t)) return false;
    }
    for (const e of this.entities.values()) {
      if (e.kind !== 'u' || e.id === ignoreId || UNITS[e.type].air) continue;
      if (e.x >= tx - 0.1 && e.x <= tx + d.w + 0.1 && e.y >= ty - 0.1 && e.y <= ty + d.h + 0.1) return false;
    }
    return true;
  }

  canPlace(pid, type, tx, ty) {
    if (!this.canPlaceRaw(type, tx, ty)) return false;
    const d = BUILDINGS[type];
    for (const e of this.entities.values()) {
      if (e.kind !== 'b' || e.owner !== pid || e.type === 'derrick' || D.isCivilian(e.type)) continue;
      const gx = Math.max(e.tx - (tx + d.w), tx - (e.tx + e.w), 0);
      const gy = Math.max(e.ty - (ty + d.h), ty - (e.ty + e.h), 0);
      if (Math.max(gx, gy) <= D.BUILD_RADIUS) return true;
    }
    return false;
  }

  exitTile(b) {
    const ex = b.tx + Math.floor(b.w / 2), ey = b.ty + b.h;
    return this.nearestFree(ex, ey, false) || { x: ex, y: ey };
  }

  nearestFree(x, y, amphib, exclude) {
    const seen = new Set();
    const q = [[x, y]];
    seen.add(y * this.w + x);
    while (q.length) {
      const [cx, cy] = q.shift();
      if (this.inb(cx, cy)) {
        const i = this.idx(cx, cy);
        if (this.passable(i, amphib) && !(exclude && exclude.has(i))) return { x: cx, y: cy };
      }
      if (seen.size > 2000) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inb(nx, ny)) continue;
        const k = ny * this.w + nx;
        if (seen.has(k)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    return null;
  }

  // ---------- spatial grid ----------
  rebuildGrid() {
    for (const c of this.grid) c.length = 0;
    for (const e of this.entities.values()) {
      if (e.kind === 'u') {
        const cx = Math.min(this.cw - 1, Math.max(0, Math.floor(e.x / CELL)));
        const cy = Math.min(this.ch - 1, Math.max(0, Math.floor(e.y / CELL)));
        this.grid[cy * this.cw + cx].push(e);
      } else {
        const x0 = Math.floor(e.tx / CELL), x1 = Math.floor((e.tx + e.w - 1) / CELL);
        const y0 = Math.floor(e.ty / CELL), y1 = Math.floor((e.ty + e.h - 1) / CELL);
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.grid[cy * this.cw + cx].push(e);
      }
    }
  }

  query(x, y, r, fn) {
    const x0 = Math.max(0, Math.floor((x - r - 3) / CELL)), x1 = Math.min(this.cw - 1, Math.floor((x + r + 3) / CELL));
    const y0 = Math.max(0, Math.floor((y - r - 3) / CELL)), y1 = Math.min(this.ch - 1, Math.floor((y + r + 3) / CELL));
    const seen = new Set();
    const p = { x, y };
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      for (const e of this.grid[cy * this.cw + cx]) {
        if (e.dead || seen.has(e.id)) continue;
        seen.add(e.id);
        if (this.distTo(p, e) <= r) fn(e);
      }
    }
  }

  updateVisibility() {
    for (const p of this.players) this.vis[p.id].fill(0);
    for (const e of this.entities.values()) {
      if (e.owner < 0) continue;
      const sight = e.kind === 'u' ? this.ud(e).sight : this.bd(e).sight + Math.max(e.w, e.h) / 2;
      const v = this.vis[e.owner];
      const r2 = sight * sight;
      for (let y = Math.max(0, Math.floor(e.y - sight)); y <= Math.min(this.h - 1, Math.ceil(e.y + sight)); y++) {
        for (let x = Math.max(0, Math.floor(e.x - sight)); x <= Math.min(this.w - 1, Math.ceil(e.x + sight)); x++) {
          if ((x + 0.5 - e.x) ** 2 + (y + 0.5 - e.y) ** 2 <= r2) v[y * this.w + x] = 1;
        }
      }
    }
  }

  // ---------- players ----------
  hasPower(pid) {
    const p = this.players[pid];
    return p.power >= p.drain && p.blackout <= 0;
  }

  prereqsMet(p, type) {
    const req = UNITS[type]?.req || BUILDINGS[type]?.req || [];
    return req.every(r => (p.counts[r] || 0) > 0);
  }

  canBuild(p, type) {
    const cat = D.categoryOf(type);
    if (!cat || !D.buildList(p.country, cat).includes(type)) return false;
    if (!this.prereqsMet(p, type)) return false;
    if (cat === 'building' || cat === 'defense') return (p.counts.conyard || 0) > 0;
    if (cat === 'infantry') return (p.counts.barracks || 0) > 0;
    if (cat === 'air') return (p.counts.airfield || 0) > 0;
    return (p.counts.factory || 0) > 0;
  }

  producerCount(p, cat) {
    if (cat === 'building' || cat === 'defense') return p.counts.conyard || 0;
    if (cat === 'infantry') return p.counts.barracks || 0;
    if (cat === 'air') return p.counts.airfield || 0;
    return p.counts.factory || 0;
  }

  updatePlayers() {
    for (const p of this.players) { p.power = 0; p.drain = 0; p.counts = {}; p.unitCounts = {}; }
    for (const e of this.entities.values()) {
      if (e.owner < 0) continue;
      const p = this.players[e.owner];
      if (e.kind === 'b') {
        const d = this.bd(e);
        if (d.civilian) continue;
        p.counts[e.type] = (p.counts[e.type] || 0) + 1;
        if (d.power > 0) p.power += Math.round(d.power * (0.5 + 0.5 * e.hp / e.maxHp));
        else p.drain -= d.power;
      } else {
        p.unitCounts[e.type] = (p.unitCounts[e.type] || 0) + 1;
      }
    }
    for (const p of this.players) {
      if (p.defeated) continue;
      if (p.blackout > 0) p.blackout -= DT;
      const lowPower = !this.hasPower(p.id);
      for (const cat of CATS) {
        const q = p.queues[cat];
        if (!q.length) continue;
        const item = q[0];
        if (item.progress >= 1) continue;
        const n = this.producerCount(p, cat);
        if (n === 0) continue;
        if (!this.prereqsMet(p, item.type)) {
          p.credits += item.spent;
          q.shift();
          continue;
        }
        const cost = D.costOf(item.type, p.faction);
        const mult = (1 + 0.5 * (n - 1)) * (lowPower ? 0.5 : 1);
        const step = Math.min(1 - item.progress, DT * mult / D.buildTime(item.type, p.faction));
        const money = cost * step;
        if (p.credits < money) {
          if (!item.noFunds) { item.noFunds = true; this.msg(p.id, 'Insufficient funds', 'nofunds'); }
          continue;
        }
        item.noFunds = false;
        p.credits -= money;
        item.spent += money;
        item.progress += step;
        if (item.progress >= 0.9999) {
          item.progress = 1;
          if (cat === 'infantry' || cat === 'vehicle' || cat === 'air') {
            if (this.produceUnit(p, item.type)) q.shift();
            else item.progress = 0.9999;
          } else {
            this.msg(p.id, 'Construction complete', 'ready');
          }
        }
      }
      if ((p.counts.silo || 0) > 0) {
        if (this.hasPower(p.id) && p.superCharge < D.SUPER_CHARGE) {
          p.superCharge = Math.min(D.SUPER_CHARGE, p.superCharge + DT);
          if (p.superCharge >= D.SUPER_CHARGE) {
            for (const o of this.players) this.msg(o.id, o.id === p.id ? 'Nuclear missile ready' : 'Warning: enemy nuclear missile ready', 'nukeready');
          }
        }
      } else p.superCharge = 0;
    }
  }

  produceUnit(p, type) {
    const d = UNITS[type];
    if (d.air) return this.produceAircraft(p, type, d);
    const want = d.cat === 'infantry' ? 'barracks' : 'factory';
    const facs = [...this.entities.values()].filter(e => e.kind === 'b' && e.owner === p.id && e.type === want);
    if (!facs.length) return false;
    const fac = facs.find(f => f.primary) || facs[0];
    const ex = this.exitTile(fac);
    // squads (e.g. KPA infantry) arrive as several soldiers for one purchase
    const n = d.squad || 1;
    for (let k = 0; k < n; k++) {
      const u = this.spawnUnit(type, p.id, ex.x + 0.3 + (k % 3) * 0.2, ex.y + 0.3 + Math.floor(k / 3) * 0.2 + (k % 2) * 0.15);
      u.dir = u.turret = Math.PI * 0.5;
      p.stats.built++;
      if (type === 'harvester') this.orderHarvest(u, u.x, u.y);
      else if (fac.rally) this.orderMove(u, fac.rally.x + (k % 3) * 0.3, fac.rally.y + Math.floor(k / 3) * 0.3);
      if (k === 0) this.events.push(['spawn', p.id, u.id, u.type]);
    }
    return true;
  }

  // ---------- aircraft ----------
  padPos(b, i) { return { x: b.tx + (i % 2 ? 2.2 : 0.8), y: b.ty + (i < 2 ? 0.8 : 2.2) }; }

  freePad(b) {
    for (let i = 0; i < b.pads.length; i++) {
      const j = this.entities.get(b.pads[i]);
      if (!j || j.owner !== b.owner || !j.pad || j.pad.b !== b.id) { b.pads[i] = 0; return i; }
    }
    return -1;
  }

  // Keep the jet's pad, or claim a free one on the nearest friendly air base (RA2: one jet per pad).
  assignPad(u, prefer = null) {
    if (u.pad) {
      const b = this.entities.get(u.pad.b);
      if (b && b.owner === u.owner && b.pads && b.pads[u.pad.i] === u.id && (!prefer || prefer === b)) return true;
      if (b && b.pads && b.pads[u.pad.i] === u.id) b.pads[u.pad.i] = 0;
      u.pad = null;
    }
    const bases = [...this.entities.values()].filter(e => e.kind === 'b' && e.type === 'airfield' && e.owner === u.owner)
      .sort((a, c) => (a === prefer ? -1 : c === prefer ? 1 : Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(c.x - u.x, c.y - u.y)));
    for (const b of bases) {
      const i = this.freePad(b);
      if (i >= 0) { b.pads[i] = u.id; u.pad = { b: b.id, i }; return true; }
    }
    return false;
  }

  jetCount(pid) {
    let n = 0;
    for (const e of this.entities.values()) if (e.kind === 'u' && e.owner === pid && UNITS[e.type].air === 'jet') n++;
    return n;
  }

  produceAircraft(p, type, d) {
    const bases = [...this.entities.values()].filter(e => e.kind === 'b' && e.owner === p.id && e.type === 'airfield');
    if (!bases.length) return false;
    const base = bases.find(f => f.primary) || bases[0];
    let u;
    if (d.air === 'jet') {
      // jets need a free landing pad; otherwise production waits
      const b = [base, ...bases].find(b => this.freePad(b) >= 0);
      if (!b) return false;
      const i = this.freePad(b), pp = this.padPos(b, i);
      u = this.spawnUnit(type, p.id, pp.x, pp.y);
      b.pads[i] = u.id; u.pad = { b: b.id, i };
      u.landed = true;
    } else {
      u = this.spawnUnit(type, p.id, base.x, base.y + base.h / 2 + 0.3);
      if (base.rally) this.orderMove(u, base.rally.x, base.rally.y);
      else this.orderMove(u, base.x + 1.5, base.y + base.h / 2 + 2);
    }
    u.dir = u.turret = Math.PI * 0.5;
    p.stats.built++;
    this.events.push(['spawn', p.id, u.id, u.type]);
    return true;
  }

  // Jets (RA2 Harrier style): fly continuously with a turning radius, make strafing passes while
  // they have ammo, then return to their landing pad to rearm.
  updateJet(u, d) {
    const o = u.order;
    if (u.landed) {
      u.alt = Math.max(0, u.alt - 40 * DT);
      u.moving = false;
      if (u.ammo < d.ammo) { u.reloadT = (u.reloadT || 0) + DT; if (u.reloadT >= 1.5) { u.reloadT = 0; u.ammo++; } }
      if (o.type === 'attack' || o.type === 'move' || o.type === 'attackMove') {
        if (o.type === 'attack' && u.ammo <= 0) { this.msg(u.owner, 'Aircraft rearming', ''); this.setOrder(u, { type: 'idle' }); return; }
        u.landed = false;
      } else {
        // stay parked on the pad (re-claim it if it was lost)
        if (!this.assignPad(u)) u.landed = false;
        return;
      }
    }
    u.alt = Math.min(D.JET_CRUISE, (u.alt || 0) + 30 * DT);
    let gx = u.x, gy = u.y, landing = false;
    let t = null;
    if (o.type === 'attack') {
      t = this.entities.get(o.target);
      if (!t || !this.canTarget(u.owner, t) || !this.isEnemy(u.owner, t.owner) || u.ammo <= 0) { this.setOrder(u, { type: 'rtb' }); t = null; }
      else { gx = t.x; gy = t.y; }
    }
    if (u.order.type === 'move' || u.order.type === 'attackMove') {
      gx = u.order.x; gy = u.order.y;
      if (Math.hypot(gx - u.x, gy - u.y) < 0.8) this.setOrder(u, { type: 'rtb' });
    }
    if (u.order.type === 'rtb' || u.order.type === 'idle' || u.order.type === 'follow') {
      if (this.assignPad(u, u.order.prefer ? this.entities.get(u.order.prefer) : null)) {
        const b = this.entities.get(u.pad.b), pp = this.padPos(b, u.pad.i);
        gx = pp.x; gy = pp.y; landing = true;
        const dist = Math.hypot(gx - u.x, gy - u.y);
        if (dist < 0.25) {
          u.x = gx; u.y = gy; u.landed = true; u.moving = false;
          this.setOrder(u, { type: 'idle' });
          return;
        }
      } else {
        // nowhere to land: circle where we are
        u.loiter = u.loiter || { x: u.x, y: u.y };
        const a = this.tick * DT * 0.8 + u.id;
        gx = u.loiter.x + Math.cos(a) * 2.5; gy = u.loiter.y + Math.sin(a) * 2.5;
      }
    } else u.loiter = null;
    const ang = Math.atan2(gy - u.y, gx - u.x);
    const dist = Math.hypot(gx - u.x, gy - u.y);
    let speed = d.speed;
    if (landing && dist < 2.5) {
      // final approach: slow down, line up and descend
      speed = Math.max(0.9, d.speed * dist / 2.5);
      u.dir = turnTo(u.dir, ang, 6 * DT);
      u.alt = Math.max(4, Math.min(u.alt, dist / 2.5 * D.JET_CRUISE));
    } else u.dir = turnTo(u.dir, ang, 2.6 * DT);
    u.turret = u.dir;
    u.x = Math.max(0.3, Math.min(this.w - 0.3, u.x + Math.cos(u.dir) * Math.min(speed * DT, landing ? dist : Infinity)));
    u.y = Math.max(0.3, Math.min(this.h - 0.3, u.y + Math.sin(u.dir) * Math.min(speed * DT, landing ? dist : Infinity)));
    u.moving = true;
    if (t) {
      const w = this.weapon(u, t);
      const da = Math.abs(angDiff(u.dir, Math.atan2(t.y - u.y, t.x - u.x)));
      if (u.cooldown <= 0 && u.burstLeft <= 0 && da < 0.45 && this.distTo(u, t) <= w.range) {
        this.fire(u, t, w);
        u.ammo--;
        if (u.ammo <= 0) this.setOrder(u, { type: 'rtb' });
      }
    }
  }

  // Helicopters fly straight to their waypoint and hover; they otherwise use the normal unit orders.
  flyPath(u, d) {
    u.moving = false;
    if (!u.path || u.pi >= u.path.length) return true;
    const wp = u.path[u.pi];
    const dx = wp.x - u.x, dy = wp.y - u.y, dist = Math.hypot(dx, dy);
    if (dist > 0.05) u.dir = turnTo(u.dir, Math.atan2(dy, dx), 4 * DT);
    u.turret = u.dir;
    const step = d.speed * DT;
    u.moving = true;
    if (step >= dist) {
      u.x = wp.x; u.y = wp.y; u.pi++;
      if (u.pi >= u.path.length) { u.path = null; return true; }
    } else { u.x += dx / dist * step; u.y += dy / dist * step; }
    return false;
  }

  msg(pid, text, snd) { this.events.push(['msg', pid, text, snd || '']); }

  // ---------- commands ----------
  command(pid, cmd) {
    const p = this.players[pid];
    if (!p || p.defeated || this.over || !cmd || typeof cmd.c !== 'string') return;
    const units = Array.isArray(cmd.ids)
      ? cmd.ids.slice(0, 200).map(id => this.entities.get(id)).filter(e => e && e.owner === pid && e.kind === 'u')
      : [];
    const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
    switch (cmd.c) {
      case 'move': {
        const x = num(cmd.x), y = num(cmd.y);
        const tx = Math.floor(x), ty = Math.floor(y);
        const onOre = this.inb(tx, ty) && this.ore[this.idx(tx, ty)] > 0;
        const movers = [];
        for (const u of units) {
          if (u.type === 'harvester' && onOre) this.orderHarvest(u, x, y);
          else movers.push(u);
        }
        this.groupMove(movers, x, y, cmd.attack ? 'attackMove' : 'move');
        break;
      }
      case 'target': {
        const t = this.entities.get(cmd.target);
        if (!t) break;
        const rel = this.relation(pid, t);
        const followers = [];
        for (const u of units) {
          const act = D.resolveAction(u.type, t, rel, p.faction);
          if (act === 'attack') { if (this.canTarget(pid, t)) this.setOrder(u, { type: 'attack', target: t.id }); }
          else if (act === 'capture' || act === 'infiltrate' || act === 'garrison' || act === 'repairBridge') this.setOrder(u, { type: 'enter', target: t.id, action: act });
          else if (act === 'dock' && UNITS[u.type].air) this.setOrder(u, { type: 'rtb', prefer: t.id });
          else if (act === 'dock') this.setOrder(u, { type: 'harvest', state: 'return', ref: t.id, ox: u.x, oy: u.y });
          else if (act === 'deploy') this.deploy(u);
          else if (act === 'follow') followers.push(u);
        }
        if (followers.length) {
          if (t.kind === 'b') this.groupMove(followers, t.x, t.y, 'move');
          else for (const u of followers) if (u !== t) this.setOrder(u, { type: 'follow', target: t.id });
        }
        break;
      }
      case 'attackBridge': {
        const br = this.bridgeAt(num(cmd.x), num(cmd.y));
        if (!br) break;
        const t = { kind: 'bridge', x: Math.floor(num(cmd.x)) + 0.5, y: Math.floor(num(cmd.y)) + 0.5 };
        for (const u of units) {
          const w = this.weapon(u, t);
          if (UNITS[u.type].air === 'jet' || !w || D.bridgeDamage(w) <= 0) continue;
          this.setOrder(u, { type: 'attackBridge', bridge: br.id, x: t.x, y: t.y });
        }
        break;
      }
      case 'stop':
        for (const u of units) this.setOrder(u, { type: 'idle' });
        break;
      case 'deploy':
        for (const u of units) {
          if (u.type === 'mcv') this.deploy(u);
          else if (this.ud(u).deployWeapon && u.deployT <= 0) {
            this.setOrder(u, { type: 'idle' });
            u.guardX = u.x; u.guardY = u.y;
            this.setDeployed(u, !u.deployed);
          }
        }
        break;
      case 'queue': {
        const cat = D.categoryOf(cmd.type);
        if (!cat || !this.canBuild(p, cmd.type)) break;
        const q = p.queues[cat];
        const count = Math.max(1, Math.min(5, cmd.count | 0 || 1));
        for (let k = 0; k < count; k++) {
          if (cat === 'building' || cat === 'defense') {
            if (q.length >= 1) break;
          } else if (q.length >= 15) break;
          if (UNITS[cmd.type]?.air === 'jet') {
            const pads = [...this.entities.values()].filter(e => e.kind === 'b' && e.owner === pid && e.type === 'airfield').length * 4;
            const have = this.jetCount(pid) + q.filter(i => UNITS[i.type].air === 'jet').length;
            if (have >= pads) { this.msg(pid, 'All landing pads are in use', 'error'); break; }
          }
          const lim = UNITS[cmd.type]?.limit;
          if (lim) {
            const have = (p.unitCounts[cmd.type] || 0) + q.filter(i => i.type === cmd.type).length;
            if (have >= lim) { this.msg(pid, 'Unit limit reached'); break; }
          }
          q.push({ type: cmd.type, progress: 0, spent: 0 });
        }
        break;
      }
      case 'cancel': {
        const cat = D.categoryOf(cmd.type);
        if (!cat) break;
        const q = p.queues[cat];
        for (let i = q.length - 1; i >= 0; i--) {
          if (q[i].type === cmd.type) {
            p.credits += q[i].spent;
            q.splice(i, 1);
            break;
          }
        }
        break;
      }
      case 'place': {
        const cat = cmd.cat === 'defense' ? 'defense' : 'building';
        const q = p.queues[cat];
        if (!q.length || q[0].progress < 1) break;
        const type = q[0].type;
        const tx = num(cmd.x) | 0, ty = num(cmd.y) | 0;
        if (!this.canPlace(pid, type, tx, ty)) { this.msg(pid, 'Cannot place building there', 'error'); break; }
        q.shift();
        const b = this.addBuilding(type, pid, tx, ty);
        this.events.push(['place', pid, b.id]);
        if (type === 'refinery') {
          const ex = this.exitTile(b);
          const h = this.spawnUnit('harvester', pid, ex.x + 0.5, ex.y + 0.5);
          this.orderHarvest(h, h.x, h.y);
        }
        break;
      }
      case 'evacuate': {
        const b = this.entities.get(cmd.id);
        if (b && b.kind === 'b' && b.owner === pid && b.occ) this.evacuate(b);
        break;
      }
      case 'sell': {
        const b = this.entities.get(cmd.id);
        if (!b || b.kind !== 'b' || b.owner !== pid || D.isCivilian(b.type)) break;
        p.credits += Math.round(this.bd(b).cost * 0.5 * b.hp / b.maxHp);
        this.events.push(['sell', b.x, b.y]);
        this.removeEntity(b);
        break;
      }
      case 'repair': {
        const b = this.entities.get(cmd.id);
        if (b && b.kind === 'b' && b.owner === pid && !D.isCivilian(b.type)) b.repairing = !b.repairing && b.hp < b.maxHp;
        break;
      }
      case 'rally': {
        const b = this.entities.get(cmd.id);
        if (b && b.kind === 'b' && b.owner === pid && (b.type === 'barracks' || b.type === 'factory' || b.type === 'airfield')) {
          b.rally = { x: num(cmd.x), y: num(cmd.y) };
          for (const o of this.entities.values()) if (o.kind === 'b' && o.owner === pid && o.type === b.type) o.primary = false;
          b.primary = true;
        }
        break;
      }
      case 'super': {
        if (p.superCharge < D.SUPER_CHARGE || !this.hasPower(pid)) break;
        const silo = [...this.entities.values()].find(e => e.kind === 'b' && e.owner === pid && e.type === 'silo');
        if (!silo) break;
        p.superCharge = 0;
        const x = num(cmd.x), y = num(cmd.y);
        const dist = Math.hypot(x - silo.x, y - silo.y);
        this.projectiles.push({ id: this.nextId++, kind: 'nuke', owner: pid, sx: silo.x, sy: silo.y, x: silo.x, y: silo.y, tx: x, ty: y, t: 0, dur: Math.max(4, dist / D.PROJ_SPEED.nuke), w: null, targetId: null, nuke: true });
        for (const o of this.players) this.msg(o.id, 'Nuclear missile launched', 'nukelaunch');
        break;
      }
      case 'surrender':
        this.defeat(p);
        break;
    }
  }

  setOrder(u, order) {
    u.order = order;
    u.path = null; u.pi = 0;
    u.target = order.target || null;
    u.stuck = 0; u.repath = 0; u.stuckRetries = 0;
    u.autoTarget = false;
  }

  orderMove(u, x, y, type = 'move') {
    this.setOrder(u, { type, x, y });
    this.pathTo(u, x, y);
  }

  orderHarvest(u, x, y) {
    this.setOrder(u, { type: 'harvest', state: 'seek', ox: x, oy: y });
  }

  groupMove(units, x, y, type) {
    if (!units.length) return;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (units.length === 1) {
      this.orderMove(units[0], x, y, type);
      return;
    }
    const mc0 = this.mc(units[0]);
    const amphib = units.every(u => this.mc(u) === mc0) ? mc0 : MOVE.GROUND;
    const lead = units.find(u => this.mc(u) === amphib) || units[0];
    const rid = this.regionAt(amphib, lead.x, lead.y);
    const R = this.region(amphib);
    const spots = [];
    const seen = new Set([ty * this.w + tx]);
    const q = [[tx, ty]];
    let infantrySlots = 0;
    const infCount = units.filter(u => UNITS[u.type].cat === 'infantry').length;
    const need = units.length - infCount + Math.ceil(infCount / 3);
    while (q.length && spots.length < need && seen.size < 3000) {
      const [cx, cy] = q.shift();
      if (this.inb(cx, cy) && this.passable(this.idx(cx, cy), amphib) && (!rid || R[this.idx(cx, cy)] === rid)) spots.push([cx, cy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inb(nx, ny)) continue;
        const k = ny * this.w + nx;
        if (seen.has(k)) continue;
        seen.add(k); q.push([nx, ny]);
      }
    }
    const sorted = units.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const subs = [[0.3, 0.3], [0.7, 0.4], [0.45, 0.72]];
    let si = 0;
    for (const u of sorted) {
      const isInf = UNITS[u.type].cat === 'infantry';
      let spot;
      if (isInf) {
        const k = Math.floor(infantrySlots / 3);
        spot = spots[Math.min(spots.length - 1, si + k)] || [tx, ty];
        const s = subs[infantrySlots % 3];
        infantrySlots++;
        if (infantrySlots % 3 === 0) si++;
        this.orderMove(u, spot[0] + s[0], spot[1] + s[1], type);
      } else {
        spot = spots[Math.min(spots.length - 1, si++)] || [tx, ty];
        this.orderMove(u, spot[0] + 0.5, spot[1] + 0.5, type);
      }
    }
  }

  // Connected-region labels per movement class (recomputed when buildings change).
  region(mc) {
    if (this.regionVer !== this.bmapVer || !this.regions) { this.regions = []; this.regionVer = this.bmapVer; }
    let R = this.regions[mc];
    if (R) return R;
    const n = this.w * this.h;
    R = new Int32Array(n);
    let label = 0;
    const stack = [];
    for (let s0 = 0; s0 < n; s0++) {
      if (R[s0] || !this.passable(s0, mc)) continue;
      label++;
      R[s0] = label; stack.push(s0);
      while (stack.length) {
        const i = stack.pop();
        const x = i % this.w, y = (i - x) / this.w;
        if (x > 0 && !R[i - 1] && this.passable(i - 1, mc)) { R[i - 1] = label; stack.push(i - 1); }
        if (x < this.w - 1 && !R[i + 1] && this.passable(i + 1, mc)) { R[i + 1] = label; stack.push(i + 1); }
        if (y > 0 && !R[i - this.w] && this.passable(i - this.w, mc)) { R[i - this.w] = label; stack.push(i - this.w); }
        if (y < this.h - 1 && !R[i + this.w] && this.passable(i + this.w, mc)) { R[i + this.w] = label; stack.push(i + this.w); }
      }
    }
    this.regions[mc] = R;
    return R;
  }

  regionAt(mc, x, y) {
    const R = this.region(mc);
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!this.inb(tx, ty)) return 0;
    let r = R[this.idx(tx, ty)];
    if (r) return r;
    // standing on an impassable tile (e.g. just spawned): use an adjacent region
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (this.inb(tx + dx, ty + dy) && (r = R[this.idx(tx + dx, ty + dy)])) return r;
    }
    return 0;
  }

  // Nearest tile to (x, y) that the unit can actually reach. Clicking on rubble, a building
  // or across a river sends units to the closest reachable spot instead of a dead end.
  reachableTarget(u, x, y) {
    const mc = this.mc(u);
    const rid = this.regionAt(mc, u.x, u.y);
    const tx = Math.max(0, Math.min(this.w - 1, Math.floor(x))), ty = Math.max(0, Math.min(this.h - 1, Math.floor(y)));
    const R = this.region(mc);
    if (!rid || R[this.idx(tx, ty)] === rid) return { x, y, exact: true };
    let best = null, bd = Infinity;
    for (let r = 1; r < 24 && !best; r++) {
      for (let yy = ty - r; yy <= ty + r; yy++) for (let xx = tx - r; xx <= tx + r; xx++) {
        if (Math.max(Math.abs(xx - tx), Math.abs(yy - ty)) !== r || !this.inb(xx, yy)) continue;
        if (R[this.idx(xx, yy)] !== rid) continue;
        const d = Math.hypot(xx - tx, yy - ty) + Math.hypot(xx - u.x, yy - u.y) * 0.05;
        if (d < bd) { bd = d; best = { x: xx + 0.5, y: yy + 0.5, exact: false }; }
      }
    }
    return best || { x, y, exact: true };
  }

  // Tiles occupied by stationary units (used to route around traffic jams).
  occupancy() {
    if (this.occTick === this.tick) return this.occ;
    if (!this.occ) this.occ = new Uint8Array(this.w * this.h);
    this.occ.fill(0);
    for (const e of this.entities.values()) {
      if (e.kind !== 'u' || e.moving || UNITS[e.type].air) continue;
      const i = this.idx(Math.floor(e.x), Math.floor(e.y));
      if (this.occ[i] < 250) this.occ[i] += UNITS[e.type].cat === 'infantry' ? 1 : 3;
    }
    this.occTick = this.tick;
    return this.occ;
  }

  pathTo(u, x, y, avoid = false) {
    if (UNITS[u.type].air) {
      u.path = [{ x: Math.max(0.3, Math.min(this.w - 0.3, x)), y: Math.max(0.3, Math.min(this.h - 0.3, y)) }];
      u.pi = 0; u.stuck = 0;
      return true;
    }
    const amphib = this.mc(u);
    const snap = this.reachableTarget(u, x, y);
    if (!snap.exact) { x = snap.x; y = snap.y; }
    const sx = Math.floor(u.x), sy = Math.floor(u.y);
    const tx = Math.floor(x), ty = Math.floor(y);
    const occ = avoid ? this.occupancy() : null;
    const self = sy * this.w + sx;
    const raw = this.pf.find(sx, sy, tx, ty, i => this.passable(i, amphib) || i === self, occ ? (i => (i === self ? 0 : occ[i] * 1.5)) : null);
    if (!raw) { u.path = []; u.pi = 0; return false; }
    u.path = raw.map(i => ({ x: (i % this.w) + 0.5, y: Math.floor(i / this.w) + 0.5 }));
    const last = raw.length ? raw[raw.length - 1] : sy * this.w + sx;
    if (last === ty * this.w + tx) {
      if (u.path.length) u.path[u.path.length - 1] = { x, y };
      else u.path.push({ x, y });
    }
    u.pi = 0;
    u.stuck = 0;
    return true;
  }

  // Infantry digging in (RA2 GI-style): stationary, stronger weapon, takes less damage.
  setDeployed(u, on) {
    if (u.deployed === on) return;
    u.deployed = on;
    u.deployT = on ? 1.0 : 0.6;
    u.target = null;
    u.cooldown = Math.max(u.cooldown, u.deployT);
    this.events.push(['deploy', u.id, on ? 1 : 0]);
  }

  deploy(u) {
    const tx = Math.floor(u.x) - 1, ty = Math.floor(u.y) - 1;
    if (!this.canPlaceRaw('conyard', tx, ty, u.id)) { this.msg(u.owner, 'Cannot deploy here', 'error'); return; }
    this.removeEntity(u, true);
    const b = this.addBuilding('conyard', u.owner, tx, ty);
    this.events.push(['place', u.owner, b.id]);
  }

  // ---------- movement ----------
  followPath(u) {
    const d = this.ud(u);
    if (d.air) return this.flyPath(u, d);
    u.moving = false;
    if (!u.path || u.pi >= u.path.length) return true;
    if (u.deployT > 0) return false;
    if (u.deployed) { this.setDeployed(u, false); return false; }
    const wp = u.path[u.pi];
    const wtx = Math.floor(wp.x), wty = Math.floor(wp.y);
    if (!this.passable(this.idx(wtx, wty), this.mc(u)) && !(Math.floor(u.x) === wtx && Math.floor(u.y) === wty)) {
      const last = u.path[u.path.length - 1];
      u.repathCount = (u.repathCount || 0) + 1;
      if (u.repathCount > 5) { u.path = null; return true; }
      this.pathTo(u, last.x, last.y);
      return false;
    }
    const dx = wp.x - u.x, dy = wp.y - u.y;
    const dist = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const isInf = d.cat === 'infantry';
    if (dist > 0.01) {
      if (isInf) u.dir = ang;
      else {
        u.dir = turnTo(u.dir, ang, 5 * DT);
        if (!(this.weapon(u) && this.weapon(u).turret) || !u.target) u.turret = turnTo(u.turret, u.dir, 6 * DT);
        if (Math.abs(angDiff(u.dir, ang)) > 0.7) { u.moving = true; return false; }
      }
    }
    const step = d.speed * DT;
    u.moving = true;
    if (step >= dist) {
      u.x = wp.x; u.y = wp.y;
      u.pi++;
      u.stuck = 0;
      if (u.pi >= u.path.length) { u.path = null; u.repathCount = 0; return true; }
    } else {
      u.x += dx / dist * step; u.y += dy / dist * step;
    }
    return false;
  }

  separate() {
    for (const c of this.grid) {
      for (let i = 0; i < c.length; i++) {
        const a = c[i];
        if (a.kind !== 'u') continue;
        const ra = UNITS[a.type].cat === 'infantry' ? 0.18 : 0.42;
        this.query(a.x, a.y, 0.9, b => {
          if (b === a || b.kind !== 'u' || b.id < a.id) return;
          if (!!UNITS[a.type].air !== !!UNITS[b.type].air || UNITS[a.type].air === 'jet' || UNITS[b.type].air === 'jet') return;
          const rb = UNITS[b.type].cat === 'infantry' ? 0.18 : 0.42;
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const min = ra + rb;
          if (d >= min) return;
          if (d < 0.001) { dx = this.rand() - 0.5; dy = this.rand() - 0.5; d = Math.hypot(dx, dy); }
          // RA2-style: a stationary friendly unit in the way steps aside for a moving one
          if (a.moving && !b.moving && this.isAlly(a.owner, b.owner)) this.scatter(b, a, dx, dy);
          else if (b.moving && !a.moving && this.isAlly(a.owner, b.owner)) this.scatter(a, b, -dx, -dy);
          const push = (min - d) * 0.25;
          const nx = dx / d * push, ny = dy / d * push;
          const wa = a.moving && !b.moving ? 0.2 : b.moving && !a.moving ? 1.8 : 1;
          this.nudge(a, -nx * wa, -ny * wa);
          this.nudge(b, nx * (2 - wa), ny * (2 - wa));
        });
      }
    }
  }

  // Move an idle unit (u) out of the way of a moving unit (m). (dx, dy) points from m to u.
  scatter(u, m, dx, dy) {
    if (UNITS[u.type].air) return;
    if (u.order.type !== 'idle' || u.path || u.deployed || u.deployT > 0 || u.target) return;
    if ((u.scatterAt || 0) > this.tick) return;
    // only if u is roughly ahead of m
    if (dx * Math.cos(m.dir) + dy * Math.sin(m.dir) <= 0) return;
    u.scatterAt = this.tick + TICK_RATE;
    const mc = this.mc(u), occ = this.occupancy();
    const cx = Math.floor(u.x), cy = Math.floor(u.y);
    const hx = Math.cos(m.dir), hy = Math.sin(m.dir);
    const next = m.path && m.path[m.pi] ? this.idx(Math.floor(m.path[m.pi].x), Math.floor(m.path[m.pi].y)) : -1;
    let best = null, bs = Infinity;
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = cx + ox, ny = cy + oy;
      if (!this.inb(nx, ny)) continue;
      const i = this.idx(nx, ny);
      if (i === next || !this.passable(i, mc)) continue;
      if (ox && oy && (!this.passable(this.idx(nx, cy), mc) || !this.passable(this.idx(cx, ny), mc))) continue;
      // prefer sideways (perpendicular to the mover's heading), empty tiles
      const along = Math.abs(ox * hx + oy * hy);
      const score = along * 2 + occ[i] * 1.5 + this.rand() * 0.3;
      if (score < bs) { bs = score; best = [nx, ny]; }
    }
    if (!best) return;
    const tx = best[0] + 0.3 + this.rand() * 0.4, ty = best[1] + 0.3 + this.rand() * 0.4;
    u.path = [{ x: tx, y: ty }]; u.pi = 0;
    u.guardX = tx; u.guardY = ty;
  }

  nudge(u, dx, dy) {
    if (this.passableAt(u.x + dx, u.y + dy, this.mc(u))) { u.x += dx; u.y += dy; }
  }

  // ---------- combat ----------
  acquire(e, range, w) {
    let best = null, bestScore = Infinity;
    const pid = e.owner;
    this.query(e.x, e.y, range, t => {
      if (!this.isEnemy(pid, t.owner)) return;
      if (D.effectVs(w, t) <= 0.05) return;
      if (t.kind === 'u' && !this.detected(pid, t)) return;
      const d = this.distTo(e, t);
      if (w.minRange && d < w.minRange) return;
      if (!this.visibleTo(pid, t.x, t.y)) return;
      // prefer things we hurt and that can shoot back
      let score = d / Math.max(0.1, w.vs[D.armorOf(t)]);
      if (t.kind === 'b') score += this.bd(t).weapon || t.occ ? 1 : 6;
      else if (!this.ud(t).weapon) score += 3;
      if (score < bestScore) { bestScore = score; best = t; }
    });
    return best;
  }

  aimAndFire(e, t, w, isUnit) {
    if (isUnit && e.deployT > 0) return;
    const ang = Math.atan2(t.y - e.y, t.x - e.x);
    let aimed;
    if (!isUnit || w.turret) {
      e.turret = turnTo(e.turret, ang, 7 * DT);
      aimed = Math.abs(angDiff(e.turret, ang)) < 0.15;
    } else {
      const inf = UNITS[e.type].cat === 'infantry';
      e.dir = inf ? ang : turnTo(e.dir, ang, 5 * DT);
      e.turret = e.dir;
      aimed = Math.abs(angDiff(e.dir, ang)) < 0.2;
    }
    if (aimed && e.cooldown <= 0) this.fire(e, t, w);
  }

  fire(src, t, w) {
    src.cooldown = w.rof;
    src.lastFire = this.tick;
    if (src.kind === 'u' && this.ud(src).cloak) src.cloaked = false;
    if (w.c4) {
      if (!t.c4) { t.c4 = 1.5; this.events.push(['c4', t.id]); }
      return;
    }
    if (w.suicide) {
      this.areaDamage(src.x, src.y, w.splash, w.dmg, w.vs, src.owner, src.id, false, w);
      this.events.push(['boom', src.x, src.y, 2]);
      this.kill(src, src.owner);
      return;
    }
    if (w.burst) { src.burstLeft = w.burst - 1; src.burstTimer = w.burstDelay; src.burstTarget = t.id; src.burstW = w; }
    this.launch(src, t, w);
  }

  launch(src, t, w) {
    let tx = t.x, ty = t.y;
    if (w.inacc) { tx += (this.rand() - 0.5) * 2 * w.inacc; ty += (this.rand() - 0.5) * 2 * w.inacc; }
    const dist = Math.hypot(tx - src.x, ty - src.y);
    const homing = !w.splash && t.kind !== 'bridge';
    const ang = src.turret ?? src.dir;
    const mx = src.x + Math.cos(ang) * 0.4, my = src.y + Math.sin(ang) * 0.4;
    this.projectiles.push({
      id: this.nextId++, kind: w.proj, owner: src.owner, src: src.id,
      sx: mx, sy: my, x: mx, y: my, tx, ty, t: 0,
      dur: Math.max(DT, dist / D.PROJ_SPEED[w.proj]), w, targetId: homing ? t.id : null,
      zs: src.alt || 0, zt: t.alt || 0, bridge: t.kind === 'bridge' ? t.bridge : null,
    });
    this.events.push(['fire', src.id, w.snd || '', w.proj]);
  }

  updateProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      p.t += DT;
      if (p.targetId) {
        const t = this.entities.get(p.targetId);
        if (t) { p.tx = t.x; p.ty = t.y; p.zt = t.alt || 0; }
      }
      const f = Math.min(1, p.t / p.dur);
      p.x = p.sx + (p.tx - p.sx) * f;
      p.y = p.sy + (p.ty - p.sy) * f;
      if (f < 1) { keep.push(p); continue; }
      if (p.nuke) {
        this.events.push(['nuke', p.tx, p.ty]);
        this.areaDamage(p.tx, p.ty, D.NUKE.radius, D.NUKE.dmg, D.NUKE.vs, p.owner, 0, true, D.NUKE);
        this.blastBridges(p.tx, p.ty, D.NUKE.radius, { ...D.NUKE, proj: 'nuke' }, p.owner);
        continue;
      }
      const w = p.w;
      if (p.bridge != null) {
        this.blastBridges(p.tx, p.ty, w.splash || 0, w, p.owner);
        if (w.splash) this.areaDamage(p.tx, p.ty, w.splash, w.dmg, w.vs, p.owner, p.src, false, w);
      } else if (w.splash) {
        this.areaDamage(p.tx, p.ty, w.splash, w.dmg, w.vs, p.owner, p.src, false, w);
        this.blastBridges(p.tx, p.ty, w.splash, w, p.owner);
      } else {
        const t = this.entities.get(p.targetId);
        if (t) this.hit(t, w, w.dmg, p.owner, p.src);
      }
      this.events.push(['hit', p.kind, Math.round(p.tx * 100) / 100, Math.round(p.ty * 100) / 100]);
    }
    this.projectiles = keep;
  }

  areaDamage(x, y, r, dmg, vs, owner, src, hitAll, w = null) {
    const hits = [];
    this.query(x, y, r, e => hits.push(e));
    for (const e of hits) {
      if (!hitAll && e.owner >= 0 && !this.isEnemy(owner, e.owner) && e.owner !== owner) continue;
      if (!hitAll && e.owner === owner) continue;
      const d = this.distTo({ x, y }, e);
      const fall = 1 - 0.5 * Math.min(1, d / r);
      if (w) this.hit(e, w, dmg * fall, owner, src, hitAll);
      else this.damage(e, dmg * vs[D.armorOf(e)] * fall, owner, src);
    }
  }

  // Apply a weapon hit. Garrison-clearing weapons also kill infantry inside buildings.
  hit(t, w, dmg, owner, src, all = false) {
    // fast jets are hard to hit with anything but dedicated anti-air weapons
    if (t.kind === 'u' && UNITS[t.type].air === 'jet' && !w.aa) dmg *= 0.3;
    if (t.kind === 'b' && t.occ && w.clears) this.hurtOccupants(t, dmg * w.vs.infantry * w.clears, owner, all || w.clears >= 1 && w.splash);
    if (t.dead) return;
    const v = w.vs[D.armorOf(t)];
    if (v > 0) this.damage(t, dmg * v, owner, src);
  }

  hurtOccupants(b, amount, owner, all) {
    const victims = all ? b.occupants.slice() : [b.occupants[Math.floor(this.rand() * b.occupants.length)]];
    const prevOwner = b.owner;
    for (const o of victims) {
      o.hp -= amount;
      if (o.hp > 0) continue;
      b.occupants.splice(b.occupants.indexOf(o), 1);
      if (owner >= 0 && owner !== prevOwner && this.players[owner]) this.players[owner].stats.killed++;
      if (prevOwner >= 0) this.players[prevOwner].stats.lost++;
    }
    b.occ = b.occupants.length;
    if (!b.occ && prevOwner >= 0) {
      b.owner = -1; b.target = null;
      this.msg(prevOwner, 'Garrison eliminated', 'error');
    }
  }

  // ---------- garrisons ----------
  garrison(u, b) {
    const cap = this.bd(b).garrison;
    if (b.occ >= cap) { this.msg(u.owner, 'Building is full', 'error'); return false; }
    if (u.deployed) u.deployed = false;
    b.occupants.push({ type: u.type, hp: u.hp, cd: 0.5 + this.rand() * 0.5, tgt: null });
    b.occ = b.occupants.length;
    if (b.owner !== u.owner) { b.owner = u.owner; b.target = null; this.msg(u.owner, 'Structure garrisoned', 'capture'); }
    this.events.push(['garrison', b.id, u.owner]);
    this.removeEntity(u);
    return true;
  }

  // Occupants leave through the nearest free tiles around the building.
  evacuate(b) {
    const owner = b.owner;
    const ring = [];
    for (let y = b.ty - 1; y <= b.ty + b.h; y++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) {
      if (x >= b.tx && x < b.tx + b.w && y >= b.ty && y < b.ty + b.h) continue;
      if (this.inb(x, y) && this.passable(this.idx(x, y), MOVE.GROUND)) ring.push([x, y]);
    }
    ring.sort((p, q) => (q[1] - p[1]) || (q[0] - p[0]));
    b.occupants.forEach((o, k) => {
      let spot = ring[k % Math.max(1, ring.length)];
      if (!spot) { const f = this.nearestFree(b.tx + b.w, b.ty + b.h, false); spot = f ? [f.x, f.y] : [b.tx + b.w, b.ty + b.h]; }
      const sub = Math.floor(k / Math.max(1, ring.length));
      const u = this.spawnUnit(o.type, owner, spot[0] + 0.3 + (sub % 2) * 0.4, spot[1] + 0.3 + (sub >> 1) * 0.4);
      u.hp = Math.min(u.maxHp, o.hp);
      u.dir = u.turret = Math.atan2(spot[1] + 0.5 - b.y, spot[0] + 0.5 - b.x);
    });
    if (b.occupants.length) this.events.push(['evacuate', b.id, owner]);
    b.occupants = []; b.occ = 0;
    b.owner = -1; b.target = null;
  }

  // Each occupant fires its own weapon out of the windows with a range bonus.
  updateGarrison(b) {
    const faction = this.fac(b.owner);
    const scanNow = (this.tick + b.scan) % 5 === 0;
    const reach = Math.max(b.w, b.h) / 2;
    for (const o of b.occupants) {
      if (o.cd > 0) { o.cd -= DT; continue; }
      const w = WEAPONS[D.unitDef(o.type, faction).weapon];
      if (!w) continue;
      const range = w.range + D.GARRISON_RANGE;
      let t = o.tgt ? this.entities.get(o.tgt) : null;
      if (t && (!this.isEnemy(b.owner, t.owner) || !this.canTarget(b.owner, t) || this.distTo(t, b) > range)) t = null;
      if (!t && scanNow) t = this.acquire(b, range + reach, w);
      if (t && this.distTo(t, b) > range) t = null;
      o.tgt = t ? t.id : null;
      if (!t) continue;
      o.cd = w.rof * D.GARRISON_ROF;
      // muzzle at a random window on the side facing the target
      const mx = Math.max(b.tx + 0.1, Math.min(b.tx + b.w - 0.1, t.x + (this.rand() - 0.5) * 0.8));
      const my = Math.max(b.ty + 0.1, Math.min(b.ty + b.h - 0.1, t.y + (this.rand() - 0.5) * 0.8));
      const dist = Math.hypot(t.x - mx, t.y - my);
      this.projectiles.push({
        id: this.nextId++, kind: w.proj, owner: b.owner, src: b.id,
        sx: mx, sy: my, x: mx, y: my, tx: t.x, ty: t.y, t: 0,
        dur: Math.max(DT, dist / D.PROJ_SPEED[w.proj]), w, targetId: w.splash ? null : t.id,
      });
      this.events.push(['fire', b.id, w.snd || '', w.proj, Math.round(mx * 10), Math.round(my * 10)]);
    }
  }

  damage(e, amount, owner, src) {
    if (e.dead || amount <= 0) return;
    if (e.kind === 'b' && this.bd(e).invulnerable) return;
    if (e.kind === 'u' && e.deployed) amount *= this.ud(e).deployArmor || 1;
    e.hp -= amount;
    if (src) e.lastAttacker = src;
    if (e.hp <= 0) this.kill(e, owner);
  }

  kill(e, killer) {
    if (e.dead) return;
    if (e.kind === 'b' && e.occ) {
      this.events.push(['bdie', e.id, e.x, e.y, e.w]);
      this.evacuate(e);
      this.removeEntity(e);
      return;
    }
    if (killer >= 0 && killer !== e.owner && this.players[killer]) this.players[killer].stats.killed++;
    if (e.owner >= 0) this.players[e.owner].stats.lost++;
    if (e.kind === 'b') this.events.push(['bdie', e.id, e.x, e.y, e.w]);
    else this.events.push(['die', e.id, e.x, e.y, UNITS[e.type].cat === 'infantry' ? 0 : 1]);
    this.removeEntity(e);
  }

  removeEntity(e) {
    e.dead = true;
    this.entities.delete(e.id);
    if (e.kind === 'u' && e.pad) {
      const b = this.entities.get(e.pad.b);
      if (b && b.pads && b.pads[e.pad.i] === e.id) b.pads[e.pad.i] = 0;
    }
    if (e.kind === 'b') {
      this.bmapVer = (this.bmapVer || 0) + 1;
      for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) {
        const i = this.idx(x, y);
        if (this.bmap[i] === e.id) this.bmap[i] = 0;
      }
    }
  }

  // ---------- unit AI ----------
  updateUnit(u) {
    const d = this.ud(u);
    if (u.cooldown > 0) u.cooldown -= DT;
    if (d.air === 'jet') {
      if (u.burstLeft > 0) {
        u.burstTimer -= DT;
        if (u.burstTimer <= 0) {
          const t = this.entities.get(u.burstTarget);
          if (t) { this.launch(u, t, u.burstW); u.burstLeft--; u.burstTimer = u.burstW.burstDelay; } else u.burstLeft = 0;
        }
      }
      return this.updateJet(u, d);
    }
    if (d.air) u.alt = Math.min(D.HELI_CRUISE, (u.alt || 0) + 20 * DT);
    if (u.deployT > 0) { u.deployT -= DT; u.moving = false; }
    if (d.selfHeal && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + d.selfHeal * DT);
    if (d.cloak) {
      const quiet = this.tick - u.lastFire > TICK_RATE * 2;
      if (d.cloak === 'terrain') {
        // guerrillas vanish while standing in their home terrain (jungle / mountains)
        const tx = Math.floor(u.x), ty = Math.floor(u.y);
        const t = this.inb(tx, ty) ? this.terrain[this.idx(tx, ty)] : -1;
        u.cloaked = quiet && ((d.move === 'forest' && t === T.TREE) || (d.move === 'mountain' && t === T.ROCK));
      } else u.cloaked = quiet;
    }
    if (u.burstLeft > 0) {
      u.burstTimer -= DT;
      if (u.burstTimer <= 0) {
        const t = this.entities.get(u.burstTarget);
        if (t) { this.launch(u, t, u.burstW); u.burstLeft--; u.burstTimer = u.burstW.burstDelay; }
        else u.burstLeft = 0;
      }
    }
    const scanNow = (this.tick + u.scan) % 8 === 0;
    const o = u.order;
    switch (o.type) {
      case 'idle': this.doIdle(u, d, scanNow); break;
      case 'move': {
        if (this.followPath(u)) { this.setOrder(u, { type: 'idle' }); u.guardX = u.x; u.guardY = u.y; }
        this.fireOnTheMove(u, d, scanNow);
        this.checkStuck(u, o.x, o.y);
        break;
      }
      case 'attackMove': {
        if (u.target) {
          const t = this.entities.get(u.target);
          if (!t || !this.canTarget(u.owner, t) || this.distTo(u, t) > d.sight + 3) { u.target = null; this.pathTo(u, o.x, o.y); }
          else { this.engage(u, d, t, true); break; }
        }
        const w = this.weapon(u);
        if (w && scanNow) {
          const t = this.acquire(u, Math.max(d.sight, w.range), w);
          if (t) { u.target = t.id; u.path = null; break; }
        }
        if (this.followPath(u)) { this.setOrder(u, { type: 'idle' }); u.guardX = u.x; u.guardY = u.y; }
        this.checkStuck(u, o.x, o.y);
        break;
      }
      case 'attackBridge': {
        const br = this.bridges[o.bridge];
        if (!br || br.hp <= 0) { this.setOrder(u, { type: 'idle' }); u.guardX = u.x; u.guardY = u.y; break; }
        this.engage(u, d, { id: 0, kind: 'bridge', bridge: br.id, x: o.x, y: o.y, alt: 0 }, true);
        break;
      }
      case 'attack': {
        const t = this.entities.get(o.target);
        // stop once the target is gone or no longer hostile (e.g. a cleared garrison turns neutral)
        if (!t || !this.canTarget(u.owner, t) || !this.isEnemy(u.owner, t.owner)) { this.setOrder(u, { type: 'idle' }); u.guardX = u.x; u.guardY = u.y; break; }
        this.engage(u, d, t, true);
        break;
      }
      case 'follow': {
        const t = this.entities.get(o.target);
        if (!t) { this.setOrder(u, { type: 'idle' }); u.guardX = u.x; u.guardY = u.y; break; }
        if (Math.hypot(t.x - u.x, t.y - u.y) > 2) {
          u.repath -= DT;
          if (!u.path || u.repath <= 0) { this.pathTo(u, t.x, t.y); u.repath = 1; }
          this.followPath(u);
        } else { u.path = null; u.moving = false; }
        break;
      }
      case 'enter': this.doEnter(u, o); break;
      case 'harvest': this.doHarvest(u, d, o); break;
    }
  }

  // Called once per second while a unit follows a path. Re-routes around traffic,
  // then gives up gracefully instead of jittering forever.
  checkStuck(u, x, y) {
    if (!u.path || UNITS[u.type].air) return;
    if (!u.lastPos) u.lastPos = { x: u.x, y: u.y };
    if ((this.tick + u.scan) % TICK_RATE !== 0) return;
    const moved = Math.hypot(u.x - u.lastPos.x, u.y - u.lastPos.y);
    u.lastPos = { x: u.x, y: u.y };
    if (moved >= 0.15) { u.stuck = 0; return; }
    u.stuck++;
    if (u.stuck < 2) return;
    u.stuck = 0;
    u.stuckRetries = (u.stuckRetries || 0) + 1;
    if (u.order.type === 'harvest') {
      const o = u.order;
      const here = this.idx(Math.floor(u.x), Math.floor(u.y));
      if (o.state === 'toRef') {
        const ref = this.entities.get(o.refId);
        if (ref && this.distTo(u, ref) < 1.3) { o.state = 'unload'; o.timer = 0; u.path = null; return; }
        if (u.stuckRetries <= 2) { this.pathTo(u, o.dock.x, o.dock.y, true); return; }
        o.state = 'return'; o.avoidDock = o.dock; u.stuckRetries = 0;
      } else if (this.ore[here] && u.cargo < this.ud(u).capacity) {
        o.oreTile = here; o.state = 'mine'; o.timer = 0; u.path = null;
      } else if (u.stuckRetries <= 2) {
        const last = u.path[u.path.length - 1];
        this.pathTo(u, last.x, last.y, true);
      } else {
        u.path = null; u.stuckRetries = 0;
        o.state = u.cargo >= this.ud(u).capacity ? 'return' : 'seek';
        o.ox = u.x + (this.rand() - 0.5) * 6; o.oy = u.y + (this.rand() - 0.5) * 6;
      }
      return;
    }
    const far = Math.hypot(u.x - x, u.y - y);
    if (far < 2.5 || u.stuckRetries > (far > 8 ? 10 : 5)) {
      this.setOrder(u, { type: 'idle' }); u.guardX = u.x; u.guardY = u.y;
    } else this.pathTo(u, x, y, true);
  }

  doIdle(u, d, scanNow) {
    u.moving = false;
    const w = this.weapon(u);
    if (u.type === 'harvester' && !u.path) {
      u.idleT = (u.idleT || 0) + DT;
      if (u.idleT > 6 && this.nearestRefinery(u)) { u.idleT = 0; this.orderHarvest(u, u.x, u.y); return; }
      if (!w) return;
    }
    if (!w) { if (u.path) this.followPath(u); return; }
    if (u.target) {
      const t = this.entities.get(u.target);
      const leash = Math.hypot(u.x - u.guardX, u.y - u.guardY);
      if (!t || !this.canTarget(u.owner, t) || leash > d.sight + 4 || (u.autoTarget && this.distTo(u, t) > d.sight + 2) || (u.deployed && this.distTo(u, t) > w.range)) {
        u.target = null;
        if (leash > 0.8) this.pathTo(u, u.guardX, u.guardY);
      } else {
        // Infantry & tanks chase when idle; artillery only shoots in range.
        const chase = !w.minRange && u.type !== 'harvester' && !u.deployed;
        this.engage(u, d, t, chase);
        return;
      }
    }
    if (scanNow) {
      let t = null;
      if (u.lastAttacker) {
        const a = this.entities.get(u.lastAttacker);
        if (a && this.isEnemy(u.owner, a.owner) && this.canTarget(u.owner, a) && this.distTo(u, a) <= Math.max(d.sight, w.range) + 1 && D.effectVs(w, a) > 0.05) t = a;
        u.lastAttacker = null;
      }
      if (t && u.deployed && this.distTo(u, t) > w.range) t = null;
      if (!t) t = this.acquire(u, w.minRange || u.deployed ? w.range : Math.max(d.sight, w.range), w);
      if (t) { u.target = t.id; u.autoTarget = true; u.path = null; return; }
    }
    if (u.path) this.followPath(u);
  }

  fireOnTheMove(u, d, scanNow) {
    const w = this.weapon(u);
    if (!w || !w.turret || w.minRange) return;
    let t = u.target ? this.entities.get(u.target) : null;
    if (t && (!this.canTarget(u.owner, t) || this.distTo(u, t) > w.range)) { t = null; u.target = null; }
    if (!t && scanNow) { t = this.acquire(u, w.range, w); if (t) u.target = t.id; }
    if (t) this.aimAndFire(u, t, w, true);
    else u.turret = turnTo(u.turret, u.dir, 4 * DT);
  }

  engage(u, d, t, chase) {
    const w = this.weapon(u, t);
    if (!w || D.effectVs(w, t) <= 0) { if (u.order.type === 'attack') this.setOrder(u, { type: 'idle' }); u.target = null; return; }
    const dist = this.distTo(u, t);
    if (dist <= w.range && !(w.minRange && dist < w.minRange)) {
      u.path = null; u.moving = false;
      this.aimAndFire(u, t, w, true);
      return;
    }
    if (!chase) { u.moving = false; return; }
    u.repath -= DT;
    if (!u.path || u.repath <= 0) {
      const tx = t.kind === 'b' ? Math.max(t.tx, Math.min(t.tx + t.w - 0.01, u.x)) : t.x;
      const ty = t.kind === 'b' ? Math.max(t.ty, Math.min(t.ty + t.h - 0.01, u.y)) : t.y;
      this.pathTo(u, tx, ty);
      u.repath = 1 + this.rand() * 0.5;
      if (!u.path || !u.path.length) {
        if (u.order.type === 'attack') { this.setOrder(u, { type: 'idle' }); u.guardX = u.x; u.guardY = u.y; }
        u.target = null;
        return;
      }
    }
    this.followPath(u);
    if (w.turret) u.turret = turnTo(u.turret, Math.atan2(t.y - u.y, t.x - u.x), 6 * DT);
  }

  doEnter(u, o) {
    const t = this.entities.get(o.target);
    if (!t || t.kind !== 'b') { this.setOrder(u, { type: 'idle' }); return; }
    const rel = this.relation(u.owner, t);
    if (this.distTo(u, t) <= 0.9) {
      if (o.action === 'capture' && (rel === 'enemy' || rel === 'neutral')) {
        const prev = t.owner;
        t.owner = u.owner;
        t.repairing = false; t.target = null; t.rally = null;
        this.events.push(['capture', t.id, u.owner]);
        this.msg(u.owner, 'Building captured', 'capture');
        if (prev >= 0) this.msg(prev, 'Building lost to enemy engineer', 'error');
        this.removeEntity(u);
      } else if (o.action === 'repairBridge' && t.type === 'bridgehut') {
        if (this.repairBridge(this.bridges[t.bridge])) {
          this.msg(u.owner, 'Bridge repaired', 'capture');
          this.removeEntity(u);
        } else this.setOrder(u, { type: 'idle' });
      } else if (o.action === 'garrison' && D.isCivilian(t.type) && (rel === 'neutral' || rel === 'own')) {
        if (!this.garrison(u, t)) this.setOrder(u, { type: 'idle' });
      } else if (o.action === 'infiltrate' && rel === 'enemy') {
        const victim = this.players[t.owner];
        if (t.type === 'refinery') {
          const amt = Math.floor(Math.min(victim.credits * 0.5, 4000));
          victim.credits -= amt;
          this.players[u.owner].credits += amt;
          this.msg(u.owner, `Agent stole $${amt}`, 'capture');
          this.msg(victim.id, 'Credits stolen by enemy agent!', 'error');
        } else {
          victim.blackout = 45;
          this.msg(u.owner, 'Enemy power sabotaged', 'capture');
          this.msg(victim.id, 'Power sabotaged by enemy agent!', 'error');
        }
        this.removeEntity(u);
      } else this.setOrder(u, { type: 'idle' });
      return;
    }
    u.repath -= DT;
    if (!u.path || u.repath <= 0) {
      const ex = Math.max(t.tx - 0.5, Math.min(t.tx + t.w + 0.5, u.x));
      const ey = Math.max(t.ty - 0.5, Math.min(t.ty + t.h + 0.5, u.y));
      this.pathTo(u, ex, ey);
      u.repath = 2;
      if (!u.path || !u.path.length) {
        // try any free adjacent tile
        const f = this.nearestFree(Math.floor(t.x), t.ty + t.h, false);
        if (f) this.pathTo(u, f.x + 0.5, f.y + 0.5);
      }
    }
    this.followPath(u);
  }

  // A free tile next to the refinery that the harvester can reach; the bottom-centre pad is
  // preferred, but any side works so a blocked pad never strands a harvester.
  dockTile(u, ref, avoid) {
    const mc = this.mc(u), rid = this.regionAt(mc, u.x, u.y), R = this.region(mc), occ = this.occupancy();
    let best = null, bs = Infinity;
    for (let y = ref.ty - 1; y <= ref.ty + ref.h; y++) for (let x = ref.tx - 1; x <= ref.tx + ref.w; x++) {
      if (x >= ref.tx && x < ref.tx + ref.w && y >= ref.ty && y < ref.ty + ref.h) continue;
      if (!this.inb(x, y)) continue;
      const i = this.idx(x, y);
      if (!this.passable(i, mc) || (rid && R[i] !== rid)) continue;
      const pad = x === ref.tx + Math.floor(ref.w / 2) && y === ref.ty + ref.h;
      let sc = Math.hypot(x + 0.5 - u.x, y + 0.5 - u.y) * 0.4 + occ[i] * 2 + (pad ? -2 : 0);
      if (avoid && Math.floor(avoid.x) === x && Math.floor(avoid.y) === y) sc += 20;
      if (sc < bs) { bs = sc; best = { x: x + 0.5, y: y + 0.5 }; }
    }
    return best || { x: ref.tx + Math.floor(ref.w / 2) + 0.5, y: ref.ty + ref.h + 0.5 };
  }

  nearestRefinery(u) {
    let best = null, bd = Infinity;
    for (const e of this.entities.values()) {
      if (e.kind !== 'b' || e.owner !== u.owner || e.type !== 'refinery') continue;
      const dd = Math.hypot(e.x - u.x, e.y - u.y);
      if (dd < bd) { bd = dd; best = e; }
    }
    return best;
  }

  findOre(u, ox, oy) {
    const reserved = new Set();
    for (const e of this.entities.values()) if (e !== u && e.type === 'harvester' && e.order.oreTile != null && e.owner === u.owner) reserved.add(e.order.oreTile);
    let best = -1, bd = Infinity;
    const sx = Math.floor(ox), sy = Math.floor(oy);
    for (let r = 0; r <= 14 && best < 0; r += 7) {
      const R = r + 7;
      for (let y = Math.max(0, sy - R); y <= Math.min(this.h - 1, sy + R); y++) {
        for (let x = Math.max(0, sx - R); x <= Math.min(this.w - 1, sx + R); x++) {
          const i = this.idx(x, y);
          if (!this.ore[i] || this.bmap[i] || reserved.has(i)) continue;
          const dd = Math.hypot(x - sx, y - sy) + Math.hypot(x - u.x, y - u.y) * 0.3;
          if (dd < bd) { bd = dd; best = i; }
        }
      }
    }
    if (best < 0) {
      for (let i = 0; i < this.ore.length; i++) {
        if (!this.ore[i] || this.bmap[i]) continue;
        const x = i % this.w, y = (i - x) / this.w;
        const dd = Math.hypot(x - u.x, y - u.y) + (reserved.has(i) ? 5 : 0);
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    return best;
  }

  doHarvest(u, d, o) {
    if (d.weapon) {
      const keepDir = u.dir;
      this.fireOnTheMove(u, d, (this.tick + u.scan) % 8 === 0);
      u.dir = keepDir;
    }
    switch (o.state) {
      case 'seek': {
        if (u.cargo >= d.capacity) { o.state = 'return'; break; }
        const i = this.findOre(u, o.ox, o.oy);
        if (i < 0) {
          if (u.cargo > 0) o.state = 'return';
          else { this.setOrder(u, { type: 'idle' }); u.guardX = u.x; u.guardY = u.y; }
          break;
        }
        o.oreTile = i;
        const x = i % this.w, y = (i - x) / this.w;
        this.pathTo(u, x + 0.5, y + 0.5);
        o.state = 'toOre';
        break;
      }
      case 'toOre': {
        if (!this.ore[o.oreTile]) { o.state = 'seek'; break; }
        const arrived = this.followPath(u);
        this.checkStuck(u, (o.oreTile % this.w) + 0.5, Math.floor(o.oreTile / this.w) + 0.5);
        if (u.order !== o) break;
        if (arrived) {
          const here = this.idx(Math.floor(u.x), Math.floor(u.y));
          if (this.ore[here]) { o.oreTile = here; o.state = 'mine'; o.timer = 0; }
          else o.state = 'seek';
        }
        break;
      }
      case 'mine': {
        u.moving = false;
        o.timer += DT;
        if (o.timer < 0.35) break;
        o.timer = 0;
        const i = o.oreTile;
        const take = Math.min(35, this.ore[i], d.capacity - u.cargo);
        this.ore[i] -= take;
        this.oreDirty.add(i);
        u.cargo += take;
        u.dir += 0.15;
        o.ox = u.x; o.oy = u.y;
        if (u.cargo >= d.capacity) o.state = 'return';
        else if (!this.ore[i]) o.state = 'seek';
        break;
      }
      case 'return': {
        const ref = (o.ref && this.entities.get(o.ref)) || this.nearestRefinery(u);
        o.ref = null;
        if (!ref || ref.owner !== u.owner) { this.setOrder(u, { type: 'idle' }); this.msg(u.owner, 'No refinery available'); break; }
        o.refId = ref.id;
        o.oreTile = null;
        o.dock = this.dockTile(u, ref, o.avoidDock);
        o.avoidDock = null;
        this.pathTo(u, o.dock.x, o.dock.y);
        o.state = 'toRef';
        break;
      }
      case 'toRef': {
        const ref = this.entities.get(o.refId);
        if (!ref) { o.state = 'return'; break; }
        this.followPath(u);
        this.checkStuck(u, o.dock.x, o.dock.y);
        if (u.order !== o) break;
        if (Math.hypot(u.x - o.dock.x, u.y - o.dock.y) < 0.8 || this.distTo(u, ref) < 0.9 || (this.distTo(u, ref) < 1.3 && !u.path)) {
          o.state = 'unload'; o.timer = 0; u.path = null;
        } else if (!u.path) this.pathTo(u, o.dock.x, o.dock.y);
        break;
      }
      case 'unload': {
        u.moving = false;
        u.dir = turnTo(u.dir, -Math.PI * 0.75, 4 * DT);
        o.timer += DT;
        if (o.timer >= 1.5) {
          const p = this.players[u.owner];
          const amt = Math.round(u.cargo * p.incomeMult);
          p.credits += amt;
          if (amt > 0) this.events.push(['cash', u.owner, amt, u.x, u.y]);
          u.cargo = 0;
          o.state = 'seek';
        }
        break;
      }
    }
  }

  // ---------- buildings ----------
  updateBuilding(b) {
    const d = this.bd(b);
    if (b.c4 > 0) {
      b.c4 -= DT;
      if (b.c4 <= 0) { this.events.push(['boom', b.x, b.y, 3]); this.kill(b, -1); return; }
    }
    if (d.civilian) { if (b.occ) this.updateGarrison(b); return; }
    if (b.owner < 0) return;
    const p = this.players[b.owner];
    if (b.repairing) {
      if (b.hp >= b.maxHp) b.repairing = false;
      else {
        const heal = b.maxHp * 0.03 * DT;
        const cost = heal * d.cost / b.maxHp * 0.4;
        if (p.credits >= cost) { p.credits -= cost; b.hp = Math.min(b.maxHp, b.hp + heal); }
      }
    }
    if (d.income) {
      b.income += DT;
      if (b.income >= 5) { b.income = 0; p.credits += d.income * 5; this.events.push(['cash', b.owner, d.income * 5, b.x, b.y]); }
    }
    if (d.weapon) {
      if (b.cooldown > 0) b.cooldown -= DT;
      if (d.powered && !this.hasPower(b.owner)) return;
      const w = WEAPONS[d.weapon];
      let t = b.target ? this.entities.get(b.target) : null;
      if (t && (!this.canTarget(b.owner, t) || this.distTo(b, t) > w.range)) t = null;
      if (!t && (this.tick + b.scan) % 6 === 0) t = this.acquire(b, w.range, w);
      b.target = t ? t.id : null;
      if (t) this.aimAndFire(b, t, w, false);
    }
  }

  regrowOre() {
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(this.rand() * this.ore.length);
      if (this.oreBase[i] && !this.bmap[i] && this.ore[i] < this.oreBase[i]) {
        this.ore[i] = Math.min(this.oreBase[i], this.ore[i] + 60);
        this.oreDirty.add(i);
      }
    }
  }

  defeat(p) {
    if (p.defeated) return;
    p.defeated = true;
    p.queues = { building: [], defense: [], infantry: [], vehicle: [], air: [] };
    for (const e of [...this.entities.values()]) if (e.owner === p.id) this.kill(e, -1);
    for (const o of this.players) this.msg(o.id, `${p.name} has been defeated`, o.id === p.id ? 'defeat' : '');
  }

  checkVictory() {
    const has = this.players.map(() => false);
    for (const e of this.entities.values()) {
      if (e.owner < 0) continue;
      if ((e.kind === 'b' && e.type !== 'derrick' && !D.isCivilian(e.type)) || (e.kind === 'u' && e.type === 'mcv')) has[e.owner] = true;
    }
    for (const p of this.players) if (!p.defeated && !has[p.id]) this.defeat(p);
    const alive = this.players.filter(p => !p.defeated);
    if (alive.length === 0) { this.over = true; this.winners = []; return; }
    const first = alive[0];
    if (alive.every(p => this.isAlly(first.id, p.id))) {
      this.over = true;
      this.winners = this.players.filter(p => this.isAlly(first.id, p.id)).map(p => p.id);
      this.events.push(['over', this.winners]);
    }
  }

  // ---------- main loop ----------
  step() {
    if (this.over) return;
    this.tick++;
    this.rebuildGrid();
    this.updatePlayers();
    if (this.tick % 8 === 0) this.updateVisibility();
    for (const e of [...this.entities.values()]) {
      if (e.dead) continue;
      if (e.kind === 'u') this.updateUnit(e);
      else this.updateBuilding(e);
    }
    this.rebuildGrid();
    this.separate();
    this.updateProjectiles();
    if (this.tick % 45 === 0) this.regrowOre();
    if (this.tick % TICK_RATE === 0) this.checkVictory();
  }

  // ---------- serialization ----------
  snapshot() {
    const e = [];
    for (const x of this.entities.values()) {
      if (x.kind === 'u') {
        e.push([x.id, 0, D.TYPE_INDEX[x.type], x.owner, Math.round(x.x * 100), Math.round(x.y * 100), Math.ceil(x.hp),
          Math.round(x.dir * 100), Math.round(x.turret * 100), (x.cloaked ? 1 : 0) | (x.moving ? 2 : 0) | (x.order.type === 'harvest' && x.order.state === 'mine' ? 4 : 0) | (x.deployed ? 8 : 0) | (x.deployT > 0 ? 16 : 0),
          x.cargo || 0, Math.round((x.alt || 0) * 10), x.ammo || 0]);
      } else {
        e.push([x.id, 1, D.TYPE_INDEX[x.type], x.owner, x.tx, x.ty, Math.ceil(x.hp), Math.round(x.turret * 100),
          (x.repairing ? 1 : 0) | (x.c4 > 0 ? 2 : 0) | (x.primary ? 4 : 0) | (x.broken ? 8 : 0),
          x.rally ? Math.round(x.rally.x * 10) : -1, x.rally ? Math.round(x.rally.y * 10) : -1, x.occ || 0]);
      }
    }
    const pj = this.projectiles.map(p => [p.id, D.PROJ_KINDS.indexOf(p.kind), Math.round(p.x * 100), Math.round(p.y * 100),
      Math.round(Math.min(1, p.t / p.dur) * 100), Math.round(p.sx * 10), Math.round(p.sy * 10), Math.round(p.tx * 10), Math.round(p.ty * 10),
      Math.round(p.zs || 0), Math.round(p.zt || 0)]);
    const pl = this.players.map(p => ({
      c: Math.floor(p.credits), pw: p.power, dr: p.drain, d: p.defeated ? 1 : 0, bo: p.blackout > 0 ? 1 : 0,
      sc: Math.round(p.superCharge),
      q: Object.fromEntries(CATS.map(c => [c, p.queues[c].map(i => [i.type, Math.round(i.progress * 1000)])])),
      st: p.stats,
    }));
    const ore = [];
    for (const i of this.oreDirty) ore.push(i, this.ore[i]);
    this.oreDirty.clear();
    const ev = this.events;
    this.events = [];
    const br = this.bridges.map(b => Math.ceil(b.hp / b.maxHp * 100));
    return { t: this.tick, e, pj, pl, ore, ev, br, over: this.over ? (this.winners || []) : null };
  }
}
