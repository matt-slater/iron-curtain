// Lobby + game loop, independent of transport. Used by the Node server and the in-browser skirmish host.
import { Game } from './game.js';
import { AI } from './ai.js';
import { COUNTRIES, COLORS, TICK_RATE } from './data.js';
import { MAP_INDEX } from './maps.js';

const COUNTRY_KEYS = Object.keys(COUNTRIES);
const MAX_SLOTS = 4;

export class Room {
  // send(clientId, msg)
  constructor(code, send, { local = false } = {}) {
    this.code = code;
    this.send = send;
    this.local = local;
    this.slots = [];
    this.clients = new Map(); // clientId -> slot
    this.host = null;
    this.settings = { credits: 10000, mapSize: 0, map: 'fulda', seed: Math.floor(Math.random() * 1e9) };
    this.game = null;
    this.timer = null;
    this.lastActive = Date.now();
  }

  get humans() { return this.slots.filter(s => !s.ai); }

  freeColor() {
    const used = new Set(this.slots.map(s => s.color));
    for (let i = 0; i < COLORS.length; i++) if (!used.has(i)) return i;
    return 0;
  }

  join(clientId, name, token) {
    this.lastActive = Date.now();
    if (token) {
      const s = this.slots.find(x => x.token === token && !x.ai);
      if (s) {
        if (s.clientId != null && s.clientId !== clientId) this.clients.delete(s.clientId);
        s.clientId = clientId; s.connected = true;
        this.clients.set(clientId, s);
        if (!this.host || !this.clients.has(this.host)) this.host = clientId;
        this.broadcastLobby();
        if (this.game) this.sendStart(s);
        return { ok: true };
      }
    }
    if (this.game) return { error: 'Game already in progress' };
    if (this.slots.length >= MAX_SLOTS) {
      const ai = this.slots.findIndex(s => s.ai);
      if (ai < 0) return { error: 'Room is full' };
      this.slots.splice(ai, 1);
    }
    const nato = this.slots.filter(s => COUNTRIES[s.country].faction === 'NATO').length;
    const pact = this.slots.length - nato;
    const country = nato <= pact ? 'USA' : 'USSR';
    const s = {
      clientId, name: String(name || 'Commander').slice(0, 20), country, color: this.freeColor(),
      team: 0, ai: false, difficulty: 'normal', connected: true,
      token: Math.random().toString(36).slice(2) + Date.now().toString(36),
    };
    this.slots.push(s);
    this.clients.set(clientId, s);
    if (!this.host) this.host = clientId;
    this.broadcastLobby();
    return { ok: true };
  }

  leave(clientId) {
    const s = this.clients.get(clientId);
    this.clients.delete(clientId);
    if (!s || s.clientId !== clientId) return;
    s.connected = false;
    s.clientId = null;
    if (!this.game) this.slots.splice(this.slots.indexOf(s), 1);
    else this.chatSystem(`${s.name} disconnected`);
    if (this.host === clientId) {
      const next = this.slots.find(x => !x.ai && x.connected);
      this.host = next ? next.clientId : null;
    }
    this.broadcastLobby();
  }

  isEmpty() { return !this.slots.some(s => !s.ai && s.connected); }

  handle(clientId, m) {
    this.lastActive = Date.now();
    const me = this.clients.get(clientId);
    if (!me || !m || typeof m !== 'object') return;
    const isHost = clientId === this.host;
    switch (m.t) {
      case 'cmd':
        if (this.game && me.pid != null && m.cmd) this.game.command(me.pid, m.cmd);
        break;
      case 'chat': {
        const text = String(m.text || '').slice(0, 200);
        if (!text) break;
        for (const s of this.humans) if (s.clientId != null) this.send(s.clientId, { t: 'chat', name: me.name, color: me.color, text, team: !!m.team });
        break;
      }
      case 'slot': {
        if (this.game) break;
        const s = this.slots[m.idx | 0];
        if (!s || (s !== me && !(isHost && s.ai))) break;
        const p = m.patch || {};
        if (p.country && COUNTRY_KEYS.includes(p.country)) s.country = p.country;
        if (p.color != null && COLORS[p.color] && !this.slots.some(o => o !== s && o.color === p.color)) s.color = p.color | 0;
        if (p.team != null) s.team = Math.max(0, Math.min(4, p.team | 0));
        if (p.name && s === me) s.name = String(p.name).slice(0, 20);
        if (p.difficulty && ['easy', 'normal', 'hard'].includes(p.difficulty) && s.ai) s.difficulty = p.difficulty;
        this.broadcastLobby();
        break;
      }
      case 'addAI': {
        if (!isHost || this.game || this.slots.length >= MAX_SLOTS) break;
        const nato = this.slots.filter(s => COUNTRIES[s.country].faction === 'NATO').length;
        const fac = nato > this.slots.length - nato ? 'PACT' : 'NATO';
        const pool = COUNTRY_KEYS.filter(k => COUNTRIES[k].faction === fac);
        this.slots.push({ clientId: null, name: 'Computer', country: pool[Math.floor(Math.random() * pool.length)], color: this.freeColor(), team: 0, ai: true, difficulty: 'normal', connected: true });
        this.broadcastLobby();
        break;
      }
      case 'removeSlot': {
        if (!isHost || this.game) break;
        const s = this.slots[m.idx | 0];
        if (s && s.ai) { this.slots.splice(m.idx | 0, 1); this.broadcastLobby(); }
        break;
      }
      case 'settings': {
        if (!isHost || this.game) break;
        const p = m.patch || {};
        if ([5000, 10000, 20000, 50000].includes(p.credits)) this.settings.credits = p.credits;
        if ([0, 48, 64, 80, 96].includes(p.mapSize)) this.settings.mapSize = p.mapSize;
        if (p.map === 'random' || MAP_INDEX[p.map]) this.settings.map = p.map;
        if (p.seed != null && Number.isFinite(+p.seed)) this.settings.seed = Math.abs(+p.seed | 0);
        this.broadcastLobby();
        break;
      }
      case 'start':
        if (isHost && !this.game) this.start();
        break;
      case 'surrender':
        if (this.game && me.pid != null) this.game.command(me.pid, { c: 'surrender' });
        break;
    }
  }

