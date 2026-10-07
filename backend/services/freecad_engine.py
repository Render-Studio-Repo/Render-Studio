"""FreeCAD headless engine for Render Studio.

Locates a FreeCAD.app / FreeCADCmd binary (vendored under ``vendor/freecad`` or
system install) and runs Part/PartDesign Python macros that export STEP + GLB.

Used by:
- VibeCAD AI generation (``mode=vibecad``)
- Create primitives (Box / Cylinder / …) — FreeCAD-only, no FeatureProgram kernel
- Extrude / Pad / Pocket (face press-pull and sketch-profile) via FreeCAD Part
"""

from __future__ import annotations

import inspect
import json
import logging
import math
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


def imported_step_unit_scale(diag: float, likely_small_hardware: bool = False) -> float:
    """Return a multiplier so an imported solid's bounding diagonal is millimetres.

    Jake cadgen and VibeCAD author in millimetres. McMaster / STEP.parts files
    sometimes arrive as metres (glTF-style) or inches. Fasteners are typically
    3–30 mm; a 13 mm screw that imports as 0.013 is metres, as 0.51 is inches.
    Machine parts (brackets, chassis) in metres are 0.05–2.5; already-mm CAD
    (50 mm, 356 mm, …) stays 1.0.
    """
    try:
        extent = float(diag)
    except (TypeError, ValueError):
        return 1.0
    if extent <= 0:
        return 1.0
    if likely_small_hardware:
        if 0.0005 <= extent < 0.08:
            return 1000.0
        if 0.08 <= extent < 4.0:
            return 25.4
        return 1.0
    # 0.5 mm–2.5 m stored as metres (includes 80–400 mm brackets that used to
    # miss the old <0.08 cut-off). Already-mm solids are >= ~3 mm.
    if 0.0005 <= extent <= 2.5:
        return 1000.0
    return 1.0


def collect_macro_export_shapes(result, doc_objects, input_object_names=None):
    """Shapes to publish from a FreeCAD macro.

    Prefer the authored ``result`` dict (VibeCAD worker contract). Empty result
    falls back to document solids that were **not** staged as unplaced inputs —
    imported McMaster hardware stays a reference, not a pile at the origin.
    """
    input_names = {str(n) for n in (input_object_names or ())}
    shapes = []
    names = []
    if isinstance(result, dict) and result:
        for key, val in result.items():
            names.append(str(key))
            shape = None
            if hasattr(val, "Shape"):
                shape = val.Shape
            elif hasattr(val, "isNull"):
                shape = val
            if shape is None or shape.isNull():
                raise RuntimeError(f"result[{key!r}] is not a FreeCAD Shape / object with Shape")
            shapes.append(shape)
        return shapes, names
    for obj in list(doc_objects or []):
        obj_name = str(getattr(obj, "Name", None) or getattr(obj, "Label", None) or "Part")
        if obj_name in input_names:
            continue
        shape = getattr(obj, "Shape", None)
        if shape is None or shape.isNull() or not getattr(shape, "Solids", None):
            continue
        shapes.append(shape)
        names.append(str(getattr(obj, "Label", None) or obj_name))
    return shapes, names


CancelCb = Optional[Callable[[], bool]]

_VENDOR_APP = (
    Path(__file__).resolve().parents[2] / "vendor" / "freecad" / "FreeCAD.app"
)


def freecad_cmd_candidates() -> list[Path]:
    """Ordered search paths for FreeCADCmd."""
    env = os.environ.get("FREECADCMD") or os.environ.get("FREECAD_CMD")
    paths: list[Path] = []
    if env:
        paths.append(Path(env))
    paths.extend(
        [
            _VENDOR_APP / "Contents" / "Resources" / "bin" / "freecadcmd",
            _VENDOR_APP / "Contents" / "Resources" / "bin" / "FreeCADCmd",
            _VENDOR_APP / "Contents" / "MacOS" / "FreeCADCmd",
            _VENDOR_APP / "Contents" / "MacOS" / "FreeCAD",
            Path("/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd"),
            Path("/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd"),
            Path("/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd"),
            Path("/usr/bin/freecadcmd"),
            Path("/usr/local/bin/freecadcmd"),
            Path("/opt/homebrew/bin/freecadcmd"),
        ]
    )
    which = shutil.which("FreeCADCmd") or shutil.which("freecadcmd")
    if which:
        paths.append(Path(which))
    # De-dupe while preserving order
    seen: set[str] = set()
    out: list[Path] = []
    for p in paths:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def find_freecad_cmd() -> Path | None:
    for p in freecad_cmd_candidates():
        if p.is_file() and os.access(p, os.X_OK):
            return p
    return None


def freecad_available() -> bool:
    return find_freecad_cmd() is not None


def freecad_status() -> dict[str, Any]:
    cmd = find_freecad_cmd()
    return {
        "available": bool(cmd),
        "cmd": str(cmd) if cmd else None,
        "vendor_app": str(_VENDOR_APP),
        "vendor_app_exists": _VENDOR_APP.is_dir(),
    }


