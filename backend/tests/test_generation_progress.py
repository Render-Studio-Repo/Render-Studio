"""Generation HUD: percent never rewinds; 3/8 is not the meter."""

from __future__ import annotations

import unittest

from backend.services.generation_service import (
    _merge_progress,
    authoring_loop_pct,
)


class GenerationProgressTests(unittest.TestCase):
    def test_authoring_loop_pct_spreads_across_band(self) -> None:
        self.assertEqual(authoring_loop_pct(0, 200), 28)
        self.assertEqual(authoring_loop_pct(199, 200), 74)
        self.assertGreater(authoring_loop_pct(51, 200), 28)
        self.assertLess(authoring_loop_pct(51, 200), 74)

    def test_merge_progress_never_decreases_pct(self) -> None:
        first = _merge_progress(
            None,
            {"stage": "generate", "pct": 70, "label": "VibeCAD · agent turn 12/200…"},
        )
        self.assertEqual(first["pct"], 70)
        self.assertEqual(first["counter"], "Turn 12/200")
        second = _merge_progress(
            first,
            {"stage": "analyze", "pct": 18, "label": "VibeCAD · independent design review…"},
        )
        self.assertEqual(second["pct"], 70)
        self.assertEqual(second["counter"], "Review")
        active = [row for row in second["checklist"] if row.get("status") == "active"]
        self.assertTrue(active)
        self.assertEqual(active[0]["id"], "ai_source")

    def test_merge_progress_keeps_pipeline_during_mcmaster(self) -> None:
        first = _merge_progress(
            None,
            {
                "stage": "generate",
                "pct": 40,
                "label": "VibeCAD · agent turn 20/200…",
                "pipeline": "vibecad",
            },
        )
        second = _merge_progress(
            first,
            {"stage": "hardware", "pct": 14, "label": "McMaster · 10/11 parts complete"},
        )
        self.assertEqual(second["pipeline"], "vibecad")
        self.assertEqual(second["pct"], 40)
        ids = [row["id"] for row in second["checklist"] if row.get("status") in {"done", "active"}]
        self.assertIn("ai_source", ids)
        self.assertIn("hardware", ids)

    def test_merge_progress_keeps_live_cost_during_mcmaster(self) -> None:
        first = _merge_progress(
            None,
            {
                "stage": "generate",
                "pct": 40,
                "label": "VibeCAD · agent turn 20/200…",
                "pipeline": "vibecad",
                "harness": "vibecad",
                "cost_usd": 0.42,
                "usage": {"total_tokens": 12000},
            },
        )
        second = _merge_progress(
            first,
            {"stage": "hardware", "pct": 8, "label": "McMaster · fetch catalog STEPs before drawing…"},
        )
        self.assertEqual(second["harness"], "vibecad")
        self.assertEqual(second["cost_usd"], 0.42)
        self.assertEqual(second["usage"]["total_tokens"], 12000)

    def test_hardware_is_first_vibecad_step(self) -> None:
        out = _merge_progress(
            None,
            {
                "stage": "hardware",
                "pct": 12,
                "label": "McMaster · fetch catalog STEPs before drawing…",
                "pipeline": "vibecad",
            },
        )
        self.assertEqual(out["checklist"][0]["id"], "hardware")
        self.assertEqual(out["checklist"][0]["status"], "active")
        self.assertEqual(out["counter"], "Hardware")

    def test_scripts_step_relabels_sticky_vibecad_as_jake(self):
        first = _merge_progress(
            None,
            {
                "stage": "generate",
                "pct": 40,
                "label": "Codex · leftover helper",
                "pipeline": "vibecad",
            },
        )
        self.assertEqual(first["pipeline"], "vibecad")
        second = _merge_progress(
            first,
            {
                "stage": "step",
                "pct": 84,
                "label": "python scripts/step Enclosure.py --glb Enclosure.glb --force",
            },
        )
        self.assertEqual(second["pipeline"], "jake")
        labels = [row.get("label") for row in second["checklist"]]
        self.assertIn("Jake brief", labels)
        self.assertTrue(any("scripts/step" in str(lab) for lab in labels))

    def test_merge_progress_keeps_wand_version(self):
        out = _merge_progress(
            None,
            {
                "stage": "generate",
                "pct": 20,
                "label": "Mesh · forge spec…",
                "pipeline": "img2threejs",
                "harness": "mesh",
                "wand": "img2threejs",
                "wand_version": "1.5.2",
            },
        )
        self.assertEqual(out["harness"], "mesh")
        self.assertEqual(out["wand"], "img2threejs")
        self.assertEqual(out["wand_version"], "1.5.2")


if __name__ == "__main__":
    unittest.main()
