"""Share-link social / text-message preview thumbnails.

Builds dark (black) PNG link-preview thumbnails from CAD iso snapshots so
iMessage / SMS / Slack unfurls show the model without a white card background.

Transparent cutouts are still generated as an intermediate step, then composited
onto solid black — messengers often flatten transparent PNGs onto white.
"""

from __future__ import annotations

import logging
import struct
import zlib
from collections import deque
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Solid studio black for OG / link-preview cards (iMessage, Slack, etc.).
SHARE_OG_BACKGROUND_RGB = (0, 0, 0)


def _snapshot_base_stem(snapshot_name: str) -> str:
    stem = Path(snapshot_name).stem
    while True:
        lowered = stem.lower()
        if lowered.endswith("_share_transparent"):
            stem = stem[: -len("_share_transparent")]
            continue
        if lowered.endswith("_share_og_color"):
            stem = stem[: -len("_share_og_color")]
            continue
        if lowered.endswith("_share_og_brand"):
            stem = stem[: -len("_share_og_brand")]
            continue
        if lowered.endswith("_share_og"):
            stem = stem[: -len("_share_og")]
            continue
        break
    return stem


def _cad_stem_from_snapshot(snapshot_name: str) -> str:
    """`Foo_snapshot_iso_20260715T063427Z` → `Foo`."""
    base = _snapshot_base_stem(snapshot_name)
    lower = base.lower()
    idx = lower.find("_snapshot")
    return base[:idx] if idx > 0 else base


def _is_share_preview_background_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a == 0:
        return True
    spread = max(r, g, b) - min(r, g, b)
    # Light CAD studio / off-white / soft blue-gray iso backgrounds.
    if min(r, g, b) >= 200 and spread <= 40:
        return True
    # Dark viewport studio (#0d1117 / near-black) used by the share viewer.
    if max(r, g, b) <= 28 and spread <= 18:
        return True
    return False


def _legacy_share_og_needs_rebuild(og_path: Path) -> bool:
    """True when an existing OG still has transparent/light corners, old pill, or bottom-right logo."""
    try:
        from PIL import Image

        with Image.open(og_path) as img:
            rgba = img.convert("RGBA")
            width, height = rgba.size
            samples = [
                rgba.getpixel((0, 0)),
                rgba.getpixel((width - 1, 0)),
                rgba.getpixel((0, height - 1)),
                rgba.getpixel((width - 1, height - 1)),
            ]
            # Old pill badge sat near bottom-right with a dark rounded fill.
            badge_probe = rgba.getpixel((max(0, width - 40), max(0, height - 40)))
            # Previous wordmark sat in the bottom-right; logo now belongs top-right.
            bottom_brand = rgba.getpixel((max(0, width - 80), max(0, height - 80)))
            top_brand = rgba.getpixel((max(0, width - 80), min(height - 1, 80)))
        for r, g, b, a in samples:
            if a < 250:
                return True
            if min(r, g, b) >= 180:
                return True
        # Force rebuild of previous pill-style marks (dark navy bubble).
        br, bg, bb, ba = badge_probe
        if ba > 200 and max(br, bg, bb) <= 40 and min(br, bg, bb) <= 18:
            return True
        # Bright/white-ish mark near bottom-right but not top-right → old logo placement.
        bbr, bbg, bbb, bba = bottom_brand
        tbr, tbg, tbb, tba = top_brand
        bottom_lit = bba > 180 and max(bbr, bbg, bbb) >= 180
        top_lit = tba > 180 and max(tbr, tbg, tbb) >= 180
        if bottom_lit and not top_lit:
            return True
        return False
    except Exception:
        return True


