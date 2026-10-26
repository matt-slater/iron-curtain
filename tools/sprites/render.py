# Renders unit sprite sheets for Iron Curtain with Blender (Cycles).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/sprites/render.py -- [keys...] [--fast]
#
# Models are built from primitives in tools/sprites/models.py, rendered from the game's 2:1 isometric camera
# in every direction, and written to client/sprites/<key>.png (colour + ground shadow) and <key>.mask.png
# (team-colour areas), plus client/sprites/manifest.json.
#
# Coordinates: 1 Blender unit = 1 map tile horizontally. Model forward is +X; the game's +y axis is Blender -Y.
# Heights: 1 Blender unit of height = 39.2 art pixels (models.H(px) converts).
import bpy, math, os, sys, json, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import models  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(ROOT, '..', '..', 'client', 'sprites'))
TMP = os.path.join(ROOT, '.tmp')
PX_PER_BU = 32 / math.cos(math.radians(45))  # 45.25 px per Blender unit in the image plane at 1x
SCALE = 2  # rendered at 2x art resolution; the game downsamples


def setup_scene(frame_px, fast):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 12 if fast else 48
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 4
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception:
        pass
    sc.render.film_transparent = True
    sc.render.filter_size = 1.2
    sc.render.resolution_x = sc.render.resolution_y = frame_px * SCALE
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.35

    # 2:1 dimetric camera: 30 degree elevation, looking from the game's +x+y corner
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = frame_px / PX_PER_BU
    co = bpy.data.objects.new('cam', cam)
    el, d = math.radians(30), 30
    co.location = (math.cos(el) * d * math.sqrt(0.5), -math.cos(el) * d * math.sqrt(0.5), math.sin(el) * d)
    co.rotation_euler = (math.radians(60), 0, math.radians(45))
    sc.collection.objects.link(co)
    sc.camera = co

    # key light from the upper left of the screen, soft sky fill
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.8
    sun.angle = math.radians(4)
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(-12), math.radians(-48), 0)
    sc.collection.objects.link(so)
    world = bpy.data.worlds.new('world')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.48, 0.47, 0.42, 1)
    bg.inputs['Strength'].default_value = 0.75
    sc.world = world

    # invisible ground that only receives shadows
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = 'shadow_catcher'
    ground.is_shadow_catcher = True
    return sc, ground


def load_pixels(path, w, h):
    img = bpy.data.images.load(path)
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return arr.reshape(h, w, 4)[::-1]  # Blender stores rows bottom-up


def save_sheet(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def set_mask_mode(objs, on):
    """Mask pass: team-colour parts render solid white, everything else is a holdout (cuts out what it hides)."""
    white = bpy.data.materials.get('__mask_white')
    if white is None:
        white = bpy.data.materials.new('__mask_white')
        white.use_nodes = True
        nt = white.node_tree
        nt.nodes.clear()
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (1, 1, 1, 1)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(em.outputs[0], out.inputs[0])
    for o in objs:
        if o.type != 'MESH':
            continue
        if o.get('team'):
            if on:
                o['__mats'] = [s.material.name if s.material else '' for s in o.material_slots]
                for s in o.material_slots: s.material = white
            elif '__mats' in o:
                for s, n in zip(o.material_slots, o['__mats']): s.material = bpy.data.materials.get(n)
                del o['__mats']
        else:
            o.is_holdout = on


def render_unit(key, spec, fast):
    frame = spec['frame']
    sc, ground = setup_scene(frame, fast)
    models._mats.clear()  # materials from the previous unit were wiped with the scene
    built = spec['build']()  # {'layers': {name: root}, 'poses': {layer: {pose: fn}}}
    layers = built['layers']
    W = H = frame * SCALE
    os.makedirs(TMP, exist_ok=True)
    rows = []

    def objs_of(root):
        return [root] + list(root.children_recursive)

    for lname, root in layers.items():
        poses = built.get('poses', {}).get(lname) or {'': None}
        dirs = spec['dirs']
        for other, r in layers.items():
            for o in objs_of(r): o.hide_render = other != lname
        for pname, pose in poses.items():
            if pose: pose()
            colour, mask = [], []
            for mode in ('colour', 'mask'):
                set_mask_mode(objs_of(root), mode == 'mask')
                # only the hull layer gets a ground shadow: layers drawn on top (turrets) would otherwise
                # paint their ground shadow across the hull underneath them
                ground.hide_render = mode == 'mask' or lname != 'body'
                for k in range(dirs):
                    # game direction a (clockwise on screen) is a Blender rotation of -a
                    root.rotation_euler = (0, 0, -k * 2 * math.pi / dirs)
                    p = os.path.join(TMP, f'{key}_{lname}_{pname}_{mode}_{k}.png')
                    sc.render.filepath = p
                    bpy.ops.render.render(write_still=True)
                    (colour if mode == 'colour' else mask).append(load_pixels(p, W, H))
                    os.remove(p)
                set_mask_mode(objs_of(root), False)
            rows.append((lname + ('.' + pname if pname else ''), colour, mask))

    cols = max(len(r[1]) for r in rows)
    sheet = np.zeros((H * len(rows), W * cols, 4), dtype=np.float32)
    msheet = np.zeros_like(sheet)
    for i, (_, colour, mask) in enumerate(rows):
        for k in range(len(colour)):
            sheet[i * H:(i + 1) * H, k * W:(k + 1) * W] = colour[k]
            msheet[i * H:(i + 1) * H, k * W:(k + 1) * W] = mask[k]
    os.makedirs(OUT, exist_ok=True)
    save_sheet(sheet, os.path.join(OUT, f'{key}.png'))
    save_sheet(msheet, os.path.join(OUT, f'{key}.mask.png'))
    return {'frame': W, 'scale': SCALE, 'anchor': [W / 2, H / 2],
            'rows': {name: {'row': i, 'dirs': len(c)} for i, (name, c, _) in enumerate(rows)}}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    fast = '--fast' in argv
    keys = [a for a in argv if not a.startswith('--')] or list(models.UNITS)
    man_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    for key in keys:
        t0 = time.time()
        manifest[key] = render_unit(key, models.UNITS[key], fast)
        print(f'[sprites] {key}: {time.time() - t0:.1f}s', flush=True)
        os.makedirs(OUT, exist_ok=True)
        with open(man_path, 'w') as f:
            json.dump(manifest, f, indent=1, sort_keys=True)


main()
