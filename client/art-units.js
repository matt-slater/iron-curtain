// Faction-specific unit art.
// NATO: olive drab + woodland camo, angular wedge turrets, PASGT helmets.
// Warsaw Pact: Soviet green, low dome turrets, rear fuel drums, boat-hulled scouts, khaki uniforms.
import { UNITS } from './shared/data.js';
import { iso, shade, hash, prism, rect, octagon, local, barrel, shadow, turretFirst, cylinder, line, poly } from './art-core.js';
import { hasSprite, drawSprite, spriteRows, spritePivot } from './sprite-art.js';

const OUTLINE_SOFT = 'rgba(6,7,5,0.6)';

const NATO = { hull: '#6e7448', camoA: '#3b2f1f', camoB: '#1c1d16', camoC: '#3f4a27', track: '#1e1f1a' };
const PACT = { hull: '#5f6e46', dark: '#46523a', drum: '#3a3f2a', track: '#1d1e19', red: '#9e2a1e', rust: '#6b4a30' };

function camo(ctx, x, y, dir, L, W, z, seed) {
  const cols = [NATO.camoA, NATO.camoB, NATO.camoC];
  for (let i = 0; i < 4; i++) {
    const f = (hash(seed, i) - 0.5) * L * 1.5, q = (hash(i, seed) - 0.5) * W * 1.4;
    const r = 0.07 + hash(seed + i, 9) * 0.06;
    prismFlat(ctx, x, y, dir, [[f - r, q - r * 0.6], [f + r, q - r], [f + r * 0.7, q + r * 0.8], [f - r * 0.8, q + r * 0.5]], z, cols[i % 3]);
  }
}
function prismFlat(ctx, x, y, dir, pts, z, color) {
  const c = Math.cos(dir), s = Math.sin(dir);
  poly(ctx, pts.map(([f, q]) => iso(x + c * f - s * q, y + s * f + c * q, z)), color, null);
}

function tracks(ctx, x, y, dir, L, W, moving, time, color) {
  for (const sgn of [1, -1]) {
    const [tx, ty] = local(x, y, dir, 0, sgn * W * 0.78);
    prism(ctx, tx, ty, dir, rect(-L, L, W * 0.42), 0, 5, color);
    if (moving) {
      const ph = (time * 7) % 1;
      for (let i = 0; i < 4; i++) {
        const f = -L + (i + ph) * (2 * L / 4);
        const [px, py] = local(x, y, dir, f, sgn * W * 0.98);
        const [sx, sy] = iso(px, py, 3);
        ctx.fillStyle = 'rgba(140,130,100,0.35)'; ctx.fillRect(Math.round(sx), Math.round(sy), 1, 2);
      }
    }
  }
}

function natoTank(ctx, x, y, dir, tdir, color, time, moving, k, look) {
  const L = 0.46 * k, W = 0.34 * k;
  shadow(ctx, x, y, 0.5 * k);
  tracks(ctx, x, y, dir, L, W, moving, time, NATO.track);
  const merk = look === 'merkava', leo = look === 'leopard', abr = look === 'heavytank';
  // distinct paint: Abrams desert tan, Leopard dark green, Merkava sand-grey
  const hullC = merk ? '#6c6850' : abr ? '#857a58' : leo ? '#3f4a30' : NATO.hull;
  prism(ctx, x, y, dir, [[-L, -W * 1.05], [L * 0.75, -W * 1.05], [L * 1.02, -W * 0.7], [L * 1.02, W * 0.7], [L * 0.75, W * 1.05], [-L, W * 1.05]], 4, 9, hullC);
  if (!merk && !abr) camo(ctx, x, y, dir, L, W * 1.5, 9.1, leo ? 7 : 3);
  const tw = 0.24 * k, tl = (merk ? 0.36 : 0.3) * k;
  // Merkava: long, low, pointed wedge turret set well back
  // Leopard 2: tall boxy turret with an arrow-head spaced-armour front
  const turret = merk
    ? [[tl * 1.1, 0], [tl * 0.3, tw * 0.95], [-tl, tw], [-tl * 1.2, tw * 0.5], [-tl * 1.2, -tw * 0.5], [-tl, -tw], [tl * 0.3, -tw * 0.95]]
    : leo
      ? [[tl * 1.15, 0], [tl * 0.55, tw * 1.05], [-tl * 1.1, tw * 1.05], [-tl * 1.1, -tw * 1.05], [tl * 0.55, -tw * 1.05]]
      : [[tl, -tw * 0.45], [tl, tw * 0.45], [tl * 0.35, tw], [-tl, tw], [-tl * 1.15, tw * 0.6], [-tl * 1.15, -tw * 0.6], [-tl, -tw], [tl * 0.35, -tw]];
  const blen = 0.5 * k + (abr ? 0.08 : leo ? 0.2 : 0);
  const gun = () => { const e = barrel(ctx, x, y, tdir, 0.15 * k, blen, 13, 2, '#23241d'); ctx.fillStyle = '#23241d'; ctx.fillRect(Math.round(e[0] - 1), Math.round(e[1] - 1), 3, 3); };
  if (turretFirst(tdir)) gun();
  const tz = merk ? 13 : leo ? 16 : 14.5;
  prism(ctx, x, y, tdir, turret, 9, tz, shade(hullC, 1.08));
  if (leo) camo(ctx, x, y, tdir, tl, tw * 1.4, tz + 0.1, 13);
  else if (!merk && !abr) camo(ctx, x, y, tdir, tl, tw * 1.4, tz + 0.1, 11);
  // team colour band across the turret rear (keeps the turret shape and camo readable)
  prismFlat(ctx, x, y, tdir, rect(-tl * (leo ? 1.05 : 1.0), -tl * 0.45, tw * (leo ? 1.9 : 1.7)), tz + 0.2, shade(color, 0.95));
  if (merk) {
    // rear chain-ball skirt
    for (let i = -2; i <= 2; i++) { const [cx2, cy2] = local(x, y, tdir, -tl * 1.2, i * tw * 0.22); const [qx, qy] = iso(cx2, cy2, 10); ctx.fillStyle = '#1c1d18'; ctx.fillRect(Math.round(qx), Math.round(qy), 1, 3); }
  }
  if (!turretFirst(tdir)) gun();
  const [hx, hy] = local(x, y, tdir, -tl * 0.4, tw * 0.45);
  const [sx, sy] = iso(hx, hy, 15.5);
  ctx.fillStyle = '#2a2b22'; ctx.fillRect(Math.round(sx - 2), Math.round(sy - 2), 4, 3);
}

