// Input handling, sidebar, minimap, messages.
import * as D from './shared/data.js';
import { T } from './shared/map.js';
import { iso, drawCameo, drawFlag } from './sprites.js';
import { play, toggleMute } from './audio.js';
import { onSpritesLoaded } from './sprite-art.js';

const SIDEBAR_W = 264;

export class GameUI {
  constructor(state, renderer, opts) {
    this.s = state;
    this.r = renderer;
    this.opts = opts; // { sendCmd, sendChat, onQuit, onSurrender }
    this.selection = new Set();
    this.hover = null;
    this.placing = null;
    this.placingCat = null;
    this.mode = null;
    this.drag = null;
    this.pings = [];
    this.orderLines = [];
    this.groups = new Map();
    this.groupOf = new Map();
    this.mouse = { x: 0, y: 0, in: false };
    this.mouseWorld = null;
    this.keys = new Set();
    this.tab = 'building';
    this.lastClick = { t: 0, id: null };
    this.rightDown = null;
    this.cameos = new Map();
    // re-draw sidebar pictures once the rendered sprites arrive
    onSpritesLoaded(() => {
      clearTimeout(this.cameoRefresh);
      this.cameoRefresh = setTimeout(() => { this.cameos.clear(); this.updateSidebar(true); }, 150);
    });
    this.gridKey = '';
    this.lastSidebar = 0;
    this.lastMinimap = 0;
    this.showAllHealth = true;
    this.listeners = [];

    this.canvas = document.getElementById('view');
    this.mini = document.getElementById('minimap');
    this.miniCtx = this.mini.getContext('2d');
    this.buildMiniTerrain();
    drawFlag(document.getElementById('flag'), this.s.me.country);

    this.bind();
    this.resize();
    const mcv = [...this.s.ents.values()].find(e => e.owner === this.s.you && e.type === 'mcv');
    const st = this.s.map.starts[this.s.you];
    if (mcv) this.r.centerOn(mcv.x, mcv.y); else this.r.centerOn(st.x, st.y);

    state.on('message', (text, cls) => this.addMessage(text, cls));
    state.on('sound', (name, x, y) => {
      const p = this.r.worldToScreen(x, y);
      if (p.x > -50 && p.y > -50 && p.x < this.r.vw + 50 && p.y < this.r.vh + 50) play(name, name === 'mg' || name === 'rifle' ? 0.06 : 0.04);
    });
    state.on('ready', () => {
      for (const cat of ['building', 'defense']) {
        const q = this.s.me.queues[cat];
        if (q && q[0] && q[0][1] >= 1000 && this.tab !== cat) document.querySelector(`.tabs [data-tab=${cat}]`).classList.add('flash');
      }
    });
    state.on('snap', () => {
      for (const id of [...this.selection]) if (!this.s.ents.has(id) || (!this.s.canSee(this.s.ents.get(id)))) this.selection.delete(id);
      for (const [id] of this.groupOf) if (!this.s.ents.has(id)) this.groupOf.delete(id);
    });
    this.selectTab('building');
  }

  on(target, ev, fn, opt) { target.addEventListener(ev, fn, opt); this.listeners.push([target, ev, fn, opt]); }
  destroy() { for (const [t, e, f, o] of this.listeners) t.removeEventListener(e, f, o); this.listeners = []; }

  cmd(c) { this.opts.sendCmd(c); }

  resize() {
    this.r.resize(window.innerWidth - SIDEBAR_W, window.innerHeight);
  }

