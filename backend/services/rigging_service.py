"""AI-assisted robot rigging / URDF skeleton generation."""

from __future__ import annotations

import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from backend.services.ai_service import AIService
from backend.services.prompt_language import with_multilingual_prompt_rule

RIGGING_SYSTEM_PROMPT = with_multilingual_prompt_rule("""You are Render Studio's robot rigging engine for URDF-style kinematic chains.

Given a user brief (and optional reference photo of a robot arm or mechanism),
produce a bone hierarchy and optional keyframe animation the Rigging editor can load.

Reply with ONE JSON object only — no markdown, no prose outside JSON.

Schema:
{
  "name": "Robot arm rig",
  "bones": [
    {
      "id": "bone_base",
      "name": "base_link",
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "parentId": null,
      "jointType": "fixed",
      "jointAxis": [0, 0, 1],
      "limits": { "lower": -3.14, "upper": 3.14 }
    },
    {
      "id": "bone_j1",
      "name": "link_1",
      "position": [0, 0, 0.15],
      "rotation": [0, 0, 0],
      "parentId": "bone_base",
      "jointType": "revolute",
      "jointAxis": [0, 0, 1],
      "limits": { "lower": -2.8, "upper": 2.8 }
    }
  ],
  "animations": [
    {
      "id": "anim_demo",
      "name": "Demo motion",
      "duration": 4,
      "fps": 30,
      "keyframes": [
        { "time": 0, "poses": { "bone_j1": { "position": [0,0,0.15], "rotation": [0,0,0] } } },
        { "time": 2, "poses": { "bone_j1": { "position": [0,0,0.15], "rotation": [0,0,1.2] } } },
        { "time": 4, "poses": { "bone_j1": { "position": [0,0,0.15], "rotation": [0,0,0] } } }
      ]
    }
  ],
  "activeAnimationId": "anim_demo",
  "notes": ["assembly tip 1"]
}

Rules:
- Use URDF-style link names: base_link, link_1, link_2, ee_link, etc.
- Root bone has parentId null and jointType "fixed".
- Child joints default to "revolute" with axis [0,0,1] unless the brief specifies otherwise.
- Positions are in meters, Z-up, matching Render Studio viewport.
- Stack links along the kinematic chain; position is offset from parent frame.
- Include at least one animation with 2+ keyframes when motion is described.
- Keyframe poses must include rotation (and position if changed) per affected bone id.
- If editing an existing rig, preserve bone ids when possible.
- limits.lower/upper in radians for revolute joints.
- When the brief names an existing viewport model (purse, lid, door), add a simple
  open/close hinge or slider on that part. Do not invent a new robot arm unless asked.
- Wheel / holonomic / drive briefs: child joints on wheels must be revolute or
  continuous (never all-fixed mates). Do not emit dummy URDF collision/visual
  spheres or placeholder balls — bind the existing CAD mesh.
- Include at least one Play clip whose keyframes move those wheel joints.
- Never return empty bones for an open/close / hinge / lid / purse brief. The CAD
  “empty collections mean do not delete” rule does not apply to rigging JSON.
""")


