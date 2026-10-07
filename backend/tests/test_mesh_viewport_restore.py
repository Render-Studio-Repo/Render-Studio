"""Viewport restore prefers a newer Mesh publish over a stale timeline GLB."""

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from backend.services import cad_service, history_service
from backend.services.project_store import latest_model_file


class MeshViewportRestoreTests(unittest.TestCase):
    def test_latest_model_prefers_newer_mesh_folder_over_stale_timeline(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        old = tmp / "helmet_edited.glb"
        old.write_bytes(b"old-blockout")
        mesh_dir = tmp / "mesh"
        mesh_dir.mkdir()
        published = mesh_dir / "helmet_procedural.glb"
        published.write_bytes(b"img2threejs-mesh" * 64)
        now = time.time()
        os.utime(old, (now - 120, now - 120))
        os.utime(published, (now, now))
        (tmp / "timeline.json").write_text(
            json.dumps(
                {
                    "current_index": 0,
                    "entries": [
                        {
                            "kind": "transform",
                            "filename": "helmet_edited.glb",
                            "label": "Move",
                            "meta": {},
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        self.assertEqual(latest_model_file(tmp), "mesh/helmet_procedural.glb")

    def test_browser_primary_is_newer_mesh_publish_not_canonical_root(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "helmet.program.json").write_text("{}", encoding="utf-8")
        (tmp / "helmet.sim.json").write_text("{}", encoding="utf-8")
        root = tmp / "helmet.glb"
        root.write_bytes(b"old-root")
        mesh_dir = tmp / "mesh"
        mesh_dir.mkdir()
        published = mesh_dir / "helmet_procedural.glb"
        published.write_bytes(b"img2threejs-mesh" * 64)
        (mesh_dir / "helmet_procedural.mesh.mjs").write_text("export function create() {}", encoding="utf-8")
        now = time.time()
        os.utime(root, (now - 120, now - 120))
        os.utime(published, (now, now))
        tree = cad_service.list_browser_tree(tmp)
        designed = [c for c in (tree.get("components") or []) if not c.get("catalog_hardware")]
        primary = [c for c in designed if c.get("primary")]
        self.assertEqual(len(primary), 1)
        self.assertEqual(primary[0]["name"], "mesh/helmet_procedural.glb")
        self.assertTrue(primary[0].get("auto_load"))
        self.assertEqual(
            cad_service.primary_assembly_component(tmp)["name"],
            "mesh/helmet_procedural.glb",
        )

    def test_latest_model_skips_newer_exploded_sidecar(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        assembled = tmp / "chassis.glb"
        exploded = tmp / "chassis_exploded.glb"
        assembled.write_bytes(b"assembled-glb")
        exploded.write_bytes(b"exploded-glb" * 64)
        now = time.time()
        os.utime(assembled, (now - 120, now - 120))
        os.utime(exploded, (now, now))
        (tmp / "timeline.json").write_text(
            json.dumps(
                {
                    "current_index": 0,
                    "entries": [
                        {
                            "kind": "prompt",
                            "filename": "chassis.glb",
                            "label": "AI: chassis",
                            "meta": {"status": "complete", "success": True},
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        self.assertEqual(cad_service.newest_published_model(tmp), "chassis.glb")
        self.assertEqual(latest_model_file(tmp), "chassis.glb")
        self.assertEqual(
            cad_service.resolve_viewport_filename(tmp, "chassis_exploded.glb"),
            "chassis.glb",
        )
        tree = cad_service.list_browser_tree(tmp)
        designed = [c for c in (tree.get("components") or []) if not c.get("catalog_hardware")]
        names = {c["name"] for c in designed}
        self.assertIn("chassis.glb", names)
        self.assertNotIn("chassis_exploded.glb", names)
        tmp = Path(tempfile.mkdtemp())
        mesh_dir = tmp / "mesh"
        mesh_dir.mkdir()
        published = mesh_dir / "hero.glb"
        published.write_bytes(b"done")
        live = mesh_dir / "hero.generation-live.glb"
        live.write_bytes(b"preview")
        now = time.time()
        os.utime(published, (now - 10, now - 10))
        os.utime(live, (now, now))
        self.assertEqual(cad_service.newest_published_model(tmp), "mesh/hero.glb")

    def test_timeline_append_accepts_mesh_folder_glb(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        mesh_dir = tmp / "mesh"
        mesh_dir.mkdir()
        glb = mesh_dir / "hero.glb"
        glb.write_bytes(b"glb-bytes")
        entry = history_service.append_entry(
            tmp,
            kind="prompt",
            label="Mesh",
            filename="mesh/hero.glb",
        )
        self.assertEqual(entry.get("filename"), "mesh/hero.glb")
        snap = entry.get("snapshot") or ""
        self.assertNotIn("/", snap)
        # Model blobs are Drive-backed now; the timeline keeps a flattened
        # snapshot key even when Drive is unavailable in an isolated test.
        self.assertTrue(snap.endswith(".glb"))

    def test_snapshot_name_flattens_engine_paths(self) -> None:
        name = history_service._snapshot_file_name(4, "mesh/Terminator Skull.glb")
        self.assertTrue(name.startswith("0004__"))
        self.assertNotIn("/", name)
        self.assertIn("mesh", name)


if __name__ == "__main__":
    unittest.main()
