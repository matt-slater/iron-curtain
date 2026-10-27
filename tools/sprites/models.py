# Procedural 3D models for the sprite renderer (run inside Blender via render.py).
# Units: 1 Blender unit = 1 map tile; forward is +X, left is +Y, heights via H(art pixels).
import bpy, bmesh, math
from mathutils import Vector


def H(px):
    return px / 39.2


# ---------- materials ----------
def lin(hexstr):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1,)


_mats = {}


def mat(hexstr, rough=0.78, metal=0.0, grime=0.28, camo=None, emit=0.0, scale=38.0):
    """Principled material with noise grime; camo=[hex, hex, ...] gives a blotchy multi-colour pattern."""
    key = (hexstr, rough, metal, grime, tuple(camo or ()), emit, scale)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(f'm{len(_mats)}')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    coord = nt.nodes.new('ShaderNodeTexCoord')
    if camo:
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = scale * 0.16
        noise.inputs['Detail'].default_value = 1.5
        nt.links.new(coord.outputs['Object'], noise.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.interpolation = 'CONSTANT'
        cols = [hexstr] + list(camo)
        els = ramp.color_ramp.elements
        while len(els) < len(cols): els.new(0.5)
        for i, c in enumerate(cols):
            els[i].position = 0.0 if i == 0 else 0.30 + 0.48 * i / len(cols)
            els[i].color = lin(c)
        nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
        base = ramp.outputs['Color']
    else:
        rgb = nt.nodes.new('ShaderNodeRGB')
        rgb.outputs[0].default_value = lin(hexstr)
        base = rgb.outputs[0]
    if grime > 0:
        g = nt.nodes.new('ShaderNodeTexNoise')
        g.inputs['Scale'].default_value = scale
        g.inputs['Detail'].default_value = 6
        nt.links.new(coord.outputs['Object'], g.inputs['Vector'])
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = grime
        nt.links.new(base, mix.inputs['A'])
        nt.links.new(g.outputs['Color'], mix.inputs['B'])
        base = mix.outputs['Result']
    nt.links.new(base, bsdf.inputs['Base Color'])
    if emit:
        nt.links.new(base, bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


TEAM = '#b4b2a8'  # neutral light grey; the game tints these pixels with the player's colour


def team_mat():
    return mat(TEAM, rough=0.6, grime=0.18)


# ---------- geometry ----------
def _obj(name, bm, material, parent, team=False, smooth=False, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    if parent: o.parent = parent
    if team: o['team'] = 1
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = 1
        b.limit_method = 'ANGLE'
    return o


def loft(name, bottom, z0, top, z1, material, parent=None, team=False, bevel=0.006, origin=(0, 0), open_top=False):
    """Extrudes polygon `bottom` at z0 to polygon `top` at z1 (same vertex count, CCW, x/y pairs)."""
    bm = bmesh.new()
    ox, oy = origin
    b = [bm.verts.new((x + ox, y + oy, z0)) for x, y in bottom]
    t = [bm.verts.new((x + ox, y + oy, z1)) for x, y in top]
    n = len(b)
    bm.faces.new(list(reversed(b)))
    if not open_top: bm.faces.new(t)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((b[i], b[j], t[j], t[i]))
    return _obj(name, bm, material, parent, team, bevel=bevel)


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def box(name, x0, x1, y0, y1, z0, z1, material, parent=None, team=False, bevel=0.006):
    r = rect(x0, x1, y0, y1)
    return loft(name, r, z0, r, z1, material, parent, team, bevel)


def side_profile(name, pts_xz, y0, y1, material, parent=None, team=False, bevel=0.006):
    """Extrudes a polygon drawn in the X/Z plane across Y (tracks, hulls seen from the side)."""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in pts_xz]
    b = [bm.verts.new((x, y1, z)) for x, z in pts_xz]
    n = len(a)
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[j], a[i], b[i], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, material, parent, team, bevel=bevel)


def cyl(name, r, length, loc, axis, material, parent=None, team=False, verts=14, r2=None):
    """Cylinder (or cone frustum with r2) of `length` centred at loc along axis 'x', 'y' or 'z'."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=length)
    rot = {'x': (0, math.pi / 2, 0), 'y': (math.pi / 2, 0, 0), 'z': (0, 0, 0)}[axis]
    from mathutils import Euler, Matrix
    m = Matrix.Translation(Vector(loc)) @ Euler(rot).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _obj(name, bm, material, parent, team, smooth=True)


def barrel(name, x0, length, r, y, z, material, parent, yaw=0.0):
    """Gun barrel along +X starting at x0."""
    o = cyl(name, r, length, (x0 + length / 2, y, z), 'x', material, parent, verts=10)
    return o


def dome(name, rx, ry, rz, loc, material, parent=None, team=False, segs=20, cut=0.0):
    """Upper half of an ellipsoid sitting on z=loc.z (cut>0 trims the top flat)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=1)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
    if cut:
        for v in bm.verts:
            if v.co.z > 1 - cut: v.co.z = 1 - cut
    edge = [e for e in bm.edges if e.is_boundary]
    if edge: bmesh.ops.holes_fill(bm, edges=edge)
    for v in bm.verts:
        v.co = Vector((v.co.x * rx + loc[0], v.co.y * ry + loc[1], v.co.z * rz + loc[2]))
    return _obj(name, bm, material, parent, team, smooth=True)


def sphere(name, r, loc, material, parent=None, scale=(1, 1, 1), team=False):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0] + loc[0], v.co.y * scale[1] + loc[1], v.co.z * scale[2] + loc[2]))
    return _obj(name, bm, material, parent, team, smooth=True)


def star(name, loc, size, facing, material, parent):
    """Flat five-pointed star decal standing on a vertical face; facing is the outward direction ('+y', '-y', '+x', '-x')."""
    bm = bmesh.new()
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        r = size if i % 2 == 0 else size * 0.42
        pts.append((math.cos(a) * r, math.sin(a) * r))
    c = bm.verts.new((0, 0, 0))
    vs = [bm.verts.new((u, 0, v)) for u, v in pts]
    for i in range(10):
        bm.faces.new((c, vs[i], vs[(i + 1) % 10]))
    from mathutils import Matrix
    if facing == '+z':
        rotm = Matrix.Rotation(-math.pi / 2, 4, 'X')  # lie flat, pointing forward
    else:
        rotm = Matrix.Rotation({'+y': 0, '-y': math.pi, '+x': -math.pi / 2, '-x': math.pi / 2}[facing], 4, 'Z')
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(loc)) @ rotm, verts=bm.verts)
    return _obj(name, bm, material, parent)


def root(name):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    return o


def pivot(name, parent, loc):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    return o


# ---------- shared vehicle parts ----------
def tracks(parent, L, yc, w, h, wheels, steel, rubber, return_rollers=0, skirt=None):
    for s in (1, -1):
        y = yc * s
        side_profile('track', [(-L, H(2.2)), (-L + 0.05, 0), (L - 0.07, 0), (L + 0.01, H(2.8)), (L - 0.02, h), (-L + 0.01, h)],
                     y - w / 2, y + w / 2, rubber, parent)
        for i in range(wheels):
            x = -L + 0.1 + i * (2 * L - 0.2) / (wheels - 1)
            cyl('wheel', H(2.5), 0.025, (x, y + s * (w / 2 + 0.006), H(2.6)), 'y', steel, parent, verts=12)
            cyl('hub', H(0.9), 0.03, (x, y + s * (w / 2 + 0.012), H(2.6)), 'y', rubber, parent, verts=8)
        for i in range(return_rollers):
            x = -L + 0.25 + i * (2 * L - 0.5) / max(1, return_rollers - 1)
            cyl('roller', H(0.9), 0.02, (x, y + s * (w / 2 + 0.004), h - H(1.3)), 'y', steel, parent, verts=8)
        cyl('sprocket', H(2.0), 0.03, (-L + 0.03, y + s * (w / 2 + 0.006), H(3.8)), 'y', rubber, parent, verts=10)
        if skirt:
            box('skirt', -L + 0.06, L - 0.02, y + s * w / 2 - 0.005 if s > 0 else y - w / 2 - 0.009,
                y + w / 2 + 0.009 if s > 0 else y - w / 2 + 0.005, H(3.2), h + H(0.4), skirt, parent)


def wheelset(parent, xs, yc, r, steel, rubber, width=0.06):
    for x in xs:
        for s in (1, -1):
            cyl('tyre', r, width, (x, s * yc, r), 'y', rubber, parent, verts=16)
            cyl('rim', r * 0.5, width + 0.008, (x, s * yc, r), 'y', steel, parent, verts=10)


# ---------- T-72 (Warsaw Pact main tank) ----------
PACT = dict(hull='#4d8034', dark='#36602a', drum='#40522c', rubber='#25261f', steel='#4c5a3c', rust='#8a4a26')