def _rgba_image_is_clay_grey(image: Any) -> bool:
    """True when the opaque model is workbench clay (near-monochrome blue-grey)."""
    try:
        import numpy as np

        arr = np.asarray(image.convert("RGBA"), dtype=np.uint8)
        opaque = arr[:, :, 3] > 200
        if int(opaque.sum()) < 200:
            return False
        rgb = arr[opaque][:, :3].astype(np.float64)
        # Ignore near-white ISO / UI badges baked into CAD snapshots.
        rgb = rgb[rgb.mean(axis=1) < 235]
        if len(rgb) < 200:
            return False
        chroma = rgb.max(axis=1) - rgb.min(axis=1)
        mean = rgb.mean(axis=0)
        # Workbench clay (#b6c4ce) stays low-chroma even with soft shading.
        greyish = float(chroma.mean()) < 42.0 and float(mean.max() - mean.min()) < 42.0
        mid = 95.0 <= float(mean.mean()) <= 205.0
        return greyish and mid
    except Exception:
        return False


def _collect_colored_preview_meshes(project_path: Path, cad_stem: str) -> list[Any]:
    """Load per-part GLBs (preferred) or a single coloured assembly GLB."""
    try:
        import trimesh
    except Exception:
        return []

    def _face_count(geom: Any) -> int:
        try:
            faces = getattr(geom, "faces", None)
            return int(len(faces)) if faces is not None else 0
        except Exception:
            return 0

    meshes: list[Any] = []
    part_paths = sorted(project_path.glob(f"{cad_stem}__part_*.glb"))
    for path in part_paths:
        try:
            geom = trimesh.load(path, force="mesh")
        except Exception:
            continue
        if geom is None or _face_count(geom) == 0:
            continue
        meshes.append(geom)
    if meshes:
        return meshes

    candidates = [
        project_path / f".{cad_stem}.step.glb",
        project_path / f"{cad_stem}.glb",
        project_path / f"{cad_stem}__faceted.glb",
    ]
    for path in candidates:
        if not path.is_file():
            continue
        try:
            loaded = trimesh.load(path, force="scene")
        except Exception:
            try:
                loaded = trimesh.load(path, force="mesh")
            except Exception:
                continue
        if hasattr(loaded, "geometry"):
            for geom in loaded.geometry.values():
                if geom is not None and _face_count(geom) > 0:
                    meshes.append(geom)
        elif loaded is not None and _face_count(loaded) > 0:
            meshes.append(loaded)
        if meshes:
            break
    return meshes


