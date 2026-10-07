"""Seed VibeCAD worker globals so gen_urdf() can import CAD Python sources.

VibeCAD build123d files are not standalone modules. The worker injects
``params``, ``inputs``, and ``fill_color`` before ``exec``. Robot artifact
CLIs used to import the same file with ``exec_module``, which raised
``NameError: name 'params' is not defined``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_WORKBENCH_FILL_COLORS = (
    "#58a6ff",
    "#3fb950",
    "#d29922",
    "#f85149",
    "#a371f7",
    "#79c0ff",
    "#ffa657",
    "#56d364",
)


def _parameters_from_sidecar(script_path: Path) -> dict[str, Any]:
    candidates = [
        script_path.with_suffix(".json"),
        script_path.parent / f"{script_path.stem}.json",
    ]
    stem = script_path.stem
    if stem.endswith(".vibecad"):
        candidates.append(script_path.parent / f"{stem}.json")
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve()
        if resolved in seen or not resolved.is_file():
            continue
        seen.add(resolved)
        try:
            data = json.loads(resolved.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get("parameters"), dict):
            return dict(data["parameters"])
    return {}


def _fill_color(index: int, alpha: float = 1.0) -> Any:
    hex_color = _WORKBENCH_FILL_COLORS[int(index) % len(_WORKBENCH_FILL_COLORS)]
    try:
        from build123d import Color
    except Exception:
        return None
    text = hex_color.lstrip("#")
    red = int(text[0:2], 16) / 255.0
    green = int(text[2:4], 16) / 255.0
    blue = int(text[4:6], 16) / 255.0
    try:
        return Color(red, green, blue, float(alpha))
    except Exception:
        return None


def seed_cad_runtime_globals(module: Any, script_path: Path) -> None:
    """Attach VibeCAD ``params`` / ``inputs`` / ``fill_color`` before exec_module."""
    ns = module.__dict__
    ns.setdefault("params", _parameters_from_sidecar(script_path))
    ns.setdefault("inputs", {})
    ns.setdefault("fill_color", _fill_color)

    def srgb(value: str, alpha: float = 1.0) -> Any:
        return _fill_color(0, alpha)

    ns.setdefault("srgb", srgb)