_RUNNER_TEMPLATE = r'''# FreeCADCmd headless runner — generated by Render Studio
import json
import sys
import traceback
from pathlib import Path

# %%SCALE_HELPER%%
# %%EXPORT_HELPER%%

# FreeCADCmd argv: [freecadcmd, this_script, request.json, result.json]
REQ = Path(sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
RES = Path(sys.argv[3] if len(sys.argv) > 3 else "result.json")
request = json.loads(REQ.read_text(encoding="utf-8"))
out = {"ok": False, "error": "not started"}

try:
    import FreeCAD as App
    import Part

    source = str(request.get("source") or "")
    parameters = request.get("parameters") if isinstance(request.get("parameters"), dict) else {}
    expected = [str(x) for x in (request.get("expected_outputs") or []) if str(x).strip()]
    step_path = Path(request["step_path"])
    step_path.parent.mkdir(parents=True, exist_ok=True)

    doc = App.newDocument("RenderStudioVibeCAD")
    try:
        import Import as FCImport
    except Exception:
        FCImport = None

    inputs = {}
    input_object_names = []
    raw_inputs = request.get("inputs") if isinstance(request.get("inputs"), dict) else {}
    for alias, spec in raw_inputs.items():
        hardware = False
        if isinstance(spec, dict):
            rel = str(spec.get("path") or spec.get("file") or "")
            hardware = bool(spec.get("hardware"))
        else:
            rel = str(spec or "")
        src = Path(rel)
        if not src.is_file():
            src = Path.cwd() / rel
        if not src.is_file():
            continue
        before = list(doc.Objects)
        imported = False
        if FCImport is not None:
            try:
                FCImport.insert(str(src), doc.Name)
                imported = True
            except Exception:
                imported = False
        if not imported:
            Part.insert(str(src), doc.Name)
        obj = None
        shape = None
        for candidate in reversed([o for o in doc.Objects if o not in before]):
            sh = getattr(candidate, "Shape", None)
            if sh is not None and not sh.isNull():
                obj = candidate
                shape = sh
                break
        if shape is None:
            continue
        bb = shape.BoundBox
        diag = max(float(bb.XLength), float(bb.YLength), float(bb.ZLength))
        factor = imported_step_unit_scale(diag, hardware)
        if abs(factor - 1.0) > 1e-9:
            try:
                scaled = shape.copy()
                scaled.scale(factor)
                shape = scaled
                if obj is not None:
                    obj.Shape = scaled
            except Exception:
                pass
        inputs[str(alias)] = obj if obj is not None else shape
        if obj is not None:
            input_object_names.append(str(getattr(obj, "Name", "") or ""))

    # Expose params + staged catalog STEPs + result sink to the authored macro.
    params = parameters
    result = {}
    doc_name = doc.Name
    g = {
        "__name__": "__main__",
        "App": App,
        "FreeCAD": App,
        "Part": Part,
        "params": params,
        "result": result,
        "inputs": inputs,
        "doc": doc,
    }
    try:
        import PartDesign
        g["PartDesign"] = PartDesign
    except Exception:
        pass
    try:
        import Sketcher
        g["Sketcher"] = Sketcher
    except Exception:
        pass

    exec(compile(source, "<freecad_macro>", "exec"), g, g)
    result = g.get("result") or result
    doc.recompute()

    shapes, names = collect_macro_export_shapes(result, list(doc.Objects), input_object_names)

    if not shapes:
        raise RuntimeError("FreeCAD macro produced no solid shapes (assign result dict or create Part objects)")

    if expected and names and [n for n in expected if n not in names]:
        # Soft check — still export what we have
        pass

    compound = shapes[0] if len(shapes) == 1 else Part.makeCompound(shapes)
    compound.exportStep(str(step_path))
    facts = []
    for name, shape in zip(names or [f"Part{i}" for i in range(len(shapes))], shapes):
        box = shape.BoundBox
        facts.append({
            "name": name,
            "solids": len(shape.Solids),
            "volume_mm3": float(shape.Volume),
            "bbox": {
                "min": [float(box.XMin), float(box.YMin), float(box.ZMin)],
                "max": [float(box.XMax), float(box.YMax), float(box.ZMax)],
            },
        })
    out = {
        "ok": True,
        "step_path": str(step_path),
        "parts": facts,
        "engine": "freecad",
    }
    try:
        App.closeDocument(doc.Name)
    except Exception:
        pass
except Exception as exc:
    out = {
        "ok": False,
        "error": str(exc),
        "traceback": traceback.format_exc()[-4000:],
        "engine": "freecad",
    }

RES.write_text(json.dumps(out, indent=2), encoding="utf-8")
'''


