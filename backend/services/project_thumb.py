"""Sidebar thumbnails from whatever the project already contains.

Prefer an existing iso / snapshot / share-view PNG when generation wrote one.
Otherwise rasterize the latest GLB/mesh (including an imported STEP's preview
GLB). Photos and reference stills are a last resort so a mesh job or a
bare import still shows the model instead of the empty logo.
"""

from __future__ import annotations

import io
import logging
import struct
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

THUMB_NAME = ".thumb.jpg"
THUMB_META_NAME = ".thumb.meta"
THUMB_SIZE = 384
THUMB_ALGO_VERSION = 5
JPEG_QUALITY = 82
_STUDIO_RGB = (13, 17, 23)
_OBJECT_PAD = 0.18
_BBOX_PREVIEW = 256
_FULL_SNAPSHOT_BYTES = 40_000
_PREFERRED_MODEL_BYTES = 12_000_000
_MIN_MODEL_BYTES = 512
_STEP_SUFFIXES = {".step", ".stp"}
_STILL_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
_SKIP_STILL_SUBSTR = ("opposite", "_brand", ".thumb", "exploded", "_section")


def thumb_path(project_path: Path) -> Path:
    return Path(project_path) / THUMB_NAME


def preview_url_for(project_id: str, project_path: Path) -> str:
    dest = thumb_path(project_path)
    version = 0
    try:
        if dest.is_file():
            version = int(dest.stat().st_mtime_ns)
    except OSError:
        version = 0
    return f"/api/projects/{project_id}/thumb?v={version}"


def _search_roots(project_path: Path) -> list[Path]:
    root = Path(project_path)
    from backend.services.engine_layout import ENGINE_FOLDERS

    roots = [root]
    for name in ENGINE_FOLDERS:
        folder = root / name
        if folder.is_dir():
            roots.append(folder)
    return roots


def _newest(paths: list[Path]) -> Path | None:
    files = [p for p in paths if p.is_file()]
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def _usable_still(path: Path, *, allow_share: bool = False) -> bool:
    if not path.is_file():
        return False
    name = path.name.lower()
    if any(token in name for token in _SKIP_STILL_SUBSTR):
        return False
    if not allow_share and ("_share_" in name or "_brand" in name):
        return False
    return True


def _still_file_size(path: Path) -> int:
    try:
        return int(path.stat().st_size)
    except OSError:
        return 0


def _best_still(paths: list[Path]) -> Path | None:
    """Prefer a real CAD/mesh snapshot over a tiny auto-raster splat."""
    files = [p for p in paths if p.is_file()]
    if not files:
        return None
    return max(
        files,
        key=lambda p: (
            1 if _still_file_size(p) >= _FULL_SNAPSHOT_BYTES else 0,
            _still_file_size(p),
            p.stat().st_mtime,
        ),
    )


def _still_is_full_snapshot(path: Path) -> bool:
    """True for CAD/mesh diagnostic stills, false for 384px vertex-splat caches."""
    if _still_file_size(path) >= _FULL_SNAPSHOT_BYTES:
        return True
    # The production thumbnail worker intentionally has a lean dependency set.
    # Read common image headers first so a missing Pillow install does not make
    # an 800x600 CAD snapshot lose to the GLB vertex-splat fallback.
    try:
        with path.open("rb") as stream:
            head = stream.read(32)
            if head.startswith(b"\x89PNG\r\n\x1a\n") and len(head) >= 24:
                width, height = struct.unpack(">II", head[16:24])
                return max(width, height) >= 512
            if head[:2] == b"\xff\xd8":
                stream.seek(2)
                while True:
                    marker_start = stream.read(1)
                    if not marker_start:
                        break
                    if marker_start != b"\xff":
                        continue
                    marker = stream.read(1)
                    while marker == b"\xff":
                        marker = stream.read(1)
                    if not marker or marker in {b"\xd8", b"\xd9"}:
                        continue
                    length_data = stream.read(2)
                    if len(length_data) != 2:
                        break
                    segment_length = struct.unpack(">H", length_data)[0]
                    if segment_length < 2:
                        break
                    if marker[0] in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                        frame = stream.read(5)
                        if len(frame) == 5:
                            height, width = struct.unpack(">HH", frame[1:5])
                            return max(width, height) >= 512
                        break
                    stream.seek(segment_length - 2, 1)
    except OSError:
        return False
    try:
        from PIL import Image

        with Image.open(path) as im:
            width, height = im.size
        return max(int(width), int(height)) >= 512
    except Exception:
        return False


