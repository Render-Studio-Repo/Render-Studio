"""VibeCAD: Codex for ChatGPT/OpenAI, Anthropic HTTP for Claude keys."""

from __future__ import annotations

import tempfile
import time
import unittest
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.services.vibecad_codex import (
    choose_vibecad_runtime,
    _expected_from_source,
    _program_from_workspace,
    _worker_error_needs_reauthor,
    _annotate_worker_failure,
    workspace_source_ready,
    write_compile_handoff,
    run_vibecad_codex_host,
)
from backend.services.vibecad_service import (
    _publish_individual_part_meshes,
    _source_assigns_result,
    _source_has_helical_thread_sweep,
    _worker_timeout_sec,
)


class ChooseRuntimeTests(unittest.TestCase):
    def test_chatgpt_subscription_defaults_to_codex_host(self) -> None:
        ai = SimpleNamespace(billing_source="chatgpt_subscription", model="gpt-5.6-sol")
        self.assertEqual(choose_vibecad_runtime({}, ai), "codex_host")

    def test_astra_is_codex_host(self) -> None:
        ai = SimpleNamespace(billing_source="chatgpt_subscription", model="gpt-6-astra")
        self.assertEqual(choose_vibecad_runtime(None, ai), "codex_host")

    def test_openai_http_byok_is_codex_host(self) -> None:
        ai = SimpleNamespace(billing_source="byok", model="gpt-5.6-sol", provider="openai")
        self.assertEqual(choose_vibecad_runtime({}, ai), "codex_host")

    def test_claude_uses_anthropic_http(self) -> None:
        ai = SimpleNamespace(billing_source="byok", model="claude-sonnet-4-5", provider="anthropic", api_key="sk-ant")
        self.assertEqual(choose_vibecad_runtime({}, ai), "oneshot")

    def test_oneshot_flag_wins(self) -> None:
        ai = SimpleNamespace(billing_source="chatgpt_subscription", model="gpt-5.6-sol")
        self.assertEqual(choose_vibecad_runtime({"vibecad_oneshot": True}, ai), "oneshot")

    def test_explicit_agent_still_allowed(self) -> None:
        ai = SimpleNamespace(billing_source="chatgpt_subscription", model="gpt-5.6-sol")
        self.assertEqual(choose_vibecad_runtime({"vibecad_agent": True}, ai), "agent")


class WorkspaceProgramTests(unittest.TestCase):
    def test_expected_keys_from_result_dict(self) -> None:
        src = "deck = Box(1, 2, 3)\nresult = {\n    'deck': deck,\n    'rail': rail,\n}\n"
        self.assertEqual(_expected_from_source(src), ["deck", "rail"])
        self.assertTrue(_source_assigns_result(src))

    def test_program_prefers_written_source_over_last_message(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "cart.vibecad.py").write_text(
                "from build123d import *\ndeck = Box(300, 360, 8)\nresult = {'deck': deck}\n",
                encoding="utf-8",
            )
            (root / "cart.vibecad.json").write_text(
                '{"model_name": "Cart", "expected_outputs": ["deck"], "parameters": {}, "input_objects": {}}',
                encoding="utf-8",
            )
            program = _program_from_workspace(
                root,
                stem="cart",
                source_name="cart.vibecad.py",
                last_message='{"tool":"conversation.review_design"}',
            )
            self.assertIn("Box", program["source"])
            self.assertEqual(program["expected_outputs"], ["deck"])
            self.assertEqual(program["model_name"], "Cart")

    def test_program_reads_nested_vibecad_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "vibecad"
            folder.mkdir()
            (folder / "cart.vibecad.py").write_text(
                "from build123d import *\ndeck = Box(300, 360, 8)\nresult = {'deck': deck}\n",
                encoding="utf-8",
            )
            (folder / "cart.vibecad.json").write_text(
                '{"model_name": "Cart", "expected_outputs": ["deck"], "parameters": {}, "input_objects": {}}',
                encoding="utf-8",
            )
            program = _program_from_workspace(
                root,
                stem="cart",
                source_name="vibecad/cart.vibecad.py",
                last_message='{"tool":"conversation.review_design"}',
            )
            self.assertIn("Box", program["source"])
            self.assertEqual(program["expected_outputs"], ["deck"])