function pactTank(ctx, x, y, dir, tdir, color, time, moving, k, twin) {
  const L = 0.46 * k, W = 0.33 * k;
  shadow(ctx, x, y, 0.5 * k);
  if (twin) {
    tracks(ctx, x, y, dir, L, W * 1.05, moving, time, PACT.track);
    tracks(ctx, x, y, dir, L * 0.9, W * 0.55, false, time, PACT.track);
  } else tracks(ctx, x, y, dir, L, W, moving, time, PACT.track);
  const hull = twin
    ? [[-L * 0.85, -W * 1.1], [L * 0.7, -W * 1.15], [L * 1.08, -W * 0.5], [L * 1.08, W * 0.5], [L * 0.7, W * 1.15], [-L * 0.85, W * 1.1], [-L * 1.02, W * 0.5], [-L * 1.02, -W * 0.5]]
    : [[-L, -W * 1.05], [L * 0.85, -W * 1.05], [L * 1.04, -W * 0.45], [L * 1.04, W * 0.45], [L * 0.85, W * 1.05], [-L, W * 1.05]];
  prism(ctx, x, y, dir, hull, 3.5, 8, PACT.hull);
  // rear fuel drums
  for (const q of [-0.45, 0.45]) {
    const [dx, dy] = local(x, y, dir, -L * 0.88, q * W);
    cylinder(ctx, dx, dy, 0.055 * k, 8, 11, PACT.drum);
  }
  // reactive-armour bricks on the glacis
  for (let i = -2; i <= 2; i++) {
    const [bx, by] = local(x, y, dir, L * 0.82, i * W * 0.32);
    const [sx, sy] = iso(bx, by, 8.5);
    ctx.fillStyle = '#3c4630'; ctx.fillRect(Math.round(sx - 1), Math.round(sy - 1), 3, 2);
  }
  const r1 = 0.27 * k, r2 = 0.19 * k;
  const gun = () => {
    if (twin) {
      for (const q of [-0.07, 0.07]) { const [bx, by] = local(x, y, tdir, 0, q * k); barrel(ctx, bx, by, tdir, 0.15 * k, 0.5 * k, 13, 2, '#1e2019'); }
    } else barrel(ctx, x, y, tdir, 0.15 * k, 0.52 * k, 12.5, 2.5, '#1e2019');
  };
  if (turretFirst(tdir)) gun();
  prism(ctx, x, y, tdir, octagon(r1, 1.05), 8, 11.5, shade(PACT.hull, 1.05));
  prism(ctx, x, y, tdir, octagon(r2, 1.1), 11.5, 14, shade(PACT.hull, 1.12));
  // team colour band on the rear of the dome
  prismFlat(ctx, x, y, tdir, rect(-r2 * 1.0, -r2 * 0.2, r2 * 1.5), 14.2, shade(color, 0.95));
  if (!turretFirst(tdir)) gun();
  const [lx, ly] = local(x, y, tdir, r1 * 0.3, r1 * 0.9);
  const [sx, sy] = iso(lx, ly, 13);
  ctx.fillStyle = '#b8b4a0'; ctx.fillRect(Math.round(sx - 1), Math.round(sy - 1), 2, 2);
}

