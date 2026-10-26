import * as D from './shared/data.js';
import { RemoteConnection, LocalConnection, serverUrl } from './net.js';
import { ClientState } from './state.js';
import { Renderer } from './render.js';
import { GameUI } from './ui.js';
import { play } from './audio.js';
import { loadSprites } from './sprite-art.js';

loadSprites();
import { MAPS, MAP_INDEX, createMap } from './shared/maps.js';
import { T } from './shared/map.js';
import { BIOME } from './render.js';

const $ = id => document.getElementById(id);
let conn = null;
let lobby = null;
let game = null; // { state, renderer, ui, raf }
let session = JSON.parse(sessionStorage.getItem('rts-session') || 'null');
const DEBUG = new URLSearchParams(location.search).has('debug');

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
  if (id === 'menu') setTheme('NATO');
}

// Green phosphor for NATO, amber for the Warsaw Pact.
function setTheme(faction) {
  document.body.classList.toggle('pact', faction === 'PACT');
}

function playerName() {
  const n = $('name-input').value.trim() || 'Commander';
  localStorage.setItem('rts-name', n);
  return n;
}
$('name-input').value = localStorage.getItem('rts-name') || '';

function connectRemote() {
  const url = serverUrl();
  if (!url) { $('menu-error').textContent = 'Online play needs a game server. Set SERVER_URL in config.js (see README).'; return false; }
  if (conn) conn.close();
  conn = new RemoteConnection(onMessage, () => {
    if (conn && conn instanceof RemoteConnection) {
      const msg = 'Disconnected from server.';
      if (game) game.ui.addMessage(msg, 'sys');
      $('menu-error').textContent = msg;
      $('lobby-error').textContent = msg;
    }
  }, url);
  return true;
}

$('btn-skirmish').onclick = () => {
  play('click');
  if (conn) conn.close();
  conn = new LocalConnection(onMessage);
  if (DEBUG) window.__conn = conn;
  conn.send({ t: 'create', name: playerName() });
  conn.send({ t: 'addAI' });
};
$('btn-create').onclick = () => {
  play('click');
  if (!connectRemote()) return;
  conn.send({ t: 'create', name: playerName() });
};
$('btn-join').onclick = () => {
  play('click');
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 4) { $('menu-error').textContent = 'Enter the 4-letter room code.'; return; }
  if (!connectRemote()) return;
  const token = session && session.code === code ? session.token : undefined;
  conn.send({ t: 'join', code, name: playerName(), token });
};
$('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });

// Auto-join via ?room=CODE links
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('code-input').value = urlRoom.toUpperCase();

$('btn-leave').onclick = () => {
  if (conn) { conn.send({ t: 'leave' }); conn.close(); conn = null; }
  sessionStorage.removeItem('rts-session');
  session = null;
  lobby = null;
  show('menu');
};
$('btn-addai').onclick = () => conn.send({ t: 'addAI' });
$('btn-start').onclick = () => conn.send({ t: 'start' });
$('set-credits').onchange = e => conn.send({ t: 'settings', patch: { credits: Number(e.target.value) } });
$('set-map').onchange = e => conn.send({ t: 'settings', patch: { mapSize: Number(e.target.value) } });
{
  const sel = $('set-mapid');
  sel.add(new Option('Random theater (procedural)', 'random'));
  for (const biome of ['temperate', 'arctic', 'desert', 'jungle']) {
    const og = document.createElement('optgroup');
    og.label = biome.toUpperCase();
    for (const m of MAPS.filter(m => m.biome === biome)) og.appendChild(new Option(`${m.name} (${m.year}) - ${m.players}P`, m.id));
    sel.appendChild(og);
  }
  sel.onchange = () => conn.send({ t: 'settings', patch: { map: sel.value } });
}
$('set-seed').onchange = e => conn.send({ t: 'settings', patch: { seed: Number(e.target.value) } });
$('lobby-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) { conn.send({ t: 'chat', text: e.target.value.trim() }); e.target.value = ''; }
});

