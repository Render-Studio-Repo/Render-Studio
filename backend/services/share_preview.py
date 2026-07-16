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
from io import BytesIO
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


def _share_og_output_stem(snapshot_name: str) -> str:
    """Human-facing OG filenames should not expose internal ISO snapshot labels."""
    stem = _snapshot_base_stem(snapshot_name)
    return stem.replace("_snapshot_iso_", "_snapshot_").replace("_snapshot_iso", "_snapshot")


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

    def _face_rgb_for_geom(geom: Any, face_count: int) -> Any:
        fallback = np.tile(np.array([196, 196, 196], dtype=np.uint8), (face_count, 1))
        visual = getattr(geom, "visual", None)
        fc = getattr(visual, "face_colors", None)
        if fc is not None and len(fc) == face_count:
            return np.asarray(fc, dtype=np.uint8)[:, :3]
        try:
            color_visual = visual.to_color()
            fc = getattr(color_visual, "face_colors", None)
            if fc is not None and len(fc) == face_count:
                return np.asarray(fc, dtype=np.uint8)[:, :3]
        except Exception:
            pass
        try:
            uv = np.asarray(getattr(visual, "uv", None), dtype=np.float64)
            faces_idx = np.asarray(geom.faces, dtype=np.int32)
            texture = getattr(getattr(visual, "material", None), "baseColorTexture", None)
            if texture is not None and uv.shape[0] >= len(geom.vertices):
                tex = np.asarray(texture.convert("RGB"), dtype=np.uint8)
                th, tw = tex.shape[:2]
                face_uv = uv[faces_idx].mean(axis=1)
                xs = np.clip((face_uv[:, 0] % 1.0) * (tw - 1), 0, tw - 1).astype(np.int32)
                ys = np.clip((1.0 - (face_uv[:, 1] % 1.0)) * (th - 1), 0, th - 1).astype(np.int32)
                return tex[ys, xs, :3]
        except Exception:
            pass
        try:
            main = getattr(getattr(visual, "material", None), "main_color", None)
            if main is not None and len(main) >= 3:
                rgb = np.asarray(main[:3], dtype=np.uint8)
                return np.tile(rgb, (face_count, 1))
        except Exception:
            pass
        return fallback

    verts: list[Any] = []
    faces: list[Any] = []
    colors: list[Any] = []
    voff = 0
    colourful = 0
    for geom in meshes:
        try:
            v = np.asarray(geom.vertices, dtype=np.float64)
            f = np.asarray(geom.faces, dtype=np.int32) + voff
            fc = _face_rgb_for_geom(geom, len(f))
            rgb = fc.astype(np.float64)
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

    # Match the model's authored orientation. A forced plan rotation made long
    # assemblies appear sideways-left in share thumbnails.
    az = math.radians(0.0)
    ax = math.radians(35.264)
    ay = math.radians(-45.0)
    Rz = np.array(
        [[math.cos(az), -math.sin(az), 0.0], [math.sin(az), math.cos(az), 0.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    Rx = np.array(
        [[1.0, 0.0, 0.0], [0.0, math.cos(ax), -math.sin(ax)], [0.0, math.sin(ax), math.cos(ax)]],
        dtype=np.float64,
    )
    Ry = np.array(
        [[math.cos(ay), 0.0, math.sin(ay)], [0.0, 1.0, 0.0], [-math.sin(ay), 0.0, math.cos(ay)]],
        dtype=np.float64,
    )
    Vp = ((V @ Rz.T) @ Ry.T) @ Rx.T
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
    pad_x = max(96.0, width * 0.10)
    top_pad = max(76.0, height * 0.075)
    bottom_reserved = max(210.0, height * 0.21)
    mins = Vp.min(axis=0)
    maxs = Vp.max(axis=0)
    span_x = max(float(maxs[0] - mins[0]), 1e-6)
    span_y = max(float(maxs[1] - mins[1]), 1e-6)
    safe_w = max(1.0, width - pad_x * 2.0)
    safe_h = max(1.0, height - top_pad - bottom_reserved)
    scale = min(safe_w / span_x, safe_h / span_y) * 0.99
    x_mid = (mins[0] + maxs[0]) * 0.5
    y_mid = (mins[1] + maxs[1]) * 0.5
    cx = width * 0.50
    cy = top_pad + safe_h * 0.53
    xs = cx + (Vp[:, 0] - x_mid) * scale
    ys = cy - (Vp[:, 1] - y_mid) * scale
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
    """Stamp icon in the top-right and a metallic Render3D wordmark bottom-right."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    width, height = image.size
    margin = max(10, int(min(width, height) * 0.018))
    icon_size = max(216, min(336, int(height * 0.285)))

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
        image.alpha_composite(logo, (width - icon_size - margin, margin))
    else:
        # Fallback drawn mark if logo assets are missing.
        draw = ImageDraw.Draw(image, "RGBA")
        x0 = width - icon_size - margin
        y0 = margin
        draw.ellipse([x0, y0, x0 + icon_size, y0 + icon_size], fill=(88, 166, 255, 255))
        draw.polygon(
            [
                (x0 + icon_size * 0.30, y0 + icon_size * 0.24),
                (x0 + icon_size * 0.78, y0 + icon_size * 0.50),
                (x0 + icon_size * 0.30, y0 + icon_size * 0.76),
            ],
            fill=(230, 237, 243, 255),
        )

    text = "Render3D"
    word_h = max(84, min(150, int(height * 0.13)))
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", max(48, int(word_h * 0.72)))
    except Exception:
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", max(48, int(word_h * 0.72)))
        except Exception:
            font = ImageFont.load_default()

    draw = ImageDraw.Draw(image, "RGBA")
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=max(1, int(word_h * 0.025)))
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    stroke = max(2, int(word_h * 0.035))
    text_x = max(margin, width - text_w - margin - stroke * 3 - 10)
    text_y = max(margin, height - text_h - margin - stroke * 3 - 10)

    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow, "RGBA")
    shadow_draw.text(
        (text_x + 6, text_y + 6),
        text,
        font=font,
        fill=(0, 0, 0, 220),
        stroke_width=stroke + 2,
        stroke_fill=(0, 0, 0, 235),
    )
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(radius=max(1, int(word_h * 0.024)))))

    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.text((text_x, text_y), text, font=font, fill=255, stroke_width=stroke, stroke_fill=255)

    metal = Image.new("RGBA", image.size, (0, 0, 0, 0))
    metal_px = metal.load()
    top = max(0, text_y)
    bottom = min(height - 1, text_y + text_h + stroke * 2)
    span = max(1, bottom - top)
    bands = [
        (255, 255, 255),
        (218, 228, 240),
        (255, 255, 255),
        (172, 186, 204),
        (246, 251, 255),
    ]
    for y in range(top, bottom + 1):
        t = (y - top) / span
        pos = t * (len(bands) - 1)
        idx = min(len(bands) - 2, int(pos))
        frac = pos - idx
        c0, c1 = bands[idx], bands[idx + 1]
        color = tuple(int(c0[i] + (c1[i] - c0[i]) * frac) for i in range(3))
        for x in range(max(0, text_x - stroke), min(width, text_x + text_w + stroke * 2)):
            metal_px[x, y] = (*color, 255)

    outline = ImageDraw.Draw(image, "RGBA")
    outline.text(
        (text_x, text_y),
        text,
        font=font,
        fill=(0, 0, 0, 0),
        stroke_width=max(stroke + 2, int(word_h * 0.055)),
        stroke_fill=(8, 12, 18, 185),
    )
    image.paste(metal, (0, 0), mask)

    highlight = ImageDraw.Draw(image, "RGBA")
    highlight.line(
        [(text_x + stroke, text_y + max(4, int(text_h * 0.22))), (text_x + text_w - stroke, text_y + max(4, int(text_h * 0.22)))],
        fill=(255, 255, 255, 80),
        width=max(1, int(word_h * 0.018)),
    )


def make_branded_viewport_share_preview(
    project_path: Path,
    image_bytes: bytes,
    output_name: str,
) -> tuple[str, int, int] | None:
    """Brand a live viewport screenshot for share previews.

    The viewport capture is the authoritative current visible/hidden model view;
    this function only bakes it onto black and stamps the Render3D brand.
    """
    out = project_path / Path(output_name).with_suffix(".png").name
    try:
        from PIL import Image

        with Image.open(BytesIO(image_bytes)) as img:
            rgba = img.convert("RGBA")
            max_edge = 1600
            if max(rgba.size) > max_edge:
                rgba.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", rgba.size, (*SHARE_OG_BACKGROUND_RGB, 255))
            canvas.alpha_composite(rgba)
            _draw_render3d_badge(canvas)
            canvas.save(out, format="PNG", optimize=True)
            return out.name, int(canvas.size[0]), int(canvas.size[1])
    except Exception as exc:
        logger.warning("Could not brand live viewport share preview %s: %s", out.name, exc)
        return None


def make_share_og_png(project_path: Path, snapshot_name: str) -> tuple[str, int, int] | None:
    """Black-background PNG thumbnail for iMessage / SMS / Slack link previews."""
    src = project_path / Path(snapshot_name).name
    if not src.is_file():
        return None
    # Filename busts messenger caches that still hold grey clay / bottom-right logo OGs.
    out = project_path / f"{_share_og_output_stem(src.name)}_share_og_color.png"
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

            # Keep share generation cheap and predictable: brand the existing
            # snapshot/viewport thumbnail instead of re-rendering large GLBs.
            model_layer = rgba

            # Messengers often composite transparent PNGs onto white — bake black.
            canvas = Image.new("RGBA", model_layer.size, (*SHARE_OG_BACKGROUND_RGB, 255))
            canvas.alpha_composite(model_layer)
            _draw_render3d_badge(canvas)
            canvas.save(out, format="PNG", optimize=True)
            return out.name, int(canvas.size[0]), int(canvas.size[1])
    except Exception as exc:
        logger.warning("Could not create PNG share OG preview for %s: %s", src.name, exc)
        return None


def make_share_og_png_from_model(project_path: Path, filename: str) -> tuple[str, int, int] | None:
    """Black-background PNG thumbnail rendered directly from a coloured GLB/model file."""
    src = project_path / Path(filename).name
    if not src.is_file():
        return None
    out = project_path / f"{Path(src.name).stem}_share_og_color.png"
    try:
        from PIL import Image

        if (
            out.is_file()
            and out.stat().st_mtime_ns >= src.stat().st_mtime_ns
            and not _legacy_share_og_needs_rebuild(out)
        ):
            with Image.open(out) as existing:
                return out.name, int(existing.size[0]), int(existing.size[1])

        model_layer = _render_colored_model_rgba(project_path, src.name, size=(1600, 1200))
        if model_layer is None:
            return None
        canvas = Image.new("RGBA", model_layer.size, (*SHARE_OG_BACKGROUND_RGB, 255))
        canvas.alpha_composite(model_layer)
        _draw_render3d_badge(canvas)
        canvas.save(out, format="PNG", optimize=True)
        return out.name, int(canvas.size[0]), int(canvas.size[1])
    except Exception as exc:
        logger.warning("Could not create model share OG preview for %s: %s", src.name, exc)
        return None


def make_share_og_jpeg(project_path: Path, snapshot_name: str) -> tuple[str, int, int] | None:
    """Backward-compatible wrapper; share previews are black-background PNGs."""
    return make_share_og_png(project_path, snapshot_name)


def _has_exact_snapshot(project_path: Path, filename: str) -> bool:
    stem = Path(filename).stem.lstrip(".")
    if not stem:
        return False
    for pattern in (f"{stem}_snapshot_iso*.png", f"{stem}_snapshot_*.png"):
        if any(p.is_file() and "_share_" not in p.name.lower() and "opposite" not in p.name.lower() for p in project_path.glob(pattern)):
            return True
    return False


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
