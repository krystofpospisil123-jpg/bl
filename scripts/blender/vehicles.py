# Builds the car and pedestrian models for Blansko: Open World (Blender 5.x, run in a Blender
# Python console or a hosted Blender scene). Exports are saved as public/data/models/vehicles.glb.
# Original designs loosely inspired by common Czech cars; no brand names or logos.
import bpy, bmesh, math
from mathutils import Matrix, Vector

# --- Clean previous car objects
for o in list(bpy.data.objects):
    if o.name.startswith('car_') or o.name.startswith('PREV_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0:
        bpy.data.meshes.remove(m)

def srgb(h):
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def material(name, hexc, rough=0.5, metal=0.0, emis=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(hexc), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emis > 0:
        b.inputs['Emission Color'].default_value = (*srgb(hexc), 1)
        b.inputs['Emission Strength'].default_value = emis
    m.diffuse_color = (*srgb(hexc), 1)
    return m

DETAIL = {
    'glass': (0x1b2630, 0.05, 0.3), 'trim': (0x161718, 0.6, 0.0), 'chrome': (0xc4c8cc, 0.2, 0.9),
    'tyre': (0x151515, 0.9, 0.0), 'rim': (0xa9adb2, 0.3, 0.8), 'headlight': (0xf4f2ea, 0.1, 0.2),
    'taillight': (0xa3121a, 0.2, 0.1), 'plate': (0xeeeeea, 0.4, 0.0), 'plateblue': (0x1f3f9a, 0.4, 0.0),
    'indicator': (0xe08a1e, 0.2, 0.1),
}
SLOTS = ['paint'] + list(DETAIL.keys())
for k, (c, r, mt) in DETAIL.items():
    material(k, c, r, mt, 0.6 if k in ('headlight', 'taillight') else 0.0)

def lin(pts, s):
    if s <= pts[0][0]:
        return pts[0][1]
    for (s0, z0), (s1, z1) in zip(pts, pts[1:]):
        if s <= s1:
            return z0 + (z1 - z0) * (s - s0) / (s1 - s0)
    return pts[-1][1]

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def lerp(a, b, t):
    return a + (b - a) * t

CARS = {
    'liftback': dict(L=4.69, W=1.83, WB=2.69, FO=0.94, R=0.32, zb=0.16, paint=0x2d5a9c,
        top=[(0, .90), (.07, 1.0), (.22, 1.04), (.35, 1.10), (1.2, 1.40), (1.7, 1.46), (2.5, 1.47), (2.95, 1.44), (3.55, .99), (4.5, .86), (4.63, .80), (4.69, .72)],
        belt=[(0, .97), (1.0, 1.0), (3.6, .95), (4.69, .92)], side=(1.0, 3.4), pillars=[(2.35, 'trim')], ws=(2.95, 3.5), rw=(.32, 1.6)),
    'hatch': dict(L=4.11, W=1.78, WB=2.56, FO=0.80, R=0.31, zb=0.15, paint=0xb3262a,
        top=[(0, .92), (.06, 1.0), (.12, 1.03), (.3, 1.38), (.6, 1.45), (1.9, 1.46), (2.45, 1.42), (3.1, .98), (3.95, .84), (4.05, .79), (4.11, .72)],
        belt=[(0, 1.0), (.6, 1.02), (3.2, .95), (4.11, .92)], side=(.55, 2.95), pillars=[(1.75, 'trim')], ws=(2.45, 3.05), rw=(.12, .5)),
    'superb': dict(L=4.87, W=1.86, WB=2.84, FO=0.92, R=0.33, zb=0.16, paint=0x3a3d42,
        top=[(0, .92), (.08, 1.01), (.25, 1.05), (.38, 1.11), (1.3, 1.41), (1.8, 1.47), (2.7, 1.48), (3.15, 1.45), (3.75, .99), (4.7, .87), (4.81, .81), (4.87, .73)],
        belt=[(0, .98), (1, 1.01), (3.8, .96), (4.87, .93)], side=(1.05, 3.6), pillars=[(2.45, 'trim')], ws=(3.15, 3.7), rw=(.35, 1.7)),
    'estate': dict(L=4.69, W=1.83, WB=2.69, FO=0.94, R=0.32, zb=0.16, paint=0xdcdcd6, rails=True,
        top=[(0, .92), (.06, 1.0), (.12, 1.04), (.24, 1.40), (.5, 1.47), (2.5, 1.48), (2.95, 1.44), (3.55, .99), (4.5, .86), (4.63, .80), (4.69, .72)],
        belt=[(0, 1.0), (1, 1.01), (3.6, .95), (4.69, .92)], side=(.35, 3.4), pillars=[(2.35, 'trim'), (1.02, 'paint')], ws=(2.95, 3.5), rw=(.12, .42)),
    'suv': dict(L=4.70, W=1.88, WB=2.79, FO=0.93, R=0.37, zb=0.20, paint=0x3f6a3a, rails=True, archtrim=True,
        top=[(0, 1.02), (.07, 1.12), (.13, 1.17), (.27, 1.56), (.6, 1.66), (2.6, 1.68), (3.05, 1.63), (3.6, 1.13), (4.5, 1.05), (4.64, .98), (4.70, .88)],
        belt=[(0, 1.13), (1, 1.15), (3.6, 1.10), (4.7, 1.05)], side=(.45, 3.45), pillars=[(2.45, 'trim'), (1.15, 'paint')], ws=(3.05, 3.55), rw=(.13, .55)),
    'city': dict(L=3.60, W=1.65, WB=2.42, FO=0.62, R=0.29, zb=0.15, paint=0xd8b23a,
        top=[(0, .92), (.05, 1.0), (.1, 1.03), (.25, 1.40), (.5, 1.48), (1.7, 1.48), (2.2, 1.43), (2.85, 1.0), (3.45, .88), (3.55, .82), (3.6, .74)],
        belt=[(0, 1.0), (.5, 1.02), (2.8, .96), (3.6, .93)], side=(.45, 2.65), pillars=[(1.6, 'trim')], ws=(2.2, 2.8), rw=(.1, .45)),
}

def build_car(name, c, hi):
    L, W, R, zb = c['L'], c['W'], c['R'], c['zb']
    fa = L - c['FO']
    ra = fa - c['WB']
    Ra = R + 0.055
    paint = material('paint_' + name, c['paint'], 0.3, 0.4)
    mats = [paint] + [bpy.data.materials[k] for k in DETAIL]
    mi = {k: i for i, k in enumerate(SLOTS)}

    def halfw(s):
        w = W / 2
        rf, rr = 0.5, 0.4
        d = L - s
        if d < rf:
            w -= (rf - math.sqrt(max(0, rf * rf - (rf - d) ** 2))) * 0.55
        if s < rr:
            w -= (rr - math.sqrt(max(0, rr * rr - (rr - s) ** 2))) * 0.55
        return w

    def zbot(s):
        e = min(s, L - s)
        z = zb + (0.07 * (1 - e / 0.25) ** 2 if e < 0.25 else 0)
        for a in (fa, ra):
            if abs(s - a) < Ra:
                z = max(z, R + math.sqrt(Ra * Ra - (s - a) ** 2))
        return z

    def section(s):
        wb = halfw(s)
        top = lin(c['top'], s)
        belt = lin(c['belt'], s)
        h = top - belt
        g = smooth(0.02, 0.3, h)
        sh = min(belt, top - 0.02)
        wr = W / 2 - 0.19
        p5 = (wb - 0.02, sh)
        p4 = (wb, sh - 0.06)
        z0 = zbot(s)
        p3z = min(max(z0 + 0.2, zb + 0.35), p4[1] - 0.02)
        p2z = min(z0 + 0.12, p3z - 0.02)
        p1z = min(z0, p2z - 0.01)
        cw = lerp(wb - 0.12, wr + 0.08, g)
        pts = [(0, p1z), (wb - 0.08, p1z), (wb - 0.01, p2z), (wb, p3z), p4, p5,
               (cw, sh + 0.01),
               (lerp(wb * 0.6, wr - 0.03, g), lerp(top + 0.01, top - 0.06, g)),
               (lerp(wb * 0.3, wr - 0.16, g), top + 0.01 + 0.01 * (1 - g)),
               (0, top + 0.02)]
        return pts, g, z0 > zb + 0.01

    def seg_mat(s, j, g, arch):
        if j <= 1:
            return 'trim'
        if j == 2 and arch and c.get('archtrim'):
            return 'trim'
        inws = c['ws'][0] <= s <= c['ws'][1]
        inrw = c['rw'][0] <= s <= c['rw'][1]
        if (inws or inrw) and j >= 7:
            return 'glass'
        if j == 6 and g > 0.5 and c['side'][0] <= s <= c['side'][1]:
            for ps, pm in c['pillars']:
                if abs(s - ps) < 0.06:
                    return pm
            return 'glass'
        if j == 5 and g > 0.5 and c['side'][0] <= s <= c['side'][1]:
            return 'trim'
        return 'paint'

    step = 0.06 if hi else 0.2
    n = max(8, int(round(L / step)))
    stations = [L * i / n for i in range(n + 1)]
    if hi:
        stations += [0.02, 0.05, L - 0.02, L - 0.05]
    # Extra stations at the glass and pillar boundaries keep material edges crisp.
    extra = [c['side'][0], c['side'][1], c['ws'][0], c['ws'][1], c['rw'][0], c['rw'][1]]
    for ps, _ in c['pillars']:
        extra += [ps - 0.06, ps + 0.06]
    for e in extra:
        if 0 < e < L and all(abs(e - s) > 0.015 for s in stations):
            stations.append(e)
    stations.sort()

    bm = bmesh.new()
    rings = []
    info = []
    for s in stations:
        pts, g, arch = section(s)
        y = -(s - L / 2)
        ring = [bm.verts.new((x, y, z)) for x, z in pts]
        ring += [bm.verts.new((-x, y, z)) for x, z in reversed(pts[1:-1])]
        rings.append(ring)
        info.append((g, arch))
    m = len(rings[0])  # 18
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        sm = (stations[i] + stations[i + 1]) / 2
        g = (info[i][0] + info[i + 1][0]) / 2
        arch = info[i][1] or info[i + 1][1]
        for k in range(m):
            k2 = (k + 1) % m
            # Half-segment index: right side k = 0..8, left side mirrored.
            j = k if k < 9 else 17 - k
            f = bm.faces.new((a[k], a[k2], b[k2], b[k]))
            f.material_index = mi[seg_mat(sm, j, g, arch)]
            f.smooth = True
    for ring, rev in ((rings[0], False), (rings[-1], True)):
        f = bm.faces.new(list(reversed(ring)) if rev else ring)
        f.material_index = mi['paint']
        f.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    def box(cx, cy, cz, sx, sy, sz, mat, rz=0.0, rx=0.0):
        mtx = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Diagonal((sx, sy, sz, 1))
        r = bmesh.ops.create_cube(bm, size=1.0, matrix=mtx)
        for v in r['verts']:
            for f in v.link_faces:
                f.material_index = mi[mat]
                f.smooth = False

    yF, yR = -L / 2, L / 2
    wF, wR = halfw(L), halfw(0)
    tF, tR = lin(c['top'], L), lin(c['top'], 0)
    # --- Front: chrome-framed grille with vertical slats, headlights, plate, lower intake.
    def outline(u, front):
        """Point on the plan outline at arc length u from the centre of the front (or rear) face."""
        wE = wF if front else wR
        yE = yF if front else yR
        if u <= wE:
            return u, yE, 0.0, (-1.0 if front else 1.0)
        s_ = L - (u - wE) * 0.85 if front else (u - wE) * 0.85
        ds = -0.01 if front else 0.01
        x, y = halfw(s_), -(s_ - L / 2)
        x2, y2 = halfw(s_ + ds), -(s_ + ds - L / 2)
        tx, ty = x2 - x, y2 - y
        ln = math.hypot(tx, ty) or 1
        nx, ny = ty / ln, -tx / ln
        if nx < 0:
            nx, ny = -nx, -ny
        return x, y, nx, ny

    def ribbon(u0, u1, z0f, z1f, mat, front, steps, off=0.008):
        for sd in (-1, 1):
            rows = []
            for i in range(steps + 1):
                u = u0 + (u1 - u0) * i / steps
                x, y, nx, ny = outline(u, front)
                t = i / steps
                rows.append([bm.verts.new((sd * (x + nx * off), y + ny * off, z)) for z in (z0f(t), z1f(t))])
            for i in range(steps):
                (a0, a1), (b0, b1) = rows[i], rows[i + 1]
                f = bm.faces.new((a0, b0, b1, a1))
                x, y, nx, ny = outline(u0 + (u1 - u0) * (i + 0.5) / steps, front)
                f.normal_update()
                if f.normal.dot(Vector((sd * nx, ny, 0))) < 0:
                    f.normal_flip()
                f.material_index = mi[mat]
                f.smooth = False

    def plate_poly(pts, y, mat, front):
        vs = [bm.verts.new((x, y, z)) for x, z in pts]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.y * (-1 if front else 1) < 0:
            f.normal_flip()
        f.material_index = mi[mat]
        f.smooth = False

    stp = 8 if hi else 3
    # --- Front: angular headlights wrapping round the corners, trapezoid grille with vertical
    # slats in a chrome frame, wide lower intake, plate.
    gw = 0.72 if W > 1.8 else 0.6
    gz0, gz1 = tF - 0.19, tF - 0.055
    plate_poly([(-gw / 2 - 0.05, gz0 - 0.02), (gw / 2 + 0.05, gz0 - 0.02), (gw / 2 + 0.02, gz1 + 0.02), (-gw / 2 - 0.02, gz1 + 0.02)], yF - 0.004, 'chrome', True)
    plate_poly([(-gw / 2 - 0.03, gz0), (gw / 2 + 0.03, gz0), (gw / 2, gz1), (-gw / 2, gz1)], yF - 0.007, 'trim', True)
    if hi:
        nsl = 11
        for i in range(nsl):
            xx = -gw / 2 + gw * (i + 0.5) / nsl
            box(xx, yF - 0.012, (gz0 + gz1) / 2, 0.014, 0.012, gz1 - gz0 - 0.01, 'chrome')
    ribbon(gw / 2 + 0.04, wF + 0.36, lambda t: tF - 0.17 + 0.05 * t, lambda t: tF - 0.05 + 0.005 * t, 'headlight', True, stp)
    ribbon(gw / 2 + 0.08, wF + 0.1, lambda t: tF - 0.16 + 0.04 * t, lambda t: tF - 0.115 + 0.04 * t, 'trim', True, stp, 0.011)
    iw = wF * 0.78
    plate_poly([(-iw, zb + 0.09), (iw, zb + 0.09), (iw - 0.08, zb + 0.2), (-iw + 0.08, zb + 0.2)], yF - 0.005, 'trim', True)
    for sd in (-1, 1):
        plate_poly([(sd * (wF - 0.2), zb + 0.08), (sd * (wF - 0.06), zb + 0.08), (sd * (wF - 0.06), zb + 0.14), (sd * (wF - 0.2), zb + 0.14)], yF - 0.007, 'chrome', True)
    plate_poly([(-0.26, zb + 0.22), (0.26, zb + 0.22), (0.26, zb + 0.33), (-0.26, zb + 0.33)], yF - 0.008, 'plate', True)
    plate_poly([(-0.26, zb + 0.22), (-0.215, zb + 0.22), (-0.215, zb + 0.33), (-0.26, zb + 0.33)], yF - 0.011, 'plateblue', True)
    # --- Rear: C-shaped lights round the corners, plate, chrome strip, dark diffuser.
    tz = tR - 0.06
    ribbon(wR - 0.46, wR + 0.32, lambda t: tz - 0.11 - 0.02 * t, lambda t: tz, 'taillight', False, stp)
    ribbon(wR - 0.44, wR - 0.2, lambda t: tz - 0.075, lambda t: tz - 0.06, 'trim', False, 1, 0.011)
    plate_poly([(-wR * 0.4, tR - 0.24), (wR * 0.4, tR - 0.24), (wR * 0.4, tR - 0.225), (-wR * 0.4, tR - 0.225)], yR + 0.006, 'chrome', False)
    plate_poly([(-0.26, zb + 0.42), (0.26, zb + 0.42), (0.26, zb + 0.53), (-0.26, zb + 0.53)], yR + 0.006, 'plate', False)
    plate_poly([(-0.26, zb + 0.42), (-0.215, zb + 0.42), (-0.215, zb + 0.53), (-0.26, zb + 0.53)], yR + 0.009, 'plateblue', False)
    plate_poly([(-wR * 0.85, zb + 0.08), (wR * 0.85, zb + 0.08), (wR * 0.8, zb + 0.17), (-wR * 0.8, zb + 0.17)], yR + 0.005, 'trim', False)
    for sd in (-1, 1):
        plate_poly([(sd * (wR - 0.25), zb + 0.2), (sd * (wR - 0.08), zb + 0.2), (sd * (wR - 0.08), zb + 0.24), (sd * (wR - 0.25), zb + 0.24)], yR + 0.007, 'taillight', False)
    belt_at = lambda s: min(lin(c['belt'], s), lin(c['top'], s) - 0.02)
    sm = c['ws'][1] - 0.12
    for sd in (-1, 1):
        wb = halfw(sm)
        box(sd * (wb + 0.07), -(sm - L / 2), belt_at(sm) + 0.08, 0.17, 0.09, 0.11, 'paint')
        box(sd * (wb + 0.0), -(sm - L / 2) + 0.02, belt_at(sm) + 0.04, 0.07, 0.05, 0.04, 'trim')
        b = c['pillars'][0][0]
        doors = [c['side'][1] - 0.05, b, c['side'][0] + 0.1 if len(c['pillars']) == 1 else c['pillars'][1][0]]
        for ds in doors:
            z1 = belt_at(ds) - 0.03
            wb = halfw(ds)
            zl = max(zbot(ds) + 0.12, zb + 0.14)
            if hi:
                box(sd * (wb + 0.001), -(ds - L / 2), (zl + z1) / 2, 0.006, 0.008, z1 - zl, 'trim')
        for hs in (b + 0.25, doors[2] + 0.25 if doors[2] < b else b - 0.6):
            box(sd * (halfw(hs) + 0.006), -(hs - L / 2), belt_at(hs) - 0.12, 0.02, 0.17, 0.03, 'chrome' if name in ('superb',) else 'paint')
    if c.get('rails'):
        for sd in (-1, 1):
            s0, s1 = c['rw'][1] + 0.1, c['ws'][0] - 0.05
            zt = lin(c['top'], (s0 + s1) / 2)
            box(sd * (W / 2 - 0.19 - 0.12), -((s0 + s1) / 2 - L / 2), zt + 0.05, 0.04, s1 - s0, 0.04, 'chrome')
    # --- Wheels (merged for traffic; the player car uses separate wheel objects too).
    seg = 24 if hi else 10
    tw = 0.22
    wx = W / 2 - 0.15
    for a in (fa, ra):
        for sd in (-1, 1):
            add_wheel(bm, mi, (sd * wx, -(a - L / 2), R), R, tw, seg, hi, sd)

    me = bpy.data.meshes.new(f'car_{name}_{"hi" if hi else "lo"}')
    bm.to_mesh(me)
    bm.free()
    for mt in mats:
        me.materials.append(mt)
    ob = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, (wx, -(fa - L / 2), -(ra - L / 2), R)

def add_wheel(bm, mi, center, R, tw, seg, hi, sd):
    cx, cy, cz = center
    rot = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=R, radius2=R, depth=tw, matrix=rot)
    for v in r['verts']:
        for f in v.link_faces:
            f.material_index = mi['tyre']
            f.smooth = True
    rot2 = Matrix.Translation((cx + sd * (tw / 2 - 0.012), cy, cz)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=R * 0.66, radius2=R * 0.66, depth=0.03, matrix=rot2)
    for v in r['verts']:
        for f in v.link_faces:
            f.material_index = mi['rim']
            f.smooth = False
    if hi:
        for k in range(5):
            ang = k * 2 * math.pi / 5
            m = (Matrix.Translation((cx + sd * (tw / 2 - 0.0), cy, cz)) @ Matrix.Rotation(ang, 4, 'X')
                 @ Matrix.Translation((0, 0, R * 0.33)) @ Matrix.Diagonal((0.025, 0.07, R * 0.6, 1)))
            r = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
            for v in r['verts']:
                for f in v.link_faces:
                    f.material_index = mi['rim']
                    f.smooth = False
        m = Matrix.Translation((cx + sd * (tw / 2 + 0.004), cy, cz)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.07, radius2=0.07, depth=0.02, matrix=m)
        for v in r['verts']:
            for f in v.link_faces:
                f.material_index = mi['trim']

def build_wheel(name, R, hi):
    bm = bmesh.new()
    mi = {k: i for i, k in enumerate(SLOTS)}
    add_wheel(bm, mi, (0, 0, 0), R, 0.22, 24 if hi else 10, hi, 1)
    me = bpy.data.meshes.new(f'car_{name}_wheel')
    bm.to_mesh(me)
    bm.free()
    for k in SLOTS:
        me.materials.append(bpy.data.materials['paint_' + name] if k == 'paint' else bpy.data.materials[k])
    ob = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

summary = {}
x = 0.0
for name, c in CARS.items():
    root = bpy.data.objects.new(f'car_{name}', None)
    bpy.context.scene.collection.objects.link(root)
    root.location = (x, 0, 0)
    hi, wheels = build_car(name, c, True)
    lo, _ = build_car(name, c, False)
    hi.parent = root
    lo.parent = root
    lo.location = (0, 0, 0)
    lo.hide_render = True
    wh = build_wheel(name, c['R'], True)
    wh.parent = root
    wh.location = (0, 6, 0)
    wh.hide_render = True
    wx, yf, yr, R = wheels
    for tag, (px, py) in {'FL': (wx, yf), 'FR': (-wx, yf), 'RL': (wx, yr), 'RR': (-wx, yr)}.items():
        e = bpy.data.objects.new(f'car_{name}_w{tag}', None)
        bpy.context.scene.collection.objects.link(e)
        e.parent = root
        e.location = (px, py, R)
    summary[name] = {'hi_tris': sum(len(p.vertices) - 2 for p in hi.data.polygons),
                     'lo_tris': sum(len(p.vertices) - 2 for p in lo.data.polygons),
                     'dims': [round(v, 2) for v in hi.dimensions]}
    x += c['W'] + 1.4

result = summary

# ---------------- NPC body parts (pedestrians and player) ----------------
for o in list(bpy.data.objects):
    if o.name.startswith('npc'):
        bpy.data.objects.remove(o, do_unlink=True)
NPC_MATS = {'tint': material('tint', 0xffffff, 0.8), 'tint_dark': material('tint_dark', 0x6a6a6a, 0.8),
            'hair': material('hair', 0x5a4632, 0.9), 'eye': material('eye', 0x1a1a1a, 0.4),
            'shoe': material('shoe', 0x3a3a3a, 0.7), 'lip': material('lip', 0xb07a6a, 0.7)}
NSLOTS = list(NPC_MATS.keys())

def loft(bm, secs, mat, seg=12, cx=0.0, cy=0.0, caps=True, yoff=None):
    """Ellipse rings (z, rx, ry[, dy]) along z; dy shifts a ring forward (-y)."""
    rings = []
    for sec in secs:
        z, rx, ry = sec[:3]
        dy = sec[3] if len(sec) > 3 else 0.0
        rings.append([bm.verts.new((cx + rx * math.cos(2 * math.pi * k / seg), cy - dy + ry * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)])
    faces = []
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            faces.append(bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k])))
    if caps:
        faces.append(bm.faces.new(list(reversed(rings[0]))))
        faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = NSLOTS.index(mat)
        f.smooth = True
    return faces