def _skip_model_for_thumb(path: Path) -> bool:
    stem = path.stem.lower()
    return "_exploded" in stem or "__part_" in stem


def find_source_image(project_path: Path) -> Path | None:
    """Pick the best already-rendered still (CAD iso or mesh Playwright capture)."""
    root = Path(project_path)
    if not root.is_dir():
        return None

    iso: list[Path] = []
    snapshots: list[Path] = []
    simple: list[Path] = []
    shares: list[Path] = []
    for folder in _search_roots(root):
        try:
            iso.extend(path for path in folder.glob("*_snapshot_iso*.png") if _usable_still(path))
            simple.extend(path for path in folder.glob("*_snapshot.png") if _usable_still(path))
            snapshots.extend(path for path in folder.glob("*_snapshot*.png") if _usable_still(path))
            shares.extend(
                path
                for path in folder.glob("*_share_view*.png")
                if _usable_still(path, allow_share=True)
            )
        except OSError:
            continue

    found = _best_still(iso) or _best_still(simple) or _best_still(snapshots)
    if found:
        return found
    unbranded = [path for path in shares if "_brand" not in path.name.lower()]
    return _best_still(unbranded) or _best_still(shares)


def find_source_models(project_path: Path) -> list[Path]:
    """Viewable design meshes, published first then newest. Skip McMaster / exploded sidecars."""
    root = Path(project_path)
    if not root.is_dir():
        return []
    from backend.services.cad_service import looks_like_mcmaster_part_stem, newest_published_model
    from backend.services.engine_layout import iter_design_files, resolve_in_layout

    ordered: list[Path] = []
    published_model: Path | None = None
    seen: set[str] = set()

    def add(path: Path | None) -> None:
        if (
            path is None
            or not path.is_file()
            or _still_file_size(path) < _MIN_MODEL_BYTES
            or _skip_model_for_thumb(path)
        ):
            return
        try:
            key = str(path.resolve())
        except OSError:
            key = str(path)
        if key in seen:
            return
        seen.add(key)
        ordered.append(path)

    published = newest_published_model(root)
    if published:
        located = resolve_in_layout(root, published) or (root / published)
        if located.is_file() and not _skip_model_for_thumb(located):
            suffix = located.suffix.lower()
            if suffix in {".glb", ".gltf"}:
                add(located)
                if ordered and ordered[-1] == located:
                    published_model = located
            else:
                sibling = located.with_suffix(".glb")
                if sibling.is_file() and sibling.stat().st_size > 0:
                    add(sibling)
                    if ordered and ordered[-1] == sibling:
                        published_model = sibling

    glbs: list[Path] = []
    meshes: list[Path] = []
    extras: list[Path] = []
    try:
        files = iter_design_files(root)
    except OSError:
        files = []
    for path in files:
        if not path.is_file() or path.name.startswith("."):
            continue
        name = path.name.lower()
        if name.startswith("_active_") or name.startswith("_export_") or "_snapshot" in name:
            continue
        if ".generation-live." in name:
            continue
        if looks_like_mcmaster_part_stem(path.stem):
            continue
        suffix = path.suffix.lower()
        if _skip_model_for_thumb(path):
            continue
        if suffix in {".glb", ".gltf"}:
            glbs.append(path)
            continue
        if suffix in {".stl", ".obj", ".ply", ".off"}:
            meshes.append(path)
            continue
        if suffix == ".3mf":
            extras.append(path)
            continue
        if suffix in _STEP_SUFFIXES:
            sibling = path.with_suffix(".glb")
            if sibling.is_file() and sibling.stat().st_size > 0 and not _skip_model_for_thumb(sibling):
                if not looks_like_mcmaster_part_stem(sibling.stem):
                    glbs.append(sibling)

    def newest_first(paths: list[Path]) -> list[Path]:
        return sorted(paths, key=lambda p: p.stat().st_mtime, reverse=True)

    for path in newest_first(glbs):
        add(path)
    if not ordered:
        for path in newest_first(meshes):
            add(path)
    if not ordered:
        for path in newest_first(extras):
            add(path)
    # The accepted/published model is authoritative even when it is large.
    # Size only ranks fallbacks so a failed primary can recover cheaply.
    fallbacks = [path for path in ordered if path != published_model]
    manageable = [path for path in fallbacks if _still_file_size(path) <= _PREFERRED_MODEL_BYTES]
    if manageable:
        oversized = [path for path in fallbacks if path not in manageable]
        fallbacks = manageable + oversized
    if published_model is not None:
        ordered = [published_model, *fallbacks]
    else:
        ordered = fallbacks
    return ordered


