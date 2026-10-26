// Dark, gritty limited palette + ordered dithering quantizer for the pixel-art look.

const BASE = [
  // blacks / greys
  '#0a0b0a', '#141614', '#1e211f', '#2a2e2b', '#383c38', '#4a4e48', '#5f625b', '#77796f', '#929184', '#b0ad9c', '#d2cdb8', '#efe9d4',
  // olive / foliage
  '#151c10', '#1e2816', '#28351b', '#334221', '#3f5027', '#4d5e2f', '#5d6c38', '#707c45', '#868f55',
  // mud / earth
  '#21180f', '#2f2216', '#3f2e1d', '#523c26', '#674c30', '#7e5f3d', '#98774e', '#b39462',
  // water
  '#0c151c', '#122130', '#1a2e3e', '#24404f', '#345565', '#4c6e7a',
  // ore / gold
  '#4a3510', '#6e5016', '#94701f', '#bb9430', '#dcb94c', '#f2dc84',
  // rust / blood / soviet red
  '#2e0f0c', '#4a1711', '#6a2015', '#8c2a1a', '#ad3a22', '#cf5530',
  // fire / sparks
  '#e8792a', '#f5a33a', '#ffd25a', '#fff2b0',
  // cold steel / glass
  '#2b3a44', '#3e5462', '#5b7482', '#86a0a8',
  // UI
  '#2fae3f', '#7fe07a', '#e0c030', '#d8402c',
  // snow / ice
  '#8e9392', '#a8adab', '#c3c7c4', '#dde0dc', '#6d8894', '#8aa3ae',
  // desert sand / sandstone
  '#7c6446', '#957a56', '#ad9268', '#c4ab7e', '#8a6444',
  // jungle greens / laterite
  '#14240f', '#1c3216', '#26401c', '#32522a', '#6a4430', '#4e3022', '#2a3828',
  // highlights: lit olive, grass, earth, steel and khaki so faces and terrain stay readable
  '#9ca461', '#b4ba7c', '#5c7a34', '#6e8c3e', '#829e4c', '#cdb07a', '#a6b8be', '#c4d2d6', '#a89a72', '#c2b48a',
];

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function teamShades(hex) {
  const [r, g, b] = hexToRgb(hex);
  const out = [];
  for (const f of [0.42, 0.66, 0.86, 1.06]) {
    // keep team colors punchy so players are easy to tell apart
    const m = (r + g + b) / 3;
    const s = 0.92;
    out.push([
      Math.min(255, (m + (r - m) * s) * f),
      Math.min(255, (m + (g - m) * s) * f),
      Math.min(255, (m + (b - m) * s) * f),
    ]);
  }
  return out;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v / 16 - 0.47));

export class Palette {
  constructor(teamColors = []) {
    const cols = BASE.map(hexToRgb);
    for (const c of teamColors) cols.push(...teamShades(c));
    this.colors = cols;
    // LUT over 5-bit RGB; input colors are graded (darker, desaturated) before matching
    const lut = new Uint32Array(32768);
    for (let i = 0; i < 32768; i++) {
      let r = ((i >> 10) & 31) * 8.226, g = ((i >> 5) & 31) * 8.226, b = (i & 31) * 8.226;
      const m = 0.3 * r + 0.59 * g + 0.11 * b;
      const sat = 0.96;
      r = m + (r - m) * sat; g = m + (g - m) * sat; b = m + (b - m) * sat;
      // lift shadows and add contrast around the midtones so shapes separate from the ground
      const grade = v => Math.min(255, Math.max(0, (v - 128) * 1.12 + 128 + 14));
      r = grade(r); g = grade(g); b = grade(b);
      let best = 0, bd = Infinity;
      for (let k = 0; k < cols.length; k++) {
        const c = cols[k];
        const dr = r - c[0], dg = g - c[1], db = b - c[2];
        const rm = (r + c[0]) / 2;
        const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
        if (d < bd) { bd = d; best = k; }
      }
      const c = cols[best];
      lut[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
    }
    this.lut = lut;
  }

  // Quantize a canvas region in place.
  apply(ctx, w, h, dither = 14) {
    if (w <= 0 || h <= 0) return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = new Uint32Array(img.data.buffer);
    const lut = this.lut;
    for (let y = 0; y < h; y++) {
      const row = y * w, by = (y & 3) << 2;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const c = d[i];
        const a = c >>> 24;
        if (a === 0) continue;
        const t = BAYER[by | (x & 3)] * dither;
        let r = (c & 255) + t, g = ((c >> 8) & 255) + t, b = ((c >> 16) & 255) + t;
        r = r < 0 ? 0 : r > 255 ? 31 : r >> 3;
        g = g < 0 ? 0 : g > 255 ? 31 : g >> 3;
        b = b < 0 ? 0 : b > 255 ? 31 : b >> 3;
        const q = lut[(r << 10) | (g << 5) | b];
        d[i] = a < 128 ? 0 : q;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