function onMessage(m) {
  switch (m.t) {
    case 'lobby':
      lobby = m;
      if (!m.local && m.token) { session = { code: m.code, token: m.token }; sessionStorage.setItem('rts-session', JSON.stringify(session)); }
      if (!game) { renderLobby(); show('lobby'); }
      break;
    case 'start':
      startGame(m);
      break;
    case 'snap':
      if (game) game.state.apply(m.s);
      break;
    case 'chat':
      if (game) game.ui.addChat(m.name, m.text, m.system, m.color);
      lobbyChat(m);
      break;
    case 'error':
      $('menu-error').textContent = m.text;
      $('lobby-error').textContent = m.text;
      if (game) game.ui.addMessage(m.text, 'sys');
      break;
  }
}

function lobbyChat(m) {
  const log = $('lobby-chat');
  const d = document.createElement('div');
  if (m.system) { d.style.color = '#ffd75e'; d.textContent = m.text; }
  else {
    const n = document.createElement('b');
    n.style.color = D.COLORS[m.color]?.hex || '#fff';
    n.textContent = m.name + ': ';
    d.appendChild(n); d.appendChild(document.createTextNode(m.text));
  }
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

function renderLobby() {
  const L = lobby;
  $('lobby-title').textContent = L.local ? 'SKIRMISH SETUP' : 'NETWORK LOBBY';
  if (L.local) $('lobby-code').innerHTML = '';
  else {
    const srv = new URLSearchParams(location.search).get('server');
    const link = `${location.origin}${location.pathname}?room=${L.code}${srv ? '&server=' + encodeURIComponent(srv) : ''}`;
    $('lobby-code').innerHTML = `ROOM CODE: <b>${L.code}</b><br><span style="font-size:16px">SHARE CODE OR LINK: ${link}</span>`;
  }
  $('lobby-error').textContent = '';
  const tb = $('slots').querySelector('tbody');
  tb.innerHTML = '';
  L.slots.forEach((s, i) => {
    const mine = i === L.you;
    const editable = mine || (L.host && s.ai);
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    if (s.ai) {
      if (L.host) {
        const sel = document.createElement('select');
        for (const d of ['easy', 'normal', 'hard']) sel.add(new Option(`Computer (${d})`, d, false, d === s.difficulty));
        sel.onchange = () => conn.send({ t: 'slot', idx: i, patch: { difficulty: sel.value } });
        nameTd.appendChild(sel);
      } else nameTd.textContent = `Computer (${s.difficulty})`;
    } else {
      nameTd.textContent = s.name + (mine ? ' (you)' : '') + (s.connected ? '' : ' [disconnected]');
    }
    tr.appendChild(nameTd);

    const cTd = document.createElement('td');
    const csel = document.createElement('select');
    for (const fac of ['NATO', 'PACT']) {
      const og = document.createElement('optgroup');
      og.label = D.FACTIONS[fac].bloc;
      for (const [k, c] of Object.entries(D.COUNTRIES)) if (c.faction === fac) og.appendChild(new Option(c.name, k, false, k === s.country));
      csel.appendChild(og);
    }
    csel.disabled = !editable;
    csel.onchange = () => conn.send({ t: 'slot', idx: i, patch: { country: csel.value } });
    csel.onfocus = () => { $('country-desc').textContent = D.COUNTRIES[csel.value].desc; };
    cTd.appendChild(csel);
    tr.appendChild(cTd);

    const colTd = document.createElement('td');
    const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = D.COLORS[s.color].hex;
    colTd.appendChild(sw);
    const colSel = document.createElement('select');
    D.COLORS.forEach((c, ci) => {
      const taken = L.slots.some((o, oi) => oi !== i && o.color === ci);
      const o = new Option(c.name, ci, false, ci === s.color);
      o.disabled = taken;
      colSel.add(o);
    });
    colSel.disabled = !editable;
    colSel.onchange = () => conn.send({ t: 'slot', idx: i, patch: { color: Number(colSel.value) } });
    colTd.appendChild(colSel);
    tr.appendChild(colTd);

    const tTd = document.createElement('td');
    const tSel = document.createElement('select');
    tSel.add(new Option('None', 0, false, s.team === 0));
    for (let t = 1; t <= 4; t++) tSel.add(new Option(`Team ${t}`, t, false, s.team === t));
    tSel.disabled = !editable;
    tSel.onchange = () => conn.send({ t: 'slot', idx: i, patch: { team: Number(tSel.value) } });
    tTd.appendChild(tSel);
    tr.appendChild(tTd);

    const xTd = document.createElement('td');
    if (L.host && s.ai) {
      const b = document.createElement('button');
      b.textContent = '✕';
      b.onclick = () => conn.send({ t: 'removeSlot', idx: i });
      xTd.appendChild(b);
    }
    tr.appendChild(xTd);
    tb.appendChild(tr);
  });
  const me = L.slots[L.you];
  if (me) setTheme(D.COUNTRIES[me.country].faction);
  if (me) {
    const fac = D.FACTIONS[D.COUNTRIES[me.country].faction];
    $('country-desc').innerHTML = `<b>${D.COUNTRIES[me.country].name}</b> — ${D.COUNTRIES[me.country].desc}<br><span style="color:var(--ph-dim)">${fac.name.toUpperCase()}: ${fac.desc}</span>`;
  }
  $('set-credits').value = String(L.settings.credits);
  $('set-map').value = String(L.settings.mapSize);
  $('set-mapid').value = L.settings.map || 'random';
  const isRandom = !MAP_INDEX[L.settings.map];
  $('lbl-size').style.display = isRandom ? '' : 'none';
  $('lbl-seed').style.display = isRandom ? '' : 'none';
  renderMapInfo(L);
  if (document.activeElement !== $('set-seed')) $('set-seed').value = L.settings.seed;
  for (const id of ['set-credits', 'set-map', 'set-seed', 'set-mapid']) $(id).disabled = !L.host;
  $('btn-addai').disabled = !L.host || L.slots.length >= 4;
  $('btn-start').disabled = !L.host;
  $('btn-start').textContent = L.host ? 'LAUNCH' : 'AWAITING HOST';
  $('lobby-chat-input').style.display = L.local ? 'none' : '';
  $('lobby-chat').style.display = L.local ? 'none' : '';
}

// Lobby map preview: terrain in biome colors with numbered start positions.
let previewKey = '';
function renderMapInfo(L) {
  const def = MAP_INDEX[L.settings.map];
  const np = def ? def.players : Math.max(2, L.slots.length);
  const key = `${L.settings.map}|${L.settings.seed}|${L.settings.mapSize}|${np}`;
  const desc = $('map-desc');
  if (def) {
    const tooMany = L.slots.length > def.players;
    desc.innerHTML = `<div class="mt">${def.name.toUpperCase()} // ${def.year}</div><div class="ms">${def.place.toUpperCase()} · ${def.biome.toUpperCase()} · ${def.players} PLAYERS</div>${def.desc}` +
      (tooMany ? `<div style="color:var(--warn)">TOO MANY PLAYERS FOR THIS THEATER</div>` : '');
  } else {
    desc.innerHTML = `<div class="mt">RANDOM THEATER</div><div class="ms">PROCEDURAL · BIOME FROM SEED</div>A new battlefield is generated from the seed.`;
  }
  if (key === previewKey) return;
  previewKey = key;
  const map = createMap({ map: L.settings.map, seed: L.settings.seed, mapSize: L.settings.mapSize || (np > 2 ? 80 : 64) }, np);
  const B = BIOME[map.biome] || BIOME.temperate;
  const col = { [T.GRASS]: B.ground, [T.WATER]: B.water, [T.SAND]: B.sand, [T.ROCK]: B.rock, [T.TREE]: B.tree, [T.ICE]: B.ice, [T.RUIN]: '#2a2a28', [T.BRIDGE]: '#4a3a28' };
  const c = $('map-preview'), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  const n = map.w, sc = Math.min(c.width / (2 * n), c.height / n);
  const ox = c.width / 2, oy = (c.height - n * sc) / 2;
  const P = (x, y) => [ox + (x - y) * sc, oy + (x + y) * sc / 2];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const [px, py] = P(x, y);
    ctx.fillStyle = map.ore[y * n + x] ? '#94701f' : col[map.terrain[y * n + x]];
    ctx.fillRect(Math.floor(px - sc), Math.floor(py), Math.ceil(sc * 2), Math.ceil(sc));
  }
  ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  map.starts.forEach((s, i) => {
    const [px, py] = P(s.x, s.y);
    ctx.fillStyle = '#000'; ctx.fillRect(px - 6, py - 7, 12, 13);
    ctx.fillStyle = '#ffd25a'; ctx.fillText(String(i + 1), px, py + 4);
  });
}

