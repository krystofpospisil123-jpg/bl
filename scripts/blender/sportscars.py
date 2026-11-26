# Sports cars for Blansko: Open World, built in Blender 5.x (works headless via the `bpy`
# module from PyPI, in a Blender Python console, or in a hosted Blender scene):
#
#   python scripts/blender/sportscars.py            (with `pip install bpy`)
#
# Two original designs, no brand names or logos:
#   rosso – a mid-engine supercar: long low nose, cab-forward glasshouse, wide rear haunches,
#           side intakes, louvred engine cover, twin round tail lights, quad exhausts.
#   gt    – a rear-engine sports coupé: round headlights on raised front wings, fastback roof,
#           wide rear hips, ducktail spoiler, full-width light bar.
#
# The body is lofted from cross-sections (rear to front) and smoothed with a subdivision
# surface; lights, intakes, door lines and grilles are projected onto the smoothed surface.
# Output: public/data/models/sportscars.glb with the same structure as vehicles.glb
# (car_<t>, car_<t>_hi, car_<t>_lo, car_<t>_wheel, car_<t>_wFL/FR/RL/RR) so the game loads them
# like the other cars. Blender: Z up, cars face -Y, ground at z = 0.
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__ if '__file__' in dir() else '.')), '..', '..', 'public', 'data', 'models', 'sportscars.glb')
PREVIEW = os.environ.get('PREVIEW_DIR')  # optional: render previews there

# ------------------------------------------------------------------ scene and materials
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
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

# Same names as vehicles.py (the game bakes colours and roughness by material name).
DETAIL = {
    'glass': (0x141c24, 0.04, 0.3, 0), 'trim': (0x121314, 0.55, 0.0, 0), 'chrome': (0xc8ccd0, 0.18, 0.95, 0),
    'tyre': (0x141414, 0.9, 0.0, 0), 'rim': (0xb4b8bc, 0.25, 0.85, 0), 'headlight': (0xf6f4ee, 0.08, 0.2, 0.8),
    'taillight': (0xb0101a, 0.2, 0.1, 0.8), 'plate': (0xeeeeea, 0.4, 0.0, 0), 'plateblue': (0x1f3f9a, 0.4, 0.0, 0),
    'indicator': (0xe08a1e, 0.2, 0.1, 0.3), 'caliper': (0xd8b020, 0.35, 0.2, 0), 'disc': (0x6a6c70, 0.45, 0.8, 0),
    'carbon': (0x1c1d20, 0.35, 0.3, 0), 'caliperred': (0xc01a1a, 0.35, 0.2, 0),
}
for k, (c, r, mt, e) in DETAIL.items():
    material(k, c, r, mt, e)
SLOTS = ['paint'] + list(DETAIL.keys())

def lin(pts, s):
    if s <= pts[0][0]:
        return pts[0][1]
    for (s0, z0), (s1, z1) in zip(pts, pts[1:]):
        if s <= s1:
            t = (s - s0) / (s1 - s0)
            t = t * t * (3 - 2 * t) * 0.5 + t * 0.5  # eased: rounder profiles
            return z0 + (z1 - z0) * t
    return pts[-1][1]

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def lerp(a, b, t):
    return a + (b - a) * t

# ------------------------------------------------------------------ car specs
# s = distance from the rear bumper (0) to the front (L).
CARS = {
    'rosso': dict(
        L=4.60, W=1.98, R=0.345, ra=0.98, fa=3.60, zb=0.11, paint=0xc4161c, cabin=(1.55, 3.36), wr=0.56,
        # centreline height of the upper surface (deck, roof, hood)
        top=[(0, .74), (.05, .92), (.16, .98), (.7, 1.0), (1.25, 1.05), (1.7, 1.14), (2.15, 1.18), (2.55, 1.15), (3.36, .84), (3.85, .76), (4.3, .66), (4.5, .56), (4.6, .42)],
        # shoulder (side crease) height
        belt=[(0, .78), (.5, .89), (1.0, .93), (1.6, .89), (2.4, .82), (3.0, .79), (3.6, .80), (4.2, .70), (4.6, .45)],
        # half width of the body before flares, and flare bulges at the axles
        half=0.93, flareF=0.04, flareR=0.07, noseIn=0.12, tailIn=0.04,
        side=(1.72, 2.92), ws=(2.72, 3.37), rw=(1.18, 1.72), exhausts=4, tail='round', head='blade', caliper='caliperred',
    ),
    'gt': dict(
        L=4.52, W=1.86, R=0.335, ra=1.06, fa=3.51, zb=0.12, paint=0xd8dcde, cabin=(0.95, 3.2), wr=0.52,
        top=[(0, .80), (.05, .93), (.14, .99), (.3, 1.02), (.42, .98), (.9, 1.05), (1.4, 1.21), (1.9, 1.29), (2.35, 1.28), (2.82, 1.11), (3.18, .90), (3.6, .80), (4.15, .72), (4.42, .63), (4.52, .50)],
        belt=[(0, .80), (.55, .86), (1.05, .91), (1.7, .87), (2.7, .84), (3.3, .86), (3.9, .87), (4.25, .80), (4.52, .55)],
        half=0.885, flareF=0.03, flareR=0.06, noseIn=0.10, tailIn=0.05,
        side=(1.55, 2.78), ws=(2.80, 3.20), rw=(0.92, 1.58), exhausts=2, tail='bar', head='round', wings=True,
    ),
    'rs': dict(L=4.69, W=1.81, R=0.33, ra=0.97, fa=3.65, zb=0.13, paint=0x1f5fa8, cabin=(0.22, 3.58), wr=0.70,
        top=[(0, .80), (.06, .92), (.2, .99), (.35, 1.05), (1.2, 1.37), (1.7, 1.43), (2.5, 1.44), (2.95, 1.41), (3.58, .97), (4.0, .91), (4.45, .84), (4.62, .77), (4.69, .69)],
        belt=[(0, .94), (1.0, .97), (3.6, .92), (4.2, .87), (4.69, .74)],
        half=0.875, flareF=0.02, flareR=0.025, noseIn=0.09, tailIn=0.03,
        side=(1.0, 3.42), ws=(2.95, 3.58), rw=(0.36, 1.18), pillars=[2.12], exhausts=2, tail='c', head='rs', tallglass=True, caliper='caliperred',
    ),
}