function wheels(ctx, x, y, dir, fs, W, r = 3.5) {
  for (const f of fs) for (const sgn of [1, -1]) {
    const [wx, wy] = local(x, y, dir, f, sgn * W * 0.52);
    const [sx, sy] = iso(wx, wy, 2.5);
    ctx.fillStyle = '#121310'; ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function natoJeep(ctx, x, y, dir, tdir, color) {
  const L = 0.34, W = 0.28;
  shadow(ctx, x, y, 0.34);
  wheels(ctx, x, y, dir, [-L * 0.65, L * 0.65], W);
  prism(ctx, x, y, dir, rect(-L, L, W), 3, 7, NATO.hull);
  prism(ctx, x, y, dir, rect(L * 0.35, L, W * 0.95), 7, 8.5, shade(NATO.hull, 1.05));
  // open cabin + windshield
  prismFlat(ctx, x, y, dir, rect(-L * 0.6, L * 0.25, W * 0.8), 7.1, '#22231c');
  const [w1x, w1y] = local(x, y, dir, L * 0.3, -W * 0.45), [w2x, w2y] = local(x, y, dir, L * 0.3, W * 0.45);
  line(ctx, iso(w1x, w1y, 12), iso(w2x, w2y, 12), '#8aa0a8', 2);
  prismFlat(ctx, x, y, dir, rect(-L * 0.95, -L * 0.62, W * 0.9), 7.2, shade(color, 0.85));
  // pintle MG
  const [px, py] = local(x, y, dir, -L * 0.25, 0);
  line(ctx, iso(px, py, 7), iso(px, py, 13), '#1c1d18', 2);
  barrel(ctx, px, py, tdir, 0, 0.26, 13, 2, '#1c1d18');
  const [sx, sy] = iso(...local(x, y, dir, -L * 1.02, 0), 7);
  ctx.fillStyle = '#121310'; ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
}

function pactScout(ctx, x, y, dir, tdir, color, apc) {
  const L = apc ? 0.52 : 0.4, W = apc ? 0.38 : 0.32;
  shadow(ctx, x, y, apc ? 0.48 : 0.4);
  wheels(ctx, x, y, dir, apc ? [-L * 0.7, -L * 0.25, L * 0.2, L * 0.62] : [-L * 0.6, L * 0.55], W, apc ? 3.5 : 4);
  const hull = [[-L, -W * 0.5], [L * 0.45, -W * 0.5], [L, -W * 0.18], [L, W * 0.18], [L * 0.45, W * 0.5], [-L, W * 0.5]];
  prism(ctx, x, y, dir, hull, 3, 8, PACT.hull);
  prism(ctx, x, y, dir, [[-L * 0.85, -W * 0.38], [L * 0.35, -W * 0.38], [L * 0.6, -W * 0.15], [L * 0.6, W * 0.15], [L * 0.35, W * 0.38], [-L * 0.85, W * 0.38]], 8, 11, shade(PACT.hull, 1.06));
  prismFlat(ctx, x, y, dir, rect(-L * 0.8, -L * 0.45, W * 0.6), 11.1, shade(color, 0.85));
  const gun = () => barrel(ctx, x, y, tdir, 0.05, apc ? 0.34 : 0.3, 14, 2, '#1c1d18');
  if (turretFirst(tdir)) gun();
  prism(ctx, x, y, tdir, octagon(apc ? 0.11 : 0.1), 11, 15, shade(PACT.hull, 1.15));
  if (!turretFirst(tdir)) gun();
  if (apc) {
    const [sx, sy] = iso(...local(x, y, dir, L * 0.1, W * 0.5), 6);
    ctx.fillStyle = '#e8e2d0'; ctx.fillRect(Math.round(sx - 2), Math.round(sy - 2), 4, 3);
    ctx.fillStyle = PACT.red; ctx.fillRect(Math.round(sx - 2), Math.round(sy), 4, 1);
  }
}

function natoArty(ctx, x, y, dir, tdir, color, time, moving) {
  const L = 0.48, W = 0.34;
  shadow(ctx, x, y, 0.5);
  tracks(ctx, x, y, dir, L, W, moving, time, NATO.track);
  prism(ctx, x, y, dir, rect(-L, L, W * 2.05), 4, 8, NATO.hull);
  camo(ctx, x, y, dir, L, W * 1.6, 8.1, 21);
  const gun = () => barrel(ctx, x, y, tdir, 0.2, 0.8, 16, 3, '#23241d');
  if (turretFirst(tdir)) gun();
  prism(ctx, x, y, tdir, rect(-0.36, 0.26, 0.48), 8, 18, shade(NATO.hull, 1.08), shade(color, 0.85));
  if (!turretFirst(tdir)) gun();
}

function truck(ctx, x, y, dir, L, W, cabC, bodyC) {
  wheels(ctx, x, y, dir, [-L * 0.7, -L * 0.3, L * 0.65], W, 4.5);
  prism(ctx, x, y, dir, rect(-L, L, W), 4, 8, shade(bodyC, 0.7));
  prism(ctx, x, y, dir, [[L * 0.45, -W * 0.48], [L * 0.92, -W * 0.48], [L, -W * 0.3], [L, W * 0.3], [L * 0.92, W * 0.48], [L * 0.45, W * 0.48]], 8, 17, cabC, shade(cabC, 1.1));
  const [wx, wy] = local(x, y, dir, L * 0.97, 0);
  const [sx, sy] = iso(wx, wy, 14);
  ctx.fillStyle = '#5b7482'; ctx.fillRect(Math.round(sx - 3), Math.round(sy - 2), 6, 3);
}

function bigVehicle(ctx, look, x, y, dir, tdir, color, faction, time, flags, cargo) {
  const pactF = faction === 'PACT';
  const big = look === 'mcv' || look === 'harvester';
  const L = big ? 0.62 : 0.52, W = big ? 0.5 : 0.36;
  shadow(ctx, x, y, big ? 0.62 : 0.5);
  const cab = pactF ? PACT.hull : look === 'harvester' ? '#7b7154' : NATO.hull;
  const body = pactF ? PACT.rust : look === 'harvester' ? '#6f6650' : '#5d604a';
  if (look === 'missile') {
    tracks(ctx, x, y, dir, L, W * 0.9, flags & 2, time, NATO.track);
    prism(ctx, x, y, dir, rect(-L, L, W * 1.8), 4, 9, NATO.hull);
    camo(ctx, x, y, dir, L, W * 1.3, 9.1, 31);
    prismFlat(ctx, x, y, dir, rect(-L * 0.9, -L * 0.6, W * 1.2), 9.2, shade(color, 0.85));
    const [bx, by] = local(x, y, dir, -L * 0.55, 0);
    const e = barrel(ctx, bx, by, dir, 0, 0.85, 15, 6, '#b3ae9c');
    ctx.fillStyle = '#8c2a1a'; ctx.fillRect(Math.round(e[0] - 2), Math.round(e[1] - 2), 4, 4);
    return;
  }
  truck(ctx, x, y, dir, L, W, cab, body);
  if (look === 'harvester') {
    prism(ctx, x, y, dir, rect(-L * 0.95, L * 0.4, W * 0.95), 8, 18, body, shade(color, 0.8));
    if (pactF) {
      for (let i = 0; i < 4; i++) { const [rx, ry] = local(x, y, dir, -L * 0.8 + i * L * 0.35, W * 0.48); line(ctx, iso(rx, ry, 8), iso(rx, ry, 18), 'rgba(20,14,8,0.6)'); }
      // War Miner roof machine gun
      const [mx, my] = local(x, y, dir, L * 0.7, 0);
      line(ctx, iso(mx, my, 17), iso(mx, my, 21), '#1c1d18', 2);
      barrel(ctx, mx, my, tdir, 0, 0.28, 21, 2, '#1c1d18');
    }
    if (cargo > 0) {
      const f = Math.min(1, cargo / 700);
      prism(ctx, x, y, dir, rect(-L * 0.85, L * 0.3, W * 0.78), 18, 18 + 5 * f, '#94701f', '#bb9430');
    }
    if (flags & 4) {
      const [sx, sy] = iso(...local(x, y, dir, L * 1.1, 0), 2);
      ctx.fillStyle = 'rgba(150,120,60,0.45)';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(sx + Math.sin(time * 9 + i * 2) * 6, sy - 3 - i * 2, 3 + i, 0, Math.PI * 2); ctx.fill(); }
    }
  } else if (look === 'mcv') {
    prism(ctx, x, y, dir, rect(-L * 0.95, L * 0.4, W * 0.95), 8, 20, body, shade(color, 0.8));
    prism(ctx, x, y, dir, rect(-L * 0.6, L * 0.1, W * 0.5), 20, 25, pactF ? '#7a4a26' : '#b08a2a');
    barrel(ctx, x, y, dir + Math.PI, 0.1, 0.5, 26, 3, pactF ? '#7a4a26' : '#b08a2a');
    if (pactF) { const [sx, sy] = iso(...local(x, y, dir, -L * 0.3, W * 0.48), 14); ctx.fillStyle = PACT.red; ctx.fillRect(Math.round(sx - 2), Math.round(sy - 2), 4, 4); }
  } else if (look === 'grad') {
    prismFlat(ctx, x, y, dir, rect(-L * 0.95, L * 0.35, W * 0.9), 8.2, shade(color, 0.8));
    for (let r = 0; r < 3; r++) for (let q = -1; q <= 1; q++) {
      const [ox, oy] = local(x, y, dir, -L * 0.7, q * 0.09);
      barrel(ctx, ox, oy, dir, 0, 0.55, 12 + r * 3 + 3, 2, r === 2 ? '#3a4130' : '#2c3224');
    }
  }
}

function g6(ctx, x, y, dir, tdir, color) {
  const L = 0.56, W = 0.4;
  shadow(ctx, x, y, 0.55);
  wheels(ctx, x, y, dir, [-L * 0.7, -L * 0.1, L * 0.6], W, 4.5);
  const hull = '#857452';
  prism(ctx, x, y, dir, [[-L, -W * 0.5], [L * 0.6, -W * 0.5], [L, -W * 0.25], [L, W * 0.25], [L * 0.6, W * 0.5], [-L, W * 0.5]], 3, 9, hull);
  prism(ctx, x, y, dir, rect(L * 0.45, L * 0.92, W * 0.8), 9, 13, shade(hull, 1.05), shade(hull, 1.15));
  const [tx, ty] = local(x, y, dir, -L * 0.35, 0);
  const gun = () => barrel(ctx, tx, ty, tdir, 0.15, 0.9, 16, 3, '#2a2820');
  if (turretFirst(tdir)) gun();
  prism(ctx, tx, ty, tdir, rect(-0.26, 0.22, 0.4), 9, 18, shade(hull, 1.08), shade(color, 0.85));
  if (!turretFirst(tdir)) gun();
}

function shilka(ctx, x, y, dir, tdir, color, time, moving) {
  const L = 0.46, W = 0.33;
  shadow(ctx, x, y, 0.5);
  tracks(ctx, x, y, dir, L, W, moving, time, PACT.track);
  prism(ctx, x, y, dir, rect(-L, L * 1.02, W * 2.05), 3.5, 8, PACT.hull);
  const guns = () => {
    for (const [q, z] of [[-0.06, 14], [0.06, 14], [-0.06, 16.5], [0.06, 16.5]]) {
      const [bx, by] = local(x, y, tdir, 0.1, q);
      barrel(ctx, bx, by, tdir, 0.1, 0.4, z, 1, '#1a1b16');
    }
  };
  if (turretFirst(tdir)) guns();
  prism(ctx, x, y, tdir, rect(-0.3, 0.26, 0.56), 8, 15, shade(PACT.hull, 1.08), shade(color, 0.85));
  if (!turretFirst(tdir)) guns();
  // folding radar dish at the turret rear
  const [rx, ry] = local(x, y, tdir, -0.26, 0);
  const [sx, sy] = iso(rx, ry, 19);
  line(ctx, iso(rx, ry, 15), [sx, sy], '#2a2a24', 1);
  ctx.fillStyle = '#5a6248'; ctx.beginPath(); ctx.ellipse(sx, sy - 2, 5 + Math.abs(Math.sin(time * 3)) * 2, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = OUTLINE_SOFT; ctx.stroke();
}

function scud(ctx, x, y, dir, color) {
  const L = 0.7, W = 0.42;
  shadow(ctx, x, y, 0.66);
  wheels(ctx, x, y, dir, [-L * 0.75, -L * 0.35, L * 0.25, L * 0.62], W, 4.5);
  truck(ctx, x, y, dir, L, W, PACT.hull, PACT.dark);
  prismFlat(ctx, x, y, dir, rect(-L * 0.95, L * 0.4, W * 0.9), 8.2, shade(color, 0.8));
  // erected missile
  const [bx, by] = local(x, y, dir, -L * 0.85, 0);
  const tip = barrel(ctx, bx, by, dir, 0, 1.15, 16, 7, '#a8a28c');
  line(ctx, iso(...local(x, y, dir, -L * 0.85, 0), 16), iso(...local(x, y, dir, -L * 0.85 + 0.25, 0), 16), '#5c1d16', 7);
  ctx.fillStyle = '#5c1d16'; ctx.beginPath(); ctx.arc(tip[0], tip[1], 3.5, 0, Math.PI * 2); ctx.fill();
}

// ---------- aircraft (drawn at local height; the renderer lifts them to their altitude) ----------
function mirrorQ(pts) { return pts.concat(pts.slice().reverse().map(([f, q]) => [f, -q])); }

function jet(ctx, x, y, dir, color, time, kind) {
  const a10 = kind === 'a10';
  const body = a10 ? '#626a64' : '#7a7050', dark = shade(body, 0.7);
  // wings
  const wing = a10
    ? [[0.12, -0.08], [0.08, -0.62], [-0.08, -0.62], [-0.1, -0.08]]
    : [[0.2, -0.07], [-0.12, -0.55], [-0.24, -0.55], [-0.14, -0.07]];
  for (const sgn of [1, -1]) prism(ctx, x, y, dir, wing.map(([f, q]) => [f, q * sgn]), 5, 6.5, body, shade(body, 1.1));
  if (!a10) prismFlat(ctx, x, y, dir, [[-0.1, -0.3], [-0.2, -0.45], [-0.24, -0.4], [-0.14, -0.28]], 6.6, '#5a5232');
  // tailplane
  prism(ctx, x, y, dir, mirrorQ([[-0.42, 0.04], [-0.5, 0.26], [-0.58, 0.26], [-0.56, 0.04]]), 6, 7, body);
  // fuselage
  prism(ctx, x, y, dir, [[0.62, 0], [0.45, -0.07], [-0.5, -0.06], [-0.6, 0], [-0.5, 0.06], [0.45, 0.07]], 4, 8, body, shade(body, 1.12));
  if (a10) {
    // twin engine pods high on the rear fuselage and twin tail fins
    for (const sgn of [1, -1]) {
      const [ex, ey] = local(x, y, dir, -0.25, 0.14 * sgn);
      prism(ctx, ex, ey, dir, rect(-0.14, 0.1, 0.1), 8, 11, dark, shade(dark, 1.2));
      const [fx, fy] = local(x, y, dir, -0.55, 0.25 * sgn);
      prism(ctx, fx, fy, dir, rect(-0.08, 0.04, 0.03), 7, 14, body, shade(color, 0.95));
    }
    // nose gun
    barrel(ctx, x, y, dir, 0.55, 0.12, 6, 2, '#1a1a16');
  } else {
    // single fin, intakes beside the cockpit
    const [fx, fy] = local(x, y, dir, -0.5, 0);
    prism(ctx, fx, fy, dir, [[0.08, 0], [-0.1, -0.02], [-0.1, 0.02]], 8, 15, body, shade(color, 0.95));
    for (const sgn of [1, -1]) { const [ix, iy] = local(x, y, dir, 0.18, 0.09 * sgn); prism(ctx, ix, iy, dir, rect(-0.15, 0.05, 0.06), 5, 8, dark); }
  }
  // canopy
  const [cx, cy] = local(x, y, dir, 0.4, 0);
  prism(ctx, cx, cy, dir, rect(-0.08, 0.08, 0.07), 8, 9.5, '#3e5462', '#86a0a8');
  // team colour band across the wing roots
  prismFlat(ctx, x, y, dir, rect(-0.06, 0.06, 0.4), 6.7, shade(color, 0.95));
}

function heli(ctx, x, y, dir, color, time, kind) {
  const hind = kind === 'hind';
  const body = hind ? '#5c6244' : '#4e5634';
  const L = hind ? 0.5 : 0.42, W = hind ? 0.17 : 0.11;
  // tail boom and tail rotor
  const [tx, ty] = local(x, y, dir, -L - 0.1, 0);
  prism(ctx, tx, ty, dir, rect(-0.42, 0.12, 0.06), 7, 9, body);
  const [rx, ry] = local(x, y, dir, -L - 0.48, 0);
  prism(ctx, rx, ry, dir, rect(-0.04, 0.04, 0.03), 7, 15, body, shade(color, 0.95));
  // stub wings with rocket pods
  for (const sgn of [1, -1]) {
    prism(ctx, x, y, dir, [[0.06, 0], [0.04, (hind ? 0.42 : 0.3) * sgn], [-0.08, (hind ? 0.42 : 0.3) * sgn], [-0.1, 0]], 6, 7, body);
    const [px2, py2] = local(x, y, dir, -0.02, (hind ? 0.34 : 0.24) * sgn);
    prism(ctx, px2, py2, dir, rect(-0.1, 0.12, 0.08), 4, 6.5, '#2c2e26', '#3a3c32');
  }
  // fuselage
  prism(ctx, x, y, dir, [[L + 0.08, 0], [L, -W * 0.8], [-L, -W], [-L - 0.05, 0], [-L, W], [L, W * 0.8]], 4, hind ? 12 : 9, body, shade(body, 1.1));
  if (hind) {
    // stepped double bubble canopies
    for (const f of [0.38, 0.22]) { const [cx2, cy2] = local(x, y, dir, f, 0); prism(ctx, cx2, cy2, dir, rect(-0.07, 0.07, 0.1), 11, 13, '#3e5462', '#86a0a8'); }
    prismFlat(ctx, x, y, dir, [[0.1, -0.12], [-0.3, -0.16], [-0.3, -0.05], [0.05, -0.04]], 12.1, '#7a6e48');
  } else {
    const [cx2, cy2] = local(x, y, dir, 0.25, 0);
    prism(ctx, cx2, cy2, dir, rect(-0.12, 0.12, 0.08), 8, 11, '#3e5462', '#86a0a8');
  }
  prismFlat(ctx, x, y, dir, rect(-L * 0.9, -L * 0.6, W * 1.6), (hind ? 12 : 9) + 0.1, shade(color, 0.95));
  heliRotor(ctx, x, y, time, hind);
}

// Main rotor drawn live over the body (also used on top of rendered helicopter sprites).
function heliRotor(ctx, x, y, time, hind) {
  const rz = hind ? 16 : 13, R = hind ? 0.68 : 0.58;
  const [hx, hy] = iso(x, y, rz);
  line(ctx, iso(x, y, hind ? 12 : 9), [hx, hy], '#1c1d18', 2);
  ctx.fillStyle = 'rgba(30,32,28,0.22)';
  ctx.beginPath(); ctx.ellipse(hx, hy, R * HWs, R * HHs, 0, 0, Math.PI * 2); ctx.fill();
  const blades = hind ? 5 : 2, spin = time * 28;
  for (let i = 0; i < blades; i++) {
    const a = spin + i * Math.PI * 2 / blades;
    const [bx, by] = iso(x + Math.cos(a) * R, y + Math.sin(a) * R, rz);
    line(ctx, [hx, hy], [bx, by], 'rgba(20,20,18,0.85)', 2);
  }
}
const HWs = 32 * Math.SQRT2, HHs = 16 * Math.SQRT2;

function vulcanAA(ctx, x, y, dir, tdir, color, time, moving) {
  const L = 0.45, W = 0.32;
  shadow(ctx, x, y, 0.45);
  tracks(ctx, x, y, dir, L, W, moving, time, NATO.track);
  prism(ctx, x, y, dir, [[-L, -W], [L * 0.7, -W], [L, -W * 0.5], [L, W * 0.5], [L * 0.7, W], [-L, W]], 3, 10, NATO.hull);
  camo(ctx, x, y, dir, L, W * 1.3, 10.1, 41);
  const guns = () => {
    for (let i = -1; i <= 1; i++) { const [bx, by] = local(x, y, tdir, 0.05, i * 0.035); barrel(ctx, bx, by, tdir, 0.1, 0.42, 15 + Math.abs(i), 1, '#1a1b16'); }
  };
  if (turretFirst(tdir)) guns();
  prism(ctx, x, y, tdir, rect(-0.2, 0.16, 0.34), 10, 15, shade(NATO.hull, 1.08));
  prismFlat(ctx, x, y, tdir, rect(-0.2, -0.08, 0.34), 15.1, shade(color, 0.95));
  if (!turretFirst(tdir)) guns();
  // range-only radar dish on the side
  const [dx, dy] = local(x, y, tdir, -0.05, 0.22);
  const [sx, sy] = iso(dx, dy, 18);
  ctx.fillStyle = '#8a8a7e'; ctx.beginPath(); ctx.ellipse(sx, sy, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
}

function strelaAA(ctx, x, y, dir, tdir, color) {
  pactScout(ctx, x, y, dir, dir, color, false);
  // quad missile box launcher raised on the roof
  const box = () => {
    for (const q of [-0.07, 0.07]) {
      const [bx, by] = local(x, y, tdir, -0.05, q);
      prism(ctx, bx, by, tdir, rect(-0.2, 0.22, 0.06), 16, 19, '#56603e', '#6a7450');
    }
  };
  line(ctx, iso(x, y, 11), iso(x, y, 16), '#1c1d18', 2);
  box();
}

export function drawVehicle(ctx, look, x, y, dir, tdir, color, faction, time, flags = 0, cargo = 0) {
  const key = `${look}_${faction}`;
  if (hasSprite(key)) {
    drawSprite(ctx, key, 'body', x, y, dir, color);
    if (spriteRows(key).turret) {
      const [tx, ty] = local(x, y, dir, spritePivot(key), 0);
      drawSprite(ctx, key, 'turret', tx, ty, tdir, color);
    }
    if (look === 'cobra' || look === 'hind') heliRotor(ctx, x, y, time, look === 'hind');
    return;
  }
  const moving = flags & 2;
  const pactF = faction === 'PACT';
  switch (look) {
    case 'tank': return pactF ? pactTank(ctx, x, y, dir, tdir, color, time, moving, 1, false) : natoTank(ctx, x, y, dir, tdir, color, time, moving, 1, look);
    case 'heavytank': return natoTank(ctx, x, y, dir, tdir, color, time, moving, 1.12, look);
    case 'leopard': return natoTank(ctx, x, y, dir, tdir, color, time, moving, 1.1, look);
    case 'merkava': return natoTank(ctx, x, y, dir, tdir, color, time, moving, 1.18, look);
    case 'a10': case 'su25': return jet(ctx, x, y, dir, color, time, look);
    case 'cobra': case 'hind': return heli(ctx, x, y, dir, color, time, look);
    case 'vulcan': return vulcanAA(ctx, x, y, dir, tdir, color, time, moving);
    case 'strela': return strelaAA(ctx, x, y, dir, tdir, color);
    case 'g6': return g6(ctx, x, y, dir, tdir, color);
    case 'shilka': return shilka(ctx, x, y, dir, tdir, color, time, moving);
    case 'scud': return scud(ctx, x, y, dir, color);
    case 'superheavy': return pactTank(ctx, x, y, dir, tdir, color, time, moving, 1.3, true);
    case 'jeep': return pactF ? pactScout(ctx, x, y, dir, tdir, color, false) : natoJeep(ctx, x, y, dir, tdir, color);
    case 'apc': return pactScout(ctx, x, y, dir, tdir, color, true);
    case 'arty': return natoArty(ctx, x, y, dir, tdir, color, time, moving);
    default: return bigVehicle(ctx, look, x, y, dir, tdir, color, faction, time, flags, cargo);
  }
}

// ---------- infantry ----------
const INF = {
  NATO: { uniform: '#646c42', helmet: '#4c5834', skin: '#c49a78', camo: '#2f2a1c', gun: '#141412' },
  PACT: { uniform: '#867a50', helmet: '#5e6c44', skin: '#c49a78', camo: '#544a30', gun: '#141412' },
};

function px(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

function bagRing(ctx, sx, sy, from, to, deploying) {
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const a = from + (to - from) * i / n;
    const bx = Math.round(sx + Math.cos(a) * 10), by = Math.round(sy + Math.sin(a) * 5) - (deploying ? 0 : 1);
    ctx.fillStyle = '#4a4130'; ctx.fillRect(bx - 3, by - 3, 7, 4);
    ctx.fillStyle = '#7d6e4c'; ctx.fillRect(bx - 3, by - 4, 6, 3);
    ctx.fillStyle = '#98875e'; ctx.fillRect(bx - 2, by - 4, 3, 1);
  }
}

// Infantry; deployed units crouch behind a sandbag ring (RA2 GI style).
export function drawInfantry(ctx, look, x, y, dir, color, faction, time, moving, firing, deployed = false, deploying = false) {
  if (!deployed && !deploying) return drawInfantryBody(ctx, look, x, y, dir, color, faction, time, moving, firing);
  const [sx0, sy0] = iso(x, y);
  const sx = Math.round(sx0), sy = Math.round(sy0);
  if (deployed) bagRing(ctx, sx, sy, Math.PI, Math.PI * 2, deploying);
  ctx.save();
  ctx.translate(0, deployed ? 4 : 2);
  drawInfantryBody(ctx, look, x, y, dir, color, faction, time, false, firing);
  ctx.restore();
  if (deployed) bagRing(ctx, sx, sy, 0, Math.PI, deploying);
}

function drawInfantryBody(ctx, look, x, y, dir, color, faction, time, moving, firing) {
  const key = `${look}_${faction}`;
  if (hasSprite(key)) {
    const row = firing ? 'body.fire' : moving ? `body.walk${Math.floor(time * 8 + x * 3.7 + y * 2.3) & 3}` : 'body.idle';
    drawSprite(ctx, key, row, x, y, dir, color);
    return;
  }
  const [sx0, sy0] = iso(x, y);
  const sx = Math.round(sx0), sy = Math.round(sy0);
  ctx.fillStyle = 'rgba(8,12,18,0.24)';
  ctx.beginPath(); ctx.ellipse(sx + 1, sy, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  const pal = INF[faction] || INF.NATO;
  const pactF = faction === 'PACT';
  const dx = Math.cos(dir) - Math.sin(dir), dy = (Math.cos(dir) + Math.sin(dir)) * 0.5;
  const dl = Math.hypot(dx, dy) || 1;
  const fx = dx / dl, fy = dy / dl;
  const step = moving ? Math.round(Math.sin(time * 14 + x * 3) * 2) : 0;
  let uni = pal.uniform, hat = pal.helmet;
  if (look === 'engineer') { uni = pactF ? '#5a5a52' : '#7a6c4c'; hat = pactF ? '#c46a2a' : '#c9a227'; }
  if (look === 'commando') { uni = '#22241f'; hat = '#141412'; }
  if (look === 'spy') { uni = '#55534c'; hat = '#2a2925'; }
  if (look === 'sapper') { uni = '#4f5432'; hat = '#8c2a1a'; }
  if (look === 'marine') { uni = '#3e4a2a'; hat = '#2a3420'; }
  if (look === 'mujahid') { uni = '#6e624c'; hat = '#a39478'; }
  if (look === 'kpa') { uni = '#6a6444'; hat = '#5a4630'; }
  if (look === 'vc') { uni = '#1c1c1e'; hat = '#b3a070'; }
  const s = look === 'commando' ? 1.1 : 1;
  // legs
  px(ctx, sx - 3, sy - 7, 2, 7 + step * 0.5, shade(uni, 0.55));
  px(ctx, sx + 1, sy - 7, 2, 7 - step * 0.5, shade(uni, 0.55));
  px(ctx, sx - 3, sy - 1 + step * 0.5, 2, 1, '#141412');
  px(ctx, sx + 1, sy - 1 - step * 0.5, 2, 1, '#141412');
  if (look === 'spy') px(ctx, sx - 4, sy - 9, 8, 5, shade(uni, 0.8));
  if (look === 'sapper' || look === 'engineer' || look === 'atinf') px(ctx, sx - fx * 3 - 3, sy - 14 * s, 6, 7, look === 'sapper' ? '#7a2a1a' : look === 'engineer' ? '#8a7a3a' : '#3a3a30');
  // torso
  px(ctx, sx - 3 * s, sy - 14 * s, 6 * s, 8 * s, uni);
  if (!pactF && (look === 'inf' || look === 'atinf' || look === 'marine')) { px(ctx, sx - 2, sy - 12, 2, 2, pal.camo); px(ctx, sx + 1, sy - 9, 2, 2, pal.camo); }
  if (look === 'marine') { px(ctx, sx + 1, sy - 13, 2, 2, '#c9a227'); px(ctx, sx - 3, sy - 9, 6, 1, '#2a2a22'); }
  if (look === 'mujahid') { px(ctx, sx - 4, sy - 9, 8, 4, shade(uni, 0.85)); px(ctx, sx - 3, sy - 12, 1, 5, '#3a2a1c'); }
  if (look === 'vc') px(ctx, sx - 3, sy - 10, 6, 1, '#3a3422');
  if (look === 'sapper') for (let i = 0; i < 3; i++) px(ctx, sx - 3 + i * 2, sy - 11, 1, 3, '#a83a22');
  // team colour shoulder band across the whole torso so allegiance reads at a glance
  px(ctx, sx - 3 * s, sy - 13 * s, 6 * s, 2, color);
  // head
  px(ctx, sx - 2, sy - 18 * s, 4, 4, pal.skin);
  if (look === 'commando') px(ctx, sx - 2, sy - 17 * s, 4, 2, '#141412');
  // headgear
  if (look === 'spy') { px(ctx, sx - 4, sy - 18 * s, 8, 1, hat); px(ctx, sx - 2, sy - 20 * s, 4, 2, hat); }
  else if (look === 'vc') { px(ctx, sx - 5, sy - 18, 10, 1, hat); px(ctx, sx - 3, sy - 19, 6, 1, hat); px(ctx, sx - 1, sy - 20, 2, 1, hat); }
  else if (look === 'mujahid') { px(ctx, sx - 3, sy - 20, 6, 2, hat); px(ctx, sx - 4, sy - 19, 8, 1, shade(hat, 0.8)); px(ctx, sx - 2, sy - 15, 4, 2, '#2a1e14'); }
  else if (look === 'kpa') { px(ctx, sx - 3, sy - 20, 6, 3, hat); px(ctx, sx - 4, sy - 18, 1, 3, hat); px(ctx, sx + 3, sy - 18, 1, 3, hat); px(ctx, sx - 1, sy - 19, 1, 1, '#ad3a22'); }
  else if (look === 'marine') { px(ctx, sx - 3, sy - 20, 6, 3, hat); px(ctx, sx - 4, sy - 18, 8, 1, shade(hat, 0.8)); }
  else if (look === 'sapper') px(ctx, sx - 3, sy - 20 * s, 5, 2, hat);
  else if (look === 'commando') px(ctx, sx - 3, sy - 20 * s, 6, 2, '#5c1d16');
  else if (pactF && look !== 'engineer') { px(ctx, sx - 3, sy - 20, 6, 3, hat); px(ctx, sx - 1, sy - 19, 1, 1, '#ad3a22'); }
  else { px(ctx, sx - 3, sy - 20 * s, 6, 3, hat); px(ctx, sx - 4, sy - 18 * s, 8, 1, shade(hat, 0.8)); }
  // weapon
  if (look === 'engineer' || look === 'sapper') {
    if (look === 'engineer') px(ctx, sx + fx * 4 - 1, sy - 9, 3, 3, '#5a4a30');
    return;
  }
  const ox = sx + fx * 2, oy = sy - 11 * s;
  if (look === 'manpads') {
    // shoulder-launched SAM pointed up at the sky
    ctx.strokeStyle = '#141412'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(ox - fx * 5, oy - 2 - fy * 5); ctx.lineTo(ox + fx * 6, oy - 11 + fy * 6); ctx.stroke();
    ctx.strokeStyle = pactF ? '#56603e' : '#4a5232'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ox - fx * 4, oy - 2 - fy * 4); ctx.lineTo(ox + fx * 5, oy - 10 + fy * 5); ctx.stroke();
    px(ctx, ox + fx * 2 - 1, oy - 7 + fy * 2, 3, 2, '#8a8a7a');
    ctx.lineWidth = 1;
    if (firing) px(ctx, ox - fx * 6 - 1, oy - 1 - fy * 6, 3, 3, '#ffd25a');
    return;
  }
  if (look === 'atinf' || look === 'mujahid') {
    const rpgStyle = pactF || look === 'mujahid';
    const tube = rpgStyle ? '#3c4430' : '#4a5232';
    // shoulder-fired launcher: long thick tube resting on the shoulder, clearly unlike a rifle
    ctx.strokeStyle = '#141412'; ctx.lineWidth = rpgStyle ? 4 : 5;
    ctx.beginPath(); ctx.moveTo(ox - fx * 7, oy - 5 - fy * 7); ctx.lineTo(ox + fx * 8, oy - 5 + fy * 8); ctx.stroke();
    ctx.strokeStyle = tube; ctx.lineWidth = rpgStyle ? 2 : 3;
    ctx.beginPath(); ctx.moveTo(ox - fx * 6, oy - 5 - fy * 6); ctx.lineTo(ox + fx * 7, oy - 5 + fy * 7); ctx.stroke();
    if (rpgStyle) px(ctx, ox + fx * 8 - 2, oy - 7 + fy * 8, 4, 4, '#6a7046');
  } else {
    const len = look === 'commando' ? 10 : look === 'spy' ? 3 : 8;
    ctx.strokeStyle = pal.gun; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ox - fx * 2, oy - fy * 2); ctx.lineTo(ox + fx * len, oy + fy * len); ctx.stroke();
    if ((pactF && look === 'inf') || look === 'kpa' || look === 'vc') px(ctx, ox - fx * 3 - 1, oy - fy * 3, 2, 2, '#6b4a30');
  }
  ctx.lineWidth = 1;
  if (firing) {
    const tube = look === 'atinf' || look === 'mujahid';
    const len = tube ? 9 : 10;
    px(ctx, ox + fx * len - 1, oy + fy * len - 1 - (tube ? 4 : 0), 3, 3, '#ffd25a');
  }
}

// Paradrop transport plane (C-130 style); returns false when the rendered sprite isn't loaded yet.
export function drawTransport(ctx, x, y, dir) {
  if (!hasSprite('transport_ALL')) return false;
  drawSprite(ctx, 'transport_ALL', 'body', x, y, dir, null);
  return true;
}

export function drawUnit(ctx, type, x, y, dir, tdir, color, faction, time, flags, cargo, firing) {
  const d = UNITS[type];
  if (d.cat === 'infantry') drawInfantry(ctx, d.look, x, y, dir, color, faction, time, flags & 2, firing, !!(flags & 8), !!(flags & 16));
  else drawVehicle(ctx, d.look, x, y, dir, tdir, color, faction, time, flags, cargo);
}