function startGame(m) {
  stopGame();
  const state = new ClientState(m.setup, m.you, m.ore);
  const canvas = $('view');
  const renderer = new Renderer(canvas, state);
  show('game');
  setTheme(state.me.faction);
  $('sb-faction').textContent = `${D.FACTIONS[state.me.faction].name.toUpperCase()} / ${D.COUNTRIES[state.me.country].name.toUpperCase()}`;
  $('game-over').classList.add('hidden');
  $('game-menu').classList.add('hidden');
  $('messages').innerHTML = '';
  const ui = new GameUI(state, renderer, {
    sendCmd: cmd => conn && conn.send({ t: 'cmd', cmd }),
    sendChat: text => conn && conn.send({ t: 'chat', text }),
    onQuit: () => quitToMenu(),
    onSurrender: () => conn && conn.send({ t: 'surrender' }),
  });
  game = { state, renderer, ui, raf: 0 };
  if (DEBUG) window.__game = game;
  state.on('over', winners => showGameOver(winners));
  let last = performance.now();
  const loop = now => {
    if (!game || game.state !== state) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try { ui.frame(now, dt); } catch (err) { console.error(err); }
    game.raf = requestAnimationFrame(loop);
  };
  game.raf = requestAnimationFrame(loop);
  ui.addMessage('COMMANDER: DEPLOY MCV TO ESTABLISH BASE. [SELECT + D]', 'sys');
}