# ------------------------------------------------------------------ body
NP = 12  # points per half section (bottom centre -> roof centre)

def make_body(name, c, hi):
    L, R, zb = c['L'], c['R'], c['zb']
    ra, fa = c['ra'], c['fa']
    Ra = R + 0.07

    def halfw(s):
        w = c['half']
        w += c['flareR'] * math.exp(-((s - ra) / 0.55) ** 2) + c['flareF'] * math.exp(-((s - fa) / 0.5) ** 2)
        # Plan view: round the nose and the tail.
        d = L - s
        if d < 0.9:
            w -= c['noseIn'] * (1 - d / 0.9) ** 1.6
        if d < 0.35:
            w -= (0.35 - math.sqrt(max(0, 0.35 ** 2 - (0.35 - d) ** 2))) * 0.9
        if s < 0.28:
            w -= (0.28 - math.sqrt(max(0, 0.28 ** 2 - (0.28 - s) ** 2))) * 0.8 + c['tailIn'] * (1 - s / 0.28)
        return w

    def zbot(s):
        e = min(s, L - s)
        z = zb + (0.09 * (1 - e / 0.35) ** 2 if e < 0.35 else 0)
        for a in (fa, ra):
            if abs(s - a) < Ra:
                z = max(z, R + math.sqrt(Ra * Ra - (s - a) ** 2) * 0.92)
        return z

    def section(s):
        wb = halfw(s)
        top = lin(c['top'], s)
        zs = lin(c['belt'], s)
        z0 = zbot(s)
        c0, c1 = c['cabin']
        g = smooth(c0 - 0.05, c0 + 0.35, s) * (1 - smooth(c1 - 0.45, c1 + 0.02, s))
        g *= smooth(0.04, 0.22, top - zs)
        wr = c['wr']
        wg = wb - 0.13
        # Lower body: floor, sill, rocker, flank, shoulder.
        low = [(0, z0), (wb - 0.16, z0), (wb - 0.05, z0 + 0.035), (wb - 0.01, z0 + 0.13),
               (wb, lerp(z0 + 0.13, zs, 0.5)), (wb - 0.005, zs - 0.06), (wb - 0.03, zs)]
        # Upper: deck (hood / engine cover) or glasshouse, blended by g.
        if c.get('wings') and zs > top:
            # Raised front wings: the wing peaks near the side, then the hood drops between them.
            deck = [(wb - 0.12, zs + 0.025), (wb - 0.27, zs + 0.01), (wb * 0.55, top + 0.004), (wb * 0.22, top), (0, top + 0.002)]
        else:
            deck = [(wb - 0.10, lerp(zs, top, 0.35)), (wb * 0.72, lerp(zs, top, 0.75)), (wb * 0.42, top - 0.004), (wb * 0.18, top), (0, top + 0.002)]
        cab = [(wg, zs + 0.02), (lerp(wg, wr, 0.55) + 0.02, lerp(zs, top, 0.6)), (wr + 0.01, top - 0.035), (wr * 0.55, top - 0.008), (0, top)]
        up = [(lerp(a[0], b[0], g), lerp(a[1], b[1], g)) for a, b in zip(deck, cab)]
        return low + up, g

    def seg_mat(s, j, g):
        # j = segment between point j and j+1 of the half section (0..NP-2)
        if j <= 1:
            return 'trim'
        if j == 2:
            return 'carbon'
        inws = c['ws'][0] <= s <= c['ws'][1]
        inrw = c['rw'][0] <= s <= c['rw'][1]
        if (inws or inrw) and j >= 8 and g > 0.25:
            return 'glass'
        if (j == 7 or (j == 8 and c.get('tallglass'))) and g > 0.5 and c['side'][0] <= s <= c['side'][1]:
            if any(abs(s - ps) < 0.055 for ps in c.get('pillars', [])):
                return 'trim'
            return 'glass'
        return 'paint'

    step = 0.045 if hi else 0.16
    n = max(10, int(round(L / step)))
    stations = sorted(set([L * i / n for i in range(n + 1)] + ([0.015, 0.035, L - 0.015, L - 0.035] if hi else [])
                          + [v for v in (*c['side'], *c['ws'], *c['rw'], *[p + d for p in c.get('pillars', []) for d in (-0.055, 0.055)]) if 0 < v < L]))
    bm = bmesh.new()
    rings = []
    meta = []
    for s in stations:
        pts, g = section(s)
        y = L / 2 - s
        ring = [bm.verts.new((x, y, z)) for x, z in pts]
        ring += [bm.verts.new((-x, y, z)) for x, z in reversed(pts[1:-1])]
        rings.append(ring)
        meta.append(g)
    m = len(rings[0])
    mi = {k: i for i, k in enumerate(SLOTS)}
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        sm = (stations[i] + stations[i + 1]) / 2
        g = (meta[i] + meta[i + 1]) / 2
        for k in range(m):
            k2 = (k + 1) % m
            j = k if k < NP - 1 else (2 * NP - 3) - k
            f = bm.faces.new((a[k], a[k2], b[k2], b[k]))
            f.material_index = mi[seg_mat(sm, j, g)]
            f.smooth = True
    for ring, rev in ((rings[0], False), (rings[-1], True)):
        f = bm.faces.new(list(reversed(ring)) if rev else ring)
        f.material_index = mi['paint']
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(f'tmp_{name}')
    bm.to_mesh(me)
    bm.free()
    for k in SLOTS:
        me.materials.append(bpy.data.materials['paint_' + name] if k == 'paint' else bpy.data.materials[k])
    ob = bpy.data.objects.new(f'tmp_{name}_{hi}', me)
    bpy.context.scene.collection.objects.link(ob)
    if hi:
        mod = ob.modifiers.new('sub', 'SUBSURF')
        mod.levels = 1
        mod.render_levels = 1
        dg = bpy.context.evaluated_depsgraph_get()
        me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob, do_unlink=True)
        ob = bpy.data.objects.new(f'tmp_{name}_{hi}', me2)
        bpy.context.scene.collection.objects.link(ob)
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob, section, halfw

