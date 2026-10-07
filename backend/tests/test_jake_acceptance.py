"""Jake must publish only current-run exports with successful inspection."""

from __future__ import annotations

import os
import base64
import hashlib
import json
import tempfile
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

import trimesh
from build123d import Box, export_step

from backend.services.design_service import (
    DesignBuildError,
    _measure_or_rebuild_step_preview,
    _run_text_to_cad_v2_body,
    _wire_jake_artifacts_to_product_shell,
)
from backend.services.design_service import _v2_snapshot_review_repair_note
from backend.services.cad_pass_gate import CadRunManifest
from backend.services.codex_agent import _build_prompt
from backend.services.jake_tool_agent import JakeToolAgent
from backend.services.skill_runner import run_skill_tool as run_real_skill_tool


SOURCE = """from cadgen import build123d as bd

def gen_step():
    return bd.Box(40, 20, 4)
"""


def inspect_result(*, minimum=(-20, -10, -2), maximum=(20, 10, 2)):
    return {
        "ok": True,
        "stdout": json.dumps({
            "tokens": [{
                "summary": {
                    "bounds": {"min": list(minimum), "max": list(maximum)},
                    "occurrenceCount": 7,
                    "shapeCount": 1,
                }
            }]
        }),
        "stderr": "",
    }


class JakeAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "model.py"
        self.step = self.root / "model.step"
        self.glb = self.root / "model.glb"
        self.source.write_text(SOURCE)
        self.step.write_bytes(b"STEP fixture " * 32)
        self.glb.write_bytes(b"GLB fixture " * 64)
        self.ai = Mock(model="gpt-6-astra", provider="openai")
        self.ai.generate_cad_brief.return_value = ("Build a 40 x 20 x 4 mm plate.", {})
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)

        replacements = {
            "backend.services.skill_runner.ensure_project_cad_scripts": None,
            "backend.services.skill_runner.cad_runtime_provenance": {
                "python_executable": "/cad/python",
                "python_version": "3.12.13",
                "build123d_version": "0.11.1",
                "ocp_version": "7.9.3.1.1",
                "occt_version": "7.9.3.1",
                "cadgen_version": "0.7.15",
            },
            "backend.services.cad_service.read_mcmaster_parts_list": "",
            "backend.services.cad_harness.project_parts_inventory": [],
            "backend.services.cad_harness.apply_mcmaster_from_brief": {},
            "backend.services.cad_host_runtime.jake_agent_flags": (True, False),
            "backend.services.design_service._convert_text_to_cad_glb_to_z_up": None,
            "backend.services.cad_service.polish_generated_cad_glb": True,
            "backend.services.cad_service.apply_prompt_appearance_to_file": None,
            "backend.services.cad_service._match_glb_scale_to_step": None,
            "backend.services.design_service._wire_jake_artifacts_to_product_shell": {},
            "backend.services.design_service._promote_disconnected_bodies": [],
            "backend.services.design_service._promote_build123d_children_from_source": [],
            "backend.services.design_service._collect_exploded_sidecar_files": {},
            "backend.services.project_store.apply_prompt_project_name": None,
            "backend.services.design_service.trace_add": None,
        }
        for target, result in replacements.items():
            self.stack.enter_context(patch(target, return_value=result))
        self.author = self.stack.enter_context(
            patch("backend.services.codex_agent.run_codex_agent", side_effect=self.write_exports)
        )
        self.inspect = self.stack.enter_context(
            patch("backend.services.skill_runner.run_skill_tool", return_value=inspect_result())
        )
        self.snapshot = self.stack.enter_context(
            patch("backend.services.design_service._run_v2_snapshot", side_effect=self.write_snapshot)
        )
        self.review = self.stack.enter_context(
            patch("backend.services.design_service._v2_snapshot_review_repair_note", return_value=(None, None))
        )

    def write_exports(self, **kwargs):
        self.step.write_bytes(b"current STEP fixture " * 32)
        trimesh.creation.box(extents=[40, 20, 4]).export(self.glb)
        return {"source": "model.py", "step": "model.step", "glb": "model.glb"}

    def write_snapshot(self, *args, **kwargs):
        (self.root / "model_snapshot.png").write_bytes(b"snapshot pixels")
        return {"file": "model_snapshot.png"}

    def generate(self):
        return _run_text_to_cad_v2_body(
            "Build a mounting plate",
            self.root,
            {"target_mode": "new", "base_filename": "model.glb"},
            self.ai,
            trace_id=None,
            max_repairs=0,
            images=None,
            previous_source_name="model.py",
        )

    def test_successful_agent_export_and_inspection_can_publish(self):
        result = self.generate()
        self.assertEqual(result["result"]["files"]["step"], "model.step")
        self.assertEqual(result["result"]["files"]["glb"], "model.glb")
        self.inspect.assert_called_once()
        self.snapshot.assert_called_once()
        self.review.assert_called_once()
        manifest = result["result"]["text_to_cad"]["artifact_manifest"]
        self.assertEqual(manifest["step"]["sha256"], hashlib.sha256(self.step.read_bytes()).hexdigest())
        self.assertEqual(manifest["glb"]["byte_length"], len(self.glb.read_bytes()))
        parity = result["result"]["text_to_cad"]["preview_parity"]
        self.assertTrue(parity["ok"])
        self.assertEqual(parity["expected"]["occurrence_count"], None)
        self.assertEqual(parity["occurrence_count"], 1)
        runtime = result["result"]["text_to_cad"]["runtime_provenance"]
        self.assertEqual(runtime["python_executable"], "/cad/python")
        self.assertEqual(runtime["cadgen_version"], "0.7.15")

    def test_stale_hidden_sidecar_cannot_replace_fresh_shell_preview(self):
        hidden = self.root / ".model.step.glb"
        self.glb.write_bytes(b"fresh shell preview")
        hidden.write_bytes(b"stale hidden preview")
        now = time.time()
        os.utime(hidden, (now - 60, now - 60))
        os.utime(self.glb, (now, now))

        with patch("backend.services.cad_service._match_glb_scale_to_step"):
            _wire_jake_artifacts_to_product_shell(
                self.root,
                base="model",
                source_name=self.source.name,
                step_name=self.step.name,
                glb_name=self.glb.name,
            )

        self.assertEqual(self.glb.read_bytes(), b"fresh shell preview")

    def test_newer_hidden_sidecar_replaces_stale_shell_preview(self):
        hidden = self.root / ".model.step.glb"
        self.glb.write_bytes(b"stale shell preview")
        hidden.write_bytes(b"fresh hidden preview")
        now = time.time()
        os.utime(self.glb, (now - 60, now - 60))
        os.utime(hidden, (now, now))

        with patch("backend.services.cad_service._match_glb_scale_to_step"):
            _wire_jake_artifacts_to_product_shell(
                self.root,
                base="model",
                source_name=self.source.name,
                step_name=self.step.name,
                glb_name=self.glb.name,
            )

        self.assertEqual(self.glb.read_bytes(), b"fresh hidden preview")

    def test_installed_inspect_shim_uses_current_cadgen_scene_api(self):
        valid_step = self.root / "valid.step"
        export_step(Box(40, 20, 4), valid_step)
        result = run_real_skill_tool(
            "cad",
            "inspect",
            ["refs", valid_step.name, "--facts", "--planes", "--positioning"],
            cwd=self.root,
            timeout_sec=30.0,
        )
        self.assertTrue(result["ok"], result.get("stderr") or result.get("stdout"))
        payload = json.loads(result["stdout"])
        summary = payload["tokens"][0]["summary"]
        self.assertEqual(summary["bounds"]["min"], [-20.0, -10.0, -2.0])
        self.assertEqual(summary["bounds"]["max"], [20.0, 10.0, 2.0])
        self.assertEqual(summary["solidCount"], 1)
        self.assertEqual(summary["topologyErrorCount"], 0)

    def test_codex_new_concept_does_not_block_on_tbd_purchased_interface(self):
        text = _build_prompt(
            prompt="Create a new rotating base. Motor is NEMA 34 plus encoder, exact model TBD.",
            cad_brief="Use an adjustable motor interface and label it provisional.",
            source_name="model.py", step_name="model.step", glb_name="model.glb",
            stl_name="model.stl", three_mf_name="model.3mf", is_edit=False,
            previous_source=None,
        )
        self.assertIn("Missing exact purchased-component geometry does not block a NEW concept export", text)
        self.assertIn("adjustable parametric interface", text)
        self.assertIn("must not claim fit verification", text)

    def test_tool_agent_uses_same_tbd_interface_policy(self):
        agent = JakeToolAgent(
            ai=self.ai, project_path=self.root,
            prompt="Create a new rotating base. Motor exact model TBD.",
            cad_brief="Use a provisional adjustable motor mount.",
            source_name="model.py", step_name="model.step", glb_name="model.glb",
            stl_name="model.stl", three_mf_name="model.3mf",
        )
        text = agent._system_prompt()
        self.assertIn("Missing exact purchased-component geometry does not block a NEW concept export", text)
        self.assertIn("adjustable parametric interface", text)

    def test_visual_review_receives_final_snapshot_bytes(self):
        pixels = b"final snapshot bytes"
        (self.root / "model_snapshot.png").write_bytes(pixels)
        reviewer = Mock()
        reviewer.chat_json.return_value = ({"pass": True, "repair_note": "", "issues": []}, {"ok": True})
        note, _ = _v2_snapshot_review_repair_note(
            reviewer,
            prompt="Build a mounting plate",
            cad_brief="A 40 x 20 x 4 mm plate.",
            source=SOURCE,
            inspect_out=inspect_result(),
            snapshot_info={"file": "model_snapshot.png", "files": ["model_snapshot.png"]},
            project_path=self.root,
            trace_id="review-bytes",
        )
        self.assertIsNone(note)
        images = reviewer.chat_json.call_args.kwargs["images"]
        self.assertEqual(
            images[0]["data_url"],
            "data:image/png;base64," + base64.b64encode(pixels).decode("ascii"),
        )

    def test_preview_bounds_mismatch_cannot_publish(self):
        self.inspect.return_value = inspect_result(minimum=(0, 0, 0), maximum=(1, 1, 1))
        with self.assertRaisesRegex(DesignBuildError, "STEP-to-GLB parity failed"):
            self.generate()
        self.snapshot.assert_not_called()
        self.review.assert_not_called()

    def test_failed_inspection_cannot_publish_agent_export(self):
        self.inspect.return_value = {
            "ok": False, "stdout": "", "stderr": "STEP could not be inspected",
        }
        with self.assertRaises(DesignBuildError):
            self.generate()
        self.inspect.assert_called_once()

    def test_agent_failure_cannot_recover_stale_same_stem_exports(self):
        previous_run = time.time() - 3600
        for artifact in (self.source, self.step, self.glb):
            os.utime(artifact, (previous_run, previous_run))
        before = {artifact.name: artifact.read_bytes() for artifact in (self.step, self.glb)}
        self.author.side_effect = RuntimeError("Agent stopped before writing this run's exports")
        with self.assertRaises(DesignBuildError):
            self.generate()
        self.author.assert_called_once()
        self.assertEqual({artifact.name: artifact.read_bytes() for artifact in (self.step, self.glb)}, before)

    def test_success_claim_without_fresh_exports_is_rejected(self):
        self.author.side_effect = None
        self.author.return_value = {"source": "model.py", "step": "model.step", "glb": "model.glb"}
        with self.assertRaisesRegex(DesignBuildError, "not produced in this run"):
            self.generate()

    def test_missing_snapshot_cannot_publish(self):
        self.snapshot.side_effect = None
        self.snapshot.return_value = None
        with self.assertRaisesRegex(DesignBuildError, "snapshot"):
            self.generate()

    def test_stale_snapshot_cannot_publish(self):
        stale = self.root / "model_snapshot.png"
        stale.write_bytes(b"previous rendering")
        previous_run = time.time() - 3600
        os.utime(stale, (previous_run, previous_run))
        self.snapshot.side_effect = None
        self.snapshot.return_value = {"file": stale.name}
        with self.assertRaisesRegex(DesignBuildError, "snapshot"):
            self.generate()

    def test_fresh_recovery_still_requires_inspection(self):
        def failed_author(**kwargs):
            self.write_exports()
            raise RuntimeError("Agent stopped after exporting")

        self.author.side_effect = failed_author
        self.inspect.return_value = {"ok": False, "stderr": "invalid STEP"}
        with self.assertRaisesRegex(DesignBuildError, "Inspect failed"):
            self.generate()

    def test_fresh_recovery_can_publish_after_all_gates_pass(self):
        def failed_author(**kwargs):
            self.write_exports()
            raise RuntimeError("Agent stopped after exporting")

        self.author.side_effect = failed_author
        result = self.generate()
        self.assertEqual(result["result"]["files"]["step"], "model.step")
        self.assertTrue(result["result"]["text_to_cad"]["provenance"]["recovered_export"])
        self.review.assert_called_once()

    def test_failed_recovery_visual_review_cannot_publish(self):
        def failed_author(**kwargs):
            self.write_exports()
            raise RuntimeError("Agent stopped after exporting")

        self.author.side_effect = failed_author
        self.review.return_value = ("Snapshot shows missing mounting holes", None)
        with self.assertRaisesRegex(DesignBuildError, "missing mounting holes"):
            self.generate()

    def test_same_size_same_timestamp_mutation_during_review_is_rejected(self):
        def mutated_snapshot(*args, **kwargs):
            old = self.step.stat()
            self.step.write_bytes(b"x" * old.st_size)
            os.utime(self.step, ns=(old.st_atime_ns, old.st_mtime_ns))
            return self.write_snapshot()

        self.snapshot.side_effect = mutated_snapshot
        with self.assertRaisesRegex(DesignBuildError, "changed during validation"):
            self.generate()

    def test_manifest_hashes_entire_export(self):
        started = time.time_ns()
        self.write_exports()
        self.step.write_bytes(b"a" * (3 * 1024 * 1024))
        manifest = CadRunManifest.capture(
            self.root, self.source.name, self.step.name, self.glb.name, run_started_ns=started,
        )
        old = self.step.stat()
        with self.step.open("r+b") as stream:
            stream.seek(2 * 1024 * 1024)
            stream.write(b"b")
        os.utime(self.step, ns=(old.st_atime_ns, old.st_mtime_ns))
        self.assertFalse(manifest.matches(self.root))

    def test_export_older_than_current_source_is_rejected(self):
        started = time.time_ns()
        self.write_exports()
        newer = max(self.step.stat().st_mtime_ns, self.glb.stat().st_mtime_ns) + 1_000_000
        os.utime(self.source, ns=(newer, newer))
        with self.assertRaisesRegex(ValueError, "predates its source"):
            CadRunManifest.capture(
                self.root, self.source.name, self.step.name, self.glb.name, run_started_ns=started,
            )

    def use_http_source_loop(self, *, inspection=None):
        self.stack.enter_context(patch("backend.services.cad_host_runtime.jake_agent_flags", return_value=(False, False)))
        self.stack.enter_context(patch("backend.services.cad_harness.finalize_harness_run", return_value={}))
        self.stack.enter_context(patch("backend.services.design_service._v2_quality_repair_note", return_value=None))
        self.stack.enter_context(patch("backend.services.design_service._run_v2_spec_dimension_hints", return_value=None))
        self.stack.enter_context(patch("backend.services.design_service._maybe_author_step_module", return_value=None))
        self.ai.generate_cad_python_source.return_value = (SOURCE, {})

        def skill_tool(skill, tool, args, **kwargs):
            if tool == "step":
                self.write_exports()
            return inspection or inspect_result()

        self.inspect.side_effect = skill_tool

    def test_http_loop_success_records_validated_artifact_identity(self):
        self.use_http_source_loop()
        result = self.generate()
        self.assertEqual(result["result"]["files"]["step"], "model.step")
        self.assertEqual(result["result"]["text_to_cad"]["provenance"]["host"], "http_source_loop")
        self.assertTrue(result["result"]["text_to_cad"]["preview_parity"]["ok"])
        self.assertEqual(
            result["result"]["text_to_cad"]["runtime_provenance"]["build123d_version"],
            "0.11.1",
        )
        self.assertEqual(
            result["result"]["text_to_cad"]["artifact_manifest"]["step"]["sha256"],
            hashlib.sha256(self.step.read_bytes()).hexdigest(),
        )

    def test_http_loop_preview_bounds_mismatch_cannot_publish(self):
        self.use_http_source_loop(inspection=inspect_result(
            minimum=(0, 0, 0), maximum=(1, 1, 1),
        ))
        with self.assertRaisesRegex(DesignBuildError, "STEP-to-GLB parity failed"):
            self.generate()
        self.snapshot.assert_not_called()
        self.review.assert_not_called()

    def test_http_loop_failed_snapshot_cannot_be_last_good(self):
        self.use_http_source_loop()
        self.snapshot.side_effect = None
        self.snapshot.return_value = None
        with self.assertRaisesRegex(DesignBuildError, "snapshot"):
            self.generate()

    def test_http_loop_failed_visual_review_cannot_be_last_good(self):
        self.use_http_source_loop()
        self.review.return_value = ("Snapshot shows missing mounting holes", None)
        with self.assertRaisesRegex(DesignBuildError, "missing mounting holes"):
            self.generate()


def test_step_preview_is_rebuilt_when_exported_glb_uses_another_frame(tmp_path):
    step = tmp_path / "model.step"
    glb = tmp_path / "model.glb"
    export_step(Box(40, 20, 4), step)
    shifted = trimesh.creation.box(extents=[40, 20, 4])
    shifted.apply_translation([100, 0, 0])
    shifted.export(glb)

    report = _measure_or_rebuild_step_preview(
        step,
        glb,
        json.loads(inspect_result()["stdout"])["tokens"][0]["summary"],
    )

    assert report["ok"], report
    assert report["rebuilt_from_step"] is True
    assert max(abs(value) for value in report["bounds_delta"]) < 1e-5


if __name__ == "__main__":
    unittest.main()
