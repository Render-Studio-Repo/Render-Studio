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
ARCHIVE_SUFFIXES = {".f3z", ".zip", ".f3d"}
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


def _camera_direction(view: str) -> np.ndarray:
    """World-space vector from the model toward the camera (matches `_project_view` depth)."""
    if view == "top":
        vec = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    elif view == "front":
        vec = np.array([0.0, -1.0, 0.0], dtype=np.float64)
    elif view == "side":
        vec = np.array([-1.0, 0.0, 0.0], dtype=np.float64)
    else:
        vec = np.array([0.5, 0.5, -0.7], dtype=np.float64)
    n = float(np.linalg.norm(vec))
    return vec / n if n > 1e-9 else vec


def _project_pixels(verts: np.ndarray, view: str, size: int) -> dict[str, Any]:
    xy, depth = _project_view(verts, view)
    mins = xy.min(axis=0)
    maxs = xy.max(axis=0)
    span = np.maximum(maxs - mins, 1e-6)
    pad = 0.08 * float(span.max())
    mins = mins - pad
    maxs = maxs + pad
    span = np.maximum(maxs - mins, 1e-6)
    scale = float(min((size - 1) / span[0], (size - 1) / span[1]))
    px = (xy[:, 0] - mins[0]) * scale + (size - 1 - span[0] * scale) * 0.5
    py = (size - 1) - ((xy[:, 1] - mins[1]) * scale + (size - 1 - span[1] * scale) * 0.5)
    return {
        "xy": xy,
        "depth": depth,
        "mins": mins,
        "maxs": maxs,
        "span": span,
        "scale": scale,
        "px": px,
        "py": py,
    }


_MAX_THUMB_FACES = 80_000
_DEFAULT_FACE_RGB = np.array([168, 184, 204], dtype=np.float64)


def _select_preview_face_indices(faces: np.ndarray, verts: np.ndarray, limit: int) -> np.ndarray:
    """Keep the largest faces so a dense assembly still reads as a solid, not dots."""
    if len(faces) <= limit:
        return np.arange(len(faces), dtype=np.int32)
    e0 = verts[faces[:, 1]] - verts[faces[:, 0]]
    e1 = verts[faces[:, 2]] - verts[faces[:, 0]]
    area = np.linalg.norm(np.cross(e0, e1), axis=1)
    area = np.nan_to_num(area, nan=0.0, posinf=0.0, neginf=0.0)
    return np.argpartition(area, -limit)[-limit:].astype(np.int32)