# ------------------------------------------------------------------ projecting details onto the body

class Surface:
    """Ray-casts onto the smoothed body to place details flush with the paint."""
    def __init__(self, ob, section, L):
        dg = bpy.context.evaluated_depsgraph_get()
        self.bvh = BVHTree.FromObject(ob, dg)
        self.section, self.L = section, L

    def side_point(self, s, t, side=1):
        """Point at arc-fraction t (0 bottom centre .. 1 top centre) of the section at s."""
        pts, _ = self.section(s)
        seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        tot = sum(seg)
        d = t * tot
        for i, l in enumerate(seg):
            if d <= l or i == len(seg) - 1:
                u = d / l if l else 0
                x = lerp(pts[i][0], pts[i + 1][0], u)
                z = lerp(pts[i][1], pts[i + 1][1], u)
                nx, nz = pts[i + 1][1] - pts[i][1], -(pts[i + 1][0] - pts[i][0])
                ln = math.hypot(nx, nz) or 1
                return Vector((side * x, self.L / 2 - s, z)), Vector((side * nx / ln, 0, nz / ln))
            d -= l

    def at(self, s, v, mode, side=1):
        """mode 'z': point on the flank at height v; mode 'x': point on the top at x = v * half width."""
        if mode == 't':
            return self.side_point(s, v, side)
        pts, _ = self.section(s)
        if mode == 'z':
            seq = pts[2:8]
            for a, b in zip(seq, seq[1:]):
                if min(a[1], b[1]) <= v <= max(a[1], b[1]) and a[1] != b[1]:
                    u = (v - a[1]) / (b[1] - a[1])
                    break
            else:
                a, b, u = seq[-2], seq[-1], 1.0
        else:
            wb = max(p[0] for p in pts)
            x = v * wb
            seq = pts[6:]
            for a, b in zip(seq, seq[1:]):
                if min(a[0], b[0]) <= x <= max(a[0], b[0]) and a[0] != b[0]:
                    u = (x - a[0]) / (b[0] - a[0])
                    break
            else:
                a, b, u = seq[0], seq[1], 0.0
        x = lerp(a[0], b[0], u)
        z = lerp(a[1], b[1], u)
        nx, nz = b[1] - a[1], -(b[0] - a[0])
        if mode == 'x' and nz < 0:
            nx, nz = -nx, -nz
        if mode == 'z' and nx < 0:
            nx, nz = -nx, -nz
        ln = math.hypot(nx, nz) or 1
        return Vector((side * x, self.L / 2 - s, z)), Vector((side * nx / ln, 0, nz / ln))

    def hit(self, p, n):
        o = p + n * 0.25
        r = self.bvh.ray_cast(o, -n, 0.6)
        if r[0] is None:
            return p, n
        hp, hn = r[0], r[1]
        if hn.dot(n) < 0:
            hn = -hn
        return hp, hn

