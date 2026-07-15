"""Analyze uploaded 3D reference models so the CAD AI can design around them.

Produces measured dimensions, silhouette outlines, and simple orthographic PNG
views (no external render deps — numpy z-buffer + zlib PNG).
"""

from __future__ import annotations

import base64
import io
import math
import struct
import zipfile
import zlib
from pathlib import Path
from typing import Any

import numpy as np

MESH_SUFFIXES = {".stl", ".obj", ".glb", ".gltf", ".ply", ".off", ".3mf"}
BREP_SUFFIXES = {".step", ".stp", ".iges", ".igs", ".brep", ".brp"}
ARCHIVE_SUFFIXES = {".f3z", ".zip"}
PROPRIETARY_SUFFIXES = {".f3d", ".sldprt", ".sldasm", ".x_t", ".x_b", ".sat", ".sab", ".jt", ".3dxml"}
EXTRACTABLE_INSIDE = MESH_SUFFIXES | BREP_SUFFIXES | {".smt"}


def _png_rgba(rgba: np.ndarray) -> bytes:
    """Encode HxWx4 uint8 array as a PNG without Pillow."""
    height, width = rgba.shape[:2]
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter None
        raw.extend(rgba[y].tobytes())
    compressor = zlib.compressobj(level=6)
    compressed = compressor.compress(bytes(raw)) + compressor.flush()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", compressed),
            chunk(b"IEND", b""),
        ]
    )


def _as_mm_mesh(mesh: Any) -> Any:
    from backend.services import cad_service

    out = mesh.copy()
    if not cad_service.mesh_uses_millimeters(out):
        out.apply_scale(1000.0)
    return out


def _project_view(vertices: np.ndarray, view: str) -> tuple[np.ndarray, np.ndarray]:
    """Return 2D coords (x right, y up) and depth (larger = closer to camera)."""
    v = np.asarray(vertices, dtype=np.float64)
    if view == "top":
        return np.column_stack([v[:, 0], v[:, 1]]), v[:, 2]
    if view == "front":
        return np.column_stack([v[:, 0], v[:, 2]]), -v[:, 1]
    if view == "side":
        return np.column_stack([v[:, 1], v[:, 2]]), -v[:, 0]
    # iso
    x = v[:, 0] * 0.866 - v[:, 1] * 0.866
    y = v[:, 0] * 0.5 + v[:, 1] * 0.5 + v[:, 2]
    depth = v[:, 0] * 0.5 + v[:, 1] * 0.5 - v[:, 2] * 0.7
    return np.column_stack([x, y]), depth


