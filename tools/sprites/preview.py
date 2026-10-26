# Builds a contact sheet of rendered sprites for eyeballing:
#   Blender -b -P tools/sprites/preview.py -- [keys...]    -> tools/sprites/preview.png
# Each row is one sprite key; columns are 8 evenly spaced directions with the turret composited on the body.
import bpy, os, sys, json
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
SPR = os.path.normpath(os.path.join(ROOT, '..', '..', 'client', 'sprites'))


def load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1]


def over(dst, src):
    a = src[..., 3:4]
    dst[..., :3] = src[..., :3] * a + dst[..., :3] * (1 - a)


man = json.load(open(os.path.join(SPR, 'manifest.json')))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
keys = argv or sorted(man)
cell = 224
out = np.zeros((cell * len(keys), cell * 8, 4), dtype=np.float32)
out[..., :3] = (0.24, 0.29, 0.16)
out[..., 3] = 1
team = np.array([0.75, 0.16, 0.12])
for r, key in enumerate(keys):
    m = man[key]
    sheet, mask = load(os.path.join(SPR, key + '.png')), load(os.path.join(SPR, key + '.mask.png'))
    F = m['frame']
    rows = m['rows']
    base = 'body' if 'body' in rows else 'body.idle'
    for c in range(8):
        tile = out[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell]
        for layer in ([base] + (['turret'] if 'turret' in rows else [])):
            info = rows[layer]
            k = c * info['dirs'] // 8
            fr = sheet[info['row'] * F:(info['row'] + 1) * F, k * F:(k + 1) * F].copy()
            mk = mask[info['row'] * F:(info['row'] + 1) * F, k * F:(k + 1) * F]
            lum = fr[..., :3].mean(axis=2, keepdims=True)
            fr[..., :3] = fr[..., :3] * (1 - mk[..., 3:4]) + (lum * 1.6 * team) * mk[..., 3:4]
            o = (cell - F) // 2
            over(tile[o:o + F, o:o + F], fr)
img = bpy.data.images.new('preview', out.shape[1], out.shape[0], alpha=True)
img.pixels.foreach_set(np.ascontiguousarray(out[::-1]).ravel())
img.filepath_raw = os.path.join(ROOT, 'preview.png')
img.file_format = 'PNG'
img.save()
print('[preview] wrote', img.filepath_raw)
