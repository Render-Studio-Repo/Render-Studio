"""Isolated STEP assembly and GLB conversion under the pinned CAD kernel."""

from __future__ import annotations

import json
from importlib.metadata import version
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile


def publish_with_pinned_runtime(request):
    from backend.services.skill_runner import resolve_cad_python

    with tempfile.TemporaryDirectory(prefix="vibecad-publish-") as temporary:
        request_path, result_path = Path(temporary) / "request.json", Path(temporary) / "result.json"
        request_path.write_text(json.dumps(request), encoding="utf-8")
        proc = subprocess.run(
            [resolve_cad_python(), "-I", str(Path(__file__).resolve()), str(request_path), str(result_path)],
            capture_output=True, text=True, timeout=300,
        )
        if proc.returncode or not result_path.is_file():
            raise RuntimeError("Complete VibeCAD assembly export failed: " + (proc.stderr or proc.stdout)[-3000:])
        return json.loads(result_path.read_text(encoding="utf-8"))


def publish_geometry(request):
    import numpy as np
    import trimesh
    from build123d import Compound, export_step, import_step
    from trimesh.visual.material import PBRMaterial

    runtime = {
        "python_executable": sys.executable, "python_version": sys.version.split()[0],
        "build123d_version": version("build123d"), "ocp_version": version("cadquery-ocp"),
        "linear_deflection_mm": 0.1, "angular_deflection_rad": 0.1,
    }
    if (runtime["build123d_version"], runtime["ocp_version"]) != ("0.11.1", "7.9.3.1.1"):
        raise RuntimeError("VibeCAD publication requires build123d 0.11.1 and cadquery-ocp 7.9.3.1.1")

    def valid_solids(shape, expected):
        solids = list(shape.solids())
        if not solids or (expected and len(solids) != expected) or not all(s.is_valid and s.volume > 0 for s in solids):
            raise RuntimeError(f"STEP round-trip validation failed: expected {expected} valid solids, received {len(solids)}")
        return solids

    def write_glb(shape, path, labels):
        scene = trimesh.Scene()
        for index, solid in enumerate(shape.solids()):
            vertices, triangles = solid.tessellate(0.1, 0.1)
            mesh = trimesh.Trimesh(
                vertices=np.asarray([tuple(vertex) for vertex in vertices]),
                faces=np.asarray(triangles), process=False,
            )
            if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
                raise RuntimeError("STEP tessellation produced no finite triangles")
            color = tuple(solid.color) if solid.color is not None else (0.55, 0.60, 0.66, 1.0)
            mesh.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(
                baseColorFactor=np.asarray(color), metallicFactor=0.15, roughnessFactor=0.55,
            ))
            name = str(labels[index] if index < len(labels) else solid.label or f"body_{index+1}")
            scene.add_geometry(mesh, node_name=f"{name}_{index+1}", geom_name=f"{name}_{index+1}")
        scene.export(str(path), file_type="glb")

    restored = []
    for item in request["outputs"]:
        shape = import_step(item["step_path"])
        expected = len(item.get("source_keys") or []) if request["assembly_only"] else 1
        valid_solids(shape, expected)
        shape.label = str(item["key"])
        restored.append(shape)
    primary_step = Path(request["primary_step"])
    primary_step.parent.mkdir(parents=True, exist_ok=True)
    if len(restored) == 1:
        shutil.copy2(request["outputs"][0]["step_path"], primary_step)
    elif not export_step(Compound(children=restored), str(primary_step)):
        raise RuntimeError("compound STEP write failed")
    final_shape = import_step(str(primary_step))
    valid_solids(final_shape, sum(len(shape.solids()) for shape in restored))
    labels = [name for item in request["outputs"] for name in (item.get("source_keys") or [item["key"]])]
    write_glb(final_shape, request["primary_glb"], labels)
    for index, part in enumerate(request["parts"]):
        shutil.copy2(request["outputs"][index]["step_path"], part["step"])
        write_glb(restored[index], part["glb"], [request["outputs"][index]["key"]])
    return {"publication_runtime_provenance": runtime, "preview_occurrence_count": len(final_shape.solids())}


if __name__ == "__main__":
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    Path(sys.argv[2]).write_text(json.dumps(publish_geometry(request)), encoding="utf-8")