def decal(bm, mi, surf, s0, s1, t0, t1, mat, side, ns=6, nt=3, off=0.004, shape=None, mode='z'):
    """A patch on the body between stations s0..s1 and arc fractions t0..t1 (on one side)."""
    grid = []
    for i in range(ns + 1):
        row = []
        for k in range(nt + 1):
            u, v = i / ns, k / nt
            if shape:
                u, v = shape(u, v)
            p, n = surf.at(lerp(s0, s1, u), lerp(t0, t1, v), mode, side)
            hp, hn = surf.hit(p, n)
            row.append(bm.verts.new(hp + hn * off))
        grid.append(row)
    for i in range(ns):
        for k in range(nt):
            f = bm.faces.new((grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]))
            f.normal_update()
            ctr = f.calc_center_median()
            p, n = surf.at(lerp(s0, s1, (i + 0.5) / ns), lerp(t0, t1, (k + 0.5) / nt), mode, side)
            if f.normal.dot(n) < 0:
                f.normal_flip()
            f.material_index = mi[mat]
            f.smooth = True
    return grid

def front_patch(bm, mi, surf, x0, x1, z0, z1, y_front, mat, nx=6, nz=2, off=0.004, dirn=-1):
    """A patch on the nose (dirn = -1) or tail (dirn = +1) found by casting rays along Y."""
    grid = []
    for i in range(nx + 1):
        row = []
        for k in range(nz + 1):
            x, z = lerp(x0, x1, i / nx), lerp(z0, z1, k / nz)
            o = Vector((x, y_front + dirn * 0.6, z))
            r = surf.bvh.ray_cast(o, Vector((0, -dirn, 0)), 2.0)
            if r[0] is None or abs(r[0].y - y_front) > 0.5:
                row.append(None)
                continue
            p, n = r[0], r[1]
            if n.y * dirn < 0:
                n = -n
            row.append(bm.verts.new(p + n * off))
        grid.append(row)
    for i in range(nx):
        for k in range(nz):
            if None in (grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]):
                continue
            f = bm.faces.new((grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]))
            f.normal_update()
            if f.normal.y * dirn < 0:
                f.normal_flip()
            f.material_index = mi[mat]
            f.smooth = True

def disc(bm, mi, center, normal, r, mat, seg=20, depth=0.02):
    q = Vector((0, 0, 1)).rotation_difference(normal)
    mtx = Matrix.Translation(center) @ q.to_matrix().to_4x4()
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=depth, matrix=mtx)
    for v in res['verts']:
        for f in v.link_faces:
            f.material_index = mi[mat]
            f.smooth = False

def box(bm, mi, c, size, mat, rot=None):
    mtx = Matrix.Translation(c) @ ((rot.to_4x4()) if rot is not None else Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
    res = bmesh.ops.create_cube(bm, size=1.0, matrix=mtx)
    for v in res['verts']:
        for f in v.link_faces:
            f.material_index = mi[mat]
            f.smooth = False

def cyl(bm, mi, c, axis, r, depth, mat, seg=14, r2=None):
    q = Vector((0, 0, 1)).rotation_difference(axis)
    mtx = Matrix.Translation(c) @ q.to_matrix().to_4x4()
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth, matrix=mtx)
    for v in res['verts']:
        for f in v.link_faces:
            f.material_index = mi[mat]
            f.smooth = True

# ------------------------------------------------------------------ wheels

