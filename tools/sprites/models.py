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
PACT = dict(hull='#5f6e46', dark='#46523a', drum='#3e452e', rubber='#25261f', steel='#4c5240', rust='#7a4a2e')


def t72():
    body, tur = root('body'), root('turret')
    hull = mat(PACT['hull'], grime=0.32)
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
    turret = mat('#647449', grime=0.3)
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
    return {'layers': {'body': body, 'turret': tur}}


# ---------- M60 Patton (NATO main tank) ----------
NATO = dict(hull='#6e7448', camo=['#4a3a26', '#2a2a20', '#5a6436'], rubber='#24251f', steel='#555a44')


def m60():
    body, tur = root('body'), root('turret')
    hull = mat(NATO['hull'], camo=NATO['camo'], grime=0.25)
    rubber = mat(NATO['rubber'], rough=0.9, grime=0.1)
    steel = mat(NATO['steel'], rough=0.6, metal=0.3)
    plain = mat('#5c6240', grime=0.3)
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
    t = mat(NATO['hull'], camo=NATO['camo'], grime=0.25, scale=44)
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
    cab = mat('#7b7154', grime=0.3)
    bodyc = mat('#6f6650', grime=0.38)
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
    hull = mat(PACT['hull'], grime=0.35)
    rust = mat(PACT['rust'], grime=0.5, rough=0.85)
    rubber = mat(PACT['rubber'], rough=0.9, grime=0.1)
    steel = mat(PACT['steel'], rough=0.6, metal=0.3)
    L, W = 0.62, 0.42
    tracks(body, L - 0.02, 0.32, 0.15, H(6.0), 7, steel, rubber)
    box('lower', -L, L - 0.05, -0.25, 0.25, H(1.8), H(6.0), mat(PACT['dark'], grime=0.35), body)
    # armoured cab at the front-left with vision slits
    loft('cab', rect(0.26, L, -W + 0.02, 0.06), H(6.0), rect(0.28, L - 0.06, -W + 0.04, 0.04), H(15.5), hull, body)
    box('slit', L - 0.065, L - 0.055, -W + 0.08, 0.0, H(12.5), H(13.5), mat('#121310'), body)
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