def _render_colored_model_rgba(
    project_path: Path,
    snapshot_name: str,
    *,
    size: tuple[int, int] = (1200, 900),
) -> Any | None:
    """CPU isometric preview from coloured part GLBs (share OG when CAD iso is clay grey)."""
    import math

    try:
        import numpy as np
        from PIL import Image, ImageDraw
    except Exception:
        return None

    cad_stem = _cad_stem_from_snapshot(snapshot_name)
    meshes = _collect_colored_preview_meshes(project_path, cad_stem)
    if not meshes:
        return None

    verts: list[Any] = []
    faces: list[Any] = []
    colors: list[Any] = []
    voff = 0
    colourful = 0
    for geom in meshes:
        try:
            v = np.asarray(geom.vertices, dtype=np.float64)
            f = np.asarray(geom.faces, dtype=np.int32) + voff
            fc = getattr(getattr(geom, "visual", None), "face_colors", None)
            if fc is None or len(fc) != len(f):
                fc = np.tile(np.array([196, 196, 196, 255], dtype=np.uint8), (len(f), 1))
            else:
                fc = np.asarray(fc, dtype=np.uint8)
            rgb = fc[:, :3].astype(np.float64)
            chroma = rgb.max(axis=1) - rgb.min(axis=1)
            if float(chroma.mean()) > 12.0 or float(abs(rgb.mean(axis=0).max() - rgb.mean(axis=0).min())) > 18.0:
                colourful += 1
            verts.append(v)
            faces.append(f)
            colors.append(fc[:, :3])
            voff += len(v)
        except Exception:
            continue
    if not verts or colourful == 0:
        return None

    V = np.vstack(verts)
    F = np.vstack(faces)
    C = np.vstack(colors)
    V = V - V.mean(axis=0)

    # Match CAD snapshot iso: yaw then pitch (true isometric).
    ax = math.radians(35.264)
    ay = math.radians(-45.0)
    Rx = np.array(
        [[1.0, 0.0, 0.0], [0.0, math.cos(ax), -math.sin(ax)], [0.0, math.sin(ax), math.cos(ax)]],
        dtype=np.float64,
    )
    Ry = np.array(
        [[math.cos(ay), 0.0, math.sin(ay)], [0.0, 1.0, 0.0], [-math.sin(ay), 0.0, math.cos(ay)]],
        dtype=np.float64,
    )
    Vp = (V @ Ry.T) @ Rx.T
    light = np.array([0.45, 0.78, 0.52], dtype=np.float64)
    light /= float(np.linalg.norm(light))

    tri = Vp[F]
    e1 = tri[:, 1] - tri[:, 0]
    e2 = tri[:, 2] - tri[:, 0]
    normals = np.cross(e1, e2)
    nn = np.linalg.norm(normals, axis=1, keepdims=True)
    nn = np.maximum(nn, 1e-12)
    normals = normals / nn
    front = normals[:, 2] > 0.02
    if not np.any(front):
        return None
    F = F[front]
    C = C[front]
    normals = normals[front]
    tri = Vp[F]
    depth = tri[:, :, 2].mean(axis=1)
    order = np.argsort(depth)

    width, height = size
    pad = 0.12
    mins = Vp.min(axis=0)
    maxs = Vp.max(axis=0)
    span = max(float(maxs[0] - mins[0]), float(maxs[1] - mins[1]), 1e-6)
    scale = (1.0 - 2.0 * pad) * min(width, height) / span
    cx, cy = width / 2.0, height / 2.0
    xs = cx + Vp[:, 0] * scale
    ys = cy - Vp[:, 1] * scale
    shade = 0.34 + 0.66 * np.clip(normals @ light, 0.0, 1.0)

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    for idx in order:
        i0, i1, i2 = F[idx]
        col = (C[idx].astype(np.float64) * float(shade[idx])).clip(0, 255).astype(np.uint8)
        draw.polygon(
            [(float(xs[i0]), float(ys[i0])), (float(xs[i1]), float(ys[i1])), (float(xs[i2]), float(ys[i2]))],
            fill=(int(col[0]), int(col[1]), int(col[2]), 255),
        )
    return img


def share_snapshot_filename(project_path: Path, filename: str, *, resolve_viewport=None) -> str | None:
    """Best matching CAD snapshot PNG for social / text-message previews."""
    stem = Path(filename).stem.lstrip(".")
    roots = [stem]
    # `.Model.step.glb` → also try `Model` / `Model.step` roots for snapshot names.
    if stem.lower().endswith(".step"):
        roots.append(stem[: -len(".step")])
    if "." in stem:
        roots.append(stem.split(".", 1)[0])
    for suffix in ("_edited", "_pulled", "_mirrored", "_extruded", "_body", "_section"):
        if stem.endswith(suffix):
            roots.append(stem[: -len(suffix)])
    if resolve_viewport is not None:
        try:
            viewer = resolve_viewport(project_path, Path(filename).name)
            if viewer:
                viewer_stem = Path(viewer).stem.lstrip(".")
                if viewer_stem not in roots:
                    roots.insert(0, viewer_stem)
                if viewer_stem.lower().endswith(".step"):
                    bare = viewer_stem[: -len(".step")]
                    if bare and bare not in roots:
                        roots.insert(0, bare)
        except Exception:
            pass

    def _is_source_snapshot(path: Path) -> bool:
        name = path.name.lower()
        if "opposite" in name:
            return False
        # Never treat derived share assets as the source snapshot (avoids nested
        # `_share_transparent_share_transparent…` growth and broken OG URLs).
        if "_share_transparent" in name or "_share_og" in name:
            return False
        return path.is_file()

    def _collect(patterns: list[str], *, prefer_root: str | None = None) -> list[Path]:
        found: list[Path] = []
        for pattern in patterns:
            found.extend(p for p in project_path.glob(pattern) if _is_source_snapshot(p))
        if prefer_root:
            preferred = [p for p in found if p.name.startswith(f"{prefer_root}_snapshot")]
            if preferred:
                return preferred
        return found

    candidates: list[Path] = []
    for root in roots:
        if not root:
            continue
        candidates = _collect(
            [f"{root}_snapshot_iso_*.png", f"{root}_snapshot_iso*.png"],
            prefer_root=root,
        )
        if not candidates:
            candidates = _collect([f"{root}_snapshot_*.png"], prefer_root=root)
        if candidates:
            break
    if not candidates:
        candidates = _collect(["*_snapshot_iso_*.png", "*_snapshot_iso*.png"])
    if not candidates:
        candidates = _collect(["*_snapshot_*.png"])
    if not candidates:
        return None
    iso = [p for p in candidates if "_snapshot_iso" in p.name.lower()]
    pool = iso or candidates
    return max(pool, key=lambda p: p.stat().st_mtime).name


