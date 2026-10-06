"""VibeCAD oneshot authoring: Astra tool-call unwrap, wrap-only reject, @prompt refs."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.services.prompt_history_service import parse_copied_prompt_ref
from backend.services.skills_service import _VIBECAD_ADAPTER
from backend.services.vibecad_service import (
    _auto_input_objects,
    _coerce_authoring_program,
    _is_passthrough_hardware_source,
    _normalize_input_objects,
    _resolve_worker_inputs,
    _source_assigns_result,
)


CHASSIS_SRC = """from build123d import *
deck = Box(300, 360, 8)
result = {"deck": deck}
"""

WRAP_SRC = """# Preserve the selected 94180A361 insert; inputs already contain Shapes.
threaded_insert = inputs['selected_object']
threaded_insert.label = 'threaded_insert'
threaded_insert.color = fill_color(0)
result = {'threaded_insert': threaded_insert}
"""


class PromptRefParseTests(unittest.TestCase):
    def test_wrapped_astra_model_label(self):
        raw = (
            "@prompt:de510d9964c1 · project:e6e9dfd3 · mode:VibeCAD · model:GPT-6\n"
            " Astra · trace:5e15151e"
        )
        parsed = parse_copied_prompt_ref(raw)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["prompt_id"], "de510d9964c1")
        self.assertEqual(parsed["project_id"], "e6e9dfd3")
        self.assertEqual(parsed["mode"], "VibeCAD")
        self.assertEqual(parsed["model"], "GPT-6 Astra")
        self.assertEqual(parsed["trace"], "5e15151e")

    def test_real_prompt_is_not_a_ref(self):
        self.assertIsNone(
            parse_copied_prompt_ref("OpenArm mobile base: build a chassis @prompt:nope")
        )


class CoerceAuthoringTests(unittest.TestCase):
    def test_unwraps_create_model_tool_call(self):
        payload = {
            "tool": "build123d.create_model",
            "args": {
                "model_name": "OpenArmChassis",
                "source": CHASSIS_SRC,
                "parameters": {},
                "expected_outputs": ["deck"],
            },
        }
        program = _coerce_authoring_program(json.dumps(payload))
        self.assertEqual(program["model_name"], "OpenArmChassis")
        self.assertTrue(_source_assigns_result(program["source"]))
        self.assertIn("Box", program["source"])
        self.assertEqual(program["expected_outputs"], ["deck"])

    def test_python_fence_when_json_missing(self):
        text = "Here is the program:\n```python\n" + CHASSIS_SRC + "\n```\n"
        program = _coerce_authoring_program(text)
        self.assertIn("Box", program["source"])

    def test_review_only_tool_call_still_fails(self):
        payload = {
            "tool": "conversation.review_design",
            "args": {"customer_intent": "chassis", "design_draft": "a cart"},
        }
        with self.assertRaises(ValueError) as ctx:
            _coerce_authoring_program(json.dumps(payload))
        self.assertIn("missing build123d source", str(ctx.exception))


class WrapOnlyTests(unittest.TestCase):
    def test_insert_stub_is_passthrough(self):
        self.assertTrue(_is_passthrough_hardware_source(WRAP_SRC))

    def test_real_box_is_not_passthrough(self):
        self.assertFalse(_is_passthrough_hardware_source(CHASSIS_SRC))


class AutoInputTests(unittest.TestCase):
    def test_new_job_does_not_promote_selection_to_selected_object(self):
        tmp = Path("/tmp/r3d-vibecad-auto-inputs")
        tmp.mkdir(exist_ok=True)
        step = tmp / "94180A361.step"
        step.write_text("ISO-10303-21;", encoding="utf-8")
        mapping = _auto_input_objects(
            tmp,
            {
                "target_mode": "new",
                "referenced_components": [{"filename": "94180A361.step"}],
            },
            {},
        )
        self.assertNotIn("selected_object", mapping)
        self.assertIn("94180A361", mapping)

    def test_edit_job_keeps_selected_object(self):
        tmp = Path("/tmp/r3d-vibecad-auto-inputs")
        tmp.mkdir(exist_ok=True)
        step = tmp / "94180A361.step"
        if not step.is_file():
            step.write_text("ISO-10303-21;", encoding="utf-8")
        mapping = _auto_input_objects(
            tmp,
            {
                "target_mode": "edit",
                "base_filename": "94180A361.step",
                "referenced_components": [{"filename": "94180A361.step"}],
            },
            {},
        )
        self.assertEqual(mapping.get("selected_object"), "94180A361.step")


class HardwareCatalogInputTests(unittest.TestCase):
    """Worker inputs must expose every McMaster STEP as both {pn} and hw_{pn}."""

    PNS = [
        "92949A535",
        "91290A320",
        "97763A813",
        "90592A085",
        "97763A456",
        "90592A080",
        "90592A016",
        "97763A419",
        "90138A216",
        "94180A331",
        "7381K31",
        "93475A250",
        "7381K29",
        "1013N12",
        "1013N11",
    ]

    def _project_with_library(self) -> Path:
        tmp = Path(tempfile.mkdtemp())
        lib = tmp / "mcmaster_library"
        lib.mkdir()
        entries = []
        for pn in self.PNS:
            (lib / f"{pn}.step").write_text("ISO-10303-21;HEADER;", encoding="utf-8")
            entries.append(
                {
                    "name": f"{pn}.step",
                    "filename": f"{pn}.step",
                    "project_filename": f"{pn}.step",
                    "part_number": pn,
                }
            )
        (lib / "index.json").write_text(json.dumps({"entries": entries}), encoding="utf-8")
        return tmp

    def test_normalize_codex_list_form(self):
        raw = [
            {"name": "hw_1013N11", "alias": "hw_1013N11", "filename": "1013N11.step"},
            {"alias": "hw_1013N12", "filename": "1013N12.step"},
        ]
        out = _normalize_input_objects(raw)
        self.assertEqual(out["hw_1013N11"], "1013N11.step")
        self.assertEqual(out["hw_1013N12"], "1013N12.step")

    def test_auto_input_maps_all_library_parts_pn_and_hw(self):
        tmp = self._project_with_library()
        mapping = _auto_input_objects(tmp, {"target_mode": "new"}, {})
        self.assertGreater(len(self.PNS), 12)
        self.assertEqual(mapping["hw_1013N11"], "1013N11.step")
        self.assertEqual(mapping["1013N11"], "1013N11.step")
        for pn in self.PNS:
            self.assertEqual(mapping[pn], f"{pn}.step", pn)
            self.assertEqual(mapping[f"hw_{pn}"], f"{pn}.step", pn)

    def test_list_form_survives_auto_input(self):
        tmp = self._project_with_library()
        mapping = _auto_input_objects(
            tmp,
            {"target_mode": "new"},
            [{"alias": "hw_1013N11", "filename": "1013N11.step"}],
        )
        self.assertEqual(mapping["hw_1013N11"], "1013N11.step")
        self.assertEqual(mapping["1013N11"], "1013N11.step")

    def test_resolve_dual_maps_and_fills_beyond_first_twelve(self):
        tmp = self._project_with_library()
        resolved = _resolve_worker_inputs(tmp, {"1013N11": "1013N11.step"})
        self.assertEqual(Path(resolved["hw_1013N11"]).name, "1013N11.step")
        self.assertEqual(Path(resolved["1013N11"]).name, "1013N11.step")
        all_resolved = _resolve_worker_inputs(tmp, {})
        self.assertIn("hw_1013N11", all_resolved)
        self.assertIn("hw_7381K29", all_resolved)
        self.assertEqual(Path(all_resolved["hw_1013N11"]).resolve(), (tmp / "mcmaster_library" / "1013N11.step").resolve())


class AdapterFormatTests(unittest.TestCase):
    def test_adapter_format_survives_braces(self):
        text = _VIBECAD_ADAPTER.format(skill_id="vibecad")
        self.assertIn("vibecad", text)
        self.assertIn("result = {...}", text)
        self.assertNotIn("{skill_id}", text)


if __name__ == "__main__":
    unittest.main()
