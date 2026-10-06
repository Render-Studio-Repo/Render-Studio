"""Session cost reports: tokens/time, no fake dollars, votes, risk/reward."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import debugger_analytics_service as das
from backend.services import debugger_cost_service as dcs


class DebuggerCostTests(unittest.TestCase):
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
            patch.object(dcs, "BOARD_VOTES", root / "board-votes.jsonl"),
            patch.object(dcs, "GROUP_CHAT", root / "group-chat.jsonl"),
        ]
        for item in self.patches:
            item.start()
        (root / "board-votes.jsonl").write_text(
            '{"kind":"ballot","agent":"vibe-rnd","vote_id":"V-COST","choice":"YES"}\n'
            '{"kind":"ballot","agent":"clip-bot","vote_id":"V-COST","choice":"HOLD"}\n'
            '{"kind":"ballot","agent":"analytics","vote_id":"V-COST","choice":"NO"}\n',
            encoding="utf-8",
        )

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_close_report_tokens_time_unknown_currency(self):
        das.record_score({
            "log_id": "d9c98119-006",
            "score": 88,
            "method": "watchdog.log",
            "tokens_in": 120,
            "tokens_out": 40,
            "token_cost": 160,
            "duration_s": 9.5,
            "damage": 5,
        })
        report = dcs.close_session({
            "log_ids": ["d9c98119-006"],
            "trigger": "close",
        })
        self.assertTrue(report["id"].startswith("cost_"))
        self.assertGreaterEqual(report["token_cost"], 160)
        self.assertGreaterEqual(report["duration_s"], 9.5)
        self.assertIsNone(report["spend"])
        self.assertEqual(report["currency"], "unknown")
        self.assertEqual(report["price_source"], "none")
        self.assertTrue(report["suggestions"])
        self.assertIn(report["risk_vs_reward"]["verdict"], {"risk", "reward", "even"})
        self.assertEqual(report["votes"]["tally"]["YES"], 1)
        self.assertEqual(report["votes"]["tally"]["HOLD"], 1)
        self.assertEqual(report["votes"]["tally"]["NO"], 1)
        self.assertIn("YES", report["speak"])
        self.assertFalse(report["auto_applied"])

    def test_explicit_spend_only_when_priced(self):
        report = dcs.close_session({
            "log_ids": ["priced-1"],
            "tokens_in": 10,
            "tokens_out": 5,
            "duration_s": 1,
            "spend": 0.0123,
        })
        self.assertEqual(report["spend"], 0.0123)
        self.assertEqual(report["currency"], "USD")
        self.assertEqual(report["price_source"], "spend")

    def test_score_cede_closes_session(self):
        scored = das.record_score({
            "log_id": "cede-1",
            "score": 40,
            "token_cost": 80,
            "duration_s": 3,
            "cede": True,
        })
        self.assertTrue(scored.get("cost_report", {}).get("id", "").startswith("cost_"))
        self.assertEqual(scored["cost_report"]["trigger"], "cede")

    def test_normalize_yes_hold_no(self):
        self.assertEqual(dcs.normalize_vote("agree"), "YES")
        self.assertEqual(dcs.normalize_vote("H"), "HOLD")
        self.assertEqual(dcs.normalize_vote("we should HOLD the leak pass"), "HOLD")


if __name__ == "__main__":
    unittest.main()