def find_source_model(project_path: Path) -> Path | None:
    """Latest viewable design mesh. Skip McMaster catalog parts and exploded sidecars."""
    models = find_source_models(project_path)
    return models[0] if models else None


def find_fallback_still(project_path: Path) -> Path | None:
    """Prompt photos / renders when no snapshot or 3D file is available yet."""
    root = Path(project_path)
    if not root.is_dir():
        return None

    candidates: list[Path] = []
    folders = [
        root / "renders",
        root / "references",
        root / ".img2threejs",
    ]
    for folder in folders:
        if not folder.is_dir():
            continue
        try:
            children = list(folder.iterdir())
        except OSError:
            continue
        for child in children:
            if child.is_file():
                if child.suffix.lower() in _STILL_SUFFIXES and _usable_still(child, allow_share=True):
                    candidates.append(child)
                continue
            if not child.is_dir():
                continue
            try:
                nested = list(child.iterdir())
            except OSError:
                continue
            for nested_file in nested:
                if nested_file.is_file() and nested_file.suffix.lower() in _STILL_SUFFIXES and _usable_still(
                    nested_file, allow_share=True
                ):
                    candidates.append(nested_file)
    return _newest(candidates)


def pick_thumb_source(project_path: Path) -> tuple[Path | None, str]:
    """Return (path, kind) where kind is ``image`` or ``model``."""
    still = find_source_image(project_path)
    model = find_source_model(project_path)
    if still and _still_is_full_snapshot(still):
        # Real diagnostic / share snapshots beat re-rasterizing a GLB and must
        # not lose to a newer exploded sidecar or a 384px vertex-splat cache.
        return still, "image"
    if model:
        return model, "model"
    if still:
        return still, "image"
    fallback = find_fallback_still(project_path)
    if fallback:
        return fallback, "image"
    return None, ""


def _is_studio_background(r: int, g: int, b: int, a: int, *, dark_scene: bool) -> bool:
    if a < 12:
        return True
    spread = max(r, g, b) - min(r, g, b)
    # Light CAD studio / off-white iso backgrounds.
    if min(r, g, b) >= 200 and spread <= 40:
        return True
    # Dark viewport, ground shadow, and dim grid — only when the frame itself is dark.
    # On light isos, dark pixels are usually the model (tires, edges), not the studio.
    if dark_scene and max(r, g, b) <= 62 and spread <= 30:
        return True
    return False


def _dilate_mask(mask: list[list[bool]], radius: int = 1) -> list[list[bool]]:
    if radius < 1 or not mask or not mask[0]:
        return mask
    hh, ww = len(mask), len(mask[0])
    out = [row[:] for row in mask]
    for y in range(hh):
        for x in range(ww):
            if not mask[y][x]:
                continue
            y0, y1 = max(0, y - radius), min(hh, y + radius + 1)
            x0, x1 = max(0, x - radius), min(ww, x + radius + 1)
            for ny in range(y0, y1):
                for nx in range(x0, x1):
                    out[ny][nx] = True
    return out


