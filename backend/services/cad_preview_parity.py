"""World-space preview measurements compared with explicit CAD export facts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import trimesh

Bounds = tuple[float, float, float, float, float, float]


@dataclass(frozen=True)
class StepPreviewFacts:
    """Bounds are xmin/ymin/zmin/xmax/ymax/zmax in the preview's declared frame.

    occurrence_count is supplied only when one mesh node per CAD occurrence is
    an exporter guarantee. A STEP solid count is not an occurrence count.
    """

    bounds: Bounds
    occurrence_count: int | None = None

    def __post_init__(self) -> None:
        values = np.asarray(self.bounds, dtype=float)
        if values.shape != (6,) or not np.isfinite(values).all() or np.any(values[:3] > values[3:]):
            raise ValueError("STEP bounds must be six finite, ordered coordinates")
        if self.occurrence_count is not None and (
            isinstance(self.occurrence_count, bool)
            or not isinstance(self.occurrence_count, int)
            or self.occurrence_count < 1
        ):
            raise ValueError("Expected occurrence count must be a positive integer")


@dataclass(frozen=True)
class PreviewParityReport:
    ok: bool
    expected: StepPreviewFacts
    occurrence_count: int
    bounds: Bounds | None
    bounds_delta: Bounds | None
    tolerance: float
    issues: tuple[str, ...]


def facts_from_inspect_summary(summary: Mapping[str, Any]) -> StepPreviewFacts:
    """Build preview facts from CAD inspect output without guessing instances.

    The inspect summary's solid or shape counts do not define how the exporter
    maps CAD occurrences to GLB nodes. Bounds are safe to compare. Instance
    count stays unspecified until the exporter supplies that guarantee.
    """
    bounds = summary.get("bounds")
    if not isinstance(bounds, Mapping):
        raise ValueError("CAD inspect summary has no STEP bounds")
    minimum = bounds.get("min")
    maximum = bounds.get("max")
    if not isinstance(minimum, (list, tuple)) or not isinstance(maximum, (list, tuple)):
        raise ValueError("CAD inspect summary bounds require min and max coordinates")
    if len(minimum) < 3 or len(maximum) < 3:
        raise ValueError("CAD inspect summary bounds require three axes")
    return StepPreviewFacts(tuple(float(value) for value in (*minimum[:3], *maximum[:3])))


def measure_preview_parity(
    preview: Path,
    facts: StepPreviewFacts,
    *,
    absolute_tolerance: float = 0.1,
    relative_tolerance: float = 1e-4,
) -> PreviewParityReport:
    """Check occurrence count and world bounds, not shape equivalence or fit."""
    if not all(np.isfinite(v) and v >= 0 for v in (absolute_tolerance, relative_tolerance)):
        raise ValueError("Preview tolerances must be finite and nonnegative")
    expected = np.asarray(facts.bounds, dtype=float)
    tolerance = max(absolute_tolerance, relative_tolerance * float(np.max(expected[3:] - expected[:3])))
    issues: list[str] = []
    count = 0
    bounds = None
    delta = None
    try:
        scene = trimesh.load(str(preview), force="scene", process=False)
        minimum = np.full(3, np.inf)
        maximum = np.full(3, -np.inf)
        for node in scene.graph.nodes_geometry:
            transform, name = scene.graph[node]
            mesh = scene.geometry[name]
            if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.vertices) or not len(mesh.faces):
                issues.append(f"Occurrence {node!r} has no mesh triangles")
                continue
            count += 1
            points = trimesh.transform_points(mesh.vertices, transform)
            if not np.isfinite(points).all():
                issues.append(f"Occurrence {node!r} has nonfinite world coordinates")
                continue
            minimum = np.minimum(minimum, points.min(axis=0))
            maximum = np.maximum(maximum, points.max(axis=0))
        if np.isfinite(minimum).all() and np.isfinite(maximum).all():
            measured = np.concatenate((minimum, maximum))
            bounds = tuple(float(v) for v in measured)
            delta = tuple(float(v) for v in measured - expected)
            if np.any(np.abs(measured - expected) > tolerance):
                issues.append("Preview world bounds differ from STEP facts")
        else:
            issues.append("Preview has no finite mesh bounds")
    except Exception as exc:
        issues.append(f"Preview measurement failed: {exc}")
    if facts.occurrence_count is not None and count != facts.occurrence_count:
        issues.append(f"Expected {facts.occurrence_count} mesh occurrences, received {count}")
    return PreviewParityReport(not issues, facts, count, bounds, delta, tolerance, tuple(issues))
