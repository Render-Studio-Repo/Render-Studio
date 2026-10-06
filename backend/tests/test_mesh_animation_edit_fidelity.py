"""Regression tests for topology edits on structured animated GLB scenes."""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

import trimesh

from backend.services import cad_service


def _animated_scene(path: Path) -> Path:
    scene = trimesh.Scene()
    scene.add_geometry(
        trimesh.creation.box(extents=(10.0, 8.0, 6.0)),
        geom_name="RobotBody",
        node_name="RobotBody",
    )
    scene.export(str(path))

    document, version, chunks = cad_service._read_glb_document(path)
    active_scene = document["scenes"][int(document.get("scene") or 0)]
    roots = [int(index) for index in active_scene.get("nodes") or []]
    pivot_index = len(document["nodes"])
    document["nodes"].append(
        {
            "name": "HingePivot",
            "children": roots,
            "extras": {"animationTarget": "hinge"},
        }
    )
    active_scene["nodes"] = [pivot_index]
    active_scene["extras"] = {"sceneToken": "keep"}
    document["animations"] = [
        {
            "name": "spin_HingePivot",
            "channels": [
                {"sampler": 0, "target": {"node": pivot_index, "path": "rotation"}}
            ],
            "samplers": [{"input": 0, "output": 1, "interpolation": "LINEAR"}],
        }
    ]
    cad_service._write_glb_document(path, path, document, version=version, chunks=chunks)
    return path


class MeshAnimationEditFidelityTests(unittest.TestCase):
    def test_face_pull_rejects_animated_hierarchy_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = _animated_scene(Path(tmp) / "animated.glb")
            destination = Path(tmp) / "edited.glb"
            destination.write_bytes(b"existing accepted artifact")
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            destination_hash = hashlib.sha256(destination.read_bytes()).hexdigest()

            with self.assertRaisesRegex(
                ValueError,
                r"Face pull cannot safely edit.*node hierarchy.*animation clips.*authored extras",
            ):
                cad_service.face_pull_scene_body(
                    source,
                    [0],
                    body_index=0,
                    body_name="RobotBody",
                    distance=2.0,
                    out_path=destination,
                )

            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), source_hash)
            self.assertEqual(hashlib.sha256(destination.read_bytes()).hexdigest(), destination_hash)
            document, _version, _chunks = cad_service._read_glb_document(source)
            clip = document["animations"][0]
            target_index = clip["channels"][0]["target"]["node"]
            self.assertEqual(clip["name"], "spin_HingePivot")
            self.assertEqual(document["nodes"][target_index]["name"], "HingePivot")


if __name__ == "__main__":
    unittest.main()
