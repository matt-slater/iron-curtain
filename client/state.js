// Client mirror of the game: applies server snapshots, interpolates, tracks fog of war and visual effects.
import * as D from './shared/data.js';
import { createMap } from './shared/maps.js';
import { T, findBridges } from './shared/map.js';
import { play, speak } from './audio.js';

const SNAP_MS = 1000 / D.TICK_RATE;

function lerpAng(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export class ClientState {
  constructor(setup, you, ore) {
    this.setup = setup;
    this.you = you;
    const np = setup.players.length;
    this.map = createMap({ ...setup, mapSize: setup.mapSize || (np > 2 ? 80 : 64) }, np);
    this.biome = this.map.biome || 'temperate';
    this.w = this.map.w; this.h = this.map.h;
    this.terrain = this.map.terrain;
    // same bridge list (and order) as the server; hp is in percent from snapshots
    this.bridges = findBridges(this.terrain, this.w, this.h).map((b, i) => ({ ...b, id: i, hp: 100, set: new Set(b.tiles) }));
    this.terrainVersion = 0;
    this.ore = new Uint16Array(ore);
    this.oreVersion = 0;
    this.players = setup.players.map((p, i) => ({
      id: i, name: p.name, country: p.country, faction: D.COUNTRIES[p.country].faction, team: p.team || 0,
      color: D.COLORS[p.color].hex, ai: p.ai, credits: 0, power: 0, drain: 0, queues: {}, superCharge: 0, defeated: false,
    }));
    this.me = this.players[you];
    this.ents = new Map();
    this.projs = new Map();
    this.explored = new Uint8Array(this.w * this.h);
    this.visible = new Uint8Array(this.w * this.h);
    this.rising = new Map();
    this.planes = new Map();
    this.ghosts = new Map();
    this.bmap = new Int32Array(this.w * this.h);
    this.effects = [];
    this.messages = [];
    this.snapTime = performance.now();
    this.tick = 0;
    this.over = null;
    this.firing = new Map();
    this.listeners = {};
    this.counts = {};
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev] || []) fn(...a); }

  isEnemy(a, b) {
    if (a < 0 || b < 0 || a === b) return false;
    const ta = this.players[a].team, tb = this.players[b].team;
    return ta === 0 || tb === 0 || ta !== tb;
  }
  isAlly(a, b) { return a >= 0 && b >= 0 && !this.isEnemy(a, b); }
  relation(e) {
    if (e.owner === this.you) return 'own';
    if (e.owner < 0) return 'neutral';
    return this.isEnemy(this.you, e.owner) ? 'enemy' : 'ally';
  }

  apply(s) {
    const now = performance.now();
    this.snapTime = now;
    this.tick = s.t;
    const seen = new Set();
    for (const a of s.e) {
      const id = a[0];
      seen.add(id);
      let e = this.ents.get(id);
      const kind = a[1] === 0 ? 'u' : 'b';
      const type = D.ALL_TYPES[a[2]];
      if (!e || e.type !== type) {
        e = { id, kind, type };
        this.ents.set(id, e);
        if (kind === 'u') { e.x = e.px = a[4] / 100; e.y = e.py = a[5] / 100; e.dir = e.pdir = a[7] / 100; e.turret = e.pturret = a[8] / 100; e.alt = e.palt = (a[11] || 0) / 10; }
      }
      e.owner = a[3];
      e.hp = a[6];
      if (kind === 'u') {
        const d = D.unitDef(type, this.players[e.owner]?.faction);
        e.maxHp = d.hp;
        e.px = e.x; e.py = e.y; e.pdir = e.dir; e.pturret = e.turret; e.palt = e.alt;
        e.nalt = (a[11] || 0) / 10; e.ammo = a[12] || 0; e.air = d.air || null;
        e.nx = a[4] / 100; e.ny = a[5] / 100; e.ndir = a[7] / 100; e.nturret = a[8] / 100;
        e.flags = a[9]; e.cargo = a[10];
        e.cloaked = !!(a[9] & 1);
        e.deployed = !!(a[9] & 8);
      } else {
        const d = D.buildingDef(type, this.players[e.owner]?.faction);
        e.tx = a[4]; e.ty = a[5]; e.w = d.w; e.h = d.h; e.x = e.tx + d.w / 2; e.y = e.ty + d.h / 2;
        e.maxHp = d.hp; e.turret = a[7] / 100; e.flags = a[8];
        e.repairing = !!(a[8] & 1); e.c4 = !!(a[8] & 2); e.primary = !!(a[8] & 4); e.broken = !!(a[8] & 8);
        e.rally = a[9] >= 0 ? { x: a[9] / 10, y: a[10] / 10 } : null;
        e.civ = !!d.civilian;
        e.cap = d.garrison || 0;
        e.occ = a[11] || 0;
      }
    }
    for (const id of this.ents.keys()) if (!seen.has(id)) this.ents.delete(id);

    const pseen = new Set();
    // paradrop transport planes (interpolated like units)
    const dseen = new Set();
    for (const d of s.dr || []) {
      dseen.add(d[0]);
      let pl = this.planes.get(d[0]);
      const nx = d[1] / 100, ny = d[2] / 100;
      if (!pl) { pl = { id: d[0], x: nx, y: ny, px: nx, py: ny }; this.planes.set(d[0], pl); }
      pl.px = pl.nx ?? nx; pl.py = pl.ny ?? ny; pl.nx = nx; pl.ny = ny; pl.dir = d[3] / 100;
    }
    for (const id of this.planes.keys()) if (!dseen.has(id)) this.planes.delete(id);
    for (const p of s.pj) {
      pseen.add(p[0]);
      let pr = this.projs.get(p[0]);
      const x = p[2] / 100, y = p[3] / 100;
      if (!pr) { pr = { id: p[0], kind: D.PROJ_KINDS[p[1]], x, y, sx: p[5] / 10, sy: p[6] / 10 }; this.projs.set(p[0], pr); }
      pr.px = pr.x; pr.py = pr.y; pr.nx = x; pr.ny = y;
      pr.pf = pr.f ?? p[4] / 100; pr.nf = p[4] / 100;
      pr.tx = p[7] / 10; pr.ty = p[8] / 10; pr.zs = p[9] || 0; pr.zt = p[10] || 0;
    }
    for (const id of this.projs.keys()) if (!pseen.has(id)) this.projs.delete(id);

    s.pl.forEach((q, i) => {
      const p = this.players[i];
      p.credits = q.c; p.power = q.pw; p.drain = q.dr; p.defeated = !!q.d; p.blackout = !!q.bo;
      p.superCharge = q.sc; p.paraCharge = q.pc || 0; p.queues = q.q; p.stats = q.st;
    });

    if (s.br) s.br.forEach((hp, i) => {
      const b = this.bridges[i];
      if (!b) return;
      if ((hp > 0) !== (b.hp > 0)) {
        for (const t of b.tiles) this.terrain[t] = hp > 0 ? T.BRIDGE : T.WATER;
        this.terrainVersion++;
      }
      b.hp = hp;
    });

    if (s.ore.length) {
      for (let k = 0; k < s.ore.length; k += 2) this.ore[s.ore[k]] = s.ore[k + 1];
      this.oreVersion++;
    }

    this.bmap.fill(0);
    this.counts = {};
    for (const e of this.ents.values()) {
      if (e.kind !== 'b') continue;
      for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) this.bmap[y * this.w + x] = e.id;
      if (e.owner === this.you && !e.civ) this.counts[e.type] = (this.counts[e.type] || 0) + 1;
    }

    this.updateFog();
    for (const ev of s.ev) this.handleEvent(ev);
    if (s.over && !this.over) { this.over = s.over; this.emit('over', s.over); }
    this.emit('snap');
  }

  updateFog() {
    const { w, h } = this;
    const vis = this.visible;
    vis.fill(0);
    for (const e of this.ents.values()) {
      if (!this.isAlly(this.you, e.owner)) continue;
      const fac = this.players[e.owner]?.faction;
      const sight = e.kind === 'u' ? D.unitDef(e.type, fac).sight : D.buildingDef(e.type, fac).sight + Math.max(e.w, e.h) / 2;
      const ex = e.kind === 'u' ? e.nx : e.x, ey = e.kind === 'u' ? e.ny : e.y;
      const r2 = sight * sight;
      for (let y = Math.max(0, Math.floor(ey - sight)); y <= Math.min(h - 1, Math.ceil(ey + sight)); y++) {
        for (let x = Math.max(0, Math.floor(ex - sight)); x <= Math.min(w - 1, Math.ceil(ex + sight)); x++) {
          if ((x + 0.5 - ex) ** 2 + (y + 0.5 - ey) ** 2 <= r2) { vis[y * w + x] = 1; this.explored[y * w + x] = 1; }
        }
      }
    }
    // last-seen enemy buildings
    for (const e of this.ents.values()) {
      if (e.kind !== 'b' || e.owner === this.you) continue;
      if (this.buildingVisible(e)) this.ghosts.set(e.id, { ...e });
    }
    for (const [id, g] of this.ghosts) {
      if (this.ents.has(id) && this.ents.get(id).owner !== this.you) continue;
      if (this.buildingVisible(g) || this.ents.get(id)?.owner === this.you) this.ghosts.delete(id);
    }
  }

  // RA2-style shroud: anything on ground you've uncovered stays visible (units, buildings, effects).
  buildingVisible(b) {
    for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) if (this.explored[y * this.w + x]) return true;
    return false;
  }

  tileVisible(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return !!this.explored[ty * this.w + tx];
  }

  // Live bridge under a world position, if any.
  bridgeAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return null;
    const i = ty * this.w + tx;
    if (this.terrain[i] !== T.BRIDGE) return null;
    return this.bridges.find(b => b.hp > 0 && b.set.has(i)) || null;
  }

  // Wreckage of a destroyed bridge on this tile?
  brokenBridgeTile(i) { return this.bridges.some(b => b.hp <= 0 && b.set.has(i)); }

  // Can the local player see this entity right now?
  canSee(e) {
    if (this.isAlly(this.you, e.owner)) return true;
    if (e.kind === 'b') return this.buildingVisible(e);
    if (!this.tileVisible(e.x, e.y)) return false;
    if (e.cloaked) {
      for (const o of this.ents.values()) {
        if (this.isAlly(this.you, o.owner) && Math.hypot(o.x - e.x, o.y - e.y) <= 2.5) return true;
      }
      return false;
    }
    return true;
  }

  interpolate(now) {
    const t = Math.min(1.2, (now - this.snapTime) / SNAP_MS);
    for (const pl of this.planes.values()) { pl.x = pl.px + (pl.nx - pl.px) * t; pl.y = pl.py + (pl.ny - pl.py) * t; }
    for (const e of this.ents.values()) {
      if (e.kind !== 'u') continue;
      const k = Math.min(1, t);
      e.x = e.px + (e.nx - e.px) * k;
      e.y = e.py + (e.ny - e.py) * k;
      e.dir = lerpAng(e.pdir, e.ndir, k);
      e.alt = e.palt + (e.nalt - e.palt) * k;
      e.turret = lerpAng(e.pturret, e.nturret, k);
    }
    for (const p of this.projs.values()) {
      const k = Math.min(1, t);
      p.x = p.px + (p.nx - p.px) * k;
      p.y = p.py + (p.ny - p.py) * k;
      p.f = p.pf + (p.nf - p.pf) * k;
    }
  }

  addEffect(e) { e.t0 = performance.now(); this.effects.push(e); }

  pushMessage(text, cls = '') { this.emit('message', text, cls); }

  handleEvent(ev) {
    const [type] = ev;
    switch (type) {
      case 'msg': {
        const [, pid, text, snd] = ev;
        if (pid !== this.you) break;
        this.pushMessage(text);
        if (snd === 'nofunds') speak('Insufficient funds');
        else if (text === 'Structure garrisoned') speak('Structure garrisoned');
        else if (text === 'Garrison eliminated') speak('Garrison lost');
        else if (snd === 'ready') { speak('Construction complete'); this.emit('ready'); }
        else if (snd === 'nukeready') speak(text);
        else if (snd === 'paraready') speak('Paradrop ready');
        else if (snd === 'paradrop') { play('jet'); speak('Reinforcements inbound'); }
        else if (snd === 'nukelaunch') { play('siren'); speak('Nuclear missile launched'); }
        else if (snd === 'error') play('error');
        else if (snd === 'capture') speak(text.startsWith('Agent') ? 'Infiltration successful' : 'Building captured');
        else if (snd === 'defeat') speak('You have been defeated');
        break;
      }
      case 'spawn': {
        const [, pid, , utype] = ev;
        if (pid === this.you) speak(D.UNITS[utype].cat === 'infantry' ? 'Unit ready' : 'Unit ready');
        break;
      }
      case 'place': {
        play('place');
        // newly built/deployed buildings play a short build-up animation
        this.rising.set(ev[2], performance.now());
        const b = this.ents.get(ev[2]);
        if (b && this.canSee(b)) for (let i = 0; i < 6; i++) this.addEffect({ kind: 'smoke', x: b.tx + Math.random() * b.w, y: b.ty + Math.random() * b.h, z: 4, dur: 900 + Math.random() * 500 });
        break;
      }
      case 'garrison': {
        const b = this.ents.get(ev[1]);
        if (b && (ev[2] === this.you || this.canSee(b))) this.emit('sound', 'click', b.x, b.y);
        break;
      }
      case 'evacuate': {
        const b = this.ents.get(ev[1]);
        if (b && this.canSee(b)) this.emit('sound', 'click', b.x, b.y);
        break;
      }
      case 'deploy': {
        const u = this.ents.get(ev[1]);
        if (u && this.canSee(u)) this.emit('sound', ev[2] ? 'place' : 'click', u.x, u.y);
        break;
      }
      case 'fire': {
        const [, id, snd, proj] = ev;
        const src = this.ents.get(id);
        if (!src) break;
        this.firing.set(id, performance.now());
        if (!this.canSee(src)) break;
        const ang = src.kind === 'u' ? (src.nturret ?? src.turret) : src.turret;
        if (src.civ && ev[4] != null) {
          // garrisoned infantry firing from a window
          const h = D.BUILDINGS[src.type].height;
          this.addEffect({ kind: 'muzzle', x: ev[4] / 10, y: ev[5] / 10, z: h * (0.35 + Math.random() * 0.4), big: false, dur: 90 });
        } else if (proj !== 'none') this.addEffect({ kind: 'muzzle', x: (src.nx ?? src.x) + Math.cos(ang) * 0.45, y: (src.ny ?? src.y) + Math.sin(ang) * 0.45, z: src.kind === 'u' && D.UNITS[src.type].cat === 'infantry' ? 11 : 12, big: proj === 'shell' || proj === 'arty', dur: 90 });
        if (snd && this.emit) this.emit('sound', snd, src.x, src.y);
        break;
      }
      case 'hit': {
        const [, kind, x, y] = ev;
        if (!this.tileVisible(x, y)) break;
        if (kind === 'bullet') this.addEffect({ kind: 'spark', x, y, dur: 150 });
        else {
          const big = kind === 'arty' || kind === 'missile' ? 2 : kind === 'grad' ? 1.2 : 1;
          this.addEffect({ kind: 'explosion', x, y, size: big, dur: 500 + big * 250 });
          this.emit('sound', kind === 'missile' ? 'bigboom' : big > 1 ? 'boom' : 'hit', x, y);
        }
        break;
      }
      case 'die': {
        const [, , x, y, vehicle] = ev;
        if (!this.tileVisible(x, y)) break;
        if (vehicle) {
          this.addEffect({ kind: 'explosion', x, y, size: 1.6, dur: 800 });
          this.addEffect({ kind: 'wreck', x, y, dur: 9000 });
          this.emit('sound', 'boom', x, y);
        } else this.addEffect({ kind: 'corpse', x, y, dur: 4000 });
        break;
      }
      case 'bridge': {
        const b = this.bridges[ev[1]];
        if (!b) break;
        const mid = b.tiles[Math.floor(b.tiles.length / 2)];
        const mx = mid % this.w + 0.5, my = Math.floor(mid / this.w) + 0.5;
        if (ev[2]) { this.emit('sound', 'place', mx, my); break; }
        b.tiles.forEach((t, k) => {
          if (k % 2 || !this.explored[t]) return;
          setTimeout(() => this.addEffect({ kind: 'explosion', x: t % this.w + 0.5, y: Math.floor(t / this.w) + 0.5, size: 1.6, dur: 900 }), k * 40);
        });
        this.emit('sound', 'bigboom', mx, my);
        break;
      }
      case 'bdie': {
        const [, id, x, y, w] = ev;
        this.ghosts.delete(id);
        if (!this.tileVisible(x, y)) break;
        for (let i = 0; i < 4 + w * 2; i++) {
          const ex = x + (Math.random() - 0.5) * w, ey = y + (Math.random() - 0.5) * w;
          setTimeout(() => this.addEffect({ kind: 'explosion', x: ex, y: ey, size: 1.5 + Math.random(), dur: 900 }), i * 120);
        }
        this.addEffect({ kind: 'rubble', x, y, w, dur: 20000 });
        this.emit('sound', 'bigboom', x, y);
        break;
      }
      case 'boom': {
        const [, x, y, size] = ev;
        if (!this.tileVisible(x, y)) break;
        this.addEffect({ kind: 'explosion', x, y, size, dur: 1000 });
        this.emit('sound', 'bigboom', x, y);
        break;
      }
      case 'nuke': {
        const [, x, y] = ev;
        this.addEffect({ kind: 'nuke', x, y, dur: 6000 });
        this.emit('nuke', x, y);
        play('nuke');
        break;
      }
      case 'cash': {
        const [, pid, amt, x, y] = ev;
        if (pid === this.you) { this.addEffect({ kind: 'text', x, y, text: `+$${amt}`, dur: 1500 }); this.emit('sound', 'cash', x, y); }
        break;
      }
      case 'sell': play('cash'); break;
      case 'capture': play('click'); break;
    }
  }
}
