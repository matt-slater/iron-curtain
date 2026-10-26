import { Room } from './shared/room.js';
import { SERVER_URL } from './config.js';

// Where the multiplayer server lives: ?server=... overrides config.js, otherwise the page's own host.
// Static hosts (GitHub Pages) have no server, so online play is unavailable there unless one is configured.
export function serverUrl() {
  const staticHost = location.protocol === 'file:' || location.hostname.endsWith('github.io');
  let url = new URLSearchParams(location.search).get('server') || (staticHost ? SERVER_URL : '');
  if (!url) {
    if (staticHost) return null;
    url = `${location.protocol}//${location.host}`;
  }
  return url.replace(/^http/, 'ws').replace(/\/+$/, '');
}

// WebSocket connection to the multiplayer server.
export class RemoteConnection {
  constructor(onMessage, onClose, url) {
    this.ws = new WebSocket(url);
    this.queue = [];
    this.ws.onopen = () => { for (const m of this.queue) this.ws.send(m); this.queue = []; };
    this.ws.onmessage = ev => { try { onMessage(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
    this.ws.onclose = () => onClose && onClose();
    this.ws.onerror = () => {};
  }
  send(m) {
    const s = JSON.stringify(m);
    if (this.ws.readyState === 1) this.ws.send(s); else this.queue.push(s);
  }
  close() { this.ws.onclose = null; this.ws.close(); }
}

// Runs the room + simulation inside the browser for single-player skirmish.
export class LocalConnection {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.room = new Room('LOCAL', (_id, msg) => this.onMessage(msg), { local: true });
  }
  send(m) {
    if (m.t === 'create') { this.room.join(1, m.name); return; }
    if (m.t === 'leave') { this.close(); return; }
    this.room.handle(1, m);
  }
  close() { this.room.destroy(); }
}
