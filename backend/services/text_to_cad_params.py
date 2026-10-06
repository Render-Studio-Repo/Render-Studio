"""Parse and patch module-scope parameters in text-to-cad Python sources."""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

from backend.services import cad_service, skill_runner

_SKIP_PARAM_NAMES = frozenset({
    "dxf_filename",
    "dxf_path",
    "__all__",
})

_STRING_PARAM_SUFFIXES = ("_layer", "_filename", "_path", "_label", "_name")


def _is_gen_step_node(node: ast.AST) -> bool:
    return isinstance(node, ast.FunctionDef) and node.name == "gen_step"


def _literal_value(node: ast.AST | None) -> Any | None:
    if node is None:
        return None
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant):
        if isinstance(node.operand.value, (int, float)):
            return -node.operand.value
    return None


def _param_kind(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    return "unknown"


def _normalize_part_token(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _param_matches_part(name: str, part_filter: str | None) -> bool:
    if not part_filter:
        return True
    token = _normalize_part_token(part_filter)
    if not token:
        return True
    norm = _normalize_part_token(name)
    if norm == token:
        return True
    if norm.startswith(f"{token}_") or norm.endswith(f"_{token}"):
        return True
    if token in norm.split("_"):
        return True
    return False


def _iter_module_assignments(tree: ast.Module) -> list[tuple[str, ast.AST, ast.AST]]:
    gen_step_idx = next((idx for idx, node in enumerate(tree.body) if _is_gen_step_node(node)), len(tree.body))
    out: list[tuple[str, ast.AST, ast.AST]] = []
    for node in tree.body[:gen_step_idx]:
        if isinstance(node, ast.Assign):
            value = node.value
            for target in node.targets:
                if isinstance(target, ast.Name):
                    out.append((target.id, value, node))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out.append((node.target.id, node.value, node))
    return out


def _iter_gen_step_assignments(tree: ast.Module) -> list[tuple[str, ast.AST, ast.AST]]:
    gen_step = next((node for node in tree.body if _is_gen_step_node(node)), None)
    if gen_step is None:
        return []
    out: list[tuple[str, ast.AST, ast.AST]] = []
    for node in gen_step.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    out.append((target.id, node.value, node))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out.append((node.target.id, node.value, node))
    return out


def _collect_assignments(tree: ast.Module) -> list[tuple[str, ast.AST, ast.AST, str]]:
    module_items = [(name, value, node, "module") for name, value, node in _iter_module_assignments(tree)]
    step_items = [(name, value, node, "gen_step") for name, value, node in _iter_gen_step_assignments(tree)]
    merged: list[tuple[str, ast.AST, ast.AST, str]] = []
    seen: set[str] = set()
    for item in module_items + step_items:
        if item[0] in seen:
            continue
        seen.add(item[0])
        merged.append(item)
    return merged


def list_parameters(source: str, *, part_filter: str | None = None) -> list[dict[str, Any]]:
    tree = ast.parse(source)
    params: list[dict[str, Any]] = []
    for name, value_node, node, scope in _collect_assignments(tree):
        if name.startswith("_") or name in _SKIP_PARAM_NAMES:
            continue
        value = _literal_value(value_node)
        if value is None:
            continue
        kind = _param_kind(value)
        if kind == "unknown":
            continue
        if kind == "string" and not name.endswith(_STRING_PARAM_SUFFIXES):
            continue
        if not _param_matches_part(name, part_filter):
            continue
        params.append(
            {
                "name": name,
                "value": value,
                "kind": kind,
                "scope": scope,
                "line": getattr(node, "lineno", None),
            }
        )
    return params


def patch_parameters(source: str, updates: dict[str, Any]) -> str:
    if not updates:
        return source
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    pending: dict[int, str] = {}
    # Patch every assignment of a name (duplicate module constants like rail_width=…).
    for name, value_node, node, _scope in _collect_assignments_all(tree):
        if name not in updates:
            continue
        old_value = _literal_value(value_node)
        new_value = _coerce_param_update(updates[name], old_value)
        if isinstance(new_value, bool):
            rendered = "True" if new_value else "False"
        elif isinstance(new_value, int) and not isinstance(new_value, bool):
            rendered = repr(int(new_value))
        elif isinstance(new_value, float):
            rendered = repr(float(new_value))
        elif isinstance(new_value, str):
            rendered = repr(new_value)
        else:
            continue
        line_no = getattr(node, "lineno", 0)
        if line_no <= 0 or line_no > len(lines):
            continue
        line = lines[line_no - 1]
        if isinstance(node, ast.AnnAssign):
            m = re.match(rf"^(\s*{re.escape(name)}\s*:\s*[^=]+=\s*)(.+?)(\s*(?:#.*)?)$", line.rstrip("\n"))
            if m:
                pending[line_no] = f"{m.group(1)}{rendered}{m.group(3)}{lines[line_no - 1][len(line.rstrip(chr(10))):]}"
                continue
        m = re.match(rf"^(\s*{re.escape(name)}\s*=\s*)(.+?)(\s*(?:#.*)?)$", line.rstrip("\n"))
        if not m:
            continue
        pending[line_no] = f"{m.group(1)}{rendered}{m.group(3)}{lines[line_no - 1][len(line.rstrip(chr(10))):]}"
    if not pending:
        return source
    out = []
    for idx, line in enumerate(lines, start=1):
        out.append(pending.get(idx, line))
    return "".join(out)


def _collect_assignments_all(tree: ast.Module) -> list[tuple[str, ast.AST, ast.AST, str]]:
    """Like _collect_assignments but keeps duplicate names (all write sites)."""
    module_items = [(name, value, node, "module") for name, value, node in _iter_module_assignments(tree)]
    step_items = [(name, value, node, "gen_step") for name, value, node in _iter_gen_step_assignments(tree)]
    return module_items + step_items


def _coerce_param_update(new_value: Any, old_value: Any) -> Any:
    """Keep Python literal kinds stable so range(planet_count) etc. keep working."""
    if isinstance(old_value, bool):
        if isinstance(new_value, bool):
            return new_value
        if isinstance(new_value, (int, float)) and not isinstance(new_value, bool):
            return bool(new_value)
        text = str(new_value).strip().lower()
        return text in {"1", "true", "yes", "on"}
    if isinstance(old_value, int) and not isinstance(old_value, bool):
        try:
            return int(round(float(new_value)))
        except (TypeError, ValueError):
            return old_value
    if isinstance(old_value, float):
        try:
            return float(new_value)
        except (TypeError, ValueError):
            return old_value
    if isinstance(old_value, str):
        return str(new_value)
    return new_value


def resolve_source_for_model(project_path: Path, filename: str) -> tuple[Path, str] | None:
    safe = Path(filename).name
    stem = Path(safe).stem
    for suffix in (".py",):
        candidate = project_path / f"{stem}{suffix}"
        if candidate.is_file():
            return candidate, candidate.name
    edited = re.sub(r"(_edited(?:_\d+)?)+$", "", stem, flags=re.I)
    if edited != stem:
        candidate = project_path / f"{edited}.py"
        if candidate.is_file():
            return candidate, candidate.name
    # Strip other generative suffixes (pulled/mirrored/…) to find the authoring source.
    stripped = re.sub(
        r"(__faceted|_edited|_pulled|_mirrored|_extruded|_copy\d*|_body\d*|_clean(?:_parametric)?)+$",
        "",
        stem,
        flags=re.I,
    )
    if stripped != stem:
        candidate = project_path / f"{stripped}.py"
        if candidate.is_file():
            return candidate, candidate.name
        variants = [stripped[1:] if stripped.startswith(".") else stripped]
        for variant in list(variants):
            if variant.lower().endswith((".step", ".stp")):
                variants.append(Path(variant).stem)
        for variant in dict.fromkeys(v for v in variants if v):
            candidate = project_path / f"{variant}.py"
            if candidate.is_file():
                return candidate, candidate.name
    return None


def regenerate_model(project_path: Path, source_name: str) -> dict[str, Any]:
    source_path = project_path / Path(source_name).name
    if not source_path.is_file():
        raise FileNotFoundError("CAD source not found")
    source_text = source_path.read_text(encoding="utf-8", errors="ignore")
    if "def gen_urdf" in source_text and "def gen_step" not in source_text:
        return _regenerate_urdf_model(project_path, source_path)

    stem = source_path.stem
    step_name = f"{stem}.step"
    glb_name = f"{stem}.glb"
    stl_name = f"{stem}.stl"
    three_mf_name = f"{stem}.3mf"
    step_out = skill_runner.run_skill_tool(
        "cad",
        "step",
        [
            source_path.name,
            "-o",
            step_name,
            "--glb",
            glb_name,
            "--force",
        ],
        cwd=project_path,
        timeout_sec=240.0,
    )
    if not step_out.get("ok"):
        detail = (step_out.get("stderr") or step_out.get("stdout") or "scripts/step failed").strip()
        raise RuntimeError(detail[:2000] or "scripts/step failed")
    glb_path = project_path / glb_name
    if glb_path.is_file():
        # scripts/step writes native Y-up metre GLBs; Render Studio viewport is Z-up mm.
        _convert_regenerated_glb_to_z_up(glb_path)
        step_path = project_path / step_name
        if step_path.is_file():
            try:
                cad_service._match_glb_scale_to_step(step_path, glb_path)
            except Exception:
                pass
        try:
            cad_service.colorize_assembly_glb_parts(glb_path, force=True)
        except Exception:
            cad_service.apply_prompt_appearance_to_file(glb_path, "", seed=stem)
        jake_glb = project_path / f".{step_name}.glb"
        try:
            jake_glb.write_bytes(glb_path.read_bytes())
        except Exception:
            pass
    return {
        "source": source_path.name,
        "step": step_name,
        "glb": glb_name,
        "stl": stl_name,
        "three_mf": three_mf_name,
    }


def _regenerate_urdf_model(project_path: Path, source_path: Path) -> dict[str, Any]:
    """Rebuild Jake-style URDF (+ SRDF) after Object Adjustments edit module constants."""
    stem = source_path.stem
    urdf_name = f"{stem}.urdf"
    srdf_name = f"{stem}.srdf"
    urdf_out = skill_runner.run_skill_tool(
        "urdf",
        "urdf",
        [f"{source_path.name}={urdf_name}"],
        cwd=project_path,
        timeout_sec=90.0,
    )
    if not urdf_out.get("ok") or not (project_path / urdf_name).is_file():
        detail = (urdf_out.get("stderr") or urdf_out.get("stdout") or "urdf generation failed").strip()
        raise RuntimeError(detail[:2000] or "urdf generation failed")

    artifacts: dict[str, Any] = {"source": source_path.name, "urdf": urdf_name}
    source_text = source_path.read_text(encoding="utf-8", errors="ignore")
    if "def gen_srdf" in source_text:
        srdf_out = skill_runner.run_skill_tool(
            "srdf",
            "srdf",
            [f"{source_path.name}={srdf_name}"],
            cwd=project_path,
            timeout_sec=90.0,
        )
        if srdf_out.get("ok") and (project_path / srdf_name).is_file():
            artifacts["srdf"] = srdf_name

    # Keep a Z-up mm preview GLB in sync for the Solid browser (best-effort).
    try:
        _rebuild_urdf_preview_glb(project_path, stem)
        artifacts["glb"] = f"{stem}.glb"
    except Exception:
        pass
    return artifacts


def _rebuild_urdf_preview_glb(project_path: Path, stem: str) -> None:
    """Simple Z-up mm preview so Components / Solid still show the arm after rebuild."""
    import json
    import struct

    import numpy as np
    import trimesh

    # Read mm constants from the python source via a tiny exec of assignments only.
    source = (project_path / f"{stem}.py").read_text(encoding="utf-8")
    ns: dict[str, Any] = {}
    for line in source.splitlines():
        if re.match(r"^[A-Z][A-Z0-9_]*\s*=", line):
            try:
                exec(line, {"__builtins__": {}}, ns)  # noqa: S102 — trusted project source
            except Exception:
                pass
    base_x = float(ns.get("BASE_X", 120))
    base_y = float(ns.get("BASE_Y", 120))
    base_z = float(ns.get("BASE_Z", 40))
    shoulder_z = float(ns.get("SHOULDER_Z", 50))
    upper = float(ns.get("UPPER_LEN", 180))
    forearm = float(ns.get("FOREARM_LEN", 160))
    wrist = float(ns.get("WRIST_LEN", 40))
    radius = float(ns.get("LINK_RADIUS", 22))

    parts = []
    def add(mesh, color, translate=None, rotate_axis=None, angle=None):
        if rotate_axis is not None:
            mesh.apply_transform(trimesh.transformations.rotation_matrix(angle, rotate_axis))
        if translate is not None:
            mesh.apply_translation(translate)
        mesh.visual.face_colors = color
        parts.append(mesh)

    add(trimesh.creation.box(extents=[base_x, base_y, base_z]), [130, 136, 150, 255], translate=[0, 0, base_z / 2])
    add(trimesh.creation.cylinder(radius=radius * 1.2, height=60), [90, 140, 220, 255], translate=[0, 0, base_z + 30])
    z_arm = base_z + shoulder_z
    add(
        trimesh.creation.cylinder(radius=radius, height=upper),
        [120, 190, 100, 255],
        rotate_axis=[0, 1, 0],
        angle=np.pi / 2,
        translate=[upper / 2, 0, z_arm],
    )
    add(trimesh.creation.icosphere(radius=radius * 1.15, subdivisions=2), [240, 200, 80, 255], translate=[upper, 0, z_arm])
    add(
        trimesh.creation.cylinder(radius=radius * 0.9, height=forearm),
        [230, 170, 70, 255],
        rotate_axis=[0, 1, 0],
        angle=np.pi / 2,
        translate=[upper + forearm / 2, 0, z_arm],
    )
    add(
        trimesh.creation.box(extents=[wrist, 40, 30]),
        [220, 110, 110, 255],
        translate=[upper + forearm + wrist / 2, 0, z_arm],
    )
    combined = trimesh.util.concatenate(parts)

    vertices = combined.vertices.astype(np.float32)
    faces = combined.faces.astype(np.uint32)
    normals = combined.vertex_normals.astype(np.float32)

    def pad4(b: bytes, pad: bytes) -> bytes:
        return b + pad * ((4 - (len(b) % 4)) % 4)

    vbytes = pad4(vertices.tobytes(), b"\x00")
    nbytes = pad4(normals.tobytes(), b"\x00")
    ibytes = pad4(faces.tobytes(), b"\x00")
    bin_blob = vbytes + nbytes + ibytes
    mins = vertices.min(axis=0).tolist()
    maxs = vertices.max(axis=0).tolist()
    gltf = {
        "asset": {"version": "2.0", "generator": "render3d-urdf-preview"},
        "scenes": [{"nodes": [0]}],
        "scene": 0,
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "materials": [{
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.48, 0.62, 0.78, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.6,
            }
        }],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": int(len(vertices)), "type": "VEC3", "max": maxs, "min": mins},
            {"bufferView": 1, "componentType": 5126, "count": int(len(normals)), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5125, "count": int(faces.size), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(vertices.tobytes()), "target": 34962},
            {"buffer": 0, "byteOffset": len(vbytes), "byteLength": len(normals.tobytes()), "target": 34962},
            {"buffer": 0, "byteOffset": len(vbytes) + len(nbytes), "byteLength": len(faces.tobytes()), "target": 34963},
        ],
        "buffers": [{"byteLength": len(bin_blob)}],
    }
    json_blob = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(json_blob) + 8 + len(bin_blob)
    out = bytearray()
    out += struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(json_blob), b"JSON") + json_blob
    out += struct.pack("<I4s", len(bin_blob), b"BIN\x00") + bin_blob
    (project_path / f"{stem}.glb").write_bytes(out)


def _convert_regenerated_glb_to_z_up(glb_path: Path) -> None:
    """Match design_service: rotate native Y-up text-to-cad GLB into Render Studio Z-up."""
    from backend.services.design_service import _convert_text_to_cad_glb_to_z_up

    _convert_text_to_cad_glb_to_z_up(glb_path)