def add_wheel(bm, mi, center, R, tw, sd, style, hi, caliper='caliper'):
    cx, cy, cz = center
    seg = 32 if hi else 12
    ax = Matrix.Rotation(math.pi / 2, 4, 'Y')
    # Tyre: lathe profile with rounded shoulders.
    prof = [(R * 0.70, -tw / 2), (R * 0.93, -tw / 2), (R * 0.985, -tw / 2 + 0.025), (R, -tw / 2 + 0.06), (R, tw / 2 - 0.06),
            (R * 0.985, tw / 2 - 0.025), (R * 0.93, tw / 2), (R * 0.70, tw / 2)]
    rings = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        rings.append([bm.verts.new((cx + x_, cy + rr * math.cos(a), cz + rr * math.sin(a))) for rr, x_ in prof])
    for k in range(seg):
        a, b = rings[k], rings[(k + 1) % seg]
        for i in range(len(prof) - 1):
            f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
            f.material_index = mi['tyre']
            f.smooth = True
    out = sd * (tw / 2 - 0.02)
    # Rim barrel (dark inside) and the face.
    cyl(bm, mi, Vector((cx, cy, cz)), Vector((1, 0, 0)), R * 0.71, tw - 0.01, 'trim', seg)
    disc(bm, mi, Vector((cx + out, cy, cz)), Vector((sd, 0, 0)), R * 0.71, 'rim', seg, 0.012)
    if hi:
        # Brake disc and caliper behind the spokes.
        disc(bm, mi, Vector((cx + sd * 0.0, cy, cz)), Vector((1, 0, 0)), R * 0.56, 'disc', 28, 0.03)
        box(bm, mi, Vector((cx + sd * 0.02, cy + 0.0, cz + R * 0.48)), (0.06, 0.16, 0.09), caliper, Matrix.Rotation(0.5, 3, 'X'))
        # Spokes on top of a dark centre, so you see the disc between them.
        disc(bm, mi, Vector((cx + out + sd * 0.004, cy, cz)), Vector((sd, 0, 0)), R * 0.69, 'trim', seg, 0.006)
        spokes = 5 if style == 'fuchs' else 10
        for k in range(spokes):
            ang = k * 2 * math.pi / spokes + (0.06 if style != 'fuchs' and k % 2 else 0)
            w = 0.075 if style == 'fuchs' else 0.032
            rot = Matrix.Rotation(ang, 3, 'X')
            c = Vector((cx + out + sd * 0.012, cy, cz)) + rot @ Vector((0, 0, R * 0.37))
            box(bm, mi, c, (0.018, w, R * 0.62), 'rim', rot)
        disc(bm, mi, Vector((cx + out + sd * 0.016, cy, cz)), Vector((sd, 0, 0)), R * 0.2, 'rim', 20, 0.02)
        disc(bm, mi, Vector((cx + out + sd * 0.027, cy, cz)), Vector((sd, 0, 0)), R * 0.09, 'chrome', 16, 0.012)
        # Rim lip.
        prof2 = [(R * 0.69, 0), (R * 0.72, 0)]
        for k in range(seg):
            pass

def wheel_object(name, R, style, caliper='caliper'):
    bm = bmesh.new()
    mi = {k: i for i, k in enumerate(SLOTS)}
    add_wheel(bm, mi, (0, 0, 0), R, 0.26, 1, style, True, caliper)
    me = bpy.data.meshes.new(f'car_{name}_wheel')
    bm.to_mesh(me)
    bm.free()
    for k in SLOTS:
        me.materials.append(bpy.data.materials['paint_' + name] if k == 'paint' else bpy.data.materials[k])
    ob = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

# ------------------------------------------------------------------ whole car

