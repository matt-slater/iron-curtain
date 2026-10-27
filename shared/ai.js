// Computer opponent. Issues commands through the same API as human players.
import * as D from './data.js';

const { UNITS, BUILDINGS, WEAPONS } = D;

const BUILD_ORDER = ['power', 'refinery', 'barracks', 'power', 'factory', 'refinery', 'pillbox', 'radar', 'power', 'atgun', 'tech', 'power', 'airfield', 'factory', 'atgun', 'power', 'pillbox', 'silo', 'power', 'atgun'];

const PROFILES = {
  easy: { think: 30, firstAttack: 540, wave: 10, waveGrow: 1, reserve: 600, silo: false, defenses: 2 },
  normal: { think: 15, firstAttack: 330, wave: 8, waveGrow: 2, reserve: 200, silo: true, defenses: 4 },
  hard: { think: 8, firstAttack: 210, wave: 7, waveGrow: 3, reserve: 0, silo: true, defenses: 6 },
};

export class AI {
  constructor(game, pid) {
    this.g = game;
    this.pid = pid;
    this.prof = PROFILES[game.players[pid].difficulty] || PROFILES.normal;
    this.waveSize = this.prof.wave;
    this.attacking = new Set();
    this.lastAttack = 0;
    this.offset = pid * 3;
  }

  update() {
    const g = this.g;
    if ((g.tick + this.offset) % this.prof.think !== 0) return;
    const p = g.players[this.pid];
    if (p.defeated || g.over) return;
    this.think(p);
  }

  cmd(c) { this.g.command(this.pid, c); }