def _object_bbox(im: Any) -> tuple[int, int, int, int] | None:
    """Bounding box of the whole foreground silhouette, in source-image pixels."""
    width, height = im.size
    if width < 2 or height < 2:
        return None

    from PIL import Image

    scale = 1.0
    work = im
    if max(width, height) > _BBOX_PREVIEW:
        scale = _BBOX_PREVIEW / max(width, height)
        work = im.resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            getattr(getattr(Image, "Resampling", Image), "BILINEAR", Image.BICUBIC),
        )

    rgba = work.convert("RGBA")
    pix = rgba.load()
    ww, hh = rgba.size
    corners = (
        pix[0, 0],
        pix[ww - 1, 0],
        pix[0, hh - 1],
        pix[ww - 1, hh - 1],
    )
    dark_scene = sum(1 for r, g, b, a in corners if max(r, g, b) <= 50) >= 3
    edge_bg = [[False] * ww for _ in range(hh)]
    seen = [[False] * ww for _ in range(hh)]
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        if x < 0 or y < 0 or x >= ww or y >= hh or seen[y][x]:
            return
        seen[y][x] = True
        r, g, b, a = pix[x, y]
        if not _is_studio_background(r, g, b, a, dark_scene=dark_scene):
            return
        edge_bg[y][x] = True
        queue.append((x, y))

    for x in range(ww):
        enqueue(x, 0)
        enqueue(x, hh - 1)
    for y in range(hh):
        enqueue(0, y)
        enqueue(ww - 1, y)
    while queue:
        x, y = queue.popleft()
        enqueue(x - 1, y)
        enqueue(x + 1, y)
        enqueue(x, y - 1)
        enqueue(x, y + 1)

    fg = [[(not edge_bg[y][x]) for x in range(ww)] for y in range(hh)]
    # Thin outer walls drop out at preview size; grow them so a cavity floor
    # is not framed as the whole object.
    fg = _dilate_mask(fg, radius=1)
    labeled = [[0] * ww for _ in range(hh)]
    sizes: list[int] = [0]
    for y in range(hh):
        for x in range(ww):
            if not fg[y][x] or labeled[y][x]:
                continue
            label = len(sizes)
            sizes.append(0)
            blob: deque[tuple[int, int]] = deque([(x, y)])
            labeled[y][x] = label
            while blob:
                cx, cy = blob.popleft()
                sizes[label] += 1
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= ww or ny >= hh:
                        continue
                    if not fg[ny][nx] or labeled[ny][nx]:
                        continue
                    labeled[ny][nx] = label
                    blob.append((nx, ny))

    if len(sizes) < 2:
        return None
    min_keep = max(12, (ww * hh) // 500)
    keep = {i for i, count in enumerate(sizes) if i > 0 and count >= min_keep}
    if not keep:
        keep = {max(range(1, len(sizes)), key=lambda i: sizes[i])}
        if sizes[next(iter(keep))] < 12:
            return None

    min_x, min_y, max_x, max_y = ww, hh, -1, -1
    for y in range(hh):
        for x in range(ww):
            if labeled[y][x] not in keep:
                continue
            if x < min_x:
                min_x = x
            if y < min_y:
                min_y = y
            if x > max_x:
                max_x = x
            if y > max_y:
                max_y = y
    if max_x < 0:
        return None

    inv = 1.0 / scale
    return (
        max(0, int(min_x * inv)),
        max(0, int(min_y * inv)),
        min(width, int((max_x + 1) * inv + 0.999)),
        min(height, int((max_y + 1) * inv + 0.999)),
    )


def _square_around_object(im: Any) -> Any:
    width, height = im.size
    bbox = _object_bbox(im)
    if bbox is None:
        side = min(width, height)
        x0 = (width - side) // 2
        y0 = (height - side) // 2
        return im.crop((x0, y0, x0 + side, y0 + side))

    left, top, right, bottom = bbox
    bw = max(1, right - left)
    bh = max(1, bottom - top)
    pad = max(4, int(max(bw, bh) * _OBJECT_PAD))
    cx = (left + right) / 2
    cy = (top + bottom) / 2
    side = max(bw, bh) + pad * 2
    x0 = int(round(cx - side / 2))
    y0 = int(round(cy - side / 2))
    x1 = x0 + side
    y1 = y0 + side
    if x0 < 0:
        x1 -= x0
        x0 = 0
    if y0 < 0:
        y1 -= y0
        y0 = 0
    if x1 > width:
        x0 -= x1 - width
        x1 = width
    if y1 > height:
        y0 -= y1 - height
        y1 = height
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(width, x1)
    y1 = min(height, y1)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return im
    return im.crop((x0, y0, x1, y1))


def _contain_square(im: Any, size: int, resample: Any) -> Any:
    """Fit the whole object in the square. Cover-crop was zooming into cavities."""
    from PIL import Image

    width, height = im.size
    if width < 1 or height < 1:
        return Image.new("RGB", (size, size), _STUDIO_RGB)
    scale = min(size / width, size / height)
    nw = max(1, int(round(width * scale)))
    nh = max(1, int(round(height * scale)))
    resized = im.resize((nw, nh), resample)
    canvas = Image.new("RGB", (size, size), _STUDIO_RGB)
    x0 = (size - nw) // 2
    y0 = (size - nh) // 2
    canvas.paste(resized, (x0, y0))
    return canvas


def _write_bytes_atomic(dest: Path, data: bytes) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".{dest.name}.tmp")
    tmp.write_bytes(data)
    tmp.replace(dest)