  lobbyState(forClient) {
    return {
      t: 'lobby', code: this.code, local: this.local,
      host: forClient === this.host,
      you: this.slots.indexOf(this.clients.get(forClient)),
      token: this.clients.get(forClient)?.token,
      inGame: !!this.game,
      settings: this.settings,
      slots: this.slots.map(s => ({ name: s.name, country: s.country, color: s.color, team: s.team, ai: s.ai, difficulty: s.difficulty, connected: s.connected })),
    };
  }

  broadcastLobby() {
    for (const s of this.humans) if (s.clientId != null) this.send(s.clientId, this.lobbyState(s.clientId));
  }

  chatSystem(text) {
    for (const s of this.humans) if (s.clientId != null) this.send(s.clientId, { t: 'chat', name: '', text, system: true });
  }

  start() {
    if (this.slots.length < 2) {
      this.send(this.host, { t: 'error', text: 'Need at least 2 players (add a computer opponent).' });
      return;
    }
    const def = MAP_INDEX[this.settings.map];
    if (def && this.slots.length > def.players) {
      this.send(this.host, { t: 'error', text: `${def.name} supports at most ${def.players} players.` });
      return;
    }
    const teams = this.slots.map(s => s.team);
    if (teams.every(t => t !== 0 && t === teams[0])) {
      this.send(this.host, { t: 'error', text: 'Everyone is on the same team.' });
      return;
    }
    const seed = this.settings.seed;
    this.setup = {
      seed,
      credits: this.settings.credits,
      mapSize: this.settings.mapSize || undefined,
      map: this.settings.map,
      players: this.slots.map(s => ({ name: s.name, country: s.country, color: s.color, team: s.team, ai: s.ai, difficulty: s.difficulty })),
    };
    this.slots.forEach((s, i) => { s.pid = i; });
    this.game = new Game(this.setup);
    this.ais = this.game.players.filter(p => p.ai).map(p => new AI(this.game, p.id));
    for (const s of this.humans) if (s.clientId != null) this.sendStart(s);
    this.broadcastLobby();
    let last = Date.now();
    let acc = 0;
    const stepMs = 1000 / TICK_RATE;
    this.timer = setInterval(() => {
      const now = Date.now();
      acc += Math.min(now - last, 500);
      last = now;
      while (acc >= stepMs) {
        acc -= stepMs;
        this.stepGame();
        if (!this.game) return;
      }
    }, stepMs / 2);
  }

  sendStart(s) {
    this.send(s.clientId, { t: 'start', setup: this.setup, you: s.pid, ore: Array.from(this.game.ore), tick: this.game.tick });
  }

  stepGame() {
    const g = this.game;
    g.step();
    for (const ai of this.ais) ai.update();
    const snap = g.snapshot();
    const msg = { t: 'snap', s: snap };
    for (const s of this.humans) if (s.clientId != null) this.send(s.clientId, msg);
    if (g.over) this.endGame();
  }

  endGame() {
    clearInterval(this.timer);
    this.timer = null;
    this.game = null;
    this.settings.seed = Math.floor(Math.random() * 1e9);
    for (const s of this.slots) delete s.pid;
    this.slots = this.slots.filter(s => s.ai || s.connected);
    this.broadcastLobby();
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.game = null;
  }
}
