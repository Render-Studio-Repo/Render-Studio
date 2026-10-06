"""Prompt history shows Jake/CAD jobs immediately as Generating, then OK/Failed."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import incident_intelligence_service as ii
from backend.services import prompt_history_service


class PromptHistoryRunningTests(unittest.TestCase):
    def test_running_entry_is_listed_before_complete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            running = prompt_history_service.append_entry(
                project,
                prompt="make a 40mm flange",
                success=False,
                status="running",
                entry_id="pJakeRun1",
                prompt_mode="v2",
                speed="fast",
                trace_id="tr-1",
            )
            self.assertEqual(running["status"], "running")
            self.assertFalse(running["success"])
            listed = prompt_history_service.load(project)["entries"]
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["prompt"], "make a 40mm flange")
            self.assertEqual(listed[0]["status"], "running")

            done = prompt_history_service.append_entry(
                project,
                prompt="make a 40mm flange",
                success=True,
                filename="flange.glb",
                entry_id="pJakeRun1",
                prompt_mode="v2",
                speed="fast",
                trace_id="tr-1",
            )
            self.assertTrue(done["success"])
            self.assertEqual(done["id"], "pJakeRun1")
            listed = prompt_history_service.load(project)["entries"]
            self.assertEqual(len(listed), 1)
            self.assertTrue(listed[0]["success"])
            self.assertNotEqual(listed[0].get("status"), "running")

    def test_generation_job_row_includes_running_jake_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            row = prompt_history_service._row_from_generation_job(
                {
                    "kind": "prompt",
                    "status": "running",
                    "trace_id": "tr-jake",
                    "prompt_id": "pLive1",
                    "started_at": "2026-09-07T16:00:00+00:00",
                    "request_body": {
                        "prompt": "parametric phone stand",
                        "prompt_id": "pLive1",
                        "mode": "v2",
                    },
                    "mode": "v2",
                },
                project,
            )
            self.assertIsNotNone(row)
            self.assertEqual(row["prompt"], "parametric phone stand")
            self.assertEqual(row["status"], "running")
            self.assertFalse(row["success"])
            self.assertEqual(row.get("started_at"), "2026-09-07T16:00:00+00:00")
            self.assertNotIn("finished_at", row)
            self.assertNotIn("elapsed_ms", row)

    def test_job_timing_from_started_and_finished(self) -> None:
        timing = prompt_history_service.job_timing_fields(
            {
                "status": "complete",
                "started_at": "2026-09-08T12:00:00+00:00",
                "finished_at": "2026-09-08T12:02:14+00:00",
            }
        )
        self.assertEqual(timing["started_at"], "2026-09-08T12:00:00+00:00")
        self.assertEqual(timing["finished_at"], "2026-09-08T12:02:14+00:00")
        self.assertEqual(timing["elapsed_ms"], 134_000)

        entry: dict = {"created_at": "2026-09-08T12:00:00+00:00"}
        self.assertTrue(prompt_history_service.apply_job_timing_to_entry(entry, {
            "status": "complete",
            "started_at": "2026-09-08T12:00:00+00:00",
            "finished_at": "2026-09-08T12:02:14+00:00",
        }))
        self.assertEqual(entry["elapsed_ms"], 134_000)

        running = prompt_history_service.job_timing_fields(
            {
                "status": "running",
                "started_at": "2026-09-08T12:00:00+00:00",
                "finished_at": "2026-09-08T12:02:14+00:00",
                "elapsed_ms": 999,
            }
        )
        self.assertEqual(running.get("started_at"), "2026-09-08T12:00:00+00:00")
        self.assertNotIn("finished_at", running)
        self.assertNotIn("elapsed_ms", running)

    def test_unified_list_keeps_cad_and_stores_imagine_file_thumbs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            (project / "imagine").mkdir()
            (project / "imagine" / "kettle.png").write_bytes(b"PNG")
            prompt_history_service.append_entry(
                project,
                prompt="40mm flange",
                success=True,
                kind="cad",
                filename="flange.glb",
                user_name="Sam",
            )
            prompt_history_service.append_entry(
                project,
                prompt="matte black kettle",
                success=True,
                kind="imagine",
                filename="imagine/kettle.png",
                user_name="Sam",
                images=prompt_history_service.history_images_from_project_files(
                    project,
                    [{"name": "imagine/kettle.png"}],
                    project_id="proj-1",
                ),
            )
            prompt_history_service.append_entry(
                project,
                prompt="blink an LED",
                success=True,
                kind="wiring",
                user_name="Sam",
            )
            cad_only = prompt_history_service.list_entries(project, kind="cad")
            self.assertEqual(len(cad_only), 1)
            self.assertEqual(cad_only[0]["kind"], "cad")
            unified = prompt_history_service.list_entries(project)
            kinds = [row.get("kind") for row in unified]
            self.assertEqual(set(kinds), {"cad", "imagine", "wiring"})
            imagine = next(row for row in unified if row.get("kind") == "imagine")
            self.assertEqual(imagine["user_name"], "Sam")
            self.assertTrue(imagine["images"])
            self.assertEqual(imagine["images"][0]["source_filename"], "imagine/kettle.png")
            self.assertIn("/files/imagine/kettle.png", imagine["images"][0]["url"])
            self.assertEqual(imagine["image_count"], 1)

    def test_running_prompt_is_not_first_broken(self):
        self.assertEqual(prompt_history_service.prompt_run_incident_status(False, "running"), "unknown")
        self.assertEqual(prompt_history_service.prompt_run_incident_status(False, "failed"), "broken")
        self.assertEqual(prompt_history_service.prompt_run_incident_status(True, ""), "ok")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
                running = prompt_history_service.stamp_prompt_run_incident(
                    project_id="64d81b05",
                    prompt_id="f638a50797c7",
                    prompt="Fish lamp post",
                    kind="cad",
                    success=False,
                    status="running",
                    trace_id="9f268631",
                    elapsed_ms=0,
                )
                self.assertEqual(running["feature"], "prompt.run")
                self.assertEqual(running["status"], "unknown")
                self.assertIn("tracking_id", running["fields"])
                failed = prompt_history_service.stamp_prompt_run_incident(
                    project_id="64d81b05",
                    prompt_id="f638a50797c7",
                    prompt="Fish lamp post",
                    kind="cad",
                    success=False,
                    error="text-to-cad 2.0 failed after 7 attempts",
                    status="failed",
                    trace_id="9f268631",
                    elapsed_ms=120000,
                )
                self.assertEqual(failed["status"], "broken")
                self.assertEqual(failed["fields"]["duration_s"], 120.0)
                compared = ii.compare("prompt.run")
                self.assertEqual(compared["first_failure"]["id"], failed["id"])
                self.assertIsNone(compared["last_working"])

    def test_stamp_design_build_error_if_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
                skipped = prompt_history_service.stamp_design_build_error_if_missing(
                    {"id": "hist-already"},
                    project_id="64d81b05",
                    prompt="Fish lamp post",
                    error="AI response did not contain gen_step() or a cadgen @step model.",
                    trace_id="9f268631",
                )
                self.assertTrue(skipped["skipped"])
                self.assertEqual(skipped["reason"], "already-stamped-via-history")
                self.assertFalse(skipped.get("invented"))
                before = ii.latest("prompt.run")
                stamped = prompt_history_service.stamp_design_build_error_if_missing(
                    None,
                    project_id="64d81b05",
                    prompt="Fish lamp post",
                    error="AI response did not contain gen_step() or a cadgen @step model.",
                    trace_id="9f268631",
                )
                self.assertFalse(stamped["skipped"])
                self.assertEqual(stamped["reason"], "history-missing")
                self.assertEqual((stamped.get("stamp") or {}).get("feature"), "prompt.run")
                self.assertEqual((stamped.get("stamp") or {}).get("status"), "broken")
                latest = ii.latest("prompt.run")
                self.assertIsNotNone(latest)
                self.assertNotEqual((before or {}).get("id"), latest.get("id"))


if __name__ == "__main__":
    unittest.main()
