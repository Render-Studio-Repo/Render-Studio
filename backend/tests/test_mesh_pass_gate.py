"""A failed visual review cannot be bypassed by artifact presence."""

from __future__ import annotations

import unittest

from backend.services.mesh_pass_gate import can_ship_exhausted_pass, exhausted_pass_note


class MeshPassGateTests(unittest.TestCase):
    def test_ship_when_factory_and_glb_exist(self) -> None:
        self.assertFalse(can_ship_exhausted_pass(glb_ok=True, has_factory=True))

    def test_fail_without_export(self) -> None:
        self.assertFalse(can_ship_exhausted_pass(glb_ok=False, has_factory=True))
        self.assertFalse(can_ship_exhausted_pass(glb_ok=True, has_factory=False))

    def test_note_keeps_reviewer_brief_but_says_kept(self) -> None:
        note = exhausted_pass_note(
            "structural-pass",
            "Rebuild the facial plates into connected brow ridges.",
            3,
        )
        self.assertIn("candidate was rejected", note)
        self.assertIn("Rebuild the facial plates", note)
        self.assertNotEqual(note.strip(), "Rebuild the facial plates into connected brow ridges.")


if __name__ == "__main__":
    unittest.main()
