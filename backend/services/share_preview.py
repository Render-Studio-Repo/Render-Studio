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
        if lowered.endswith("_share_og"):
            stem = stem[: -len("_share_og")]
            continue
        break
    return stem


def _is_share_preview_background_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a == 0:
        return True
    spread = max(r, g, b) - min(r, g, b)
    # Light CAD studio / off-white iso backgrounds (incl. soft blue-gray ~240,244,249).
    if min(r, g, b) >= 220 and spread <= 36:
        return True
    # Dark viewport studio (#0d1117 / near-black) used by the share viewer.
    if max(r, g, b) <= 28 and spread <= 18:
        return True
    return False


def _legacy_share_og_needs_rebuild(og_path: Path) -> bool:
    """True when an existing OG still has transparent or light corners (legacy)."""
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
        for r, g, b, a in samples:
            if a < 250:
                return True
            if min(r, g, b) >= 180:
                return True
        return False
    except Exception:
        return True


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
        if "_share_transparent" in name or "_share_og." in name:
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
    """Stamp a small Render3D brand mark in the bottom-right corner."""
    from PIL import ImageDraw, ImageFont

    width, height = image.size
    margin = max(18, int(min(width, height) * 0.035))
    badge_h = max(42, min(76, int(height * 0.09)))
    badge_w = max(148, int(badge_h * 3.6))
    x0 = max(margin, width - badge_w - margin)
    y0 = max(margin, height - badge_h - margin)
    x1 = width - margin
    y1 = height - margin
    radius = badge_h // 2
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle(
        [x0, y0, x1, y1],
        radius=radius,
        fill=(7, 11, 18, 218),
        outline=(88, 166, 255, 115),
        width=max(1, badge_h // 24),
    )

    icon_size = int(badge_h * 0.68)
    icon_x = x0 + int(badge_h * 0.18)
    icon_y = y0 + (badge_h - icon_size) // 2
    draw.ellipse([icon_x, icon_y, icon_x + icon_size, icon_y + icon_size], fill=(88, 166, 255, 255))
    draw.polygon(
        [
            (icon_x + icon_size * 0.28, icon_y + icon_size * 0.23),
            (icon_x + icon_size * 0.78, icon_y + icon_size * 0.5),
            (icon_x + icon_size * 0.28, icon_y + icon_size * 0.77),
        ],
        fill=(230, 237, 243, 245),
    )

    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", max(14, int(badge_h * 0.34)))
    except Exception:
        font = ImageFont.load_default()
    text = "Render3D"
    text_x = icon_x + icon_size + int(badge_h * 0.18)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_y = y0 + (badge_h - (bbox[3] - bbox[1])) // 2 - 1
    draw.text((text_x, text_y), text, font=font, fill=(230, 237, 243, 255))


def make_share_og_png(project_path: Path, snapshot_name: str) -> tuple[str, int, int] | None:
    """Black-background PNG thumbnail for iMessage / SMS / Slack link previews."""
    src = project_path / Path(snapshot_name).name
    if not src.is_file():
        return None
    out = project_path / f"{_snapshot_base_stem(src.name)}_share_og.png"
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
            # Messengers often composite transparent PNGs onto white — bake black.
            canvas = Image.new("RGBA", rgba.size, (*SHARE_OG_BACKGROUND_RGB, 255))
            canvas.alpha_composite(rgba)
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
