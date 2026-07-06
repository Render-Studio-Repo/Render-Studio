"""Schema + loader for the hardware specification library.

Specs are YAML files in ``backend/specs/data/``. All lengths are millimetres.

Coordinate frame (board components)
-----------------------------------
* Origin at the board's geometric centre.
* +X = length direction, +Y = width direction, +Z = up.
* The PCB top surface is at ``z = 0``; the PCB occupies ``z in [-thickness, 0]``.
* Top-side components occupy ``z > 0``.

This frame is shared by the spec data and the enclosure generator so that hole
positions, connector cut-outs, and keep-outs line up exactly.
"""

from __future__ import annotations

import functools
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

DATA_DIR = Path(__file__).resolve().parent / "data"

Edge = Literal["+x", "-x", "+y", "-y"]


class MountingHole(BaseModel):
    model_config = ConfigDict(extra="ignore")
    x: float
    y: float
    diameter: float
    name: str | None = None
    plated: bool = False


class Connector(BaseModel):
    """A connector/feature that needs a case cut-out.

    ``center`` is the [x, y, z] centre of the connector opening in the board
    frame (z relative to PCB top). ``size`` is [width, height] of the opening in
    the plane of its edge; ``overhang`` is how far it protrudes past the edge.
    """

    model_config = ConfigDict(extra="ignore")
    name: str
    type: str
    edge: Edge
    center: list[float] = Field(..., description="[x, y, z] in mm, board frame")
    size: list[float] = Field(..., description="[width, height] opening in mm")
    depth: float = 0.0
    overhang: float = 0.0


class KeepOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    min: list[float]
    max: list[float]


class BoardSpec(BaseModel):
    model_config = ConfigDict(extra="ignore")
    length: float
    width: float
    thickness: float


class Tolerances(BaseModel):
    model_config = ConfigDict(extra="allow")
    board_fit_clearance: float = 0.2  # per-side gap around the board in its pocket
    hole: float = 0.0
    connector_clearance: float = 0.75  # added to each side of connector openings


class ComponentSpec(BaseModel):
    """Top-level component specification."""

    model_config = ConfigDict(extra="allow")

    key: str
    name: str
    category: str = "pcb"
    manufacturer: str | None = None
    source: str | None = Field(None, description="Datasheet / drawing URL")
    revision: str | None = None
    license: str | None = None
    notes: str | None = None
    units: Literal["mm"] = "mm"

    board: BoardSpec
    mounting_holes: list[MountingHole] = Field(default_factory=list)
    connectors: list[Connector] = Field(default_factory=list)
    keepouts: list[KeepOut] = Field(default_factory=list)
    component_height_top: float = 4.0
    component_height_bottom: float = 1.0
    tolerances: Tolerances = Field(default_factory=Tolerances)

    def hole_pattern_extent(self) -> tuple[float, float]:
        """(dx, dy) spacing of the outermost mounting holes."""
        if not self.mounting_holes:
            return (0.0, 0.0)
        xs = [h.x for h in self.mounting_holes]
        ys = [h.y for h in self.mounting_holes]
        return (max(xs) - min(xs), max(ys) - min(ys))


def load_spec(path: Path) -> ComponentSpec:
    data: dict[str, Any] = yaml.safe_load(path.read_text())
    return ComponentSpec.model_validate(data)


@functools.lru_cache(maxsize=64)
def get_spec(key: str) -> ComponentSpec:
    """Load a spec by key (filename without extension). Cached."""
    norm = key.strip().lower().replace(" ", "_").replace("-", "_")
    candidates = [DATA_DIR / f"{norm}.yaml", DATA_DIR / f"{norm}.yml"]
    for path in candidates:
        if path.is_file():
            return load_spec(path)
    # Fuzzy: match on aliases inside files.
    for path in sorted(DATA_DIR.glob("*.y*ml")):
        spec = load_spec(path)
        aliases = {spec.key.lower()} | {a.lower() for a in (getattr(spec, "aliases", None) or [])}
        if norm in {a.replace(" ", "_").replace("-", "_") for a in aliases}:
            return spec
    raise KeyError(f"No spec found for '{key}'. Available: {available_specs()}")


def available_specs() -> list[str]:
    if not DATA_DIR.is_dir():
        return []
    return sorted(p.stem for p in DATA_DIR.glob("*.y*ml"))
