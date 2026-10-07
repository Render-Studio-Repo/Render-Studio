"""Shared CAD harness capabilities for Jake 2.0, VibeCAD, MAC, Mesh, kernel, and future engines.

New Mode 2.0 / Mesh harnesses should consume this packet instead of re-implementing
photos, convert-to-DXF, @refs, electronics, and knowledge. ``main.py`` already runs
image→DXF before generation; each engine must fold the result into its prompt and
stage drawings into its worker cwd.

Sibling STEP inspect/rearrange and McMaster-Carr catalog fetch are harness-wide:
call ``prepare_harness_hardware`` (CAD brief + parts list + STEP fetch) before
authoring, and ``finalize_harness_run`` after every successful generate.
"""

from __future__ import annotations

import base64
import json
import logging
import math
import re
import shutil
from pathlib import Path
from typing import Any

from backend.services.prompt_references import PHOTO_AND_DXF_INSTRUCTIONS, image_caption, image_name

logger = logging.getLogger(__name__)

CAD_HARNESS_MODES = frozenset(
    {
        "v2",
        "fusion",
        "architect",
        "vibecad",
        "vibe",
        "vibecade",
        "mac",
        "macad",
        "multi_agent_cad",
        "multiagentcad",
        "multi_agent",
        "multiagent",
        "mesh",
        "mesh_beta",
        "mesh-beta",
        "kernel",
        "feature",
        "program",
    }
)

PROJECT_PARTS_FILENAME = "PROJECT_PARTS.md"
MCMASTER_USED_FILENAME = "r3d_mcmaster_used.json"
JOINTS_FILENAME = "r3d_joints.json"
PLACE_META_SUFFIX = ".place.json"

# VibeCAD / vcad joint types (https://docs.vcad.io/guides/assembly/joints).
# Kernel sim.json still maps slider→prismatic; cylindrical/ball stay in this sidecar.
from backend.services.assembly_motion import NATIVE_TYPES
JOINT_TYPES = frozenset(NATIVE_TYPES)
_JOINT_TYPE_ALIASES = {
    "rackpinion": "rack_pinion",
    "rack-and-pinion": "rack_pinion",
    "hinge": "revolute",
    "pivot": "revolute",
    "weld": "fixed",
    "rigid": "fixed",
    "fastened": "fixed",
    "slide": "prismatic",
    "linear": "prismatic",
    "ball_socket": "ball",
    "spherical": "ball",
}


def merged_part_stems(project_path: Path) -> set[str]:
    """Stems already fused into a live assembly STEP — keep the file, don't auto-load a duplicate."""
    root = Path(project_path)
    stems: set[str] = set()
    folders = [root]
    try:
        from backend.services.engine_layout import ENGINE_FOLDERS

        folders.extend(root / name for name in ENGINE_FOLDERS)
    except Exception:
        pass
    for folder in folders:
        if not folder.is_dir():
            continue
        try:
            children = list(folder.iterdir())
        except OSError:
            continue
        for path in children:
            if not path.is_file() or not path.name.endswith(PLACE_META_SUFFIX):
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(data, dict) or not data.get("merged"):
                continue
            stem = str(data.get("new_stem") or path.name[: -len(PLACE_META_SUFFIX)]).strip()
            if stem:
                stems.add(Path(stem).name)
                stems.add(Path(stem).stem)
    return stems

SIBLING_PARTS_INSTRUCTIONS = """Existing STEP/GLB files in this folder are live parts already in the viewport. Keep them in place.
Author ONLY the new solid this prompt asked for. Do not re-import, remodel, rescale, or compound existing designed siblings into a new assembly — that makes them disappear and change size.
Catalog hardware (McMaster PNs) may still be imported into THIS new part when it needs fasteners (Jake: cadgen.read_step + moved(Location); VibeCAD: inputs[hw_*]; FreeCAD: inputs[alias] + Placement). Leave existing designed parts on disk untouched.
Export this new part as its own millimetre STEP/GLB at the origin. The host FreeCAD kernel keeps existing objects in place and places the new solid beside them, or merges it into the live assembly STEP.
To move an existing file without rewriting B-rep, write `r3d_placements.json`:
{"moves":[{"filename":"part.step","translation":[x,y,z],"rotation_deg":[rx,ry,rz],"scale":1}]}
Millimetres. Viewport frame. Inspect with `python scripts/inspect refs <name>.step --facts --planes --positioning`.
Only compose the whole project into one compound when the user explicitly asks to assemble, mate, or combine existing parts.
If the prompt mentions a sibling mount/arm STEP that is NOT in this folder, do not raise INPUT_BLOCKED and do not write a preflight stub. Author a parameterized chassis with documented assumed envelope (typical OpenArm table mount ~190×250×8 mm, M6 clearance grid at 30 mm). Import McMaster hardware already on disk. Export STEP/GLB so the viewport can live-draw. Mark assumed vs measured in comments."""

MCMASTER_FETCH_INSTRUCTIONS = """McMaster-Carr hardware (required for every CAD harness — Jake, VibeCAD, and MAC):
- If the design assembles, fastens, pivots, or mounts anything (screws, nuts, washers, inserts, bearings, standoffs, shafts, springs, hinges) OR mounts electronics (PCB, motor, servo, ESC, battery), you MUST use purchasable McMaster-Carr catalog parts — do not invent printed fasteners.
- Prefer STEP/GLB already in this project / `mcmaster_library/` (do not remodel catalog hardware, do not re-download when `{pn}.glb` or `{pn}.step` exists). The site loads the GLB; STEP is only for B-rep mates.
- Import them (`cadgen.read_step` / `input_objects` / `inputs[hw_*]` / FreeCAD Import.insert) and mate printed parts to the catalog geometry at millimetre scale.
- Need a catalog part that is not on disk? Name the McMaster PN in the CAD brief / r3d_mcmaster_used.json. The studio downloads STEP onto the server — never ask the user to save CAD to their Downloads folder.
- After using catalog parts, write `r3d_mcmaster_used.json`:
  {"used":[{"part_number":"91251A194","filename":"91251A194.step","qty":4,"used_in":"clip.py"}]}
  People buy those PNs at https://www.mcmaster.com/{PN}/ — list every PN you actually imported.
- Use 'no McMaster hardware' when the user forbids screws/fasteners or says the whole kit must be 3D-printed.
- Never leave hardware as TBD for an assembly that needs fasteners. Pick real catalog numbers (socket screws, locknuts, washers, heat-set inserts, caster/wheel/motor when those roles exist) so the studio can draw them live in the viewport."""

