"""Finite JSON / GLB bbox serialization for text-to-cad previews."""

from __future__ import annotations

import json
import math
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh

from backend.services.cad_service import export_scene, sanitize_trimesh_finite
from backend.services.json_finite import (
    dumps_finite,
    finite_bbox,
    glb_json_has_nonfinite,
    loads_finite,
    read_glb_json_chunk_bytes,
    rewrite_glb_finite_json,
)


def _pack_glb(json_text: str, binary: bytes = b"\0" * 12) -> bytes:
    json_chunk = json_text.encode("utf-8")
    json_chunk += b" " * ((4 - (len(json_chunk) % 4)) % 4)
    bin_chunk = binary + b"\0" * ((4 - (len(binary) % 4)) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    return (
        b"glTF"
        + struct.pack("<II", 2, total)
        + struct.pack("<I4s", len(json_chunk), b"JSON")
        + json_chunk
        + struct.pack("<I4s", len(bin_chunk), b"BIN\0")
        + bin_chunk
    )


class FiniteJsonTests(unittest.TestCase):
    def test_dumps_finite_never_emits_infinity(self) -> None:
        payload = {
            "count": 1083,
            "max": [float("inf"), 75.0, 115.0],
            "min": [float("inf"), -75.0, 0.0],
        }
        self.assertIn("Infinity", json.dumps(payload))
        encoded = dumps_finite(payload, separators=(",", ":"))
        self.assertNotIn("Infinity", encoded)
        parsed = json.loads(encoded)
        self.assertEqual(parsed["max"][0], 0.0)
        self.assertEqual(parsed["max"][1], 75.0)

    def test_loads_finite_accepts_legacy_infinity_bbox(self) -> None:
        raw = '{"count":1083,"max":[Infinity,75.0,115.0],"min":[Infinity,-75.0,0]}'
        # Python's json.loads accepts Infinity; JavaScript JSON.parse does not.
        parsed_py = json.loads(raw)
        self.assertEqual(parsed_py["max"][0], float("inf"))
        parsed = loads_finite(raw)
        self.assertEqual(parsed["count"], 1083)
        encoded = dumps_finite(parsed_py, separators=(",", ":"))
        self.assertNotIn("Infinity", encoded)
        json.loads(encoded)
        box = finite_bbox(parsed_py["min"], parsed_py["max"])
        self.assertEqual(box["min"], [0.0, -75.0, 0.0])
        self.assertEqual(box["max"], [0.0, 75.0, 115.0])

    def test_export_scene_drops_nonfinite_verts(self) -> None:
        mesh = trimesh.Trimesh(
            vertices=np.array(
                [
                    [float("inf"), -75.0, 0.0],
                    [10.0, 75.0, 115.0],
                    [10.0, -75.0, 115.0],
                    [10.0, 75.0, 0.0],
                ],
                dtype=float,
            ),
            faces=np.array([[0, 1, 2], [0, 2, 3]], dtype=int),
            process=False,
        )
        sanitize_trimesh_finite(mesh)
        self.assertTrue(np.isfinite(np.asarray(mesh.vertices)).all())
        path = Path(tempfile.mkdtemp()) / "bbox.glb"
        scene = trimesh.Scene()
        scene.add_geometry(mesh, geom_name="part")
        export_scene(scene, path)
        self.assertFalse(glb_json_has_nonfinite(path))
        json.loads(path.read_bytes()[20 : 20 + int.from_bytes(path.read_bytes()[12:16], "little")].decode("utf-8").strip())

    def test_sanitize_overflow_verts_not_just_infinity(self) -> None:
        """OCC cove surfaces write 2e100; float32 GLB JSON then becomes Infinity."""
        mesh = trimesh.Trimesh(
            vertices=np.array(
                [
                    [2e100, -75.0, 0.0],
                    [2e100, 75.0, 115.0],
                    [2e100, -75.0, 115.0],
                ],
                dtype=float,
            ),
            faces=np.array([[0, 1, 2]], dtype=int),
            process=False,
        )
        sanitize_trimesh_finite(mesh)
        verts = np.asarray(mesh.vertices, dtype=float)
        self.assertTrue(np.isfinite(verts).all())
        self.assertTrue((np.abs(verts) < 1e9).all())
        self.assertEqual(verts[0, 0], 0.0)
        path = Path(tempfile.mkdtemp()) / "overflow.glb"
        scene = trimesh.Scene()
        scene.add_geometry(mesh, geom_name="part")
        export_scene(scene, path)
        self.assertFalse(glb_json_has_nonfinite(path))
        json_len = int.from_bytes(path.read_bytes()[12:16], "little")
        parsed = json.loads(path.read_bytes()[20 : 20 + json_len].decode("utf-8").strip())
        json.loads(json.dumps(parsed))
        for accessor in parsed.get("accessors") or []:
            for key in ("min", "max"):
                if key in accessor:
                    self.assertTrue(all(math.isfinite(float(v)) for v in accessor[key]))

    def test_glb_json_needs_sanitize_detects_overflow_bbox(self) -> None:
        from backend.services.json_finite import glb_json_needs_sanitize

        text = '{"asset":{"version":"2.0"},"accessors":[{"count":3,"min":[2e100,-75,0],"max":[2e100,75,115],"componentType":5126,"type":"VEC3"}],"buffers":[{"byteLength":12}],"bufferViews":[{"buffer":0,"byteLength":12}],"scenes":[{"nodes":[]}],"scene":0}'
        path = Path(tempfile.mkdtemp()) / "overflow-json.glb"
        path.write_bytes(_pack_glb(text))
        self.assertTrue(glb_json_needs_sanitize(path))
        self.assertFalse(glb_json_has_nonfinite(path))

    def test_rewrite_glb_finite_json(self) -> None:
        text = '{"asset":{"version":"2.0"},"accessors":[{"count":1083,"min":[Infinity,-75.0,0],"max":[Infinity,75.0,115.0],"componentType":5126,"type":"VEC3"}],"buffers":[{"byteLength":12}],"bufferViews":[{"buffer":0,"byteLength":12}],"scenes":[{"nodes":[]}],"scene":0}'
        self.assertIn("Infinity", text)
        path = Path(tempfile.mkdtemp()) / "legacy.glb"
        path.write_bytes(_pack_glb(text))
        self.assertTrue(glb_json_has_nonfinite(path))
        self.assertTrue(rewrite_glb_finite_json(path))
        self.assertFalse(glb_json_has_nonfinite(path))
        json_len = int.from_bytes(path.read_bytes()[12:16], "little")
        parsed = json.loads(path.read_bytes()[20 : 20 + json_len].decode("utf-8").strip())
        self.assertNotIn("min", parsed["accessors"][0])
        self.assertNotIn("max", parsed["accessors"][0])

    def test_read_glb_json_chunk_skips_bin_payload(self) -> None:
        json_text = '{"asset":{"version":"2.0"},"meshes":[]}'
        # Old scanner scanned the whole file, so BIN bytes spelling Infinity
        # would false-positive and force a full read of huge viewers.
        bin_payload = b"Infinity" * (32 * 1024)
        path = Path(tempfile.mkdtemp()) / "json-only.glb"
        path.write_bytes(_pack_glb(json_text, bin_payload))
        raw = read_glb_json_chunk_bytes(path)
        self.assertIsNotNone(raw)
        self.assertIn(b'"asset"', raw)
        self.assertNotIn(b"Infinity", raw)
        self.assertFalse(glb_json_has_nonfinite(path))
        from backend.services.cad_service import _read_glb_json_chunk

        parsed = _read_glb_json_chunk(path)
        self.assertEqual(parsed.get("asset", {}).get("version"), "2.0")


if __name__ == "__main__":
    unittest.main()