def t72():
    body, tur = root('body'), root('turret')
    hull = mat(PACT['hull'], grime=0.2)
    dark = mat(PACT['dark'], grime=0.3)
    rubber = mat(PACT['rubber'], rough=0.9, grime=0.1)
    steel = mat(PACT['steel'], rough=0.6, metal=0.3)
    L, W = 0.47, 0.34
    tracks(body, L - 0.01, 0.255, 0.13, H(5.4), 6, steel, rubber)
    box('lower', -L, L - 0.04, -0.2, 0.2, H(1.8), H(5.4), dark, body)
    # upper hull with the long sloped glacis
    loft('upper', rect(-L, L + 0.01, -W, W), H(5.4), rect(-L + 0.01, L - 0.2, -W + 0.015, W - 0.015), H(8.2), hull, body)
    # dozer blade under the nose
    side_profile('blade', [(L - 0.02, H(2.2)), (L + 0.045, H(2.6)), (L + 0.03, H(5.4)), (L - 0.01, H(5.4))], -0.22, 0.22, dark, body)
    # reactive armour bricks on the glacis
    for i in range(6):
        y = -0.22 + i * 0.088
        loft('era', rect(L - 0.17, L - 0.04, y - 0.036, y + 0.036), H(6.4), rect(L - 0.17, L - 0.08, y - 0.036, y + 0.036), H(8.4), mat('#56603e', grime=0.4), body, bevel=0.003)
    # fender stowage boxes (team colour) and side fuel tanks
    for s in (1, -1):
        box('stow', -0.05, 0.22, s * (W - 0.06) - 0.035, s * (W - 0.06) + 0.035, H(8.2), H(10.0), team_mat(), body, team=True)
        box('ftank', -0.36, -0.12, s * (W - 0.055) - 0.035, s * (W - 0.055) + 0.035, H(8.2), H(9.6), dark, body)
    # rear deck: exhaust grille and two fuel drums lying across
    box('grille', -L + 0.02, -0.2, -0.16, 0.16, H(8.2), H(8.6), mat('#2a2e22', grime=0.5), body)
    for s in (1, -1):
        cyl('drum', H(2.0), 0.15, (-L + 0.045, s * 0.12, H(10.0)), 'y', mat(PACT['drum'], grime=0.45, metal=0.2), body)
    # turret: low cast dome with the 125 mm gun, cupola and IR searchlight
    turret = mat('#548a38', grime=0.18)
    dome('dome', 0.27, 0.25, H(6.4), (0.0, 0, H(8.2)), turret, tur, cut=0.05)
    cyl('ring', 0.24, H(0.8), (0, 0, H(8.4)), 'z', dark, tur, verts=20)
    box('mantlet', 0.18, 0.27, -0.06, 0.06, H(9.6), H(13), dark, tur)
    barrel('gun', 0.25, 0.52, H(1.15), 0, H(11.4), mat('#3a4030', grime=0.2, metal=0.3), tur)
    cyl('sleeve', H(1.45), 0.1, (0.44, 0, H(11.4)), 'x', mat('#4a5438', grime=0.2), tur, verts=10)
    cyl('cupola', 0.065, H(1.6), (-0.02, -0.1, H(14.0)), 'z', turret, tur, verts=12)
    barrel('nsvt', -0.02, 0.18, H(0.45), -0.1, H(15.6), mat('#1c1d18'), tur)
    box('irlight', 0.12, 0.2, 0.08, 0.15, H(12.6), H(14.6), mat('#9a9a88', rough=0.4), tur)
    sphere('irlens', H(0.8), (0.205, 0.115, H(13.6)), mat('#6e1c14', rough=0.3, emit=0.3), tur)
    # team-colour stowage bin around the turret rear, plus the snorkel tube
    loft('bin', [(-0.3, -0.17), (-0.18, -0.2), (-0.18, 0.2), (-0.3, 0.17)], H(9.0),
         [(-0.3, -0.16), (-0.18, -0.19), (-0.18, 0.19), (-0.3, 0.16)], H(12.0), team_mat(), tur, team=True)
    cyl('snorkel', H(1.0), 0.32, (-0.26, 0, H(12.6)), 'y', dark, tur)
    red = mat('#c42a1c', rough=0.5, grime=0.05)
    for s in (1, -1):
        star('star', (-0.06, s * 0.235, H(11.2)), 0.045, '+y' if s > 0 else '-y', red, tur)
    return {'layers': {'body': body, 'turret': tur}}


# ---------- M60 Patton (NATO main tank) ----------
NATO = dict(hull='#6f6c34', camo=['#6a4220', '#1e1d16', '#46602a'], rubber='#24251f', steel='#5a5844')


def m60():
    body, tur = root('body'), root('turret')
    hull = mat(NATO['hull'], camo=NATO['camo'], grime=0.15, scale=30)
    rubber = mat(NATO['rubber'], rough=0.9, grime=0.1)
    steel = mat(NATO['steel'], rough=0.6, metal=0.3)
    plain = mat('#5e5a2c', grime=0.2)
    L, W = 0.49, 0.34
    tracks(body, L - 0.02, 0.255, 0.13, H(5.6), 6, steel, rubber, return_rollers=3)
    box('lower', -L, L - 0.05, -0.2, 0.2, H(1.8), H(5.6), plain, body)
    # boat-shaped upper hull with a short glacis
    loft('upper', [(-L, -W), (L - 0.06, -W), (L + 0.02, -W + 0.08), (L + 0.02, W - 0.08), (L - 0.06, W), (-L, W)], H(5.6),
         [(-L + 0.01, -W + 0.01), (L - 0.14, -W + 0.01), (L - 0.09, -W + 0.08), (L - 0.09, W - 0.08), (L - 0.14, W - 0.01), (-L + 0.01, W - 0.01)], H(8.6), hull, body)
    for s in (1, -1):
        box('toolbox', -0.32, -0.06, s * (W - 0.05) - 0.035, s * (W - 0.05) + 0.035, H(8.6), H(10.2), team_mat(), body, team=True)
        sphere('headlight', H(0.9), (L - 0.02, s * (W - 0.06), H(8.8)), mat('#c8c4a8', rough=0.3), body)
    box('grille', -L + 0.02, -0.25, -0.2, 0.2, H(8.6), H(9.0), mat('#2a2c24', grime=0.5), body)
    # tall cast turret with pointed nose
    t = mat(NATO['hull'], camo=NATO['camo'], grime=0.15, scale=36)
    loft('turret', [(-0.29, -0.2), (0.12, -0.22), (0.27, -0.09), (0.27, 0.09), (0.12, 0.22), (-0.29, 0.2)], H(8.6),
         [(-0.27, -0.15), (0.06, -0.17), (0.18, -0.07), (0.18, 0.07), (0.06, 0.17), (-0.27, 0.15)], H(14.2), t, tur, bevel=0.012)
    box('mantlet', 0.22, 0.3, -0.07, 0.07, H(9.6), H(13.4), plain, tur)
    barrel('gun', 0.28, 0.5, H(1.05), 0, H(11.6), mat('#3a3e2e', metal=0.3, grime=0.2), tur)
    cyl('evac', H(1.55), 0.08, (0.6, 0, H(11.6)), 'x', plain, tur, verts=10)
    # xenon searchlight box above the gun
    box('search', 0.16, 0.28, -0.07, 0.07, H(14.2), H(17.0), plain, tur)
    box('lens', 0.28, 0.29, -0.055, 0.055, H(14.6), H(16.6), mat('#bfc4b4', rough=0.2, emit=0.2), tur)
    # M19 commander's cupola with .50 cal
    cyl('cupola', 0.075, H(2.6), (-0.07, -0.08, H(15.4)), 'z', t, tur, verts=14)
    box('cupola_top', -0.12, -0.02, -0.12, -0.04, H(16.7), H(17.4), plain, tur)
    barrel('m85', -0.02, 0.2, H(0.5), -0.08, H(16.2), mat('#1c1d18'), tur)
    # team-colour bustle rack at the turret rear
    loft('bustle', rect(-0.4, -0.27, -0.17, 0.17), H(9.4), rect(-0.4, -0.27, -0.16, 0.16), H(12.8), team_mat(), tur, team=True)
    return {'layers': {'body': body, 'turret': tur}}


# ---------- ore trucks ----------
def ore_truck_nato():
    body = root('body')
    cab = mat('#6f6c34', camo=['#6a4220', '#1e1d16', '#46602a'], grime=0.15, scale=30)
    bodyc = mat('#9a8650', grime=0.25)
    rubber = mat('#1d1e19', rough=0.92, grime=0.05)
    steel = mat('#5a5c50', rough=0.55, metal=0.35)
    L, W = 0.6, 0.38
    wheelset(body, [-0.42, -0.2, 0.4], W - 0.03, H(4.6), steel, rubber, 0.07)
    box('chassis', -L, L - 0.02, -0.24, 0.24, H(3.0), H(6.0), mat('#2e2f28', grime=0.3), body)
    # forward cab with sloped windscreen
    loft('cab', rect(0.3, L, -W + 0.05, W - 0.05), H(6.0), rect(0.3, L - 0.07, -W + 0.07, W - 0.07), H(16.0), cab, body)
    loft('glass', rect(L - 0.075, L - 0.005, -W + 0.09, W - 0.09), H(11.0), rect(L - 0.085, L - 0.065, -W + 0.09, W - 0.09), H(15.4),
         mat('#4c6674', rough=0.15, metal=0.2, grime=0.0), body, bevel=0)
    box('roof_light', 0.4, 0.46, -0.06, 0.06, H(16), H(17.2), mat('#d39a2a', rough=0.4, emit=0.4), body)
    # big flared ore hopper, team-coloured rim
    loft('hopper', rect(-L, 0.26, -W + 0.02, W - 0.02), H(6.0), rect(-L - 0.03, 0.27, -W - 0.03, W + 0.03), H(17.0), bodyc, body, open_top=True, bevel=0)
    for s in (1, -1):
        box('rim', -L - 0.03, 0.27, s * (W + 0.03) - (0.035 if s > 0 else 0), s * (W + 0.03) + (0 if s > 0 else 0.035), H(15.0), H(18.0), team_mat(), body, team=True)
    box('ore', -L + 0.03, 0.22, -W + 0.06, W - 0.06, H(13.0), H(14.0), mat('#9c7a2a', rough=0.5, metal=0.4, grime=0.6, scale=90), body)
    for i in range(5):
        x = -L + 0.03 + i * 0.2
        box('rib', x, x + 0.03, -W - 0.04, W + 0.04, H(7), H(16.8), mat('#5c5644', grime=0.4), body)
    # hazard-striped bumper and front auger
    box('bumper', L - 0.02, L + 0.03, -W + 0.04, W - 0.04, H(3.4), H(6.0), mat('#c9a227', grime=0.35), body)
    cyl('auger', H(2.0), 0.6, (L + 0.07, 0, H(2.4)), 'y', steel, body)
    return {'layers': {'body': body}}