JOINT_AUTHORING_INSTRUCTIONS = """JOINTS (VibeCAD Assembly / FreeCAD kernel — required when parts move or mate):
FreeCAD Assembly supports fixed, revolute, slider (prismatic), cylindrical, ball, distance, parallel, perpendicular, angle, rack_pinion, screw, gears, and belt.
Each joint is a parent→child constraint with an LCS at the physical pivot (filled XY disk + RGB XYZ axes in the viewport).
Keep separate named components so a native CAD adapter can recreate joints after STEP import.

When the prompt is a mechanism (hinge, lid, door, arm, gripper, linkage, slider, piston, crank, gear, robot, fold):
- Put a named solid in `result` / expected_outputs for every moving body (do not fuse the hinge into one blob).
- Return a `joints` array in the authoring JSON (VibeCAD) and/or write `<model_stem>.joints.json` beside the published STEP (same model name):
  {"joints":[{"id":"lid_hinge","type":"revolute","parent":"Base","child":"Lid","anchor":[0,0,20],"axis":[1,0,0],"limits":[0,110]}]}
- Types: fixed (bolted/welded), revolute (hinge), prismatic or slider (drawer), cylindrical (screw/shaft), ball (socket).
- parent/child MUST match result keys (or `world` for ground). anchor is millimetres in the viewport/world frame. axis is a unit vector (default [0,0,1]).
- limits: degrees for revolute, millimetres for slider/prismatic. Omit for fixed/ball.
- Place the anchor on the physical pivot (pin centreline, shaft, socket). The Joints toggle draws the FreeCAD-style LCS + axis overlay there.
- Motion requests such as "I want to see it move" REQUIRE authored joints automatically; do not wait for the user to request joints explicitly. A rigid whole-model reposition alone does not require joints.
- FreeCAD constraints: distance (distance mm), angle (angle deg), parallel, perpendicular. Couplings: gears/belt (distance and distance2 = pitch radii mm), rack_pinion (distance = pinion pitch radius mm), screw (distance = pitch mm per revolution). Couplings supplement the physical revolute/slider joints; they do not replace them.
- child_anchor and child_axis define the second assembled-frame connector when different from anchor/axis. Both connectors must be physically located, never guessed from a bounding box. Ground the base with parent="world" and type="fixed". Keep moving solids separate and uniquely named.
- For connector roll/offset/reversed orientation, supply parent_rotation and child_rotation as normalized [x,y,z,w] quaternions; anchors set connector offsets in assembled millimetres. `suppressed: true` preserves a disabled joint.
- Use the native solver result to check constraints. Missing/ambiguous body names or a failed solve mean motion is not verified. Do not claim animation is ready without authored joints and a successful solve.

Export contract: the host preserves joint metadata in STEP and a .joints.json sidecar. Never add joint marker solids to the model. Standard STEP import does not create native mates; the Fusion package script recreates them. Onshape/SolidWorks need native mate adapters. Keep components separate. A cylindrical joint has independent angular_limits (degrees) and linear_limits (mm), not screw coupling. Limits are relative to the exported assembled pose (zero). Preserve existing joints during edits and update only affected pivots/components; return an explicit empty joints array only to remove all joints. Use exact unique exported component names.
Static bolted kits: optional `fixed` joints between housing and lid still help Fusion/Onshape."""


def prompt_wants_joints(prompt: str) -> bool:
    """True when the AI prompt should author VibeCAD/FreeCAD assembly joints."""
    p = (prompt or "").lower()
    if not p.strip():
        return False
    needles = (
        "joint", "hinge", "linkage", "slider", "piston", "crank", "cam",
        "lid", "door", "animate", "animation", "motion", "mechanism",
        "robot", "arm", "gripper", "fold", "open/close", "open and close",
        "revolute", "prismatic", "ball joint", "cylindrical", "mate",
        "kinematic", "dof", "wrist", "shoulder", "elbow", "gear",
        "planetary", "shaft", "bearing", "pivot", "see it move", "make it move",
        "show it moving", "movable", "rotate", "spin", "actuate", "articulate",
        "rigging", "open/close", "opening and closing",
    )
    return any(re.search(r"(?<![a-z])" + re.escape(n) + r"(?![a-z])", p) for n in needles)


def joints_authoring_rules(prompt: str) -> str:
    """Always mention the joints sidecar; expand when the prompt is a mechanism."""
    if prompt_wants_joints(prompt):
        return JOINT_AUTHORING_INSTRUCTIONS
    return (
        "Joints: if parts later need to pivot, slide, or bolt as an assembly, return a `joints` "
        "array using FreeCAD Assembly joint types and/or write `<model_stem>.joints.json`. "
        "Parent/child names match `result` keys. The viewport Joints toggle shows VibeCAD LCS overlays."
    )


def _vec3(raw: Any, default: list[float]) -> list[float]:
    if isinstance(raw, dict):
        raw = [raw.get(k, default[i]) for i, k in enumerate(("x", "y", "z"))]
    if isinstance(raw, str):
        key = raw.strip().lower()
        if key.lstrip("+-") in {"x", "y", "z"}:
            result = [0.0, 0.0, 0.0]
            result["xyz".index(key.lstrip("+-"))] = -1.0 if key.startswith("-") else 1.0
            return result
    if isinstance(raw, (list, tuple)) and len(raw) >= 3:
        try:
            values = [float(v) for v in raw[:3]]
            if all(math.isfinite(v) for v in values):
                return values
        except (TypeError, ValueError):
            pass
    return list(default)


def _slug_joint_id(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip()).strip("_")
    return (slug[:64] or fallback)


def normalize_harness_joints(raw: Any) -> list[dict[str, Any]]:
    """Coerce VibeCAD / Jake / URDF-ish joint dicts into one overlay + STEP sidecar shape."""
    if isinstance(raw, dict):
        raw = raw.get("assembly_constraints") if raw.get("native_solver_required") else raw.get("joints", raw.get("assembly_constraints", []))
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        child = item.get("child") or item.get("child_link") or item.get("child_id")
        if not child:
            continue
        # VibeCAD: parent may be null / omitted for a world-grounded instance.
        parent = item.get("parent") or item.get("parent_link") or item.get("parent_id") or "world"
        kind = str(item.get("overlay_type") or item.get("type") or item.get("joint") or "fixed").strip().lower()
        kind = _JOINT_TYPE_ALIASES.get(kind, kind)
        if kind not in JOINT_TYPES:
            raise ValueError(f"Unsupported joint type: {kind}")
        joint_id = item.get("id") or item.get("name") or item.get("label") or f"{parent}_to_{child}"
        joint_id = _slug_joint_id(str(joint_id), f"joint_{index + 1}")
        base = joint_id
        n = 2
        while joint_id.lower() in seen:
            joint_id = f"{base}_{n}"
            n += 1
        seen.add(joint_id.lower())
        anchor = item.get("anchor") or item.get("anchor_mm") or item.get("origin") or item.get("position") or item.get("parent_anchor")
        child_anchor = item.get("child_anchor")
        axis = item.get("axis") or [0.0, 0.0, 1.0]
        limits = item.get("limits")
        if isinstance(limits, (list, tuple)) and len(limits) >= 2:
            try:
                limits = [float(limits[0]), float(limits[1])]
                if not all(math.isfinite(v) for v in limits) or limits[0] > limits[1]:
                    raise ValueError("invalid limits")
            except (TypeError, ValueError):
                limits = None
        else:
            limits = None
        row = {
            "id": joint_id,
            "type": kind,
            "parent": str(parent),
            "child": str(child),
            "anchor": _vec3(anchor, [0.0, 0.0, 0.0]),
            "axis": _vec3(axis, [0.0, 0.0, 1.0]),
        }
        norm = math.sqrt(sum(v * v for v in row["axis"]))
        row["axis"] = [v / norm for v in row["axis"]] if norm > 1e-12 else [0.0, 0.0, 1.0]
        if row["parent"] == row["child"]:
            raise ValueError(f"Joint {joint_id} connects a component to itself")
        for key in ("angular_limits", "linear_limits"):
            value = item.get(key)
            if isinstance(value, (list, tuple)) and len(value) == 2:
                vals = [float(v) for v in value]
                if all(math.isfinite(v) for v in vals) and vals[0] <= vals[1]:
                    row[key] = vals
        for key in ("distance", "distance2", "angle"):
            if key in item:
                value = float(item[key])
                if not math.isfinite(value): raise ValueError(f"Joint {joint_id}: {key} must be finite")
                row[key] = value
        if kind in {"gears", "belt", "rack_pinion", "screw"}:
            required = ("distance", "distance2") if kind in {"gears", "belt"} else ("distance",)
            if any(not row.get(key) for key in required): raise ValueError(f"Joint {joint_id} requires nonzero coupling dimensions: {required}")
            if kind in {"gears", "belt", "rack_pinion"} and any(row[key] < 0 for key in required): raise ValueError("Pitch radii must be positive")
        for key in ("parent_rotation", "child_rotation"):
            if key in item:
                q = item[key]
                if not isinstance(q, (list, tuple)) or len(q) != 4: raise ValueError(f"{key} needs an x,y,z,w quaternion")
                q = [float(v) for v in q]
                norm_q = math.sqrt(sum(v*v for v in q))
                if not all(math.isfinite(v) for v in q) or norm_q < 1e-12: raise ValueError(f"Invalid {key}")
                row[key] = [v/norm_q for v in q]
        if "child_axis" in item:
            row["child_axis"] = _vec3(item["child_axis"], row["axis"])
        if "suppressed" in item: row["suppressed"] = bool(item["suppressed"])
        if child_anchor is not None:
            row["child_anchor"] = _vec3(child_anchor, row["anchor"])
        if limits is not None:
            row["limits"] = limits
        if item.get("state") is not None:
            try:
                value = float(item["state"])
                if math.isfinite(value):
                    row["state"] = value
            except (TypeError, ValueError):
                pass
        out.append(row)
    return out