  think(p) {
    const g = this.g;
    const mine = [...g.entities.values()].filter(e => e.owner === this.pid);
    const bs = mine.filter(e => e.kind === 'b' && !BUILDINGS[e.type].civilian);
    const us = mine.filter(e => e.kind === 'u');
    const count = t => bs.filter(b => b.type === t).length + (p.queues.building.some(q => q.type === t) ? 1 : 0) + (p.queues.defense.some(q => q.type === t) ? 1 : 0);
    const time = g.tick / D.TICK_RATE;

    // deploy MCVs
    for (const u of us) if (u.type === 'mcv' && u.order.type === 'idle') {
      const before = g.entities.size;
      this.cmd({ c: 'deploy', ids: [u.id] });
      if (g.entities.has(u.id) && g.entities.size === before) {
        const f = g.nearestFree(Math.floor(u.x) + Math.floor(Math.random() * 5 - 2), Math.floor(u.y) + Math.floor(Math.random() * 5 - 2), false);
        if (f) this.cmd({ c: 'move', ids: [u.id], x: f.x + 0.5, y: f.y + 0.5 });
      }
    }
    const conyard = bs.find(b => b.type === 'conyard');
    this.base = conyard || bs[0] || us[0];
    if (!this.base) return;

    // place completed buildings
    for (const cat of ['building', 'defense']) {
      const q = p.queues[cat];
      if (q.length && q[0].progress >= 1) {
        const spot = this.findSpot(q[0].type, bs);
        if (spot) this.cmd({ c: 'place', cat, x: spot.x, y: spot.y });
        else this.cmd({ c: 'cancel', type: q[0].type });
      }
    }

    // construction
    const refsNow = bs.filter(b => b.type === 'refinery').length;
    const harvNow = us.filter(u => u.type === 'harvester').length;
    const starving = refsNow > 0 && harvNow === 0 && p.credits < 1400;
    if (starving && p.queues.building.length && p.queues.building[0].progress < 1) this.cmd({ c: 'cancel', type: p.queues.building[0].type });
    if (starving && p.queues.defense.length && p.queues.defense[0].progress < 1) this.cmd({ c: 'cancel', type: p.queues.defense[0].type });
    if (starving) {
      for (const q of [...p.queues.vehicle, ...p.queues.infantry]) if (q.type !== 'harvester') this.cmd({ c: 'cancel', type: q.type });
      if (!p.queues.vehicle.some(q => q.type === 'harvester') && g.canBuild(p, 'harvester')) this.cmd({ c: 'queue', type: 'harvester' });
      if (p.credits < 50 && !g.canBuild(p, 'harvester')) {
        const sellable = bs.filter(b => b.type === 'tech' || b.type === 'radar' || b.type === 'silo');
        if (sellable[0]) this.cmd({ c: 'sell', id: sellable[0].id });
      }
      return;
    }
    if (conyard && !p.queues.building.length) {
      let next = null;
      const needPower = p.drain + 40 > p.power;
      if (needPower && count('power') <= bs.filter(b => b.type === 'power').length) next = 'power';
      if (!next) {
        const tally = {};
        for (const t of BUILD_ORDER) {
          tally[t] = (tally[t] || 0) + 1;
          if (BUILDINGS[t].cat !== 'building') continue;
          if (t === 'silo' && !this.prof.silo) continue;
          if (count(t) < tally[t] && g.canBuild(p, t)) { next = t; break; }
        }
      }
      if (!next && p.credits > 4000 && count('refinery') < 3 && g.canBuild(p, 'refinery')) next = 'refinery';
      if (next && g.canBuild(p, next)) this.cmd({ c: 'queue', type: next });
    }
    if (conyard && !p.queues.defense.length && count('refinery') >= 1) {
      const defs = bs.filter(b => BUILDINGS[b.type].cat === 'defense').length;
      if (defs < this.prof.defenses + Math.floor(time / 300) && p.credits > 1200) {
        const r = Math.random();
        const t = this.enemyAir() > 0 && g.canBuild(p, 'samsite') && r < 0.4 ? 'samsite'
          : g.canBuild(p, 'atgun') && r < 0.7 ? 'atgun' : 'pillbox';
        if (g.canBuild(p, t)) this.cmd({ c: 'queue', type: t });
      }
    }

    // repairs
    for (const b of bs) if (b.hp < b.maxHp * 0.6 && !b.repairing && p.credits > 800) this.cmd({ c: 'repair', id: b.id });

    // production
    const refs = bs.filter(b => b.type === 'refinery').length;
    const harvs = us.filter(u => u.type === 'harvester').length + p.queues.vehicle.filter(q => q.type === 'harvester').length;
    const vehQ = p.queues.vehicle.length, infQ = p.queues.infantry.length;
    if (!conyard && g.canBuild(p, 'mcv') && !us.some(u => u.type === 'mcv') && !p.queues.vehicle.some(q => q.type === 'mcv')) {
      this.cmd({ c: 'queue', type: 'mcv' });
    } else if (refs && harvs < Math.min(refs * 2, 6) && g.canBuild(p, 'harvester') && vehQ < 2) {
      this.cmd({ c: 'queue', type: 'harvester' });
    } else if (vehQ < 2 && p.credits > 1000 + this.prof.reserve) {
      const t = this.pick(p, 'vehicle');
      if (t) this.cmd({ c: 'queue', type: t });
    }
    if (infQ < 2 && p.credits > 400 + this.prof.reserve) {
      const t = this.pick(p, 'infantry');
      if (t) this.cmd({ c: 'queue', type: t });
    }
    // air force: a few jets on the pads plus helicopters with the army
    // production is paid as it progresses, so aircraft get queued without waiting for a cash pile
    if ((p.counts.airfield || 0) > 0 && !p.queues.air.length) {
      const jets = us.filter(u => UNITS[u.type].air === 'jet').length, helis = us.filter(u => UNITS[u.type].air === 'heli').length;
      const opts = D.buildList(p.country, 'air').filter(t => g.canBuild(p, t));
      const jet = opts.find(t => UNITS[t].air === 'jet'), heli = opts.find(t => UNITS[t].air === 'heli');
      const t = jet && jets < Math.min(4, 1 + Math.floor(time / 240)) && jets <= helis ? jet : heli && helis < 2 + Math.floor(time / 300) ? heli : null;
      if (t) this.cmd({ c: 'queue', type: t });
    }
    this.flyStrikes(us);

    // garrison civilian buildings near the base / rally point with spare infantry (RA2 style)
    if ((g.tick + this.offset) % (this.prof.think * 4) === 0) this.manageGarrisons(us);

    // engineers grab the tech airport first, then derricks
    for (const u of us) {
      if (u.type !== 'engineer' || u.order.type !== 'idle') continue;
      let best = null, bd = Infinity;
      for (const e of g.entities.values()) {
        if (e.kind !== 'b' || (e.type !== 'derrick' && e.type !== 'techairport') || e.owner >= 0) continue;
        const d = Math.hypot(e.x - u.x, e.y - u.y) - (e.type === 'techairport' ? 30 : 0);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) this.cmd({ c: 'target', ids: [u.id], target: best.id });
    }
    // spies go for refineries
    for (const u of us) {
      if (u.type !== 'stasi' || u.order.type !== 'idle') continue;
      const t = this.nearestEnemy(u, e => e.kind === 'b' && e.type === 'refinery');
      if (t) this.cmd({ c: 'target', ids: [u.id], target: t.id });
    }

    // army
    const army = us.filter(u => UNITS[u.type].weapon && u.type !== 'stasi' && UNITS[u.type].air !== 'jet');
    for (const id of this.attacking) if (!g.entities.has(id)) this.attacking.delete(id);

    // defend the base
    const threat = this.baseThreat(bs);
    if (threat) {
      const defenders = army.filter(u => !this.attacking.has(u.id) && u.order.type !== 'attackMove');
      if (defenders.length) this.cmd({ c: 'move', attack: true, ids: defenders.map(u => u.id), x: threat.x, y: threat.y });
    }

    const home = army.filter(u => !this.attacking.has(u.id));
    if (time > this.prof.firstAttack && home.length >= this.waveSize && time - this.lastAttack > 60) {
      const t = this.pickTarget();
      if (t) {
        for (const u of home) this.attacking.add(u.id);
        this.cmd({ c: 'move', attack: true, ids: home.map(u => u.id), x: t.x, y: t.y });
        this.lastAttack = time;
        this.waveSize += this.prof.waveGrow;
      }
    }
    // keep attackers pushing
    const idleAttackers = army.filter(u => this.attacking.has(u.id) && u.order.type === 'idle' && !u.target);
    if (idleAttackers.length) {
      const t = this.pickTarget(idleAttackers[0]);
      if (t) this.cmd({ c: 'move', attack: true, ids: idleAttackers.map(u => u.id), x: t.x, y: t.y });
    }
    // gather idle home units at a rally point; NATO infantry digs in there
    if (!threat) {
      const rally = this.rallyPoint();
      const loiter = home.filter(u => u.order.type === 'idle' && !u.target && !u.deployed && Math.hypot(u.x - rally.x, u.y - rally.y) > 6);
      if (loiter.length) this.cmd({ c: 'move', ids: loiter.map(u => u.id), x: rally.x, y: rally.y });
      const dig = home.filter(u => u.order.type === 'idle' && !u.deployed && !u.path && g.ud(u).deployWeapon && Math.hypot(u.x - rally.x, u.y - rally.y) <= 6);
      if (dig.length) this.cmd({ c: 'deploy', ids: dig.map(u => u.id) });
    }

    // paradrop onto the enemy's ore field / base edge
    if (p.paraCharge >= D.PARA_CHARGE && this.base) {
      const harv = this.nearestEnemy(this.base, e => e.kind === 'u' && e.type === 'harvester');
      const t = harv || this.pickTarget(null, false);
      if (t) this.cmd({ c: 'para', x: t.x + 1.5, y: t.y + 1.5 });
    }

    // nuke
    if (p.superCharge >= D.SUPER_CHARGE) {
      const t = this.pickTarget(null, true);
      if (t) this.cmd({ c: 'super', x: t.x, y: t.y });
    }
  }