def war_miner():
    body = root('body')
    hull = mat(PACT['hull'], grime=0.22)
    rust = mat(PACT['rust'], grime=0.5, rough=0.85)
    rubber = mat(PACT['rubber'], rough=0.9, grime=0.1)
    steel = mat(PACT['steel'], rough=0.6, metal=0.3)
    L, W = 0.62, 0.42
    tracks(body, L - 0.02, 0.32, 0.15, H(6.0), 7, steel, rubber)
    box('lower', -L, L - 0.05, -0.25, 0.25, H(1.8), H(6.0), mat(PACT['dark'], grime=0.35), body)
    # armoured cab at the front-left with vision slits
    loft('cab', rect(0.26, L, -W + 0.02, 0.06), H(6.0), rect(0.28, L - 0.06, -W + 0.04, 0.04), H(15.5), hull, body)
    box('slit', L - 0.065, L - 0.055, -W + 0.08, 0.0, H(12.5), H(13.5), mat('#121310'), body)
    star('star', (0.43, -W + 0.015, H(10.0)), 0.05, '-y', mat('#c42a1c', rough=0.5, grime=0.05), body)
    # angled ore intake with teeth on the right of the nose
    loft('intake', rect(0.26, L + 0.06, 0.08, W - 0.02), H(2.0), rect(0.26, L - 0.06, 0.1, W - 0.04), H(10.0), mat('#3e3a30', grime=0.5), body)
    for i in range(5):
        y = 0.1 + i * 0.065
        loft('tooth', [(L + 0.05, y - 0.012), (L + 0.1, y), (L + 0.05, y + 0.012)], H(2.0), [(L + 0.05, y - 0.012), (L + 0.1, y), (L + 0.05, y + 0.012)], H(3.2), steel, body, bevel=0)
    # rusty riveted hopper with a team-coloured band
    loft('hopper', rect(-L, 0.24, -W, W), H(6.0), rect(-L + 0.02, 0.22, -W + 0.02, W - 0.02), H(17.5), rust, body, open_top=True, bevel=0)
    for s in (1, -1):
        box('band', -L - 0.005, 0.245, s * W - (0.012 if s > 0 else -0.0), s * W + (0.0 if s > 0 else -0.012) + (0.012 if s > 0 else 0), H(11.0), H(14.0), team_mat(), body, team=True)
    box('band_r', -L - 0.012, -L, -W, W, H(11.0), H(14.0), team_mat(), body, team=True)
    for i in range(6):
        x = -L + 0.06 + i * 0.15
        box('rib', x, x + 0.025, -W - 0.012, W + 0.012, H(6.5), H(17.2), mat('#5a3a24', grime=0.6), body)
    box('ore', -L + 0.04, 0.2, -W + 0.05, W - 0.05, H(13.5), H(14.5), mat('#9c7a2a', rough=0.5, metal=0.4, grime=0.6, scale=90), body)
    cyl('stack', H(1.4), H(8), (-0.05, -W + 0.06, H(19)), 'z', mat('#2a2622', grime=0.6), body)
    # roof machine gun, fixed forward (it sits off-centre, so it can't use the centre-pivoting turret layer)
    cyl('mgbase', 0.06, H(1.5), (0.42, -0.17, H(16.2)), 'z', hull, body, verts=12)
    box('mgshield', 0.42, 0.47, -0.24, -0.1, H(16.8), H(20), hull, body)
    barrel('mg', 0.42, 0.26, H(0.6), -0.17, H(18.5), mat('#1c1d18', metal=0.3), body)
    return {'layers': {'body': body}}




# ---------- shared faction materials ----------
CAMO = ['#6a4220', '#1e1d16', '#46602a']
RED = '#c42a1c'


def nato_set(base='#6f6c34', camo=CAMO, scale=30):
    return dict(hull=mat(base, camo=camo, grime=0.15, scale=scale), plain=mat('#5e5a2c', grime=0.2),
                rubber=mat('#24251f', rough=0.9, grime=0.1), steel=mat('#5a5844', rough=0.6, metal=0.3),
                gun=mat('#2c2c24', metal=0.3, grime=0.2), glass=mat('#4c6674', rough=0.15, metal=0.2, grime=0))


def pact_set(base=None):
    return dict(hull=mat(base or PACT['hull'], grime=0.2), turret=mat('#548a38', grime=0.18), dark=mat(PACT['dark'], grime=0.25),
                rubber=mat(PACT['rubber'], rough=0.9, grime=0.1), steel=mat(PACT['steel'], rough=0.6, metal=0.3),
                gun=mat('#2c3424', metal=0.3, grime=0.2), red=mat(RED, rough=0.5, grime=0.05),
                glass=mat('#4c6674', rough=0.15, metal=0.2, grime=0))


def hull_shape(L, W, nose=0.08, tail=0.0):
    """Hull outline with chamfered front corners (and optionally rear)."""
    return [(-L, -W + tail), (-L + tail, -W), (L - nose, -W), (L, -W + nose), (L, W - nose), (L - nose, W), (-L + tail, W), (-L, W - tail)]


def scaled(pts, k, dx=0.0):
    return [(x * k + dx, y * k) for x, y in pts]


def tracked_hull(body, m, L, W, z_top, wheels=6, rollers=0, skirt=None, glacis=0.18, track_w=0.13):
    tracks(body, L - 0.01, W - track_w / 2 + 0.005, track_w, H(5.4), wheels, m['steel'], m['rubber'], return_rollers=rollers, skirt=skirt)
    box('lower', -L, L - 0.04, -W + track_w, W - track_w, H(1.8), H(5.4), m.get('dark', m.get('plain')), body)
    loft('upper', rect(-L, L, -W - 0.005, W + 0.005), H(5.4), rect(-L + 0.01, L - glacis, -W + 0.01, W - 0.01), z_top, m['hull'], body)


# ---------- NATO vehicles ----------
def m151():
    body, tur = root('body'), root('turret')
    m = nato_set()
    wheelset(body, [-0.2, 0.2], 0.17, H(3.2), m['steel'], m['rubber'], 0.05)
    box('chassis', -0.33, 0.33, -0.13, 0.13, H(2.6), H(4.6), mat('#22231c'), body)
    loft('tub', rect(-0.33, 0.12, -0.17, 0.17), H(4.2), rect(-0.32, 0.12, -0.165, 0.165), H(8.0), m['hull'], body, open_top=True)
    box('floor', -0.3, 0.1, -0.15, 0.15, H(4.6), H(5.2), mat('#2a2a22'), body)
    for s in (1, -1):
        box('seat', -0.02, 0.08, s * 0.08 - 0.04, s * 0.08 + 0.04, H(5.2), H(8.8), mat('#3a3426'), body)
    loft('hood', rect(0.12, 0.35, -0.16, 0.16), H(4.2), rect(0.12, 0.33, -0.15, 0.15), H(8.0), m['hull'], body)
    box('star', 0.18, 0.28, -0.05, 0.05, H(8.0), H(8.3), team_mat(), body, team=True, bevel=0)
    box('screen', 0.1, 0.125, -0.15, 0.15, H(8.0), H(12.5), m['glass'], body, bevel=0)
    cyl('spare', H(2.4), 0.05, (-0.36, 0, H(6.5)), 'x', m['rubber'], body)
    box('jerry', -0.32, -0.26, 0.09, 0.15, H(8.0), H(10.5), team_mat(), body, team=True)
    # pintle-mounted M60 (turret layer, pivot just behind centre)
    cyl('post', H(0.6), H(5.5), (0, 0, H(10.5)), 'z', m['steel'], tur, verts=8)  # sits at the -0.08 pivot
    barrel('m60', -0.06, 0.3, H(0.7), 0, H(13.4), m['gun'], tur)
    box('mgbody', -0.07, 0.06, -0.022, 0.022, H(12.6), H(14.0), m['gun'], tur, bevel=0)
    box('ammo', -0.02, 0.04, 0.025, 0.06, H(12.4), H(13.6), mat('#4e5232'), tur, bevel=0)
    return {'layers': {'body': body, 'turret': tur}, 'pivot': -0.08}


def m109():
    body, tur = root('body'), root('turret')
    m = nato_set()
    L, W = 0.5, 0.36
    tracked_hull(body, m, L, W, H(8.0), wheels=7, glacis=0.12)
    box('stow', 0.18, 0.4, -0.3, 0.3, H(8.0), H(9.2), m['plain'], body)
    loft('turret', rect(-0.42, 0.2, -0.27, 0.27), H(8.0), rect(-0.4, 0.16, -0.26, 0.26), H(17.0), m['hull'], tur, bevel=0.012)
    box('bustle', -0.48, -0.4, -0.22, 0.22, H(10), H(15.5), team_mat(), tur, team=True)
    box('mantlet', 0.16, 0.24, -0.08, 0.08, H(10.5), H(15), m['plain'], tur)
    barrel('gun', 0.22, 0.62, H(1.4), 0, H(13), m['gun'], tur)
    box('brake', 0.8, 0.88, -0.035, 0.035, H(12), H(14.2), m['gun'], tur, bevel=0)
    cyl('hatch', 0.06, H(1), (-0.15, -0.14, H(17.5)), 'z', m['plain'], tur, verts=12)
    barrel('m2', -0.15, 0.2, H(0.5), -0.14, H(19), mat('#1c1d18'), tur)
    return {'layers': {'body': body, 'turret': tur}}