def _png_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Not a PNG")
    chunks: list[tuple[bytes, bytes]] = []
    offset = 8
    while offset + 12 <= len(data):
        size = struct.unpack(">I", data[offset : offset + 4])[0]
        tag = data[offset + 4 : offset + 8]
        start = offset + 8
        end = start + size
        if end + 4 > len(data):
            raise ValueError("Invalid PNG chunk")
        chunks.append((tag, data[start:end]))
        offset = end + 4
        if tag == b"IEND":
            break
    return chunks


def _encode_png_rgba(width: int, height: int, rgba: bytes) -> bytes:
    raw = bytearray()
    row_stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * row_stride : (y + 1) * row_stride])
    compressed = zlib.compress(bytes(raw), level=6)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join([b"\x89PNG\r\n\x1a\n", chunk(b"IHDR", ihdr), chunk(b"IDAT", compressed), chunk(b"IEND", b"")])


def _decode_png_rgb_or_rgba(data: bytes) -> tuple[int, int, bytearray]:
    chunks = _png_chunks(data)
    ihdr = next((payload for tag, payload in chunks if tag == b"IHDR"), None)
    if ihdr is None or len(ihdr) < 13:
        raise ValueError("Missing PNG header")
    width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(">IIBBBBB", ihdr)
    if bit_depth != 8 or color_type not in {2, 6} or compression != 0 or filter_method != 0 or interlace != 0:
        raise ValueError("Unsupported PNG format")
    channels = 4 if color_type == 6 else 3
    stride = width * channels
    inflated = zlib.decompress(b"".join(payload for tag, payload in chunks if tag == b"IDAT"))
    rgba = bytearray(width * height * 4)
    prev = bytearray(stride)
    src = 0
    dst = 0
    for _ in range(height):
        filter_type = inflated[src]
        src += 1
        row = bytearray(inflated[src : src + stride])
        src += stride
        for i, value in enumerate(row):
            left = row[i - channels] if i >= channels else 0
            up = prev[i]
            up_left = prev[i - channels] if i >= channels else 0
            if filter_type == 1:
                row[i] = (value + left) & 0xFF
            elif filter_type == 2:
                row[i] = (value + up) & 0xFF
            elif filter_type == 3:
                row[i] = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                predictor = left + up - up_left
                pa = abs(predictor - left)
                pb = abs(predictor - up)
                pc = abs(predictor - up_left)
                row[i] = (value + (left if pa <= pb and pa <= pc else up if pb <= pc else up_left)) & 0xFF
            elif filter_type != 0:
                raise ValueError("Unsupported PNG filter")
        for x in range(width):
            base = x * channels
            rgba[dst : dst + 4] = row[base : base + 3] + (bytes([row[base + 3]]) if channels == 4 else b"\xff")
            dst += 4
        prev = row
    return width, height, rgba


