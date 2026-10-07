"""Inspect saved STEP geometry with cadgen's current scene and geometry APIs."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path


def _xyz(vector) -> list[float]:
    return [float(vector.X), float(vector.Y), float(vector.Z)]


def _parse(argv: list[str]) -> tuple[Path, list[str]]:
    args = list(argv)
    if args and args[0] == "refs":
        args.pop(0)
    positional = [value for value in args if not value.startswith("--")]
    if not positional:
        raise ValueError("usage: python scripts/inspect refs <model.step> [refs...] --facts --planes --positioning")
    return Path(positional[0]), positional[1:]


def inspect_step(path: Path, requested_refs: list[str]) -> dict:
    from cadgen import read_scene
    from cadgen.geometry import topology_errors

    scene = read_scene(path)
    selections = [scene.resolve(ref) for ref in requested_refs] if requested_refs else list(scene.leaves())
    if not selections:
        raise ValueError(f"STEP has no geometry occurrences: {path}")

    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    solid_count = face_count = edge_count = topology_error_count = 0
    nonpositive_solids: list[str] = []
    topology: list[dict[str, object]] = []
    checked_prototypes: set[str] = set()
    rows: list[dict[str, object]] = []

    for selection in selections:
        shape = selection.shape()
        bounds = shape.bounding_box()
        lower, upper = _xyz(bounds.min), _xyz(bounds.max)
        minimum = [min(a, b) for a, b in zip(minimum, lower)]
        maximum = [max(a, b) for a, b in zip(maximum, upper)]
        solids = list(shape.solids())
        solid_count += len(solids)
        face_count += len(shape.faces())
        edge_count += len(shape.edges())
        ref = str(selection.ref)
        for index, solid in enumerate(solids, start=1):
            if not math.isfinite(float(solid.volume)) or float(solid.volume) <= 0:
                nonpositive_solids.append(f"{ref}.s{index}")

        prototype_id = str(getattr(selection, "prototype_id", "") or ref)
        if prototype_id not in checked_prototypes:
            checked_prototypes.add(prototype_id)
            for issue in topology_errors(shape):
                topology.append({"ref": ref, "code": str(issue.code)})
                topology_error_count += 1

        rows.append({
            "ref": ref,
            "label": str(getattr(selection, "label", "") or ""),
            "prototypeId": prototype_id,
            "bounds": {"min": lower, "max": upper},
            "solidCount": len(solids),
        })

    summary = {
        "bounds": {"min": minimum, "max": maximum},
        "occurrenceCount": len(selections),
        "shapeCount": len(selections),
        "solidCount": solid_count,
        "faceCount": face_count,
        "edgeCount": edge_count,
        "topologyErrorCount": topology_error_count,
        "nonpositiveSolidCount": len(nonpositive_solids),
        "documentHash": str(scene.document_hash),
        "inspectionApi": "cadgen.read_scene",
    }
    return {
        "ok": topology_error_count == 0 and not nonpositive_solids,
        "tokens": [{"summary": summary, "occurrences": rows}],
        "topologyErrors": topology,
        "nonpositiveSolids": nonpositive_solids,
    }


def main(argv: list[str] | None = None) -> int:
    try:
        path, requested_refs = _parse(list(sys.argv[1:] if argv is None else argv))
        if not path.is_file():
            raise FileNotFoundError(f"STEP not found: {path}")
        result = inspect_step(path, requested_refs)
        print(json.dumps(result, separators=(",", ":")))
        return 0 if result["ok"] else 1
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