def m113_hull(body, m, L=0.44, W=0.32):
    tracks(body, L - 0.01, W - 0.06, 0.12, H(5.0), 5, m['steel'], m['rubber'])
    loft('hull', [(-L, -W + 0.06), (L - 0.02, -W + 0.06), (L + 0.03, -0.2), (L + 0.03, 0.2), (L - 0.02, W - 0.06), (-L, W - 0.06)], H(2.4),
         [(-L, -W + 0.06), (L - 0.16, -W + 0.06), (L - 0.13, -0.2), (L - 0.13, 0.2), (L - 0.16, W - 0.06), (-L, W - 0.06)], H(11.0), m['hull'], body)
    box('fender', -L, L, -W, W, H(5.0), H(5.6), m['plain'], body)


def vulcan():
    body, tur = root('body'), root('turret')
    m = nato_set()
    m113_hull(body, m)
    box('rampbox', -0.46, -0.42, -0.2, 0.2, H(4), H(10), team_mat(), body, team=True)
    cyl('ring', 0.17, H(1.5), (-0.05, 0, H(11.6)), 'z', m['plain'], tur, verts=16)
    box('mount', -0.16, 0.08, -0.13, 0.13, H(12), H(16), m['hull'], tur)
    box('side', -0.16, 0.06, 0.13, 0.17, H(12), H(16.5), team_mat(), tur, team=True)
    gat = pivot('gat', tur, (0.05, -0.02, H(15)))
    for i in range(6):
        a = i * math.pi / 3
        cyl('b', H(0.4), 0.4, (0.22, math.cos(a) * 0.022, math.sin(a) * 0.022), 'x', m['gun'], gat, verts=6)
    cyl('drum', 0.05, 0.1, (0.0, 0, 0), 'x', m['gun'], gat, verts=12)
    cyl('dish', 0.07, 0.02, (-0.06, 0.2, H(19)), 'y', mat('#a8a898', rough=0.4), tur, verts=16)
    cyl('dishpost', H(0.4), H(3), (-0.06, 0.17, H(17.5)), 'z', m['steel'], tur, verts=6)
    return {'layers': {'body': body, 'turret': tur}}


def abrams():
    body, tur = root('body'), root('turret')
    m = nato_set('#9a8a5a', ['#6a5432', '#3e3a2a'], 26)
    L, W = 0.52, 0.37
    tracks(body, L - 0.01, W - 0.07, 0.14, H(5.4), 7, m['steel'], m['rubber'], skirt=m['hull'])
    box('lower', -L, L - 0.04, -0.23, 0.23, H(1.8), H(5.4), m['plain'], body)
    loft('upper', rect(-L, L, -W, W), H(5.4), rect(-L + 0.01, L - 0.22, -W + 0.01, W - 0.01), H(8.6), m['hull'], body)
    # wide, low, angular turret
    shape = [(-0.34, -0.25), (0.14, -0.27), (0.3, -0.14), (0.3, 0.14), (0.14, 0.27), (-0.34, 0.25)]
    loft('turret', shape, H(8.6), scaled(shape, 0.9, -0.02), H(13.6), m['hull'], tur, bevel=0.01)
    box('bustle', -0.46, -0.33, -0.2, 0.2, H(9.4), H(13), team_mat(), tur, team=True)
    barrel('gun', 0.28, 0.55, H(1.15), 0, H(11.4), m['gun'], tur)
    cyl('cupola', 0.065, H(1.8), (-0.1, -0.12, H(14.4)), 'z', m['hull'], tur, verts=12)
    barrel('m2', -0.1, 0.2, H(0.5), -0.12, H(15.6), mat('#1c1d18'), tur)
    for s in (1, -1):
        box('smoke', 0.06, 0.12, s * 0.27 - 0.02, s * 0.27 + 0.02, H(11), H(13), m['plain'], tur, bevel=0)
    return {'layers': {'body': body, 'turret': tur}}


def leopard2():
    body, tur = root('body'), root('turret')
    m = nato_set('#3f5a2a', ['#5a4228', '#1a1a14'], 34)
    L, W = 0.52, 0.36
    tracks(body, L - 0.01, W - 0.07, 0.14, H(5.4), 7, m['steel'], m['rubber'], return_rollers=4, skirt=m['hull'])
    box('lower', -L, L - 0.04, -0.22, 0.22, H(1.8), H(5.4), m['plain'], body)
    loft('upper', rect(-L, L, -W, W), H(5.4), rect(-L + 0.01, L - 0.12, -W + 0.01, W - 0.01), H(8.8), m['hull'], body)
    # tall boxy turret with vertical front armour
    loft('turret', rect(-0.36, 0.26, -0.24, 0.24), H(8.8), rect(-0.34, 0.24, -0.22, 0.22), H(15.0), m['hull'], tur, bevel=0.012)
    box('bustle', -0.46, -0.36, -0.2, 0.2, H(9.6), H(14), team_mat(), tur, team=True)
    barrel('gun', 0.26, 0.64, H(1.1), 0, H(11.8), m['gun'], tur)
    box('periscope', 0.06, 0.16, 0.08, 0.16, H(15), H(17), m['plain'], tur)
    return {'layers': {'body': body, 'turret': tur}}


def merkava():
    body, tur = root('body'), root('turret')
    m = nato_set('#9a9278', ['#7a7258'], 50)
    L, W = 0.55, 0.36
    tracks(body, L - 0.01, W - 0.07, 0.14, H(5.4), 6, m['steel'], m['rubber'], skirt=m['hull'])
    box('lower', -L, L - 0.04, -0.22, 0.22, H(1.8), H(5.4), m['plain'], body)
    # engine in front: long sloping nose
    loft('upper', rect(-L, L, -W, W), H(5.4), rect(-L + 0.01, L - 0.3, -W + 0.01, W - 0.01), H(9.0), m['hull'], body)
    # long low wedge turret set well back
    shape = [(0.3, 0), (0.06, -0.2), (-0.38, -0.21), (-0.42, -0.12), (-0.42, 0.12), (-0.38, 0.21), (0.06, 0.2)]
    loft('turret', [(x - 0.06, y) for x, y in shape], H(9.0), [(x * 0.9 - 0.08, y * 0.85) for x, y in shape], H(13.6), m['hull'], tur, bevel=0.01)
    barrel('gun', 0.22, 0.56, H(1.1), 0, H(11.4), m['gun'], tur)
    box('basket', -0.58, -0.47, -0.17, 0.17, H(9.4), H(12.6), team_mat(), tur, team=True)
    for i in range(7):
        sphere('chain', 0.014, (-0.5, -0.15 + i * 0.05, H(8.2)), mat('#2a2a22'), tur)
    cyl('cupola', 0.06, H(1.6), (-0.18, 0.1, H(14.3)), 'z', m['hull'], tur, verts=12)
    return {'layers': {'body': body, 'turret': tur}}


def pluton():
    body = root('body')
    m = nato_set('#5d6a3a', ['#3e3424', '#1e1d16'], 30)
    L, W = 0.52, 0.36
    tracked_hull(body, m, L, W, H(8.6), wheels=5, glacis=0.14)
    # big missile container on a cradle, fixed fore-aft
    cradle = pivot('cradle', body, (-0.3, 0, H(10)))
    cradle.rotation_euler = (0, -0.08, 0)
    box('container', 0.0, 0.9, -0.1, 0.1, 0, H(7.5), mat('#c8c0a8', rough=0.5, grime=0.25), cradle)
    box('band', 0.45, 0.55, -0.105, 0.105, -H(0.2), H(7.7), team_mat(), cradle, team=True, bevel=0)
    box('cap', 0.88, 0.92, -0.08, 0.08, H(1), H(6.5), mat('#8c2a1a'), cradle, bevel=0)
    box('legs', -0.1, 0.05, -0.12, 0.12, -H(2), 0, m['plain'], cradle)
    return {'layers': {'body': body}}


def g6():
    body, tur = root('body'), root('turret')
    m = nato_set('#9a8650', ['#7a6640'], 40)
    L, W = 0.58, 0.38
    wheelset(body, [-0.38, -0.05, 0.34], W - 0.04, H(4.4), m['steel'], m['rubber'], 0.08)
    loft('hull', [(-L, -W + 0.07), (L - 0.15, -W + 0.07), (L + 0.02, -0.12), (L + 0.02, 0.12), (L - 0.15, W - 0.07), (-L, W - 0.07)], H(3.0),
         [(-L, -W + 0.08), (L - 0.22, -W + 0.08), (L - 0.06, -0.1), (L - 0.06, 0.1), (L - 0.22, W - 0.08), (-L, W - 0.08)], H(10.0), m['hull'], body)
    box('cab', 0.22, 0.46, -0.2, 0.2, H(10), H(13.5), m['hull'], body)
    box('screens', 0.455, 0.465, -0.17, 0.17, H(11), H(13), m['glass'], body, bevel=0)
    # turret sits towards the rear; the game pivots it at -0.2 along the hull
    loft('turret', rect(-0.3, 0.2, -0.25, 0.25), H(10), rect(-0.28, 0.17, -0.23, 0.23), H(18), m['hull'], tur, bevel=0.012)
    box('rear', -0.36, -0.3, -0.2, 0.2, H(11), H(16.5), team_mat(), tur, team=True)
    barrel('gun', 0.18, 0.78, H(1.4), 0, H(14.5), m['gun'], tur)
    box('brake', 0.92, 1.0, -0.035, 0.035, H(13.4), H(15.6), m['gun'], tur, bevel=0)
    return {'layers': {'body': body, 'turret': tur}, 'pivot': -0.2}


