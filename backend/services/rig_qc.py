"""Sidecar QC for CAD rigging fixes. Token rigqc1.

Second agent seat (clip-bot CAD, vibe-rnd alt). No extra WebGL.
Never auto-applies harness. Never emits dummy URDF spheres.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services.rigging_service import infer_rig_kind

TOKEN = "rigqc1"
QC_AGENT = "clip-bot"
QC_AGENT_ALT = "vibe-rnd"
PICK_LIMIT = 4

_MOVABLE = frozenset({"revolute", "continuous", "prismatic"})


def _joint_type(joint: dict[str, Any]) -> str:
    return str(joint.get("type") or joint.get("joint_type") or joint.get("kind") or "").lower()


def has_movable_joint(joints: list[Any] | None) -> bool:
    return any(_joint_type(j) in _MOVABLE for j in (joints or []) if isinstance(j, dict))


def urdf_has_dummy_spheres(urdf_text: str) -> bool:
    xml = str(urdf_text or "")
    if not xml:
        return False
    if re.search(r"<(?:visual|collision)[\s\S]{0,800}<sphere\b", xml, re.I):
        return True
    return bool(re.search(r"placeholder|dummy[\s_-]?ball|dummy[\s_-]?sphere", xml, re.I))


def has_playable_clip(
    sidecar: dict[str, Any] | None,
    *,
    animations: list[Any] | None = None,
    step_animations: list[Any] | None = None,
) -> bool:
    listed = (sidecar or {}).get("rigs") if isinstance(sidecar, dict) else None
    for rig in listed or []:
        if not isinstance(rig, dict):
            continue
        if rig.get("animationId") or rig.get("clip"):
            return True
        kind = str(rig.get("kind") or "")
        if kind and kind != "joints" and str(rig.get("source") or "") != "fallback":
            return True
    clips = (sidecar or {}).get("animations") if isinstance(sidecar, dict) else None
    if clips is None:
        clips = animations or []
    for clip in clips or []:
        if isinstance(clip, dict) and len(clip.get("keyframes") or []) >= 2:
            return True
    if step_animations:
        return True
    return bool((sidecar or {}).get("activeAnimationId")) if isinstance(sidecar, dict) else False


def _collect_joints(sidecar: dict[str, Any] | None, joints: list[Any] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in joints or []:
        if isinstance(row, dict):
            out.append(row)
    if isinstance(sidecar, dict):
        for row in sidecar.get("joints") or []:
            if isinstance(row, dict):
                out.append(row)
        for rig in sidecar.get("rigs") or []:
            if not isinstance(rig, dict):
                continue
            for row in rig.get("joints") or []:
                if isinstance(row, dict):
                    out.append(row)
    return out


def qc_rig_fix(
    *,
    sidecar: dict[str, Any] | None = None,
    urdf_text: str = "",
    joints: list[Any] | None = None,
    files: list[str] | None = None,
    animations: list[Any] | None = None,
    step_animations: list[Any] | None = None,
    prompt: str = "",
    filename: str = "",
) -> dict[str, Any]:
    kind = infer_rig_kind(prompt)
    names = [str(n or "") for n in (files or [])]
    sidecar_hit = any(n.lower().endswith(".rigs.json") for n in names) or bool(
        isinstance(sidecar, dict) and (sidecar.get("rigs") or sidecar.get("animations"))
    )
    urdf_hit = any(n.lower().endswith(".urdf") for n in names) or bool(re.search(r"<robot[\s>]", str(urdf_text or ""), re.I))
    joint_list = _collect_joints(sidecar, joints)
    movable = has_movable_joint(joint_list)
    dummy = urdf_has_dummy_spheres(urdf_text)
    playable = has_playable_clip(sidecar, animations=animations, step_animations=step_animations)
    listed = (sidecar or {}).get("rigs") if isinstance(sidecar, dict) else []
    fallback_only = bool(listed) and all(str(r.get("source") or "") == "fallback" for r in listed if isinstance(r, dict))
    wheel_named = False
    for joint in joint_list:
        hay = f"{joint.get('id')} {joint.get('name')} {joint.get('child')} {joint.get('parent')}".lower()
        if re.search(r"\b(wheel|caster|mecanum|omni|drive)\b", hay) and _joint_type(joint) != "fixed":
            wheel_named = True
            break
    checks = [
        {
            "id": "sidecar",
            "pass": sidecar_hit or urdf_hit or bool(joint_list),
            "note": "Found *.rigs.json / joints sidecar" if sidecar_hit else ("Found URDF" if urdf_hit else "No rig sidecar"),
        },
        {
            "id": "clip",
            "pass": playable and not fallback_only,
            "note": "Play has a real clip" if playable and not fallback_only else "No playable clip (or only fallback hinge)",
        },
        {
            "id": "movable",
            "pass": movable,
            "note": "Has revolute/continuous/prismatic joints" if movable else "All-fixed mates — wheels will not spin",
        },
        {
            "id": "geometry",
            "pass": not dummy,
            "note": "Dummy URDF spheres / placeholder balls" if dummy else "No dummy sphere visuals",
        },
    ]
    if kind == "wheels" or re.search(r"\bwheel", f"{prompt} {filename}", re.I):
        checks.append({
            "id": "wheels",
            "pass": movable and (wheel_named or kind == "wheels"),
            "note": (
                "Wheel links are not fixed" if wheel_named
                else ("Movable joints, but none named as wheels" if movable else "Wheels are not driving")
            ),
        })
    passed = all(bool(row["pass"]) for row in checks)
    notes = [str(row["note"]) for row in checks if not row["pass"]]
    if passed:
        notes.append("QC pass — Play in viewport; shareplay2 Play if a clip exists.")
    return {
        "ok": True,
        "pass": passed,
        "fail": not passed,
        "checks": checks,
        "notes": notes,
        "kind": kind,
        "filename": str(filename or ""),
        "agent": QC_AGENT,
        "alt_agent": QC_AGENT_ALT,
        "token": TOKEN,
        "auto_apply": False,
    }


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def inspect_project(project_path: Path, *, filename: str = "", prompt: str = "") -> dict[str, Any]:
    root = Path(project_path)
    stem = Path(str(filename or "model")).stem or "model"
    files = [p.name for p in root.iterdir() if p.is_file()] if root.is_dir() else []
    sidecar = None
    for name in (f"{stem}.rigs.json", f"{Path(stem).name}.rigs.json"):
        hit = root / name
        if hit.is_file():
            sidecar = _read_json(hit)
            break
    if sidecar is None:
        for name in files:
            if name.lower().endswith(".rigs.json"):
                sidecar = _read_json(root / name)
                break
    joints_doc = _read_json(root / "r3d_joints.json") or _read_json(root / "rigging.json") or {}
    joints = list(joints_doc.get("joints") or [])
    if isinstance(joints_doc.get("bones"), list):
        for bone in joints_doc["bones"]:
            if isinstance(bone, dict):
                joints.append({
                    "id": bone.get("id") or bone.get("name"),
                    "type": bone.get("jointType") or bone.get("type"),
                    "child": bone.get("name"),
                    "parent": bone.get("parentId"),
                })
    urdf_text = ""
    for name in files:
        if name.lower().endswith(".urdf"):
            try:
                urdf_text = (root / name).read_text(encoding="utf-8", errors="ignore")[:80_000]
            except OSError:
                urdf_text = ""
            break
    result = qc_rig_fix(
        sidecar=sidecar,
        urdf_text=urdf_text,
        joints=joints,
        files=files,
        animations=list(joints_doc.get("animations") or (sidecar or {}).get("animations") or []),
        prompt=prompt,
        filename=filename,
    )
    result["project"] = str(root.name)
    return result


def publish_qc(result: dict[str, Any], *, user: dict[str, Any] | None = None) -> dict[str, Any]:
    from backend.services import team_status_service
    from backend.services import xr_debugger_service

    verdict = "PASS" if result.get("pass") else "FAIL"
    file = str(result.get("filename") or "").strip()
    detail = "; ".join(str(n) for n in (result.get("notes") or [])[:3]) or "no notes"
    posted = []
    for agent, text in (
        ("astra", f"Rigging generate done {file}. {QC_AGENT} QC next — token {TOKEN}.".strip()),
        (QC_AGENT, f"QC {verdict} {file}: {detail}"[:180]),
    ):
        try:
            posted.append(team_status_service.post_round_table_line(agent, text))
        except ValueError:
            continue
    log = xr_debugger_service.write_xr_perf_log(
        user or {"id": "anon"},
        {
            "v": 1,
            "kind": "round-table",
            "auto": False,
            "manual": True,
            "filename": datetime.now(timezone.utc).strftime("%Y%m%d-%H%M-round-table.jsonl"),
            "description": f"Rig QC {verdict} ({TOKEN})",
            "actions": [{"t": 0, "tool": "qc_rig"}],
            "extra": {
                "token": TOKEN,
                "pass": bool(result.get("pass")),
                "filename": file,
                "notes": result.get("notes") or [],
                "checks": result.get("checks") or [],
                "agent": QC_AGENT,
                "auto_apply": False,
            },
        },
    )
    return {
        **result,
        "chat": posted,
        "log": {"name": log.get("name"), "path": log.get("ai_path")},
        "round_table": "roundtbl1",
    }


def wheel_fix_packet(*, filenames: list[str] | None = None, project_id: str = "") -> dict[str, Any]:
    names = [str(n).strip() for n in (filenames or []) if str(n).strip()][:PICK_LIMIT]
    prompt = (
        "Properly make the wheels drive on the EXISTING selected viewport model. "
        "Use revolute or continuous wheel joints, not all-fixed mates, not dummy URDF spheres. "
        "Write <stem>.rigs.json plus a Play clip that actually rotates the wheels. "
        "Prefer Holonomic base wheels."
    )
    if names:
        prompt += " Targets: " + ", ".join(names) + "."
    return {
        "ok": True,
        "action": "fix_wheels",
        "prompt": prompt,
        "filenames": names,
        "project_id": str(project_id or ""),
        "example_project": "5bf8e783",
        "token": TOKEN,
        "round_table": "roundtbl1",
        "applied": False,
        "auto_apply": False,
        "how": "Pick 1–few models in Projects/Browser → orange Rigging chip → /rigging/prompt. Clip-bot QC after generate.",
    }