  // ---------- binding ----------
  bind() {
    const cv = this.canvas;
    this.on(window, 'resize', () => this.resize());
    this.on(cv, 'contextmenu', e => e.preventDefault());
    this.on(document.getElementById('sidebar'), 'contextmenu', e => e.preventDefault());
    this.on(cv, 'mousedown', e => this.mouseDown(e));
    this.on(window, 'mousemove', e => this.mouseMove(e));
    this.on(window, 'mouseup', e => this.mouseUp(e));
    this.on(cv, 'mouseleave', () => { this.mouse.in = false; });
    this.on(cv, 'wheel', e => { e.preventDefault(); this.r.setZoom(this.r.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.offsetX, e.offsetY); }, { passive: false });
    this.on(window, 'keydown', e => this.keyDown(e));
    this.on(window, 'keyup', e => this.keys.delete(e.code));
    this.on(window, 'blur', () => this.keys.clear());

    for (const b of document.querySelectorAll('.tabs button')) this.on(b, 'click', () => { play('click'); this.selectTab(b.dataset.tab); });
    this.on(document.getElementById('btn-sell'), 'click', () => this.setMode(this.mode === 'sell' ? null : 'sell'));
    this.on(document.getElementById('btn-repair'), 'click', () => this.setMode(this.mode === 'repair' ? null : 'repair'));
    this.on(document.getElementById('btn-nuke'), 'click', () => this.setMode('nuke'));
    this.on(document.getElementById('btn-menu'), 'click', () => this.toggleMenu());
    this.on(document.getElementById('btn-resume'), 'click', () => this.toggleMenu(false));
    this.on(document.getElementById('btn-surrender'), 'click', () => { if (confirm('Surrender this game?')) { this.toggleMenu(false); this.opts.onSurrender(); } });
    this.on(document.getElementById('btn-quit'), 'click', () => { if (this.s.over || confirm('Quit to main menu?')) this.opts.onQuit(); });

    this.on(this.mini, 'mousedown', e => this.miniClick(e));
    this.on(this.mini, 'mousemove', e => { if (e.buttons & 1) this.miniClick(e); });
    this.on(this.mini, 'contextmenu', e => e.preventDefault());

    const chat = document.getElementById('chat-input');
    this.on(chat, 'keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = chat.value.trim();
        if (text) this.opts.sendChat(text);
        chat.value = '';
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
  }

  openChat() { const box = document.getElementById('chat-box'); box.classList.add('open'); document.getElementById('chat-input').focus(); }
  closeChat() { document.getElementById('chat-box').classList.remove('open'); document.getElementById('chat-input').blur(); }

  toggleMenu(force) {
    const m = document.getElementById('game-menu');
    const show = force ?? m.classList.contains('hidden');
    m.classList.toggle('hidden', !show);
  }

  setMode(mode) {
    this.mode = mode;
    this.placing = null;
    document.getElementById('btn-sell').classList.toggle('on', mode === 'sell');
    document.getElementById('btn-repair').classList.toggle('on', mode === 'repair');
    play('click');
  }

  selectTab(tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
    document.querySelector(`.tabs [data-tab=${tab}]`).classList.remove('flash');
    this.gridKey = '';
    this.updateSidebar(true);
  }

  // ---------- mouse ----------
  localPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  mouseDown(e) {
    const p = this.localPos(e);
    if (e.button === 0) {
      if (this.placing) {
        if (this.placeAt && this.placeAt.ok) {
          this.cmd({ c: 'place', cat: this.placingCat, x: this.placeAt.x, y: this.placeAt.y });
          this.placing = null;
        } else play('error');
        return;
      }
      if (this.mode === 'nuke') {
        const w = this.r.screenToWorld(p.x, p.y);
        this.cmd({ c: 'super', x: w.x, y: w.y });
        this.mode = null;
        return;
      }
      if (this.mode === 'sell' || this.mode === 'repair') {
        const t = this.r.pick(p.x, p.y);
        if (t && t.kind === 'b' && t.owner === this.s.you) {
          this.cmd({ c: this.mode, id: t.id });
          play('click');
        } else play('error');
        return;
      }
      if (this.mode === 'attackMove') {
        const w = this.r.screenToWorld(p.x, p.y);
        const ids = this.ownSelectedUnits();
        if (ids.length) {
          this.cmd({ c: 'move', ids, x: w.x, y: w.y, attack: true });
          this.pings.push({ x: w.x, y: w.y, attack: true, t0: performance.now() });
          this.addOrderLines(ids, w, true);
          play('click');
        }
        this.mode = null;
        return;
      }
      this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, shift: e.shiftKey };
    } else if (e.button === 2) {
      this.rightDown = { x: p.x, y: p.y, camX: this.r.camX, camY: this.r.camY, panning: false };
    } else if (e.button === 1) {
      e.preventDefault();
      this.rightDown = { x: p.x, y: p.y, camX: this.r.camX, camY: this.r.camY, panning: true, middle: true };
    }
  }

  mouseMove(e) {
    const p = this.localPos(e);
    this.mouse.x = p.x; this.mouse.y = p.y;
    this.mouse.in = e.target === this.canvas;
    this.mouse.force = e.ctrlKey || e.metaKey;
    this.mouseWorld = this.r.screenToWorld(p.x, p.y);
    if (this.drag) { this.drag.x1 = p.x; this.drag.y1 = p.y; }
    if (this.rightDown) {
      const dx = p.x - this.rightDown.x, dy = p.y - this.rightDown.y;
      if (!this.rightDown.panning && Math.hypot(dx, dy) > 6) this.rightDown.panning = true;
      if (this.rightDown.panning) {
        this.r.camX = this.rightDown.camX - dx / this.r.zoom;
        this.r.camY = this.rightDown.camY - dy / this.r.zoom;
        this.r.clampCam();
      }
    }
  }