def mcv(nato):
    body = root('body')
    m = nato_set() if nato else pact_set()
    hull = m['hull']
    box_c = mat('#9a8650', grime=0.3) if nato else mat(PACT['rust'], grime=0.45)
    L, W = 0.66, 0.42
    wheelset(body, [-0.48, -0.26, 0.2, 0.44], W - 0.04, H(4.4), m['steel'], m['rubber'], 0.08)
    box('chassis', -L, L - 0.02, -0.26, 0.26, H(3), H(6.5), mat('#26271f'), body)
    loft('cab', rect(0.38, L, -W + 0.05, W - 0.05), H(6.5), rect(0.38, L - 0.07, -W + 0.07, W - 0.07), H(16), hull, body)
    loft('glass', rect(L - 0.075, L - 0.005, -W + 0.09, W - 0.09), H(11), rect(L - 0.085, L - 0.065, -W + 0.09, W - 0.09), H(15.4), m['glass'], body, bevel=0)
    box('container', -L, 0.34, -W, W, H(6.5), H(20), box_c, body)
    for y0, y1 in ((W - 0.005, W + 0.008), (-W - 0.008, -W + 0.005)):
        box('stripe', -L + 0.04, 0.3, y0, y1, H(12), H(15), team_mat(), body, team=True, bevel=0)
    box('stripe_r', -L - 0.01, -L, -W + 0.03, W - 0.03, H(12), H(15), team_mat(), body, team=True)
    # folded crane boom on the roof
    box('crane_base', -0.2, 0.0, -0.1, 0.1, H(20), H(24), mat('#b08a2a' if nato else '#7a4a26', grime=0.3), body)
    box('boom', -0.62, 0.1, -0.04, 0.04, H(24), H(26.5), mat('#c9a227' if nato else '#8a5a2a', grime=0.3), body)
    box('hook', -0.64, -0.6, -0.02, 0.02, H(20), H(24), mat('#2a2a24'), body)
    if not nato:
        star('star', (0.52, -W + 0.045, H(11)), 0.05, '-y', m['red'], body)
    return {'layers': {'body': body}}


# ---------- Warsaw Pact vehicles ----------
def brdm_hull(body, m, L=0.4, W=0.3, apc=False):
    xs = [-0.28, -0.1, 0.1, 0.28] if apc else [-0.22, 0.22]
    wheelset(body, xs, W - 0.05, H(3.2), m['steel'], m['rubber'], 0.06)
    nose = [(-L, -W + 0.05), (L - 0.14, -W + 0.05), (L, -0.1), (L, 0.1), (L - 0.14, W - 0.05), (-L, W - 0.05)]
    top = [(-L + 0.02, -W + 0.08), (L - 0.2, -W + 0.08), (L - 0.1, -0.08), (L - 0.1, 0.08), (L - 0.2, W - 0.08), (-L + 0.02, W - 0.08)]
    loft('hull', nose, H(2.6), top, H(10.0), m['hull'], body)
    for s in (1, -1):
        box('stow', -L + 0.06, -0.05, s * (W - 0.05) - 0.022, s * (W - 0.05) + 0.022, H(7), H(9.5), team_mat(), body, team=True)
    star('star', (0.05, -(W - 0.03), H(6.5)), 0.045, '-y', m['red'], body)
    star('star', (0.05, (W - 0.03), H(6.5)), 0.045, '+y', m['red'], body)


def brdm():
    body, tur = root('body'), root('turret')
    m = pact_set()
    brdm_hull(body, m)
    cyl('turret', 0.1, H(4), (0, 0, H(12)), 'z', m['turret'], tur, verts=8, r2=0.08)
    barrel('kpvt', 0.06, 0.32, H(0.8), 0, H(12.4), m['gun'], tur)
    return {'layers': {'body': body, 'turret': tur}}


def skot():
    body, tur = root('body'), root('turret')
    m = pact_set()
    brdm_hull(body, m, L=0.55, W=0.36, apc=True)
    box('troop', -0.5, 0.15, -0.24, 0.24, H(10), H(11.5), m['dark'], body)
    cyl('turret', 0.1, H(4), (0, 0, H(13)), 'z', m['turret'], tur, verts=8, r2=0.085)
    barrel('kpvt', 0.06, 0.34, H(0.8), 0, H(13.6), m['gun'], tur)
    return {'layers': {'body': body, 'turret': tur}}


def strela():
    body, tur = root('body'), root('turret')
    m = pact_set()
    brdm_hull(body, m)
    cyl('ring', 0.08, H(2), (0, 0, H(11)), 'z', m['turret'], tur, verts=10)
    rack = pivot('rack', tur, (0, 0, H(15)))
    rack.rotation_euler = (0, -0.35, 0)
    for qy in (-0.07, 0.07):
        for qz in (-0.03, 0.03):
            box('tube', -0.2, 0.22, qy - 0.028, qy + 0.028, qz - 0.025, qz + 0.025, mat('#6a7a4a', grime=0.25), rack, bevel=0.003)
    box('arm', -0.04, 0.04, -0.12, 0.12, -0.05, -0.03, m['dark'], rack, bevel=0)
    return {'layers': {'body': body, 'turret': tur}}


def ural_cab(body, m, L, W):
    loft('cab', rect(0.3, L - 0.14, -W + 0.06, W - 0.06), H(6), rect(0.3, L - 0.17, -W + 0.07, W - 0.07), H(15), m['hull'], body)
    loft('hood', rect(L - 0.14, L, -0.18, 0.18), H(6), rect(L - 0.14, L - 0.02, -0.16, 0.16), H(10.5), m['hull'], body)
    box('screen', L - 0.175, L - 0.165, -W + 0.1, W - 0.1, H(11), H(14), m['glass'], body, bevel=0)
    star('star', (0.45, -W + 0.055, H(10)), 0.04, '-y', m['red'], body)
    star('star', (0.45, W - 0.055, H(10)), 0.04, '+y', m['red'], body)


def grad():
    body = root('body')
    m = pact_set()
    L, W = 0.56, 0.36
    wheelset(body, [-0.38, -0.16, 0.36], W - 0.04, H(4.0), m['steel'], m['rubber'], 0.07)
    box('chassis', -L, L - 0.02, -0.24, 0.24, H(3), H(6), mat('#22231c'), body)
    ural_cab(body, m, L, W)
    box('bed', -L, 0.28, -W + 0.05, W - 0.05, H(6), H(8.5), m['dark'], body)
    for y0, y1 in ((W - 0.055, W - 0.04), (-W + 0.04, -W + 0.055)):
        box('trim', -L, 0.28, y0, y1, H(6.5), H(8.0), team_mat(), body, team=True, bevel=0)
    rack = pivot('rack', body, (-0.2, 0, H(11)))
    rack.rotation_euler = (0, -0.22, 0)
    box('frame', -0.32, 0.2, -0.2, 0.2, -H(1.5), 0, m['dark'], rack)
    for r in range(4):
        for c in range(8):
            cyl('tube', 0.02, 0.56, (-0.04, -0.175 + c * 0.05, H(0.6) + r * 0.04), 'x', mat('#3e4a2e', grime=0.3), rack, verts=8)
    return {'layers': {'body': body}}


def shilka():
    body, tur = root('body'), root('turret')
    m = pact_set()
    L, W = 0.47, 0.34
    tracked_hull(body, m, L, W, H(8.0), wheels=6)
    loft('turret', rect(-0.3, 0.26, -0.28, 0.28), H(8.0), rect(-0.28, 0.2, -0.26, 0.26), H(15.0), m['turret'], tur, bevel=0.012)
    box('rear', -0.36, -0.3, -0.24, 0.24, H(9), H(14), team_mat(), tur, team=True)
    for qy in (-0.06, 0.06):
        for qz in (H(12.2), H(14.2)):
            barrel('g', 0.18, 0.4, H(0.55), qy, qz, m['gun'], tur)
    cyl('dish', 0.1, 0.02, (-0.28, 0, H(20)), 'x', mat('#6a7a50', rough=0.5), tur, verts=16)
    cyl('dpost', H(0.5), H(5), (-0.26, 0, H(17)), 'z', m['steel'], tur, verts=6)
    for s in (1, -1):
        star('star', (-0.05, s * 0.275, H(11.5)), 0.04, '+y' if s > 0 else '-y', m['red'], tur)
    return {'layers': {'body': body, 'turret': tur}}


