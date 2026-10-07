#!/usr/bin/env python3
"""Generate the printable OpenArm black cube tray from demo.xml dimensions."""

from pathlib import Path


OUT = Path(__file__).with_name("openarm_black_cube_tray_140x140x40mm.stl")


def normal(a, b, c):
    ux, uy, uz = (b[i] - a[i] for i in range(3))
    vx, vy, vz = (c[i] - a[i] for i in range(3))
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = (nx * nx + ny * ny + nz * nz) ** 0.5
    return (nx / length, ny / length, nz / length)


triangles = []


def quad(a, b, c, d):
    triangles.extend(((a, b, c), (a, c, d)))


# Millimetres. Outer: 140 x 140 x 40; cavity: 120 x 120 x 30.
o, i, bottom, top = 70.0, 60.0, 10.0, 40.0

# Outside bottom and walls.
quad((-o, -o, 0), (-o, o, 0), (o, o, 0), (o, -o, 0))
quad((-o, -o, 0), (o, -o, 0), (o, -o, top), (-o, -o, top))
quad((o, -o, 0), (o, o, 0), (o, o, top), (o, -o, top))
quad((o, o, 0), (-o, o, 0), (-o, o, top), (o, o, top))
quad((-o, o, 0), (-o, -o, 0), (-o, -o, top), (-o, o, top))

# Top rim, facing upward.
quad((-o, -o, top), (o, -o, top), (i, -i, top), (-i, -i, top))
quad((o, -o, top), (o, o, top), (i, i, top), (i, -i, top))
quad((o, o, top), (-o, o, top), (-i, i, top), (i, i, top))
quad((-o, o, top), (-o, -o, top), (-i, -i, top), (-i, i, top))

# Cavity floor and inside walls.
quad((-i, -i, bottom), (i, -i, bottom), (i, i, bottom), (-i, i, bottom))
quad((-i, -i, bottom), (-i, -i, top), (i, -i, top), (i, -i, bottom))
quad((i, -i, bottom), (i, -i, top), (i, i, top), (i, i, bottom))
quad((i, i, bottom), (i, i, top), (-i, i, top), (-i, i, bottom))
quad((-i, i, bottom), (-i, i, top), (-i, -i, top), (-i, -i, bottom))

with OUT.open("w", encoding="ascii", newline="\n") as stl:
    stl.write("solid openarm_black_cube_tray\n")
    for a, b, c in triangles:
        nx, ny, nz = normal(a, b, c)
        stl.write(f"  facet normal {nx:.8g} {ny:.8g} {nz:.8g}\n    outer loop\n")
        for x, y, z in (a, b, c):
            stl.write(f"      vertex {x:.8g} {y:.8g} {z:.8g}\n")
        stl.write("    endloop\n  endfacet\n")
    stl.write("endsolid openarm_black_cube_tray\n")

print(OUT)
