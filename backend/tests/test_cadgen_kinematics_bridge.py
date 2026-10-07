import json
from pathlib import Path

from backend.services.cad_harness import cadgen_kinematics_to_harness, load_harness_joints


def test_translates_cadgen_mates_to_render_joints():
    rows = cadgen_kinematics_to_harness({
        "kinematics": {"mates": [
            {"name": "elbow", "kind": "revolute", "parent": "#upper", "child": "#forearm", "origin": [1, 2, 3], "direction": [0, 1, 0], "limits": [0, 150]},
            {"name": "carriage", "kind": "slider", "parent": "#rail", "child": "#carriage", "axis": {"origin": [4, 5, 6], "direction": [1, 0, 0]}, "limits": [0, 80]},
            {"name": "tool", "kind": "fastened", "parent": "#carriage", "child": "#tool"},
        ]}
    })
    assert [(row["id"], row["type"]) for row in rows] == [
        ("elbow", "revolute"), ("carriage", "prismatic"), ("tool", "fixed")
    ]
    assert rows[0]["parent"] == "upper"
    assert rows[1]["anchor"] == [4.0, 5.0, 6.0]


def test_loads_document_bound_step_sidecar(tmp_path: Path):
    (tmp_path / "arm.step.json").write_text(json.dumps({
        "kinematics": {"mates": [
            {"name": "elbow", "kind": "revolute", "parent": "#upper", "child": "#forearm", "origin": [0, 0, 0], "direction": [0, 0, 1]}
        ]}
    }))
    assert load_harness_joints(tmp_path, stem="arm")[0]["id"] == "elbow"
