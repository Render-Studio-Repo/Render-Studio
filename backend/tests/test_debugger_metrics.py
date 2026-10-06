"""Latency, user companion scores, confirm-fixed taxonomy, blacklist, suggestions."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import debugger_analytics_service as das
from backend.services import debugger_metrics_service as dms


class DebuggerMetricsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [
            patch.object(das, "ROOT_DIR", root),
            patch.object(das, "DB_PATH", root / "debugger.sqlite3"),
            patch.object(das, "WATCHDOG_ROOT", root / "tmp-watchdogs"),
            patch.object(das, "DATA_WATCHDOG_ROOT", root / "data-watchdogs"),
            patch.object(das, "BUG_ROOT", root / "bugs"),
            patch.object(das, "NOTES_ROOT", root / "notes"),
            patch.object(das, "REPORTS_ROOT", root / "weekly"),
            patch.object(das, "SCORE_ROOT", root / "scores"),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_latency_stored_with_model(self):
        scored = das.record_score({
            "log_id": "lat-1",
            "score": 70,
            "actor": "harness",
            "model": "grok-4.6",
            "read_ms": 180,
            "tokens_in": 400,
            "tokens_out": 80,
            "duration_s": 2.0,
            "projects_slow": True,
        })
        self.assertIn("latency", scored)
        self.assertEqual(scored["latency"]["model"], "grok-4.6")
        self.assertEqual(scored["latency"]["read_ms"], 180)
        self.assertGreater(scored["latency"]["token_speed"], 0)
        self.assertIn("projects_loading", scored["latency"]["slowed"])
        listed = dms.list_latency()
        self.assertEqual(listed[0]["score_id"], scored["id"])

    def test_user_damage_vs_grok_damage(self):
        das.record_score({
            "log_id": "u-1",
            "score": 20,
            "user_id": "sam",
            "project_id": "5bf8e783",
            "actor": "user",
            "damage": 50,
        })
        das.record_score({
            "log_id": "g-1",
            "score": 80,
            "user_id": "sam",
            "project_id": "5bf8e783",
            "actor": "grok",
            "damage": 10,
        })
        row = dms.get_user_score("sam")
        self.assertIsNotNone(row)
        self.assertGreater(row["user_damage"], row["grok_damage"])
        self.assertTrue(row["threat_flag"])
        self.assertIn("derived", row["threat_note"])
        self.assertIn("5bf8e783", row["hurt_projects"] + row["helped_projects"])

    def test_category_and_individual_id_format(self):
        slug = dms.parse_individual_id("PERF-07-00012")
        self.assertEqual(slug["category_id"], 4)
        self.assertEqual(slug["subcategory"], 7)
        self.assertEqual(slug["sequence"], 12)
        self.assertEqual(slug["dotted"], "4.07.0012")
        dotted = dms.parse_individual_id("4.07.0012")
        self.assertEqual(dotted["slug"], "PERF-07-00012")
        self.assertEqual(dotted["individual_id"], "PERF-07-00012")
        minted = dms.format_individual_id(4, 7, 12)
        self.assertEqual(minted["slug"], "PERF-07-00012")
        self.assertEqual(minted["dotted"], "4.07.0012")
        with self.assertRaises(ValueError):
            dms.parse_individual_id("not-an-id")

    def test_confirm_fixed_increments(self):
        das.record_score({"log_id": "c-1", "score": 40, "user_id": "sam", "project_id": "projab12", "actor": "grok"})
        das.record_score({"log_id": "c-2", "score": 70, "user_id": "sam", "project_id": "projab12", "actor": "grok"})
        first = dms.confirm_fixed({"user_id": "sam", "project_id": "projab12", "category": "performance", "subcategory": "memory.leak"})
        self.assertEqual(first["category_id"], 4)
        self.assertEqual(first["category_slug"], "performance")
        self.assertEqual(first["individual_id"], "PERF-07-00001")
        self.assertEqual(first["dotted_id"], "4.07.0001")
        self.assertEqual(first["prompt_count"], 2)
        self.assertEqual(first["user"]["confirm_count"], 1)
        das.record_score({"log_id": "c-3", "score": 90, "user_id": "sam", "project_id": "projab12", "actor": "grok"})
        second = dms.confirm_fixed({"user_id": "sam", "project_id": "projab12", "category": "performance", "subcategory": 7})
        self.assertEqual(second["individual_id"], "PERF-07-00002")
        self.assertEqual(second["user"]["confirm_count"], 2)

    def test_blacklist_after_repeated_leak_damage(self):
        last = None
        for i in range(3):
            last = dms.note_blacklist_hit("memory.leak", damage=55, leak=True, reason="leak loop")
        self.assertEqual(last["status"], "banned")
        self.assertEqual(last["hits"], 3)
        self.assertTrue(last["restore_needs_sam"])
        banned = dms.list_blacklist("banned")
        self.assertEqual(banned[0]["method"], "memory.leak")
        restored = dms.restore_blacklist("memory.leak")
        self.assertEqual(restored["status"], "restored")

    def test_weekly_suggestion_take_and_override(self):
        sug = dms.create_suggestion({"proposal": "stop logging full transcripts in weekly"})
        taken = dms.decide_suggestion(sug["id"], action="take", note="agreed")
        self.assertEqual(taken["status"], "taken")
        other = dms.create_suggestion({"proposal": "rewrite the viewport from scratch"})
        over = dms.decide_suggestion(other["id"], action="override", note="too broad")
        self.assertEqual(over["status"], "overridden")
        self.assertTrue(str(over["fork_id"]).startswith("fork_"))


if __name__ == "__main__":
    unittest.main()