  mouseUp(e) {
    const p = this.localPos(e);
    if (e.button === 0 && this.drag) {
      const d = this.drag;
      this.drag = null;
      if (Math.abs(d.x1 - d.x0) > 5 || Math.abs(d.y1 - d.y0) > 5) this.boxSelect(d);
      else this.clickSelect(p, d.shift);
    } else if ((e.button === 2 || e.button === 1) && this.rightDown) {
      const rd = this.rightDown;
      this.rightDown = null;
      if (rd.panning) return;
      if (this.placing || this.mode) { this.placing = null; this.setMode(null); return; }
      if (e.target !== this.canvas) return;
      this.command(p, e.ctrlKey || e.metaKey);
    }
  }

  ownSelectedUnits() {
    return [...this.selection].filter(id => { const e = this.s.ents.get(id); return e && e.kind === 'u' && e.owner === this.s.you; });
  }

  boxSelect(d) {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    const found = [];
    for (const e of this.s.ents.values()) {
      if (e.kind !== 'u' || e.owner !== this.s.you) continue;
      const p = this.r.worldToScreen(e.x, e.y, 6);
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) found.push(e);
    }
    // prefer combat units over harvesters when mixed
    const combat = found.filter(e => e.type !== 'harvester');
    const pickList = combat.length ? combat : found;
    if (!d.shift) this.selection.clear();
    for (const e of pickList) this.selection.add(e.id);
    if (pickList.length) play('click');
  }

  clickSelect(p, shift) {
    const t = this.r.pick(p.x, p.y);
    const now = performance.now();
    if (!t) { if (!shift) this.selection.clear(); return; }
    if (t.owner === this.s.you && t.kind === 'u' && now - this.lastClick.t < 350 && this.lastClick.id === t.id) {
      this.selectSameType([t.type]);
      return;
    }
    this.lastClick = { t: now, id: t.id };
    if (t.owner !== this.s.you) { this.selection.clear(); this.selection.add(t.id); return; }
    if (shift && t.kind === 'u') {
      if (this.selection.has(t.id)) this.selection.delete(t.id); else this.selection.add(t.id);
    } else {
      this.selection.clear();
      this.selection.add(t.id);
    }
    play('click');
  }

  selectSameType(types) {
    this.selection.clear();
    for (const e of this.s.ents.values()) {
      if (e.kind !== 'u' || e.owner !== this.s.you || !types.includes(e.type)) continue;
      const p = this.r.worldToScreen(e.x, e.y);
      if (p.x >= 0 && p.y >= 0 && p.x <= this.r.vw && p.y <= this.r.vh) this.selection.add(e.id);
    }
    play('click');
  }

  actionFor(target) {
    const ids = this.ownSelectedUnits();
    if (!ids.length || !target) return null;
    const rel = this.s.relation(target);
    if (rel === 'enemy' && target.kind === 'u' && !this.s.canSee(target)) return null;
    const acts = ids.map(id => D.resolveAction(this.s.ents.get(id).type, target, rel, this.s.me.faction));
    for (const a of ['capture', 'infiltrate', 'garrison', 'repairBridge', 'attack', 'dock', 'deploy']) if (acts.includes(a)) return a;
    if (acts.every(a => a === 'none')) return 'none';
    return 'follow';
  }

  // RA2-style order lines from each unit to its destination (green) or target (red).
  addOrderLines(ids, dest, attack) {
    const now = performance.now();
    this.orderLines = this.orderLines.filter(l => !ids.includes(l.id));
    for (const id of ids) this.orderLines.push({ id, x: dest.x, y: dest.y, target: dest.target ?? null, attack, t0: now });
  }

  command(p, force = false) {
    const w = this.r.screenToWorld(p.x, p.y);
    const ids = this.ownSelectedUnits();
    // Ctrl + right-click on a bridge: force-fire on it (RA2 style)
    if (force && ids.length && this.s.bridgeAt(w.x, w.y)) {
      this.cmd({ c: 'attackBridge', ids, x: w.x, y: w.y });
      this.pings.push({ x: w.x, y: w.y, attack: true, t0: performance.now() });
      this.addOrderLines(ids, w, true);
      play('click');
      return;
    }
    if (!ids.length) {
      // right-clicking your own selected garrison evacuates it
      const g = this.r.pick(p.x, p.y);
      if (g && g.kind === 'b' && g.civ && g.owner === this.s.you && g.occ && this.selection.has(g.id)) { this.cmd({ c: 'evacuate', id: g.id }); play('click'); return; }
      // rally point for a selected factory
      const b = [...this.selection].map(id => this.s.ents.get(id)).find(e => e && e.kind === 'b' && e.owner === this.s.you && (e.type === 'barracks' || e.type === 'factory' || e.type === 'airfield'));
      if (b) { this.cmd({ c: 'rally', id: b.id, x: w.x, y: w.y }); this.pings.push({ x: w.x, y: w.y, t0: performance.now() }); play('click'); }
      return;
    }
    const t = this.r.pick(p.x, p.y);
    if (t && !(t.kind === 'u' && t.owner === this.s.you && this.selection.has(t.id) && t.type !== 'mcv')) {
      const act = this.actionFor(t);
      if (act && act !== 'none') {
        this.cmd({ c: 'target', ids, target: t.id });
        this.pings.push({ x: t.x, y: t.y, attack: act === 'attack', t0: performance.now() });
        this.addOrderLines(ids, { x: t.x, y: t.y, target: t.id }, act === 'attack');
        play('click');
        return;
      }
      if (act === 'none') { play('error'); return; }
    }
    this.cmd({ c: 'move', ids, x: w.x, y: w.y });
    this.pings.push({ x: w.x, y: w.y, t0: performance.now() });
    this.addOrderLines(ids, w, false);
    play('click');
  }

  // ---------- keyboard ----------
  keyDown(e) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    this.keys.add(e.code);
    if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();
    const ctrl = e.ctrlKey || e.altKey || e.metaKey;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      e.preventDefault();
      if (ctrl) {
        const ids = this.ownSelectedUnits();
        for (const [id, g] of this.groupOf) if (g === n) this.groupOf.delete(id);
        for (const id of ids) this.groupOf.set(id, n);
        this.groups.set(n, ids);
      } else {
        const ids = [...this.groupOf].filter(([, g]) => g === n).map(([id]) => id).filter(id => this.s.ents.has(id));
        if (!ids.length) return;
        const now = performance.now();
        if (this.lastGroup && this.lastGroup.n === n && now - this.lastGroup.t < 400) {
          const e0 = this.s.ents.get(ids[0]);
          if (e0) this.r.centerOn(e0.x, e0.y);
        }
        this.lastGroup = { n, t: now };
        this.selection = new Set(ids);
        play('click');
      }
      return;
    }
    switch (e.code) {
      case 'KeyS': this.cmd({ c: 'stop', ids: this.ownSelectedUnits() }); break;
      case 'KeyA':
        if (ctrl) { e.preventDefault(); this.selection = new Set([...this.s.ents.values()].filter(x => x.kind === 'u' && x.owner === this.s.you && D.UNITS[x.type].weapon).map(x => x.id)); }
        else if (this.ownSelectedUnits().length) this.setMode('attackMove');
        break;
      case 'KeyD': {
        this.cmd({ c: 'deploy', ids: this.ownSelectedUnits() });
        for (const id of this.selection) {
          const b = this.s.ents.get(id);
          if (b && b.kind === 'b' && b.civ && b.owner === this.s.you && b.occ) this.cmd({ c: 'evacuate', id });
        }
        break;
      }
      case 'KeyQ': {
        const types = [...new Set(this.ownSelectedUnits().map(id => this.s.ents.get(id).type))];
        if (types.length) this.selectSameType(types);
        break;
      }
      case 'KeyH': {
        const cy = [...this.s.ents.values()].find(x => x.owner === this.s.you && (x.type === 'conyard' || x.type === 'mcv'));
        if (cy) this.r.centerOn(cy.x, cy.y);
        break;
      }
      case 'KeyZ': this.setMode(this.mode === 'sell' ? null : 'sell'); break;
      case 'KeyR': this.setMode(this.mode === 'repair' ? null : 'repair'); break;
      case 'KeyM': { const m = toggleMute(); this.addMessage(m ? 'Sound muted' : 'Sound on', 'sys'); break; }
      case 'Enter': e.preventDefault(); this.openChat(); break;
      case 'Escape':
        if (this.placing || this.mode) { this.placing = null; this.setMode(null); }
        else if (this.selection.size) this.selection.clear();
        else this.toggleMenu();
        break;
      case 'F10': e.preventDefault(); this.toggleMenu(); break;
      case 'Tab': {
        e.preventDefault();
        const order = ['building', 'defense', 'infantry', 'vehicle', 'air'];
        this.selectTab(order[(order.indexOf(this.tab) + 1) % 4]);
        break;
      }
    }
  }

  // ---------- per frame ----------
  frame(now, dt) {
    // camera scroll
    const sp = 900 * dt / this.r.zoom;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= sp;
    if (this.keys.has('ArrowRight')) dx += sp;
    if (this.keys.has('ArrowUp')) dy -= sp;
    if (this.keys.has('ArrowDown')) dy += sp;
    if (this.mouse.in && !this.rightDown && !this.drag && document.hasFocus()) {
      // wide edge-scroll zone; speed ramps up the closer the cursor gets to the edge
      const m = Math.max(40, Math.min(this.r.vw, this.r.vh) * 0.05);
      const pull = d => d < m ? 0.35 + 0.65 * (1 - Math.max(0, d) / m) : 0;
      dx += sp * (pull(this.r.vw - this.mouse.x) - pull(this.mouse.x));
      dy += sp * (pull(this.r.vh - this.mouse.y) - pull(this.mouse.y));
    }
    if (dx || dy) { this.r.camX += dx; this.r.camY += dy; this.r.clampCam(); if (this.mouse.in) this.mouseWorld = this.r.screenToWorld(this.mouse.x, this.mouse.y); }

    this.pings = this.pings.filter(p => now - p.t0 < 600);
    this.orderLines = this.orderLines.filter(l => now - l.t0 < 1600 && this.s.ents.has(l.id));
    // hover + cursor
    let cursor = 'default';
    if (this.mouse.in && !this.drag) {
      const t = this.r.pick(this.mouse.x, this.mouse.y);
      this.hover = t ? t.id : null;
      if (this.placing) cursor = this.placeAt && this.placeAt.ok ? 'copy' : 'not-allowed';
      else if (this.mode === 'sell') cursor = t && t.kind === 'b' && t.owner === this.s.you ? 'alias' : 'not-allowed';
      else if (this.mode === 'repair') cursor = t && t.kind === 'b' && t.owner === this.s.you ? 'help' : 'not-allowed';
      else if (this.mode === 'attackMove' || this.mode === 'nuke') cursor = 'crosshair';
      else if (this.rightDown && this.rightDown.panning) cursor = 'grabbing';
      else if (t) {
        const act = this.actionFor(t);
        cursor = act === 'attack' ? 'crosshair' : act === 'capture' || act === 'infiltrate' || act === 'repairBridge' ? 'cell' : act === 'none' ? 'not-allowed' : act === 'deploy' || act === 'garrison' ? 'copy' : 'pointer';
        if (!act && t.kind === 'b' && t.civ && t.owner === this.s.you && t.occ && this.selection.has(t.id)) cursor = 'alias';
      } else if (this.ownSelectedUnits().length && (this.mouse.force || this.keys.has('ControlLeft') || this.keys.has('ControlRight')) && this.s.bridgeAt(this.mouseWorld.x, this.mouseWorld.y)) {
        cursor = 'crosshair';
      } else if (this.ownSelectedUnits().length) {
        const tx = Math.floor(this.mouseWorld.x), ty = Math.floor(this.mouseWorld.y);
        const ok = tx >= 0 && ty >= 0 && tx < this.s.w && ty < this.s.h;
        cursor = ok ? 'pointer' : 'not-allowed';
      }
    }
    this.canvas.style.cursor = cursor;

    this.r.draw(now, this);
    if (now - this.lastSidebar > 100) { this.lastSidebar = now; this.updateSidebar(); }
    if (now - this.lastMinimap > 250) { this.lastMinimap = now; this.drawMinimap(); }
  }

  // ---------- sidebar ----------
  canBuild(type) {
    const s = this.s, me = s.me;
    const cat = D.categoryOf(type);
    const req = (D.UNITS[type] || D.BUILDINGS[type]).req;
    if (!req.every(r => (s.counts[r] || 0) > 0)) return false;
    if (cat === 'building' || cat === 'defense') return (s.counts.conyard || 0) > 0;
    if (cat === 'infantry') return (s.counts.barracks || 0) > 0;
    if (cat === 'air') return (s.counts.airfield || 0) > 0 && !me.defeated;
    return (s.counts.factory || 0) > 0 && !me.defeated;
  }

  updateSidebar(force) {
    const s = this.s, me = s.me;
    document.getElementById('credits').textContent = '$' + me.credits.toLocaleString();
    const scale = Math.max(100, me.power, me.drain) * 1.1;
    const pw = document.getElementById('power');
    document.getElementById('power-fill').style.width = (me.power / scale * 100) + '%';
    document.getElementById('power-drain').style.left = (me.drain / scale * 100) + '%';
    document.getElementById('power-text').textContent = me.blackout ? 'BLACKOUT' : `POWER ${me.power} / ${me.drain}`;
    pw.classList.toggle('low', me.power < me.drain || !!me.blackout);

    const nukeBtn = document.getElementById('btn-nuke');
    const hasSilo = (s.counts.silo || 0) > 0;
    const ready = hasSilo && me.superCharge >= D.SUPER_CHARGE;
    nukeBtn.disabled = !ready;
    nukeBtn.classList.toggle('ready', ready);
    const left = D.SUPER_CHARGE - me.superCharge;
    document.getElementById('nuke-timer').textContent = hasSilo && !ready ? `Nuclear missile: ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : ready ? 'NUCLEAR MISSILE READY' : '';

    const list = D.buildList(me.country, this.tab);
    const avail = list.map(t => [t, this.canBuild(t)]);
    const key = this.tab + avail.map(([t, a]) => t + (a ? 1 : 0)).join(',');
    const grid = document.getElementById('build-grid');
    if (key !== this.gridKey || force) {
      this.gridKey = key;
      grid.innerHTML = '';
      const sorted = avail.filter(a => a[1]).concat(avail.filter(a => !a[1]));
      for (const [type, ok] of sorted) {
        grid.appendChild(this.cameo(type, ok));
      }
    }
    const queue = me.queues[this.tab] || [];
    for (const el of grid.children) {
      const type = el.dataset.type;
      const items = queue.filter(q => q[0] === type);
      const head = queue[0] && queue[0][0] === type ? queue[0] : null;
      const prog = el.querySelector('.prog'), cnt = el.querySelector('.count'), st = el.querySelector('.state');
      if (head) prog.style.transform = `scaleY(${1 - head[1] / 1000})`;
      else prog.style.transform = items.length ? 'scaleY(1)' : 'scaleY(0)';
      cnt.textContent = items.length > 1 ? items.length : '';
      const isReady = head && head[1] >= 1000 && (this.tab === 'building' || this.tab === 'defense');
      el.classList.toggle('ready', !!isReady);
      st.textContent = isReady ? 'READY' : (head && head[1] < 1000 && queue.length && me.credits <= 0 ? 'ON HOLD' : '');
    }
    for (const cat of ['building', 'defense']) {
      const q = me.queues[cat];
      if (q && q[0] && q[0][1] >= 1000 && this.tab !== cat) document.querySelector(`.tabs [data-tab=${cat}]`).classList.add('flash');
    }

    // selection info
    const info = document.getElementById('selection-info');
    const sel = [...this.selection].map(id => s.ents.get(id)).filter(Boolean);
    if (!sel.length) info.textContent = '';
    else if (sel.length === 1) {
      const e = sel[0];
      const owner = s.players[e.owner];
      const name = D.typeName(e.type, owner ? owner.faction : 'NATO');
      info.textContent = `${name} — ${Math.max(0, Math.round(e.hp))}/${e.maxHp}${owner ? ' (' + owner.name + ')' : ' (neutral)'}`;
      if (e.civ) info.textContent += ` · GARRISON ${e.occ}/${e.cap}` + (e.owner === s.you && e.occ ? ' · D / RIGHT-CLICK: EVACUATE' : e.owner < 0 ? ' · RIGHT-CLICK WITH INFANTRY TO OCCUPY' : '');
    } else {
      const counts = {};
      for (const e of sel) counts[e.type] = (counts[e.type] || 0) + 1;
      info.textContent = `${sel.length} units: ` + Object.entries(counts).map(([t, n]) => `${n} ${D.typeName(t, me.faction)}`).join(', ');
    }
  }

  cameo(type, ok) {
    const me = this.s.me;
    const el = document.createElement('div');
    el.className = 'cameo' + (ok ? '' : ' locked');
    el.dataset.type = type;
    let c = this.cameos.get(type);
    if (!c) {
      c = document.createElement('canvas');
      c.width = 62; c.height = 42;
      drawCameo(c, type, me.faction, me.color, this.r.palette);
      this.cameos.set(type, c);
    }
    const img = document.createElement('canvas');
    img.width = c.width; img.height = c.height;
    img.getContext('2d').drawImage(c, 0, 0);
    el.appendChild(img);
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = D.typeName(type, me.faction); el.appendChild(nm);
    const cost = document.createElement('div'); cost.className = 'cost'; cost.textContent = '$' + D.costOf(type, me.faction); el.appendChild(cost);
    const prog = document.createElement('div'); prog.className = 'prog'; prog.style.transform = 'scaleY(0)'; el.appendChild(prog);
    const cnt = document.createElement('div'); cnt.className = 'count'; el.appendChild(cnt);
    const st = document.createElement('div'); st.className = 'state'; el.appendChild(st);
    el.addEventListener('mouseenter', () => this.tooltip(type, ok));
    el.addEventListener('mouseleave', () => { document.getElementById('tooltip').innerHTML = ''; });
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      if (!ok) { play('error'); return; }
      const cat = D.categoryOf(type);
      const q = me.queues[cat] || [];
      if (e.button === 2) { this.cmd({ c: 'cancel', type }); play('click'); return; }
      if (e.button !== 0) return;
      if ((cat === 'building' || cat === 'defense')) {
        if (q[0] && q[0][0] === type && q[0][1] >= 1000) {
          this.placing = type; this.placingCat = cat; this.mode = null;
          play('click');
          return;
        }
        if (q.length) { play('error'); this.addMessage('Already building ' + D.typeName(q[0][0], me.faction)); return; }
      }
      this.cmd({ c: 'queue', type, count: e.shiftKey ? 5 : 1 });
      play('click');
    });
    return el;
  }

  tooltip(type, ok) {
    const me = this.s.me;
    const d = D.defOf(type, me.faction);
    const tip = document.getElementById('tooltip');
    let html = `<b>${D.typeName(type, me.faction)}</b> — $${d.cost}`;
    if (D.BUILDINGS[type]) {
      const pw = d.power;
      if (pw) html += ` · Power ${pw > 0 ? '+' : ''}${pw}`;
    } else {
      html += ` · HP ${d.hp}`;
    }
    html += `<br>${d.desc || ''}`;
    if (!ok) {
      const missing = d.req.filter(r => !(this.s.counts[r] > 0)).map(r => D.buildingName(r, me.faction));
      const cat = D.categoryOf(type);
      const prod = cat === 'infantry' ? 'barracks' : cat === 'vehicle' ? 'factory' : cat === 'air' ? 'airfield' : 'conyard';
      if (!(this.s.counts[prod] > 0) && !missing.includes(D.buildingName(prod, me.faction))) missing.unshift(D.buildingName(prod, me.faction));
      html += `<br><span class="req">REQUIRES: ${missing.join(', ')}</span>`;
    }
    tip.innerHTML = html;
  }

  addMessage(text, cls = '') {
    const box = document.getElementById('messages');
    const d = document.createElement('div');
    d.className = 'm ' + cls;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 7) box.removeChild(box.firstChild);
    setTimeout(() => { d.style.opacity = '0'; }, 7000);
    setTimeout(() => d.remove(), 8200);
  }

  addChat(name, text, system, color) {
    if (system) this.addMessage(text, 'sys');
    else {
      const box = document.getElementById('messages');
      const d = document.createElement('div');
      d.className = 'm chat';
      const n = document.createElement('span');
      n.style.color = D.COLORS[color]?.hex || '#fff';
      n.textContent = name + ': ';
      d.appendChild(n);
      d.appendChild(document.createTextNode(text));
      box.appendChild(d);
      while (box.children.length > 7) box.removeChild(box.firstChild);
      setTimeout(() => { d.style.opacity = '0'; }, 10000);
      setTimeout(() => d.remove(), 11200);
    }
  }

  // ---------- minimap ----------
  miniScale() {
    const s = this.s;
    const sc = Math.min(this.mini.width / ((s.w + s.h) * 32), this.mini.height / ((s.w + s.h) * 16));
    const ox = (this.mini.width - (s.w + s.h) * 32 * sc) / 2 + s.h * 32 * sc;
    const oy = (this.mini.height - (s.w + s.h) * 16 * sc) / 2;
    return { sc, ox, oy };
  }

  buildMiniTerrain() {
    const s = this.s;
    const c = document.createElement('canvas');
    c.width = this.mini.width; c.height = this.mini.height;
    const ctx = c.getContext('2d');
    const { sc, ox, oy } = this.miniScale();
    const colors = { [T.GRASS]: '#0c2410', [T.WATER]: '#020a05', [T.SAND]: '#163a1a', [T.ROCK]: '#24482a', [T.TREE]: '#0f3216', [T.ICE]: '#1c3a26', [T.RUIN]: '#2e5232', [T.BRIDGE]: '#1a3a1c' };
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const [X, Y] = iso(x, y);
      const px = ox + X * sc, py = oy + Y * sc;
      ctx.fillStyle = colors[s.terrain[y * s.w + x]];
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 32 * sc + 0.3, py + 16 * sc); ctx.lineTo(px, py + 32 * sc + 0.3); ctx.lineTo(px - 32 * sc - 0.3, py + 16 * sc); ctx.closePath(); ctx.fill();
    }
    this.miniTerrain = c;
  }

  drawMinimap() {
    const s = this.s, ctx = this.miniCtx;
    if (this.miniTerrainVer !== s.terrainVersion) { this.miniTerrainVer = s.terrainVersion; this.buildMiniTerrain(); }
    const powered = s.me.power >= s.me.drain && !s.me.blackout;
    const radar = (s.counts.radar || 0) > 0 && powered;
    document.getElementById('radar-off').style.display = radar ? 'none' : 'flex';
    if (!radar) { ctx.clearRect(0, 0, this.mini.width, this.mini.height); return; }
    const { sc, ox, oy } = this.miniScale();
    ctx.clearRect(0, 0, this.mini.width, this.mini.height);
    ctx.drawImage(this.miniTerrain, 0, 0);
    const P = (x, y) => { const [X, Y] = iso(x, y); return [ox + X * sc, oy + Y * sc]; };
    ctx.fillStyle = '#9a8a2a';
    for (let i = 0; i < s.ore.length; i++) {
      if (!s.ore[i] || !s.explored[i]) continue;
      const x = i % s.w, y = (i - x) / s.w;
      const [px, py] = P(x + 0.5, y + 0.5);
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
    for (const e of s.ents.values()) {
      if (e.kind === 'b') {
        if (!s.isAlly(s.you, e.owner) && !s.buildingVisible(e) && !s.ghosts.has(e.id)) continue;
        ctx.fillStyle = e.owner >= 0 ? s.players[e.owner].color : '#bbb';
        const [px, py] = P(e.x, e.y);
        ctx.fillRect(Math.round(px - e.w * 0.7), Math.round(py - e.h * 0.4), Math.ceil(e.w * 1.4), Math.ceil(e.h * 0.8));
      } else {
        if (!s.canSee(e)) continue;
        ctx.fillStyle = s.players[e.owner].color;
        const [px, py] = P(e.x, e.y);
        ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
      }
    }
    // fog
    const black = new Path2D();
    const hw = 32 * sc + 0.4, hh = 16 * sc + 0.3;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      if (s.explored[i]) continue;
      const [px, py] = P(x, y);
      black.moveTo(px, py - 0.3); black.lineTo(px + hw, py + hh - 0.3); black.lineTo(px, py + 2 * hh); black.lineTo(px - hw, py + hh - 0.3); black.closePath();
    }
    ctx.fillStyle = '#000'; ctx.fill(black);
    // viewport
    const r = this.r;
    const corners = [[0, 0], [r.vw, 0], [r.vw, r.vh], [0, r.vh]].map(([x, y]) => {
      const X = x / r.zoom + r.camX, Y = y / r.zoom + r.camY;
      return [ox + X * sc, oy + Y * sc];
    });
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--ph').trim() || '#33ff66'; ctx.lineWidth = 1;
    ctx.beginPath(); corners.forEach((c, i) => i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])); ctx.closePath(); ctx.stroke();
  }

  miniClick(e) {
    e.preventDefault();
    const s = this.s;
    if (!((s.counts.radar || 0) > 0)) return;
    const rect = this.mini.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (this.mini.width / rect.width), my = (e.clientY - rect.top) * (this.mini.height / rect.height);
    const { sc, ox, oy } = this.miniScale();
    const X = (mx - ox) / sc, Y = (my - oy) / sc;
    const wx = (X / 32 + Y / 16) / 2, wy = (Y / 16 - X / 32) / 2;
    if (e.button === 2) {
      const ids = this.ownSelectedUnits();
      if (ids.length) { this.cmd({ c: 'move', ids, x: wx, y: wy }); this.addOrderLines(ids, { x: wx, y: wy }, false); play('click'); }
      return;
    }
    this.r.centerOn(wx, wy);
  }
}