function showGameOver(winners) {
  const s = game.state;
  const won = winners.includes(s.you);
  $('go-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('go-title').style.color = won ? 'var(--ph)' : 'var(--warn)';
  const rows = s.players.map(p => `<tr><td style="color:${p.color}">${escapeHtml(p.name)}</td><td>${D.COUNTRIES[p.country].name}</td><td>${p.stats?.built ?? 0}</td><td>${p.stats?.killed ?? 0}</td><td>${p.stats?.lost ?? 0}</td></tr>`).join('');
  $('go-stats').innerHTML = `<table><tr><th>Player</th><th>Country</th><th>Built</th><th>Kills</th><th>Losses</th></tr>${rows}</table>`;
  $('game-over').classList.remove('hidden');
  import('./audio.js').then(a => a.speak(won ? 'Mission accomplished' : 'Mission failed'));
}

function escapeHtml(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

$('btn-go-lobby').onclick = () => {
  stopGame();
  if (lobby && conn) { renderLobby(); show('lobby'); } else show('menu');
};

function stopGame() {
  if (!game) return;
  cancelAnimationFrame(game.raf);
  game.ui.destroy();
  game = null;
}

function quitToMenu() {
  stopGame();
  if (conn) { conn.send({ t: 'leave' }); conn.close(); conn = null; }
  sessionStorage.removeItem('rts-session');
  session = null;
  lobby = null;
  show('menu');
}

// Reconnect to an in-progress online game after a page refresh.
if (session && !urlRoom) {
  $('code-input').value = session.code;
}