# ---------- infantry ----------
def soldier(nato):
    rootobj = root('body')
    uni = mat('#646c42', camo=['#3e3322', '#2a2a20', '#7a7a4c'], grime=0.15, scale=120) if nato else mat('#867a50', grime=0.25, scale=110)
    helmet = mat('#4c5834', camo=['#3b2f1f', '#2a2a20'], grime=0.2, scale=140) if nato else mat('#5e6c44', rough=0.5, metal=0.15, grime=0.2)
    skin = mat('#c49a78', rough=0.6, grime=0.05)
    boots = mat('#1c1a16', grime=0.05)
    gun = mat('#1c1d18', rough=0.5, metal=0.3, grime=0.05)
    wood = mat('#6a4428', rough=0.6, grime=0.2)
    # proportions are exaggerated like RA2 so soldiers read at 20 px tall
    hip_z, sh_z = 0.2, 0.37
    legs = []
    for s in (1, -1):
        hp = pivot('hip', rootobj, (0, s * 0.04, hip_z))
        box('leg', -0.03, 0.03, -0.028, 0.028, -hip_z + 0.025, 0.0, uni, hp, bevel=0.004)
        box('boot', -0.032, 0.05, -0.03, 0.03, -hip_z, -hip_z + 0.035, boots, hp, bevel=0.004)
        legs.append(hp)
    torso = pivot('torso', rootobj, (0, 0, hip_z))
    loft('chest', rect(-0.045, 0.045, -0.075, 0.075), 0.0, rect(-0.05, 0.05, -0.085, 0.085), sh_z - hip_z, uni, torso, bevel=0.01)
    # team colour: backpack (NATO ALICE pack) or bedroll (Pact) plus a chest strap
    if nato:
        box('pack', -0.11, -0.045, -0.06, 0.06, 0.06, 0.16, team_mat(), torso, team=True, bevel=0.008)
    else:
        cyl('roll', 0.03, 0.17, (-0.06, 0, sh_z - hip_z + 0.005), 'y', team_mat(), torso, team=True)
    box('strap', 0.044, 0.052, -0.08, 0.08, 0.1, 0.13, team_mat(), torso, team=True, bevel=0)
    box('belt', -0.05, 0.052, -0.08, 0.08, 0.0, 0.025, mat('#2e2a1e'), torso, bevel=0)
    sphere('head', 0.045, (0.005, 0, sh_z - hip_z + 0.06), skin, torso)
    if nato:
        dome('helmet', 0.065, 0.062, 0.055, (0.0, 0, sh_z - hip_z + 0.065), helmet, torso)
    else:
        dome('helmet', 0.06, 0.058, 0.06, (0.004, 0, sh_z - hip_z + 0.07), helmet, torso)
        cyl('brim', 0.064, 0.008, (0.004, 0, sh_z - hip_z + 0.07), 'z', helmet, torso, verts=14)
    arms = []
    for s in (1, -1):
        sp = pivot('shoulder', torso, (0, s * 0.1, sh_z - hip_z - 0.015))
        box('arm', -0.022, 0.022, -0.022, 0.022, -0.13, 0.0, uni, sp, bevel=0.004)
        sphere('hand', 0.018, (0, 0, -0.14), skin, sp)
        arms.append(sp)
    # rifle held across the body; raised to the shoulder when firing
    rifle = pivot('rifle', torso, (0.06, -0.03, 0.08))
    box('stock', -0.09, -0.02, -0.012, 0.012, -0.02, 0.015, wood if not nato else gun, rifle, bevel=0)
    box('receiver', -0.02, 0.08, -0.012, 0.012, -0.012, 0.02, gun, rifle, bevel=0)
    box('mag', 0.02, 0.045, -0.01, 0.01, -0.05, -0.01, gun if nato else mat('#8a4a22'), rifle, bevel=0)
    barrel('muzzle', 0.08, 0.08, 0.007, 0, 0.005, gun, rifle)
    flash = sphere('flash', 0.03, (0.18, 0, 0.005), mat('#ffd25a', emit=6.0, grime=0), rifle, scale=(1.6, 1, 1))
    flash.hide_render = True

    def pose(step=None, fire=False):
        def apply():
            sw = 0 if step is None else math.sin(step * math.pi / 2) * 0.55
            legs[0].rotation_euler = (0, sw, 0)
            legs[1].rotation_euler = (0, -sw, 0)
            torso.rotation_euler = (0, 0.06 if step is not None else 0, 0)
            torso.location.z = hip_z + (abs(math.sin(step * math.pi / 2)) * -0.006 if step is not None else 0)
            if fire:
                rifle.location = (0.08, -0.035, sh_z - hip_z - 0.02)
                rifle.rotation_euler = (0, 0, 0)
                arms[0].rotation_euler = (0, -1.35, 0.25)
                arms[1].rotation_euler = (0, -1.45, -0.2)
            else:
                rifle.location = (0.06, -0.03, 0.08)
                rifle.rotation_euler = (0, -0.5, 0)
                arms[0].rotation_euler = (0, -0.6 + sw * 0.4, 0.2)
                arms[1].rotation_euler = (0, -0.8 - sw * 0.4, -0.2)
            flash.hide_render = not fire
        return apply

    poses = {'idle': pose(), 'walk0': pose(0), 'walk1': pose(1), 'walk2': pose(2), 'walk3': pose(3), 'fire': pose(fire=True)}
    return {'layers': {'body': rootobj}, 'poses': {'body': poses}}


# key -> how to build it; keys are <look>_<faction> as used by client/art-units.js
UNITS = {
    'tank_PACT': {'build': t72, 'frame': 96, 'dirs': 32},
    'tank_NATO': {'build': m60, 'frame': 96, 'dirs': 32},
    'harvester_NATO': {'build': ore_truck_nato, 'frame': 112, 'dirs': 32},
    'harvester_PACT': {'build': war_miner, 'frame': 112, 'dirs': 32},
    'inf_NATO': {'build': lambda: soldier(True), 'frame': 48, 'dirs': 8},
    'inf_PACT': {'build': lambda: soldier(False), 'frame': 48, 'dirs': 8},
}