def obj279():
    body, tur = root('body'), root('turret')
    m = pact_set()
    L, W = 0.6, 0.46
    for yc in (0.17, 0.36):
        tracks(body, L - 0.02, yc, 0.11, H(5.0), 6, m['steel'], m['rubber'])
    # flattened saucer hull deflecting blast from every side
    oct8 = [(math.cos(a) * L, math.sin(a) * W) for a in [i * math.pi / 6 for i in range(12)]]
    loft('saucer', oct8, H(3.5), scaled(oct8, 0.72), H(9.5), m['hull'], body, bevel=0.012)
    dome('dome', 0.33, 0.31, H(8), (0, 0, H(9.4)), m['turret'], tur, cut=0.05)
    for qy in (-0.06, 0.06):
        barrel('gun', 0.22, 0.58, H(1.2), qy, H(13), m['gun'], tur)
    box('mantlet', 0.2, 0.3, -0.12, 0.12, H(11), H(15), m['dark'], tur)
    loft('bin', [(-0.38, -0.18), (-0.24, -0.22), (-0.24, 0.22), (-0.38, 0.18)], H(10), [(-0.38, -0.17), (-0.24, -0.21), (-0.24, 0.21), (-0.38, 0.17)], H(14), team_mat(), tur, team=True)
    for s in (1, -1):
        star('star', (-0.02, s * 0.3, H(13)), 0.055, '+y' if s > 0 else '-y', m['red'], tur)
    return {'layers': {'body': body, 'turret': tur}}


def scud():
    body = root('body')
    m = pact_set()
    L, W = 0.74, 0.4
    wheelset(body, [-0.52, -0.3, 0.26, 0.48], W - 0.04, H(4.4), m['steel'], m['rubber'], 0.08)
    box('chassis', -L, L - 0.02, -0.26, 0.26, H(3), H(7), m['dark'], body)
    for s in (1, -1):
        loft('cab', rect(0.5, L, s * 0.22 - 0.13, s * 0.22 + 0.13), H(7), rect(0.5, L - 0.05, s * 0.22 - 0.12, s * 0.22 + 0.12), H(14), m['hull'], body)
        box('glass', L - 0.055, L - 0.045, s * 0.22 - 0.1, s * 0.22 + 0.1, H(10.5), H(13), m['glass'], body, bevel=0)
    box('deck', -L, 0.46, -W + 0.04, W - 0.04, H(7), H(9), m['dark'], body)
    for y0, y1 in ((W - 0.045, W - 0.03), (-W + 0.03, -W + 0.045)):
        box('trim', -L, 0.46, y0, y1, H(7.4), H(8.6), team_mat(), body, team=True, bevel=0)
    star('star', (0.6, -0.355, H(10.5)), 0.04, '-y', m['red'], body)
    # missile on the erector, slightly raised
    ere = pivot('erector', body, (-0.62, 0, H(11)))
    ere.rotation_euler = (0, -0.16, 0)
    cyl('missile', 0.065, 0.98, (0.49, 0, 0.065), 'x', mat('#c8c4b0', rough=0.5, grime=0.2), ere, verts=14)
    cyl('nose', 0.065, 0.2, (1.08, 0, 0.065), 'x', mat('#6a1c14', rough=0.5), ere, verts=14, r2=0.0)
    for s in (1, -1):
        box('fin', -0.02, 0.1, s * 0.09 - 0.008, s * 0.09 + 0.008, 0.0, 0.13, mat('#8a8676'), ere, bevel=0)
    box('cradle', 0.0, 0.9, -0.08, 0.08, -0.03, 0.0, m['steel'], ere, bevel=0)
    return {'layers': {'body': body}}


# ---------- aircraft (no baked ground shadow: the game draws it below the aircraft) ----------
def a10():
    body = root('body')
    grey = mat('#6e7a76', grime=0.12)
    dark = mat('#4a5250', grime=0.15)
    z = H(6)
    loft('fuselage', [(0.62, 0), (0.5, -0.06), (-0.5, -0.05), (-0.62, 0), (-0.5, 0.05), (0.5, 0.06)], z - H(2),
         [(0.58, 0), (0.48, -0.05), (-0.5, -0.04), (-0.6, 0), (-0.5, 0.04), (0.48, 0.05)], z + H(2.4), grey, body, bevel=0.012)
    loft('wing', [(0.14, -0.64), (0.14, 0.64), (-0.08, 0.64), (-0.08, -0.64)], z - H(0.4), [(0.13, -0.62), (0.13, 0.62), (-0.07, 0.62), (-0.07, -0.62)], z + H(0.5), grey, body, bevel=0.006)
    for s in (1, -1):
        cyl('engine', 0.055, 0.26, (-0.26, s * 0.13, z + H(3.8)), 'x', dark, body, verts=14)
        box('pylon', -0.3, -0.2, s * 0.13 - 0.01, s * 0.13 + 0.01, z, z + H(3), dark, body, bevel=0)
        box('fin', -0.6, -0.48, s * 0.25 - 0.012, s * 0.25 + 0.012, z, z + H(8), team_mat(), body, team=True)
        for k in (0.3, 0.45):
            cyl('bomb', 0.02, 0.16, (0.0, s * k, z - H(1.6)), 'x', mat('#4a4c3e'), body, verts=8)
    box('tailplane', -0.6, -0.5, -0.28, 0.28, z + H(0.3), z + H(1.1), grey, body)
    for y0, y1 in ((0.5, 0.6), (-0.6, -0.5)):
        box('tip', -0.075, 0.135, y0, y1, z + H(0.5), z + H(0.7), team_mat(), body, team=True, bevel=0)
    dome('canopy', 0.09, 0.05, H(2.2), (0.42, 0, z + H(2.2)), mat('#3e5462', rough=0.15, metal=0.3, grime=0), body)
    barrel('gau8', 0.6, 0.1, H(0.6), 0, z - H(0.6), mat('#1c1d18'), body)
    return {'layers': {'body': body}}


def su25():
    body = root('body')
    skin = mat('#8a7a50', camo=['#4e5a34', '#6a4a2a'], grime=0.12, scale=18)
    red = mat(RED, rough=0.5, grime=0.05)
    z = H(6)
    loft('fuselage', [(0.64, 0), (0.45, -0.07), (-0.5, -0.06), (-0.6, 0), (-0.5, 0.06), (0.45, 0.07)], z - H(2),
         [(0.6, 0), (0.42, -0.06), (-0.5, -0.05), (-0.58, 0), (-0.5, 0.05), (0.42, 0.06)], z + H(2.2), skin, body, bevel=0.012)
    for s in (1, -1):
        loft('wing', [(0.2, s * 0.06), (-0.12, s * 0.56), (-0.24, s * 0.56), (-0.14, s * 0.06)], z - H(0.3),
             [(0.19, s * 0.06), (-0.12, s * 0.55), (-0.23, s * 0.55), (-0.14, s * 0.06)], z + H(0.5), skin, body, bevel=0.004)
        box('intake', 0.06, 0.3, s * 0.085 - 0.03, s * 0.085 + 0.03, z - H(1.4), z + H(1.6), mat('#4a4430'), body)
        star('star', (-0.17, s * 0.4, z + H(0.6)), 0.05, '+z', red, body)
        cyl('pod', 0.025, 0.16, (-0.02, s * 0.32, z - H(1.4)), 'x', mat('#3a3c30'), body, verts=8)
    loft('fin', [(-0.4, -0.01), (-0.6, -0.01), (-0.6, 0.01), (-0.4, 0.01)], z + H(1.5), [(-0.52, -0.01), (-0.62, -0.01), (-0.62, 0.01), (-0.52, 0.01)], z + H(10), team_mat(), body, team=True, bevel=0)
    box('tailplane', -0.6, -0.5, -0.22, 0.22, z + H(0.3), z + H(1.0), skin, body)
    dome('canopy', 0.08, 0.05, H(2.4), (0.38, 0, z + H(2.0)), mat('#3e5462', rough=0.15, metal=0.3, grime=0), body)
    return {'layers': {'body': body}}


def cobra():
    body = root('body')
    drab = mat('#4e5634', grime=0.15)
    z = H(4)
    loft('fuselage', [(0.48, 0), (0.4, -0.06), (-0.42, -0.07), (-0.46, 0), (-0.42, 0.07), (0.4, 0.06)], z,
         [(0.44, 0), (0.36, -0.05), (-0.4, -0.06), (-0.44, 0), (-0.4, 0.06), (0.36, 0.05)], z + H(5.5), drab, body, bevel=0.012)
    box('boom', -0.92, -0.42, -0.025, 0.025, z + H(3), z + H(5.5), drab, body)
    box('fin', -0.95, -0.85, -0.012, 0.012, z + H(3.5), z + H(11), team_mat(), body, team=True)
    box('tailrotor', -0.93, -0.87, 0.015, 0.025, z + H(5), z + H(10), mat('#2a2a24'), body, bevel=0)
    loft('canopy', [(0.42, -0.04), (0.42, 0.04), (0.02, 0.05), (0.02, -0.05)], z + H(5.5), [(0.34, -0.035), (0.34, 0.035), (0.06, 0.04), (0.06, -0.04)], z + H(8.5), mat('#3e5462', rough=0.15, metal=0.3, grime=0), body)
    box('engine', -0.3, 0.0, -0.06, 0.06, z + H(5.5), z + H(8.5), drab, body)
    cyl('mast', H(0.8), H(3), (0, 0, z + H(9.5)), 'z', mat('#1c1d18'), body, verts=8)
    for s in (1, -1):
        y0, y1 = (0.06, 0.24) if s > 0 else (-0.24, -0.06)
        box('stub', -0.12, 0.04, y0, y1, z + H(2), z + H(2.8), drab, body)
        cyl('pod', 0.035, 0.18, (-0.03, s * 0.2, z + H(1.2)), 'x', mat('#2c2e26'), body, verts=10)
    box('band', -0.4, -0.3, -0.072, 0.072, z + H(1), z + H(5), team_mat(), body, team=True, bevel=0)
    barrel('chin', 0.42, 0.12, H(0.5), 0, z - H(0.5), mat('#1c1d18'), body)
    return {'layers': {'body': body}}


