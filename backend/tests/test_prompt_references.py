"""Canvas sketches explain layout; extrusion photos are mate targets."""

from __future__ import annotations

import unittest

from backend.main import IMPROVE_CAD_PROMPT_SYSTEM, _append_intent_clarification
from backend.services.ai_service import AIService, DESIGN_SYSTEM_PROMPT
from backend.services.prompt_references import (
    DRAWING_PACKAGE_MIXED_REF_RULE,
    PHOTO_AND_DXF_INSTRUCTIONS,
    cad_reference_improve_hint,
    classify_prompt_images,
    has_layout_sketch,
    image_caption,
    image_role,
)
from backend.services.vibecad_service import VIBECAD_SYSTEM


class PromptReferenceRoleTests(unittest.TestCase):
    def test_canvas_filename_is_layout_sketch(self) -> None:
        self.assertEqual(image_role("canvas-sketch.png"), "layout_sketch")
        self.assertEqual(image_role("layout-sketch.jpg"), "layout_sketch")
        self.assertEqual(image_role("whiteboard.png"), "layout_sketch")
        self.assertEqual(image_role("2060-extrusion.jpg"), "photo")
        self.assertEqual(image_role("viewport-capture.png"), "viewport")

    def test_classify_mixed_canvas_and_extrusion(self) -> None:
        roles = classify_prompt_images(
            [
                {"name": "canvas-sketch.png"},
                {"name": "2060_extrusion.jpg"},
            ]
        )
        self.assertEqual(roles["layout_sketch"], ["canvas-sketch.png"])
        self.assertEqual(roles["photo"], ["2060_extrusion.jpg"])
        self.assertTrue(has_layout_sketch([{"name": "canvas-sketch.png"}]))
        self.assertFalse(has_layout_sketch([{"name": "extrusion.jpg"}]))

    def test_image_caption_explains_canvas_vs_mate_photo(self) -> None:
        sketch = image_caption("canvas-sketch.png").lower()
        photo = image_caption("2060.jpg").lower()
        self.assertIn("explains the prompt", sketch)
        self.assertIn("not a photo of the finished part", sketch)
        self.assertIn("target to connect", photo)
        self.assertIn("not the new part", photo)

    def test_improve_hint_keeps_hanging_off_vs_on_top(self) -> None:
        prompt = (
            "Make a nema 34 bracket mount that can mount to the top of this 2060 aluminum "
            "extrusion so the motor shaft can face horizontal, while hanging off the extrusion"
        )
        hint = cad_reference_improve_hint(
            [{"name": "canvas-sketch.png"}, {"name": "2060.jpg"}],
            prompt,
        ).lower()
        self.assertIn("layout sketch", hint)
        self.assertIn("canvas-sketch.png", hint)
        self.assertIn("2060.jpg", hint)
        self.assertIn("hanging off", hint)
        self.assertIn("sitting on top of the extrusion", hint)
        self.assertNotIn("matches that photo's silhouette", hint)

    def test_photo_and_dxf_instructions_are_not_copy_every_photo(self) -> None:
        text = PHOTO_AND_DXF_INSTRUCTIONS.lower()
        self.assertIn("layout explanation", text)
        self.assertIn("mate/mount targets", text)
        self.assertIn("hanging off", text)
        self.assertNotIn("when photos are attached, match silhouette", text)

    def test_drawing_package_mixed_ref_rule(self) -> None:
        text = DRAWING_PACKAGE_MIXED_REF_RULE.lower()
        self.assertIn("layout explanation", text)
        self.assertIn("mate/mount targets", text)
        self.assertIn("new motor on top", text)


