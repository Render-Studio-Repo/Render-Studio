"""One-class proof that the swarm tracking goal is real on temp sqlite."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import debugger_analytics_service as das
from backend.services import debugger_swarm_service as dss
from backend.services import prompt_trace_service as trace


class SwarmGoalE2ETests(unittest.TestCase):
    def setUp(self):
        self._prev_transcript_roots = os.environ.get("CURSOR_TRANSCRIPT_ROOTS")
        os.environ["CURSOR_TRANSCRIPT_ROOTS"] = ""
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.store = root / "prompt-trace"
        self.store.mkdir()
        (self.store / "live-prompts.jsonl").write_text(
            '{"log_id":"hist-e2e","chat_id":"chat-e2e","timestamp":"t1","prompt":"' + ("B" * 200) + '"}\n',
            encoding="utf-8",
        )
        self.patches = [
            patch.object(das, "ROOT_DIR", root),
            patch.object(das, "DB_PATH", root / "debugger.sqlite3"),
            patch.object(das, "WATCHDOG_ROOT", root / "tmp-watchdogs"),
            patch.object(das, "DATA_WATCHDOG_ROOT", root / "data-watchdogs"),
            patch.object(das, "BUG_ROOT", root / "bugs"),
            patch.object(das, "NOTES_ROOT", root / "notes"),
            patch.object(das, "REPORTS_ROOT", root / "weekly"),
            patch.object(das, "SCORE_ROOT", root / "scores"),
            patch.object(trace, "STORE", self.store),
            patch.object(trace, "INDEX", self.store / "live-prompts.jsonl"),
            patch.object(trace, "ROOT", root),
        ]
        for item in self.patches:
            item.start()
        (root / "ai-context" / "debugger").mkdir(parents=True)
        (root / "data" / "prompt-trace").mkdir(parents=True)

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()
        if self._prev_transcript_roots is None:
            os.environ.pop("CURSOR_TRANSCRIPT_ROOTS", None)
        else:
            os.environ["CURSOR_TRANSCRIPT_ROOTS"] = self._prev_transcript_roots

    def test_goal_requirements_all_true(self):
        for period in dss.CREDIT_PERIODS:
            for category in dss.CREDIT_CATEGORIES:
                row = dss.record_credit({
                    "period": period,
                    "category": category,
                    "credit": 61 if category != "liabilities" else 33,
                    "actor": "user" if category == "liabilities" else "cursor",
                    "agent_id": "cursor",
                })
                self.assertEqual(row["period"], period)
                self.assertEqual(row["category"], category)
        stored = dss.list_credit(limit=40)
        periods = {r["period"] for r in stored}
        cats = {r["category"] for r in stored}
        self.assertEqual(periods, set(dss.CREDIT_PERIODS))
        self.assertEqual(cats, set(dss.CREDIT_CATEGORIES))
        self.assertIn("liabilities", cats)
        rollups = dss.rollup_all_periods()
        for period in dss.CREDIT_PERIODS:
            self.assertTrue(rollups[period]["categories"], period)
        persisted = {r["period"] for r in dss.list_period_rollups()}
        self.assertEqual(persisted, set(dss.CREDIT_PERIODS))

        scored = das.record_score({
            "log_id": "e2e-log-1",
            "score": 74,
            "debug_user_id": "sam",
            "project_id": "5bf8e783",
            "agent_id": "cursor",
            "instance_id": "501",
        })
        self.assertEqual(scored.get("agent_id"), "cursor")
        user = dss.get_instance_user("sam", "501")
        self.assertIsNotNone(user)
        rel = user["relations"]
        self.assertEqual(rel["user_id"], "sam")
        self.assertEqual(rel["instance_id"], "501")
        self.assertTrue(any("5bf8e783" in p for p in rel["project_ids"]))
        self.assertIn("e2e-log-1", rel["log_ids"])
        self.assertIn("cursor", rel["agent_ids"])
        self.assertTrue(user["area_id"].startswith("501."))

        traced = trace.record({
            "log_id": "e2e-pt-1",
            "prompt": "score with alias user",
            "result": "improved",
            "score": 80,
            "uid": "sam",
            "project_id": "5bf8e783",
        })
        self.assertEqual(traced["prompt"].get("user_id"), "sam")
        self.assertEqual(traced["score"]["credit"]["extra"]["instance_id"], "501")
        self.assertEqual(dss.get_instance_user("sam", "501")["instance_id"], "501")

        members = [("project", f"x{i:02d}" + "a" * 60) for i in range(8)]
        raw = das.encode_tracking_id(members)
        self.assertGreater(len(raw), 160)
        packed = dss.encode_tracking_capped(members)
        self.assertTrue(packed["packed"])
        self.assertTrue(str(packed["tracking_id"]).startswith("ref:"))
        self.assertLessEqual(len(packed["tracking_id"]), 160)

        page = dss.history_search("hist-e2e", limit=10)
        self.assertTrue(page["hits"])
        hit = page["hits"][0]
        self.assertEqual(hit["log_id"], "hist-e2e")
        self.assertLessEqual(len(hit["excerpt"]), 120)
        self.assertNotIn("B" * 121, hit["excerpt"])
        self.assertFalse(page["bodies"])

        cycle = dss.league_cycle({
            "agent_id": "slow-e2e",
            "peer_id": "cursor",
            "score": 10,
            "damage": 80,
            "snapshot_id": "snap-e2e",
            "category": "optimization",
        })
        self.assertEqual(cycle["loop"], ["act", "snapshot", "score", "improve"])
        self.assertFalse(cycle["auto_fire"])
        agents = {row["agent_id"] for row in dss.list_league()}
        self.assertIn("slow-e2e", agents)
        self.assertIn("cursor", agents)
        self.assertTrue(any(
            r["agent_id"] == "slow-e2e" and r["status"] == "pending_sam" and not r.get("auto_fire", False)
            for r in dss.list_reports()
        ))

        agreed = dss.agree({"verdict": "disagree", "technical": 80, "desired": 55, "delta": -15, "note": "gates stay", "actor": "grok"})
        self.assertEqual(agreed["verdict"], "disagree")
        reviews = dss.list_reviews()
        self.assertTrue(any(r["id"] == agreed["id"] and r["verdict"] == "disagree" for r in reviews))

        with self.assertRaises(ValueError):
            dss.parse_readonly({"command": "rm -rf /"})

    def test_overview_json_exposes_swarm_for_debugger_ui(self):
        dss.register_user({
            "user_id": "sam-local",
            "instance_id": "501",
            "project_id": "5bf8e783",
            "log_id": "ui-ov-1",
            "agent_id": "cursor",
        })
        for category in dss.CREDIT_CATEGORIES:
            dss.record_credit({"period": "daily", "category": category, "credit": 60, "agent_id": "grok" if category == "optimization" else "cursor"})
        dss.rollup_all_periods()
        dss.league_cycle({"agent_id": "grok", "peer_id": "cursor", "score": 70, "damage": 5, "category": "optimization"})
        rpt = dss.report_agent({"agent_id": "grok", "recommendation": "fix-few-issues", "credit_score": 70})
        overview = das.overview()
        swarm = overview.get("swarm") or {}
        for key in ("credit", "rollups", "charts", "periods", "categories", "league", "reports", "pending_sam", "instance_users", "area"):
            self.assertIn(key, swarm, key)
        self.assertEqual(swarm["area"], "501")
        self.assertEqual(set(swarm["periods"]), set(dss.CREDIT_PERIODS))
        self.assertIn("liabilities", swarm["categories"])
        for period in dss.CREDIT_PERIODS:
            self.assertTrue(swarm["charts"].get(period), period)
        users = [u.get("user_id") for u in swarm["instance_users"]]
        self.assertIn("sam-local", users)
        agents = {row["agent_id"] for row in swarm["league"]}
        self.assertIn("cursor", agents)
        self.assertIn("grok", agents)
        self.assertTrue(any(r["id"] == rpt["id"] and r["status"] == "pending_sam" for r in swarm["pending_sam"]))
        decided = dss.decide_report(rpt["id"], {"recommendation": "fire"})
        self.assertEqual(decided["recommendation"], "fire")
        self.assertEqual(decided["status"], "pending_sam")
        self.assertFalse(decided["auto_fire"])
        self.assertFalse(decided["executed"])


if __name__ == "__main__":
    unittest.main()