class WorkspaceReadyTests(unittest.TestCase):
    def setUp(self) -> None:
        gate = patch("backend.services.vibecad_codex.run_post_publish_visual_gate", return_value={"ok": True})
        self.visual_gate = gate.start()
        self.addCleanup(gate.stop)

    def test_ready_after_stable_result_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "rack.vibecad.py").write_text(
                "from build123d import *\ndeck = Box(300, 360, 8)\nresult = {'deck': deck}\n",
                encoding="utf-8",
            )
            (root / "rack.vibecad.json").write_text(
                '{"model_name": "Rack", "expected_outputs": ["deck"]}',
                encoding="utf-8",
            )
            self.assertFalse(
                workspace_source_ready(
                    root, source_name="rack.vibecad.py", stem="rack", min_stable_sec=30.0
                )
            )
            self.assertTrue(
                workspace_source_ready(
                    root, source_name="rack.vibecad.py", stem="rack", min_stable_sec=0.0
                )
            )

    def test_not_ready_for_stale_files_from_before_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "rack.vibecad.py").write_text(
                "result = {'deck': deck}\n",
                encoding="utf-8",
            )
            future = time.time() + 60
            self.assertFalse(
                workspace_source_ready(
                    root,
                    source_name="rack.vibecad.py",
                    stem="rack",
                    min_stable_sec=0.0,
                    not_before=future,
                )
            )

    def test_timeout_does_not_reauthor(self) -> None:
        self.assertFalse(_worker_error_needs_reauthor("VibeCAD build123d worker timed out"))
        self.assertTrue(_worker_error_needs_reauthor("SyntaxError: invalid syntax"))

    def test_helix_timeout_and_segfault_reauthor(self) -> None:
        helix = (
            "ridge = sweep(section, path=Helix(4, 84, 10), is_frenet=True)\n"
            "result = {'screw': screw}\n"
        )
        self.assertTrue(
            _worker_error_needs_reauthor("VibeCAD build123d worker timed out", helix)
        )
        self.assertTrue(_worker_error_needs_reauthor("worker exited -11"))

    def test_source_errors_request_repair_instead_of_identical_worker_retry(self) -> None:
        for error in (
            "Import is not allowed in build123d source: cadgen",
            "ImportError: cannot import name 'Unknown' from 'build123d'",
            "NameError: name 'globals' is not defined",
            "AttributeError: 'Part' object has no attribute 'unknown'",
            "TypeError: Box() got an unexpected keyword argument 'size'",
            "ValueError: invalid geometry",
            "BRep_API: command not done",
            "result[base] is not a valid shape",
            "STEP round-trip validation failed for 000.step",
            "OCP.Standard.Standard_ConstructionError: invalid surface",
            "AssertionError: Not one nonempty solid: bracket",
        ):
            with self.subTest(error=error):
                self.assertTrue(_worker_error_needs_reauthor(error))
        self.assertFalse(_worker_error_needs_reauthor("Generation canceled: ImportError"))
        self.assertFalse(_worker_error_needs_reauthor("build123d worker exited 1"))

    def test_kernel_failure_advice_preserves_components_and_clearances(self) -> None:
        hint = _annotate_worker_failure("BRep_API: command not done")
        self.assertIn("separate valid smooth inner profile", hint)
        self.assertIn("mating clearances", hint)
        self.assertIn("every required output body", hint)
        hint = _annotate_worker_failure("STEP round-trip validation failed for base")
        self.assertIn("face.to_splines(tolerance=0.001)", hint)
        self.assertIn("Do not skip validation", hint)

    def test_wrong_engine_and_namespace_failures_explain_supported_api(self) -> None:
        error = _annotate_worker_failure("Import is not allowed in build123d source: cadgen")
        self.assertIn("Remove the cadgen import", error)
        self.assertIn("use srgb(hex)", error)
        error = _annotate_worker_failure("NameError: name 'globals' is not defined")
        self.assertIn("Use params instead", error)

    def test_failed_import_repairs_saved_source_before_next_worker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "vibecad"
            folder.mkdir()
            source_name = "vibecad/cart.vibecad.py"
            source_path = root / source_name
            broken = "import cadgen\nresult = {'deck': Box(10, 20, 3)}\n"
            repaired = "from build123d import *\nresult = {'deck': Box(10, 20, 3)}\n"
            source_path.write_text(broken)
            (folder / "cart.vibecad.json").write_text(json.dumps({
                "model_name": "Cart", "expected_outputs": ["deck"],
                "parameters": {}, "input_objects": {},
                "joints": [{"id": "deck_mount", "type": "fixed", "parent": "world", "child": "deck"}],
                "parts_list": {"parts": [], "questions": ["Confirm deck size"]},
            }))
            write_compile_handoff(root, source_name=source_name, stem="cart")
            (folder / "cart.glb").write_bytes(b"test-published-model")

            def repair(**kwargs):
                source_path.write_text(repaired)
                return "Repaired source", {}

            with (
                patch("backend.services.chatgpt_codex_llm.exec_in_workspace", side_effect=repair) as author,
                patch("backend.services.vibecad_codex._write_workspace_docs"),
                patch("backend.services.vibecad_codex._host_prompt", return_value="repair") as host_prompt,
                patch("backend.services.vibecad_codex._run_worker", side_effect=[
                    {"ok": False, "error": "Import is not allowed in build123d source: cadgen"},
                    {"ok": True},
                ]) as worker,
                patch("backend.services.vibecad_codex._publish_outputs", return_value={
                    "source": source_name, "step": "vibecad/cart.step", "glb": "vibecad/cart.glb",
                }),
                patch("backend.services.project_store.apply_prompt_project_name"),
                patch("backend.services.cad_harness.finalize_harness_run") as finalize,
            ):
                result = run_vibecad_codex_host(
                    "Cart", root, {"base_filename": source_name},
                    SimpleNamespace(model="gpt-6-astra"), max_repairs=2,
                )
            self.assertEqual(author.call_count, 1)
            self.assertEqual(worker.call_count, 2)
            self.assertIn("import cadgen", worker.call_args_list[0].kwargs["source"])
            self.assertNotIn("import cadgen", worker.call_args_list[1].kwargs["source"])
            self.assertIn("use srgb(hex)", host_prompt.call_args.kwargs["last_error"])
            self.assertEqual(result["filename"], "vibecad/cart.glb")
            self.assertFalse((root / ".vibecad_handoff.json").exists())
            self.assertEqual(finalize.call_args.kwargs["published_step"], "vibecad/cart.step")
            self.assertEqual(finalize.call_args.kwargs["joints"][0]["id"], "deck_mount")
            self.assertEqual(finalize.call_args.kwargs["parts_list"]["questions"], ["Confirm deck size"])

    def test_failed_publication_restores_canonical_source_and_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "vibecad"
            folder.mkdir()
            source_name = "vibecad/cart.vibecad.py"
            source_path = root / source_name
            meta_path = folder / "cart.vibecad.json"
            original_source = b"original = True\nresult = {'deck': deck}\n"
            original_meta = b'{"model_name":"Original Cart"}\n'
            candidate_source = "from build123d import *\nresult = {'deck': Box(10, 20, 3)}\n"
            source_path.write_bytes(original_source)
            meta_path.write_bytes(original_meta)
            (folder / "cart.glb").write_bytes(b"published-model")

            def author_candidate(**kwargs):
                source_path.write_text(candidate_source, encoding="utf-8")
                meta_path.write_text(json.dumps({
                    "model_name": "Candidate Cart",
                    "expected_outputs": ["deck"],
                    "parameters": {},
                    "input_objects": {},
                }), encoding="utf-8")
                return "Candidate source", {}

            with (
                patch("backend.services.chatgpt_codex_llm.exec_in_workspace", side_effect=author_candidate),
                patch("backend.services.vibecad_codex._write_workspace_docs"),
                patch("backend.services.vibecad_codex._run_worker", return_value={
                    "ok": False,
                    "error": "BATTERY_SLIDE_UNVERIFIED",
                }),
            ):
                with self.assertRaisesRegex(RuntimeError, "BATTERY_SLIDE_UNVERIFIED"):
                    run_vibecad_codex_host(
                        "Revise selected cart",
                        root,
                        {"base_filename": "vibecad/cart.glb", "target_mode": "edit"},
                        SimpleNamespace(model="gpt-6-astra"),
                        max_repairs=1,
                    )

            self.assertEqual(source_path.read_bytes(), original_source)
            self.assertEqual(meta_path.read_bytes(), original_meta)
            self.assertEqual((folder / "cart.glb").read_bytes(), b"published-model")

    def test_blocked_authoring_manifest_stops_before_worker_or_repair(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "vibecad"
            folder.mkdir()
            source_name = "vibecad/cart.vibecad.py"
            source_path = root / source_name
            meta_path = folder / "cart.vibecad.json"

            def author_blocked(**kwargs):
                source_path.write_text(
                    "from build123d import *\nresult = {'deck': Box(10, 20, 3)}\n",
                    encoding="utf-8",
                )
                meta_path.write_text(json.dumps({
                    "model_name": "Cart",
                    "expected_outputs": ["deck"],
                    "parameters": {},
                    "input_objects": {},
                    "status": "blocked_source_validation_failed",
                    "publication": {
                        "allowed": False,
                        "reason": "Selected STEP contains nine solids instead of three",
                    },
                }), encoding="utf-8")
                return "Source validation blocked publication", {}

            with (
                patch("backend.services.chatgpt_codex_llm.exec_in_workspace", side_effect=author_blocked) as author,
                patch("backend.services.vibecad_codex._write_workspace_docs"),
                patch("backend.services.vibecad_codex._run_worker") as worker,
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "Selected STEP contains nine solids instead of three",
                ):
                    run_vibecad_codex_host(
                        "Revise selected cart",
                        root,
                        {"base_filename": "vibecad/cart.glb", "target_mode": "edit"},
                        SimpleNamespace(model="gpt-6-astra"),
                        max_repairs=8,
                    )

            self.assertEqual(author.call_count, 1)
            self.assertEqual(worker.call_count, 0)

    def test_kernel_offset_failure_repairs_source_before_next_worker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "vibecad"
            folder.mkdir()
            source_name = "vibecad/cart.vibecad.py"
            source_path = root / source_name
            broken = "import cadgen\nresult = {'deck': Box(10, 20, 3)}\n"
            repaired = "from build123d import *\nresult = {'deck': Box(10, 20, 3)}\n"
            source_path.write_text(broken)
            (folder / "cart.vibecad.json").write_text(json.dumps({
                "model_name": "Cart", "expected_outputs": ["deck"],
                "parameters": {}, "input_objects": {},
                "joints": [{"id": "deck_mount", "type": "fixed", "parent": "world", "child": "deck"}],
                "parts_list": {"parts": [], "questions": ["Confirm deck size"]},
            }))
            write_compile_handoff(root, source_name=source_name, stem="cart")
            (folder / "cart.glb").write_bytes(b"test-published-model")

            def repair(**kwargs):
                self.assertFalse((root / ".vibecad_handoff.json").exists())
                source_path.write_text(repaired)
                return "Repaired source", {}

            with (
                patch("backend.services.chatgpt_codex_llm.exec_in_workspace", side_effect=repair) as author,
                patch("backend.services.vibecad_codex._write_workspace_docs"),
                patch("backend.services.vibecad_codex._host_prompt", return_value="repair") as host_prompt,
                patch("backend.services.vibecad_codex._run_worker", side_effect=[
                    {"ok": False, "error": "OCP.Standard.Standard_Failure: BRep_API: command not done\nline 57, in inset"},
                    {"ok": True},
                ]) as worker,
                patch("backend.services.vibecad_codex._publish_outputs", return_value={
                    "source": source_name, "step": "vibecad/cart.step", "glb": "vibecad/cart.glb",
                }),
                patch("backend.services.project_store.apply_prompt_project_name"),
                patch("backend.services.cad_harness.finalize_harness_run") as finalize,
            ):
                result = run_vibecad_codex_host(
                    "Cart", root, {"base_filename": source_name},
                    SimpleNamespace(model="gpt-6-astra"), max_repairs=2,
                )
            self.assertEqual(author.call_count, 1)
            self.assertEqual(worker.call_count, 2)
            self.assertIn("import cadgen", worker.call_args_list[0].kwargs["source"])
            self.assertNotIn("import cadgen", worker.call_args_list[1].kwargs["source"])
            self.assertIn("separate valid smooth inner profile", host_prompt.call_args.kwargs["last_error"])
            self.assertEqual(result["filename"], "vibecad/cart.glb")
            self.assertFalse((root / ".vibecad_handoff.json").exists())
            self.assertEqual(finalize.call_args.kwargs["published_step"], "vibecad/cart.step")
            self.assertEqual(finalize.call_args.kwargs["joints"][0]["id"], "deck_mount")
            self.assertEqual(finalize.call_args.kwargs["parts_list"]["questions"], ["Confirm deck size"])

    def test_configured_budget_repairs_sequential_worker_failures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "vibecad"
            folder.mkdir()
            source_name = "vibecad/cart.vibecad.py"
            source_path = root / source_name
            source_path.write_text("from build123d import *\nresult = {'deck': Box(10, 20, 3)}\n")
            (folder / "cart.vibecad.json").write_text(json.dumps({
                "model_name": "Cart", "expected_outputs": ["deck"],
                "parameters": {}, "input_objects": {},
            }))
            write_compile_handoff(root, source_name=source_name, stem="cart")
            (folder / "cart.glb").write_bytes(b"published-model")

            def repair(**kwargs):
                source_path.write_text(
                    "from build123d import *\nresult = {'deck': Box(10, 20, 3)}\n"
                )
                return "Repaired source", {}

            with (
                patch("backend.services.chatgpt_codex_llm.exec_in_workspace", side_effect=repair) as author,
                patch("backend.services.vibecad_codex._write_workspace_docs"),
                patch("backend.services.vibecad_codex._run_worker", side_effect=[
                    {"ok": False, "error": "Import is not allowed in build123d source: cadgen"},
                    {"ok": False, "error": "result['wire_home_sensor'] must contain exactly one solid; received 2"},
                    {"ok": True},
                ]) as worker,
                patch("backend.services.vibecad_codex._publish_outputs", return_value={
                    "source": source_name, "step": "vibecad/cart.step", "glb": "vibecad/cart.glb",
                }),
                patch("backend.services.project_store.apply_prompt_project_name"),
                patch("backend.services.cad_harness.finalize_harness_run"),
            ):
                result = run_vibecad_codex_host(
                    "Cart", root, {"base_filename": source_name},
                    SimpleNamespace(model="gpt-6-astra"), max_repairs=3,
                )

            self.assertEqual(author.call_count, 2)
            self.assertEqual(worker.call_count, 3)
            self.assertEqual(result["attempts"], 3)
            self.assertEqual(result["filename"], "vibecad/cart.glb")

    def test_worker_timeout_scales_with_outputs(self) -> None:
        self.assertEqual(_worker_timeout_sec(["a"]), 360.0)
        self.assertEqual(_worker_timeout_sec(["p"] * 365), 1200.0)
        self.assertEqual(_worker_timeout_sec(["p"] * 365, timeout_sec=30), 30.0)
        helix = "ridge = sweep(p, path=Helix(4, 84, 8))\nresult = {'a': a}\n"
        self.assertEqual(_worker_timeout_sec(["a"], source=helix), 360.0)

    def test_helical_thread_sweep_is_compile_lint(self) -> None:
        from backend.services.vibecad_service import _lint_vibecad_source

        helix = (
            "def helix_ridge(rmin, rmax, lead, length):\n"
            "    return sweep(section, path=Helix(lead, length, rmin), is_frenet=True)\n"
            "result = {'clamp_screw': screw}\n"
        )
        self.assertIsNone(_lint_vibecad_source(helix, compile_gate=False))
        # Sidecar substitutes Helix+sweep — do not fail-and-reauthor.
        self.assertIsNone(_lint_vibecad_source(helix))
        self.assertTrue(_source_has_helical_thread_sweep(helix))
        plain = "box = Box(10, 10, 10)\nresult = {'box': box}\n"
        self.assertIsNone(_lint_vibecad_source(plain))

    def test_skip_per_part_glbs_on_huge_assemblies(self) -> None:
        self.assertTrue(_publish_individual_part_meshes(8))
        self.assertFalse(_publish_individual_part_meshes(365))
        self.assertFalse(_publish_individual_part_meshes(1))
        self.assertFalse(
            _publish_individual_part_meshes(8, keys=[f"Part_{i}" for i in range(1, 9)])
        )
        self.assertTrue(_publish_individual_part_meshes(2, keys=["hopper", "auger"]))

    def test_handoff_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_compile_handoff(root, source_name="rack.vibecad.py", stem="rack")
            self.assertTrue((root / ".vibecad_handoff.json").is_file())


if __name__ == "__main__":
    unittest.main()
