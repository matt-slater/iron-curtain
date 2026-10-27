// Synthesized sound effects + speech "EVA" announcements.
let ctx = null, master = null, noiseBuf = null;
let muted = localStorage.getItem('muted') === '1';
const last = {};

function init() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}
window.addEventListener('pointerdown', init);
window.addEventListener('keydown', init);

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('muted', muted ? '1' : '0');
  if (muted && window.speechSynthesis) speechSynthesis.cancel();
  return muted;
}
export function isMuted() { return muted; }

function noise(dur, freq, q, vol, type = 'lowpass', sweepTo) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(f0, f1, dur, vol, type = 'sine') {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

const SOUNDS = {
  rifle: () => noise(0.08, 2500, 1, 0.25, 'bandpass'),
  mg: () => noise(0.06, 1800, 1, 0.22, 'bandpass'),
  sniper: () => { noise(0.15, 3000, 2, 0.4, 'bandpass'); tone(900, 200, 0.12, 0.08, 'square'); },
  cannon: () => { noise(0.35, 900, 1, 0.5, 'lowpass', 120); tone(120, 40, 0.3, 0.4); },
  rocket: () => noise(0.4, 600, 2, 0.25, 'bandpass', 2500),
  missile: () => noise(1.2, 300, 1, 0.35, 'bandpass', 1500),
  artillery: () => { noise(0.5, 500, 1, 0.6, 'lowpass', 80); tone(90, 30, 0.4, 0.5); },
  boom: () => { noise(0.9, 700, 1, 0.7, 'lowpass', 60); tone(70, 25, 0.6, 0.5); },
  bigboom: () => { noise(1.8, 500, 1, 0.9, 'lowpass', 40); tone(55, 20, 1.4, 0.7); },
  hit: () => noise(0.25, 1200, 1, 0.25, 'lowpass', 200),
  click: () => tone(1200, 900, 0.04, 0.12, 'square'),
  place: () => { tone(220, 110, 0.25, 0.3, 'triangle'); noise(0.3, 400, 1, 0.3); },
  cash: () => { tone(1400, 1400, 0.06, 0.08, 'triangle'); setTimeout(() => ctx && tone(1900, 1900, 0.08, 0.08, 'triangle'), 60); },
  error: () => tone(220, 180, 0.2, 0.15, 'square'),
  jet: () => { noise(2.5, 900, 0.6, 0.35, 'bandpass', 300); tone(160, 90, 2.2, 0.15, 'sawtooth'); },
  nuke: () => { noise(4, 400, 0.7, 1, 'lowpass', 30); tone(40, 15, 3.5, 0.8); },
  siren: () => { const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(400, t); o.frequency.linearRampToValueAtTime(800, t + 1); o.frequency.linearRampToValueAtTime(400, t + 2); g.gain.setValueAtTime(0.08, t); g.gain.linearRampToValueAtTime(0.001, t + 2.1); o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.2); },
};

export function play(name, minGap = 0.05) {
  if (muted || !ctx || !SOUNDS[name]) return;
  const now = ctx.currentTime;
  if (last[name] && now - last[name] < minGap) return;
  last[name] = now;
  try { SOUNDS[name](); } catch { /* ignore */ }
}

let lastSpeech = {};
export function speak(text) {
  if (muted || !window.speechSynthesis) return;
  const now = performance.now();
  if (lastSpeech[text] && now - lastSpeech[text] < 4000) return;
  lastSpeech[text] = now;
  if (speechSynthesis.speaking && speechSynthesis.pending) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05; u.pitch = 0.75; u.volume = 0.7;
  const voices = speechSynthesis.getVoices();
  const v = voices.find(v => /en-GB|en_GB/.test(v.lang) && /female|Serena|Kate|Martha/i.test(v.name)) || voices.find(v => /^en/.test(v.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