def build(name, c, hi):
    L, R = c['L'], c['R']
    material('paint_' + name, c['paint'], 0.22, 0.55)
    body, section, halfw = make_body(name, c, hi)
    mi = {k: i for i, k in enumerate(SLOTS)}
    bm = bmesh.new()
    bm.from_mesh(body.data)
    surf = Surface(body, section, L) if hi else None
    yF, yR = -L / 2, L / 2
    tF, tR = lin(c['top'], L), lin(c['top'], 0)
    zb = c['zb']
    if hi:
        for sd in (-1, 1):
            # Door shut lines and the side skirt line.
            d0, d1 = c['side'][0] + 0.02, c['side'][1] + 0.05
            for ds in (d0, d1):
                top_z = lin(c['belt'], ds) - 0.04
                decal(bm, mi, surf, ds - 0.006, ds + 0.006, zb + 0.2, top_z, 'trim', sd, 1, 6, 0.0025)
            if name == 'rosso':
                # Big side intake ahead of the rear wheel, a scoop line leading into it.
                decal(bm, mi, surf, c['ra'] + 0.48, c['ra'] + 0.92, 0.42, 0.64, 'trim', sd, 8, 3, 0.003,
                      shape=lambda u, v: (u, 1 - (1 - v) * (0.35 + 0.65 * u)))
                decal(bm, mi, surf, c['ra'] + 0.98, c['ra'] + 1.9, 0.62, 0.65, 'carbon', sd, 6, 1, 0.003)
                # Engine cover louvres between the buttresses.
                for k in range(6):
                    s = 0.45 + k * 0.12
                    decal(bm, mi, surf, s, s + 0.05, 0.12, 0.5, 'trim', sd, 1, 4, 0.003, mode='x')
                # Front hood vents.
                decal(bm, mi, surf, c['fa'] - 0.05, c['fa'] + 0.3, 0.3, 0.55, 'trim', sd, 4, 2, 0.003, mode='x')
                # Blade headlights on the nose corners.
                decal(bm, mi, surf, L - 0.55, L - 0.22, 0.66, 0.92, 'trim', sd, 6, 2, 0.003, mode='x', shape=lambda u, v: (u, v * (1 - 0.5 * u) + 0.5 * u * 0.5))
                decal(bm, mi, surf, L - 0.52, L - 0.25, 0.69, 0.89, 'headlight', sd, 6, 2, 0.005, mode='x', shape=lambda u, v: (u, v * (1 - 0.5 * u) + 0.5 * u * 0.5))
                decal(bm, mi, surf, L - 0.25, L - 0.2, 0.7, 0.86, 'indicator', sd, 1, 2, 0.005, mode='x')
            elif name == 'rs':
                # Sharp crease along the flank and a black side skirt.
                decal(bm, mi, surf, 0.5, L - 0.6, 0.62, 0.635, 'trim', sd, 12, 1, 0.002)
                decal(bm, mi, surf, c['ra'] + 0.45, c['fa'] - 0.45, zb + 0.17, zb + 0.24, 'carbon', sd, 10, 1, 0.003)
            else:
                # Round headlights on top of the front wings, with chrome rings.
                p, n = surf.at(L - 0.42, 0.8, 'x', sd)
                hp, hn = surf.hit(p, n)
                hn2 = Vector((sd * 0.12, -1.0, 0.45)).normalized()
                disc(bm, mi, hp - hn2 * 0.01, hn2, 0.125, 'chrome', 32, 0.05)
                disc(bm, mi, hp + hn2 * 0.016, hn2, 0.108, 'headlight', 32, 0.01)
                # Lens ring (projector look) instead of a dark centre.
                disc(bm, mi, hp + hn2 * 0.021, hn2, 0.06, 'chrome', 24, 0.004)
                disc(bm, mi, hp + hn2 * 0.024, hn2, 0.052, 'headlight', 24, 0.004)
                # Air intakes under the bumper corners with indicators.
                decal(bm, mi, surf, L - 0.32, L - 0.12, 0.36, 0.42, 'indicator', sd, 3, 1, 0.004)
                # Rear engine grille slats on the deck lid.
                for k in range(5):
                    s = 0.48 + k * 0.07
                    decal(bm, mi, surf, s, s + 0.03, 0.05, 0.42, 'trim', sd, 1, 3, 0.003, mode='x')
            # Mirrors: body-coloured shell on a stalk at the base of the windscreen.
            sm = c['ws'][0] - 0.02
            pts, _ = section(sm)
            base = Vector((sd * pts[7][0], L / 2 - sm, pts[7][1]))
            mirror = 'trim' if name == 'rs' else 'paint'
            box(bm, mi, base + Vector((sd * 0.06, 0, 0.03)), (0.12, 0.04, 0.025), mirror)
            cyl(bm, mi, base + Vector((sd * 0.15, 0.01, 0.08)), Vector((0, 1, 0)), 0.06, 0.11, mirror, 16, 0.045)
            box(bm, mi, base + Vector((sd * 0.15, 0.072, 0.08)), (0.14, 0.008, 0.085), 'glass')
        # Nose: intake mesh, plate; tail: lights, diffuser, exhausts, plate.
        if c.get('head') == 'rs':
            # Black grille with a thin frame, angular headlights, big lower intake, fog lights.
            gz0, gz1 = tF - 0.13, tF + 0.03
            front_patch(bm, mi, surf, -0.38, 0.38, gz0, gz1, yF, 'chrome', 8, 3, 0.003)
            front_patch(bm, mi, surf, -0.355, 0.355, gz0 + 0.015, gz1 - 0.015, yF, 'trim', 8, 3, 0.006)
            for k in range(9):
                x = -0.30 + k * 0.075
                front_patch(bm, mi, surf, x - 0.006, x + 0.006, gz0 + 0.03, gz1 - 0.03, yF, 'carbon', 1, 3, 0.009)
            for sd in (-1, 1):
                front_patch(bm, mi, surf, sd * 0.42, sd * 0.83, tF - 0.07, tF + 0.05, yF, 'trim', 6, 3, 0.004)
                front_patch(bm, mi, surf, sd * 0.45, sd * 0.80, tF - 0.03, tF + 0.035, yF, 'headlight', 6, 2, 0.007)
                front_patch(bm, mi, surf, sd * 0.47, sd * 0.78, tF - 0.058, tF - 0.045, yF, 'indicator', 6, 1, 0.009)
                front_patch(bm, mi, surf, sd * 0.55, sd * 0.80, zb + 0.10, zb + 0.30, yF, 'trim', 4, 2)
                front_patch(bm, mi, surf, sd * 0.62, sd * 0.74, zb + 0.16, zb + 0.22, yF, 'headlight', 2, 1, 0.008)
            front_patch(bm, mi, surf, -0.45, 0.45, zb + 0.10, zb + 0.27, yF, 'trim', 8, 2)
        else:
            front_patch(bm, mi, surf, -0.55, 0.55, zb + 0.12, zb + 0.3, yF, 'trim', 10, 2)
            for sd in (-1, 1):
                front_patch(bm, mi, surf, sd * 0.62, sd * 0.86, zb + 0.10, zb + 0.28, yF, 'trim', 3, 2)
        front_patch(bm, mi, surf, -0.26, 0.26, zb + 0.32, zb + 0.43, yF, 'plate', 4, 1, 0.006)
        front_patch(bm, mi, surf, -0.26, -0.215, zb + 0.32, zb + 0.43, yF, 'plateblue', 1, 1, 0.008)
        if c['tail'] == 'round':
            for sd in (-1, 1):
                for k, x in enumerate((0.58, 0.78)):
                    z = tR - 0.12
                    r = surf.bvh.ray_cast(Vector((sd * x, yR + 0.6, z)), Vector((0, -1, 0)), 2.0)
                    if r[0] is not None:
                        disc(bm, mi, r[0] + Vector((0, 0.008, 0)), Vector((0, 1, 0)), 0.068, 'chrome', 24, 0.025)
                        disc(bm, mi, r[0] + Vector((0, 0.02, 0)), Vector((0, 1, 0)), 0.056, 'taillight', 24, 0.01)
            front_patch(bm, mi, surf, -0.5, 0.5, tR - 0.25, tR - 0.04, yR, 'carbon', 8, 2, 0.004, 1)
        elif c['tail'] == 'c':
            # C-shaped tail lights wrapping the corners, black diffuser.
            for sd in (-1, 1):
                front_patch(bm, mi, surf, sd * 0.46, sd * 0.84, 0.70, 0.84, yR, 'taillight', 6, 2, 0.004, 1)
                front_patch(bm, mi, surf, sd * 0.52, sd * 0.80, 0.74, 0.79, yR, 'paint', 4, 1, 0.007, 1)
            front_patch(bm, mi, surf, -0.75, 0.75, zb + 0.08, zb + 0.22, yR, 'trim', 10, 2, 0.004, 1)
        else:
            front_patch(bm, mi, surf, -0.86, 0.86, tR - 0.115, tR - 0.07, yR, 'taillight', 16, 1, 0.004, 1)
            front_patch(bm, mi, surf, -0.6, 0.6, tR - 0.105, tR - 0.08, yR, 'trim', 8, 1, 0.006, 1)
        front_patch(bm, mi, surf, -0.26, 0.26, zb + 0.36, zb + 0.47, yR, 'plate', 4, 1, 0.006, 1)
        front_patch(bm, mi, surf, -0.26, -0.215, zb + 0.36, zb + 0.47, yR, 'plateblue', 1, 1, 0.008, 1)
        # Diffuser fins and exhausts.
        for k in range(7):
            x = -0.6 + k * 0.2
            box(bm, mi, Vector((x, yR - 0.32, zb + 0.06)), (0.012, 0.36, 0.09), 'carbon')
        ex = [-0.38, -0.26, 0.26, 0.38] if c['exhausts'] == 4 else [-0.55, 0.55] if name == 'rs' else [-0.32, 0.32]
        for x in ex:
            cyl(bm, mi, Vector((x, yR - 0.05, zb + 0.17)), Vector((0, 1, 0)), 0.045, 0.22, 'chrome', 18)
            disc(bm, mi, Vector((x, yR + 0.062, zb + 0.17)), Vector((0, 1, 0)), 0.034, 'trim', 18, 0.005)
        if name == 'rs':
            # Gloss black lip spoiler on the tailgate.
            p, n = surf.at(0.2, 0.0, 'x', 1)
            hp, _ = surf.hit(p, n)
            box(bm, mi, Vector((0, hp.y + 0.0, hp.z - 0.004)), (1.2, 0.1, 0.02), 'trim', Matrix.Rotation(-0.12, 3, 'X'))
        if name == 'gt':
            # Ducktail lip and a third brake light.
            p, n = surf.at(0.32, 0.0, 'x', 1)
            hp, _ = surf.hit(p, n)
            box(bm, mi, Vector((0, hp.y + 0.06, hp.z - 0.005)), (1.25, 0.2, 0.03), 'paint', Matrix.Rotation(-0.18, 3, 'X'))
            box(bm, mi, Vector((0, hp.y + 0.155, hp.z + 0.01)), (1.2, 0.02, 0.045), 'trim')
        # Dark wheel wells so you cannot see through the arches.
        for a in (c['fa'], c['ra']):
            for sd in (-1, 1):
                q = Vector((0, 0, 1)).rotation_difference(Vector((1, 0, 0)))
                mtx = Matrix.Translation(Vector((sd * (halfw(a) - 0.22), L / 2 - a, R))) @ q.to_matrix().to_4x4()
                res = bmesh.ops.create_cone(bm, cap_ends=False, segments=28, radius1=R + 0.075, radius2=R + 0.075, depth=0.34, matrix=mtx)
                for f in {f for v in res['verts'] for f in v.link_faces}:
                    f.material_index = mi['trim']
                    f.normal_flip()  # faces inwards: the dark liner is seen through the arch
                # Inner wall of the well.
                disc(bm, mi, Vector((sd * (halfw(a) - 0.39), L / 2 - a, R)), Vector((1, 0, 0)), R + 0.075, 'trim', 28, 0.01)
    # Wheels.
    wx = halfw(c['fa']) - 0.15
    wxr = halfw(c['ra']) - 0.16
    for a, x_ in ((c['fa'], wx), (c['ra'], wxr)):
        for sd in (-1, 1):
            add_wheel(bm, mi, (sd * x_, L / 2 - a, R), R, 0.26 if a == c['ra'] else 0.24, sd, 'fuchs' if name == 'gt' else 'twin', hi, c.get('caliper', 'caliper'))
    me = bpy.data.meshes.new(f'car_{name}_{"hi" if hi else "lo"}')
    bm.to_mesh(me)
    bm.free()
    for k in SLOTS:
        me.materials.append(bpy.data.materials['paint_' + name] if k == 'paint' else bpy.data.materials[k])
    ob = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.data.objects.remove(body, do_unlink=True)
    return ob, (wx, wxr, L / 2 - c['fa'], L / 2 - c['ra'], R)