def cadgen_kinematics_to_harness(raw: Any) -> list[dict[str, Any]]:
    """Translate Jake's document-bound mates into Render's joint domain."""
    if not isinstance(raw, dict):
        return []
    kinematics = raw.get("kinematics") if isinstance(raw.get("kinematics"), dict) else raw
    mates = kinematics.get("mates") if isinstance(kinematics, dict) else None
    if not isinstance(mates, list):
        return []
    rows: list[dict[str, Any]] = []
    kind_map = {"fastened": "fixed", "slider": "prismatic"}
    for index, mate in enumerate(mates):
        if not isinstance(mate, dict):
            continue
        axis = mate.get("axis") if isinstance(mate.get("axis"), dict) else {}
        parent = str(mate.get("parent") or "world").lstrip("#")
        child = str(mate.get("child") or "").lstrip("#")
        if not child:
            continue
        kind = str(mate.get("kind") or mate.get("type") or "fastened").lower()
        row = {
            "id": mate.get("name") or mate.get("id") or f"mate_{index + 1}",
            "type": kind_map.get(kind, kind),
            "parent": parent,
            "child": child,
            "anchor": mate.get("origin") or axis.get("origin") or [0, 0, 0],
            "axis": mate.get("direction") or axis.get("direction") or [0, 0, 1],
        }
        if mate.get("limits") is not None:
            row["limits"] = mate["limits"]
        rows.append(row)
    return normalize_harness_joints(rows)