def ellipsoid(bm, c, r, mat, seg=12, rings=8, zcut=None):
    secs = []
    for i in range(rings + 1):
        t = -math.pi / 2 + math.pi * i / rings
        z = c[2] + r[2] * math.sin(t)
        if zcut is not None and z < zcut:
            continue
        secs.append((z, max(r[0] * math.cos(t), 0.004), max(r[1] * math.cos(t), 0.004)))
    return loft(bm, secs, mat, seg, c[0], c[1])

def npc_object(name, build, loc=(0, 0, 0)):
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for k in NSLOTS:
        me.materials.append(NPC_MATS[k])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    return ob

def b_torso(bm):
    loft(bm, [(0.9, .155, .1), (0.98, .165, .108)], 'tint_dark', 14)
    loft(bm, [(0.98, .165, .108), (1.08, .15, .1), (1.2, .165, .108), (1.32, .195, .118, -0.005), (1.42, .205, .115), (1.48, .19, .1), (1.52, .12, .08), (1.54, .06, .05)], 'tint', 14)

def b_head(bm):
    loft(bm, [(1.5, .052, .052), (1.62, .05, .05)], 'tint', 10)
    ellipsoid(bm, (0, -0.005, 1.71), (.09, .105, .118), 'tint', 14, 10)
    ellipsoid(bm, (0, 0.012, 1.735), (.097, .108, .108), 'hair', 14, 8, zcut=1.705)
    ellipsoid(bm, (0, -0.108, 1.705), (.016, .02, .028), 'tint', 6, 4)  # nose
    for sd in (-1, 1):
        ellipsoid(bm, (sd * .036, -0.094, 1.735), (.012, .006, .008), 'eye', 6, 4)
        ellipsoid(bm, (sd * .09, 0.0, 1.71), (.014, .022, .03), 'tint', 6, 4)  # ears
    ellipsoid(bm, (0, -0.098, 1.655), (.025, .006, .007), 'lip', 6, 3)

