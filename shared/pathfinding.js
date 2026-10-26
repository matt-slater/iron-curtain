// Grid A* with reusable buffers. 8-directional, no corner cutting.

const SQ2 = Math.SQRT2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];

export class PathFinder {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    this.heapI = new Int32Array(n * 4);
    this.heapF = new Float32Array(n * 4);
  }

  // passable(i) -> bool; extra(i) -> additional cost for entering tile i (optional).
  // Returns array of tile indices (excluding start) or null.
  find(sx, sy, tx, ty, passable, extra = null, maxNodes = this.w * this.h) {
    const { w, h } = this;
    sx = Math.max(0, Math.min(w - 1, sx)); sy = Math.max(0, Math.min(h - 1, sy));
    tx = Math.max(0, Math.min(w - 1, tx)); ty = Math.max(0, Math.min(h - 1, ty));
    const start = sy * w + sx, goal = ty * w + tx;
    if (start === goal) return [];
    const gen = ++this.gen;
    const { g, parent, seen, closed, heapI, heapF } = this;
    let size = 0;
    const push = (i, f) => {
      let k = size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapF[p] <= f) break;
        heapI[k] = heapI[p]; heapF[k] = heapF[p]; k = p;
      }
      heapI[k] = i; heapF[k] = f;
    };
    const pop = () => {
      const top = heapI[0];
      const li = heapI[--size], lf = heapF[size];
      let k = 0;
      while (true) {
        let c = 2 * k + 1;
        if (c >= size) break;
        if (c + 1 < size && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= lf) break;
        heapI[k] = heapI[c]; heapF[k] = heapF[c]; k = c;
      }
      heapI[k] = li; heapF[k] = lf;
      return top;
    };
    const hfn = (x, y) => {
      const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
      return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy);
    };
    g[start] = 0; parent[start] = -1; seen[start] = gen;
    push(start, hfn(sx, sy));
    let best = start, bestH = hfn(sx, sy), expanded = 0;
    while (size > 0 && expanded < maxNodes) {
      const cur = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      expanded++;
      if (cur === goal) { best = cur; break; }
      const cx = cur % w, cy = (cur - cx) / w;
      const ch = hfn(cx, cy);
      if (ch < bestH) { bestH = ch; best = cur; }
      for (let d = 0; d < 8; d++) {
        const [dx, dy, cost] = DIRS[d];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni] === gen) continue;
        if (!passable(ni)) continue;
        if (dx && dy && (!passable(cy * w + nx) || !passable(ny * w + cx))) continue;
        const ng = g[cur] + cost + (extra ? extra(ni) : 0);
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen; g[ni] = ng; parent[ni] = cur;
          push(ni, ng + hfn(nx, ny) * 1.001);
        }
      }
    }
    if (best === start) return null;
    const path = [];
    for (let i = best; i !== start; i = parent[i]) path.push(i);
    path.reverse();
    return path;
  }
}