def _legacy_transparent_needs_rebuild(out_path: Path) -> bool:
    """True when a cached transparent preview still has opaque light/dark studio corners."""
    try:
        from PIL import Image

        with Image.open(out_path) as img:
            rgba = img.convert("RGBA")
            r, g, b, a = rgba.getpixel((0, 0))
        if a < 250:
            return False
        return _is_share_preview_background_pixel(r, g, b, a)
    except Exception:
        return True


def make_share_preview_transparent(project_path: Path, snapshot_name: str) -> str | None:
    src = project_path / Path(snapshot_name).name
    if not src.is_file() or src.suffix.lower() != ".png":
        return None
    if "_share_transparent" in src.name.lower() or "_share_og" in src.name.lower():
        return src.name if "_share_transparent" in src.name.lower() else None
    out = src.with_name(f"{_snapshot_base_stem(src.name)}_share_transparent.png")
    try:
        if (
            out.is_file()
            and out.stat().st_mtime_ns >= src.stat().st_mtime_ns
            and not _legacy_transparent_needs_rebuild(out)
        ):
            return out.name
        width, height, rgba = _decode_png_rgb_or_rgba(src.read_bytes())
        transparent = bytearray(width * height)
        queue: deque[int] = deque()

        def maybe_enqueue(pixel_index: int) -> None:
            if pixel_index < 0 or pixel_index >= width * height or transparent[pixel_index]:
                return
            base = pixel_index * 4
            if _is_share_preview_background_pixel(rgba[base], rgba[base + 1], rgba[base + 2], rgba[base + 3]):
                transparent[pixel_index] = 1
                queue.append(pixel_index)

        for x in range(width):
            maybe_enqueue(x)
            maybe_enqueue((height - 1) * width + x)
        for y in range(height):
            maybe_enqueue(y * width)
            maybe_enqueue(y * width + width - 1)
        while queue:
            idx = queue.popleft()
            x = idx % width
            if x > 0:
                maybe_enqueue(idx - 1)
            if x + 1 < width:
                maybe_enqueue(idx + 1)
            if idx >= width:
                maybe_enqueue(idx - width)
            if idx + width < width * height:
                maybe_enqueue(idx + width)
        for idx, is_transparent in enumerate(transparent):
            if is_transparent:
                rgba[idx * 4 + 3] = 0
        out.write_bytes(_encode_png_rgba(width, height, bytes(rgba)))
        return out.name
    except Exception as exc:
        logger.warning("Could not create transparent share preview for %s: %s", src.name, exc)
        return None