def write_harness_joints_file(project_path: Path, joints: list[dict[str, Any]], *, stem: str | None = None) -> Path | None:
    """Persist model-scoped portable intent and the last-authored joint index."""
    rows = normalize_harness_joints(joints)
    root = Path(project_path)
    if not root.is_dir():
        return None
    from backend.services.assembly_joint_export import joint_payload
    payload = joint_payload(rows, stem=stem)
    dest = root / JOINTS_FILENAME
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if stem:
        from backend.services.assembly_motion import joint_folder_file
        folder_file = joint_folder_file(root, stem)
        folder_file.parent.mkdir(parents=True, exist_ok=True)
        folder_file.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if stem:
        (root / f"{stem}.joints.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return dest


def _merge_joints_into_sim(project_path: Path, joints: list[dict[str, Any]], stem: str | None) -> None:
    root = Path(project_path)
    candidates: list[Path] = []
    if stem:
        candidates.append(root / f"{stem}.sim.json")
    if not stem:
        candidates.extend(sorted(root.glob("*.sim.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:3])
    dest = next((p for p in candidates if p.is_file()), None)
    payload: dict[str, Any]
    if dest and dest.is_file():
        try:
            payload = json.loads(dest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
    else:
        dest = root / (f"{stem}.sim.json" if stem else "model.sim.json")
        payload = {"schema": "render3d.sim/1.0", "name": stem or "model", "parts": [], "joints": []}
    mapped = []
    for joint in joints:
        kind = str(joint.get("type") or "fixed")
        if kind not in {"fixed", "revolute", "prismatic", "slider", "continuous"}:
            continue  # Keep native-only constraints out of the simpler robot solver.
        sim_type = "prismatic" if kind in {"slider", "prismatic"} else (
            "revolute" if kind in {"revolute", "cylindrical", "continuous"} else "fixed"
        )
        mapped.append(
            {
                "id": joint["id"],
                "type": sim_type,
                "parent": joint["parent"],
                "child": joint["child"],
                "anchor_mm": joint["anchor"],
                "axis": joint["axis"],
                "limits": joint.get("limits"),
                "overlay_type": kind,
            }
        )
    payload["assembly_constraints"] = joints
    payload["native_solver_required"] = len(mapped) != len(joints)
    payload["joints"] = mapped
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def load_harness_joints(project_path: Path, *, stem: str | None = None) -> list[dict[str, Any]]:
    """Read model-scoped metadata; never attach another model's global joints."""
    from backend.services.engine_layout import ENGINE_FOLDERS
    from backend.services.assembly_joint_export import unpack_step_joints
    root = Path(project_path)
    names: list[Path] = []
    if stem:
        rel = Path(stem)
        if rel.is_absolute() or ".." in rel.parts:
            return []
        folders = [root / rel.parent] if rel.parent != Path(".") else [root, *(root / f for f in ENGINE_FOLDERS)]
        # Root legacy sidecars may belong to a model since moved into an engine folder.
        if root not in folders:
            folders.append(root)
        for folder in folders:
            names.append(folder / (rel.name + ".step.json"))
            for suffix in (".joints.json", ".vibecad.json", ".program.json", ".sim.json"):
                names.append(folder / (rel.name + suffix))
        names.append(root / JOINTS_FILENAME)
    else:
        names = [root / JOINTS_FILENAME]
    for path in names:
        if not path.is_file():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if stem and path.name == JOINTS_FILENAME:
                stored = str(payload.get("stem") or "") if isinstance(payload, dict) else ""
                if stored != str(stem) and stored != Path(stem).name:
                    continue
            if isinstance(payload, dict) and ("joints" in payload or "assembly_constraints" in payload):
                # Empty is authoritative; do not resurrect old joints from sim/STEP.
                return normalize_harness_joints(payload)
            if path.name.endswith(".step.json"):
                translated = cadgen_kinematics_to_harness(payload)
                if translated:
                    return translated
            if isinstance(payload, list) and path.name.endswith(".joints.json"):
                return normalize_harness_joints(payload)
        except (OSError, ValueError, TypeError):
            continue
    if stem:
        for folder in folders:
            for suffix in (".step", ".stp"):
                step = folder / (Path(stem).name + suffix)
                if step.is_file():
                    payload = unpack_step_joints(step.read_bytes())
                    if payload:
                        return normalize_harness_joints(payload)
    return []


def project_has_harness_joints(project_path: Path, *, stem: str | None = None) -> bool:
    """True when this project authored VibeCAD/FreeCAD assembly joints (do not flatten)."""
    return bool(load_harness_joints(project_path, stem=stem))


def stamp_joints_into_step(step_path: Path, joints: list[dict[str, Any]]) -> bool:
    """Embed portable metadata without adding solids or rewriting B-rep topology."""
    from backend.services.assembly_joint_export import joint_payload, pack_step_joints
    path = Path(step_path)
    if not path.is_file():
        return False
    original = path.read_bytes()
    packed = pack_step_joints(original, joint_payload(normalize_harness_joints(joints), stem=path.stem))
    if packed != original:
        path.write_bytes(packed)
    return True


def apply_harness_joints(
    project_path: Path,
    joints: Any = None,
    *,
    published_step: str | Path | None = None,
    stem: str | None = None,
) -> dict[str, Any]:
    """Normalize joints from AI JSON or `r3d_joints.json`, persist, stamp B-rep."""
    root = Path(project_path)
    rows = normalize_harness_joints(joints) if joints is not None else load_harness_joints(root, stem=stem)
    if not rows and joints is None:
        return {"joints": [], "stamped": False}
    write_harness_joints_file(root, rows, stem=stem)
    try:
        _merge_joints_into_sim(root, rows, stem)
    except Exception:
        logger.debug("Could not merge joints into sim.json", exc_info=True)
    stamped = False
    step_path: Path | None = None
    if published_step:
        cand = Path(published_step)
        step_path = cand if cand.is_absolute() else (root / cand)
        if not step_path.is_file():
            step_path = root / Path(str(published_step)).name
    if (not step_path or not step_path.is_file()) and stem:
        for ext in (".step", ".stp"):
            p = root / f"{stem}{ext}"
            if p.is_file():
                step_path = p
                break
    if step_path and step_path.is_file():
        try:
            stamped = stamp_joints_into_step(step_path, rows)
        except Exception:
            logger.warning("Could not embed joint metadata for %s", step_path.name, exc_info=True)
            stamped = False
    native = None
    if stem and step_path and step_path.is_file():
        from backend.services.assembly_motion import publish_native
        native = publish_native(root, stem, rows)
    return {"joints": rows, "stamped": stamped, "count": len(rows), "native": native}


PRINT_ONLY_HARDWARE_INSTRUCTIONS = """Print-only kit (no McMaster-Carr / no purchased fasteners):
- The user asked for no screws (or an all-printed / printer-bed kit). Do NOT fetch, import, or model McMaster-Carr catalog parts.
- Do not call fetch_mcmaster_part. Ignore any parts_list.md already on disk for this run.
- Join printed bodies with snap-fits, living hinges, printed pins, dovetails, or press-fits — not bought screws/nuts/inserts.
- Keep every body FDM-printable. Viewport live-draw is still STEP/GLB only (never write STL)."""

MCMASTER_DISABLED_INSTRUCTIONS = """McMaster-Carr catalog hardware is OFF for this generation:
- Do not list, fetch, import, or insert McMaster-Carr catalog parts (screws, nuts, washers, bearings, inserts, standoffs).
- Do not call fetch_mcmaster_part. Do not write r3d_mcmaster_used.json. Do not crawl the McMaster catalog.
- Ignore parts_list.md / mcmaster_library for this run unless the user already @-referenced a specific file.
- Author custom solids only — do not add purchasable hardware the user did not name."""

_NO_HARDWARE_RE = re.compile(
    r"\b((no|without|dont|don't|do not|zero)\s+(any\s+)?"
    r"(screws?|bolts?|nuts?|fasteners?|hardware|mcmaster|purchased(\s+parts?)?|cots|catalog parts?)|"
    r"no[- ]hardware)\b",
    re.I,
)
_FASTENER_REQUEST_RE = re.compile(
    r"\b(mcmaster|heat-?set|threaded insert|socket.?head|shcs|"
    r"with (an? )?(m\d+|screws?|bolts?|nuts?|washers?|fasteners?|standoffs?)|"
    r"use (screws?|bolts?|fasteners?|mcmaster))\b",
    re.I,
)
_PRINT_ONLY_RE = re.compile(
    r"\b((all|everything|entire(ly)?|fully|only)\s+(3[- ]?d\s+|fdm\s+)?printed|"
    r"printed\s+(only|in[- ]place)|print[- ]in[- ]place|"
    r"snap[- ](fit|together)|press[- ]fit|"
    r"(all|everything|it all|the whole (thing|kit|assembly))\s+"
    r"(needs to be|must be|should be)\s+printed|"
    r"needs to be printed for a printer|"
    r"all 3d printed)\b",
    re.I,
)


def prompt_forbids_catalog_hardware(prompt: str) -> bool:
    """True when the AI prompt wants a print-only kit with no McMaster fasteners."""
    text = str(prompt or "")
    if not text.strip():
        return False
    if _NO_HARDWARE_RE.search(text):
        return True
    if _FASTENER_REQUEST_RE.search(text):
        return False
    return bool(_PRINT_ONLY_RE.search(text))


def catalog_hardware_allowed(
    prompt: str = "",
    *,
    context: dict[str, Any] | None = None,
    use_mcmaster_parts: bool | None = None,
) -> bool:
    """False when Parts toggle is off or the prompt is print-only / no-screws."""
    if use_mcmaster_parts is None and isinstance(context, dict):
        use_mcmaster_parts = context.get("use_mcmaster_parts", True)
    if use_mcmaster_parts is False:
        return False
    return not prompt_forbids_catalog_hardware(prompt)


def hardware_authoring_rules(
    prompt: str,
    *,
    context: dict[str, Any] | None = None,
    use_mcmaster_parts: bool | None = None,
) -> str:
    if use_mcmaster_parts is None and isinstance(context, dict):
        use_mcmaster_parts = context.get("use_mcmaster_parts", True)
    if use_mcmaster_parts is False:
        return MCMASTER_DISABLED_INSTRUCTIONS
    if prompt_forbids_catalog_hardware(prompt):
        return PRINT_ONLY_HARDWARE_INSTRUCTIONS
    return MCMASTER_FETCH_INSTRUCTIONS


def is_cad_harness_mode(mode: str | None) -> bool:
    return str(mode or "").strip().lower().replace("-", "_") in {
        m.replace("-", "_") for m in CAD_HARNESS_MODES
    }


def prompt_wants_electronics_or_wiring(prompt: str) -> bool:
    p = (prompt or "").lower()
    needles = (
        "motor", "servo", "esc", "lipo", "battery", "receiver", "wiring", "wire channel",
        "electronics", "brushless", "propeller", "pushrod", "arduino", "pcb", "board mount",
        "motor mount", "servo pocket", "cable", "harness",
    )
    return any(re.search(r"(?<![a-z])" + re.escape(n) + r"(?![a-z])", p) for n in needles)


def electronics_authoring_rules(
    prompt: str,
    *,
    enabled: bool = True,
    use_mcmaster_parts: bool = True,
) -> str:
    if not enabled:
        return ""
    if not prompt_wants_electronics_or_wiring(prompt):
        return ""
    body = (
        "ELECTRONICS / WIRING SOLIDS (required for this prompt):\n"
        "- Do NOT stop at empty pockets, shelves, or clearance holes.\n"
        "- Model visible labeled solids for the claimed electronics: motor, ESC, battery/LiPo, "
        "receiver, and each servo (or documented purchasable STEP via $step-parts).\n"
        "- Model wiring as labeled solids too: wire bundles/tubes along channels, lead exits, "
        "and harness runs between motor/ESC/battery/servos — not only empty tunnels.\n"
        "- Keep printable airframe parts separate from electronics envelopes; electronics may be "
        "non-printed space-claim bodies with clear labels (e.g. `2212_motor`, `esc_30a`, "
        "`lipo_3s`, `aileron_servo_left`, `motor_leads`).\n"
    )
    if not use_mcmaster_parts or prompt_forbids_catalog_hardware(prompt):
        body += (
            "- Mount electronics with printed bosses, clips, or straps — no McMaster screws or inserts."
        )
    else:
        body += (
            "- Mounting hardware for those electronics (standoffs, M2.5/M3 screws, inserts) must be "
            "McMaster catalog STEPs, not reprinted solids."
        )
    return body


def format_context_packet(
    context: dict[str, Any] | None,
    project_path: Path,
    *,
    prompt: str = "",
) -> str:
    """Serialize @links / DXF / components / photos for any CAD harness."""
    ctx = context or {}
    parts: list[str] = []
    brief = str(ctx.get("cad_brief") or "").strip()
    if brief:
        parts.append("CAD brief (hardware + design contract):\n" + brief[:12000])
    if ctx.get("cad_debug"):
        from backend.services.cad_debug_prompt import CAD_DEBUG_MARKER

        debug_system = str(ctx.get("cad_debug_system") or "").strip()
        if debug_system:
            parts.append(debug_system)
        debug_brief = str(ctx.get("cad_debug_brief") or "").strip()
        user_prompt_preview = prompt or str(ctx.get("user_prompt") or "")
        if debug_brief and CAD_DEBUG_MARKER not in user_prompt_preview:
            parts.append(debug_brief[:6000])
    user_prompt = prompt or str(ctx.get("user_prompt") or "")
    electronics_on = bool(ctx.get("model_electronics", True))
    elec = ""
    if ctx.get("preserve_existing_electronics"):
        parts.append(
            "Existing project electronics and wiring are already complete. Preserve them unchanged. "
            "Do not regenerate electronics_parts.json, redesign the circuit, or add wiring work unless the user explicitly requested an electrical change."
        )
    else:
        from backend.services.electronics_build import authoring_rules
        parts.append(authoring_rules(electronics_on))
        elec = electronics_authoring_rules(
            user_prompt,
            enabled=electronics_on,
            use_mcmaster_parts=ctx.get("use_mcmaster_parts", True) is not False,
        )
        if elec:
            parts.append(elec)
    guidance = str(ctx.get("reference_edit_guidance") or "").strip()
    if guidance:
        parts.append(f"Reference edit guidance:\n{guidance}")
    mate = str(ctx.get("cad_mate_guidance") or "").strip()
    if mate:
        parts.append(f"Model-to-CAD guidance:\n{mate}")
    cross = ctx.get("cross_engine_base")
    if isinstance(cross, dict) and cross.get("source_engine"):
        parts.append(
            "Cross-harness selected object (made with "
            f"{cross.get('source_label')}). Import its published STEP/GLB; "
            "do not execute that harness's generator.\n"
            f"- step={cross.get('step') or 'none'}\n"
            f"- glb={cross.get('glb') or 'none'}\n"
            f"- file={cross.get('filename') or ''}"
        )
    selection_context = str(ctx.get("selected_geometry_context") or "").strip()
    if selection_context:
        parts.append(selection_context)
    recent = ctx.get("recent_design_context") or []
    if recent:
        lines = []
        for row in recent[:8]:
            if not isinstance(row, dict):
                continue
            mode = str(row.get("target_mode") or "request").upper()
            prompt_text = " ".join(str(row.get("prompt") or "").split())[:1200]
            if prompt_text:
                lines.append(f"- {mode}: {prompt_text}")
        if lines:
            parts.append(
                "Recent relevant CAD requests for continuity only. The current request wins on conflict:\n"
                + "\n".join(lines)
            )
    refs = ctx.get("refs") or []
    if refs:
        lines = []
        for ref in refs[:40]:
            if not isinstance(ref, dict):
                continue
            label = ref.get("label") or ref.get("filename") or ref.get("stem") or ref.get("id") or "ref"
            kind = ref.get("type") or "ref"
            extra = []
            if ref.get("filename"):
                extra.append(f"file={ref['filename']}")
            if ref.get("face_index") is not None:
                extra.append(f"face={ref['face_index']}")
            if ref.get("body_name"):
                extra.append(f"body={ref['body_name']}")
            lines.append(f"- [{kind}] {label}" + (f" ({', '.join(extra)})" if extra else ""))
        if lines:
            parts.append("Linked @references:\n" + "\n".join(lines))
    comps = ctx.get("referenced_components") or []
    if comps:
        lines = []
        for comp in comps[:24]:
            if not isinstance(comp, dict):
                continue
            name = comp.get("filename") or comp.get("name") or comp.get("viewer_filename") or "component"
            lines.append(f"- {name}")
        if lines:
            parts.append("Referenced project components:\n" + "\n".join(lines))
    specs = ctx.get("component_specs") or []
    if specs:
        blob = json.dumps(specs[:8], ensure_ascii=True, default=str)
        parts.append(f"Component geometry facts (JSON, truncated):\n{blob[:6000]}")
    cad_files = ctx.get("cad_files") or []
    if cad_files:
        lines = []
        for item in cad_files[:20]:
            if not isinstance(item, dict):
                lines.append(f"- {item}")
                continue
            name = item.get("filename") or item.get("name") or "cad"
            bits = [f"- {name}"]
            if item.get("step") and item.get("step") != name:
                bits.append(f"  step={item['step']}")
            if item.get("size_mm"):
                bits.append(f"  size_mm={item['size_mm']}")
            if item.get("design_guidance"):
                bits.append(f"  {item['design_guidance']}")
            lines.append("\n".join(bits))
        if lines:
            parts.append("CAD reference files (model the NEW part TO these B-reps):\n" + "\n".join(lines))
    dxf_files = ctx.get("dxf_files") or []
    if dxf_files:
        lines = []
        for info in dxf_files[:8]:
            if isinstance(info, dict):
                name = info.get("readable_filename") or info.get("filename") or "drawing.dxf"
                bits = [f"- {name}"]
                src_name = info.get("filename")
                if src_name and src_name != name:
                    bits.append(f"  source={src_name}")
                if info.get("bounds_mm"):
                    bits.append(f"  bounds_mm={info['bounds_mm']}")
                if info.get("layer_count"):
                    bits.append(f"  layer_count={info['layer_count']}")
                if info.get("layers"):
                    bits.append(f"  layers={info['layers']}")
                if info.get("import_hint"):
                    bits.append(
                        f"  File is in the CAD worker cwd. Set dxf_filename = \"{name}\". "
                        f"{info['import_hint']}"
                    )
                excerpt = str(info.get("text_content") or info.get("summary") or "")[:2500]
                if excerpt:
                    bits.append(excerpt)
                if info.get("error"):
                    bits.append(f"  error={info['error']}")
                lines.append("\n".join(bits))
            else:
                lines.append(f"- {info}")
        if lines:
            parts.append("DXF / drawing context:\n" + "\n".join(lines))
    drawing_files = ctx.get("drawing_files") or []
    if drawing_files:
        lines = []
        for info in drawing_files[:8]:
            if isinstance(info, dict):
                name = info.get("filename") or info.get("label") or "drawing.pdf"
                kind = info.get("format") or info.get("type") or "pdf"
                lines.append(f"- {name} ({kind})")
            else:
                lines.append(f"- {info}")
        if lines:
            parts.append(
                "Attached technical drawings (PDF/pages). Treat as dimensioned views, not a single "
                "2D profile to extrude:\n" + "\n".join(lines)
            )
    images = ctx.get("image_refs") or []
    if images:
        labeled = []
        for img in images[:8]:
            if not isinstance(img, dict):
                labeled.append(str(img))
                continue
            name = image_name(img)
            labeled.append(image_caption(img))
        parts.append("Attached images:\n" + "\n".join(f"- {row}" for row in labeled))
    if electronics_on and not elec and not ctx.get("preserve_existing_electronics"):
        parts.append(
            "Electronics preference ON: when the prompt mentions motors/servos/ESC/battery/wiring, "
            "model visible labeled electronics solids and wire runs — not empty pockets alone."
        )
    listing = str(ctx.get("mcmaster_parts_list") or "").strip()
    hardware_on = catalog_hardware_allowed(user_prompt, context=ctx)
    if not listing and hardware_on:
        try:
            from backend.services.cad_service import read_mcmaster_parts_list

            listing = read_mcmaster_parts_list(project_path)
        except Exception:
            listing = ""
    if listing.strip() and hardware_on:
        parts.append(
            "McMaster parts list (buy these PNs; STEPs are on the server):\n" + listing.strip()[:8000]
        )
    kb = ctx.get("knowledge_context") or ctx.get("knowledge") or ""
    if isinstance(kb, str) and kb.strip():
        parts.append(f"Knowledge base excerpt:\n{kb.strip()[:4000]}")
    elif isinstance(kb, dict) and kb:
        parts.append(f"Knowledge base:\n{json.dumps(kb, ensure_ascii=True, default=str)[:4000]}")
    step_names = sorted(
        {
            *(p.name for p in Path(project_path).glob("*.step")),
            *(p.name for p in Path(project_path).glob("*.stp")),
        }
    )[:30]
    if step_names:
        parts.append(
            "Available STEP files for input_objects / inputs[]:\n"
            + "\n".join(f"- {name}" for name in step_names)
        )
    inventory_md = format_parts_inventory_markdown(project_parts_inventory(project_path))
    if inventory_md:
        parts.append(inventory_md)
        parts.append(SIBLING_PARTS_INSTRUCTIONS)
    try:
        from backend.services.hardware_insert_service import mcmaster_context_lines

        hw_lines = mcmaster_context_lines(project_path)
        if hw_lines and hardware_on:
            parts.append("\n".join(hw_lines))
    except Exception:
        pass
    parts.append(hardware_authoring_rules(user_prompt, context=ctx))
    parts.append(joints_authoring_rules(user_prompt))
    from backend.services.parts_workspace import context_text
    parts.append(context_text(project_path))
    from backend.services.parts_sourcing_policy import PARTS_SOURCING_RULES, UNRESOLVED_PURCHASED_INTERFACE_RULES
    parts.append(PARTS_SOURCING_RULES)
    parts.append(UNRESOLVED_PURCHASED_INTERFACE_RULES)
    sourcing_skill = Path(__file__).parent.parent / "skills" / "parts-replacement" / "SKILL.md"
    if sourcing_skill.is_file():
        parts.append(sourcing_skill.read_text())
    base_name = ctx.get("base_filename") or ctx.get("base")
    if base_name:
        from backend.services.model_followups import context_text as model_followup_context
        followup_text = model_followup_context(project_path, base_name)
        if followup_text:
            parts.append(followup_text)
        existing_joints = load_harness_joints(project_path, stem=str(Path(str(base_name)).with_suffix("")))
        if existing_joints:
            parts.append("Existing model joints (preserve during edits; update affected pivots and names):\n" + json.dumps(existing_joints))
    return "\n\n".join(parts).strip()


def project_parts_inventory(project_path: Path, *, limit: int = 24) -> list[dict[str, Any]]:
    """STEP/GLB/STL already in the project, with bbox when a GLB preview exists."""
    root = Path(project_path)
    if not root.is_dir():
        return []
    skip = {".generation-live.", "_snapshot", "_edited"}
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    scan_dirs = [root]
    lib = root / "mcmaster_library"
    if lib.is_dir():
        scan_dirs.append(lib)
    from backend.services.engine_layout import ENGINE_FOLDERS, project_rel

    for folder in ENGINE_FOLDERS:
        engine_dir = root / folder
        if engine_dir.is_dir():
            scan_dirs.append(engine_dir)
    for folder in scan_dirs:
        for path in sorted(folder.iterdir()):
            if not path.is_file() or path.name.startswith("."):
                continue
            suf = path.suffix.lower()
            if suf not in {".step", ".stp", ".glb", ".stl"}:
                continue
            lower = path.name.lower()
            if any(token in lower for token in skip):
                continue
            key = path.name.lower()
            if key in seen:
                continue
            seen.add(key)
            rel = path.name if folder == root else f"{folder.name}/{path.name}"
            item: dict[str, Any] = {
                "filename": path.name,
                "relpath": rel,
                "format": suf.lstrip("."),
                "bytes": path.stat().st_size,
            }
            if folder != root:
                item["source"] = "mcmaster_library"
            glb = path if suf == ".glb" else path.with_suffix(".glb")
            if not glb.is_file() and folder != root:
                root_glb = root / path.with_suffix(".glb").name
                if root_glb.is_file():
                    glb = root_glb
            if glb.is_file():
                try:
                    import trimesh

                    scene = trimesh.load(str(glb), force="scene")
                    bounds = getattr(scene, "bounds", None)
                    if bounds is not None:
                        from backend.services.json_finite import finite_number

                        mn, mx = bounds
                        size = [round(finite_number(mx[i]) - finite_number(mn[i]), 2) for i in range(3)]
                        if all(abs(v) < 1e30 for v in size):
                            item["bbox_mm"] = size
                            item["center_mm"] = [
                                round((finite_number(mn[i]) + finite_number(mx[i])) / 2, 2) for i in range(3)
                            ]
                except Exception:
                    pass
            items.append(item)
            if len(items) >= limit:
                return items
    return items


def format_parts_inventory_markdown(parts: list[dict[str, Any]] | None) -> str:
    rows = [p for p in (parts or []) if isinstance(p, dict) and p.get("filename")]
    if not rows:
        return ""
    lines = ["Existing project parts (keep in place — author only the new solid):"]
    for item in rows:
        extra = []
        shown = str(item.get("relpath") or item.get("filename") or "")
        if item.get("bbox_mm"):
            extra.append(f"size_mm={item['bbox_mm']}")
        if item.get("center_mm"):
            extra.append(f"center_mm={item['center_mm']}")
        if item.get("source") == "mcmaster_library":
            extra.append("McMaster catalog STEP")
        lines.append(f"- {shown}" + (f" ({', '.join(extra)})" if extra else ""))
    return "\n".join(lines)


def stage_project_drawings(project_path: Path, work: Path) -> list[str]:
    """Copy project DXF/SVG into an isolated worker cwd so import_dxf() works like Jake."""
    staged: list[str] = []
    for pattern in ("*.dxf", "*.svg"):
        for src in sorted(Path(project_path).glob(pattern)):
            if not src.is_file():
                continue
            try:
                if src.stat().st_size > 40 * 1024 * 1024:
                    continue
            except OSError:
                continue
            dest = Path(work) / src.name
            try:
                if dest.resolve() == src.resolve():
                    continue
            except OSError:
                continue
            shutil.copy2(src, dest)
            staged.append(src.name)
            if len(staged) >= 12:
                return staged
    return staged


def write_prompt_images(work: Path, images: list[Any] | None) -> list[dict[str, str]]:
    """Write attached prompt images into ``work/ref_images`` for any harness cwd."""
    out: list[dict[str, str]] = []
    dest_dir = Path(work) / "ref_images"
    for index, img in enumerate((images or [])[:8]):
        if not isinstance(img, dict):
            continue
        data_url = str(img.get("data_url") or "")
        if ";base64," not in data_url:
            continue
        header, b64 = data_url.split(";base64,", 1)
        media = "image/jpeg"
        if header.startswith("data:image/"):
            media = header[len("data:") :].split(";")[0].strip() or media
        if media == "image/jpg":
            media = "image/jpeg"
        ext = ".jpg"
        if "png" in media:
            ext = ".png"
        elif "webp" in media:
            ext = ".webp"
        raw_name = Path(str(img.get("name") or f"reference-{index + 1}{ext}")).name
        if not raw_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            raw_name = Path(raw_name).stem + ext
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / raw_name
        try:
            dest.write_bytes(base64.b64decode(b64.strip()))
        except Exception:
            continue
        out.append({"name": raw_name, "path": str(dest), "media_type": media})
    return out


def enrich_user_request(
    prompt: str,
    context: dict[str, Any] | None,
    project_path: Path,
    *,
    images: list[Any] | None = None,
    previous_source: str | None = None,
) -> str:
    """Jake-parity user message: prompt + @refs/DXF/photos + edit source."""
    parts: list[str] = [str(prompt or "").strip()]
    packet = format_context_packet(context, project_path, prompt=prompt)
    if packet:
        parts.append(packet)
    has_drawings = bool((context or {}).get("dxf_files") or (context or {}).get("image_refs") or images)
    if has_drawings:
        parts.append(PHOTO_AND_DXF_INSTRUCTIONS)
        image_names = [
            str(img.get("name") or img.get("id") or "image")
            for img in (images or [])[:8]
            if isinstance(img, dict)
        ]
        if image_names:
            from backend.services.prompt_references import image_caption

            parts.append("Vision files in cwd/ref_images:\n" + "\n".join(f"- {image_caption(n)}" for n in image_names))
    if previous_source:
        parts.append(
            "Existing source (edit surgically; keep working geometry):\n"
            f"```python\n{str(previous_source)[:12000]}\n```"
        )
    write_project_parts_md(project_path)
    return "\n\n".join(part for part in parts if part)


def sibling_parts_block(
    project_path: Path,
    prompt: str = "",
    *,
    context: dict[str, Any] | None = None,
) -> str:
    """Inventory + rearrange/McMaster instructions for engines that build their own prompt."""
    chunks: list[str] = []
    inventory_md = format_parts_inventory_markdown(project_parts_inventory(project_path))
    if inventory_md:
        chunks.append(inventory_md)
        chunks.append(SIBLING_PARTS_INSTRUCTIONS)
    chunks.append(hardware_authoring_rules(prompt, context=context))
    chunks.append(joints_authoring_rules(prompt))
    hardware_on = catalog_hardware_allowed(prompt, context=context)
    if hardware_on:
        try:
            from backend.services.cad_service import read_mcmaster_parts_list

            listing = read_mcmaster_parts_list(project_path)
            if listing.strip():
                chunks.append("McMaster parts list (buy these PNs online):\n" + listing.strip()[:8000])
        except Exception:
            pass
    write_project_parts_md(project_path)
    return "\n\n".join(chunks)


def write_project_parts_md(project_path: Path) -> Path | None:
    """Keep PROJECT_PARTS.md in sync so every harness sees the same inventory file."""
    root = Path(project_path)
    if not root.is_dir():
        return None
    inventory_md = format_parts_inventory_markdown(project_parts_inventory(root))
    body = inventory_md.strip() or "No sibling STEP/GLB files in this project yet."
    text = "# Project parts\n\n" + body + "\n\n" + SIBLING_PARTS_INSTRUCTIONS + "\n"
    dest = root / PROJECT_PARTS_FILENAME
    try:
        dest.write_text(text, encoding="utf-8")
    except OSError:
        return None
    return dest


def apply_mcmaster_used_file(project_path: Path) -> list[dict[str, Any]]:
    """Honor `r3d_mcmaster_used.json` so the parts list matches what the model imported."""
    root = Path(project_path)
    spec_path = root / MCMASTER_USED_FILENAME
    if not spec_path.is_file():
        return []
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    used = spec.get("used") if isinstance(spec, dict) else spec
    if not isinstance(used, list):
        used = []
    rows: list[dict[str, Any]] = []
    for raw in used[:40]:
        if not isinstance(raw, dict):
            continue
        pn = str(raw.get("part_number") or raw.get("pn") or "").strip()
        if not pn:
            continue
        rows.append(
            {
                "part_number": pn,
                "filename": str(raw.get("filename") or "").strip(),
                "qty": str(raw.get("qty") or "1"),
                "used_in": str(raw.get("used_in") or "").strip(),
                "description": str(raw.get("description") or "").strip(),
            }
        )
    try:
        spec_path.unlink()
    except OSError:
        pass
    if not rows:
        return []
    try:
        from backend.services.cad_service import mark_mcmaster_parts_used

        mark_mcmaster_parts_used(root, rows)
    except Exception:
        pass
    return rows


def finalize_harness_run(
    project_path: Path,
    *,
    published_step: str | Path | None = None,
    is_edit: bool = False,
    place_assembly: bool | None = None,
    joints: Any = None,
    parts_list: Any = None,
) -> dict[str, Any]:
    """Apply sibling placements + used McMaster list after any engine succeeds."""
    root = Path(project_path)
    if isinstance(parts_list, (dict, list)):
        from backend.services.parts_workspace import clean_part, get_workspace, save_questions
        raw_parts = parts_list.get("parts", []) if isinstance(parts_list, dict) else parts_list
        if isinstance(raw_parts, list):
            normalized = []
            for raw in raw_parts[:500]:
                if isinstance(raw, dict):
                    try:
                        normalized.append(clean_part(raw))
                    except (ValueError, TypeError):
                        continue
            (root / "parts_list.json").write_text(json.dumps({"parts": normalized}, indent=2))
            get_workspace(root)
        if isinstance(parts_list, dict) and isinstance(parts_list.get("questions"), list):
            save_questions(root, parts_list["questions"])
    # Codex-hosted and agent harnesses can publish the list in their manifest
    # instead of a return value. Import that path too after successful output.
    from backend.services.parts_workspace import get_workspace
    get_workspace(root)
    write_project_parts_md(root)
    placements: list[dict[str, Any]] = []
    try:
        from backend.services.cad_service import apply_project_placements

        placements = apply_project_placements(root) or []
    except Exception:
        placements = []
    used: list[dict[str, Any]] = []
    try:
        used = apply_mcmaster_used_file(root) or []
    except Exception:
        used = []
    joints_info: dict[str, Any] = {}
    try:
        step_name = Path(published_step) if published_step else None
        if step_name and step_name.is_absolute():
            step_name = step_name.relative_to(root)
        stem = step_name.with_suffix("").as_posix() if step_name else None
        joints_info = apply_harness_joints(
            root,
            joints,
            published_step=published_step,
            stem=stem,
        ) or {}
    except Exception as exc:
        logger.debug("Harness joints apply skipped: %s", exc)
        joints_info = {"ok": False, "error": str(exc)[:400]}
    assembly_place: dict[str, Any] = {}
    if place_assembly is None:
        place_assembly = not is_edit
    if place_assembly:
        try:
            from backend.services.freecad_engine import place_new_part_beside_assembly

            assembly_place = place_new_part_beside_assembly(root, published_step) or {}
        except Exception as exc:
            logger.debug("FreeCAD place-beside skipped: %s", exc)
            assembly_place = {"ok": False, "error": str(exc)[:400]}
    inspection = {"status": "unverified", "all_passed": False}
    if published_step:
        try:
            from backend.services.cad_inspection import prepare_inspection
            inspection = prepare_inspection(root, published_step)
        except (OSError, ValueError) as exc:
            inspection["error"] = str(exc)[:400]
    return {
        "inspection": inspection,
        "placements": placements,
        "mcmaster_used": used,
        "assembly_place": assembly_place,
        "joints": joints_info,
    }


def apply_mcmaster_from_brief(
    project_path: Path,
    *,
    cad_brief: str,
    user_prompt: str,
    context: dict[str, Any] | None = None,
    is_edit: bool = False,
    progress_callback=None,
    cancel_check=None,
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Sync parts_list.md from the CAD brief and fetch listed STEPs onto the server.

    Shared by Jake, VibeCAD, and MAC so every harness gets the same hardware path.
    """
    from backend.services import cad_service
    from backend.services.trace_log import add as trace_add

    brief_context = dict(context or {})
    if cancel_check and cancel_check():
        raise RuntimeError("Generation canceled.")
    brief_context["cad_brief"] = str(cad_brief or "")
    brief_context["user_prompt"] = str(user_prompt or "")
    if not catalog_hardware_allowed(user_prompt, context=brief_context):
        write_project_parts_md(project_path)
        reason = (
            "disabled"
            if brief_context.get("use_mcmaster_parts") is False
            else "print_only"
        )
        return {"context": brief_context, "mcmaster": {"skipped": True, "reason": reason}}
    try:
        existing_parts_list = cad_service.read_mcmaster_parts_list(project_path)
    except Exception:
        existing_parts_list = ""
    if existing_parts_list:
        brief_context["mcmaster_parts_list"] = existing_parts_list[:20000]
    try:
        brief_context["project_parts"] = project_parts_inventory(project_path)
    except Exception:
        pass

    mcmaster_sync: dict[str, Any] = {}
    try:
        mcmaster_sync = cad_service.sync_mcmaster_parts_list(
            project_path,
            cad_brief=cad_brief,
            user_prompt=user_prompt,
            is_edit=bool(is_edit),
        )
        if mcmaster_sync.get("markdown"):
            brief_context["mcmaster_parts_list"] = mcmaster_sync["markdown"][:20000]
            refs = list(brief_context.get("refs") or [])
            parts_name = str(mcmaster_sync.get("filename") or "parts_list.md")
            already = any(
                isinstance(r, dict)
                and Path(str(r.get("filename") or "")).name.lower() == parts_name.lower()
                for r in refs
            )
            if not already:
                refs.append(
                    {
                        "id": "mcmaster-parts-list",
                        "type": "spec",
                        "filename": parts_name,
                        "stem": Path(parts_name).stem,
                        "label": "McMaster parts list",
                        "format": "md",
                        "folder": "McMaster",
                        "text_content": str(mcmaster_sync.get("markdown") or "")[:60000],
                        "mcmaster_parts_list": True,
                    }
                )
                brief_context["refs"] = refs
        trace_add(
            "info",
            f"[McMaster] Synced {mcmaster_sync.get('path')} "
            f"({mcmaster_sync.get('count', 0)} active part numbers).",
            trace_id=trace_id,
            data={"path": mcmaster_sync.get("path"), "count": mcmaster_sync.get("count")},
        )
        if progress_callback:
            from backend.services.mcmaster_fetch_service import push_mcmaster_progress

            push_mcmaster_progress(
                progress_callback,
                project_path,
                stage="hardware",
                pct=12,
                label=f"McMaster · {mcmaster_sync.get('count', 0)}/{mcmaster_sync.get('count', 0) or 0} parts listed…",
            )
        try:
            from backend.services.mcmaster_fetch_service import (
                fetch_listed_parts_for_project,
                looks_like_part_number,
            )

            rows = list(mcmaster_sync.get("rows") or [])
            has_pn = any(
                looks_like_part_number(str(row.get("part_number") or ""))
                and str(row.get("status") or "").lower() != "removed"
                for row in rows
            )
            blob = f"{user_prompt}\n{cad_brief}".lower()
            wants_hw = prompt_wants_electronics_or_wiring(user_prompt) or any(
                tok in blob for tok in ("chassis", "robot", "mount", "base", "caster", "wheel")
            )
            if not has_pn and wants_hw:
                starter = (
                    ("91292A126", "18-8 socket head screw, M5 × 16 mm"),
                    ("91292A144", "18-8 socket head screw, M5"),
                    ("94180A361", "Heat-set threaded insert"),
                    ("90576A119", "Nylon-insert locknut, M12"),
                    ("93475A250", "McMaster catalog hardware"),
                )
                for pn, desc in starter:
                    cad_service.upsert_mcmaster_part(
                        project_path,
                        pn,
                        status="planned",
                        description=desc,
                        buy_url=cad_service.mcmaster_buy_url(pn),
                    )
                rows = cad_service.parse_mcmaster_parts_rows(
                    cad_service.read_mcmaster_parts_list(project_path)
                )
                if progress_callback:
                    push_mcmaster_progress(
                        progress_callback,
                        project_path,
                        stage="hardware",
                        pct=12,
                        label="McMaster · seeding catalog hardware for live viewport…",
                    )

            fetch_out = fetch_listed_parts_for_project(
                project_path,
                rows=rows,
                progress_callback=progress_callback,
                cancel_check=cancel_check,
                fetch_attempts=1,
            )
            n_ok = int(fetch_out.get("count") or 0)
            n_err = len(fetch_out.get("errors") or [])
            if n_ok or n_err:
                trace_add(
                    "info",
                    f"[McMaster] Server crawler fetched {n_ok} STEP file(s)"
                    + (f", {n_err} failed" if n_err else "")
                    + ".",
                    trace_id=trace_id,
                    data={"fetched": n_ok, "errors": fetch_out.get("errors") or []},
                )
            if mcmaster_sync.get("markdown"):
                brief_context["mcmaster_parts_list"] = cad_service.read_mcmaster_parts_list(
                    project_path
                )[:20000]
        except Exception as fetch_exc:
            logger.warning("McMaster server STEP fetch failed: %s", fetch_exc)
            trace_add(
                "warning",
                f"[McMaster] Server STEP fetch failed: {fetch_exc}",
                trace_id=trace_id,
            )
    except Exception as exc:
        logger.warning("McMaster parts list sync failed: %s", exc)
        trace_add("warning", f"[McMaster] Parts list sync failed: {exc}", trace_id=trace_id)

    brief_context["cad_brief"] = str(cad_brief or "")
    brief_context["user_prompt"] = str(user_prompt or "")
    write_project_parts_md(project_path)
    return {"context": brief_context, "mcmaster": mcmaster_sync}


def prepare_harness_hardware(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: Any,
    *,
    images: list[Any] | None = None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check=None,
    progress_callback=None,
    usage_callback=None,
    trace_id: str | None = None,
) -> dict[str, Any]:
    """CAD brief + McMaster parts list + server STEP fetch for VibeCAD / MAC (and any engine without its own brief)."""
    from backend.services.trace_log import add as trace_add

    if cancel_check and cancel_check():
        raise RuntimeError("Generation canceled.")
    is_edit = bool(previous_source) or str((context or {}).get("target_mode") or "").lower() == "edit"
    brief_context = dict(context or {})
    try:
        from backend.services import cad_service

        existing_parts_list = cad_service.read_mcmaster_parts_list(project_path)
    except Exception:
        existing_parts_list = ""
    if existing_parts_list:
        brief_context["mcmaster_parts_list"] = existing_parts_list[:20000]
    try:
        brief_context["project_parts"] = project_parts_inventory(project_path)
    except Exception:
        pass
    brief_context["user_prompt"] = str(prompt or "")

    handoff = Path(project_path) / ".vibecad_handoff.json"
    if handoff.is_file():
        existing_brief = ""
        for brief_path in Path(project_path).glob("*.brief.md"):
            try:
                existing_brief = brief_path.read_text(encoding="utf-8")
                break
            except OSError:
                continue
        cad_brief = existing_brief.strip() or existing_parts_list.strip() or "CAD brief:\n"
        if not cad_brief.lower().startswith("cad brief"):
            cad_brief = f"CAD brief:\n{cad_brief}"
        if progress_callback:
            progress_callback(
                {
                    "stage": "step",
                    "pct": 16,
                    "label": "VibeCAD · compiling authored source…",
                    "thinking": "VibeCAD · compiling authored source…",
                }
            )
        applied = apply_mcmaster_from_brief(
            project_path,
            cad_brief=cad_brief,
            user_prompt=prompt,
            context=brief_context,
            is_edit=is_edit,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
            trace_id=trace_id,
        )
        return {
            "context": applied.get("context") or brief_context,
            "cad_brief": cad_brief,
            "ai_traces": [],
            "mcmaster": applied.get("mcmaster") or {},
        }

    hardware_on = catalog_hardware_allowed(prompt, context=brief_context)
    if progress_callback and hardware_on:
        progress_callback(
            {
                "stage": "hardware",
                "pct": 8,
                "label": "McMaster · fetch catalog STEPs before drawing…",
                "thinking": "McMaster · fetch catalog STEPs before drawing…",
            }
        )

    generation_prompt = str(prompt or "").strip()
    if previous_source and hardware_on:
        generation_prompt += (
            "\n\nThis is a generative edit of an existing model. "
            "Append newly required McMaster part numbers and note removals."
        )
    cad_brief, brief_trace = ai.generate_cad_brief(
        generation_prompt,
        brief_context,
        trace_id=trace_id,
        images=images,
    )
    ai_traces = [brief_trace] if isinstance(brief_trace, dict) else []
    if usage_callback and ai_traces:
        try:
            usage_callback(list(ai_traces))
        except Exception:
            pass
    if cancel_check and cancel_check():
        raise RuntimeError("Generation canceled.")

    try:
        from backend.services.project_store import file_stem_from_prompt

        base = Path(previous_source_name).stem if previous_source_name else ""
        if not base:
            base = file_stem_from_prompt(prompt) or "cad"
    except Exception:
        base = "cad"
    try:
        (Path(project_path) / f"{base}.brief.md").write_text(
            str(cad_brief).rstrip() + "\n", encoding="utf-8"
        )
    except OSError as exc:
        logger.warning("Could not write CAD brief: %s", exc)

    applied = apply_mcmaster_from_brief(
        project_path,
        cad_brief=cad_brief,
        user_prompt=prompt,
        context=brief_context,
        is_edit=is_edit,
        progress_callback=progress_callback,
        cancel_check=cancel_check,
        trace_id=trace_id,
    )
    trace_add(
        "info",
        "[McMaster] Hardware brief prepared for CAD harness.",
        trace_id=trace_id,
        data={"count": (applied.get("mcmaster") or {}).get("count")},
    )
    return {
        "context": applied.get("context") or brief_context,
        "cad_brief": cad_brief,
        "ai_traces": ai_traces,
        "mcmaster": applied.get("mcmaster") or {},
    }


def merge_hardware_ai_traces(
    result: dict[str, Any] | None,
    traces: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    payload = dict(result or {})
    extra = [t for t in (traces or []) if isinstance(t, dict)]
    if not extra:
        return payload
    existing = payload.get("ai_trace")
    if existing is None:
        existing = payload.get("ai_traces")
    if not isinstance(existing, list):
        existing = [existing] if existing else []
    payload["ai_trace"] = extra + [t for t in existing if isinstance(t, dict)]
    return payload
