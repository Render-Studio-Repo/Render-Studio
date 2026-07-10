"""Repair minimal DXF exports so ezdxf/build123d can read them."""

from __future__ import annotations

from pathlib import Path

import ezdxf

_DXF_SUBCLASS_MAP: dict[str, tuple[str, ...]] = {
    "LWPOLYLINE": ("AcDbEntity", "AcDbPolyline"),
    "POLYLINE": ("AcDbEntity", "AcDb2dPolyline"),
    "CIRCLE": ("AcDbEntity", "AcDbCircle"),
    "LINE": ("AcDbEntity", "AcDbLine"),
    "ARC": ("AcDbEntity", "AcDbArc"),
}

_EZDXF_SUFFIX = ".ezdxf.dxf"


def repair_dxf_text(text: str) -> str:
    """Insert missing AcDb* subclass tags for common entity types."""
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        if line != "0" or i + 1 >= len(lines):
            i += 1
            continue

        entity_type = lines[i + 1]
        subclasses = _DXF_SUBCLASS_MAP.get(entity_type)
        if subclasses is None:
            i += 1
            continue

        out.append(entity_type)
        i += 2
        if i + 1 < len(lines) and lines[i] == "100" and lines[i + 1] == "AcDbEntity":
            continue
        for subclass in subclasses:
            out.extend(["100", subclass])
    trailing_newline = "\n" if text.endswith("\n") else ""
    return "\n".join(out) + trailing_newline


def _ezdxf_sidecar_path(source_path: Path) -> Path:
    return source_path.with_name(f"{source_path.stem}{_EZDXF_SUFFIX}")


def _can_read_dxf(path: Path) -> bool:
    try:
        ezdxf.readfile(path)
    except Exception:
        return False
    return True


def ensure_ezdxf_readable_dxf(source_path: Path) -> Path:
    """Return a path ezdxf can read, repairing into a sidecar file when needed."""
    resolved = source_path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(resolved)

    sidecar = _ezdxf_sidecar_path(resolved)
    if sidecar.is_file() and sidecar.stat().st_mtime >= resolved.stat().st_mtime and _can_read_dxf(sidecar):
        return sidecar
    if _can_read_dxf(resolved):
        return resolved

    repaired = repair_dxf_text(resolved.read_text(encoding="utf-8", errors="replace"))
    sidecar.write_text(repaired, encoding="utf-8")
    if not _can_read_dxf(sidecar):
        raise ValueError(f"Repaired DXF is still unreadable: {resolved.name}")
    return sidecar
