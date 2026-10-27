import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from '../shared/room.js';
import { MAP_INDEX } from '../shared/maps.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.includes('\0')) return null;
  if (p === '/') p = '/index.html';
  const isShared = p.startsWith('/shared/');
  const base = isShared ? path.join(ROOT, 'shared') : path.join(ROOT, 'client');
  const full = path.normalize(path.join(base, isShared ? p.slice('/shared'.length) : p));
  if (!full.startsWith(base + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  let file;
  try { file = resolveFile(req.url); } catch { file = null; }
  if (!file) { res.writeHead(400); res.end('Bad request'); return; }
  const onRead = (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  };
  try { fs.readFile(file, onRead); } catch (err) { onRead(err); }
});

const wss = new WebSocketServer({ server, perMessageDeflate: { threshold: 512 }, maxPayload: 64 * 1024 });
const rooms = new Map();
const sockets = new Map();
let nextClient = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

// Cache serialized snapshot per message object so each tick is stringified once.
let lastObj = null, lastStr = '';
function send(clientId, msg) {
  const ws = sockets.get(clientId);
  if (!ws || ws.readyState !== 1) return;
  if (msg !== lastObj) { lastObj = msg; lastStr = JSON.stringify(msg); }
  ws.send(lastStr);
}

// ---------- room browser ----------
const browsers = new Set(); // clients looking at the online lobby
function roomList() {
  const out = [];
  for (const r of rooms.values()) {
    if (r.isEmpty()) continue;
    const host = r.slots.find(sl => sl.clientId === r.host) || r.humans[0];
    const def = MAP_INDEX[r.settings.map];
    out.push({
      code: r.code, host: host ? host.name : '?',
      humans: r.humans.filter(sl => sl.connected).length, ai: r.slots.filter(sl => sl.ai).length,
      max: def ? def.players : 4, map: def ? def.name : 'Random theater', status: r.game ? 'playing' : 'open',
    });
  }
  out.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.humans - a.humans);
  return out;
}
let lastList = '';
function pushRoomList(force = false) {
  const list = roomList(), key = JSON.stringify(list);
  if (!force && key === lastList) return;
  lastList = key;
  for (const id of browsers) send(id, { t: 'rooms', rooms: list, online: sockets.size });
}
setInterval(() => pushRoomList(), 2000);

wss.on('connection', ws => {
  const id = nextClient++;
  sockets.set(id, ws);
  let room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'browse' && !room) {
      browsers.add(id);
      send(id, { t: 'rooms', rooms: roomList(), online: sockets.size });
      return;
    }
    if (m.t === 'create' || m.t === 'join') browsers.delete(id);
    if (m.t === 'create' && !room) {
      room = new Room(makeCode(), send);
      rooms.set(room.code, room);
      room.join(id, m.name);
      pushRoomList(true);
    } else if (m.t === 'join' && !room) {
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) { send(id, { t: 'error', text: 'Room not found' }); return; }
      const res = r.join(id, m.name, m.token);
      if (res.error) { send(id, { t: 'error', text: res.error }); return; }
      room = r;
      pushRoomList(true);
    } else if (m.t === 'leave' && room) {
      room.leave(id);
      room = null;
      pushRoomList(true);
    } else if (room) {
      room.handle(id, m);
    }
  });
  ws.on('close', () => {
    sockets.delete(id);
    browsers.delete(id);
    if (room) { room.leave(id); pushRoomList(true); }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.isEmpty() && now - r.lastActive > 90_000) { r.destroy(); rooms.delete(code); }
  }
}, 15_000);

server.listen(PORT, () => console.log(`Iron Curtain RTS server on http://localhost:${PORT}`));