def hind():
    body = root('body')
    skin = mat('#8a7a50', camo=['#4e5a34', '#6a4a2a'], grime=0.12, scale=16)
    red = mat(RED, rough=0.5, grime=0.05)
    z = H(4)
    loft('fuselage', [(0.52, 0), (0.42, -0.12), (-0.48, -0.13), (-0.54, 0), (-0.48, 0.13), (0.42, 0.12)], z,
         [(0.4, 0), (0.34, -0.1), (-0.46, -0.11), (-0.52, 0), (-0.46, 0.11), (0.34, 0.1)], z + H(8.5), skin, body, bevel=0.015)
    for f, zz in ((0.44, H(4)), (0.3, H(6))):
        dome('canopy', 0.07, 0.065, H(3), (f, 0, z + zz), mat('#3e5462', rough=0.15, metal=0.3, grime=0), body)
    box('boom', -1.0, -0.46, -0.035, 0.035, z + H(4), z + H(7.5), skin, body)
    box('fin', -1.04, -0.92, -0.014, 0.014, z + H(5), z + H(14), team_mat(), body, team=True)
    box('engines', -0.36, 0.12, -0.1, 0.1, z + H(8.5), z + H(11.5), skin, body)
    cyl('mast', H(0.9), H(3), (0, 0, z + H(12.5)), 'z', mat('#1c1d18'), body, verts=8)
    for s in (1, -1):
        loft('wing', [(0.04, s * 0.1), (0.02, s * 0.44), (-0.12, s * 0.44), (-0.14, s * 0.1)], z + H(3.5),
             [(0.04, s * 0.1), (0.02, s * 0.44), (-0.12, s * 0.44), (-0.14, s * 0.1)], z + H(4.4), skin, body, bevel=0)
        for k in (0.24, 0.38):
            cyl('pod', 0.035, 0.16, (-0.04, s * k, z + H(2.4)), 'x', mat('#2c2e26'), body, verts=10)
        star('star', (-0.7, s * 0.04, z + H(5.8)), 0.04, '+y' if s > 0 else '-y', red, body)
    barrel('chin', 0.5, 0.1, H(0.6), 0, z + H(0.8), mat('#1c1d18'), body)
    return {'layers': {'body': body}}


# ---------- infantry ----------
INF_STYLES = {
    # look: uniform, uniform camo, headgear, weapon, team part
    'inf_NATO': dict(uni='#55692a', camo=['#6a4220', '#1e1d16', '#7c8a3a'], head='pasgt', weapon='rifle', team='pack'),
    'inf_PACT': dict(uni='#a8925a', head='ssh', weapon='ak', team='roll'),
    'atinf_NATO': dict(uni='#55692a', camo=['#6a4220', '#1e1d16', '#7c8a3a'], head='pasgt', weapon='dragon', team='pack'),
    'atinf_PACT': dict(uni='#a8925a', head='ssh', weapon='rpg', team='roll'),
    'manpads_NATO': dict(uni='#55692a', camo=['#6a4220', '#1e1d16', '#7c8a3a'], head='pasgt', weapon='manpads', team='pack'),
    'manpads_PACT': dict(uni='#a8925a', head='ssh', weapon='manpads', team='roll'),
    'engineer_NATO': dict(uni='#8a7a4c', head='hardhat', hat='#d8a820', weapon='none', team='toolbag'),
    'engineer_PACT': dict(uni='#6a6a62', head='hardhat', hat='#d8682a', weapon='none', team='toolbag'),
    'commando_NATO': dict(uni='#26272a', head='balaclava', weapon='smg', team='pack'),
    'marine_NATO': dict(uni='#4a5a3a', camo=['#2a3420', '#6a6a44', '#1e1d16'], head='pasgt', weapon='rifle', team='pack'),
    'mujahid_NATO': dict(uni='#9a8a64', head='pakol', hat='#8a6a4a', weapon='rpg', team='sash', skin='#a87a58'),
    'spy_PACT': dict(uni='#5a5852', head='fedora', hat='#2a2925', weapon='pistol', team='armband', coat=True),
    'kpa_PACT': dict(uni='#7a6e44', head='cap', hat='#6a5e3a', weapon='ak', team='roll', count=3),
    'vc_PACT': dict(uni='#26262a', head='conical', hat='#c8b078', weapon='ak', team='sash'),
    'sapper_PACT': dict(uni='#5a6232', head='beret', hat='#9e2a1e', weapon='satchel', team='satchel'),
}


def soldier_figure(parent, cfg, offset=(0, 0), seed=0):
    nato = cfg.get('head') in ('pasgt',) or cfg.get('nato', False)
    uni = mat(cfg['uni'], camo=cfg.get('camo'), grime=0.1, scale=120)
    skin = mat(cfg.get('skin', '#c49a78'), rough=0.6, grime=0.05)
    boots = mat('#1c1a16', grime=0.05)
    gunm = mat('#1c1d18', rough=0.5, metal=0.3, grime=0.05)
    wood = mat('#6a4428', rough=0.6, grime=0.2)
    fig = pivot('fig', parent, (offset[0], offset[1], 0))
    hip_z, sh_z = 0.2, 0.37
    legs = []
    for s in (1, -1):
        hp = pivot('hip', fig, (0, s * 0.04, hip_z))
        box('leg', -0.03, 0.03, -0.028, 0.028, -hip_z + 0.025, 0.0, uni, hp, bevel=0.004)
        box('boot', -0.032, 0.05, -0.03, 0.03, -hip_z, -hip_z + 0.035, boots, hp, bevel=0.004)
        legs.append(hp)
    torso = pivot('torso', fig, (0, 0, hip_z))
    zt = sh_z - hip_z
    bottom = -0.1 if cfg.get('coat') else 0.0
    loft('chest', rect(-0.045, 0.045, -0.075, 0.075), bottom, rect(-0.05, 0.05, -0.085, 0.085), zt, uni, torso, bevel=0.01)
    if cfg.get('head') == 'pakol' or cfg.get('team') == 'sash':
        pass
    # team-colour gear
    t = cfg['team']
    if t == 'pack':
        box('pack', -0.11, -0.045, -0.06, 0.06, 0.06, 0.16, team_mat(), torso, team=True, bevel=0.008)
    elif t == 'roll':
        cyl('roll', 0.03, 0.17, (-0.06, 0, zt + 0.005), 'y', team_mat(), torso, team=True)
    elif t == 'toolbag':
        box('bag', -0.04, 0.05, 0.085, 0.13, -0.05, 0.03, team_mat(), torso, team=True, bevel=0.006)
    elif t == 'satchel':
        box('satchel', -0.03, 0.05, -0.13, -0.085, -0.04, 0.04, team_mat(), torso, team=True, bevel=0.006)
    elif t == 'armband':
        for s in (1, -1):
            box('band', -0.025, 0.025, s * 0.1 - 0.024, s * 0.1 + 0.024, zt - 0.06, zt - 0.03, team_mat(), torso, team=True, bevel=0)
    if t == 'sash' or t in ('pack', 'roll', 'satchel'):
        # diagonal strap across the chest
        loft('strap', [(0.046, -0.08), (0.054, -0.08), (0.054, -0.05), (0.046, -0.05)], 0.02, [(0.046, 0.05), (0.054, 0.05), (0.054, 0.08), (0.046, 0.08)], zt - 0.01, team_mat(), torso, team=True, bevel=0)
    box('belt', -0.05, 0.052, -0.08, 0.08, 0.0, 0.025, mat('#2e2a1e'), torso, bevel=0)
    hz = zt + 0.06
    head = cfg['head']
    sphere('head', 0.045, (0.005, 0, hz), mat('#141414') if head == 'balaclava' else skin, torso)
    hat = mat(cfg.get('hat', '#4f5f28'), rough=0.6, grime=0.12)
    if head == 'pasgt':
        dome('helmet', 0.065, 0.062, 0.055, (0.0, 0, hz + 0.005), mat('#4f5f28', camo=['#6a4220', '#1e1d16'], grime=0.1, scale=140), torso)
    elif head == 'ssh':
        hm = mat('#4d8034', rough=0.5, metal=0.15, grime=0.15)
        dome('helmet', 0.06, 0.058, 0.06, (0.004, 0, hz + 0.01), hm, torso)
        cyl('brim', 0.064, 0.008, (0.004, 0, hz + 0.01), 'z', hm, torso, verts=14)
        star('star', (0.06, 0, hz + 0.035), 0.016, '+x', mat('#d8301e', rough=0.4, grime=0, emit=0.3), torso)
    elif head == 'hardhat':
        dome('hat', 0.058, 0.056, 0.05, (0.0, 0, hz + 0.015), hat, torso)
        cyl('brim', 0.07, 0.008, (0.0, 0, hz + 0.015), 'z', hat, torso, verts=14)
    elif head == 'fedora':
        cyl('crown', 0.042, 0.045, (0.0, 0, hz + 0.045), 'z', hat, torso, verts=12)
        cyl('brim', 0.075, 0.008, (0.0, 0, hz + 0.025), 'z', hat, torso, verts=16)
    elif head == 'pakol':
        cyl('pakol', 0.055, 0.035, (0.0, 0, hz + 0.04), 'z', hat, torso, verts=14)
        sphere('beard', 0.03, (0.04, 0, hz - 0.03), mat('#2a1e14'), torso)
    elif head == 'cap':
        cyl('cap', 0.05, 0.03, (0.0, 0, hz + 0.04), 'z', hat, torso, verts=12)
        box('peak', 0.03, 0.08, -0.03, 0.03, hz + 0.03, hz + 0.038, hat, torso, bevel=0)
        star('star', (0.052, 0, hz + 0.042), 0.012, '+x', mat('#d8301e', emit=0.3, grime=0), torso)
    elif head == 'conical':
        cyl('nonla', 0.11, 0.06, (0.0, 0, hz + 0.05), 'z', hat, torso, verts=18, r2=0.0)
    elif head == 'beret':
        sphere('beret', 0.05, (-0.005, -0.01, hz + 0.035), hat, torso, scale=(1.05, 1.0, 0.45))
    arms = []
    for s in (1, -1):
        sp = pivot('shoulder', torso, (0, s * 0.1, zt - 0.015))
        box('arm', -0.022, 0.022, -0.022, 0.022, -0.13, 0.0, uni, sp, bevel=0.004)
        sphere('hand', 0.018, (0, 0, -0.14), skin, sp)
        arms.append(sp)
    weapon = cfg['weapon']
    wpn = pivot('weapon', torso, (0.06, -0.03, 0.08))
    flash_at = 0.18
    if weapon in ('rifle', 'ak', 'smg'):
        n = 0.75 if weapon == 'smg' else 1.0
        box('stock', -0.09 * n, -0.02, -0.012, 0.012, -0.02, 0.015, gunm if weapon != 'ak' else wood, wpn, bevel=0)
        box('receiver', -0.02, 0.08 * n, -0.012, 0.012, -0.012, 0.02, gunm, wpn, bevel=0)
        box('mag', 0.02, 0.045, -0.01, 0.01, -0.05, -0.01, mat('#8a4a22') if weapon == 'ak' else gunm, wpn, bevel=0)
        barrel('muzzle', 0.08 * n, 0.08 * n, 0.007, 0, 0.005, gunm, wpn)
        flash_at = 0.18 * n
    elif weapon in ('dragon', 'manpads'):
        cyl('tube', 0.024, 0.3, (0.04, 0, 0.0), 'x', mat('#4a5232' if weapon == 'dragon' else '#5a6040', grime=0.2), wpn, verts=10)
        box('sight', 0.0, 0.05, -0.04, -0.024, 0.0, 0.03, gunm, wpn, bevel=0)
        flash_at = 0.21
    elif weapon == 'rpg':
        cyl('tube', 0.013, 0.26, (0.02, 0, 0.0), 'x', mat('#3c4430'), wpn, verts=8)
        cyl('warhead', 0.03, 0.08, (0.19, 0, 0.0), 'x', mat('#4a5432'), wpn, verts=10, r2=0.012)
        box('grip', -0.01, 0.01, -0.008, 0.008, -0.04, 0.0, wood, wpn, bevel=0)
        flash_at = 0.25
    elif weapon == 'pistol':
        box('pistol', 0.0, 0.06, -0.01, 0.01, -0.01, 0.015, gunm, wpn, bevel=0)
        flash_at = 0.09
    elif weapon == 'satchel':
        box('charge', -0.03, 0.04, -0.03, 0.03, -0.03, 0.03, mat('#5a4a2a'), wpn, bevel=0.004)
    flash = None
    if weapon not in ('none', 'satchel'):
        flash = sphere('flash', 0.03, (flash_at, 0, 0.005), mat('#ffd25a', emit=6.0, grime=0), wpn, scale=(1.6, 1, 1))
        flash.hide_render = True
    shoulder_w = weapon in ('dragon', 'manpads', 'rpg')
    phase = seed * 1.3

    def apply(step=None, fire=False):
        st = None if step is None else step + phase
        sw = 0 if st is None else math.sin(st * math.pi / 2) * 0.55
        legs[0].rotation_euler = (0, sw, 0)
        legs[1].rotation_euler = (0, -sw, 0)
        torso.rotation_euler = (0, 0.06 if st is not None else 0, 0)
        torso.location.z = hip_z + (abs(math.sin(st * math.pi / 2)) * -0.006 if st is not None else 0)
        if shoulder_w:
            # launchers ride on the right shoulder; MANPADS point up at the sky
            wpn.location = (0.0, -0.065, zt + 0.02)
            wpn.rotation_euler = (0, -0.6 if weapon == 'manpads' else 0, 0)
            arms[0].rotation_euler = (0, -1.2, 0.3)
            arms[1].rotation_euler = (0, -1.3, -0.1)
        elif fire and weapon != 'none':
            wpn.location = (0.08, -0.035, zt - 0.02)
            wpn.rotation_euler = (0, 0, 0)
            arms[0].rotation_euler = (0, -1.35, 0.25)
            arms[1].rotation_euler = (0, -1.45, -0.2)
        else:
            wpn.location = (0.06, -0.03, 0.08)
            wpn.rotation_euler = (0, -0.5 if weapon != 'satchel' else 0, 0)
            arms[0].rotation_euler = (0, -0.6 + sw * 0.4, 0.2)
            arms[1].rotation_euler = (0, -0.8 - sw * 0.4, -0.2)
        if flash: flash.hide_render = not fire
    return apply