def b_arm(bm):
    loft(bm, [(0.02, .055, .06), (-0.04, .062, .064), (-0.28, .05, .05), (-0.31, .046, .046), (-0.56, .038, .034), (-0.585, .035, .032)], 'tint', 10)

def b_hand(bm):
    ellipsoid(bm, (0, -0.005, -0.65), (.033, .045, .07), 'tint', 8, 6)

def b_leg(bm):
    loft(bm, [(0.02, .082, .085), (-0.1, .085, .09), (-0.44, .062, .066), (-0.49, .058, .062), (-0.8, .046, .05), (-0.84, .046, .05)], 'tint', 10)
    loft(bm, [(-0.84, .05, .12, 0.04), (-0.88, .055, .135, 0.05), (-0.92, .052, .13, 0.05)], 'shoe', 10)

npc_root = bpy.data.objects.new('npc', None)
bpy.context.scene.collection.objects.link(npc_root)
npc_root.location = (-3, 0, 0)
parts = {}
for nm, fn, loc in [('npc_torso', b_torso, (0, 0, 0)), ('npc_head', b_head, (0, 0, 0)), ('npc_arm', b_arm, (0.27, 0, 1.44)),
                    ('npc_hand', b_hand, (0.27, 0, 1.44)), ('npc_leg', b_leg, (0.1, 0, 0.92))]:
    ob = npc_object(nm, fn, loc)
    ob.parent = npc_root
    parts[nm] = sum(len(p.vertices) - 2 for p in ob.data.polygons)
for nm, src, loc in [('npc_armR', 'npc_arm', (-0.27, 0, 1.44)), ('npc_handR', 'npc_hand', (-0.27, 0, 1.44)), ('npc_legR', 'npc_leg', (-0.1, 0, 0.92))]:
    ob = bpy.data.objects.new(nm, bpy.data.objects[src].data)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = npc_root
    ob.location = loc
summary['npc'] = parts
result = summary

# ---------------- Police car ----------------
# Built in a second step from the estate (see the project history): white paint, blue band and a
# yellow-green checker band on the sides, "POLICIE" lettering (Blender text converted to mesh)
# on the front doors and tailgate, roof light bar with separate left/right lenses (materials
# beaconL / beaconR, flashed by the game). Exported as car_police_hi / _lo / _wheel / _w*.