def _write_rgba_jpeg(im: Any, dest: Path) -> None:
    from PIL import Image

    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
    cropped = _square_around_object(im.convert("RGBA"))
    canvas = Image.new("RGB", cropped.size, _STUDIO_RGB)
    canvas.paste(cropped, (0, 0), cropped)
    canvas = _contain_square(canvas, THUMB_SIZE, resample)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f".{dest.name}.tmp")
    canvas.save(
        tmp,
        format="JPEG",
        quality=JPEG_QUALITY,
        optimize=True,
        progressive=False,
    )
    tmp.replace(dest)


def _write_jpeg(src: Path, dest: Path) -> None:
    try:
        from PIL import Image

        with Image.open(src) as raw:
            _write_rgba_jpeg(raw, dest)
            return
    except Exception:
        data = src.read_bytes()
        if data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8"):
            _write_bytes_atomic(dest, data)
            return
        raise


def _write_jpeg_from_png_bytes(png: bytes, dest: Path) -> None:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(png)) as raw:
            _write_rgba_jpeg(raw, dest)
            return
    except Exception:
        if png.startswith(b"\x89PNG") and len(png) > 32:
            _write_bytes_atomic(dest, png)
            return
        raise


def _write_jpeg_from_model(src: Path, dest: Path) -> None:
    from backend.services.cad_reference_geometry import preview_png_bytes

    png = preview_png_bytes(src, view="iso", size=THUMB_SIZE)
    if not png:
        raise RuntimeError(f"empty preview for {src.name}")
    _write_jpeg_from_png_bytes(png, dest)


def thumb_media_type(dest: Path) -> str:
    try:
        head = dest.read_bytes()[:12]
    except OSError:
        return "image/jpeg"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head.startswith(b"\xff\xd8"):
        return "image/jpeg"
    return "image/jpeg"


def _meta_path(dest: Path) -> Path:
    return dest.with_name(THUMB_META_NAME)


def _source_fingerprint(dest: Path, src: Path | None) -> dict[str, Any]:
    if src is None:
        return {"src": "", "src_mtime_ns": 0, "src_size": 0}
    try:
        source_name = src.relative_to(dest.parent).as_posix()
    except ValueError:
        source_name = src.name
    try:
        stat = src.stat()
        return {
            "src": source_name,
            "src_mtime_ns": int(stat.st_mtime_ns),
            "src_size": int(stat.st_size),
        }
    except OSError:
        return {"src": source_name, "src_mtime_ns": 0, "src_size": 0}


def _write_thumb_meta(dest: Path, src: Path | None) -> None:
    import json

    payload = {
        "v": THUMB_ALGO_VERSION,
        **_source_fingerprint(dest, src),
    }
    try:
        _write_bytes_atomic(_meta_path(dest), json.dumps(payload).encode("utf-8"))
    except OSError:
        pass


def _thumb_is_current(dest: Path, src: Path | None) -> bool:
    if not dest.is_file():
        return False
    try:
        import json

        meta = json.loads(_meta_path(dest).read_text(encoding="utf-8"))
        if int(meta.get("v") or 0) != THUMB_ALGO_VERSION:
            return False
        fingerprint = _source_fingerprint(dest, src)
        if any(meta.get(key) != value for key, value in fingerprint.items()):
            return False
    except Exception:
        return False
    try:
        if src and dest.stat().st_mtime < src.stat().st_mtime:
            return False
    except OSError:
        return False
    try:
        from PIL import Image

        with Image.open(dest) as im:
            return im.size == (THUMB_SIZE, THUMB_SIZE)
    except Exception:
        try:
            return dest.stat().st_size > 32
        except OSError:
            return False


def _fail_meta_path(dest: Path) -> Path:
    return dest.with_name(".thumb.fail")