def _rasterize_mesh(mesh: Any, view: str, size: int = 384) -> bytes:
    """Fast orthographic preview: depth-shaded point splat + convex outline."""
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    if len(verts) == 0:
        blank = np.full((size, size, 4), 255, dtype=np.uint8)
        return _png_rgba(blank)

    if len(verts) > 80_000:
        rng = np.random.default_rng(1)
        verts = verts[rng.choice(len(verts), size=80_000, replace=False)]

    xy, depth = _project_view(verts, view)
    mins = xy.min(axis=0)
    maxs = xy.max(axis=0)
    span = np.maximum(maxs - mins, 1e-6)
    pad = 0.08 * float(span.max())
    mins = mins - pad
    maxs = maxs + pad
    span = np.maximum(maxs - mins, 1e-6)
    s = float(min((size - 1) / span[0], (size - 1) / span[1]))
    px = ((xy[:, 0] - mins[0]) * s + (size - 1 - span[0] * s) * 0.5).astype(np.int32)
    py = ((size - 1) - ((xy[:, 1] - mins[1]) * s + (size - 1 - span[1] * s) * 0.5)).astype(np.int32)

    rgb = np.full((size, size, 3), 246, dtype=np.uint8)
    znorm = depth - depth.min()
    zspan = float(znorm.max()) if float(znorm.max()) > 1e-9 else 1.0
    shade = 0.35 + 0.65 * (znorm / zspan)

    valid = (px >= 0) & (px < size) & (py >= 0) & (py < size)
    px_v = px[valid]
    py_v = py[valid]
    shade_v = shade[valid]
    depth_v = depth[valid]
    order = np.argsort(depth_v)
    px_v, py_v, shade_v = px_v[order], py_v[order], shade_v[order]
    base = np.array([72, 148, 220], dtype=np.float64)
    colors = np.clip(base[None, :] * shade_v[:, None], 0, 255).astype(np.uint8)
    rgb[py_v, px_v] = colors
    for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
        xx = px_v + dx
        yy = py_v + dy
        ok = (xx >= 0) & (xx < size) & (yy >= 0) & (yy < size)
        rgb[yy[ok], xx[ok]] = colors[ok]

    try:
        outline = _silhouette_polyline(mesh, "top" if view == "iso" else view, max_points=64)
        if view != "iso" and len(outline) >= 2:
            ink = np.array([28, 48, 72], dtype=np.uint8)
            pts = np.asarray(outline, dtype=np.float64)
            opx = ((pts[:, 0] - mins[0]) * s + (size - 1 - span[0] * s) * 0.5).astype(np.int32)
            opy = ((size - 1) - ((pts[:, 1] - mins[1]) * s + (size - 1 - span[1] * s) * 0.5)).astype(np.int32)
            for i in range(len(opx)):
                x0, y0 = int(opx[i]), int(opy[i])
                x1, y1 = int(opx[(i + 1) % len(opx)]), int(opy[(i + 1) % len(opy)])
                steps = max(abs(x1 - x0), abs(y1 - y0), 1)
                xs = np.linspace(x0, x1, steps + 1).astype(np.int32)
                ys = np.linspace(y0, y1, steps + 1).astype(np.int32)
                ok = (xs >= 0) & (xs < size) & (ys >= 0) & (ys < size)
                rgb[ys[ok], xs[ok]] = ink
    except Exception:
        pass

    alpha = np.full((size, size), 255, dtype=np.uint8)
    return _png_rgba(np.dstack([rgb, alpha]))


def _silhouette_polyline(mesh: Any, view: str = "top", max_points: int = 48) -> list[list[float]]:
    """Convex-hull outline of a projected view, in mm."""
    xy, _ = _project_view(np.asarray(mesh.vertices, dtype=np.float64), view)
    if len(xy) < 3:
        return [[float(p[0]), float(p[1])] for p in xy.tolist()]
    try:
        from scipy.spatial import ConvexHull  # type: ignore

        hull = ConvexHull(xy)
        pts = xy[hull.vertices]
    except Exception:
        # Fallback: axis-aligned box corners of projection.
        mins = xy.min(axis=0)
        maxs = xy.max(axis=0)
        pts = np.array(
            [
                [mins[0], mins[1]],
                [maxs[0], mins[1]],
                [maxs[0], maxs[1]],
                [mins[0], maxs[1]],
            ],
            dtype=np.float64,
        )
    if len(pts) > max_points:
        idx = np.linspace(0, len(pts) - 1, max_points).astype(int)
        pts = pts[idx]
    return [[round(float(x), 2), round(float(y), 2)] for x, y in pts]


def extract_cad_from_archive(path: Path, dest_dir: Path | None = None) -> Path | None:
    """Pull the first usable CAD/mesh file out of Fusion .f3z / zip archives."""
    if path.suffix.lower() not in ARCHIVE_SUFFIXES:
        return None
    dest_dir = dest_dir or path.parent
    try:
        with zipfile.ZipFile(path, "r") as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
            preferred = []
            for n in names:
                ext = Path(n).suffix.lower()
                if ext in BREP_SUFFIXES:
                    preferred.append((0, n))
                elif ext in MESH_SUFFIXES:
                    preferred.append((1, n))
            if not preferred:
                return None
            preferred.sort(key=lambda row: (row[0], len(row[1])))
            member = preferred[0][1]
            out_name = Path(member).name
            out_path = dest_dir / f"{path.stem}__extracted{Path(out_name).suffix.lower()}"
            n = 2
            while out_path.exists():
                out_path = dest_dir / f"{path.stem}__extracted_{n}{Path(out_name).suffix.lower()}"
                n += 1
            with zf.open(member) as src, out_path.open("wb") as dst:
                dst.write(src.read())
            return out_path
    except Exception:
        return None


