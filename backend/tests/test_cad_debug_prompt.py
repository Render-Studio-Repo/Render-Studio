"""CAD Debug toggle injects debug prompts for Improve + Generate."""

from __future__ import annotations

import unittest

from backend.services.cad_debug_prompt import (
    CAD_DEBUG_IMPROVE_SYSTEM,
    CAD_DEBUG_MARKER,
    CAD_DEBUG_SYSTEM,
    apply_cad_debug_to_prompt,
    format_cad_debug_brief,
    is_cad_debug_enabled,
)


class CadDebugPromptTests(unittest.TestCase):
    def test_toggle_and_brief(self) -> None:
        self.assertTrue(is_cad_debug_enabled(True))
        self.assertFalse(is_cad_debug_enabled(False))
        brief = format_cad_debug_brief({
            "engine": "VibeCAD",
            "units": "mm",
            "bodies": ["housing", "lid"],
            "last_error": "FreeCAD failed: Shape is not valid",
            "kernel_logs": "OCC: BRepCheck failed",
        })
        self.assertIn(CAD_DEBUG_MARKER, brief)
        self.assertIn("VibeCAD", brief)
        self.assertIn("mm", brief)
        self.assertIn("housing", brief)
        self.assertIn("Shape is not valid", brief)
        self.assertIn("BRepCheck", brief)

    def test_apply_once(self) -> None:
        first = apply_cad_debug_to_prompt("Bracket 80 mm", enabled=True, brief={"engine": "Jake", "units": "mm"})
        self.assertIn("Bracket 80 mm", first)
        self.assertIn(CAD_DEBUG_MARKER, first)
        again = apply_cad_debug_to_prompt(first, enabled=True, brief={"engine": "Jake"})
        self.assertEqual(first, again)
        off = apply_cad_debug_to_prompt("Bracket 80 mm", enabled=False, brief={"engine": "Jake"})
        self.assertEqual(off, "Bracket 80 mm")
        self.assertIn("Diagnose", CAD_DEBUG_SYSTEM)
        self.assertIn("Debug toggle", CAD_DEBUG_IMPROVE_SYSTEM)
        self.assertIn("not XR", CAD_DEBUG_SYSTEM)
        self.assertIn("not an XR debugger", CAD_DEBUG_IMPROVE_SYSTEM)


if __name__ == "__main__":
    unittest.main()