def _thumb_source_failed(dest: Path, src: Path | None) -> bool:
    """True when this same source already failed — do not re-parse on every poll."""
    if src is None:
        return False
    try:
        import json

        meta = json.loads(_fail_meta_path(dest).read_text(encoding="utf-8"))
        if str(meta.get("src") or "") != src.name:
            return False
        return int(meta.get("mtime_ns") or 0) == int(src.stat().st_mtime_ns)
    except Exception:
        return False


def _remember_thumb_failure(dest: Path, src: Path | None) -> None:
    if src is None:
        return
    import json

    try:
        payload = {"src": src.name, "mtime_ns": int(src.stat().st_mtime_ns)}
        _fail_meta_path(dest).write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        pass


def _mark_thumb_success(dest: Path, src: Path) -> None:
    _write_thumb_meta(dest, src)
    try:
        _fail_meta_path(dest).unlink(missing_ok=True)
    except OSError:
        pass


def _try_write_thumb(dest: Path, src: Path, kind: str) -> None:
    if kind == "model":
        _write_jpeg_from_model(src, dest)
    else:
        _write_jpeg(src, dest)


def ensure_project_thumb(project_path: Path, *, force: bool = False, allow_model: bool = True) -> Path | None:
    """Create or refresh `.thumb.jpg` from a snapshot, mesh, or project still."""
    root = Path(project_path)
    dest = thumb_path(root)
    src, kind = pick_thumb_source(root)
    if kind == "model" and not allow_model:
        still = find_source_image(root) or find_fallback_still(root)
        if still:
            src, kind = still, "image"
        else:
            return dest if dest.is_file() else None
    if not src:
        return dest if dest.is_file() else None

    candidates: list[tuple[Path, str]] = [(src, kind)]
    if kind == "model":
        for model in find_source_models(root):
            if model != src:
                candidates.append((model, "model"))

    last_src = src
    tried_model = False
    for cand, cand_kind in candidates:
        last_src = cand
        if not force and _thumb_is_current(dest, cand):
            return dest
        if not force and _thumb_source_failed(dest, cand):
            continue
        if cand_kind == "model":
            tried_model = True
        try:
            _try_write_thumb(dest, cand, cand_kind)
            if dest.is_file():
                _mark_thumb_success(dest, cand)
                return dest
        except Exception as exc:
            _remember_thumb_failure(dest, cand)
            logger.warning("project thumb failed for %s from %s: %s", root.name, cand.name, exc)
            try:
                dest.with_name(f".{dest.name}.tmp").unlink(missing_ok=True)
            except OSError:
                pass

    if tried_model or kind == "model":
        fallback = find_fallback_still(root)
        if fallback and fallback != last_src:
            try:
                _write_jpeg(fallback, dest)
                if dest.is_file():
                    _write_thumb_meta(dest, fallback)
                    return dest
            except Exception:
                logger.debug("project thumb still fallback failed for %s", root.name, exc_info=True)
    return dest if dest.is_file() else None


_THUMB_QUEUE_LOCK = threading.Lock()
_THUMB_QUEUE_AT: dict[str, float] = {}
THUMB_QUEUE_COOLDOWN_SEC = 30.0


def should_queue_model_thumb(project_path: Path) -> bool:
    """True once per cooldown when a project has a mesh but no JPEG yet.

    Sidebar GET must not rasterize GLBs inline (GIL stalls leftover explorer
    polls). Queue a background refresh instead.
    """
    root = Path(project_path)
    dest = thumb_path(root)
    try:
        if dest.is_file():
            return False
    except OSError:
        return False
    if not find_source_model(root):
        return False
    key = str(root)
    now = time.monotonic()
    with _THUMB_QUEUE_LOCK:
        last = _THUMB_QUEUE_AT.get(key)
        if last is not None and now - last < THUMB_QUEUE_COOLDOWN_SEC:
            return False
        _THUMB_QUEUE_AT[key] = now
    return True


def refresh_project_thumb(project_path: Path) -> Path | None:
    """Best-effort rebuild after upload / preview / generation."""
    try:
        return ensure_project_thumb(project_path, force=True)
    except Exception:
        logger.debug("project thumb refresh skipped for %s", Path(project_path).name, exc_info=True)
        return None


def thumb_payload(project_id: str, project_path: Path) -> dict[str, Any]:
    return {"preview_url": preview_url_for(project_id, project_path)}
