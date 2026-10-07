"""Export a simulation package to URDF (ROS/Gazebo/PyBullet) and MJCF (MuJoCo).

Both formats reference per-part STL meshes (millimetres, scaled to metres on
import). Links carry SI inertials; joints carry axis/origin/limits so the model
is immediately simulable. The kinematic tree is derived from the program joints
(parts with parent ``world`` become roots).
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from build123d import export_stl

from backend.kernel.builder import BuildResult


def export_part_stls(result: BuildResult, out_dir: Path, basename: str) -> dict[str, str]:
    """Export one STL per part; returns {part_id: filename}."""
    out: dict[str, str] = {}
    for pid, body in result.parts.items():
        fname = f"{basename}_{pid}.stl"
        export_stl(body, str(out_dir / fname))
        out[pid] = fname
    return out


def _build_tree(joints: list[dict[str, Any]], part_ids: list[str]) -> tuple[list[str], dict[str, list[dict]]]:
    """Return (roots, children_by_parent) from joint definitions."""
    children: dict[str, list[dict]] = {}
    has_parent: set[str] = set()
    for j in joints:
        children.setdefault(j["parent"], []).append(j)
        has_parent.add(j["child"])
    roots = [p for p in part_ids if p not in has_parent]
    return roots, children


def to_urdf(sim: dict[str, Any], part_meshes: dict[str, str], name: str = "render3d_model") -> str:
    robot = ET.Element("robot", {"name": name})

    # Optional world base link if any joint references it.
    if any(j["parent"] == "world" for j in sim["joints"]):
        ET.SubElement(robot, "link", {"name": "world"})

    for part in sim["parts"]:
        pid = part["id"]
        link = ET.SubElement(robot, "link", {"name": pid})
        mp = part["mass_properties"]
        inertial = ET.SubElement(link, "inertial")
        com = mp["center_of_mass_m"]
        ET.SubElement(inertial, "origin", {"xyz": f"{com[0]} {com[1]} {com[2]}", "rpy": "0 0 0"})
        ET.SubElement(inertial, "mass", {"value": f"{mp['mass_kg']:.9g}"})
        I = mp["inertia_kg_m2"]
        ET.SubElement(
            inertial,
            "inertia",
            {
                "ixx": f"{I[0][0]:.9g}", "ixy": f"{I[0][1]:.9g}", "ixz": f"{I[0][2]:.9g}",
                "iyy": f"{I[1][1]:.9g}", "iyz": f"{I[1][2]:.9g}", "izz": f"{I[2][2]:.9g}",
            },
        )
        mesh_file = part_meshes.get(pid, f"{pid}.stl")
        for tag in ("visual", "collision"):
            node = ET.SubElement(link, tag)
            ET.SubElement(node, "origin", {"xyz": "0 0 0", "rpy": "0 0 0"})
            geom = ET.SubElement(node, "geometry")
            ET.SubElement(geom, "mesh", {"filename": mesh_file, "scale": "0.001 0.001 0.001"})

    for j in sim["joints"]:
        jtype = "continuous" if j["type"] == "continuous" else j["type"]
        joint = ET.SubElement(robot, "joint", {"name": j["id"], "type": jtype})
        ET.SubElement(joint, "parent", {"link": j["parent"]})
        ET.SubElement(joint, "child", {"link": j["child"]})
        a = j["anchor_m"]
        ET.SubElement(joint, "origin", {"xyz": f"{a[0]} {a[1]} {a[2]}", "rpy": "0 0 0"})
        ax = j["axis"]
        ET.SubElement(joint, "axis", {"xyz": f"{ax[0]} {ax[1]} {ax[2]}"})
        if j["type"] in ("revolute", "prismatic") and j.get("limits"):
            lo, hi = j["limits"]
            # Render sim metadata stores revolute ranges in degrees and slide
            # ranges in millimetres. URDF requires radians and metres.
            scale = math.pi / 180 if j["type"] == "revolute" else 0.001
            lo, hi = lo * scale, hi * scale
            ET.SubElement(joint, "limit", {"lower": f"{lo}", "upper": f"{hi}", "effort": "10", "velocity": "10"})
    _indent(robot)
    return ET.tostring(robot, encoding="unicode")


def to_mjcf(sim: dict[str, Any], part_meshes: dict[str, str], name: str = "render3d_model") -> str:
    mujoco = ET.Element("mujoco", {"model": name})
    ET.SubElement(mujoco, "compiler", {"angle": "degree"})
    ET.SubElement(mujoco, "option", {"gravity": "0 0 -9.81"})
    asset = ET.SubElement(mujoco, "asset")
    for pid, fname in part_meshes.items():
        ET.SubElement(asset, "mesh", {"name": pid, "file": fname, "scale": "0.001 0.001 0.001"})
    worldbody = ET.SubElement(mujoco, "worldbody")

    parts_by_id = {p["id"]: p for p in sim["parts"]}
    roots, children = _build_tree(sim["joints"], list(parts_by_id))

    def add_body(parent_el: ET.Element, pid: str, joint: dict | None) -> None:
        part = parts_by_id[pid]
        pos = "0 0 0"
        if joint:
            a = joint["anchor_m"]
            pos = f"{a[0]} {a[1]} {a[2]}"
        body = ET.SubElement(parent_el, "body", {"name": pid, "pos": pos})
        mp = part["mass_properties"]
        com = mp["center_of_mass_m"]
        diag = mp["inertia_diagonal_kg_m2"]
        ET.SubElement(
            body,
            "inertial",
            {
                "pos": f"{com[0]} {com[1]} {com[2]}",
                "mass": f"{mp['mass_kg']:.9g}",
                "diaginertia": f"{diag[0]:.9g} {diag[1]:.9g} {diag[2]:.9g}",
            },
        )
        if joint:
            ax = joint["axis"]
            jkind = "slide" if joint["type"] == "prismatic" else "hinge"
            attrs = {"name": joint["id"], "type": jkind, "axis": f"{ax[0]} {ax[1]} {ax[2]}", "pos": "0 0 0"}
            if joint.get("limits"):
                scale = 0.001 if joint["type"] == "prismatic" else 1
                attrs["range"] = f"{joint['limits'][0] * scale} {joint['limits'][1] * scale}"
                attrs["limited"] = "true"
            ET.SubElement(body, "joint", attrs)
        ET.SubElement(body, "geom", {"type": "mesh", "mesh": pid})
        for child_joint in children.get(pid, []):
            add_body(body, child_joint["child"], child_joint)

    for root in roots:
        add_body(worldbody, root, None)
    # Any parts whose parent is 'world' explicitly
    for wj in children.get("world", []):
        if wj["child"] not in roots:
            add_body(worldbody, wj["child"], wj)
    _indent(mujoco)
    return ET.tostring(mujoco, encoding="unicode")


def _indent(elem: ET.Element, level: int = 0) -> None:
    pad = "\n" + "  " * level
    if len(elem):
        if not (elem.text or "").strip():
            elem.text = pad + "  "
        for child in elem:
            _indent(child, level + 1)
            if not (child.tail or "").strip():
                child.tail = pad + "  "
        if not (elem[-1].tail or "").strip():
            elem[-1].tail = pad
    elif level and not (elem.tail or "").strip():
        elem.tail = pad