def load_reference_mesh(path: Path) -> Any:
    """Load a mesh for analysis; supports STEP/IGES/BREP via OCP and meshes via trimesh."""
    from backend.services import cad_service

    suffix = path.suffix.lower()
    if suffix in ARCHIVE_SUFFIXES:
        extracted = extract_cad_from_archive(path)
        if extracted is None:
            raise ValueError(
                f"{path.name} is an archive with no embedded STEP/STL/GLB. "
                "Export STEP or STL from Fusion/SolidWorks and attach that."
            )
        path = extracted
        suffix = path.suffix.lower()

    if suffix in {".iges", ".igs"}:
        return cad_service.import_iges_mesh(path)
    if suffix in {".brep", ".brp"}:
        return cad_service.import_brep_mesh(path)
    if suffix in cad_service.STEP_SUFFIXES:
        return cad_service.load_mesh(path)
    if suffix in MESH_SUFFIXES:
        return cad_service.load_mesh(path)
    if suffix in PROPRIETARY_SUFFIXES:
        raise ValueError(
            f"{path.suffix} is a proprietary CAD format. Export STEP (.step) or mesh (.stl/.glb) "
            "from Fusion/SolidWorks and attach that so the AI can read the geometry."
        )
    return cad_service.load_mesh(path)


def analyze_reference_geometry(path: Path, *, include_views: bool = True) -> dict[str, Any]:
    """Return geometry facts (+ optional view PNG data URLs) for an AI prompt reference."""
    mesh = _as_mm_mesh(load_reference_mesh(path))
    extents = [round(float(v), 2) for v in mesh.extents]
    bounds = mesh.bounds
    center = [round(float(v), 2) for v in bounds.mean(axis=0)]
    try:
        volume = float(mesh.volume) if mesh.is_watertight else None
    except Exception:
        volume = None
    try:
        area = float(mesh.area)
    except Exception:
        area = None

    facts: dict[str, Any] = {
        "filename": path.name,
        "unit": "mm",
        "size_mm": extents,
        "width_mm": extents[0],
        "depth_mm": extents[1],
        "height_mm": extents[2],
        "bbox_min_mm": [round(float(v), 2) for v in bounds[0]],
        "bbox_max_mm": [round(float(v), 2) for v in bounds[1]],
        "center_mm": center,
        "vertex_count": int(len(mesh.vertices)),
        "face_count": int(len(mesh.faces)),
        "watertight": bool(getattr(mesh, "is_watertight", False)),
        "silhouette_top_mm": _silhouette_polyline(mesh, "top"),
        "silhouette_front_mm": _silhouette_polyline(mesh, "front"),
        "silhouette_side_mm": _silhouette_polyline(mesh, "side"),
        "message": (
            f"{path.name} measures {extents[0]} × {extents[1]} × {extents[2]} mm "
            f"(W×D×H), centered near {center}."
        ),
        "design_guidance": (
            "Use size_mm and silhouette_*_mm to wrap/clip/mate around this reference. "
            "Keep clearances explicit (e.g. 0.3–0.6 mm for snap fits). "
            "Button/click features should align to the silhouette and bounding box of the control surface."
        ),
    }
    if volume is not None and math.isfinite(volume):
        facts["volume_mm3"] = round(volume, 2)
    if area is not None and math.isfinite(area):
        facts["area_mm2"] = round(area, 2)

    views: list[dict[str, Any]] = []
    if include_views:
        for name in ("iso", "top", "front", "side"):
            try:
                png = _rasterize_mesh(mesh, name, size=384)
                b64 = base64.b64encode(png).decode("ascii")
                views.append(
                    {
                        "id": f"cadref-view-{path.stem}-{name}",
                        "name": f"{path.stem}_{name}.png",
                        "media_type": "image/png",
                        "data_url": f"data:image/png;base64,{b64}",
                        "view": name,
                        "source_filename": path.name,
                    }
                )
            except Exception:
                continue
    facts["views"] = views
    return facts