def _as_vec3(value: Any, default: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> list[float]:
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        return [float(value[0]), float(value[1]), float(value[2])]
    if isinstance(value, dict):
        return [
            float(value.get("x", value.get("0", default[0]))),
            float(value.get("y", value.get("1", default[1]))),
            float(value.get("z", value.get("2", default[2]))),
        ]
    return list(default)


def _normalize_pose(raw: dict[str, Any] | None, fallback: dict[str, Any] | None = None) -> dict[str, list[float]]:
    fb = fallback or {}
    return {
        "position": _as_vec3((raw or {}).get("position"), tuple(_as_vec3(fb.get("position")))),
        "rotation": _as_vec3((raw or {}).get("rotation"), tuple(_as_vec3(fb.get("rotation")))),
    }


def _normalize_bone(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id") or f"bone_{raw.get('name', 'link')}",
        "name": raw.get("name") or "link",
        "position": _as_vec3(raw.get("position")),
        "rotation": _as_vec3(raw.get("rotation")),
        "parentId": raw.get("parentId"),
        "jointType": raw.get("jointType") or "revolute",
        "jointAxis": _as_vec3(raw.get("jointAxis"), (0.0, 0.0, 1.0)),
        "limits": raw.get("limits") or {"lower": -3.14, "upper": 3.14},
    }


def _normalize_animations(animations: list[dict[str, Any]], bones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {b["id"]: b for b in bones}
    out: list[dict[str, Any]] = []
    for anim in animations:
        keyframes = []
        for kf in anim.get("keyframes") or []:
            poses = {
                bone_id: _normalize_pose(pose, by_id.get(bone_id))
                for bone_id, pose in (kf.get("poses") or {}).items()
            }
            keyframes.append({**kf, "poses": poses})
        out.append({**anim, "keyframes": keyframes})
    return out


def _normalize_rig(raw: dict[str, Any]) -> dict[str, Any]:
    bones = [_normalize_bone(b) for b in (raw.get("bones") or [])]
    animations = raw.get("animations") or []
    if not animations and bones:
        poses = {b["id"]: {"position": b["position"], "rotation": b["rotation"]} for b in bones}
        animations = [
            {
                "id": "anim_default",
                "name": "Animation 1",
                "duration": 5,
                "fps": 30,
                "keyframes": [{"time": 0, "poses": poses}],
            }
        ]
    else:
        animations = _normalize_animations(animations, bones)
    return {
        "name": raw.get("name") or "Rig",
        "bones": bones,
        "animations": animations,
        "activeAnimationId": raw.get("activeAnimationId") or (animations[0]["id"] if animations else None),
        "notes": raw.get("notes") if isinstance(raw.get("notes"), list) else [],
    }


_BONE_PART_ALIASES = {
    "base_link": "base_plate",
    "gear_1_link": "gear_input",
    "gear_2_link": "gear_output",
    "gear_1": "gear_input",
    "gear_2": "gear_output",
}


def _part_id_for_bone(bone: dict[str, Any]) -> str | None:
    name = str(bone.get("name") or "").lower()
    if name in _BONE_PART_ALIASES:
        return _BONE_PART_ALIASES[name]
    if name.endswith("_link"):
        stem = name[:-5]
        if "gear" in stem and "1" in stem:
            return "gear_input"
        if "gear" in stem and "2" in stem:
            return "gear_output"
        return stem
    return name or None


def _joint_anchor_m(joint: dict[str, Any], *, length_unit: str = "mm") -> list[float]:
    from backend.services.urdf_acceptance import finite_vector, length_scale

    if joint.get("anchor_m") is not None:
        return finite_vector(joint["anchor_m"])
    if joint.get("anchor_mm") is not None:
        return [value * 0.001 for value in finite_vector(joint["anchor_mm"])]
    return [value * length_scale(length_unit) for value in finite_vector(joint.get("anchor", [0, 0, 0]))]


def align_rig_from_sim(rig: dict[str, Any], sim: dict[str, Any]) -> dict[str, Any]:
    """Snap revolute bone frames to sim joint anchors (gear trains, assemblies)."""
    joints_by_child = {j.get("child"): j for j in (sim.get("joints") or []) if j.get("child")}
    bones = rig.get("bones") or []
    by_id = {b["id"]: b for b in bones}
    base_bone = next((b for b in bones if not b.get("parentId")), None)
    base_anchor = [0.0, 0.0, 0.0]
    if base_bone:
        part_id = _part_id_for_bone(base_bone)
        if part_id and part_id in joints_by_child:
            base_anchor = _joint_anchor_m(joints_by_child[part_id])
        base_bone["position"] = [0.0, 0.0, 0.0]

    for bone in bones:
        if bone.get("jointType") == "fixed" or not bone.get("parentId"):
            continue
        part_id = _part_id_for_bone(bone)
        joint = joints_by_child.get(part_id) if part_id else None
        if not joint:
            continue
        anchor = _joint_anchor_m(joint)
        bone["position"] = [
            anchor[0] - base_anchor[0],
            anchor[1] - base_anchor[1],
            anchor[2] - base_anchor[2],
        ]
        bone["jointAxis"] = _as_vec3(joint.get("axis"), (0.0, 0.0, 1.0))

    for anim in rig.get("animations") or []:
        for kf in anim.get("keyframes") or []:
            poses = kf.get("poses") or {}
            for bone_id, pose in list(poses.items()):
                bone = by_id.get(bone_id)
                if not bone:
                    continue
                merged = _normalize_pose(pose, bone)
                merged["position"] = list(bone["position"])
                poses[bone_id] = merged

    return _normalize_rig(rig)


def demo_gear_train_rigging(
    teeth: list[int] | None = None,
    *,
    module: float = 2.0,
    thickness: float = 8.0,
) -> dict[str, Any]:
    """Deterministic 2-gear mount rig aligned to gear_train_program layout (meters, Z-up)."""
    from backend.engineering.gears import center_distance

    z1, z2 = (teeth or [20, 20])[:2]
    cd_m = center_distance(module, z1, z2) / 1000.0
    shaft_z = thickness / 2000.0
    full_turn = 2 * 3.141592653589793
    driven_turn = -full_turn * (z1 / z2)

    bones = [
        {
            "id": "bone_base",
            "name": "base_link",
            "position": [0.0, 0.0, 0.0],
            "rotation": [0.0, 0.0, 0.0],
            "parentId": None,
            "jointType": "fixed",
            "jointAxis": [0.0, 0.0, 1.0],
            "limits": {"lower": 0.0, "upper": 0.0},
        },
        {
            "id": "bone_gear1",
            "name": "gear_input",
            "position": [0.0, 0.0, shaft_z],
            "rotation": [0.0, 0.0, 0.0],
            "parentId": "bone_base",
            "jointType": "revolute",
            "jointAxis": [0.0, 0.0, 1.0],
            "limits": {"lower": -6.28, "upper": 6.28},
        },
        {
            "id": "bone_gear2",
            "name": "gear_output",
            "position": [cd_m, 0.0, shaft_z],
            "rotation": [0.0, 0.0, 0.0],
            "parentId": "bone_base",
            "jointType": "revolute",
            "jointAxis": [0.0, 0.0, 1.0],
            "limits": {"lower": -6.28, "upper": 6.28},
        },
    ]
    poses_home = {
        "bone_gear1": {"position": [0.0, 0.0, shaft_z], "rotation": [0.0, 0.0, 0.0]},
        "bone_gear2": {"position": [cd_m, 0.0, shaft_z], "rotation": [0.0, 0.0, 0.0]},
    }
    poses_mid = {
        "bone_gear1": {"position": [0.0, 0.0, shaft_z], "rotation": [0.0, 0.0, full_turn]},
        "bone_gear2": {"position": [cd_m, 0.0, shaft_z], "rotation": [0.0, 0.0, driven_turn]},
    }
    return _normalize_rig(
        {
            "name": f"Gear train {z1}:{z2}",
            "bones": bones,
            "activeAnimationId": "anim_spin",
            "animations": [
                {
                    "id": "anim_spin",
                    "name": "Gear spin",
                    "duration": 4.0,
                    "fps": 30,
                    "keyframes": [
                        {"time": 0.0, "poses": poses_home},
                        {"time": 2.0, "poses": poses_mid},
                        {"time": 4.0, "poses": poses_home},
                    ],
                }
            ],
            "notes": [
                "Build the gear geometry in SOLID (Design) first — rigging shows shaft joints as orange spheres, not the gear teeth.",
                f"Driver gear_input at origin; driven gear_output at {cd_m:.3f} m center distance.",
            ],
        }
    )


def infer_rig_kind(text: str) -> str:
    p = str(text or "").lower()
    if re.search(
        r"\b(holonomic|mecanum|omni[\s-]?wheel|caster|wheel(?:s)?\s+drive|drive(?:n)?\s+wheels?|fix(?: the)? wheels|make the wheels)\b",
        p,
    ):
        return "wheels"
    if re.search(r"\b(assembl|explode|step[\s-]?by[\s-]?step|come together|puts itself together)\b", p):
        return "assemble"
    if re.search(r"\b(vortex|tornado|whirl|spin(?:ning)?)\b", p):
        return "vortex"
    if re.search(r"\b(open|close|lid|hinge|purse|door|flap|clamshell)\b", p):
        return "open_close"
    if re.search(r"\b(urdf|srdf|sdrf|udrf|robot|joint limits|base_link)\b", p):
        return "urdf"
    return "custom"


def slug_rig_id(name: str, fallback: str = "rig") -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")[:48]
    return slug or fallback


def upsert_model_rigs_sidecar(
    project_path: Path,
    *,
    target_filename: str | None,
    prompt: str,
    rig: dict[str, Any],
) -> str | None:
    """Append a named rig onto <stem>.rigs.json without replacing existing clips."""
    stem = Path(str(target_filename or "model")).stem or "model"
    path = project_path / f"{stem}.rigs.json"
    existing: dict[str, Any] = {}
    if path.is_file():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = {}
    kind = infer_rig_kind(prompt)
    name = str(rig.get("name") or kind.replace("_", " ")).strip() or kind
    rid = slug_rig_id(name, kind)
    urdf_name = f"{stem}.{rid}.urdf"
    entry = {
        "id": rid,
        "name": name,
        "kind": kind,
        "source": urdf_name,
        "urdfFile": urdf_name,
        "prompt": str(prompt or "")[:400],
    }
    rows = [row for row in (existing.get("rigs") or []) if isinstance(row, dict)]
    replaced = False
    for i, row in enumerate(rows):
        if str(row.get("id") or "") == rid:
            rows[i] = {**row, **entry}
            replaced = True
            break
    if not replaced:
        rows.append(entry)
    payload = {"name": stem, "rigs": rows, "activeRigId": rid}
    urdf_text = rig_to_urdf({**rig, "name": rid})
    from backend.services.urdf_acceptance import capture_dependencies, publish_urdf

    dependencies = []
    if target_filename:
        target = project_path / target_filename
        if target.is_file():
            dependencies.append(target)
    publish_urdf(project_path / urdf_name, urdf_text, project_root=project_path,
                 expected_dependencies=capture_dependencies(project_path, dependencies))
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    try:
        from backend.services.cad_service import (
            clear_deleted_catalogs_for_published,
            revive_tombstoned_assemblies_if_viewport_empty,
        )

        names = [str(target_filename or ""), f"{stem}.glb", urdf_name]
        clear_deleted_catalogs_for_published(project_path, [n for n in names if n])
        revive_tombstoned_assemblies_if_viewport_empty(project_path)
    except Exception:
        pass
    return path.name


def load_project_joints_doc(project_path: Path | None) -> dict[str, Any] | None:
    """First joints / sim payload on disk (root, engine folder, or Joints/)."""
    if not project_path:
        return None
    root = Path(project_path)
    candidates: list[Path] = []
    direct = root / "r3d_joints.json"
    if direct.is_file():
        candidates.append(direct)
    for folder in (root, root / "vibecad", root / "jake", root / "mesh"):
        if folder.is_dir():
            candidates.extend(sorted(folder.glob("*.joints.json")))
            candidates.extend(sorted(folder.glob("*.sim.json")))
    joints_dir = root / "Joints"
    if joints_dir.is_dir():
        candidates.extend(sorted(joints_dir.rglob("*.joints.json")))
    seen: set[Path] = set()
    for path in candidates:
        try:
            key = path.resolve()
        except OSError:
            continue
        if key in seen:
            continue
        seen.add(key)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        rows = data.get("joints") or data.get("assembly_constraints")
        if isinstance(rows, list) and rows:
            return data
    return None


def _joint_limits_rad(joint: dict[str, Any], *, units_deg: bool, length_unit="mm") -> dict[str, float]:
    from backend.services.urdf_acceptance import joint_limits_si

    limits = joint_limits_si(joint, length_unit=length_unit, angle_unit="deg" if units_deg else "rad")
    return {"lower": limits[0], "upper": limits[1]} if limits is not None else {"lower": 0.0, "upper": 0.0}


def rig_from_cad_joints(doc: dict[str, Any], *, name: str = "Open / close") -> dict[str, Any] | None:
    """Build a named open/close (or mechanism) rig from authored CAD joints."""
    joints = [j for j in (doc.get("joints") or doc.get("assembly_constraints") or []) if isinstance(j, dict)]
    if not joints:
        return None
    units = doc.get("units") if isinstance(doc.get("units"), dict) else {}
    units_deg = str(units.get("angle") or "deg").lower().startswith("deg")
    length_unit = str(units.get("length") or "mm").lower()
    from backend.services.urdf_acceptance import normalized_axis

    bones: list[dict[str, Any]] = []
    by_name: dict[str, dict[str, Any]] = {}

    def _ensure(part: str, *, parent_id: str | None, joint: dict[str, Any] | None) -> dict[str, Any]:
        if part in by_name and joint is None:
            return by_name[part]
        jtype = str((joint or {}).get("type") or "fixed").lower()
        if jtype not in ("fixed", "revolute", "continuous", "prismatic"):
            raise ValueError(f"Joint type {jtype} cannot be represented by this robot rig")
        bone = {
            "id": f"bone_{part}",
            "name": part,
            "position": _joint_anchor_m(joint or {}, length_unit=length_unit),
            "rotation": [0.0, 0.0, 0.0],
            "parentId": parent_id,
            "jointType": "fixed" if parent_id is None else jtype,
            "jointAxis": normalized_axis((joint or {}).get("axis", [1.0, 0.0, 0.0])),
            "limits": _joint_limits_rad(joint or {}, units_deg=units_deg, length_unit=length_unit) if jtype in ("revolute", "prismatic") else {"lower": 0.0, "upper": 0.0},
        }
        if part in by_name:
            by_name[part].update(bone)
            return by_name[part]
        by_name[part] = bone
        bones.append(bone)
        return bone

    seen_children = set()
    for joint in joints:
        child = str(joint.get("child") or "").strip()
        parent = str(joint.get("parent") or "").strip()
        if not child or child.lower() == "world":
            continue
        if child in seen_children or child == parent:
            raise ValueError(f"Invalid or repeated child link: {child}")
        seen_children.add(child)
        parent_id = None
        if parent and parent.lower() not in {"world", "ground"}:
            _ensure(parent, parent_id=None, joint=None)
            parent_id = f"bone_{parent}"
        _ensure(child, parent_id=parent_id, joint=joint)

    if not bones:
        return None
    world_positions = {bone["id"]: list(bone["position"]) for bone in bones}
    for bone in bones:
        parent_position = world_positions.get(bone.get("parentId"), [0, 0, 0])
        bone["position"] = [value - parent_position[axis] for axis, value in enumerate(bone["position"])]
    moving = [b for b in bones if b.get("jointType") in ("revolute", "continuous", "prismatic")]
    keyframes = [{"time": 0.0, "poses": {b["id"]: {"position": b["position"], "rotation": [0.0, 0.0, 0.0]} for b in moving}}]
    if moving:
        open_poses = {}
        for bone in moving:
            lim = bone.get("limits") or {}
            axis = bone.get("jointAxis") or [1.0, 0.0, 0.0]
            angle = 2 * math.pi if bone.get("jointType") == "continuous" else float(lim.get("upper", 0.0))
            if bone.get("jointType") == "prismatic":
                open_poses[bone["id"]] = {
                    "position": [bone["position"][i] + axis[i] * angle for i in range(3)],
                    "rotation": [0.0, 0.0, 0.0],
                }
            else:
                open_poses[bone["id"]] = {
                    "position": list(bone["position"]),
                    "rotation": [axis[0] * angle, axis[1] * angle, axis[2] * angle],
                }
        keyframes.append({"time": 2.0, "poses": open_poses})
        keyframes.append({"time": 4.0, "poses": keyframes[0]["poses"]})
    return _normalize_rig(
        {
            "name": name,
            "bones": bones,
            "activeAnimationId": "anim_open_close",
            "animations": [
                {
                    "id": "anim_open_close",
                    "name": "Open / close",
                    "duration": 4.0,
                    "fps": 30,
                    "keyframes": keyframes,
                }
            ],
            "notes": ["Recovered from authored CAD joints after the rigging model returned no links."],
        }
    )


def generate_rigging(
    ai: AIService,
    prompt: str,
    *,
    current: dict[str, Any] | None = None,
    images: list[dict[str, Any]] | None = None,
    trace_id: str | None = None,
    target_filename: str | None = None,
    target_label: str | None = None,
    project_path: Path | None = None,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Return (rig_data, ai_trace, assistant_message)."""
    enriched = prompt.strip()
    try:
        from backend.services.url_document_service import (
            documents_as_prompt_appendix,
            fetch_documents_from_text,
        )

        docs = fetch_documents_from_text(prompt, limit=2)
        appendix = documents_as_prompt_appendix(docs, per_doc_chars=8_000)
        if appendix:
            enriched = f"{enriched}{appendix}"
    except Exception:
        pass
    parts = [enriched]
    target = (target_label or target_filename or "").strip()
    kind = infer_rig_kind(prompt)
    if target:
        if kind == "wheels":
            parts.append(
                "\nExisting viewport model to articulate (do NOT invent a new CAD part): "
                f"{target}. Make the wheels drive with revolute or continuous joints. "
                "Do not fix every mate. Do not emit dummy URDF spheres or placeholder balls. "
                "Include a Play clip that rotates the wheels."
            )
        else:
            parts.append(
                "\nExisting viewport model to articulate (do NOT invent a new CAD part): "
                f"{target}. Add a hinge or slider for the requested motion (open/close lid, flap, etc.). "
                "Prefer one revolute or prismatic joint when that matches the brief."
            )
    if current and (current.get("bones") or current.get("animations")):
        slim = {
            "name": current.get("name"),
            "bones": current.get("bones"),
            "animations": current.get("animations"),
        }
        parts.append(f"\nCurrent rig (edit/extend this):\n{json.dumps(slim, separators=(',', ':'))}")
    joints_doc = load_project_joints_doc(project_path)
    if joints_doc:
        slim_joints = [
            {
                "id": j.get("id"),
                "type": j.get("type"),
                "parent": j.get("parent"),
                "child": j.get("child"),
                "axis": j.get("axis"),
                "limits": j.get("limits"),
                "anchor": j.get("anchor") or j.get("anchor_mm"),
            }
            for j in (joints_doc.get("joints") or joints_doc.get("assembly_constraints") or [])
            if isinstance(j, dict)
        ]
        parts.append(
            "\nAuthored CAD joints (use these parent/child names and axes; do not return empty bones):\n"
            + json.dumps(slim_joints, separators=(",", ":"))
        )

    raw, trace = ai.generate_rigging(
        "\n".join(parts),
        trace_id=trace_id,
        images=images,
    )
    rig = _normalize_rig(raw)
    if not (rig.get("bones") or []) and joints_doc:
        recovered_name = ""
        if re.search(r'"([^"]{2,80})"', prompt):
            recovered_name = re.search(r'"([^"]{2,80})"', prompt).group(1)
        fallback = rig_from_cad_joints(
            joints_doc,
            name=recovered_name or (target_label or infer_rig_kind(prompt).replace("_", " ")),
        )
        if fallback and fallback.get("bones"):
            rig = fallback
            if isinstance(trace, dict):
                trace["recovered_from_joints"] = True
                trace["bone_count"] = len(rig.get("bones") or [])
    notes = rig.pop("notes", [])
    msg = f"Rig updated — {len(rig['bones'])} links"
    if notes:
        msg += f". {'; '.join(notes[:2])}"
    return rig, trace, msg


def rig_to_urdf(rig: dict[str, Any]) -> str:
    """Kinematic URDF from explicit SI bone frames; CAD binding is separate."""
    from backend.services.urdf_acceptance import finite_vector, normalized_axis, validate_urdf

    bones = rig.get("bones") or []
    by_id = {b["id"]: b for b in bones}
    if len(by_id) != len(bones):
        raise ValueError("Rig bone IDs must be unique")
    robot = ET.Element("robot", name=str(rig.get("name") or "render3d_rig").replace(" ", "_"))
    for bone in bones:
        ET.SubElement(robot, "link", name=bone["name"])
    for bone in bones:
        pid = bone.get("parentId")
        if not pid:
            continue
        if pid not in by_id:
            raise ValueError(f"Missing parent bone {pid}")
        parent = by_id[pid]
        jtype = bone.get("jointType") or "revolute"
        if jtype not in ("fixed", "revolute", "continuous", "prismatic"):
            raise ValueError(f"Unsupported rig joint type {jtype}")
        jname = f'joint_{parent["name"]}_to_{bone["name"]}'
        origin = finite_vector(bone.get("position", [0, 0, 0]))
        rpy = finite_vector(bone.get("rotation", [0, 0, 0]))
        joint = ET.SubElement(robot, "joint", name=jname, type=jtype)
        ET.SubElement(joint, "parent", link=parent["name"])
        ET.SubElement(joint, "child", link=bone["name"])
        ET.SubElement(joint, "origin", xyz=" ".join(map(str, origin)), rpy=" ".join(map(str, rpy)))
        if jtype in ("revolute", "continuous", "prismatic"):
            axis = normalized_axis(bone.get("jointAxis", [0, 0, 1]))
            ET.SubElement(joint, "axis", xyz=" ".join(map(str, axis)))
        if jtype in ("revolute", "prismatic"):
            limits = bone.get("limits") or {}
            ET.SubElement(joint, "limit", lower=str(limits.get("lower")), upper=str(limits.get("upper")), effort="10", velocity="1")
    xml = ET.tostring(robot, encoding="unicode") + "\n"
    validate_urdf(xml, directory=Path.cwd())
    return xml