def _draw_render3d_badge(image: Any) -> None:
    """Stamp a large Render3D wordmark (logo + text, no pill) in the top-right."""
    from PIL import Image, ImageDraw, ImageFont

    width, height = image.size
    margin = max(28, int(min(width, height) * 0.045))
    # Large brand mark — readable in iMessage / Slack unfurl cards.
    mark_h = max(120, min(220, int(height * 0.22)))
    icon_size = mark_h
    gap = max(16, int(mark_h * 0.16))
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", max(48, int(mark_h * 0.58)))
    except Exception:
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", max(48, int(mark_h * 0.58)))
        except Exception:
            font = ImageFont.load_default()

    text = "Render3D"
    draw = ImageDraw.Draw(image, "RGBA")
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    total_w = icon_size + gap + text_w
    x0 = max(margin, width - total_w - margin)
    y0 = margin
    icon_y = y0 + max(0, (mark_h - icon_size) // 2)
    text_y = y0 + max(0, (mark_h - text_h) // 2) - 2

    logo_paths = [
        Path(__file__).resolve().parents[2] / "frontend" / "render3d-logo.png",
        Path(__file__).resolve().parents[2] / "frontend" / "favicon-180.png",
    ]
    logo = None
    for path in logo_paths:
        if path.is_file():
            try:
                logo = Image.open(path).convert("RGBA")
                break
            except Exception:
                logo = None
    if logo is not None:
        logo = logo.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
        image.alpha_composite(logo, (x0, icon_y))
    else:
        # Fallback drawn mark if logo assets are missing.
        draw.ellipse([x0, icon_y, x0 + icon_size, icon_y + icon_size], fill=(88, 166, 255, 255))
        draw.polygon(
            [
                (x0 + icon_size * 0.30, icon_y + icon_size * 0.24),
                (x0 + icon_size * 0.78, icon_y + icon_size * 0.50),
                (x0 + icon_size * 0.30, icon_y + icon_size * 0.76),
            ],
            fill=(230, 237, 243, 255),
        )

    text_x = x0 + icon_size + gap
    # Soft shadow so white text stays readable on bright model surfaces too.
    draw.text((text_x + 2, text_y + 2), text, font=font, fill=(0, 0, 0, 160))
    draw.text((text_x, text_y), text, font=font, fill=(245, 248, 252, 255))


def make_share_og_png(project_path: Path, snapshot_name: str) -> tuple[str, int, int] | None:
    """Black-background PNG thumbnail for iMessage / SMS / Slack link previews."""
    src = project_path / Path(snapshot_name).name
    if not src.is_file():
        return None
    # Filename busts messenger caches that still hold grey clay / bottom-right logo OGs.
    out = project_path / f"{_snapshot_base_stem(src.name)}_share_og_color.png"
    try:
        from PIL import Image

        if (
            out.is_file()
            and out.stat().st_mtime_ns >= src.stat().st_mtime_ns
            and not _legacy_share_og_needs_rebuild(out)
        ):
            with Image.open(out) as existing:
                return out.name, int(existing.size[0]), int(existing.size[1])

        transparent_name = make_share_preview_transparent(project_path, src.name)
        transparent_src = project_path / transparent_name if transparent_name else src
        with Image.open(transparent_src) as img:
            rgba = img.convert("RGBA")
            max_edge = 1600
            if max(rgba.size) > max_edge:
                rgba.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)

            # Workbench ISO snapshots are clay grey; prefer coloured part GLBs when available.
            model_layer = rgba
            if _rgba_image_is_clay_grey(rgba):
                colored = _render_colored_model_rgba(
                    project_path,
                    src.name,
                    size=(max(800, rgba.size[0]), max(600, rgba.size[1])),
                )
                if colored is not None:
                    if colored.size != rgba.size:
                        colored = colored.resize(rgba.size, Image.Resampling.LANCZOS)
                    model_layer = colored

            # Messengers often composite transparent PNGs onto white — bake black.
            canvas = Image.new("RGBA", model_layer.size, (*SHARE_OG_BACKGROUND_RGB, 255))
            canvas.alpha_composite(model_layer)
            _draw_render3d_badge(canvas)
            canvas.save(out, format="PNG", optimize=True)
            return out.name, int(canvas.size[0]), int(canvas.size[1])
    except Exception as exc:
        logger.warning("Could not create PNG share OG preview for %s: %s", src.name, exc)
        return None


def make_share_og_jpeg(project_path: Path, snapshot_name: str) -> tuple[str, int, int] | None:
    """Backward-compatible wrapper; share previews are black-background PNGs."""
    return make_share_og_png(project_path, snapshot_name)


def share_preview_filename(project_path: Path, filename: str, *, resolve_viewport=None) -> str | None:
    snapshot = share_snapshot_filename(project_path, filename, resolve_viewport=resolve_viewport)
    if not snapshot:
        return None
    og = make_share_og_png(project_path, snapshot)
    if og:
        return og[0]
    return make_share_preview_transparent(project_path, snapshot) or snapshot


def share_preview_image_meta(project_path: Path, filename: str, *, resolve_viewport=None) -> dict[str, Any]:
    snapshot = share_snapshot_filename(project_path, filename, resolve_viewport=resolve_viewport)
    if not snapshot:
        return {}
    og = make_share_og_png(project_path, snapshot)
    if og:
        name, width, height = og
        return {
            "preview_file": name,
            "preview_width": width,
            "preview_height": height,
            "preview_type": "image/png",
        }
    preview = make_share_preview_transparent(project_path, snapshot) or snapshot
    return {"preview_file": preview, "preview_type": "image/png"}
