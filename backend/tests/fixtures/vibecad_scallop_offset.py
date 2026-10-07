"""Source-only, closed PETG assembly. Host compiles and validates.
Photo-derived ornament is an adjustable approximation, not measured geometry.
The explicit request takes precedence over the older embedded CAD brief.
"""
from build123d import *
import math

p = dict(width=230.0, depth=190.0, thickness=75.0, wall=2.4,
         rim=4.0, edge_fillet=1.0, pin_diameter=5.0,
         radial_clearance=0.20, axial_clearance=0.20,
         hole_compensation=0.16, lip_gap=0.28,
         retention_allowance=0.15, flute_count=25,
         flute_depth=1.5, relief_depth=2.0, opening_angle=110.0)
p.update(params)
W, D, T = p['width'], p['depth'], p['thickness']
wall, rim = p['wall'], p['rim']
# The three-body edition intentionally fails closed for an oversized edit.
# Enlargements beyond this domain require a separately authored keyed/snap split
# and additional published leaf names; never silently truncate or rescale a part.
if W > 242 or D > 242 or T > 242:
    raise ValueError('Oversized edit: keyed alignment / printed snap split variant required before printing.')
if W < 190 or D < 160 or T < 62:
    raise ValueError('Envelope too small for this hinge, clasp and relief; revise functional features.')
if rim < wall or wall < 2.4:
    raise ValueError('Maintain at least 2.4 mm wall and a rim no thinner than the wall.')
if not 95 <= p['opening_angle'] <= 120:
    raise ValueError('Stop angle must stay within the authored 95–120 degree range.')
sy = D / 190.0
sx = W / 230.0
seam = 0.30
H = T / 2
C = 95.0 * sy


def outline_face(points):
    return Face(Wire([Edge.make_spline([(x, y, 0) for x, y in points], periodic=True)]))


def fan(fluted=True):
    # Narrow straight-ish heel, swept shoulders, rounded scalloped broad arc.
    points = [(-20*sx, 8*sy), (-34*sx, 20*sy), (-74*sx, 43*sy)]
    n = 150
    for i in range(n + 1):
        u = i/n
        a = math.radians(-65 + 130*u)
        bump = p['flute_depth'] * (0.5 + 0.5*math.cos(2*math.pi*p['flute_count']*u)) if fluted else 0.0
        points.append(((W/2-3+bump)*math.sin(a)/math.sin(math.radians(65)),
                       8*sy + (D-24-1.5+bump)*math.cos(a)))
    points += [(74*sx,43*sy), (34*sx,20*sy), (20*sx,8*sy), (0,7.8*sy)]
    return outline_face(points)

F = fan(True)
S = fan(False)


def inset(face, amount):
    return offset(face, amount=-amount, kind=Kind.ARC).faces()[0]


result = {"rim": extrude(inset(F, rim + p['lip_gap']), amount=2)}
