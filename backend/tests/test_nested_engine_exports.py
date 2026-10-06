"""Nested jake/vibecad/mesh files must hit /exports and /share, not the GET catch-all."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.services.cad_service import list_exports_for_model


class NestedFileRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()

        @app.post("/api/projects/{project_id}/files/{filename:path}/share")
        def share(project_id: str, filename: str):
            return {"filename": filename, "route": "share"}

        @app.get("/api/projects/{project_id}/files/{filename:path}/exports")
        def exports(project_id: str, filename: str):
            return {"filename": filename, "route": "exports"}

        @app.post("/api/projects/{project_id}/files/{filename:path}/exports/regenerate")
        def regen(project_id: str, filename: str):
            return {"filename": filename, "route": "regenerate"}

        @app.get("/api/projects/{project_id}/files/{filename:path}")
        def get_file(project_id: str, filename: str):
            return {"filename": filename, "route": "file"}

        self.client = TestClient(app)

    def test_nested_share_and_exports_bind_full_rel_path(self) -> None:
        nested = "mesh/terminator spartan skull.glb"
        share = self.client.post(f"/api/projects/c1383314/files/{nested}/share")
        self.assertEqual(share.status_code, 200)
        self.assertEqual(share.json()["filename"], nested)
        self.assertEqual(share.json()["route"], "share")

        exports = self.client.get(f"/api/projects/c1383314/files/{nested}/exports")
        self.assertEqual(exports.status_code, 200)
        self.assertEqual(exports.json()["filename"], nested)
        self.assertEqual(exports.json()["route"], "exports")

        regen = self.client.post(f"/api/projects/c1383314/files/{nested}/exports/regenerate")
        self.assertEqual(regen.status_code, 200)
        self.assertEqual(regen.json()["filename"], nested)

        file_get = self.client.get(f"/api/projects/c1383314/files/{nested}")
        self.assertEqual(file_get.status_code, 200)
        self.assertEqual(file_get.json()["route"], "file")
        self.assertEqual(file_get.json()["filename"], nested)

    def test_post_to_file_path_is_method_not_allowed(self) -> None:
        res = self.client.post("/api/projects/c1383314/files/mesh/terminator.glb")
        self.assertEqual(res.status_code, 405)

    def test_single_segment_names_still_match_suffix_routes(self) -> None:
        res = self.client.get("/api/projects/p/files/model.glb/exports")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["filename"], "model.glb")


class NestedExportListingTests(unittest.TestCase):
    def test_lists_siblings_in_mesh_folder(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        (folder / "skull.glb").write_bytes(b"glb")
        (folder / "skull.stl").write_bytes(b"stl")
        (folder / "skull.3mf").write_bytes(b"3mf")
        exports = list_exports_for_model(root, "mesh/skull.glb")
        names = {item["name"] for item in exports}
        self.assertIn("mesh/skull.glb", names)
        self.assertIn("mesh/skull.stl", names)
        self.assertIn("mesh/skull.3mf", names)

    def test_root_files_still_list(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "model.glb").write_bytes(b"glb")
        (root / "model.stl").write_bytes(b"stl")
        exports = list_exports_for_model(root, "model.glb")
        names = {item["name"] for item in exports}
        self.assertIn("model.glb", names)
        self.assertIn("model.stl", names)

    def test_missing_export_reason_names_unwritten_format(self) -> None:
        from backend.services.cad_service import missing_export_reason

        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        (folder / "skull.glb").write_bytes(b"glb")
        reason = missing_export_reason(root, "skull.step")
        self.assertIn("STEP", reason)
        self.assertIn("never generated", reason)
        self.assertRegex(reason, r"GLB")
        gone = missing_export_reason(root, "nope.glb")
        self.assertIn("not on disk", gone)
        self.assertIn("No STEP or GLB", gone)

    def test_finds_nested_mesh_file_by_stem(self) -> None:
        from backend.services.cad_service import find_cad_file_for_stem

        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        (folder / "skull.glb").write_bytes(b"glb")
        found = find_cad_file_for_stem(root, "skull", {".glb"})
        self.assertIsNotNone(found)
        self.assertEqual(found.name, "skull.glb")
        self.assertEqual(found.parent.name, "mesh")


_MIN_STEP = (
    b"ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nENDSEC;\n"
    b"DATA;\nENDSEC;\nEND-ISO-10303-21;\n"
)


class EditedHardwareStepExportTests(unittest.TestCase):
    def test_edited_step_request_does_not_resolve_to_glb(self) -> None:
        from backend.services.cad_service import resolve_existing_project_file

        root = Path(tempfile.mkdtemp())
        (root / "8020-1020-BLACK X 36.step").write_bytes(_MIN_STEP)
        (root / "8020-1020-BLACK X 36_edited.glb").write_bytes(b"glb")
        found = resolve_existing_project_file(root, "8020-1020-BLACK X 36_edited.step")
        self.assertEqual(found, "8020-1020-BLACK X 36.step")

    def test_lists_convertible_edited_step_not_catalog_name(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "8020-1020-BLACK X 36.step").write_bytes(_MIN_STEP)
        (root / "8020-1020-BLACK X 36_edited.glb").write_bytes(b"glb")
        exports = list_exports_for_model(root, "8020-1020-BLACK X 36_edited.glb")
        steps = [item for item in exports if item.get("format") == "step"]
        self.assertEqual(len(steps), 1)
        self.assertEqual(Path(steps[0]["name"]).name, "8020-1020-BLACK X 36_edited.step")
        self.assertTrue(steps[0].get("convertible"))
        self.assertEqual(steps[0].get("download_name"), "8020-1020-BLACK X 36_edited.step")

    def test_ensure_writes_edited_step_from_catalog_parent(self) -> None:
        from backend.services.cad_service import ensure_editable_step_for_export

        root = Path(tempfile.mkdtemp())
        (root / "8020-1020-BLACK X 36.step").write_bytes(_MIN_STEP)
        (root / "8020-1020-BLACK X 36_edited.glb").write_bytes(b"glb")
        written = ensure_editable_step_for_export(root, "8020-1020-BLACK X 36_edited.glb")
        self.assertIsNotNone(written)
        self.assertEqual(written.name, "8020-1020-BLACK X 36_edited.step")
        self.assertTrue(written.is_file())
        self.assertIn(b"ISO-10303", written.read_bytes()[:64])

    def test_uppercase_step_lists_real_filename(self) -> None:
        from backend.services.cad_service import resolve_existing_project_file

        root = Path(tempfile.mkdtemp())
        (root / "new assem.STEP").write_bytes(_MIN_STEP)
        (root / "new assem.glb").write_bytes(b"glb")
        self.assertEqual(resolve_existing_project_file(root, "new assem.step"), "new assem.STEP")
        exports = list_exports_for_model(root, "new assem.glb")
        steps = [item for item in exports if item.get("format") == "step"]
        self.assertEqual(len(steps), 1)
        self.assertEqual(steps[0]["name"], "new assem.STEP")
        self.assertGreater(int(steps[0].get("size") or 0), 0)
        self.assertFalse(steps[0].get("convertible"))

    def test_split_file_api_suffix_strips_exports_leaf(self) -> None:
        from backend.services.cad_service import split_file_api_suffix

        model, suffix = split_file_api_suffix("new assem.glb/exports")
        self.assertEqual(model, "new assem.glb")
        self.assertEqual(suffix, "exports")
        nested, suffix = split_file_api_suffix("mesh/skull.glb/exports")
        self.assertEqual(nested, "mesh/skull.glb")
        self.assertEqual(suffix, "exports")
        plain, suffix = split_file_api_suffix("new assem.glb")
        self.assertEqual(plain, "new assem.glb")
        self.assertIsNone(suffix)


class RealAppExportRouteOrderTests(unittest.TestCase):
    def test_exports_suffix_is_not_swallowed_by_file_catchall(self) -> None:
        from starlette.routing import Match

        from backend.main import app

        paths = (
            "/api/projects/3009d4bc/files/new assem.glb/exports",
            "/api/projects/3009d4bc/files/new assem.STEP/exports",
            "/api/projects/3009d4bc/files/mesh/foo.glb/exports",
        )
        for path in paths:
            scope = {"type": "http", "path": path, "method": "GET", "headers": []}
            matched = None
            for route in app.router.routes:
                try:
                    match, _ = route.matches(scope)
                except Exception:
                    continue
                if match == Match.FULL:
                    matched = getattr(getattr(route, "endpoint", None), "__name__", "")
                    break
            self.assertEqual(matched, "list_file_exports", path)


if __name__ == "__main__":
    unittest.main()
