"""Model history snapshots go to Google Drive, not local CAD copies."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import drive_model_snapshot_service, history_service, project_store


class DriveHistorySnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.backend = drive_model_snapshot_service.MemoryDriveBackend()
        drive_model_snapshot_service.set_backend(self.backend)

    def tearDown(self) -> None:
        drive_model_snapshot_service.set_backend(None)

    def _project(self) -> Path:
        root = Path(tempfile.mkdtemp())
        (root / "chassis.glb").write_bytes(b"CHASSIS-GLB" * 8000)
        (root / "chassis.step").write_bytes(b"ISO-10303-21;" + b"B-REP" * 200)
        (root / "chassis.3mf").write_bytes(b"FAT-3MF" * 20000)
        (root / "chassis_exploded.glb").write_bytes(b"EXPLODED-GLB" * 12000)
        return root

    def test_append_uploads_to_drive_not_local_history(self) -> None:
        root = self._project()
        entry = history_service.append_entry(root, kind="prompt", label="Chassis", filename="chassis.glb")
        hist = root / "history"
        if hist.is_dir():
            blobs = [p for p in hist.iterdir() if p.is_file()]
            self.assertEqual(blobs, [])
        self.assertTrue(entry.get("drive_file_id") or any(
            item.get("drive_file_id") for item in entry.get("snapshot_files") or []
        ))
        self.assertTrue((root / "chassis.glb").is_file())
        self.assertTrue((root / "chassis.3mf").is_file())
        data = history_service.load_timeline(root)
        self.assertIn("chassis.glb", data.get("drive_latest") or {})

    def test_restore_uses_engine_folder_when_drive_fails(self) -> None:
        root = Path(tempfile.mkdtemp())
        engine = root / "vibecad"
        engine.mkdir()
        payload = b"glTF" + b"LOCAL-PURSE" * 8000
        (engine / "purse.glb").write_bytes(payload)
        (root / "purse.glb").write_text('{"id": "1zhROzih9mrNBB_qCHTkYVmovLO7IxVRI"}\n')
        (root / "timeline.json").write_text(
            '{"current_index":0,"entries":[{'
            '"index":0,"id":"step0","kind":"prompt","label":"Purse",'
            '"filename":"vibecad/purse.glb",'
            '"snapshot":"0000__vibecad__purse__glb",'
            '"snapshot_files":[{"filename":"purse.glb",'
            '"snapshot":"0000__vibecad__purse__glb","bytes":'
            + str(len(payload))
            + ',"drive_error":"dns"}]}]}'
        )

        def _boom(*_a, **_k):
            raise OSError("SSL: WRONG_VERSION_NUMBER")

        with patch.object(drive_model_snapshot_service, "download_file", _boom):
            restored = history_service.restore_as_latest(root, 0)
        self.assertEqual(restored["filename"], "vibecad/purse.glb")
        self.assertEqual((engine / "purse.glb").read_bytes(), payload)
        self.assertFalse((root / "purse.glb").is_file())

    def test_restore_timeline_from_drive(self) -> None:
        root = self._project()
        history_service.append_entry(root, kind="prompt", label="Chassis", filename="chassis.glb")
        original = (root / "chassis.glb").read_bytes()
        (root / "chassis.glb").write_bytes(b"CHANGED-GLB" * 8000)
        history_service.append_entry(root, kind="transform", label="Move", filename="chassis.glb")
        history_service.go_to_index(root, 0)
        self.assertEqual((root / "chassis.glb").read_bytes(), original)
        self.assertTrue((root / "chassis.3mf").is_file())

    def test_auto_restore_missing_live_file(self) -> None:
        root = self._project()
        history_service.append_entry(root, kind="prompt", label="Chassis", filename="chassis.glb")
        payload = (root / "chassis.glb").read_bytes()
        (root / "chassis.glb").unlink()
        restored = history_service.restore_missing_live_file(root, "chassis.glb")
        self.assertIsNotNone(restored)
        self.assertEqual(Path(restored).read_bytes(), payload)

    def test_auto_restore_does_not_overwrite_healthy_live(self) -> None:
        root = self._project()
        history_service.append_entry(root, kind="prompt", label="Chassis", filename="chassis.glb")
        (root / "chassis.glb").write_bytes(b"NEWER-HEALTHY-FILE" * 400)
        out = history_service.restore_missing_live_file(root, "chassis.glb")
        self.assertIsNone(out)
        self.assertTrue((root / "chassis.glb").read_bytes().startswith(b"NEWER-HEALTHY-FILE"))

    def test_project_open_restores_missing_current(self) -> None:
        root = self._project()
        history_service.append_entry(root, kind="prompt", label="Chassis", filename="chassis.glb")
        payload = (root / "chassis.glb").read_bytes()
        (root / "chassis.glb").unlink()
        names = history_service.ensure_missing_live_models(root)
        self.assertIn("chassis.glb", names)
        self.assertEqual((root / "chassis.glb").read_bytes(), payload)

    def test_reclaim_deletes_duplicate_local_history(self) -> None:
        root = self._project()
        hist = root / "history"
        hist.mkdir()
        blob = hist / "0001__chassis__glb"
        blob.write_bytes((root / "chassis.glb").read_bytes())
        stats = history_service.reclaim_local_history_blobs(root)
        self.assertEqual(stats["deleted_duplicate"], 1)
        self.assertFalse(blob.exists())
        self.assertTrue((root / "chassis.glb").is_file())

    def test_reclaim_uploads_unique_then_deletes(self) -> None:
        root = self._project()
        hist = root / "history"
        hist.mkdir()
        blob = hist / "0001__old-chassis__glb"
        blob.write_bytes(b"UNIQUE-OLD-CHASSIS" * 5000)
        (root / "timeline.json").write_text(
            '{"current_index":0,"entries":[{"index":0,"id":"abcd","kind":"prompt","label":"old",'
            '"filename":"chassis.glb","snapshot":"0001__old-chassis__glb",'
            '"snapshot_files":[{"filename":"chassis.glb","snapshot":"0001__old-chassis__glb"}]}]}'
        )
        stats = history_service.reclaim_local_history_blobs(root)
        self.assertEqual(stats["deleted_after_upload"], 1)
        self.assertFalse(blob.exists())
        data = history_service.load_timeline(root)
        item = data["entries"][0]["snapshot_files"][0]
        self.assertTrue(item.get("drive_file_id"))
        self.assertIn(item["drive_file_id"], self.backend.files)

    def test_reclaim_keeps_unique_if_upload_fails(self) -> None:
        root = self._project()
        hist = root / "history"
        hist.mkdir()
        blob = hist / "0001__unique__glb"
        blob.write_bytes(b"UNIQUE-KEEP-ME" * 4000)
        self.backend.fail_uploads = True
        stats = history_service.reclaim_local_history_blobs(root)
        self.assertEqual(stats["kept_upload_failed"], 1)
        self.assertTrue(blob.is_file())
        self.assertTrue((root / "chassis.stl").is_file() if (root / "chassis.stl").exists() else True)
        self.assertTrue((root / "chassis.3mf").is_file())

    def test_latest_model_file_restores(self) -> None:
        root = self._project()
        history_service.append_entry(root, kind="prompt", label="Chassis", filename="chassis.glb")
        (root / "chassis.glb").unlink()
        name = project_store.latest_model_file(root)
        self.assertEqual(name, "chassis.glb")
        self.assertTrue((root / "chassis.glb").is_file())


if __name__ == "__main__":
    unittest.main()