  manageGarrisons(us) {
    const g = this.g;
    if (!this.base) return;
    const rally = this.rallyPoint();
    const spare = us.filter(u => g.ud(u).garrison && u.order.type === 'idle' && !u.target && !this.attacking.has(u.id));
    if (spare.length < 3) return;
    let best = null, bd = Infinity;
    for (const e of g.entities.values()) {
      if (e.kind !== 'b' || !BUILDINGS[e.type].civilian) continue;
      if (!(e.owner < 0 || e.owner === this.pid) || e.occ >= BUILDINGS[e.type].garrison) continue;
      const d = Math.min(Math.hypot(e.x - rally.x, e.y - rally.y), Math.hypot(e.x - this.base.x, e.y - this.base.y));
      if (d < 16 && d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    const room = BUILDINGS[best.type].garrison - best.occ;
    const send = spare.sort((a, b) => Math.hypot(a.x - best.x, a.y - best.y) - Math.hypot(b.x - best.x, b.y - best.y)).slice(0, Math.min(room, Math.ceil(spare.length / 2)));
    if (send.length) this.cmd({ c: 'target', ids: send.map(u => u.id), target: best.id });
  }

  enemyAir() {
    const g = this.g;
    let n = 0;
    for (const e of g.entities.values()) if (e.kind === 'u' && UNITS[e.type].air && g.isEnemy(this.pid, e.owner)) n++;
    return n;
  }

  // Fully armed jets sitting on their pads fly strikes at enemy defences, armour or buildings.
  flyStrikes(us) {
    const g = this.g;
    const ready = us.filter(u => UNITS[u.type].air === 'jet' && u.landed && u.ammo >= g.ud(u).ammo && u.order.type === 'idle');
    if (!ready.length) return;
    const origin = this.base || ready[0];
    // prefer things near our base (defence), else enemy anti-air-free targets
    const threat = this.nearestEnemy(origin, e => e.kind === 'u' && !UNITS[e.type].air && Math.hypot(e.x - origin.x, e.y - origin.y) < 16);
    const t = threat || this.nearestEnemy(origin, e => e.kind === 'b' && !BUILDINGS[e.type].civilian && (BUILDINGS[e.type].weapon || e.type === 'refinery' || e.type === 'power'))
      || this.nearestEnemy(origin, e => e.kind === 'u' && !UNITS[e.type].air);
    if (t) this.cmd({ c: 'target', ids: ready.map(u => u.id), target: t.id });
  }

  pick(p, cat) {
    const g = this.g;
    const opts = D.buildList(p.country, cat).filter(t => g.canBuild(p, t) && t !== 'harvester' && t !== 'mcv' && t !== 'engineer');
    if (!opts.length) return null;
    const special = D.COUNTRIES[p.country].special;
    if (opts.includes(special) && Math.random() < 0.35) {
      // spies are utility units: a couple is plenty, they don't fight
      const lim = UNITS[special].limit || (UNITS[special].cloak === true ? 2 : 0);
      if (!lim || (p.unitCounts[special] || 0) < lim) return special;
    }
    if (cat === 'infantry') {
      const engineers = p.unitCounts.engineer || 0;
      const freeDerrick = [...g.entities.values()].some(e => (e.type === 'derrick' || e.type === 'techairport') && e.owner < 0);
      if (freeDerrick && engineers < 1 && Math.random() < 0.15 && g.canBuild(p, 'engineer')) return 'engineer';
      if (this.enemyAir() > 1 && opts.includes('manpads') && Math.random() < 0.3) return 'manpads';
      const at = opts.find(t => UNITS[t].look === 'atinf');
      const basic = opts.find(t => UNITS[t].look === 'inf');
      return Math.random() < 0.4 && at ? at : (basic || opts[0]);
    }
    const aa = opts.filter(t => WEAPONS[UNITS[t].weapon]?.aa);
    if (aa.length && this.enemyAir() > 1 && Math.random() < 0.35) return aa[0];
    const arty = opts.filter(t => UNITS[t].look === 'arty' || UNITS[t].look === 'grad');
    const tanks = opts.filter(t => UNITS[t].look === 'tank');
    const r = Math.random();
    if (r < 0.15 && arty.length) return arty[0];
    if (r < 0.25) return opts.find(t => UNITS[t].look === 'jeep') || tanks[0] || opts[0];
    return tanks[0] || opts[0];
  }

  findSpot(type, bs) {
    const g = this.g;
    const d = BUILDINGS[type];
    const base = this.base;
    let goal = { x: base.x, y: base.y };
    if (d.cat === 'defense') {
      const e = this.enemyCenter();
      if (e) {
        const dx = e.x - base.x, dy = e.y - base.y, l = Math.hypot(dx, dy) || 1;
        const r = 6 + Math.random() * 3;
        const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.6;
        goal = { x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r };
        void l;
      }
    } else if (type === 'refinery') {
      let best = null, bd = Infinity;
      for (let i = 0; i < g.ore.length; i++) {
        if (!g.ore[i]) continue;
        const x = i % g.w, y = (i - x) / g.w;
        const dd = Math.hypot(x - base.x, y - base.y);
        if (dd < bd) { bd = dd; best = { x, y }; }
      }
      if (best && bd < 14) goal = { x: (best.x + base.x) / 2, y: (best.y + base.y) / 2 };
    }
    const cands = [];
    const R = 12;
    for (let y = Math.floor(base.y - R); y <= base.y + R; y++) {
      for (let x = Math.floor(base.x - R); x <= base.x + R; x++) {
        if (!g.canPlace(this.pid, type, x, y)) continue;
        if (d.cat !== 'defense' && !this.hasMargin(x, y, d.w, d.h)) continue;
        const cx = x + d.w / 2, cy = y + d.h / 2;
        cands.push({ x, y, s: Math.hypot(cx - goal.x, cy - goal.y) + Math.random() * 1.5 });
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.s - b.s);
    return cands[0];
  }

  hasMargin(tx, ty, w, h) {
    const g = this.g;
    for (let y = ty - 1; y <= ty + h; y++) for (let x = tx - 1; x <= tx + w; x++) {
      if (!g.inb(x, y)) return false;
      const i = g.idx(x, y);
      if (g.bmap[i]) return false;
      if (g.ore[i] && g.oreBase[i] > 300) return false;
    }
    return true;
  }

  enemyCenter() {
    const g = this.g;
    let sx = 0, sy = 0, n = 0;
    for (const e of g.entities.values()) if (e.kind === 'b' && g.isEnemy(this.pid, e.owner)) { sx += e.x; sy += e.y; n++; }
    if (!n) {
      for (const p of g.players) if (g.isEnemy(this.pid, p.id)) { const s = g.map.starts[p.id]; sx += s.x; sy += s.y; n++; }
    }
    return n ? { x: sx / n, y: sy / n } : null;
  }

  rallyPoint() {
    const e = this.enemyCenter() || { x: this.g.w / 2, y: this.g.h / 2 };
    const dx = e.x - this.base.x, dy = e.y - this.base.y, l = Math.hypot(dx, dy) || 1;
    const f = this.g.nearestFree(Math.floor(this.base.x + dx / l * 7), Math.floor(this.base.y + dy / l * 7), false);
    return f ? { x: f.x + 0.5, y: f.y + 0.5 } : { x: this.base.x, y: this.base.y };
  }

  nearestEnemy(from, filter) {
    const g = this.g;
    let best = null, bd = Infinity;
    for (const e of g.entities.values()) {
      if (!g.isEnemy(this.pid, e.owner) || !filter(e)) continue;
      const d = Math.hypot(e.x - from.x, e.y - from.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  pickTarget(from, nuke) {
    const g = this.g;
    if (nuke) {
      let best = null, bs = -1;
      for (const e of g.entities.values()) {
        if (e.kind !== 'b' || !g.isEnemy(this.pid, e.owner) || BUILDINGS[e.type].civilian) continue;
        let s = 0;
        g.query(e.x, e.y, 4, o => { if (g.isEnemy(this.pid, o.owner)) s += o.kind === 'b' ? BUILDINGS[o.type].cost : UNITS[o.type].cost * 0.5; });
        if (s > bs) { bs = s; best = e; }
      }
      return best;
    }
    const origin = from || this.base;
    return this.nearestEnemy(origin, e => e.kind === 'b' && !BUILDINGS[e.type].civilian) || this.nearestEnemy(origin, () => true);
  }

  baseThreat(bs) {
    const g = this.g;
    for (const b of bs) {
      let found = null;
      g.query(b.x, b.y, 9, e => {
        if (!found && e.kind === 'u' && g.isEnemy(this.pid, e.owner) && UNITS[e.type].weapon && g.detected(this.pid, e)) found = e;
      });
      if (found) return found;
    }
    return null;
  }
}
