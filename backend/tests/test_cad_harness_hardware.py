"""Shared CAD harness McMaster hardware for Jake, VibeCAD, and MAC."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import cad_harness
from backend.services.vibecad_service import VIBECAD_SYSTEM
from backend.services.vibecad_agent import AGENT_SYSTEM


class _FakeAI:
    def generate_cad_brief(self, prompt, context, trace_id=None, images=None):
        brief = (
            "CAD brief:\n"
            "- Model: motor_mount\n"
            "- McMaster-Carr / purchased hardware: 4x 91251A194 M3 socket head cap screws\n"
        )
        return brief, {"stage": "cad_brief", "provider": "fake"}


class CadHarnessHardwareTests(unittest.TestCase):
    def test_apply_mcmaster_from_brief_writes_parts_list_and_updates_context(self):
        tmp_path = Path(tempfile.mkdtemp())
        brief = (
            "CAD brief:\n"
            "- Model: clip\n"
            "- McMaster-Carr / purchased hardware: 4x 91251A194 M3 SHCS for the lid\n"
        )
        with patch(
            "backend.services.mcmaster_fetch_service.fetch_listed_parts_for_project",
            return_value={"count": 0, "errors": []},
        ) as fetch:
            out = cad_harness.apply_mcmaster_from_brief(
                tmp_path,
                cad_brief=brief,
                user_prompt="clip with M3 screws",
                context={"refs": []},
                is_edit=False,
            )
        fetch.assert_called_once()
        ctx = out["context"]
        self.assertIn("91251A194", str(ctx.get("mcmaster_parts_list") or ""))
        self.assertTrue(str(ctx.get("cad_brief") or "").startswith("CAD brief:"))
        refs = ctx.get("refs") or []
        self.assertTrue(any(isinstance(r, dict) and r.get("mcmaster_parts_list") for r in refs))
        listing_path = tmp_path / "references" / "McMaster" / "parts_list.md"
        self.assertTrue(listing_path.is_file())
        self.assertIn("91251A194", listing_path.read_text(encoding="utf-8"))
        self.assertGreaterEqual(int((out.get("mcmaster") or {}).get("count") or 0), 1)

    def test_prepare_harness_hardware_generates_brief_for_vibecad_mac(self):
        tmp_path = Path(tempfile.mkdtemp())
        with patch(
            "backend.services.mcmaster_fetch_service.fetch_listed_parts_for_project",
            return_value={"count": 0, "errors": []},
        ):
            out = cad_harness.prepare_harness_hardware(
                "motor mount with M3 screws",
                tmp_path,
                {"mode": "vibecad"},
                _FakeAI(),
            )
        self.assertIn("91251A194", str(out["context"].get("mcmaster_parts_list") or ""))
        self.assertTrue(out["cad_brief"].lower().startswith("cad brief"))
        self.assertTrue(out["ai_traces"])
        self.assertTrue(list(tmp_path.glob("*.brief.md")))

    def test_prepare_harness_skips_brief_codex_when_handoff_exists(self) -> None:
        tmp_path = Path(tempfile.mkdtemp())
        (tmp_path / ".vibecad_handoff.json").write_text(
            '{"source": "rack.vibecad.py", "stem": "rack"}',
            encoding="utf-8",
        )
        (tmp_path / "rack.brief.md").write_text("CAD brief:\n- hardware: 91251A194\n", encoding="utf-8")
        with patch(
            "backend.services.mcmaster_fetch_service.fetch_listed_parts_for_project",
            return_value={"count": 0, "errors": []},
        ):
            out = cad_harness.prepare_harness_hardware(
                "motor mount with M3 screws",
                tmp_path,
                {"mode": "vibecad"},
                _FakeAI(),
            )
        self.assertEqual(out["ai_traces"], [])
        self.assertTrue(out["cad_brief"].lower().startswith("cad brief"))

    def test_format_context_packet_includes_brief_electronics_and_hardware(self):
        tmp_path = Path(tempfile.mkdtemp())
        packet = cad_harness.format_context_packet(
            {
                "cad_brief": "CAD brief:\n- hardware: 91251A194\n",
                "model_electronics": True,
            },
            tmp_path,
            prompt="brushless motor mount with battery tray",
        )
        self.assertIn("CAD brief (hardware + design contract)", packet)
        self.assertIn("ELECTRONICS / WIRING SOLIDS", packet)
        self.assertIn("McMaster-Carr hardware (required for every CAD harness", packet)
        self.assertIn("Jake, VibeCAD, and MAC", packet)

    def test_followup_packet_preserves_existing_electronics_without_regeneration_rules(self):
        tmp_path = Path(tempfile.mkdtemp())
        packet = cad_harness.format_context_packet(
            {
                "model_electronics": True,
                "preserve_existing_electronics": True,
            },
            tmp_path,
            prompt="Make the robot base 20 mm wider",
        )
        self.assertIn("Preserve them unchanged", packet)
        self.assertIn("Do not regenerate electronics_parts.json", packet)
        self.assertNotIn("Electronics handoff (when this build uses electronics)", packet)
        self.assertNotIn("ELECTRONICS / WIRING SOLIDS", packet)

    def test_print_only_prompt_skips_mcmaster(self):
        self.assertTrue(cad_harness.prompt_forbids_catalog_hardware("doghouse, no screws, all printed"))
        self.assertTrue(
            cad_harness.prompt_forbids_catalog_hardware(
                "make the whole kit so it all needs to be printed for a printer"
            )
        )
        self.assertFalse(
            cad_harness.prompt_forbids_catalog_hardware("3d printable clamp with M3 screws")
        )
        tmp_path = Path(tempfile.mkdtemp())
        with patch(
            "backend.services.mcmaster_fetch_service.fetch_listed_parts_for_project",
            return_value={"count": 0, "errors": []},
        ) as fetch:
            out = cad_harness.apply_mcmaster_from_brief(
                tmp_path,
                cad_brief="CAD brief:\n- Model: clip\n- McMaster-Carr / purchased hardware: 4x 91251A194\n",
                user_prompt="snap-fit clip, no screws, all 3d printed",
                context={"refs": []},
                is_edit=False,
            )
        fetch.assert_not_called()
        self.assertTrue((out.get("mcmaster") or {}).get("skipped"))
        packet = cad_harness.format_context_packet(
            {"cad_brief": "CAD brief:\n- hardware: none\n"},
            tmp_path,
            prompt="no screws, print-in-place box",
        )
        self.assertIn("Print-only kit", packet)
        self.assertNotIn("required for every CAD harness", packet)
        tmp_path = Path(tempfile.mkdtemp())
        packet = cad_harness.format_context_packet(
            {
                "cad_brief": "CAD brief:\n- hardware: 91251A194\n",
                "model_electronics": True,
            },
            tmp_path,
            prompt="brushless motor mount with battery tray",
        )
        self.assertIn("CAD brief (hardware + design contract)", packet)
        self.assertIn("ELECTRONICS / WIRING SOLIDS", packet)
        self.assertIn("McMaster-Carr hardware (required for every CAD harness", packet)
        self.assertIn("Jake, VibeCAD, and MAC", packet)

    def test_joints_instructions_for_mechanisms(self):
        tmp_path = Path(tempfile.mkdtemp())
        packet = cad_harness.format_context_packet({}, tmp_path, prompt="hinged box lid")
        self.assertIn("JOINTS (VibeCAD Assembly", packet)
        self.assertIn("<model_stem>.joints.json", packet)
        self.assertTrue(cad_harness.prompt_wants_joints("robot arm gripper"))
        rows = cad_harness.normalize_harness_joints([
            {
                "id": "lid_hinge",
                "type": "revolute",
                "parent": "Base",
                "child": "Lid",
                "anchor": [0, 0, 20],
                "axis": "x",
                "limits": [0, 110],
            }
        ])
        self.assertEqual(rows[0]["type"], "revolute")
        self.assertEqual(rows[0]["axis"], [1.0, 0.0, 0.0])
        cad_harness.write_harness_joints_file(tmp_path, rows, stem="box")
        self.assertTrue((tmp_path / "r3d_joints.json").is_file())
        self.assertIn("lid_hinge", (tmp_path / "r3d_joints.json").read_text(encoding="utf-8"))

    def test_mcmaster_parts_toggle_off_skips_fetch_and_packet(self):
        tmp_path = Path(tempfile.mkdtemp())
        with patch(
            "backend.services.mcmaster_fetch_service.fetch_listed_parts_for_project",
            return_value={"count": 0, "errors": []},
        ) as fetch:
            out = cad_harness.apply_mcmaster_from_brief(
                tmp_path,
                cad_brief="CAD brief:\n- Model: clip\n- McMaster-Carr / purchased hardware: 4x 91251A194\n",
                user_prompt="clip with M3 screws",
                context={"refs": [], "use_mcmaster_parts": False},
                is_edit=False,
            )
        fetch.assert_not_called()
        self.assertTrue((out.get("mcmaster") or {}).get("skipped"))
        self.assertEqual((out.get("mcmaster") or {}).get("reason"), "disabled")
        packet = cad_harness.format_context_packet(
            {"use_mcmaster_parts": False},
            tmp_path,
            prompt="clip with M3 screws",
        )
        self.assertIn("McMaster-Carr catalog hardware is OFF", packet)
        self.assertNotIn("required for every CAD harness", packet)

    def test_vibecad_system_requires_catalog_hardware(self):
        self.assertIn("McMaster-Carr", VIBECAD_SYSTEM)
        self.assertIn("Do not skip hardware because this is VibeCAD", VIBECAD_SYSTEM)
        self.assertIn("joints", VIBECAD_SYSTEM)
        self.assertNotIn(
            "do not search component or fastener catalogs unless the user asks",
            VIBECAD_SYSTEM.lower(),
        )

    def test_vibecad_hosts_continue_new_concepts_with_tbd_interfaces(self):
        for system in (VIBECAD_SYSTEM, AGENT_SYSTEM):
            self.assertIn("Missing exact purchased-component geometry does not block a NEW concept export", system)
            self.assertIn("adjustable parametric interface", system)
            self.assertIn("ASSUMED_NOT_FIT_VERIFIED", system)

    def test_mac_vendor_prompt_receives_shared_tbd_interface_policy(self):
        tmp_path = Path(tempfile.mkdtemp())
        prompt = cad_harness.enrich_user_request(
            "Create a new rotating base. Motor is NEMA 34 plus encoder, exact model TBD.",
            {"mode": "mac"},
            tmp_path,
        )
        self.assertIn("Missing exact purchased-component geometry does not block a NEW concept export", prompt)
        self.assertIn("adjustable parametric interface", prompt)

    def test_finalize_can_defer_place_until_after_polish(self) -> None:
        tmp_path = Path(tempfile.mkdtemp())
        (tmp_path / "clip.step").write_text("ISO-10303-21;", encoding="utf-8")
        with patch(
            "backend.services.freecad_engine.place_new_part_beside_assembly",
            return_value={"ok": True},
        ) as place:
            skipped = cad_harness.finalize_harness_run(
                tmp_path,
                published_step="clip.step",
                place_assembly=False,
            )
            ran = cad_harness.finalize_harness_run(
                tmp_path,
                published_step="clip.step",
                place_assembly=True,
            )
        self.assertEqual(skipped.get("assembly_place"), {})
        self.assertEqual(place.call_count, 1)
        self.assertTrue((ran.get("assembly_place") or {}).get("ok"))

    def test_sibling_instructions_keep_existing_parts(self):
        self.assertIn("cadgen.read_step", cad_harness.SIBLING_PARTS_INSTRUCTIONS)
        self.assertIn("keep them in place", cad_harness.SIBLING_PARTS_INSTRUCTIONS.lower())
        self.assertIn("inputs[hw_*]", cad_harness.SIBLING_PARTS_INSTRUCTIONS)
        self.assertNotIn("one assembly STEP/GLB", cad_harness.SIBLING_PARTS_INSTRUCTIONS)
        self.assertIn("FreeCAD", cad_harness.SIBLING_PARTS_INSTRUCTIONS)

    def test_merge_hardware_traces_prepends_brief(self):
        merged = cad_harness.merge_hardware_ai_traces(
            {"ai_trace": [{"stage": "author"}]},
            [{"stage": "cad_brief"}],
        )
        self.assertEqual([t["stage"] for t in merged["ai_trace"]], ["cad_brief", "author"])


if __name__ == "__main__":
    unittest.main()