def _rasterize_mesh_faces(mesh: Any, view: str, size: int, frame: dict[str, Any]) -> np.ndarray | None:
    """Solid triangle fill. Outline=fill closes the 1px gaps that looked like dotted edges."""
    faces = np.asarray(getattr(mesh, "faces", []), dtype=np.int32)
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    if len(faces) < 1 or len(verts) < 3:
        return None
    n = len(verts)
    keep = (
        (faces[:, 0] >= 0) & (faces[:, 1] >= 0) & (faces[:, 2] >= 0)
        & (faces[:, 0] < n) & (faces[:, 1] < n) & (faces[:, 2] < n)
    )
    faces = faces[keep]
    if len(faces) < 1:
        return None
    finite = np.isfinite(verts).all(axis=1)
    faces = faces[finite[faces[:, 0]] & finite[faces[:, 1]] & finite[faces[:, 2]]]
    if len(faces) < 1:
        return None
    pick = _select_preview_face_indices(faces, verts, _MAX_THUMB_FACES)
    faces = faces[pick]
    i0, i1, i2 = faces[:, 0], faces[:, 1], faces[:, 2]
    px = frame["px"]
    py = frame["py"]
    depth = frame["depth"]
    e0 = verts[i1] - verts[i0]
    e1 = verts[i2] - verts[i0]
    normals = np.cross(e0, e1)
    nlen = np.linalg.norm(normals, axis=1)
    good = np.isfinite(nlen) & (nlen > 1e-8)
    if not np.any(good):
        return None
    i0, i1, i2 = i0[good], i1[good], i2[good]
    normals = np.clip(
        np.nan_to_num(normals[good] / nlen[good][:, None], nan=0.0, posinf=0.0, neginf=0.0),
        -1.0,
        1.0,
    )
    light = np.array([0.45, -0.35, 0.82], dtype=np.float64)
    camera = _camera_direction(view)
    with np.errstate(all="ignore"):
        facing = normals @ camera
    if float(np.mean(facing > 0.0)) < 0.2:
        facing = -facing
    front = facing > 0.02
    if int(front.sum()) >= max(8, len(normals) // 20):
        i0, i1, i2 = i0[front], i1[front], i2[front]
        normals = normals[front]
    with np.errstate(all="ignore"):
        lit = np.clip(normals @ light, 0.0, 1.0)
    shade = 0.28 + 0.72 * np.clip(np.nan_to_num(lit, nan=0.0, posinf=1.0, neginf=0.0), 0.0, 1.0)
    colors = np.clip(_DEFAULT_FACE_RGB[None, :] * shade[:, None], 0, 255).astype(np.uint8)
    order = np.argsort((depth[i0] + depth[i1] + depth[i2]) / 3.0)
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return None
    image = Image.new("RGB", (size, size), (246, 246, 246))
    draw = ImageDraw.Draw(image)
    x0, y0 = px[i0], py[i0]
    x1, y1 = px[i1], py[i1]
    x2, y2 = px[i2], py[i2]
    for idx in order:
        color = (int(colors[idx, 0]), int(colors[idx, 1]), int(colors[idx, 2]))
        pts = [
            (float(x0[idx]), float(y0[idx])),
            (float(x1[idx]), float(y1[idx])),
            (float(x2[idx]), float(y2[idx])),
        ]
        draw.polygon(pts, fill=color, outline=color)
    return np.asarray(image)


def _rasterize_mesh(mesh: Any, view: str, size: int = 384) -> bytes:
    """Orthographic preview: solid faces when possible, else depth-shaded vertex splat."""
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    if len(verts) == 0:
        blank = np.full((size, size, 4), 255, dtype=np.uint8)
        return _png_rgba(blank)

    render_size = size * 2 if size <= 512 else size
    frame = _project_pixels(verts, view, render_size)
    solid = _rasterize_mesh_faces(mesh, view, render_size, frame)
    if solid is not None and solid.size:
        if render_size != size:
            from PIL import Image

            resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
            im = Image.fromarray(solid).resize((size, size), resample)
            solid = np.asarray(im)
        alpha = np.full((size, size), 255, dtype=np.uint8)
        return _png_rgba(np.dstack([solid, alpha]))

    frame = _project_pixels(verts, view, size)
    depth = frame["depth"]
    mins = frame["mins"]
    span = frame["span"]
    scale = frame["scale"]
    px = frame["px"].astype(np.int32)
    py = frame["py"].astype(np.int32)
    if len(verts) > 80_000:
        rng = np.random.default_rng(1)
        pick = rng.choice(len(verts), size=80_000, replace=False)
        px, py, depth = px[pick], py[pick], depth[pick]

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
            opx = ((pts[:, 0] - mins[0]) * scale + (size - 1 - span[0] * scale) * 0.5).astype(np.int32)
            opy = ((size - 1) - ((pts[:, 1] - mins[1]) * scale + (size - 1 - span[1] * scale) * 0.5)).astype(np.int32)
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
    """Pull the first usable CAD/mesh file out of Fusion .f3z / .f3d / zip archives."""
    suffix = path.suffix.lower()
    if suffix not in ARCHIVE_SUFFIXES:
        return None
    # .f3d is often proprietary binary — only proceed when it is actually a zip.
    if suffix == ".f3d":
        try:
            if not zipfile.is_zipfile(path):
                return None
        except Exception:
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
                elif ext == ".smt":
                    preferred.append((2, n))
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

    if suffix in PROPRIETARY_SUFFIXES:
        from backend.services.cad_proprietary_convert import try_convert_proprietary_cad

        converted = try_convert_proprietary_cad(path, path.parent)
        if converted and converted.get("path"):
            path = Path(converted["path"])
            suffix = path.suffix.lower()
        else:
            raise ValueError(
                f"{Path(path).suffix} is a proprietary CAD format. Export STEP (.step) or mesh (.stl/.glb) "
                "from Fusion/SolidWorks and attach that so the AI can read the geometry."
            )
    if suffix in {".iges", ".igs"}:
        return cad_service.import_iges_mesh(path)
    if suffix in {".brep", ".brp"}:
        return cad_service.import_brep_mesh(path)
    if suffix in cad_service.STEP_SUFFIXES:
        return cad_service.load_mesh(path)
    if suffix in MESH_SUFFIXES:
        return cad_service.load_mesh(path)
    return cad_service.load_mesh(path)


def _load_solid_preview_mesh(path: Path) -> Any:
    """Triangle meshes only — skip crease Line/Path nodes that turn thumbs into a point cloud."""
    import trimesh

    suffix = path.suffix.lower()
    if suffix in MESH_SUFFIXES:
        loaded = trimesh.load(path, force="scene")
        if isinstance(loaded, trimesh.Trimesh):
            return loaded
        if not isinstance(loaded, trimesh.Scene):
            return load_reference_mesh(path)
        scene = loaded
        parts: list[Any] = []
        try:
            graph_nodes = list(scene.graph.nodes_geometry)
        except Exception:
            graph_nodes = []
        if graph_nodes:
            for node_name in graph_nodes:
                try:
                    transform, geom_name = scene.graph[node_name]
                    geom = scene.geometry[geom_name]
                except Exception:
                    continue
                if not isinstance(geom, trimesh.Trimesh) or len(getattr(geom, "faces", [])) < 1:
                    continue
                chunk = geom.copy()
                try:
                    chunk.apply_transform(transform)
                except Exception:
                    pass
                parts.append(chunk)
        else:
            for geom in scene.geometry.values():
                if isinstance(geom, trimesh.Trimesh) and len(getattr(geom, "faces", [])) >= 1:
                    parts.append(geom)
        if parts:
            try:
                return trimesh.util.concatenate(parts)
            except Exception:
                return parts[0]
    return load_reference_mesh(path)


def preview_png_bytes(path: Path, *, view: str = "iso", size: int = 384) -> bytes:
    """Fast iso/ortho PNG of a mesh or STEP, for sidebar thumbs and similar stills."""
    mesh = _load_solid_preview_mesh(path)
    return _rasterize_mesh(mesh, view, size=size)


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
