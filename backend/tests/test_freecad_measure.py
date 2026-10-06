from pathlib import Path

from backend.services.freecad_measure import compact_kernel_topology, normalize_kernel_pick


def test_normalize_kernel_pick_aliases():
    assert normalize_kernel_pick({"kind": "corner", "index": 2}) == {"kind": "vertex", "index": 2}
    assert normalize_kernel_pick({"type": "face", "index": 0}) == {"kind": "face", "index": 0}
    assert normalize_kernel_pick({"kind": "edge", "index": -1}) is None
    assert normalize_kernel_pick("edge") is None


def test_compact_kernel_topology_drops_tris():
    compact = compact_kernel_topology(
        {
            "kernel": "freecad",
            "bodies": [{"index": 0}],
            "faces": [{"index": 0, "center": [1, 2, 3], "tris": [0, 0, 0, 1, 0, 0, 0, 1, 0], "area": 12, "planar": True}],
            "edges": [{"index": 0, "length": 40}],
            "vertices": [{"index": 0, "position": [0, 0, 0]}],
        }
    )
    assert compact["kernel"] == "freecad"
    assert "tris" not in compact["faces"][0]
    assert compact["faces"][0]["area"] == 12
    assert compact["edges"][0]["length"] == 40


def test_box_face_distance_is_occ_thickness(tmp_path: Path):
    try:
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
        from OCP.IFSelect import IFSelect_ReturnStatus
        from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer
        from backend.services.freecad_measure import measure_kernel_entities
        from backend.services.freecad_transform import kernel_pick_face, list_kernel_topology
    except ImportError:
        return

    box = BRepPrimAPI_MakeBox(40.0, 20.0, 10.0).Shape()
    step_path = tmp_path / "measure_box.step"
    writer = STEPControl_Writer()
    writer.Transfer(box, STEPControl_StepModelType.STEPControl_AsIs)
    status = writer.Write(str(step_path))
    assert status == IFSelect_ReturnStatus.IFSelect_RetDone
    topo = list_kernel_topology(step_path, include_tris=False)
    bottom = kernel_pick_face(topo["faces"], [20.0, 10.0, 0.0], [0.0, 0.0, -1.0])
    top = kernel_pick_face(topo["faces"], [20.0, 10.0, 10.0], [0.0, 0.0, 1.0])
    assert bottom is not None and top is not None
    measured = measure_kernel_entities(
        step_path,
        {"kind": "face", "index": bottom["index"]},
        {"kind": "face", "index": top["index"]},
    )
    assert measured["kernel"] == "freecad"
    assert abs(float(measured["distance_mm"]) - 10.0) < 0.05
    edge = measure_kernel_entities(step_path, {"kind": "edge", "index": 0})
    assert float(edge["length_mm"]) in {10.0, 20.0, 40.0} or abs(float(edge["length_mm"]) - 40.0) < 0.05 or abs(float(edge["length_mm"]) - 20.0) < 0.05 or abs(float(edge["length_mm"]) - 10.0) < 0.05