def infantry(key):
    cfg = INF_STYLES[key]
    rootobj = root('body')
    n = cfg.get('count', 1)
    offsets = [(0, 0)] if n == 1 else [(0.1, 0.1), (-0.12, 0.02), (0.06, -0.14)]
    figs = [soldier_figure(rootobj, cfg, o, i) for i, o in enumerate(offsets)]

    def pose(step=None, fire=False):
        def apply():
            for f in figs: f(step, fire)
        return apply

    poses = {'idle': pose(), 'walk0': pose(0), 'walk1': pose(1), 'walk2': pose(2), 'walk3': pose(3), 'fire': pose(fire=True)}
    return {'layers': {'body': rootobj}, 'poses': {'body': poses}}


def inf_unit(key, frame=48):
    return {'build': lambda: infantry(key), 'frame': frame, 'dirs': 8}


def veh(build, frame=96, **kw):
    return dict(build=build, frame=frame, dirs=32, **kw)


# ---------- paradrop transport (C-130 style) ----------
def transport():
    body = root('body')
    skin = mat('#7a7e74', grime=0.15, scale=14)
    dark = mat('#4a4e48', grime=0.2)
    z = H(8)
    loft('fuselage', [(1.0, 0), (0.9, -0.11), (-0.7, -0.11), (-1.0, -0.03), (-1.0, 0.03), (-0.7, 0.11), (0.9, 0.11)], z - H(4),
         [(0.96, 0), (0.86, -0.1), (-0.7, -0.1), (-0.98, -0.02), (-0.98, 0.02), (-0.7, 0.1), (0.86, 0.1)], z + H(4), skin, body, bevel=0.02)
    # high wing with four turboprops
    loft('wing', [(0.22, -1.15), (0.22, 1.15), (-0.02, 1.15), (-0.02, -1.15)], z + H(3.4), [(0.2, -1.12), (0.2, 1.12), (0.0, 1.12), (0.0, -1.12)], z + H(4.6), skin, body, bevel=0.008)
    for q in (-0.75, -0.4, 0.4, 0.75):
        cyl('nacelle', 0.06, 0.34, (0.2, q, z + H(2.4)), 'x', dark, body, verts=12)
        cyl('prop', 0.16, 0.012, (0.38, q, z + H(2.4)), 'x', mat('#2a2a26', rough=0.6), body, verts=16)
    loft('fin', [(-0.66, -0.012), (-0.98, -0.012), (-0.98, 0.012), (-0.66, 0.012)], z + H(3), [(-0.86, -0.012), (-1.0, -0.012), (-1.0, 0.012), (-0.86, 0.012)], z + H(16), skin, body, bevel=0)
    box('tailplane', -1.0, -0.84, -0.42, 0.42, z + H(3), z + H(4), skin, body)
    box('cockpit', 0.82, 0.92, -0.08, 0.08, z + H(2.4), z + H(4.3), mat('#3e5462', rough=0.15, metal=0.3, grime=0), body, bevel=0)
    return {'layers': {'body': body}}


# key -> how to build it; keys are <look>_<faction> as used by client/art-units.js
UNITS = {
    'tank_PACT': veh(t72),
    'tank_NATO': veh(m60),
    'harvester_NATO': veh(ore_truck_nato, 112),
    'harvester_PACT': veh(war_miner, 112),
    'jeep_NATO': veh(m151, 80),
    'jeep_PACT': veh(brdm, 80),
    'arty_NATO': veh(m109, 112),
    'vulcan_NATO': veh(vulcan),
    'heavytank_NATO': veh(abrams, 104),
    'leopard_NATO': veh(leopard2, 112),
    'merkava_NATO': veh(merkava, 104),
    'missile_NATO': veh(pluton, 112),
    'g6_NATO': veh(g6, 128),
    'mcv_NATO': veh(lambda: mcv(True), 128),
    'mcv_PACT': veh(lambda: mcv(False), 128),
    'apc_PACT': veh(skot, 96),
    'strela_PACT': veh(strela, 80),
    'grad_PACT': veh(grad, 112),
    'shilka_PACT': veh(shilka),
    'superheavy_PACT': veh(obj279, 120),
    'scud_PACT': veh(scud, 136),
    'a10_NATO': veh(a10, 120, shadow=False),
    'su25_PACT': veh(su25, 120, shadow=False),
    'cobra_NATO': veh(cobra, 120, shadow=False),
    'hind_PACT': veh(hind, 128, shadow=False),
    'transport_ALL': veh(transport, 200, shadow=False),
}
for _k, _cfg in INF_STYLES.items():
    UNITS[_k] = inf_unit(_k, 64 if _cfg.get('count', 1) > 1 else 48)
