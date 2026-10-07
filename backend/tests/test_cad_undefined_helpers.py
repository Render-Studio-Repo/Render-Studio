"""CAD 2.0 must reject nested helper stubs and keep a last good export."""

from __future__ import annotations

import unittest

from backend.services.cad_pass_gate import (
    can_ship_exhausted_cad,
    exhausted_cad_note,
    jake_allows_host_source_rewrite,
)
from backend.services.design_service import _gen_step_undefined_helper_names, _source_has_complete_gen_step

CHASSIS_STUB = '''from cadgen import build123d as bd

def chassis_base():
    features = {
        "base": base(), "mount_pattern": mount_pattern(), "motor_bays": motor_bays(),
        "battery_pocket": battery_pocket(), "cable_passages": cable_passages(), "ribs": ribs(),
    }
    solid = fuse(list(features.values()))
    solid.label = "chassis_base"
    return solid

def gen_step():
    printable_solid = chassis_base()
    return bd.Compound(children=[printable_solid], label=model_label)
'''

COMPLETE = '''from cadgen import build123d as bd

def make_plate():
    return bd.Box(40, 20, 4)

def gen_step():
    plate = make_plate()
    plate.label = "plate"
    return plate
'''


class NestedHelperGateTests(unittest.TestCase):
    def test_stub_flags_nested_base_helpers(self) -> None:
        missing = _gen_step_undefined_helper_names(CHASSIS_STUB)
        self.assertIn("base", missing)
        self.assertIn("mount_pattern", missing)
        self.assertIn("motor_bays", missing)
        self.assertIn("fuse", missing)
        self.assertFalse(_source_has_complete_gen_step(CHASSIS_STUB))

    def test_defined_helpers_are_complete(self) -> None:
        self.assertEqual(_gen_step_undefined_helper_names(COMPLETE), [])
        self.assertTrue(_source_has_complete_gen_step(COMPLETE))


class CadPassGateTests(unittest.TestCase):
    def test_ship_when_step_glb_and_source_exist(self) -> None:
        self.assertTrue(can_ship_exhausted_cad(step_ok=True, glb_ok=True, source_ok=True))

    def test_fail_without_export(self) -> None:
        self.assertFalse(can_ship_exhausted_cad(step_ok=False, glb_ok=True, source_ok=True))
        self.assertFalse(can_ship_exhausted_cad(step_ok=True, glb_ok=False, source_ok=True))

    def test_note_keeps_last_error(self) -> None:
        note = exhausted_cad_note("NameError: name 'base' is not defined", 7)
        self.assertIn("keeping the last exported STEP/GLB", note)
        self.assertIn("base", note)

    def test_jake_agent_session_blocks_host_rewrite(self) -> None:
        self.assertFalse(
            jake_allows_host_source_rewrite(
                jake_identical=True,
                canonical_source=False,
                agent_attempted=True,
            )
        )
        self.assertTrue(
            jake_allows_host_source_rewrite(
                jake_identical=True,
                canonical_source=True,
                agent_attempted=False,
            )
        )
        self.assertTrue(
            jake_allows_host_source_rewrite(
                jake_identical=False,
                canonical_source=False,
                agent_attempted=False,
            )
        )


if __name__ == "__main__":
    unittest.main()
