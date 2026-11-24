"""Builds the photo facade atlas from AI-generated facade sheets (Higgsfield, Z-Image).

Usage: python3 build_facades.py <dir with f0.png..f7.png> <out dir>
Each style is cut into four tiles (upper floor, upper floor with balcony, ground floor,
entrance), 256 px each, in one column. A second image carries roughness (G) and the
building-colour tint mask (B): light, unsaturated plaster takes the building's colour.
"""
import sys
from PIL import Image
import numpy as np

T = 256
# Column order in the photo atlas = FACADE indices they replace (see src/render/facades.ts).
STYLES = [
    # (source, facade column, tintable, crops: upper, balcony, ground, door as x0, y0, x1, y1 fractions)
    ('f0', 0, True, [(0.0, 0.04, 0.37, 0.43), (0.39, 0.04, 0.77, 0.43), (0.0, 0.46, 0.37, 0.91), (0.38, 0.46, 0.74, 0.91)]),  # plaster house
    ('f1', 1, True, [(0.0, 0.37, 0.42, 0.655), (0.42, 0.37, 0.73, 0.655), (0.0, 0.655, 0.42, 0.98), (0.42, 0.655, 0.73, 0.98)]),  # panel block
    ('f3', 2, True, [(0.05, 0.03, 0.39, 0.47), (0.5, 0.03, 0.85, 0.47), (0.04, 0.47, 0.39, 0.95), (0.5, 0.47, 0.81, 0.95)]),  # old town
    ('f5', 3, False, [(0.0, 0.04, 0.41, 0.37), (0.42, 0.04, 0.9, 0.37), (0.0, 0.4, 0.41, 0.98), (0.42, 0.4, 0.78, 0.98)]),  # brick factory
    ('f7', 4, False, [(0.0, 0.0, 0.32, 0.31), (0.4, 0.0, 0.75, 0.31), (0.0, 0.7, 0.32, 0.98), (0.37, 0.7, 0.65, 0.98)]),  # glass office
    ('f6', 5, True, [(0.0, 0.02, 0.4, 0.44), (0.43, 0.02, 0.97, 0.44), (0.0, 0.45, 0.4, 0.95), (0.45, 0.45, 0.75, 0.95)]),  # retail hall
    ('f2', 8, True, [(0.03, 0.07, 0.37, 0.45), (0.42, 0.07, 0.8, 0.45), (0.02, 0.47, 0.39, 0.97), (0.42, 0.47, 0.7, 0.97)]),  # 1950s block
    ('f4', 9, True, [(0.08, 0.0, 0.5, 0.42), (0.5, 0.0, 0.92, 0.42), (0.06, 0.44, 0.5, 0.96), (0.48, 0.44, 0.92, 0.96)]),  # civic
    ('f4', 10, True, [(0.08, 0.0, 0.5, 0.42), (0.5, 0.0, 0.92, 0.42), (0.06, 0.44, 0.5, 0.96), (0.48, 0.44, 0.92, 0.96)]),  # chateau
]

src, out = sys.argv[1], sys.argv[2]
color = Image.new('RGB', (T * len(STYLES), T * 4))
aux = Image.new('RGB', (T * len(STYLES), T * 4))
for i, (name, _col, tintable, crops) in enumerate(STYLES):
    im = Image.open(f'{src}/{name}.png').convert('RGB')
    W, H = im.size
    for r, (x0, y0, x1, y1) in enumerate(crops):
        tile = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))).resize((T, T), Image.LANCZOS)
        a = np.asarray(tile).astype(np.float32) / 255
        lum = a.mean(axis=2)
        sat = a.max(axis=2) - a.min(axis=2)
        # Glass: dark and grey -> glossy (low roughness drives the window effects in the shader).
        glass = np.clip((0.42 - lum) / 0.15, 0, 1) * np.clip((0.2 - sat) / 0.1, 0, 1)
        rough = 0.9 - glass * 0.8
        tint = np.clip((lum - 0.55) / 0.15, 0, 1) * np.clip((0.16 - sat) / 0.08, 0, 1) if tintable else np.zeros_like(lum)
        if tintable:
            # Plaster is brightened to near white so the building colour reads true.
            boost = 1 + tint[..., None] * (0.92 / np.maximum(lum[..., None], 0.3) - 1)
            a = np.clip(a * boost, 0, 1)
        color.paste(Image.fromarray((a * 255).astype(np.uint8)), (i * T, r * T))
        aux_px = np.stack([np.zeros_like(lum), rough, tint], axis=2)
        aux.paste(Image.fromarray((aux_px * 255).astype(np.uint8)), (i * T, r * T))
color.save(f'{out}/facades-photo.jpg', quality=88)
aux.save(f'{out}/facades-photo-aux.png')
print('columns', [s[1] for s in STYLES])