def run_freecad_macro(
    *,
    project_path: Path,
    stem: str,
    source: str,
    parameters: dict[str, Any] | None = None,
    expected_outputs: list[str] | None = None,
    inputs: dict[str, Any] | None = None,
    cancel_check: CancelCb = None,
    timeout_sec: float = 300.0,
) -> dict[str, Any]:
    """Execute a FreeCAD Python macro headless and export STEP."""
    cmd = find_freecad_cmd()
    if not cmd:
        raise RuntimeError(
            "FreeCADCmd not found. Install FreeCAD.app under vendor/freecad "
            "or set FREECADCMD to the FreeCADCmd binary."
        )

    work = project_path / ".vibecad_work" / f"{stem}_freecad"
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    # Same as VibeCAD build123d: DXF lives in the project dir, worker cwd is isolated.
    for src in sorted(project_path.glob("*.dxf")):
        if not src.is_file():
            continue
        try:
            if src.stat().st_size > 40 * 1024 * 1024:
                continue
        except OSError:
            continue
        dest = work / src.name
        try:
            shutil.copy2(src, dest)
        except OSError:
            continue

    staged_inputs: dict[str, Any] = {}
    from backend.services.cad_service import looks_like_mcmaster_part_stem

    for alias, spec in (inputs or {}).items():
        key = str(alias or "").strip()
        if not key:
            continue
        if isinstance(spec, dict):
            src = Path(str(spec.get("path") or spec.get("file") or ""))
            hardware = bool(spec.get("hardware"))
        else:
            src = Path(str(spec or ""))
            hardware = False
        if not src.is_file():
            continue
        dest = work / src.name
        try:
            if dest.resolve() != src.resolve():
                shutil.copy2(src, dest)
        except OSError:
            continue
        if not hardware:
            hardware = looks_like_mcmaster_part_stem(src.stem) or looks_like_mcmaster_part_stem(
                key.replace("hw_", "", 1)
            )
        staged_inputs[key] = {"path": dest.name, "hardware": hardware}

    out_dir = work / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    step_path = out_dir / f"{stem}.step"
    req_path = work / "request.json"
    res_path = work / "result.json"
    runner_path = work / "runner.py"
    runner_path.write_text(
        _RUNNER_TEMPLATE.replace(
            "# %%SCALE_HELPER%%",
            inspect.getsource(imported_step_unit_scale).rstrip(),
        ).replace(
            "# %%EXPORT_HELPER%%",
            inspect.getsource(collect_macro_export_shapes).rstrip(),
        ),
        encoding="utf-8",
    )
    req_path.write_text(
        json.dumps(
            {
                "source": source,
                "parameters": parameters or {},
                "expected_outputs": expected_outputs or [],
                "step_path": str(step_path),
                "inputs": staged_inputs,
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )

    proc = subprocess.Popen(
        [str(cmd), str(runner_path), str(req_path), str(res_path)],
        cwd=str(work),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={
            **os.environ,
            # Headless / no GUI plugins
            "QT_QPA_PLATFORM": "offscreen",
        },
    )
    started = time.monotonic()
    try:
        while True:
            if cancel_check and cancel_check():
                proc.kill()
                raise RuntimeError("Generation canceled.")
            if proc.poll() is not None:
                break
            if time.monotonic() - started > timeout_sec:
                proc.kill()
                raise RuntimeError("FreeCADCmd timed out")
            time.sleep(0.2)
        stdout, stderr = proc.communicate(timeout=5)
    except RuntimeError:
        raise
    except Exception:
        proc.kill()
        raise

    payload: dict[str, Any] = {}
    if res_path.is_file():
        try:
            payload = json.loads(res_path.read_text(encoding="utf-8"))
        except Exception as exc:
            payload = {"ok": False, "error": f"could not parse FreeCAD result: {exc}"}
    if not payload:
        payload = {
            "ok": False,
            "error": f"FreeCADCmd exited {proc.returncode}",
            "stdout": (stdout or "")[-2000:],
            "stderr": (stderr or "")[-2000:],
        }
    payload["_work_dir"] = str(work)
    payload["_cmd"] = str(cmd)
    if payload.get("ok") and step_path.is_file():
        payload["step_path"] = str(step_path)
        payload["outputs"] = {
            "compound": str(step_path),
            **{
                str(p.get("name") or f"Part{i}"): str(step_path)
                for i, p in enumerate(payload.get("parts") or [])
            },
        }
    return payload


def _f(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def build_primitive_macro(op: str, *, at: list[float], **dims: Any) -> str:
    """Deterministic FreeCAD Part macro for Create primitives (mm, center at ``at``).

    FreeCAD ``Part.makeBox/Cylinder/...`` use corner/base origins; we offset so the
    solid center matches the viewport ghost (same convention as the old kernel).
    """
    op_l = str(op or "").strip().lower()
    ax, ay, az = (_f(at[0]) if len(at) > 0 else 0.0, _f(at[1]) if len(at) > 1 else 0.0, _f(at[2]) if len(at) > 2 else 0.0)
    if op_l == "box":
        length, width, height = _f(dims.get("length")), _f(dims.get("width")), _f(dims.get("height"))
        return f"""# Render Studio Create · box (FreeCAD Part)
import Part
L, W, H = {length!r}, {width!r}, {height!r}
ax, ay, az = {ax!r}, {ay!r}, {az!r}
shape = Part.makeBox(L, W, H)
shape.translate(App.Vector(ax - L / 2.0, ay - W / 2.0, az - H / 2.0))
obj = doc.addObject("Part::Feature", "Box")
obj.Label = "Box"
obj.Shape = shape
result["Part"] = obj
"""
    if op_l == "cylinder":
        radius, height = _f(dims.get("radius")), _f(dims.get("height"))
        return f"""# Render Studio Create · cylinder (FreeCAD Part)
import Part
R, H = {radius!r}, {height!r}
ax, ay, az = {ax!r}, {ay!r}, {az!r}
shape = Part.makeCylinder(R, H)
shape.translate(App.Vector(ax, ay, az - H / 2.0))
obj = doc.addObject("Part::Feature", "Cylinder")
obj.Label = "Cylinder"
obj.Shape = shape
result["Part"] = obj
"""
    if op_l == "sphere":
        radius = _f(dims.get("radius"))
        return f"""# Render Studio Create · sphere (FreeCAD Part)
import Part
R = {radius!r}
ax, ay, az = {ax!r}, {ay!r}, {az!r}
shape = Part.makeSphere(R)
shape.translate(App.Vector(ax, ay, az))
obj = doc.addObject("Part::Feature", "Sphere")
obj.Label = "Sphere"
obj.Shape = shape
result["Part"] = obj
"""
    if op_l == "cone":
        br = dims.get("bottom_radius")
        if br is None:
            br = dims.get("radius")
        bottom, top, height = _f(br), _f(dims.get("top_radius")), _f(dims.get("height"))
        return f"""# Render Studio Create · cone (FreeCAD Part)
import Part
R1, R2, H = {bottom!r}, {top!r}, {height!r}
ax, ay, az = {ax!r}, {ay!r}, {az!r}
shape = Part.makeCone(R1, R2, H)
shape.translate(App.Vector(ax, ay, az - H / 2.0))
obj = doc.addObject("Part::Feature", "Cone")
obj.Label = "Cone"
obj.Shape = shape
result["Part"] = obj
"""
    if op_l == "torus":
        major, minor = _f(dims.get("major_radius")), _f(dims.get("minor_radius"))
        return f"""# Render Studio Create · torus (FreeCAD Part)
import Part
R, r = {major!r}, {minor!r}
ax, ay, az = {ax!r}, {ay!r}, {az!r}
shape = Part.makeTorus(R, r)
shape.translate(App.Vector(ax, ay, az))
obj = doc.addObject("Part::Feature", "Torus")
obj.Label = "Torus"
obj.Shape = shape
result["Part"] = obj
"""
    raise ValueError(f"Unsupported FreeCAD primitive '{op}'")


def publish_step_to_project(
    project_path: Path,
    stem: str,
    step_path: Path,
    *,
    source: str | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Copy STEP into the project, tessellate GLB, write FreeCAD sidecars."""
    from backend.services import cad_service

    stem = str(stem or "part").strip() or "part"
    compound_step = project_path / f"{stem}.step"
    glb_path = project_path / f"{stem}.glb"
    shutil.copy2(step_path, compound_step)
    try:
        cad_service.tessellate_step_to_glb(compound_step, glb_path, force=True)
    except Exception:
        import trimesh

        scene = trimesh.load(str(compound_step), force="scene")
        if isinstance(scene, trimesh.Scene):
            mesh = trimesh.util.concatenate(tuple(scene.geometry.values()))
        else:
            mesh = scene
        mesh.export(str(glb_path))

    source_name = f"{stem}.freecad.py"
    if source:
        (project_path / source_name).write_text(source.rstrip() + "\n", encoding="utf-8")
    meta_path = project_path / f"{stem}.freecad.json"
    meta_path.write_text(
        json.dumps(
            {
                "engine": "freecad",
                "stem": stem,
                **(meta or {}),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return {
        "primary": glb_path.name,
        "glb": glb_path.name,
        "step": compound_step.name,
        "source": source_name if source else None,
        "meta": meta_path.name,
        "engine": "freecad",
    }


def create_primitive_solid(
    *,
    project_path: Path,
    stem: str,
    op: str,
    at: list[float] | None = None,
    cancel_check: CancelCb = None,
    timeout_sec: float = 120.0,
    extra_meta: dict[str, Any] | None = None,
    **dims: Any,
) -> dict[str, Any]:
    """Create a parametric solid with FreeCADCmd and publish STEP+GLB into the project.

    Raises RuntimeError when FreeCADCmd is missing or the macro fails — callers must
    not fall back to the old FeatureProgram / mesh kernel.
    """
    if not freecad_available():
        raise RuntimeError(
            "FreeCADCmd is required for Create. Install FreeCAD under vendor/freecad "
            "or set FREECADCMD."
        )
    at_list = [float(v) for v in (at or [0.0, 0.0, 0.0])[:3]]
    while len(at_list) < 3:
        at_list.append(0.0)
    source = build_primitive_macro(op, at=at_list, **dims)
    result = run_freecad_macro(
        project_path=project_path,
        stem=stem,
        source=source,
        parameters={},
        expected_outputs=["Part"],
        cancel_check=cancel_check,
        timeout_sec=timeout_sec,
    ) or {}
    if not result.get("ok"):
        err = str(result.get("error") or "FreeCAD create failed")
        tb = str(result.get("traceback") or "")
        raise RuntimeError(err + (f"\n{tb[:2000]}" if tb else ""))
    step_path = Path(str(result.get("step_path") or ""))
    if not step_path.is_file():
        raise RuntimeError("FreeCAD create produced no STEP file")
    published = publish_step_to_project(
        project_path,
        stem,
        step_path,
        source=source,
        meta={
            "op": str(op).lower(),
            "at": at_list,
            "dims": {k: dims[k] for k in dims},
            **(extra_meta or {}),
        },
    )
    published["parts"] = result.get("parts") or []
    published["ok"] = True
    return published


def _step_name_candidates(project_path: Path, stem: str) -> list[Path]:
    return [
        project_path / f"{stem}.step",
        project_path / f"{stem}.stp",
        project_path / f"{stem}.STEP",
        project_path / f"{stem}.STP",
    ]


def resolve_project_step(project_path: Path, filename: str) -> Path | None:
    """Resolve a B-rep STEP sibling for a viewport GLB / edited mesh name."""
    original = Path(filename).stem
    # Prefer the STEP that belongs to this exact file (foo_edited.step after a
    # gizmo bake) so Pad/Pocket and later moves do not snap back to the original.
    for candidate in _step_name_candidates(project_path, original):
        if candidate.is_file():
            return candidate
    # foo.glb still has foo.step on disk; after a gizmo bake the moved kernel
    # may only exist as foo_edited.step until the original is overwritten.
    if not original.endswith("_edited"):
        for candidate in _step_name_candidates(project_path, f"{original}_edited"):
            if candidate.is_file():
                return candidate
    stem = original
    for suffix in (
        "_filleted",
        "_chamfered",
        "_pulled",
        "_mirrored",
        "_body",
        "_edited",
        "_extruded",
    ):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
    if stem != original:
        for candidate in _step_name_candidates(project_path, stem):
            if candidate.is_file():
                return candidate
    return None


def _mesh_face_hint(
    mesh_path: Path,
    face_index: int,
    normal: list[float] | None = None,
) -> dict[str, Any]:
    """Approximate face center/normal from the tessellated GLB for STEP matching."""
    import numpy as np
    import trimesh

    mesh = trimesh.load(str(mesh_path), force="mesh")
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(tuple(mesh.geometry.values()))
    faces = getattr(mesh, "faces", None)
    if faces is None or face_index < 0 or face_index >= len(faces):
        raise ValueError(f"face_index {face_index} out of range for {mesh_path.name}")
    tri = mesh.vertices[faces[face_index]]
    center = [float(x) for x in np.mean(tri, axis=0)]
    if normal and len(normal) >= 3:
        n = [float(normal[0]), float(normal[1]), float(normal[2])]
    else:
        n = [float(x) for x in mesh.face_normals[face_index]]
    length = (n[0] ** 2 + n[1] ** 2 + n[2] ** 2) ** 0.5 or 1.0
    n = [n[0] / length, n[1] / length, n[2] / length]
    return {"center": center, "normal": n}


def _pad_boolean_mode(op: str, distance_mm: float) -> str:
    op_l = str(op or "auto").strip().lower()
    if op_l in {"cut", "pocket"}:
        return "cut"
    if op_l in {"join", "pad", "add"}:
        return "join"
    if op_l in {"new_body", "new"}:
        return "new_body"
    if op_l == "intersect":
        return "intersect"
    if float(distance_mm) < 0:
        return "cut"
    return "join"


def _normalize_face_hints(
    *,
    center: list[float] | None,
    normal: list[float] | None,
    hints: list[dict[str, Any]] | None,
) -> list[dict[str, float]]:
    raw = list(hints or [])
    if not raw and center is not None:
        raw = [{"center": center, "normal": normal or [0.0, 0.0, 1.0]}]
    out: list[dict[str, float]] = []
    for item in raw:
        c = item.get("center") or [0.0, 0.0, 0.0]
        n = item.get("normal") or [0.0, 0.0, 1.0]
        cx, cy, cz = _f(c[0] if len(c) > 0 else 0.0), _f(c[1] if len(c) > 1 else 0.0), _f(c[2] if len(c) > 2 else 0.0)
        nx, ny, nz = _f(n[0] if len(n) > 0 else 0.0), _f(n[1] if len(n) > 1 else 0.0), _f(n[2] if len(n) > 2 else 1.0)
        length = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
        out.append({
            "cx": cx,
            "cy": cy,
            "cz": cz,
            "nx": nx / length,
            "ny": ny / length,
            "nz": nz / length,
        })
    if not out:
        raise ValueError("FreeCAD pad needs at least one face hint")
    return out


def build_face_pad_macro(
    *,
    step_in: Path,
    distance_mm: float,
    center: list[float] | None = None,
    normal: list[float] | None = None,
    op: str = "auto",
    hints: list[dict[str, Any]] | None = None,
    through_all: bool = False,
    direction: str = "one",
    distance2_mm: float = 0.0,
) -> str:
    """FreeCAD Part macro: find planar face(s) near center/normal, pad or pocket."""
    mode = _pad_boolean_mode(op, distance_mm)
    d1 = abs(float(distance_mm))
    d2 = abs(float(distance2_mm or 0.0))
    dir_l = str(direction or "one").strip().lower()
    if dir_l == "symmetric":
        d2 = d1
    elif dir_l != "two":
        d2 = 0.0
    hint_list = _normalize_face_hints(center=center, normal=normal, hints=hints)
    return f"""# Render Studio Extrude/Pad · FreeCAD Part (B-rep)
import Part
import math

step_in = {str(step_in)!r}
distance = {d1!r}
distance2 = {d2!r}
through_all = {bool(through_all)!r}
mode = {mode!r}
hints = {hint_list!r}

shape = Part.Shape()
shape.read(step_in)
if shape.isNull() or not shape.Solids:
    raise RuntimeError("FreeCAD pad: empty STEP solid")

bb = shape.BoundBox
span = max(float(bb.XLength), float(bb.YLength), float(bb.ZLength), 1.0) * 3.0 + 10.0
d_pos = span if through_all else distance
d_neg = span if through_all else distance2

def _match_face(cx, cy, cz, nx, ny, nz):
    best = None
    best_score = None
    target = App.Vector(cx, cy, cz)
    tn = App.Vector(nx, ny, nz)
    nlen = tn.Length or 1.0
    tn = App.Vector(tn.x / nlen, tn.y / nlen, tn.z / nlen)
    for face in shape.Faces:
        try:
            c = face.CenterOfMass
        except Exception:
            continue
        try:
            u0, u1, v0, v1 = face.ParameterRange
            nvec = face.normalAt(0.5 * (u0 + u1), 0.5 * (v0 + v1))
        except Exception:
            try:
                nvec = face.Surface.Axis
            except Exception:
                continue
        n = App.Vector(nvec)
        if n.Length < 1e-9:
            continue
        n.normalize()
        align = abs(n.dot(tn))
        dist = (c - target).Length
        score = dist - 40.0 * align
        if best_score is None or score < best_score:
            best_score = score
            best = face
    if best is None:
        raise RuntimeError("FreeCAD pad: no matching face for center/normal hint")
    return best

prisms = []
for h in hints:
    face = _match_face(h["cx"], h["cy"], h["cz"], h["nx"], h["ny"], h["nz"])
    pull = App.Vector(h["nx"], h["ny"], h["nz"])
    prism = None
    if d_pos > 1e-9:
        prism = face.extrude(pull * d_pos)
    if d_neg > 1e-9:
        back = face.extrude(pull * (-d_neg))
        prism = back if prism is None else prism.fuse(back)
    if prism is None or prism.isNull():
        raise RuntimeError("FreeCAD pad: extrude produced empty prism")
    prisms.append(prism)

tool = prisms[0]
for extra in prisms[1:]:
    tool = tool.fuse(extra)
if tool.isNull():
    raise RuntimeError("FreeCAD pad: combined prism empty")

if mode == "new_body":
    out_shape = tool
elif mode == "cut":
    out_shape = shape.cut(tool)
elif mode == "intersect":
    out_shape = shape.common(tool)
else:
    out_shape = shape.fuse(tool)
if out_shape.isNull() or not out_shape.Solids:
    raise RuntimeError("FreeCAD pad: boolean result empty")

obj = doc.addObject("Part::Feature", "Padded")
obj.Label = "Padded"
obj.Shape = out_shape.removeSplitter() if hasattr(out_shape, "removeSplitter") else out_shape
result["Part"] = obj
"""


def next_unique_stem(project_path: Path, base: str) -> str:
    """``box`` / ``box2`` style unique stem that does not collide with GLB or STEP."""
    stem = str(base or "part").strip() or "part"
    if not (project_path / f"{stem}.glb").is_file() and not (project_path / f"{stem}.step").is_file():
        return stem
    i = 2
    while (project_path / f"{stem}{i}.glb").is_file() or (project_path / f"{stem}{i}.step").is_file():
        i += 1
    return f"{stem}{i}"


def _kernel_face_hints(
    step_in: Path,
    *,
    kernel_face_index: int | None = None,
    kernel_face_indices: list[int] | None = None,
    center: list[float] | None = None,
    normal: list[float] | None = None,
) -> list[dict[str, Any]] | None:
    """Hints from FreeCAD/OCC faces — skip GLB triangle indices when we have B-rep identity."""
    if center is not None and len(center) >= 3 and normal is not None and len(normal) >= 3:
        return [{"center": [float(center[0]), float(center[1]), float(center[2])], "normal": list(normal)}]
    ids: list[int] = []
    for raw in list(kernel_face_indices or []):
        try:
            if int(raw) >= 0:
                ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    if kernel_face_index is not None and int(kernel_face_index) >= 0 and int(kernel_face_index) not in ids:
        ids.insert(0, int(kernel_face_index))
    if not ids:
        return None
    from backend.services.freecad_transform import list_kernel_topology

    faces = list((list_kernel_topology(step_in) or {}).get("faces") or [])
    hints: list[dict[str, Any]] = []
    for idx in ids:
        face = next((item for item in faces if int(item.get("index")) == idx), None)
        if face is None and 0 <= idx < len(faces):
            face = faces[idx]
        if not face:
            raise ValueError(f"FreeCAD kernel face {idx} not found")
        hints.append({"center": list(face.get("center") or [0.0, 0.0, 0.0]), "normal": list(face.get("normal") or [0.0, 0.0, 1.0])})
    return hints or None


def apply_freecad_face_pad(
    *,
    project_path: Path,
    filename: str,
    face_index: int | None = None,
    face_indices: list[int] | None = None,
    kernel_face_index: int | None = None,
    kernel_face_indices: list[int] | None = None,
    center: list[float] | None = None,
    distance_mm: float,
    op: str = "auto",
    normal: list[float] | None = None,
    through_all: bool = False,
    direction: str = "one",
    distance2_mm: float = 0.0,
    cancel_check: CancelCb = None,
    timeout_sec: float = 180.0,
) -> dict[str, Any]:
    """Pad/Pocket a B-rep STEP via FreeCADCmd using a kernel face, else a mesh hint."""
    if not freecad_available():
        raise RuntimeError("FreeCADCmd is required for FreeCAD Pad/Extrude")
    step_in = resolve_project_step(project_path, filename)
    if not step_in:
        raise RuntimeError(f"No STEP sibling for FreeCAD pad: {filename}")
    hints = _kernel_face_hints(
        step_in,
        kernel_face_index=kernel_face_index,
        kernel_face_indices=kernel_face_indices,
        center=center,
        normal=normal,
    )
    indices: list[int] = []
    if hints:
        indices = list(kernel_face_indices or ([] if kernel_face_index is None else [int(kernel_face_index)]))
        if not indices:
            indices = [0]
    else:
        mesh_path = project_path / filename
        if not mesh_path.is_file():
            alt = project_path / f"{step_in.stem}.glb"
            if alt.is_file():
                mesh_path = alt
            else:
                raise RuntimeError(f"Mesh for face hint missing: {filename}")
        for i in list(face_indices or []):
            try:
                if int(i) >= 0:
                    indices.append(int(i))
            except (TypeError, ValueError):
                continue
        if not indices and face_index is not None and int(face_index) >= 0:
            indices = [int(face_index)]
        if not indices:
            raise ValueError("FreeCAD pad needs a kernel or mesh face")
        hints = [_mesh_face_hint(mesh_path, idx, normal=normal) for idx in indices]
    mode = _pad_boolean_mode(op, distance_mm)
    if mode == "new_body":
        stem = next_unique_stem(project_path, f"{step_in.stem}_body")
    else:
        stem = step_in.stem
    source = build_face_pad_macro(
        step_in=step_in,
        distance_mm=float(distance_mm),
        center=hints[0]["center"],
        normal=hints[0]["normal"],
        hints=hints,
        op=op,
        through_all=bool(through_all),
        direction=direction,
        distance2_mm=float(distance2_mm or 0.0),
    )
    result = run_freecad_macro(
        project_path=project_path,
        stem=stem,
        source=source,
        parameters={},
        expected_outputs=["Part"],
        cancel_check=cancel_check,
        timeout_sec=timeout_sec,
    ) or {}
    if not result.get("ok"):
        err = str(result.get("error") or "FreeCAD pad failed")
        tb = str(result.get("traceback") or "")
        raise RuntimeError(err + (f"\n{tb[:2000]}" if tb else ""))
    step_path = Path(str(result.get("step_path") or ""))
    if not step_path.is_file():
        raise RuntimeError("FreeCAD pad produced no STEP")
    published = publish_step_to_project(
        project_path,
        stem,
        step_path,
        source=source,
        meta={
            "op": "face_pad",
            "engine": "freecad",
            "parent": filename,
            "face_index": indices[0],
            "face_indices": indices,
            "distance_mm": float(distance_mm),
            "distance2_mm": float(distance2_mm or 0.0),
            "through_all": bool(through_all),
            "direction": str(direction or "one"),
            "boolean": mode,
            "normal": hints[0]["normal"],
            "center": hints[0]["center"],
            # Viewport edits keep the live STEP as source of truth (not a _pulled twin).
            # Jake .py is unchanged here; STEP+GLB are the document after Pad/Pocket.

        },
    )
    published["ok"] = True
    published["pipeline"] = "freecad"
    published["replace"] = mode != "new_body"
    published["feature"] = {
        "op": "pocket" if mode == "cut" else "pad",
        "distance_mm": float(distance_mm),
        "boolean": mode,
    }
    return published


def _unit3(vec: list[float], fallback: tuple[float, float, float] = (0.0, 0.0, 1.0)) -> list[float]:
    x = _f(vec[0] if len(vec) > 0 else fallback[0], fallback[0])
    y = _f(vec[1] if len(vec) > 1 else fallback[1], fallback[1])
    z = _f(vec[2] if len(vec) > 2 else fallback[2], fallback[2])
    length = (x * x + y * y + z * z) ** 0.5
    if length < 1e-12:
        return [float(fallback[0]), float(fallback[1]), float(fallback[2])]
    return [x / length, y / length, z / length]


def profile_points_world(
    profile: list[list[float]],
    *,
    plane: str = "XY",
    plane_ref: dict[str, Any] | None = None,
    at: list[float] | None = None,
) -> tuple[list[list[float]], list[float]]:
    """Map a 2D sketch profile to 3D millimetre points and an extrude direction."""
    pts2 = []
    for raw in profile or []:
        if not isinstance(raw, (list, tuple)) or len(raw) < 2:
            continue
        pts2.append([_f(raw[0]), _f(raw[1])])
    if len(pts2) < 3:
        raise ValueError("Extrude profile needs at least 3 points")
    at_x, at_y, at_z = 0.0, 0.0, 0.0
    if at and len(at) >= 3:
        at_x, at_y, at_z = _f(at[0]), _f(at[1]), _f(at[2])
    ring: list[list[float]] = []
    if isinstance(plane_ref, dict) and isinstance(plane_ref.get("origin"), (list, tuple)):
        origin = [_f(x) for x in list(plane_ref.get("origin") or [0, 0, 0])[:3]]
        while len(origin) < 3:
            origin.append(0.0)
        u_axis = _unit3(list(plane_ref.get("u_axis") or [1.0, 0.0, 0.0]), (1.0, 0.0, 0.0))
        if plane_ref.get("v_axis"):
            v_axis = _unit3(list(plane_ref.get("v_axis") or [0.0, 1.0, 0.0]), (0.0, 1.0, 0.0))
        else:
            ntmp = _unit3(list(plane_ref.get("normal") or [0.0, 0.0, 1.0]), (0.0, 0.0, 1.0))
            v_axis = [
                ntmp[1] * u_axis[2] - ntmp[2] * u_axis[1],
                ntmp[2] * u_axis[0] - ntmp[0] * u_axis[2],
                ntmp[0] * u_axis[1] - ntmp[1] * u_axis[0],
            ]
            v_axis = _unit3(v_axis, (0.0, 1.0, 0.0))
        direction = _unit3(list(plane_ref.get("normal") or [0.0, 0.0, 1.0]), (0.0, 0.0, 1.0))
        for u, v in pts2:
            ring.append([
                origin[0] + u * u_axis[0] + v * v_axis[0] + at_x,
                origin[1] + u * u_axis[1] + v * v_axis[1] + at_y,
                origin[2] + u * u_axis[2] + v * v_axis[2] + at_z,
            ])
        return ring, direction
    plane_l = str(plane or "XY").upper()
    if plane_l == "XZ":
        for u, v in pts2:
            ring.append([u + at_x, at_y, v + at_z])
        return ring, [0.0, 1.0, 0.0]
    if plane_l == "YZ":
        for u, v in pts2:
            ring.append([at_x, u + at_y, v + at_z])
        return ring, [1.0, 0.0, 0.0]
    for u, v in pts2:
        ring.append([u + at_x, v + at_y, at_z])
    return ring, [0.0, 0.0, 1.0]


def build_sketch_extrude_macro(
    *,
    ring: list[list[float]],
    direction: list[float],
    height_mm: float,
    combine: str = "new",
    step_in: Path | None = None,
) -> str:
    """FreeCAD Part macro: extrude a closed 3D profile; optionally fuse/cut an existing STEP."""
    mode = str(combine or "new").strip().lower()
    if mode in {"add", "join", "pad"}:
        mode = "join"
    elif mode in {"cut", "pocket"}:
        mode = "cut"
    elif mode == "intersect":
        mode = "intersect"
    else:
        mode = "new"
    height = abs(float(height_mm))
    dx, dy, dz = _unit3(direction, (0.0, 0.0, 1.0))
    step_lit = str(step_in) if step_in else ""
    return f"""# Render Studio Extrude · FreeCAD Part (sketch / profile)
import Part

ring = {ring!r}
dx, dy, dz = {dx!r}, {dy!r}, {dz!r}
height = {height!r}
mode = {mode!r}
step_in = {step_lit!r}

pts = [App.Vector(float(p[0]), float(p[1]), float(p[2])) for p in ring]
if len(pts) < 3:
    raise RuntimeError("FreeCAD extrude: profile needs at least 3 points")
if pts[0].distanceToPoint(pts[-1]) > 1e-7:
    pts.append(pts[0])
wire = Part.makePolygon(pts)
face = Part.Face(wire)
if face.isNull() or float(getattr(face, "Area", 0.0) or 0.0) <= 1e-12:
    raise RuntimeError("FreeCAD extrude: profile is not a valid planar face")
prism = face.extrude(App.Vector(dx, dy, dz) * height)
if prism.isNull() or not prism.Solids:
    raise RuntimeError("FreeCAD extrude: empty solid")

if mode == "new" or not step_in:
    out_shape = prism
else:
    shape = Part.Shape()
    shape.read(step_in)
    if shape.isNull() or not shape.Solids:
        raise RuntimeError("FreeCAD extrude: empty STEP solid")
    if mode == "cut":
        out_shape = shape.cut(prism)
    elif mode == "intersect":
        out_shape = shape.common(prism)
    else:
        out_shape = shape.fuse(prism)
    if out_shape.isNull() or not out_shape.Solids:
        raise RuntimeError("FreeCAD extrude: boolean result empty")
    if hasattr(out_shape, "removeSplitter"):
        out_shape = out_shape.removeSplitter()

obj = doc.addObject("Part::Feature", "Extrude")
obj.Label = "Extrude"
obj.Shape = out_shape
result["Part"] = obj
"""


def apply_freecad_sketch_extrude(
    *,
    project_path: Path,
    profile: list[list[float]],
    height_mm: float,
    combine: str = "new",
    plane: str = "XY",
    plane_ref: dict[str, Any] | None = None,
    at: list[float] | None = None,
    base_filename: str | None = None,
    cancel_check: CancelCb = None,
    timeout_sec: float = 180.0,
) -> dict[str, Any]:
    """Extrude a 2D profile with FreeCADCmd (new solid, or join/cut an existing STEP)."""
    if not freecad_available():
        raise RuntimeError(
            "FreeCADCmd is required for Extrude. Install FreeCAD under vendor/freecad "
            "or set FREECADCMD."
        )
    height = float(height_mm)
    if not (height > 0):
        raise ValueError("Extrude height must be > 0")
    ring, direction = profile_points_world(profile, plane=plane, plane_ref=plane_ref, at=at)
    mode = str(combine or "new").strip().lower()
    if mode in {"add", "join", "pad"}:
        mode = "join"
    elif mode in {"cut", "pocket"}:
        mode = "cut"
    elif mode == "intersect":
        mode = "intersect"
    else:
        mode = "new"
    step_in = None
    if mode != "new":
        if not base_filename:
            raise ValueError("Join/Cut extrude needs an existing FreeCAD solid selected.")
        step_in = resolve_project_step(project_path, base_filename)
        if not step_in:
            raise RuntimeError(
                f"No STEP sibling for FreeCAD extrude: {base_filename}. "
                "Create or generate a CAD solid first."
            )
        stem = step_in.stem
    else:
        stem = next_unique_stem(project_path, "extrude")
    source = build_sketch_extrude_macro(
        ring=ring,
        direction=direction,
        height_mm=height,
        combine=mode,
        step_in=step_in,
    )
    result = run_freecad_macro(
        project_path=project_path,
        stem=stem,
        source=source,
        parameters={},
        expected_outputs=["Part"],
        cancel_check=cancel_check,
        timeout_sec=timeout_sec,
    ) or {}
    if not result.get("ok"):
        err = str(result.get("error") or "FreeCAD extrude failed")
        tb = str(result.get("traceback") or "")
        raise RuntimeError(err + (f"\n{tb[:2000]}" if tb else ""))
    step_path = Path(str(result.get("step_path") or ""))
    if not step_path.is_file():
        raise RuntimeError("FreeCAD extrude produced no STEP")
    published = publish_step_to_project(
        project_path,
        stem,
        step_path,
        source=source,
        meta={
            "op": "extrude",
            "engine": "freecad",
            "combine": mode,
            "height_mm": height,
            "plane": plane,
            "parent": base_filename if mode != "new" else None,
        },
    )
    published["ok"] = True
    published["pipeline"] = "freecad"
    published["replace"] = mode != "new"
    published["feature"] = {"op": "extrude", "combine": mode, "height_mm": height}
    return published


MAX_ASSEMBLY_MERGE_BYTES = 8 * 1024 * 1024
PLACE_GAP_MM = 20.0

_PLACE_RUNNER_TEMPLATE = r"""
import json, math, sys, traceback
from pathlib import Path

REQ = Path(sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
RES = Path(sys.argv[3] if len(sys.argv) > 3 else "result.json")
request = json.loads(REQ.read_text(encoding="utf-8"))
out = {"ok": False}


def load_shape(doc, path):
    import Part
    try:
        import Import as FCImport
    except Exception:
        FCImport = None
    before = list(doc.Objects)
    imported = False
    if FCImport is not None:
        try:
            FCImport.insert(str(path), doc.Name)
            imported = True
        except Exception:
            imported = False
    if not imported:
        Part.insert(str(path), doc.Name)
    shapes = []
    for obj in doc.Objects:
        if obj in before:
            continue
        sh = getattr(obj, "Shape", None)
        if sh is None or sh.isNull():
            continue
        # STEP imports can include container Features whose empty BoundBox uses
        # FreeCAD's +/-1e100 sentinel.  Compounding one of those with real
        # geometry makes the placement jump to 2e100 and disappear in viewers.
        # Publish only actual solids with finite, ordered bounds.
        for solid in list(getattr(sh, "Solids", []) or []):
            bb = solid.BoundBox
            vals = [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax]
            if (all(math.isfinite(float(v)) and abs(float(v)) < 1e12 for v in vals)
                    and bb.XMin <= bb.XMax and bb.YMin <= bb.YMax and bb.ZMin <= bb.ZMax
                    and float(getattr(solid, "Volume", 0.0)) > 1e-12):
                shapes.append(solid.copy())
    if not shapes:
        raise RuntimeError("no solids in %s" % path)
    return Part.makeCompound(shapes) if len(shapes) > 1 else shapes[0]


def checked_bbox(shape, label):
    bb = shape.BoundBox
    vals = [float(bb.XMin), float(bb.YMin), float(bb.ZMin),
            float(bb.XMax), float(bb.YMax), float(bb.ZMax)]
    if (not all(math.isfinite(v) and abs(v) < 1e12 for v in vals)
            or vals[0] > vals[3] or vals[1] > vals[4] or vals[2] > vals[5]):
        raise RuntimeError("invalid %s bounds: %r" % (label, vals))
    return bb


try:
    import FreeCAD as App
    import Part

    existing_path = Path(request["existing_step"])
    new_path = Path(request["new_step"])
    gap = float(request.get("gap_mm") or 20.0)
    merge = bool(request.get("merge"))
    existing_out = Path(request["existing_out"])
    new_out = Path(request["new_out"])
    doc = App.newDocument("PlacePart")
    existing = load_shape(doc, existing_path)
    new_shape = load_shape(doc, new_path)
    ebb = checked_bbox(existing, "existing")
    nbb = checked_bbox(new_shape, "new")
    desired_xmin = float(ebb.XMax) + gap
    dx = desired_xmin - float(nbb.XMin)
    if abs(dx) < 2.0:
        dx = 0.0
    if abs(dx) > 1e-6:
        new_shape.translate(App.Vector(dx, 0.0, 0.0))
    new_out.parent.mkdir(parents=True, exist_ok=True)
    new_shape.exportStep(str(new_out))
    merged = False
    if merge:
        compound = Part.makeCompound([existing, new_shape])
        existing_out.parent.mkdir(parents=True, exist_ok=True)
        compound.exportStep(str(existing_out))
        merged = True
    nbb2 = checked_bbox(new_shape, "placed new")
    ebb2 = checked_bbox(existing, "existing")
    out = {
        "ok": True,
        "translation": [float(dx), 0.0, 0.0],
        "merged": merged,
        "existing_bbox": [float(ebb2.XMin), float(ebb2.YMin), float(ebb2.ZMin), float(ebb2.XMax), float(ebb2.YMax), float(ebb2.ZMax)],
        "new_bbox": [float(nbb2.XMin), float(nbb2.YMin), float(nbb2.ZMin), float(nbb2.XMax), float(nbb2.YMax), float(nbb2.ZMax)],
    }
    App.closeDocument(doc.Name)
except Exception as exc:
    out = {"ok": False, "error": "%s\n%s" % (exc, traceback.format_exc())}
RES.write_text(json.dumps(out), encoding="utf-8")
"""


def place_offset_mm(
    existing_bbox: tuple[float, float, float, float, float, float],
    new_bbox: tuple[float, float, float, float, float, float],
    gap_mm: float = PLACE_GAP_MM,
) -> tuple[float, float, float]:
    """Translate so the new solid sits just past the existing AABB on +X."""
    existing = tuple(float(v) for v in existing_bbox)
    new = tuple(float(v) for v in new_bbox)
    gap = float(gap_mm)
    if len(existing) != 6 or len(new) != 6:
        raise ValueError("placement bounds must each contain six coordinates")
    if not all(math.isfinite(v) and abs(v) < 1e12 for v in (*existing, *new, gap)):
        raise ValueError("placement bounds and gap must be finite CAD coordinates")
    if existing[0] > existing[3] or existing[1] > existing[4] or existing[2] > existing[5]:
        raise ValueError("existing placement bounds are inverted")
    if new[0] > new[3] or new[1] > new[4] or new[2] > new[5]:
        raise ValueError("new placement bounds are inverted")
    dx = existing[3] + gap - new[0]
    if abs(dx) < 2.0:
        dx = 0.0
    return (dx, 0.0, 0.0)


def _valid_place_meta(payload: object) -> bool:
    """Only trust placement receipts that describe finite, usable CAD bounds."""
    if not isinstance(payload, dict) or not payload.get("ok"):
        return False
    translation = payload.get("translation")
    if not isinstance(translation, (list, tuple)) or len(translation) != 3:
        return False
    try:
        values = [float(value) for value in translation]
    except (TypeError, ValueError):
        return False
    if not all(math.isfinite(value) and abs(value) < 1e12 for value in values):
        return False
    for key in ("existing_bbox", "new_bbox"):
        bounds = payload.get(key)
        if bounds is None:
            continue  # Backward-compatible with receipts written before bounds were recorded.
        if not isinstance(bounds, (list, tuple)) or len(bounds) != 6:
            return False
        try:
            coords = tuple(float(value) for value in bounds)
        except (TypeError, ValueError):
            return False
        if not all(math.isfinite(value) and abs(value) < 1e12 for value in coords):
            return False
        if coords[0] > coords[3] or coords[1] > coords[4] or coords[2] > coords[5]:
            return False
    return True


def _is_designed_step(path: Path) -> bool:
    from backend.services.cad_service import looks_like_mcmaster_part_stem

    if not path.is_file():
        return False
    if path.suffix.lower() not in {".step", ".stp"}:
        return False
    stem = path.stem
    lower = stem.lower()
    if looks_like_mcmaster_part_stem(stem):
        return False
    if lower.endswith("_exploded") or "__part_" in lower or "__faceted" in lower:
        return False
    if re.search(r"_part\d+(?:_\d+)?$", lower) and "__part_" not in lower:
        return False
    if path.name.startswith(".") or ".generation-live." in path.name.lower():
        return False
    return True


def _published_step_is_live_model(new_step: Path, existing: Path) -> bool:
    """True when place-beside would clone the already-live designed solid."""
    try:
        if new_step.resolve() == existing.resolve():
            return True
    except OSError:
        pass
    new_stem = new_step.stem
    old_stem = existing.stem
    if new_stem.lower() == old_stem.lower():
        return True
    try:
        from backend.services.cad_service import (
            _is_promoted_detail_part_stem,
            _logical_component_root,
        )
    except Exception:
        return False
    if _logical_component_root(new_stem).lower() == _logical_component_root(old_stem).lower():
        return True
    if _is_promoted_detail_part_stem(new_stem, new_step.parent):
        return True
    if _is_promoted_detail_part_stem(old_stem, existing.parent):
        return True
    return False


def find_live_assembly_step(project_path: Path, new_step: Path | None) -> Path | None:
    """Newest designed STEP that is not the just-published file."""
    root = Path(project_path)
    new_res = new_step.resolve() if new_step is not None and Path(new_step).is_file() else None
    candidates: list[Path] = []
    try:
        from backend.services.engine_layout import iter_design_files
    except Exception:
        return None
    for path in iter_design_files(root):
        if not _is_designed_step(path):
            continue
        try:
            if new_res is not None and path.resolve() == new_res:
                continue
        except OSError:
            continue
        candidates.append(path)
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _resolve_published_step(project_path: Path, published_step: str | Path | None) -> Path | None:
    from backend.services.engine_layout import resolve_in_layout

    root = Path(project_path)
    if published_step:
        raw = Path(str(published_step))
        located = resolve_in_layout(root, raw.as_posix()) or (root / raw.name)
        if located.is_file() and located.suffix.lower() in {".step", ".stp"}:
            return located
        if located.is_file() and located.suffix.lower() in {".glb", ".gltf"}:
            for suf in (".step", ".stp"):
                sib = located.with_suffix(suf)
                if sib.is_file():
                    return sib
            root_sib = root / f"{located.stem}.step"
            if root_sib.is_file():
                return root_sib
    # Fall back: newest designed STEP.
    newest: Path | None = None
    try:
        from backend.services.engine_layout import iter_design_files

        for path in iter_design_files(root):
            if not _is_designed_step(path):
                continue
            if newest is None or path.stat().st_mtime > newest.stat().st_mtime:
                newest = path
    except Exception:
        return None
    return newest


def place_new_part_beside_assembly(
    project_path: Path,
    published_step: str | Path | None,
    *,
    gap_mm: float = PLACE_GAP_MM,
) -> dict[str, Any]:
    """Keep existing FreeCAD/STEP bodies in place; park the new solid beside them.

    Optionally compounds the new solid into the live assembly STEP when that file
    is small enough to re-tessellate. Never deletes sibling STEPs. Never unit-scales
    project millimetre geometry.
    """
    root = Path(project_path)
    new_step = _resolve_published_step(root, published_step)
    if new_step is None or not new_step.is_file():
        return {"ok": False, "reason": "no_new_step"}
    existing = find_live_assembly_step(root, new_step)
    if existing is None:
        return {"ok": False, "reason": "no_sibling_step"}
    if _published_step_is_live_model(new_step, existing):
        return {"ok": False, "skipped": True, "reason": "already_live_model"}
    meta_path = new_step.with_name(f"{new_step.stem}.place.json")
    if meta_path.is_file():
        try:
            prior = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            prior = None
        if _valid_place_meta(prior):
            return {**prior, "skipped": True, "reason": "already_placed"}
    if not freecad_available():
        return {"ok": False, "reason": "freecad_unavailable"}

    merge = False
    try:
        merge = int(existing.stat().st_size) <= MAX_ASSEMBLY_MERGE_BYTES
    except OSError:
        merge = False

    cmd = find_freecad_cmd()
    if not cmd:
        return {"ok": False, "reason": "freecad_unavailable"}

    work = root / ".vibecad_work" / f"{new_step.stem}_place"
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    staged_existing = work / existing.name
    staged_new = work / new_step.name
    try:
        shutil.copy2(existing, staged_existing)
        shutil.copy2(new_step, staged_new)
    except OSError as exc:
        return {"ok": False, "reason": f"stage_failed:{exc}"}

    existing_out = work / f"existing_out{existing.suffix}"
    new_out = work / f"new_out{new_step.suffix}"
    req_path = work / "request.json"
    res_path = work / "result.json"
    runner_path = work / "runner.py"
    runner_path.write_text(_PLACE_RUNNER_TEMPLATE, encoding="utf-8")
    req_path.write_text(
        json.dumps(
            {
                "existing_step": staged_existing.name,
                "new_step": staged_new.name,
                "existing_out": existing_out.name,
                "new_out": new_out.name,
                "gap_mm": float(gap_mm),
                "merge": merge,
            }
        ),
        encoding="utf-8",
    )
    try:
        proc = subprocess.run(
            [str(cmd), str(runner_path), str(req_path), str(res_path)],
            cwd=str(work),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "QT_QPA_PLATFORM": "offscreen"},
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "freecad_timeout"}
    payload: dict[str, Any] = {}
    if res_path.is_file():
        try:
            payload = json.loads(res_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
    if not payload.get("ok"):
        err = str(payload.get("error") or proc.stderr or proc.stdout or "FreeCAD place failed")
        logger.warning("FreeCAD place-beside failed: %s", err[:400])
        return {"ok": False, "reason": "freecad_failed", "error": err[:400]}

    if new_out.is_file():
        shutil.copy2(new_out, new_step)
    merged = bool(payload.get("merged") and existing_out.is_file())
    if merged:
        shutil.copy2(existing_out, existing)

    from backend.services import cad_service

    new_glb = new_step.with_suffix(".glb")
    try:
        cad_service.tessellate_step_to_glb(new_step, new_glb)
    except Exception as exc:
        logger.warning("Could not tessellate placed part %s: %s", new_step.name, exc)
    assembly_glb = existing.with_suffix(".glb")
    if merged:
        try:
            cad_service.tessellate_step_to_glb(existing, assembly_glb)
        except Exception as exc:
            logger.warning("Could not tessellate merged assembly %s: %s", existing.name, exc)

    from backend.services.engine_layout import project_rel

    result = {
        "ok": True,
        "merged": merged,
        "translation": payload.get("translation") or [0.0, 0.0, 0.0],
        "new_step": project_rel(root, new_step),
        "new_glb": project_rel(root, new_glb) if new_glb.is_file() else None,
        "new_stem": new_step.stem,
        "assembly_step": project_rel(root, existing),
        "assembly_glb": project_rel(root, assembly_glb) if assembly_glb.is_file() else None,
        "existing_bbox": payload.get("existing_bbox"),
        "new_bbox": payload.get("new_bbox"),
    }
    try:
        meta_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass
    return result
