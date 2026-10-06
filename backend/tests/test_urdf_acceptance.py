import math
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
import pytest

from backend.services.rigging_service import rig_from_cad_joints, rig_to_urdf
from backend.services.urdf_acceptance import (
    _origin_matrix, accepted_urdf_is_current, bind_assembled_meshes,
    capture_dependencies, publish_urdf, validate_urdf,
)
from backend.services.mechanism_motion import joints_to_urdf, _joints_from_program


def robot_xml(*, origin="0.1 0 0", axis="0 0 1", extra=""):
    return f'''<robot name="robot"><link name="base"/><link name="arm"/>
    <joint name="hinge" type="revolute"><parent link="base"/><child link="arm"/>
    <origin xyz="{origin}" rpy="0 0 0"/><axis xyz="{axis}"/>
    <limit lower="0" upper="1.5" effort="10" velocity="1"/>{extra}</joint></robot>'''


@pytest.mark.parametrize("kind,anchor,limits,expected_origin,expected_upper", [
    ("revolute", [5, 0, 0], [0, 0.1], 0.005, math.pi / 1800),
    ("prismatic", [100, 0, 0], [0, 100], 0.1, 0.1),
])
def test_cad_rig_exports_explicit_si_units(kind, anchor, limits, expected_origin, expected_upper):
    rig = rig_from_cad_joints({"units": {"length": "mm", "angle": "deg"}, "joints": [
        {"parent": "base", "child": "arm", "type": kind, "anchor": anchor, "limits": limits, "axis": [0, 0, 4]},
    ]})
    joint = ET.fromstring(rig_to_urdf(rig)).find("joint")
    assert float(joint.find("origin").get("xyz").split()[0]) == pytest.approx(expected_origin)
    assert float(joint.find("limit").get("upper")) == pytest.approx(expected_upper)
    assert joint.find("axis").get("xyz") == "0.0 0.0 1.0"


def test_chain_frames_are_parent_relative_regardless_of_input_order():
    joints = [
        {"parent": "arm", "child": "tip", "type": "revolute", "anchor": [200, 0, 0], "limits": [0, 90]},
        {"parent": "base", "child": "arm", "type": "revolute", "anchor": [100, 0, 0], "limits": [0, 90]},
    ]
    xml = ET.fromstring(rig_to_urdf(rig_from_cad_joints({"joints": joints})))
    assert len(xml.findall("joint")) == 2
    assert [float(j.find("origin").get("xyz").split()[0]) for j in xml.findall("joint")] == [0.1, 0.1]


def test_binding_preserves_hinge_and_rest_mesh_pose():
    updated, count = bind_assembled_meshes(robot_xml(), {"arm": "arm.glb"})
    robot = ET.fromstring(updated)
    joint_origin = robot.find("joint/origin")
    visual_origin = robot.find("link[@name='arm']/visual/origin")
    assert count == 1
    assert joint_origin.get("xyz") == "0.1 0 0"
    assert float(visual_origin.get("xyz").split()[0]) == -0.1
    rest = _origin_matrix(joint_origin) @ _origin_matrix(visual_origin)
    np.testing.assert_allclose(rest, np.eye(4))
    rotation = np.eye(4)
    rotation[:2, :2] = [[0, -1], [1, 0]]
    moved = _origin_matrix(joint_origin) @ rotation @ _origin_matrix(visual_origin) @ [0.12, 0, 0, 1]
    np.testing.assert_allclose(moved, [0.1, 0.02, 0, 1], atol=1e-10)


@pytest.mark.parametrize("xml", [
    robot_xml(axis="0 0 0"), robot_xml(axis="0 0 4"), robot_xml(origin="nan 0 0"),
    robot_xml().replace('upper="1.5"', 'upper="-1"'),
    robot_xml().replace('<parent link="base"', '<parent link="missing"'),
    robot_xml().replace('</robot>', '<link name="disconnected"/></robot>'),
    robot_xml(extra='<mimic joint="hinge"/>'),
    robot_xml().replace('type="revolute"', 'type="ball"'),
])
def test_invalid_candidate_keeps_accepted_file(tmp_path, xml):
    path = tmp_path / "robot.urdf"
    publish_urdf(path, robot_xml())
    before = path.read_bytes()
    with pytest.raises(ValueError):
        publish_urdf(path, xml)
    assert path.read_bytes() == before
    assert accepted_urdf_is_current(path, tmp_path)


@pytest.mark.parametrize("uri", ["missing.glb", "../outside.glb", "file:///tmp/arm.glb", "package://missing/arm.glb"])
def test_unresolved_or_escaping_mesh_fails(tmp_path, uri):
    xml, _ = bind_assembled_meshes(robot_xml(), {"arm": uri})
    with pytest.raises(ValueError):
        publish_urdf(tmp_path / "robot.urdf", xml)


def test_acceptance_tracks_source_and_mesh_content(tmp_path):
    source = tmp_path / "robot.py"
    source.write_text("CAD source")
    mesh = tmp_path / "arm.glb"
    mesh.write_bytes(b"mesh artifact")
    identities = capture_dependencies(tmp_path, [source])
    xml, _ = bind_assembled_meshes(robot_xml(), {"arm": mesh.name})
    path = tmp_path / "robot.urdf"
    report = publish_urdf(path, xml, expected_dependencies=identities)
    assert report["simulation_ready"] is False
    assert accepted_urdf_is_current(path, tmp_path)
    mesh.write_bytes(b"changed mesh")
    assert not accepted_urdf_is_current(path, tmp_path)
    source.write_text("Changed CAD")
    before = path.read_bytes()
    with pytest.raises(ValueError, match="dependency changed"):
        publish_urdf(path, xml, expected_dependencies=identities)
    assert path.read_bytes() == before


def test_sim_continuous_type_and_prismatic_units_survive():
    rows = _joints_from_program({"joints": [
        {"id": "spin", "type": "revolute", "overlay_type": "continuous", "parent": "base", "child": "arm", "anchor_mm": [5, 0, 0]},
        {"id": "slide", "type": "prismatic", "parent": "arm", "child": "tip", "anchor_mm": [10, 0, 0], "limits": [0, 100]},
    ]})
    xml = ET.fromstring(joints_to_urdf(name="r", part_names=["base", "arm", "tip"], joints=rows))
    assert xml.find("joint[@name='spin']").get("type") == "continuous"
    slide = xml.find("joint[@name='slide']")
    assert float(slide.find("limit").get("upper")) == 0.1
    assert float(slide.find("origin").get("xyz").split()[0]) == 0.005


def test_nonphysical_inertia_rejected(tmp_path):
    xml = robot_xml().replace('<link name="arm"/>', '''<link name="arm"><inertial><mass value="1"/>
      <inertia ixx="1" iyy="1" izz="5" ixy="0" ixz="0" iyz="0"/></inertial></link>''')
    with pytest.raises(ValueError, match="physically valid"):
        validate_urdf(xml, directory=tmp_path)
