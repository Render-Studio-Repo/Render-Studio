"""AI-assisted robot rigging / URDF skeleton generation."""

from __future__ import annotations

import json
from typing import Any

from backend.services.ai_service import AIService

RIGGING_SYSTEM_PROMPT = """You are Render Studio's robot rigging engine for URDF-style kinematic chains.

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
"""


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


def _joint_anchor_m(joint: dict[str, Any]) -> list[float]:
    if joint.get("anchor_m"):
        return _as_vec3(joint["anchor_m"])
    mm = joint.get("anchor_mm") or joint.get("anchor")
    if isinstance(mm, (list, tuple)) and len(mm) >= 3:
        vals = [float(mm[0]), float(mm[1]), float(mm[2])]
        if any(abs(v) > 10 for v in vals):
            return [v / 1000.0 for v in vals]
        return vals
    return [0.0, 0.0, 0.0]


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


def generate_rigging(
    ai: AIService,
    prompt: str,
    *,
    current: dict[str, Any] | None = None,
    images: list[dict[str, Any]] | None = None,
    trace_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Return (rig_data, ai_trace, assistant_message)."""
    parts = [prompt.strip()]
    if current and (current.get("bones") or current.get("animations")):
        slim = {
            "name": current.get("name"),
            "bones": current.get("bones"),
            "animations": current.get("animations"),
        }
        parts.append(f"\nCurrent rig (edit/extend this):\n{json.dumps(slim, separators=(',', ':'))}")

    raw, trace = ai.generate_rigging(
        "\n".join(parts),
        trace_id=trace_id,
        images=images,
    )
    rig = _normalize_rig(raw)
    notes = rig.pop("notes", [])
    msg = f"Rig updated — {len(rig['bones'])} links"
    if notes:
        msg += f". {'; '.join(notes[:2])}"
    return rig, trace, msg


def rig_to_urdf(rig: dict[str, Any]) -> str:
    """Minimal URDF XML from rig bones."""
    bones = rig.get("bones") or []
    by_id = {b["id"]: b for b in bones}
    lines = ['<?xml version="1.0"?>', f'<robot name="{rig.get("name", "render3d_rig").replace(" ", "_")}">']
    for bone in bones:
        lines.append(f'  <link name="{bone["name"]}">')
        lines.append('    <visual><geometry><sphere radius="0.05"/></geometry></visual>')
        lines.append("  </link>")
    for bone in bones:
        pid = bone.get("parentId")
        if not pid or pid not in by_id:
            continue
        parent = by_id[pid]
        jtype = bone.get("jointType") or "revolute"
        if jtype not in ("fixed", "revolute", "continuous", "prismatic"):
            jtype = "revolute"
        jname = f'joint_{parent["name"]}_to_{bone["name"]}'
        origin = bone.get("position") or [0, 0, 0]
        rpy = bone.get("rotation") or [0, 0, 0]
        lines.append(f'  <joint name="{jname}" type="{jtype}">')
        lines.append(f'    <parent link="{parent["name"]}"/>')
        lines.append(f'    <child link="{bone["name"]}"/>')
        lines.append(f'    <origin xyz="{" ".join(str(v) for v in origin)}" rpy="{" ".join(str(v) for v in rpy)}"/>')
        if jtype in ("revolute", "continuous", "prismatic"):
            axis = bone.get("jointAxis") or [0, 0, 1]
            lines.append(f'    <axis xyz="{" ".join(str(v) for v in axis)}"/>')
            lim = bone.get("limits") or {"lower": -3.14, "upper": 3.14}
            lines.append(
                f'    <limit lower="{lim.get("lower", -3.14)}" upper="{lim.get("upper", 3.14)}" effort="10" velocity="1"/>'
            )
        lines.append("  </joint>")
    lines.append("</robot>")
    return "\n".join(lines) + "\n"
