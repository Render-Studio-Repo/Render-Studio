# build123d primitives (VibeCAD worker)

The sidecar injects `from build123d import *` plus `params`, `inputs`, and `Shape`. Assign `result`.

## Alignment

- `Align.MIN` / `Align.CENTER` / `Align.MAX` on Box, Cylinder, Cone, Sphere.
- Stacked solids: `align=(Align.CENTER, Align.CENTER, Align.MIN)` and `z` is the bottom of that solid.
- Never `Cylinder(...).translate((0, 0, z))` for a wall — the default CENTER origin drops the feature.

## Common solids

```python
Box(length, width, height, align=(Align.MIN, Align.MIN, Align.MIN))
Cylinder(radius, height, align=(Align.CENTER, Align.CENTER, Align.MIN))
Cone(bottom_radius, top_radius, height, align=(Align.CENTER, Align.CENTER, Align.MIN))
Sphere(radius)
```

Booleans: `part + other`, `part - other`, `part & other`. Locations: `Pos(x, y, z)`, `Rot(ax, ay, az)`.

## Revolve / loft (hoppers, funnels, vessels)

Sketch one outer silhouette on XZ (or a wire), `revolve(axis=Axis.Z)`, then cut the bore. For lofts, place enough `Pos(0, 0, z) * Circle(r)` stations.

## DXF

```python
from build123d import import_dxf
from pathlib import Path
dxf_filename = "vision-reference.dxf"
# Reconstruct from layers/polylines. Whole-file extrude only for a flat plate.
```

## Linked STEP

`inputs["alias"]` is already a Shape (the worker imported the STEP). Use it directly; do not `import_step()` it again.
