"""GET /api/projects sidebar rows must not walk CAD files or flock generation.json."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import generation_service, project_store


class ProjectListSummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name) / "proj1"
        self.project.mkdir()
        (self.project / "model.stl").write_text("solid", encoding="utf-8")
        (self.project / "timeline.json").write_text(
            json.dumps({"current_index": 0, "entries": [{"id": i} for i in range(400)]}),
            encoding="utf-8",
        )
        (self.project / "generation.json").write_text(
            json.dumps(
                {
                    "status": "running",
                    "kind": "prompt",
                    "prompt": "A" * 5000,
                    "by_user_name": "Sam",
                    "jobs": [
                        {
                            "id": "j1",
                            "status": "running",
                            "kind": "prompt",
                            "trace_id": "t1",
                            "prompt": "A" * 5000,
                            "request_body": {"prompt": "A" * 8000, "mode": "vibecad"},
                            "progress": {"pct": 12},
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        project_store.save_meta(
            self.project,
            {"id": "proj1", "name": "Fast List", "file_count": 3, "updated_at": "2026-09-08T00:00:00+00:00"},
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_list_summary_skips_tree_timeline_and_generation_lock(self):
        with patch("backend.services.cad_service.list_project_files", side_effect=AssertionError("walked files")), patch(
            "backend.services.cad_service.list_browser_tree", side_effect=AssertionError("walked tree")
        ), patch("backend.services.generation_service.load", side_effect=AssertionError("generation flock")), patch(
            "backend.services.history_service.load_timeline", side_effect=AssertionError("timeline parse")
        ):
            row = project_store.project_list_summary(self.project)
        self.assertEqual(row["name"], "Fast List")
        self.assertEqual(row["file_count"], 3)
        self.assertNotIn("files", row)
        self.assertNotIn("browser", row)
        self.assertNotIn("timeline", row)
        self.assertNotIn("jobs", row["generation"])
        self.assertNotIn("prompt", row["generation"])
        self.assertEqual(row["generation"]["status"], "running")
        self.assertEqual(row["generation"]["running_count"], 1)
        self.assertEqual(row["generation"]["running_jobs"][0]["trace_id"], "t1")
        self.assertNotIn("request_body", row["generation"]["running_jobs"][0])
        self.assertIsNone(row.get("preview_url"))

    def test_list_public_summary_includes_live_cost_and_harness(self):
        (self.project / "generation.json").write_text(
            json.dumps(
                {
                    "status": "running",
                    "kind": "prompt",
                    "mode": "vibecad",
                    "harness": "vibecad",
                    "cost_usd": 0.37,
                    "usage": {"total_tokens": 8000},
                    "ai_calls": 2,
                    "jobs": [
                        {
                            "id": "j1",
                            "status": "running",
                            "kind": "prompt",
                            "trace_id": "t1",
                            "mode": "vibecad",
                            "harness": "vibecad",
                            "cost_usd": 0.37,
                            "usage": {"total_tokens": 8000},
                            "ai_calls": 2,
                            "progress": {"pct": 18, "harness": "vibecad", "cost_usd": 0.37},
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        summary = generation_service.list_public_summary(self.project)
        self.assertEqual(summary["harness"], "vibecad")
        self.assertEqual(summary["cost_usd"], 0.37)
        self.assertEqual(summary["running_jobs"][0]["cost_usd"], 0.37)
        self.assertEqual(summary["running_jobs"][0]["harness"], "vibecad")

    def test_public_summary_includes_harness_cost_and_detached(self):
        (self.project / "generation.json").write_text(
            json.dumps(
                {
                    "status": "running",
                    "kind": "prompt",
                    "mode": "vibecad",
                    "jobs": [
                        {
                            "id": "j1",
                            "status": "running",
                            "kind": "prompt",
                            "trace_id": "t1",
                            "mode": "vibecad",
                            "harness": "vibecad",
                            "detached": True,
                            "worker_pid": os.getpid(),
                            "started_at": "2026-09-14T20:00:00+00:00",
                            "updated_at": "2026-09-14T20:00:05+00:00",
                            "cost_usd": 0.37,
                            "usage": {"total_tokens": 8000},
                            "progress": {"pct": 18, "harness": "vibecad", "label": "VibeCAD · compiling…"},
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        summary = generation_service.public_summary(self.project)
        self.assertEqual(summary["status"], "running")
        self.assertEqual(summary["harness"], "vibecad")
        self.assertEqual(summary["cost_usd"], 0.37)
        self.assertTrue(summary["detached"])
        self.assertEqual(summary["progress"]["label"], "VibeCAD · compiling…")

    def test_list_summary_attaches_existing_thumb_without_walking_files(self):
        from backend.services.project_thumb import THUMB_NAME

        (self.project / THUMB_NAME).write_bytes(b"jpeg")
        with patch("backend.services.cad_service.list_project_files", side_effect=AssertionError("walked files")):
            row = project_store.project_list_summary(self.project)
        self.assertTrue(str(row.get("preview_url") or "").startswith("/api/projects/proj1/thumb"))

    def test_mark_opened_does_not_change_updated_at(self):
        before = project_store.load_meta(self.project)
        meta = project_store.mark_project_opened(self.project)
        self.assertTrue(meta.get("opened_at"))
        self.assertEqual(meta.get("updated_at"), before.get("updated_at"))
        row = project_store.project_list_summary(self.project)
        self.assertEqual(row["opened_at"], meta["opened_at"])
        self.assertGreater(project_store.project_recency_stamp(row), row["updated_at"] or "")

    def test_list_public_summary_does_not_flock(self):
        with patch.object(generation_service, "_file_lock", side_effect=AssertionError("flock")):
            summary = generation_service.list_public_summary(self.project)
        self.assertEqual(summary["status"], "running")
        self.assertEqual(summary["running_count"], 1)
        self.assertNotIn("prompt", summary)


class ProjectOpenSummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name) / "open1"
        self.project.mkdir()
        vibecad = self.project / "vibecad"
        vibecad.mkdir()
        (vibecad / "Clamp.step").write_text("ISO-10303", encoding="utf-8")
        (vibecad / "Clamp.glb").write_bytes(b"glb")
        (self.project / "OpenArm_2.0.glb").write_bytes(b"robot")
        (self.project / "generation.json").write_text(
            json.dumps({"status": "done", "kind": "prompt", "filename": "vibecad/Clamp.glb"}),
            encoding="utf-8",
        )
        project_store.save_meta(
            self.project,
            {"id": "open1", "name": "Clamp", "file_count": 3, "updated_at": "2026-09-10T00:00:00+00:00"},
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_open_summary_skips_browser_tree_and_prefers_generation_mesh(self):
        with patch(
            "backend.services.cad_service.list_browser_tree",
            side_effect=AssertionError("walked browser tree"),
        ), patch(
            "backend.services.project_store.latest_model_file",
            side_effect=AssertionError("latest_model_file"),
        ), patch(
            "backend.services.project_viewport_manifest.project_viewport_browser",
            side_effect=AssertionError("walked viewport manifest"),
        ), patch(
            "backend.services.generation_service.load",
            side_effect=AssertionError("generation flock"),
        ):
            row = project_store.project_open_summary(self.project)
        self.assertTrue(row["open_lite"])
        self.assertEqual(row["latest_file"], "vibecad/Clamp.glb")
        component_names = {c["name"] for c in row["browser"]["components"]}
        self.assertIn("vibecad/Clamp.glb", component_names)
        self.assertIn("OpenArm_2.0.glb", component_names)
        self.assertTrue(any(c.get("primary") and c["name"] == "vibecad/Clamp.glb" for c in row["browser"]["components"]))
        names = {f["name"] for f in row["files"]}
        self.assertIn("vibecad/Clamp.glb", names)
        self.assertIn("OpenArm_2.0.glb", names)

    def test_open_recovers_hidden_viewer_even_with_tombstoned_public_files(self):
        from backend.services import cad_service
        for leftover in ("OpenArm_2.0.glb", "vibecad/Clamp.glb", "vibecad/Clamp.step"):
            path = self.project / leftover
            if path.is_file():
                path.unlink()
        (self.project / "generation.json").write_text(
            json.dumps({"status": "done", "kind": "prompt"}),
            encoding="utf-8",
        )
        (self.project / "Bracket.step").write_text("ISO-10303", encoding="utf-8")
        (self.project / "Bracket.glb").write_bytes(b"public")
        (self.project / ".Bracket.step.glb").write_bytes(b"hidden")
        cad_service.add_deleted_catalogs(self.project, ["Bracket", "Bracket.glb", "Bracket.step"])
        with patch.object(cad_service, "_body_children_from_viewer_scene", side_effect=AssertionError("body hydration")), patch.object(
            cad_service, "load_mesh", side_effect=AssertionError("mesh parse")
        ):
            row = project_store.project_open_summary(self.project)
        self.assertEqual(row["latest_file"], "Bracket.glb")
        recovered_file = next(f for f in row["files"] if f.get("name") == "Bracket.glb")
        self.assertEqual(recovered_file.get("viewer_filename"), ".Bracket.step.glb")
        self.assertNotIn(".Bracket.step.glb", {f["name"] for f in row["files"]})
        recovered = next(c for c in row["browser"]["components"] if c.get("primary"))
        self.assertEqual(recovered["name"], "Bracket.glb")
        self.assertEqual(recovered["viewer_filename"], ".Bracket.step.glb")

    def test_newer_hardware_cannot_replace_designed_primary(self):
        from backend.services import cad_service
        for name in ("OpenArm_2.0.glb", "generation.json"):
            (self.project / name).unlink()
        hardware = self.project / "91290A113.glb"
        hardware.write_bytes(b"bolt")
        newer = (self.project / "vibecad/Clamp.glb").stat().st_mtime + 50
        os.utime(hardware, (newer, newer))
        self.assertTrue(cad_service.looks_like_mcmaster_part_stem(hardware.stem))
        row = project_store.project_open_summary(self.project)
        self.assertEqual(row["latest_file"], "vibecad/Clamp.glb")
        component_names = {c["name"] for c in row["browser"]["components"]}
        self.assertIn("vibecad/Clamp.glb", component_names)
        self.assertNotIn("91290A113.glb", component_names)

    def test_open_summary_maps_step_generation_to_sibling_glb(self):
        (self.project / "generation.json").write_text(
            json.dumps({"status": "done", "kind": "prompt", "filename": "vibecad/Clamp.step"}),
            encoding="utf-8",
        )
        row = project_store.project_open_summary(self.project)
        self.assertEqual(row["latest_file"], "vibecad/Clamp.glb")

    def test_open_summary_hides_share_bake_sidecar(self):
        share = self.project / "_share_visible_ZbXNZ8z5.glb"
        share.write_bytes(b"share-bake")
        share_mtime = (self.project / "vibecad" / "Clamp.glb").stat().st_mtime + 10
        os.utime(share, (share_mtime, share_mtime))
        row = project_store.project_open_summary(self.project)
        names = {f["name"] for f in row["files"]}
        self.assertNotIn("_share_visible_ZbXNZ8z5.glb", names)
        self.assertEqual(row["latest_file"], "vibecad/Clamp.glb")
        (self.project / "generation.json").write_text(
            json.dumps({"status": "done", "kind": "prompt"}),
            encoding="utf-8",
        )
        row = project_store.project_open_summary(self.project)
        self.assertNotEqual(row["latest_file"], "_share_visible_ZbXNZ8z5.glb")
        self.assertIn(row["latest_file"], {"vibecad/Clamp.glb", "OpenArm_2.0.glb"})
        self.assertNotIn("_share_visible_ZbXNZ8z5.glb", {f["name"] for f in row["files"]})

    def test_open_summary_prefers_glb_over_newer_obj_dump(self):
        hopper = self.project / "hopper"
        hopper.mkdir()
        # Isolate this case from Clamp/OpenArm leftovers in setUp.
        for leftover in ("OpenArm_2.0.glb", "vibecad/Clamp.glb", "vibecad/Clamp.step"):
            path = self.project / leftover
            if path.is_file():
                path.unlink()
        (self.project / "generation.json").write_text(
            json.dumps({"status": "done", "kind": "prompt"}),
            encoding="utf-8",
        )
        glb = self.project / "new assem_3.glb"
        obj = self.project / "new assem_3.obj"
        glb.write_bytes(b"glb")
        obj.write_bytes(b"obj-dump")
        newer = glb.stat().st_mtime + 20
        os.utime(obj, (newer, newer))
        row = project_store.project_open_summary(self.project)
        self.assertEqual(row["latest_file"], "new assem_3.glb")

    def test_open_summary_hides_exploded_part_sidecars(self):
        for leftover in ("OpenArm_2.0.glb", "vibecad/Clamp.glb", "vibecad/Clamp.step"):
            path = self.project / leftover
            if path.is_file():
                path.unlink()
        (self.project / "generation.json").write_text(
            json.dumps({"status": "done", "kind": "prompt"}),
            encoding="utf-8",
        )
        base = "concrete_printer_auger_cylindrical_extruder_matc_part"
        (self.project / f"{base}.glb").write_bytes(b"parent-glb")
        (self.project / f"{base}.step").write_text("ISO-10303-21;", encoding="utf-8")
        for idx in range(1, 4):
            (self.project / f"{base}__part_{idx:02d}_body_{idx}.glb").write_bytes(b"body")
        (self.project / f"{base}_part01.glb").write_bytes(b"island")
        row = project_store.project_open_summary(self.project)
        names = {c["name"] for c in row["browser"]["components"]}
        self.assertEqual(names, {f"{base}.glb"})
        self.assertTrue(any(c.get("primary") for c in row["browser"]["components"]))
        self.assertNotEqual(row["latest_file"], f"{base}__part_01_body_1.glb")


class LiteListPublicTests(unittest.TestCase):
    def test_lite_project_list_still_attaches_public_folder(self):
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index("def list_projects(")
        end = src.index("@app.get(\"/api/public/projects\")")
        fn = src[start:end]
        self.assertIn("public_projects = _public_project_summaries(", fn)
        lite_block = fn[fn.index("if not lite:"):fn.index("public_projects = _public_project_summaries(")]
        self.assertIn("_other_user_render_summaries", lite_block)
        self.assertNotIn("_public_project_summaries", lite_block)

    def test_open_summary_skips_timeline_parse(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            project = Path(tmp.name) / "open1"
            project.mkdir()
            (project / "part.glb").write_bytes(b"glb")
            project_store.save_meta(project, {"id": "open1", "name": "Part"})
            with patch(
                "backend.services.history_service.timeline_summary",
                side_effect=AssertionError("timeline parse"),
            ):
                row = project_store.project_open_summary(project)
            self.assertEqual(row["timeline"], {"entries": [], "current_index": -1})
            self.assertTrue(row["open_lite"])
        finally:
            tmp.cleanup()

    def test_open_summary_does_not_start_drive_restore(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            project = Path(tmp.name) / "open2"
            project.mkdir()
            (project / "part.glb").write_bytes(b"glb")
            project_store.save_meta(project, {"id": "open2", "name": "Part"})
            with patch(
                "backend.services.project_store.history_service.schedule_missing_live_restore",
                side_effect=AssertionError("drive restore"),
            ):
                row = project_store.project_open_summary(project)
            self.assertTrue(row["open_lite"])
        finally:
            tmp.cleanup()

    def test_public_open_skips_prompt_history_walk(self):
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index("def get_public_project(")
        end = src.index("@app.get(\"/api/public/projects/{project_id}/prompt-history\")")
        fn = src[start:end]
        self.assertIn('kind in {"open", "lite", "full"}', fn)
        self.assertNotIn("project_summary(project_path)", fn)
        prompt_if = fn.index('if kind in {"open", "lite", "full"}:')
        open_block = fn[prompt_if:fn.index("else:", prompt_if)]
        self.assertNotIn("_public_generated_by", open_block)
        self.assertNotIn("_public_prompt_history", open_block)
        self.assertIn("_public_generated_by", fn)
        list_fn_start = src.index("def list_public_projects(")
        list_fn = src[list_fn_start:src.index("def _public_prompt_entry(")]
        self.assertIn("_public_folder_summary(projects)", list_fn)
        self.assertEqual(list_fn.count("_public_project_summaries()"), 1)
        prompt_ep = src[
            src.index("@app.get(\"/api/public/projects/{project_id}/prompt-history\")")
            : src.index("@app.get(\"/api/public/projects/{project_id}/timeline\")")
        ]
        self.assertNotIn("_public_generated_by", prompt_ep)
        hist_ep = src[
            src.index("@app.get(\"/api/public/projects/{project_id}/project-history\")")
            : src.index("@app.post(\"/api/projects/{project_id}/public\")")
        ]
        self.assertNotIn("_public_generated_by", hist_ep)

    def test_private_view_full_uses_open_summary(self):
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index("def get_project(")
        end = src.index("@app.patch(\"/api/projects/{project_id}/opened\")")
        fn = src[start:end]
        self.assertIn('kind in {"open", "lite", "full"}', fn)
        open_branch = fn[fn.index("elif kind in"):fn.index("else:")]
        self.assertIn("project_open_summary", open_branch)
        self.assertNotIn("project_summary(path)", open_branch)

    def test_history_endpoints_exist_while_open_skips_timeline(self):
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        self.assertIn('@app.get("/api/projects/{project_id}/timeline")', src)
        self.assertIn('@app.get("/api/projects/{project_id}/project-history")', src)
        self.assertIn('@app.get("/api/projects/{project_id}/prompt-history")', src)
        self.assertIn('@app.get("/api/public/projects/{project_id}/timeline")', src)
        self.assertIn("timeline_summary(path, sync_prompts=False)", src)
        open_src = Path(__file__).resolve().parents[1].joinpath("services/project_store.py").read_text(
            encoding="utf-8"
        )
        start = open_src.index("def project_open_summary(")
        end = open_src.index("def project_wiring_summary(")
        open_fn = open_src[start:end]
        self.assertIn('timeline = {"entries": [], "current_index": -1}', open_fn)
        self.assertNotIn("timeline_summary", open_fn)
        self.assertNotIn("list_browser_tree", open_fn)
        self.assertIn("list_reference_files", open_fn)
        self.assertNotIn("schedule_missing_live_restore", open_fn)

    def test_open_summary_lists_reference_recordings(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            project = Path(tmp.name) / "rec1"
            project.mkdir()
            rec = project / "references" / "Screen Recordings"
            rec.mkdir(parents=True)
            (rec / "Fullscreen-recording.webm").write_bytes(b"webm-bytes")
            (project / "part.glb").write_bytes(b"glb")
            project_store.save_meta(project, {"id": "rec1", "name": "Rec"})
            with patch(
                "backend.services.cad_service.list_browser_tree",
                side_effect=AssertionError("walked browser tree"),
            ):
                row = project_store.project_open_summary(project)
            refs = row["browser"]["references"]
            self.assertTrue(row["open_lite"])
            self.assertEqual(len(refs), 1)
            self.assertEqual(refs[0]["name"], "Fullscreen-recording.webm")
            self.assertEqual(refs[0]["folder"], "Screen Recordings")
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