summary = {}
roots = []
x0 = 0.0
for name, c in CARS.items():
    material('paint_' + name, c['paint'], 0.22, 0.55)
    root = bpy.data.objects.new(f'car_{name}', None)
    bpy.context.scene.collection.objects.link(root)
    root.location = (x0, 0, 0)
    hi, (wx, wxr, yf, yr, R) = build(name, c, True)
    lo, _ = build(name, c, False)
    for o in (hi, lo):
        o.parent = root
    lo.hide_render = True
    wh = wheel_object(name, R, 'fuchs' if name == 'gt' else 'twin', c.get('caliper', 'caliper'))
    wh.parent = root
    wh.location = (0, 6, 0)
    wh.hide_render = True
    for tag, (px, py) in {'FL': (wx, yf), 'FR': (-wx, yf), 'RL': (wxr, yr), 'RR': (-wxr, yr)}.items():
        e = bpy.data.objects.new(f'car_{name}_w{tag}', None)
        bpy.context.scene.collection.objects.link(e)
        e.parent = root
        e.location = (px, py, R)
    roots.append(root)
    summary[name] = {'hi_tris': sum(len(p.vertices) - 2 for p in hi.data.polygons), 'lo_tris': sum(len(p.vertices) - 2 for p in lo.data.polygons),
                     'dims': [round(v, 2) for v in hi.dimensions]}
    x0 += 3.2

