# Procedural 3D building models for the sprite renderer (imported by render.py inside Blender).
# Built in game footprint coordinates: x 0..w, y 0..h (tiles), z in art pixels. The root is mirrored in Y so
# game +y maps onto the renderer's camera setup; the visible facades are the x = w and y = h sides.
import bpy, bmesh, math
from models import mat, team_mat, box, cyl, dome, sphere, root, pivot, star, H, _obj

RED = '#c42a1c'
GLASS = dict(hexstr='#3e5462', rough=0.15, metal=0.3, grime=0)


def hsh(a, b=0):
    v = math.sin(a * 127.1 + b * 311.7) * 43758.5453
    return v - math.floor(v)


class Site:
    """Helper that builds one layer of a building in footprint coordinates."""

    def __init__(self, w, h, name='body', at=None):
        self.w, self.h = w, h
        self.root = root(name)
        self.root.scale = (1, -1, 1)
        if at:
            # rotating layers pivot around their own location
            self.root.location = (at[0] - w / 2, -(at[1] - h / 2), 0)
            self.off = pivot('off', self.root, (-at[0], -at[1], 0))
        else:
            self.off = pivot('off', self.root, (-w / 2, -h / 2, 0))

    def b(self, x0, y0, x1, y1, z0, z1, m, team=False, bevel=0.008, parent=None):
        return box('b', x0, x1, y0, y1, H(z0), H(z1), m, parent or self.off, team=team, bevel=bevel)

    def c(self, cx, cy, r, z0, z1, m, r2=None, verts=20, team=False, parent=None):
        return cyl('c', r, H(z1 - z0), (cx, cy, H((z0 + z1) / 2)), 'z', m, parent or self.off, team=team, verts=verts, r2=r2)

    def rod(self, a, b, r, m, parent=None):
        """Cylinder between two points (x, y, z_px)."""
        from mathutils import Vector
        p0 = Vector((a[0], a[1], H(a[2])))
        p1 = Vector((b[0], b[1], H(b[2])))
        d = p1 - p0
        o = cyl('rod', r, d.length, (0, 0, 0), 'z', m, parent or self.off, verts=8)
        o.location = (p0 + p1) / 2
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return o

    def dome(self, cx, cy, r, z, m, rz=None, ry=None, parent=None):
        return dome('d', r, ry or r, H(rz) if rz else r * 0.9, (cx, cy, H(z)), m, parent or self.off)

    def lathe(self, cx, cy, prof, m, cap=True, segs=24, team=False, parent=None):
        bm = bmesh.new()
        rings = []
        for r, z in prof:
            rings.append([bm.verts.new((cx + math.cos(a) * r, cy + math.sin(a) * r, H(z))) for a in [i * 2 * math.pi / segs for i in range(segs)]])
        for ra, rb in zip(rings, rings[1:]):
            for i in range(segs):
                j = (i + 1) % segs
                bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
        bm.faces.new(list(reversed(rings[0])))
        if cap: bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return _obj('lathe', bm, m, parent or self.off, team, smooth=True)

    def extrude(self, pts, a0, a1, axis, m, team=False, parent=None):
        """Prism: pts are (u, z_px) pairs; axis 'x' -> u is y, extruded over x in [a0, a1]; axis 'y' -> u is x, over y."""
        bm = bmesh.new()
        if axis == 'x':
            A = [bm.verts.new((a0, u, H(z))) for u, z in pts]
            B = [bm.verts.new((a1, u, H(z))) for u, z in pts]
        else:
            A = [bm.verts.new((u, a0, H(z))) for u, z in pts]
            B = [bm.verts.new((u, a1, H(z))) for u, z in pts]
        n = len(pts)
        bm.faces.new(A)
        bm.faces.new(list(reversed(B)))
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((A[j], A[i], B[i], B[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return _obj('ex', bm, m, parent or self.off, team, bevel=0.006)

    def gable(self, x0, y0, x1, y1, z, rise, m, along=None):
        along = along or ('x' if x1 - x0 >= y1 - y0 else 'y')
        if along == 'x':
            ym = (y0 + y1) / 2
            return self.extrude([(y0, z), (y1, z), (ym, z + rise)], x0, x1, 'x', m)
        xm = (x0 + x1) / 2
        return self.extrude([(x0, z), (x1, z), (xm, z + rise)], y0, y1, 'y', m)

    def arch(self, x0, y0, x1, y1, z, rise, m, segs=10):
        """Quonset roof spanning y, running along x."""
        ym, r = (y0 + y1) / 2, (y1 - y0) / 2
        pts = [(ym - math.cos(math.pi * i / segs) * r, z + math.sin(math.pi * i / segs) * rise) for i in range(segs + 1)]
        return self.extrude(pts, x0, x1, 'x', m)

    def sawtooth(self, x0, y0, x1, y1, z, teeth, rise, m, glass=None):
        step = (x1 - x0) / teeth
        for i in range(teeth):
            a = x0 + i * step
            self.extrude([(a, z), (a + step, z), (a + step, z + rise)], y0, y1, 'y', m)
            if glass:
                self.b(a + step - 0.012, y0 + 0.04, a + step, y1 - 0.04, z + 1, z + rise - 1, glass, bevel=0)

    def pad(self, z, m, x0=0.04, y0=0.04, x1=None, y1=None):
        self.b(x0, y0, (x1 or self.w) - 0.04, (y1 or self.h) - 0.04, 0, z, m, bevel=0.012)

    def windows_y(self, x0, x1, y, z, n, glass, lit=0.3, seed=1, hgt=4.5, wid=None):
        """Row of windows on the face at y (visible +y side)."""
        wid = wid or min(0.12, (x1 - x0) / n * 0.6)
        for i in range(n):
            cx = x0 + (i + 0.5) * (x1 - x0) / n
            g = WARM if hsh(i, seed) < lit else glass
            self.b(cx - wid / 2, y - 0.006, cx + wid / 2, y + 0.012, z, z + hgt, g, bevel=0)

    def windows_x(self, y0, y1, x, z, n, glass, lit=0.3, seed=2, hgt=4.5, wid=None):
        wid = wid or min(0.12, (y1 - y0) / n * 0.6)
        for i in range(n):
            cy = y0 + (i + 0.5) * (y1 - y0) / n
            g = WARM if hsh(seed, i) < lit else glass
            self.b(x - 0.006, cy - wid / 2, x + 0.012, cy + wid / 2, z, z + hgt, g, bevel=0)

    def hazard(self, x0, y0, x1, y1, z, n):
        step = (x1 - x0) / n
        for i in range(n):
            self.b(x0 + i * step, y0, x0 + (i + 1) * step, y1, z, z + 0.4, YELLOW if i % 2 == 0 else BLACK, bevel=0)

    def sandbags(self, pts, z=0, rows=2, m=None):
        m = m or mat('#8a7a52', rough=0.95, grime=0.35, scale=60)
        for r in range(rows):
            for k, (x, y) in enumerate(pts):
                o = 0.03 * (r % 2)
                self.b(x - 0.08 + o, y - 0.06, x + 0.08 + o, y + 0.06, z + r * 3.2, z + r * 3.2 + 3.4, m, bevel=0.018)

    def flag(self, x, y, z, height=46):
        self.c(x, y, 0.012, z, z + height, mat('#8f8f86', metal=0.6, rough=0.3), verts=6)
        self.b(x + 0.0, y - 0.006, x + 0.01, y + 0.006, z + height - 1, z + height, mat('#8f8f86'), bevel=0)
        self.extrude([(x, z + height - 12), (x + 0.32, z + height - 13), (x + 0.32, z + height - 4), (x, z + height - 3)],
                     y - 0.008, y + 0.008, 'y', team_mat(), team=True)

    def star(self, x, y, z, size, facing, m=None):
        star('star', (x, y, H(z)), size, facing, m or REDM, self.off)


WARM = None
YELLOW = BLACK = REDM = None


def init_mats():
    global WARM, YELLOW, BLACK, REDM
    WARM = mat('#e8b860', rough=0.4, grime=0, emit=1.2)
    YELLOW = mat('#d8b020', grime=0.3, scale=40)
    BLACK = mat('#1e1d18', grime=0.2)
    REDM = mat(RED, rough=0.5, grime=0.05)


# ---------- palettes ----------
def nato_pal():
    return dict(wall=mat('#9aa093', grime=0.3, scale=26), wall2=mat('#7f877a', grime=0.3, scale=26), roof=mat('#4c5352', grime=0.25),
                pad=mat('#6c6e66', grime=0.45, scale=22), glass=mat(**GLASS), olive=mat('#5f6a38', grime=0.25, scale=30),
                crane=mat('#d0a42a', grime=0.3, metal=0.3), metal=mat('#a8a698', metal=0.5, rough=0.4, grime=0.25),
                dark=mat('#2c2e2a', grime=0.2), tank=mat('#c2bfae', metal=0.3, rough=0.45, grime=0.3))


def pact_pal():
    return dict(wall=mat('#9a8e76', grime=0.5, scale=24), wall2=mat('#7e735f', grime=0.5, scale=24), roof=mat('#6e4630', grime=0.4),
                pad=mat('#625e54', grime=0.5, scale=20), brick=mat('#7e3e2c', grime=0.45, scale=50), rust=mat('#9a5a30', grime=0.55, rough=0.85, scale=30),
                green=mat('#4d8034', grime=0.25), glass=mat('#383c36', rough=0.3, grime=0.1), dark=mat('#2a2822', grime=0.2),
                metal=mat('#7a7262', metal=0.4, rough=0.5, grime=0.4), red=REDM)


# ---------- NATO ----------
def n_conyard():
    s, p = Site(3, 3), nato_pal()
    s.pad(4, p['pad'])
    s.b(0.2, 0.2, 2.0, 1.8, 4, 28, p['wall'])
    s.b(0.2, 1.62, 2.0, 1.82, 27, 30, team_mat(), team=True)
    s.b(0.45, 0.4, 0.95, 0.85, 28, 34, p['metal'])
    s.b(1.2, 0.45, 1.6, 0.8, 28, 32, p['metal'])
    s.windows_y(0.35, 1.9, 1.8, 18, 6, p['glass'], seed=3)
    s.windows_x(0.3, 1.7, 2.0, 18, 4, p['glass'], seed=4)
    s.b(0.8, 1.79, 1.4, 1.83, 4, 13, p['dark'], bevel=0)
    for x, y in [(2.25, 0.3), (2.75, 0.3), (2.25, 2.6), (2.75, 2.6)]:
        s.b(x - 0.05, y - 0.05, x + 0.05, y + 0.05, 4, 52, p['crane'], bevel=0.004)
    s.b(2.15, 0.2, 2.85, 0.4, 50, 56, p['crane'])
    s.b(2.15, 2.5, 2.85, 2.7, 50, 56, p['crane'])
    for x in (2.2, 2.8):
        s.b(x - 0.04, 0.2, x + 0.04, 2.7, 52, 56, p['crane'])
    s.b(2.38, 1.3, 2.62, 1.55, 44, 52, p['dark'])
    s.c(2.5, 1.42, 0.008, 22, 44, p['dark'], verts=6)
    s.b(0.4, 2.15, 1.3, 2.75, 4, 11, p['olive'])
    s.b(0.4, 2.15, 1.3, 2.3, 11, 12, team_mat(), team=True, bevel=0)
    s.hazard(1.6, 2.4, 2.15, 2.6, 4, 5)
    return {'layers': {'body': s.root}}


def n_power():
    s, p = Site(2, 2), nato_pal()
    s.pad(3, p['pad'])
    s.b(0.12, 1.05, 1.88, 1.88, 3, 18, p['wall'])
    s.b(0.12, 1.6, 1.88, 1.88, 18, 19.5, team_mat(), team=True, bevel=0)
    s.windows_y(0.3, 1.8, 1.88, 10, 5, p['glass'], seed=5)
    s.windows_x(1.15, 1.8, 1.88, 10, 2, p['glass'], seed=6)
    conc = mat('#b4b0a0', grime=0.35, scale=18)
    for cx, cy, r, hgt in [(0.6, 0.55, 0.42, 46), (1.45, 0.6, 0.36, 38)]:
        s.lathe(cx, cy, [(r, 3), (r * 0.78, hgt * 0.55), (r * 0.72, hgt * 0.75), (r * 0.8, hgt)], conc, cap=False)
        s.c(cx, cy, r * 0.74, hgt - 3, hgt - 2.5, p['dark'], verts=24)
        s.b(cx - 0.06, cy + r - 0.02, cx + 0.06, cy + r + 0.03, 3, 6, p['dark'], bevel=0)
    return {'layers': {'body': s.root}}


def n_refinery():
    s, p = Site(3, 3), nato_pal()
    s.pad(4, p['pad'])
    s.b(0.2, 0.2, 2.8, 1.5, 4, 24, p['wall'])
    s.b(0.2, 1.3, 2.8, 1.52, 23, 25.5, team_mat(), team=True)
    s.b(0.5, 0.4, 1.4, 1.0, 24, 30, p['roof'])
    s.windows_y(0.4, 2.6, 1.5, 14, 8, p['glass'], seed=7)
    s.windows_x(0.3, 1.4, 2.8, 14, 3, p['glass'], seed=8)
    for cx, cy, r, hgt in [(0.55, 2.2, 0.38, 26), (2.45, 2.35, 0.32, 20)]:
        s.lathe(cx, cy, [(r, 4), (r, hgt), (r * 0.6, hgt + 4), (0.05, hgt + 5)], p['tank'])
        s.c(cx, cy, r + 0.006, hgt - 6, hgt - 4, team_mat(), team=True)
    s.rod((0.55, 2.2, 22), (1.4, 1.5, 18), 0.03, p['metal'])
    s.rod((2.45, 2.35, 16), (2.2, 1.5, 14), 0.025, p['metal'])
    s.b(1.15, 2.1, 1.85, 2.95, 4, 4.5, p['dark'], bevel=0)
    s.hazard(1.15, 2.82, 1.85, 2.95, 4.5, 5)
    s.b(1.25, 1.5, 1.75, 1.55, 4, 16, p['dark'], bevel=0)
    return {'layers': {'body': s.root}}


def n_barracks():
    s, p = Site(2, 2), nato_pal()
    s.pad(2, mat('#5e5a48', grime=0.5, scale=24))
    s.b(0.2, 0.3, 1.8, 1.55, 2, 9, p['olive'])
    s.arch(0.2, 0.3, 1.8, 1.55, 9, 15, p['olive'])
    s.b(1.79, 0.75, 1.82, 1.1, 2, 12, p['dark'], bevel=0)
    s.windows_y(0.35, 1.65, 1.55, 5, 4, p['glass'], lit=0.4, seed=9, hgt=3)
    s.sandbags([(0.3, 1.85), (0.5, 1.85), (0.7, 1.85), (0.9, 1.85), (1.1, 1.85), (1.3, 1.85), (1.5, 1.85), (1.85, 1.65), (1.85, 1.45), (1.85, 0.4), (1.85, 0.25)], 2)
    s.flag(0.25, 1.85, 2)
    return {'layers': {'body': s.root}}


def n_factory():
    s, p = Site(3, 3), nato_pal()
    s.pad(4, p['pad'])
    s.b(0.15, 0.15, 2.85, 2.5, 4, 22, p['wall2'])
    s.arch(0.15, 0.15, 2.85, 2.5, 22, 18, mat('#6a716c', grime=0.3), segs=12)
    s.b(0.85, 2.49, 2.15, 2.53, 4, 21, mat('#3a3c38', grime=0.4), bevel=0)
    for z in range(7, 21, 3):
        s.b(0.85, 2.53, 2.15, 2.545, z, z + 0.6, p['metal'], bevel=0)
    s.b(0.15, 2.3, 0.75, 2.52, 4, 23, team_mat(), team=True)
    s.b(2.25, 2.3, 2.85, 2.52, 4, 23, team_mat(), team=True)
    s.hazard(0.85, 2.6, 2.15, 2.95, 4, 8)
    s.windows_x(0.4, 2.2, 2.85, 14, 6, p['glass'], seed=10)
    s.b(0.4, 0.4, 0.8, 0.8, 30, 38, p['metal'])
    return {'layers': {'body': s.root}}


def n_radar():
    s, p = Site(2, 2), nato_pal()
    s.pad(3, p['pad'])
    s.b(0.15, 0.9, 1.85, 1.85, 3, 16, p['wall'])
    s.b(0.15, 1.62, 1.85, 1.86, 15.5, 17, team_mat(), team=True, bevel=0)
    s.windows_y(0.3, 1.7, 1.85, 9, 4, p['glass'], seed=11)
    for x, y in [(0.4, 0.3), (1.0, 0.3), (0.4, 0.85), (1.0, 0.85)]:
        s.rod((x, y, 3), (0.7, 0.58, 24), 0.018, p['metal'])
    s.dome(0.7, 0.58, 0.42, 22, mat('#d8d4c4', rough=0.5, grime=0.15), rz=24)
    d = Site(2, 2, 'dish', at=(1.4, 1.35))
    d.c(1.4, 1.35, 0.03, 16, 22, p['metal'], verts=8)
    dish = mat('#c8c4b4', rough=0.4, metal=0.2, grime=0.2)
    d.extrude([(1.4 - 0.26, 22), (1.4 + 0.26, 22), (1.4 + 0.3, 30), (1.4 - 0.3, 30)], 1.3, 1.36, 'y', dish)
    d.b(1.37, 1.36, 1.43, 1.5, 24, 27, p['dark'], bevel=0)
    return {'layers': {'body': s.root, 'dish': d.root}}


def n_tech():
    s, p = Site(2, 2), nato_pal()
    s.pad(3, p['pad'])
    s.b(0.15, 0.15, 1.85, 1.85, 3, 20, mat('#aeb3aa', grime=0.25, scale=26))
    s.b(0.15, 1.6, 1.85, 1.86, 19.5, 21, team_mat(), team=True, bevel=0)
    s.windows_y(0.25, 1.75, 1.85, 12, 6, p['glass'], lit=0.6, seed=12)
    s.windows_x(0.25, 1.75, 1.85, 12, 5, p['glass'], lit=0.6, seed=13)
    s.dome(1.0, 1.0, 0.62, 20, mat('#5b7482', rough=0.12, metal=0.4, grime=0), rz=18)
    s.c(1.0, 1.0, 0.01, 38, 50, p['dark'], verts=6)
    return {'layers': {'body': s.root}}


def n_silo():
    s, p = Site(2, 2), nato_pal()
    s.pad(5, mat('#5e605a', grime=0.45, scale=22))
    s.hazard(0.08, 0.08, 1.92, 0.22, 5, 10)
    for cx, cy in [(0.65, 0.95), (1.4, 1.05)]:
        s.c(cx, cy, 0.34, 5, 6, mat('#3a3b36'), verts=28)
        s.c(cx, cy, 0.28, 6, 7, mat('#6a6c64', metal=0.4, rough=0.45), verts=28)
        s.b(cx - 0.29, cy - 0.01, cx + 0.29, cy + 0.01, 7, 7.2, p['dark'], bevel=0)
    for i in range(5):
        s.c(0.05 + i * 0.47, 1.95, 0.012, 5, 15, p['metal'], verts=6)
    s.b(0.05, 1.94, 1.95, 1.96, 13, 13.6, p['metal'], bevel=0)
    s.b(1.65, 0.35, 1.95, 0.7, 5, 13, p['wall2'])
    s.b(1.65, 0.35, 1.95, 0.7, 13, 14, team_mat(), team=True, bevel=0)
    return {'layers': {'body': s.root}}


def n_pillbox():
    s, p = Site(1, 1), nato_pal()
    s.sandbags([(0.2, 0.3), (0.5, 0.15), (0.8, 0.3), (0.15, 0.6), (0.85, 0.6), (0.3, 0.88), (0.7, 0.88)], 0)
    s.sandbags([(0.3, 0.4), (0.7, 0.4), (0.3, 0.75), (0.7, 0.75)], 6.4, rows=1)
    s.b(0.32, 0.32, 0.68, 0.68, 0, 9, mat('#7a7a6a', grime=0.4))
    s.b(0.34, 0.34, 0.66, 0.66, 9, 10, team_mat(), team=True, bevel=0)
    t = Site(1, 1, 'turret', at=(0.5, 0.5))
    t.b(0.48, 0.47, 0.88, 0.53, 9.4, 11, mat('#1c1d18', metal=0.4), bevel=0)
    t.b(0.4, 0.38, 0.52, 0.62, 8.5, 12.5, mat('#4e5232'))
    return {'layers': {'body': s.root, 'turret': t.root}}


def n_atgun():
    s, p = Site(1, 1), nato_pal()
    s.sandbags([(0.15, 0.35), (0.4, 0.15), (0.7, 0.15), (0.9, 0.4), (0.15, 0.7), (0.9, 0.7), (0.4, 0.9), (0.7, 0.9)], 0)
    s.c(0.5, 0.5, 0.14, 0, 5, mat('#4a4c40'))
    s.c(0.5, 0.5, 0.145, 4.5, 5.5, team_mat(), team=True)
    t = Site(1, 1, 'turret', at=(0.5, 0.5))
    tube = mat('#5a6438', grime=0.25)
    for a in (0, 2.1, 4.2):
        t.rod((0.5, 0.5, 9), (0.5 + math.cos(a) * 0.14, 0.5 + math.sin(a) * 0.14, 5), 0.01, mat('#2a2a24'))
    t.rod((0.36, 0.5, 11), (0.88, 0.5, 12.5), 0.035, tube)
    t.b(0.45, 0.53, 0.58, 0.6, 9.5, 12.5, mat('#2a2a24'), bevel=0)
    return {'layers': {'body': s.root, 'turret': t.root}}


def n_samsite():
    s, p = Site(2, 2), nato_pal()
    s.pad(2, p['pad'])
    s.hazard(0.1, 1.8, 1.9, 1.92, 2, 9)
    s.c(1, 1, 0.3, 2, 6, p['olive'])
    s.c(1, 1, 0.305, 5, 6.5, team_mat(), team=True)
    s.b(0.15, 0.15, 0.55, 0.55, 2, 9, p['wall2'])
    s.c(0.35, 0.35, 0.09, 9, 10, p['metal'], verts=12)
    t = Site(2, 2, 'turret', at=(1, 1))
    t.b(0.85, 0.82, 1.1, 1.18, 6, 11, p['olive'])
    rail = mat('#e4e0d0', rough=0.4, grime=0.15)
    for q in (-0.16, 0, 0.16):
        t.rod((0.75, 1 + q, 10), (1.5, 1 + q, 24), 0.035, rail)
        t.rod((1.47, 1 + q, 23.4), (1.55, 1 + q, 25.2), 0.035, mat('#3a3c36'))
    return {'layers': {'body': s.root, 'turret': t.root}}


def airfield(pact):
    s = Site(3, 3)
    p = pact_pal() if pact else nato_pal()
    s.pad(2, mat('#5a5850' if pact else '#686a64', grime=0.45, scale=18))
    paint = mat('#a8964a' if pact else '#d8d4bc', rough=0.6, grime=0.2)
    for cx, cy in [(0.8, 0.8), (2.2, 0.8), (0.8, 2.2), (2.2, 2.2)]:
        s.c(cx, cy, 0.6, 2, 2.3, mat('#45443e' if pact else '#4c4e4a', grime=0.4), verts=32)
        s.lathe(cx, cy, [(0.52, 2.3), (0.52, 2.6), (0.47, 2.6), (0.47, 2.3)], paint, cap=False, segs=32)
        if pact:
            s.star(cx, cy, 2.62, 0.16, '+z', mat('#9e2a1e', grime=0.2))
        else:
            s.b(cx - 0.16, cy - 0.03, cx + 0.16, cy + 0.03, 2.3, 2.6, paint, bevel=0)
            s.b(cx - 0.16, cy - 0.18, cx - 0.1, cy + 0.18, 2.3, 2.6, paint, bevel=0)
            s.b(cx + 0.1, cy - 0.18, cx + 0.16, cy + 0.18, 2.3, 2.6, paint, bevel=0)
    s.hazard(0.05, 1.45, 0.4, 1.55, 2, 3)
    s.hazard(2.6, 1.45, 2.95, 1.55, 2, 3)
    if pact:
        s.b(1.32, 1.32, 1.68, 1.68, 2, 14, p['wall'])
        s.b(1.24, 1.24, 1.76, 1.76, 14, 20, p['glass'])
        s.b(1.22, 1.22, 1.78, 1.78, 20, 21.5, team_mat(), team=True)
        s.c(1.5, 1.5, 0.01, 21, 34, p['dark'], verts=6)
        s.star(1.5, 1.68, 9, 0.07, '+y')
    else:
        s.b(1.34, 1.34, 1.66, 1.66, 2, 13, p['wall'])
        s.b(1.26, 1.26, 1.74, 1.74, 13, 18, p['glass'])
        s.b(1.24, 1.24, 1.76, 1.76, 18, 19.5, team_mat(), team=True)
        s.dome(1.6, 1.4, 0.09, 19.5, mat('#d8d4c4'))
    return {'layers': {'body': s.root}}


# ---------- Warsaw Pact ----------
def p_conyard():
    s, p = Site(3, 3), pact_pal()
    s.pad(4, p['pad'])
    s.b(0.15, 0.2, 2.1, 1.85, 4, 22, p['wall'])
    s.b(0.4, 0.4, 1.7, 1.4, 22, 34, p['wall2'])
    s.b(0.4, 1.2, 1.7, 1.42, 33.5, 35.5, team_mat(), team=True)
    s.windows_y(0.3, 2.0, 1.85, 14, 7, p['glass'], lit=0.25, seed=21)
    s.windows_x(0.3, 1.75, 2.1, 14, 4, p['glass'], lit=0.25, seed=22)
    s.windows_y(0.5, 1.6, 1.4, 26, 4, p['glass'], lit=0.25, seed=23)
    s.star(1.05, 1.42, 28, 0.1, '+y')
    rust = p['rust']
    for x, y in [(2.4, 0.4), (2.6, 0.4), (2.4, 0.6), (2.6, 0.6)]:
        s.c(x, y, 0.024, 4, 66, rust, verts=6)
    for z in range(8, 66, 8):
        s.rod((2.4, 0.4, z), (2.6, 0.6, z + 8), 0.014, rust)
        s.rod((2.6, 0.4, z), (2.4, 0.6, z + 8), 0.014, rust)
        s.rod((2.4, 0.6, z), (2.6, 0.4, z + 8), 0.014, rust)
    s.b(2.44, -0.1, 2.56, 2.9, 64, 68, rust)
    s.b(2.35, -0.15, 2.65, 0.12, 58, 66, mat('#3e403a', grime=0.3))
    s.rod((2.5, 0.5, 74), (2.5, 2.8, 68), 0.006, p['dark'])
    s.rod((2.5, 0.5, 74), (2.5, 0.0, 68), 0.006, p['dark'])
    s.c(2.5, 2.4, 0.004, 40, 64, p['dark'], verts=4)
    s.b(2.44, 2.36, 2.56, 2.44, 36, 40, p['dark'], bevel=0)
    s.b(0.3, 2.2, 1.4, 2.8, 4, 10, p['green'])
    s.b(0.3, 2.2, 1.4, 2.35, 10, 11, team_mat(), team=True, bevel=0)
    return {'layers': {'body': s.root}}


def p_power():
    s, p = Site(2, 2), pact_pal()
    s.pad(3, p['pad'])
    s.b(0.12, 0.7, 1.88, 1.88, 3, 22, p['brick'])
    s.sawtooth(0.12, 0.7, 1.88, 1.88, 22, 3, 7, p['roof'], glass=p['glass'])
    s.b(0.12, 1.66, 1.88, 1.9, 21.5, 23, team_mat(), team=True, bevel=0)
    s.windows_y(0.3, 1.8, 1.88, 11, 5, p['glass'], lit=0.5, seed=24, hgt=6)
    s.windows_x(0.8, 1.8, 1.88, 11, 3, p['glass'], lit=0.5, seed=25, hgt=6)
    stack = mat('#8a7e6e', grime=0.5, scale=24)
    for x, y, hgt in [(0.4, 0.35, 64), (0.95, 0.3, 58), (1.5, 0.35, 64)]:
        s.c(x, y, 0.12, 3, hgt, stack, r2=0.1)
        for z in (hgt - 14, hgt - 26):
            s.c(x, y, 0.118, z, z + 6, mat('#b02a1e', grime=0.3))
        s.c(x, y, 0.07, hgt - 0.5, hgt, p['dark'], verts=12)
    s.star(1.0, 1.9, 15, 0.08, '+y')
    return {'layers': {'body': s.root}}


def p_refinery():
    s, p = Site(3, 3), pact_pal()
    s.pad(4, p['pad'])
    s.b(0.2, 1.2, 1.6, 2.0, 4, 18, p['brick'])
    s.gable(0.2, 1.2, 1.6, 2.0, 18, 8, p['roof'])
    s.windows_y(0.3, 1.5, 2.0, 10, 5, p['glass'], lit=0.4, seed=26)
    for x, y, hgt in [(0.5, 0.5, 40), (1.2, 0.45, 44), (1.95, 0.5, 40)]:
        s.lathe(x, y, [(0.3, 4), (0.3, hgt), (0.04, hgt + 10)], p['rust'])
        s.c(x, y, 0.305, hgt - 10, hgt - 7, team_mat(), team=True)
    s.rod((0.5, 0.5, 30), (1.95, 0.5, 30), 0.035, p['metal'])
    s.rod((1.95, 0.5, 20), (2.6, 2.0, 10), 0.04, p['metal'])
    s.b(2.2, 1.3, 2.85, 2.0, 4, 14, p['wall2'])
    s.b(2.2, 1.85, 2.85, 2.02, 14, 15, team_mat(), team=True, bevel=0)
    s.b(1.15, 2.15, 1.85, 2.95, 4, 4.5, p['dark'], bevel=0)
    s.hazard(1.15, 2.82, 1.85, 2.95, 4.5, 5)
    s.star(1.2, 0.75, 26, 0.09, '+y')
    return {'layers': {'body': s.root}}


def p_barracks():
    s, p = Site(2, 2), pact_pal()
    s.pad(2, mat('#5a564c', grime=0.5, scale=22))
    s.b(0.15, 0.25, 1.85, 1.6, 2, 24, p['wall'])
    s.b(0.15, 1.38, 1.85, 1.62, 23.5, 25, team_mat(), team=True, bevel=0)
    s.windows_y(0.3, 1.75, 1.6, 16, 5, p['glass'], lit=0.3, seed=27)
    s.windows_y(0.3, 1.75, 1.6, 7, 5, p['glass'], lit=0.3, seed=28)
    s.windows_x(0.35, 1.5, 1.85, 16, 3, p['glass'], lit=0.3, seed=29)
    s.b(1.86, 0.7, 1.9, 1.1, 8, 22, mat('#b02a1e', grime=0.15), bevel=0)
    s.star(1.905, 0.9, 18, 0.06, '+x', mat('#d8b860', rough=0.4, grime=0))
    for i in range(6):
        s.c(0.05 + i * 0.36, 1.92, 0.012, 2, 9, p['metal'], verts=6)
    s.b(0.05, 1.91, 1.85, 1.93, 7.5, 8.2, p['metal'], bevel=0)
    return {'layers': {'body': s.root}}


def p_factory():
    s, p = Site(3, 3), pact_pal()
    s.pad(4, p['pad'])
    s.b(0.15, 0.15, 2.85, 2.5, 4, 24, p['wall'])
    s.sawtooth(0.15, 0.15, 2.85, 2.5, 24, 5, 10, p['roof'], glass=p['glass'])
    s.b(0.85, 2.49, 2.15, 2.53, 4, 20, mat('#2e2a24', grime=0.4), bevel=0)
    for z in range(7, 20, 3):
        s.b(0.85, 2.53, 2.15, 2.545, z, z + 0.6, p['rust'], bevel=0)
    s.b(0.15, 2.3, 2.85, 2.52, 23.5, 25, team_mat(), team=True, bevel=0)
    s.c(0.45, 0.4, 0.15, 24, 62, mat('#8a7e6e', grime=0.5), r2=0.12)
    s.c(0.45, 0.4, 0.152, 52, 56, mat('#b02a1e'))
    s.star(1.5, 2.53, 22, 0.1, '+y')
    s.hazard(0.85, 2.6, 2.15, 2.95, 4, 8)
    s.windows_x(0.4, 2.2, 2.85, 14, 6, p['glass'], lit=0.3, seed=30)
    return {'layers': {'body': s.root}}


def p_radar():
    s, p = Site(2, 2), pact_pal()
    s.pad(3, p['pad'])
    s.b(0.2, 0.9, 1.6, 1.85, 3, 14, p['wall'])
    s.b(0.2, 1.62, 1.6, 1.86, 13.5, 15, team_mat(), team=True, bevel=0)
    s.windows_y(0.35, 1.5, 1.85, 8, 4, p['glass'], lit=0.3, seed=31)
    s.b(0.9, 0.35, 1.2, 0.65, 3, 30, p['wall2'])
    s.star(1.21, 0.5, 20, 0.07, '+x')
    d = Site(2, 2, 'dish', at=(1.05, 0.5))
    lat = mat('#5a5446', metal=0.4, grime=0.3)
    d.c(1.05, 0.5, 0.05, 30, 33, p['dark'], verts=8)
    for i in range(7):
        y = 0.5 - 0.55 + i * 0.55 / 3
        d.b(1.03, y - 0.01, 1.07, y + 0.01, 32, 46, lat, bevel=0)
    for z in (32, 39, 46):
        d.b(1.03, -0.05, 1.07, 1.05, z - 0.6, z + 0.6, lat, bevel=0)
    d.b(1.0, -0.05, 1.03, 1.05, 32, 46, mat('#3c3830', grime=0.3), bevel=0)
    return {'layers': {'body': s.root, 'dish': d.root}}


def p_tech():
    s, p = Site(2, 2), pact_pal()
    s.pad(3, p['pad'])
    s.b(0.15, 0.15, 1.85, 1.85, 3, 18, p['wall'])
    s.b(0.15, 1.62, 1.85, 1.86, 17.5, 19, team_mat(), team=True, bevel=0)
    s.windows_y(0.25, 1.75, 1.85, 10, 6, p['glass'], lit=0.4, seed=32)
    s.windows_x(0.25, 1.75, 1.85, 10, 5, p['glass'], lit=0.4, seed=33)
    s.b(0.75, 0.75, 1.25, 1.25, 18, 46, p['wall2'])
    s.windows_y(0.8, 1.2, 1.25, 26, 2, p['glass'], lit=0.6, seed=34)
    s.windows_y(0.8, 1.2, 1.25, 35, 2, p['glass'], lit=0.6, seed=35)
    s.c(1.0, 1.0, 0.32, 46, 52, mat('#8a8070', grime=0.4), verts=24)
    s.c(1.0, 1.0, 0.012, 52, 82, p['metal'], verts=6)
    s.c(1.0, 1.0, 0.05, 80, 82, mat('#e04030', emit=2, grime=0), verts=8)
    s.rod((1.2, 0.6, 18), (1.35, 0.5, 24), 0.012, p['metal'])
    s.lathe(1.35, 0.5, [(0.03, 24), (0.18, 28), (0.2, 28.6)], mat('#b8b09a', rough=0.4), cap=True)
    s.star(1.0, 1.26, 40, 0.07, '+y')
    return {'layers': {'body': s.root}}


def p_silo():
    s, p = Site(2, 2), pact_pal()
    s.pad(6, mat('#585448', grime=0.5, scale=22))
    s.b(0.25, 0.25, 1.75, 1.75, 6, 12, p['wall2'])
    s.b(0.35, 0.35, 0.98, 1.65, 12, 12.6, mat('#58523e', metal=0.3, grime=0.4), bevel=0)
    s.b(1.02, 0.35, 1.65, 1.65, 12, 12.6, mat('#58523e', metal=0.3, grime=0.4), bevel=0)
    s.star(1.0, 1.0, 12.7, 0.25, '+z')
    s.hazard(0.08, 1.8, 1.92, 1.95, 6, 10)
    s.b(1.75, 0.2, 1.97, 0.55, 6, 14, p['rust'])
    s.b(1.75, 0.2, 1.97, 0.55, 14, 15, team_mat(), team=True, bevel=0)
    return {'layers': {'body': s.root}}


def p_pillbox():
    s, p = Site(1, 1), pact_pal()
    conc = mat('#8a8270', grime=0.5, scale=30)
    s.c(0.5, 0.5, 0.42, 0, 7, conc, verts=24)
    s.dome(0.5, 0.5, 0.36, 7, conc, rz=8)
    s.c(0.5, 0.5, 0.425, 4, 5.5, team_mat(), team=True, verts=24)
    t = Site(1, 1, 'turret', at=(0.5, 0.5))
    t.b(0.7, 0.42, 0.9, 0.58, 7, 10, mat('#0e0e0c'), bevel=0)
    t.b(0.72, 0.48, 1.0, 0.52, 8, 9.2, mat('#1c1d18', metal=0.4), bevel=0)
    return {'layers': {'body': s.root, 'turret': t.root}}


def p_atgun():
    s, p = Site(1, 1), pact_pal()
    s.b(0.1, 0.1, 0.9, 0.9, 0, 0.6, mat('#4a3e2c', grime=0.5), bevel=0)
    s.sandbags([(0.15, 0.3), (0.15, 0.55), (0.3, 0.85), (0.6, 0.88), (0.85, 0.7)], 0, rows=1)
    s.c(0.5, 0.5, 0.1, 0, 5, p['green'])
    s.c(0.5, 0.5, 0.105, 4, 5.5, team_mat(), team=True)
    t = Site(1, 1, 'turret', at=(0.5, 0.5))
    g = mat('#4d8034', grime=0.25)
    t.rod((0.38, 0.5, 6.5), (1.2, 0.5, 8), 0.022, mat('#2a2e22', metal=0.3))
    t.extrude([(0.4, 4), (0.6, 4), (0.62, 12), (0.38, 12)], 0.54, 0.57, 'x', g)
    for q in (-1, 1):
        t.rod((0.5, 0.5, 3), (0.1, 0.5 + q * 0.3, 0.5), 0.02, g)
        cyl('wheel', 0.09, 0.05, (0.45, 0.5 + q * 0.2, H(3)), 'y', mat('#1c1d18'), t.off, verts=14)
    return {'layers': {'body': s.root, 'turret': t.root}}


def p_samsite():
    s, p = Site(2, 2), pact_pal()
    s.b(0.1, 0.1, 1.9, 1.9, 0, 0.5, mat('#4a3e2c', grime=0.5), bevel=0)
    ring = [(1 + math.cos(a) * 0.82, 1 + math.sin(a) * 0.82) for a in [i * math.pi / 8 for i in range(16)] if not (0.2 < a < 1.3)]
    s.sandbags(ring, 0, m=mat('#6a6048', rough=0.95, grime=0.4, scale=60))
    s.c(1, 1, 0.3, 0, 5, p['green'])
    s.c(1, 1, 0.305, 4, 5.5, team_mat(), team=True)
    t = Site(2, 2, 'turret', at=(1, 1))
    t.b(0.85, 0.85, 1.15, 1.15, 5, 9, p['green'])
    t.rod((0.7, 1, 9), (1.45, 1, 22), 0.02, p['dark'])
    t.rod((0.65, 1, 11), (1.6, 1, 27), 0.055, mat('#d8d4c4', rough=0.4, grime=0.15))
    t.rod((1.55, 1, 26), (1.72, 1, 29), 0.04, mat('#9e2a1e'))
    for q in (-1, 1):
        t.b(0.66, 1 + q * 0.05 - 0.04, 0.8, 1 + q * 0.05 + 0.04, 10, 14, mat('#c8c4b4'), bevel=0)
    return {'layers': {'body': s.root, 'turret': t.root}}


def derrick():
    s = Site(2, 2)
    s.pad(2, mat('#4a3a28', grime=0.6, scale=20))
    for k in range(6):
        s.c(0.3 + hsh(k, 3) * 1.4, 0.3 + hsh(3, k) * 1.4, 0.08 + k * 0.03, 2, 2.2, mat('#0c0c0a', rough=0.2), verts=16)
    s.lathe(1.45, 0.55, [(0.32, 2), (0.32, 22), (0.2, 25), (0.02, 26)], mat('#7a6a50', metal=0.3, grime=0.5))
    s.c(1.45, 0.55, 0.325, 15, 18, team_mat(), team=True)
    s.b(0.25, 1.2, 0.75, 1.75, 2, 10, mat('#5c5a50', grime=0.5))
    leg = mat('#3a382e', metal=0.4)
    for q in (-1, 1):
        s.rod((0.7, 0.9 + q * 0.18, 2), (0.7, 0.9, 30), 0.022, leg)
    s.rod((0.45, 0.9, 2), (0.7, 0.9, 30), 0.02, leg)
    s.b(0.35, 1.55, 0.6, 1.75, 10, 12, mat('#2a2822'), bevel=0)
    pumps = {}
    pump = Site(2, 2, 'pump', at=(0.7, 0.9))
    beam = pivot('beam', pump.off, (0.7, 0.9, H(30)))
    bm = mat('#2a2822', metal=0.4, grime=0.3)
    box('beam', -0.45, 0.4, -0.03, 0.03, -H(1.5), H(1.5), bm, beam)
    box('head', -0.55, -0.42, -0.04, 0.04, -H(8), H(2), mat('#7a2015', grime=0.3), beam)
    box('weight', 0.32, 0.46, -0.06, 0.06, -H(6), H(1), bm, beam)
    rod_ = cyl('rod', 0.01, H(26), (-0.5, 0, -H(14)), 'z', bm, beam, verts=6)

    def phase(i):
        def apply():
            beam.rotation_euler = (0, math.sin(i / 8 * 2 * math.pi) * 0.3, 0)
        return apply
    for i in range(8):
        pumps[f'p{i}'] = phase(i)
    return {'layers': {'body': s.root, 'pump': pump.root}, 'poses': {'pump': pumps}}


# ---------- civilian buildings per biome ----------
CIV = {
    'temperate': dict(walls=['#b0a48a', '#9a8e7e', '#8a8a84'], roof='#8a3e2a', flat='#5a5852', pave='#6e6c64', glass='#3e5462', trim='#d8d0bc'),
    'arctic': dict(walls=['#6a4e36', '#8e908c', '#7e817e'], roof='#e6eaea', flat='#dfe4e4', pave='#a8acaa', glass='#3e5462', trim='#c8c8c0'),
    'desert': dict(walls=['#c8a676', '#c4ac84', '#cac2ae'], roof='#9a7e58', flat='#b09468', pave='#9a8462', glass='#2a2620', trim='#e0d4b4'),
    'jungle': dict(walls=['#6e5838', '#b0aa86', '#c4bc98'], roof='#8a5a36', flat='#7a5a3a', pave='#6a5438', glass='#2a2a22', trim='#e0d8c0'),
}


def civ_house(biome):
    c = CIV[biome]
    s = Site(2, 2)
    W, Hh, m = 2, 2, 0.14
    s.pad(2, mat(c['pave'], grime=0.5, scale=20))
    glass = mat(c['glass'], rough=0.2, metal=0.2, grime=0)
    if biome == 'jungle':
        for x, y in [(m + 0.1, m + 0.1), (W - m - 0.1, m + 0.1), (m + 0.1, Hh - m - 0.1), (W - m - 0.1, Hh - m - 0.1)]:
            s.c(x, y, 0.035, 2, 10, mat('#3a2a1a'), verts=8)
        s.b(m + 0.1, m + 0.1, W - m - 0.1, Hh - m - 0.1, 10, 20, mat(c['walls'][0], grime=0.4, scale=60))
        s.windows_y(m + 0.3, W - m - 0.3, Hh - m - 0.1, 14, 2, glass, lit=0.3, seed=41)
        s.gable(m - 0.08, m - 0.08, W - m + 0.08, Hh - m + 0.08, 20, 16, mat('#a08a50', rough=0.95, grime=0.4, scale=80))
        return {'layers': {'body': s.root}, 'meta': {'roof': 36, 'flag': [W - m - 0.3, Hh - m - 0.3]}}
    wall = mat(c['walls'][0], grime=0.35, scale=30)
    s.b(m, m, W - m, Hh - m, 2, 18, wall)
    s.windows_y(m + 0.2, W - m - 0.2, Hh - m, 10, 3, glass, lit=0.35, seed=42, hgt=5)
    s.windows_x(m + 0.2, Hh - m - 0.2, W - m, 10, 3, glass, lit=0.35, seed=43, hgt=5)
    s.b(W / 2 - 0.08, Hh - m - 0.005, W / 2 + 0.08, Hh - m + 0.015, 2, 10, mat('#3a2a1a'), bevel=0)
    if biome == 'desert':
        s.b(m, m, W - m, Hh - m, 18, 21, wall)
        s.b(m + 0.06, m + 0.06, W - m - 0.06, Hh - m - 0.06, 19, 21.2, mat(c['flat'], grime=0.4))
        s.c(m + 0.45, m + 0.45, 0.16, 21, 28, mat('#6a6a62', metal=0.4))
        return {'layers': {'body': s.root}, 'meta': {'roof': 28, 'flag': [W - m - 0.3, Hh - m - 0.3]}}
    s.gable(m - 0.06, m - 0.06, W - m + 0.06, Hh - m + 0.06, 18, 13, mat(c['roof'], grime=0.35, scale=50))
    s.b(W - m - 0.5, m + 0.25, W - m - 0.3, m + 0.45, 20, 33, mat('#4a4038' if biome == 'arctic' else '#6a3a2e', grime=0.4))
    return {'layers': {'body': s.root}, 'meta': {'roof': 31, 'flag': [W - m - 0.3, Hh - m - 0.3]}}


def civ_tenement(biome, W, Hh):
    c = CIV[biome]
    s = Site(W, Hh)
    m = 0.14
    s.pad(2, mat(c['pave'], grime=0.5, scale=20))
    glass = mat(c['glass'], rough=0.2, metal=0.2, grime=0)
    wall = mat(c['walls'][1], grime=0.45, scale=24)
    levels, step = 4, 8
    zt = 2 + levels * step
    s.b(m, m, W - m, Hh - m, 2, zt, wall)
    for k in range(levels):
        z = 5 + k * step
        s.windows_y(m + 0.1, W - m - 0.1, Hh - m, z, max(2, round((W - 2 * m) * 2.6)), glass, lit=0.35, seed=50 + k, hgt=4.5, wid=0.13)
        s.windows_x(m + 0.1, Hh - m - 0.1, W - m, z, max(2, round((Hh - 2 * m) * 2.6)), glass, lit=0.35, seed=60 + k, hgt=4.5, wid=0.13)
        if k:
            s.b(m - 0.01, Hh - m - 0.01, W - m + 0.01, Hh - m + 0.015, 2 + k * step, 2.6 + k * step, mat(c['trim'], grime=0.4), bevel=0)
    s.b(W / 2 - 0.1, Hh - m - 0.005, W / 2 + 0.1, Hh - m + 0.015, 2, 10, mat('#2a2218'), bevel=0)
    if biome == 'jungle':
        s.gable(m - 0.06, m - 0.06, W - m + 0.06, Hh - m + 0.06, zt, 10, mat('#8a5a36', metal=0.3, grime=0.4))
        top = zt + 10
    else:
        s.b(m, m, W - m, Hh - m, zt, zt + 2, mat(c['flat'], grime=0.4))
        s.b(m + 0.3, m + 0.3, m + 0.75, m + 0.75, zt + 2, zt + 7, mat(c['flat'], grime=0.4))
        if biome != 'desert':
            s.b(W - m - 0.6, m + 0.3, W - m - 0.4, m + 0.5, zt, zt + 9, mat('#4a4038'))
        top = zt + 2
    return {'layers': {'body': s.root}, 'meta': {'roof': top, 'flag': [W - m - 0.3, Hh - m - 0.3]}}


def civ_office(biome):
    c = CIV[biome]
    W = Hh = 3
    s = Site(W, Hh)
    m = 0.14
    s.pad(2, mat(c['pave'], grime=0.5, scale=20))
    glass = mat(c['glass'], rough=0.2, metal=0.2, grime=0)
    wall = mat(c['walls'][2], grime=0.4, scale=24)
    levels, step = (3, 10) if biome == 'jungle' else (6, 7.5)
    zt = 2 + levels * step
    s.b(m, m, W - m, Hh - m, 2, zt, wall)
    for k in range(levels):
        z = 5 + k * step
        s.windows_y(m + 0.1, W - m - 0.1, Hh - m, z, 7, glass, lit=0.3, seed=70 + k, hgt=4.5, wid=0.18)
        s.windows_x(m + 0.1, Hh - m - 0.1, W - m, z, 7, glass, lit=0.3, seed=80 + k, hgt=4.5, wid=0.18)
    s.b(W / 2 - 0.15, Hh - m - 0.005, W / 2 + 0.15, Hh - m + 0.02, 2, 11, mat('#2a2218'), bevel=0)
    if biome == 'jungle':
        trim = mat(c['trim'], grime=0.3)
        for i in range(6):
            s.c(m + (W - 2 * m) * i / 5, Hh - m + 0.25, 0.03, 2, 14, trim, verts=8)
        s.b(m - 0.1, Hh - m, W - m + 0.1, Hh - m + 0.35, 13, 14.5, mat('#8a5a36', metal=0.3, grime=0.4))
        s.gable(m - 0.1, m - 0.1, W - m + 0.1, Hh - m + 0.1, zt, 12, mat('#8a5a36', metal=0.3, grime=0.4))
        top = zt + 12
    else:
        s.b(m, m, W - m, Hh - m, zt, zt + 2, mat(c['flat'], grime=0.4))
        if biome == 'desert':
            s.dome(W / 2, Hh / 2, 0.55, zt + 2, mat('#d0c4a4', grime=0.3), rz=22)
            top = zt + 2
        else:
            s.b(m + 0.4, m + 0.4, m + 1.2, m + 1.0, zt + 2, zt + 9, mat(c['flat'], grime=0.4))
            s.c(W - m - 0.4, m + 0.4, 0.01, zt + 2, zt + 22, mat('#2a2a26'), verts=6)
            top = zt + 2
    return {'layers': {'body': s.root}, 'meta': {'roof': top, 'flag': [W - m - 0.3, Hh - m - 0.3]}}


# ---------- registry ----------
def frame_for(w, h, top):
    """Image size (art px) for a w x h footprint whose tallest part reaches `top` px."""
    # extra room on the sides and bottom for long shadows
    bottom = 12 + int(top * 0.4)
    fw = (w + h) * 32 + 24 + int(top * 1.6) * 2
    fh = (w + h) * 16 + top + 12 + bottom
    # anchor (footprint centre) sits (w + h) * 8 + bottom px above the bottom edge
    shift = fh / 2 - ((w + h) * 8 + bottom)
    return dict(fw=fw, fh=fh, shift=shift)


def spec(build, w, h, top, dirs=None):
    def wrapped():
        init_mats()
        return build()
    return dict(build=wrapped, dirs=dirs or 1, **frame_for(w, h, top))


TURRET = {'body': 1, 'turret': 32}
SPECS = {
    'conyard_NATO': spec(n_conyard, 3, 3, 62),
    'power_NATO': spec(n_power, 2, 2, 52),
    'refinery_NATO': spec(n_refinery, 3, 3, 36),
    'barracks_NATO': spec(n_barracks, 2, 2, 52),
    'factory_NATO': spec(n_factory, 3, 3, 44),
    'radar_NATO': spec(n_radar, 2, 2, 50, {'body': 1, 'dish': 16}),
    'tech_NATO': spec(n_tech, 2, 2, 54),
    'silo_NATO': spec(n_silo, 2, 2, 20),
    'pillbox_NATO': spec(n_pillbox, 1, 1, 18, TURRET),
    'atgun_NATO': spec(n_atgun, 1, 1, 20, TURRET),
    'samsite_NATO': spec(n_samsite, 2, 2, 32, TURRET),
    'airfield_NATO': spec(lambda: airfield(False), 3, 3, 28),
    'conyard_PACT': spec(p_conyard, 3, 3, 80),
    'power_PACT': spec(p_power, 2, 2, 70),
    'refinery_PACT': spec(p_refinery, 3, 3, 60),
    'barracks_PACT': spec(p_barracks, 2, 2, 32),
    'factory_PACT': spec(p_factory, 3, 3, 68),
    'radar_PACT': spec(p_radar, 2, 2, 52, {'body': 1, 'dish': 16}),
    'tech_PACT': spec(p_tech, 2, 2, 88),
    'silo_PACT': spec(p_silo, 2, 2, 22),
    'pillbox_PACT': spec(p_pillbox, 1, 1, 18, TURRET),
    'atgun_PACT': spec(p_atgun, 1, 1, 18, TURRET),
    'samsite_PACT': spec(p_samsite, 2, 2, 36, TURRET),
    'airfield_PACT': spec(lambda: airfield(True), 3, 3, 40),
    'derrick_ALL': spec(derrick, 2, 2, 46),
}
for _b in CIV:
    SPECS[f'house_{_b}'] = spec(lambda b=_b: civ_house(b), 2, 2, 40)
    SPECS[f'tenement_{_b}'] = spec(lambda b=_b: civ_tenement(b, 2, 3), 2, 3, 52)
    SPECS[f'tenementB_{_b}'] = spec(lambda b=_b: civ_tenement(b, 3, 2), 3, 2, 52)
    SPECS[f'office_{_b}'] = spec(lambda b=_b: civ_office(b), 3, 3, 76)
