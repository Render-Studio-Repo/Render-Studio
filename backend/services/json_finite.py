"""RFC 8259 JSON helpers — never emit or require `Infinity` / `NaN`.

Python's ``json.dumps`` writes a bare ``Infinity`` that ``JSON.parse`` rejects
(Chrome/Node: ``Unexpected token 'I', ..."max":[Infinity,...``). Trimesh and OCC
bboxes do this when a mesh is empty or a vertex overflowed float32.
"""

from __future__ import annotations

import json
import math
import re
import struct
from pathlib import Path
from typing import Any

_NONFINITE_TOKEN = re.compile(r"-Infinity\b|\bInfinity\b|\bNaN\b")
_GLB_MAGIC = b"glTF"
_JSON_CHUNK = 0x4E4F534A


def finite_number(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    return numeric if math.isfinite(numeric) else float(fallback)


def finite_xyz(values: Any, fallback: float = 0.0) -> list[float]:
    items = list(values) if isinstance(values, (list, tuple)) else []
    out = [finite_number(v, fallback) for v in items[:3]]
    while len(out) < 3:
        out.append(float(fallback))
    return out


def finite_bbox(min_xyz: Any, max_xyz: Any, fallback: float = 0.0) -> dict[str, list[float]]:
    mn = finite_xyz(min_xyz, fallback)
    mx = finite_xyz(max_xyz, fallback)
    for i in range(3):
        if mx[i] < mn[i]:
            mn[i], mx[i] = mx[i], mn[i]
    return {"min": mn, "max": mx}


def sanitize_for_json(value: Any, fallback: float = 0.0) -> Any:
    if isinstance(value, float):
        return finite_number(value, fallback)
    if isinstance(value, dict):
        return {k: sanitize_for_json(v, fallback) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_for_json(v, fallback) for v in value]
    return value


def dumps_finite(value: Any, **kwargs: Any) -> str:
    kwargs.setdefault("allow_nan", False)
    return json.dumps(sanitize_for_json(value), **kwargs)


def loads_finite(text: str, fallback: Any = None) -> Any:
    """Parse JSON, accepting legacy Python ``Infinity`` / ``NaN`` tokens."""
    raw = str(text or "").strip()
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        repaired = _NONFINITE_TOKEN.sub("null", raw)
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            raise


_MAX_GLB_JSON_BYTES = 8_000_000


def read_glb_json_chunk_bytes(path: Path, max_json_bytes: int = _MAX_GLB_JSON_BYTES) -> bytes | None:
    """Read only the JSON chunk of a GLB — never the BIN mesh payload.

    ``path.read_bytes()`` on an 80MB viewer was stalling GET /api/projects/{id}
    (Jake vs shell stats + browser body names).
    """
    dest = Path(path)
    try:
        with dest.open("rb") as fh:
            header = fh.read(12)
            if len(header) < 12 or header[:4] != _GLB_MAGIC:
                return None
            while True:
                chunk_header = fh.read(8)
                if len(chunk_header) < 8:
                    return None
                chunk_len, chunk_type = struct.unpack("<II", chunk_header)
                if chunk_type == _JSON_CHUNK:
                    if chunk_len <= 0 or chunk_len > max_json_bytes:
                        return None
                    data = fh.read(chunk_len)
                    return data if len(data) == chunk_len else None
                if chunk_len < 0:
                    return None
                fh.seek(chunk_len, 1)
    except OSError:
        return None
    return None


def sanitize_gltf_accessors(gltf: dict[str, Any], fallback: float = 0.0) -> bool:
    """Drop non-finite accessor min/max so loaders recompute bounds from verts.

    Three.js GLTFLoader copies min/max onto geometry.boundingSphere. Zero-filling
    Infinity collapses an axis and makes the real mesh frustum-pop while zooming.
    ``fallback`` is unused; kept for call-site compatibility.
    """
    del fallback
    changed = False
    accessors = gltf.get("accessors") if isinstance(gltf, dict) else None
    if not isinstance(accessors, list):
        return False
    for accessor in accessors:
        if not isinstance(accessor, dict):
            continue
        drop = False
        for key in ("min", "max"):
            raw = accessor.get(key)
            if not isinstance(raw, list) or not raw:
                continue
            if any(not math.isfinite(finite_number(v, float("nan"))) for v in raw):
                drop = True
                break
        if not drop:
            continue
        if "min" in accessor:
            del accessor["min"]
            changed = True
        if "max" in accessor:
            del accessor["max"]
            changed = True
    return changed


def glb_json_has_nonfinite(path: Path) -> bool:
    raw = read_glb_json_chunk_bytes(path)
    if not raw:
        return False
    return b"Infinity" in raw or b"NaN" in raw


def glb_json_needs_sanitize(path: Path, abs_limit: float = 1e9) -> bool:
    """True when the GLB JSON chunk is not RFC-8259 or has overflowed accessor bbox."""
    raw = read_glb_json_chunk_bytes(path)
    if not raw:
        return False
    if b"Infinity" in raw or b"NaN" in raw:
        return True
    try:
        gltf = loads_finite(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return True
    if not isinstance(gltf, dict):
        return False
    accessors = gltf.get("accessors")
    if not isinstance(accessors, list):
        return False
    for accessor in accessors:
        if not isinstance(accessor, dict):
            continue
        for key in ("min", "max"):
            raw_bbox = accessor.get(key)
            if not isinstance(raw_bbox, list):
                continue
            for value in raw_bbox:
                numeric = finite_number(value, fallback=float("nan"))
                if not math.isfinite(numeric) or abs(numeric) > abs_limit:
                    return True
    return False


def _iter_glb_chunks(data: bytes) -> list[tuple[int, int, int, int]]:
    """Return ``(chunk_type, header_offset, data_offset, length)``."""
    if len(data) < 20 or data[:4] != _GLB_MAGIC:
        return []
    chunks: list[tuple[int, int, int, int]] = []
    offset = 12
    while offset + 8 <= len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        data_start = offset + 8
        if data_start + length > len(data):
            break
        chunks.append((chunk_type, offset, data_start, length))
        offset = data_start + length
    return chunks


def rewrite_glb_finite_json(path: Path, fallback: float = 0.0) -> bool:
    """Rewrite a GLB JSON chunk so accessor min/max are RFC 8259 numbers.

    Pads a shorter JSON payload with spaces so the BIN chunk stays put.
    Returns True when the file was rewritten.
    """
    dest = Path(path)
    try:
        data = bytearray(dest.read_bytes())
    except OSError:
        return False
    if len(data) < 20 or data[:4] != _GLB_MAGIC:
        return False
    json_start = None
    json_len = 0
    for chunk_type, _header, data_start, length in _iter_glb_chunks(bytes(data)):
        if chunk_type == _JSON_CHUNK:
            json_start = data_start
            json_len = length
            break
    if json_start is None or json_len <= 0:
        return False
    text = bytes(data[json_start : json_start + json_len]).decode("utf-8", errors="replace").strip()
    if "Infinity" not in text and "NaN" not in text:
        try:
            json.loads(text)
            return False
        except json.JSONDecodeError:
            pass
    try:
        gltf = loads_finite(text)
    except json.JSONDecodeError:
        return False
    if not isinstance(gltf, dict):
        return False
    sanitize_gltf_accessors(gltf, fallback)
    encoded = dumps_finite(gltf, separators=(",", ":")).encode("utf-8")
    if len(encoded) > json_len:
        return False
    data[json_start : json_start + json_len] = b" " * json_len
    data[json_start : json_start + len(encoded)] = encoded
    dest.write_bytes(bytes(data))
    return True