# ------------------------------------------------------------------ previews and export

def render_previews(folder):
    os.makedirs(folder, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    sc.render.image_settings.file_format = 'PNG'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.75, 0.8, 0.88, 1)
    bg.inputs['Strength'].default_value = 0.9
    sc.world = world
    ground = bpy.data.objects.new('PREV_ground', bpy.data.meshes.new('g'))
    gm = bmesh.new()
    bmesh.ops.create_grid(gm, x_segments=1, y_segments=1, size=30)
    gm.to_mesh(ground.data)
    gm.free()
    ground.data.materials.append(material('PREV_ground', 0x8a8c90, 0.6))
    sc.collection.objects.link(ground)
    sun = bpy.data.objects.new('PREV_sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (0.7, 0.2, 0.9)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('PREV_cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 50
    sc.collection.objects.link(cam)
    sc.camera = cam
    for r in roots:
        n = r.name.replace('car_', '')
        for view, (dx, dy, dz) in {'front': (-4.2, -5.0, 1.6), 'rear': (4.4, 5.2, 1.5), 'side': (-7.5, 0.3, 1.0)}.items():
            target = r.location + Vector((0, 0, 0.55))
            cam.location = target + Vector((dx, dy, dz))
            cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
            for o in sc.objects:
                if o.parent in roots or o in roots:
                    o.hide_render = (o.parent is not r and o is not r) or o.name.endswith('_lo') or o.name.endswith('_wheel')
            sc.render.filepath = os.path.join(folder, f'{n}_{view}.png')
            bpy.ops.render.render(write_still=True)

if PREVIEW:
    render_previews(PREVIEW)
    for o in list(bpy.data.objects):
        if o.name.startswith('PREV_'):
            bpy.data.objects.remove(o, do_unlink=True)

if os.environ.get('NO_EXPORT') != '1':
    for o in bpy.data.objects:
        o.hide_render = False
        o.select_set(o.name.startswith('car_'))
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    summary['out'] = os.path.abspath(OUT)
print('SUMMARY', summary)