class PromptReferenceSystemTests(unittest.TestCase):
    def test_intent_clarification_preserves_original_prompt_verbatim(self) -> None:
        original = "Make a 40 mm clamp that hangs off @image1"
        result = _append_intent_clarification(
            original,
            "Clarification: The clamp should mount beside the rail, with its opening facing outward.",
        )
        self.assertEqual(
            result,
            original
            + "\n\nClarification: The clamp should mount beside the rail, with its opening facing outward.",
        )

    def test_intent_clarification_caps_an_accidental_rewrite(self) -> None:
        original = "Make the wheel thicker"
        result = _append_intent_clarification(original, "detail " * 100)
        self.assertTrue(result.startswith(original + "\n\nClarification: "))
        self.assertLessEqual(len(result.split("Clarification: ", 1)[1]), 321)

    def test_empty_clarification_keeps_original(self) -> None:
        self.assertEqual(_append_intent_clarification("Make a bracket", ""), "Make a bracket")

    def test_improve_cad_system_treats_canvas_as_layout(self) -> None:
        text = IMPROVE_CAD_PROMPT_SYSTEM.lower()
        self.assertIn("layout explanation", text)
        self.assertIn("hanging off", text)
        self.assertIn("mate target", text)
        self.assertIn("any language", text)
        self.assertIn("nema 34 hang-off", text)
        self.assertIn("realistic", text)
        self.assertIn("aluminum", text)
        self.assertIn("pastel", text)
        self.assertIn("colors:", text)
        self.assertIn("#c0c6cc", text)
        self.assertIn("generate another", text)
        self.assertIn("paint bodies white", text)
        self.assertIn("split to fit plate", text)
        self.assertIn("fitting the plate wins", text)

    def test_improve_cad_system_requires_realistic_colors(self) -> None:
        text = IMPROVE_CAD_PROMPT_SYSTEM.lower()
        self.assertIn("always include a short realistic appearance clause", text)
        self.assertIn("colors:", text)
        self.assertIn("#c0c6cc", text)
        self.assertIn("#8a939d", text)
        self.assertIn("#3a3f44", text)
        self.assertIn("generate another", text)
        self.assertIn("imported", text)
        self.assertIn("step", text)
        self.assertIn("glb", text)
        self.assertIn("fill_srgb", text)
        self.assertIn("unauthored", text)

    def test_improve_cad_path_covers_imported_edit(self) -> None:
        """Improve CAD system + /api/prompt/improve user blocks cover import + Target Edit."""
        from backend.main import improve_cad_prompt
        import inspect

        src = inspect.getsource(improve_cad_prompt).lower()
        self.assertIn("imported step", src)
        self.assertIn("colors:", src)
        self.assertNotIn("cadgen.srgb", src)
        self.assertIn("without prescribing python imports or engine-specific api calls", src)
        self.assertIn("white is not a finish to preserve", src)
        self.assertIn("default-white / occ grey tessellation", src)

    def test_improve_cad_path_gates_mcmaster_parts_toggle(self) -> None:
        from backend.main import (
            IMPROVE_CAD_NO_MCMASTER_RULES,
            IMPROVE_CAD_PROMPT_SYSTEM_NO_MCMASTER,
            improve_cad_prompt,
        )
        import inspect

        src = inspect.getsource(improve_cad_prompt).lower()
        self.assertIn("use_mcmaster_parts", src)
        self.assertIn("improve_cad_intent_system", src)
        self.assertIn("do not add mcmaster-carr catalog", IMPROVE_CAD_NO_MCMASTER_RULES.lower())
        self.assertIn("do not include a hardware:", IMPROVE_CAD_NO_MCMASTER_RULES.lower())
        off = IMPROVE_CAD_PROMPT_SYSTEM_NO_MCMASTER.lower()
        self.assertIn("do not add mcmaster-carr catalog", off)
        self.assertNotIn("ask yourself what mcmaster-carr catalog parts are required", off)
        self.assertIn("ask yourself what mcmaster-carr catalog parts are required", IMPROVE_CAD_PROMPT_SYSTEM.lower())

    def test_frontend_cad_improve_sends_mcmaster_parts_flag(self) -> None:
        from pathlib import Path

        app = Path(__file__).resolve().parents[2] / "frontend" / "studio" / "app.js"
        text = app.read_text(encoding="utf-8")
        self.assertIn("render3d:cad-mcmaster-parts:v1", text)
        self.assertIn("use_mcmaster_parts", text)
        self.assertIn("getCadMcMasterPartsBodyFields", text)
        self.assertIn("/api/prompt/improve", text)

    def test_vibecad_and_jake_systems_distinguish_canvas(self) -> None:
        vibe = VIBECAD_SYSTEM.lower()
        jake = DESIGN_SYSTEM_PROMPT.lower()
        self.assertIn("canvas-sketch", vibe)
        self.assertIn("hanging off", vibe)
        self.assertIn("mate", vibe)
        self.assertIn("canvas sketch", jake)
        self.assertIn("hanging off", jake)
        self.assertIn("imported", jake)
        self.assertIn("unauthored", jake)
        self.assertIn("colors:", vibe)
        self.assertIn("imported step", vibe)

    def test_openai_vision_content_labels_each_image(self) -> None:
        content = AIService._openai_user_content(
            object(),
            "make the bracket",
            [
                {"name": "canvas-sketch.png", "data_url": "data:image/png;base64,aaa"},
                {"name": "2060.jpg", "data_url": "data:image/jpeg;base64,bbb"},
            ],
        )
        texts = [part["text"].lower() for part in content if part.get("type") == "input_text"]
        joined = " ".join(texts)
        self.assertIn("make the bracket", joined)
        self.assertIn("canvas / layout sketch", joined)
        self.assertIn("reference photo", joined)
        images = [part for part in content if part.get("type") == "input_image"]
        self.assertEqual(len(images), 2)


if __name__ == "__main__":
    unittest.main()
