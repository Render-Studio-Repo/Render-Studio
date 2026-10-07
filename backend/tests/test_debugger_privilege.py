"""Privilege streaks, damage/outcome, forks, issues, Render Agent ids."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import debugger_analytics_service as das
from backend.services import debugger_privilege_service as dps
from backend.services import render_agent_debug_adapter as agent


class DebuggerPrivilegeTests(unittest.TestCase):
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

    def test_mark_safe_after_streak(self):
        vec = {"viewport.models": "ok", "webgl.context": "ok"}
        last = None
        for i in range(3):
            last = das.record_score({
                "log_id": f"ok-{i}",
                "score": 90,
                "method": "watchdog.log",
                "features": vec,
                "collateral": 0,
            })
        self.assertTrue(last.get("ask_safe"))
        self.assertEqual(last["ask_safe"]["method"], "watchdog.log")
        self.assertFalse(dps.can_act("watchdog.log"))
        marked = dps.mark_safe("watchdog.log")
        self.assertEqual(marked["status"], "safe")
        self.assertTrue(dps.can_act("watchdog.log"))

    def test_ban_after_consecutive_bad(self):
        dps.mark_safe("ui.overlay")
        last = None
        for i in range(3):
            last = das.record_score({
                "log_id": f"bad-{i}",
                "score": 10,
                "method": "ui.overlay",
                "features": {"viewport.boot": "broken"},
                "broken": ["viewport.boot"],
                "collateral": 2,
                "throttle": True,
            })
        self.assertEqual(last.get("privilege_status"), "banned")
        self.assertFalse(dps.can_act("ui.overlay"))

    def test_damage_lowers_outcome(self):
        clean = dps.compute_outcome(80, 0, 1.0)
        hurt = dps.compute_outcome(80, 40, 1.0)
        self.assertEqual(clean, 80.0)
        self.assertLess(hurt, clean)
        self.assertEqual(hurt, 80 * (1 - 40 / 200))

    def test_fork_id_and_sam_raise(self):
        fork = dps.create_fork({
            "parent_tracking_id": "project:5bf8e783+log:d9c98119-004",
            "override_note": "try the overlay path not a full window rewrite",
            "sam_steps": "narrow the CSS selector",
            "scores_before": [40, 35],
        })
        self.assertTrue(fork["id"].startswith("fork_"))
        evaluated = dps.evaluate_fork(fork["id"], [80, 88])
        self.assertTrue(evaluated["raised"])

    def test_similar_bug_privilege_memory_leak(self):
        vec = {"debugger.logs": "degraded", "api.health": "ok"}
        for i in range(3):
            das.record_score({
                "log_id": f"leak-{i}",
                "score": 92,
                "method": "memory.leak",
                "features": vec,
                "collateral": 0,
            })
        asked = dps.list_ask_safe()
        self.assertTrue(any(row["method"] == "memory.leak" for row in asked))
        dps.mark_safe("memory.leak")
        self.assertTrue(dps.can_act("memory.leak"))

    def test_render_agent_tracking_id_helper(self):
        ids = agent.tracking_ids(project_id="5bf8e783", instance_id="abc123zz", log_ids=["d9c98119-004"])
        self.assertEqual(ids["project_id"], "5bf8e783.abc123zz")
        self.assertIn("project:5bf8e783.abc123zz", ids["tracking_id"])
        self.assertIn("log:d9c98119-004", ids["tracking_id"])
        scored = agent.record_agent_score({
            "project_id": "5bf8e783",
            "instance_id": "abc123zz",
            "log_id": "d9c98119-005",
            "score": 88,
            "features": {"viewport.boot": "ok"},
        })
        self.assertEqual(scored["project_id"], "5bf8e783.abc123zz")
        with self.assertRaises(ValueError):
            agent.record_agent_score({"score": 50})

    def test_github_issue_requires_project_id(self):
        with self.assertRaises(ValueError):
            dps.file_issue({"instance_id": "local", "title": "no project"})
        with self.assertRaises(ValueError):
            dps.file_issue({"project_id": "5bf8e783", "title": "no instance"})
        row = dps.file_issue({
            "project_id": "5bf8e783",
            "instance_id": "other99",
            "title": "models missing",
            "log_ids": ["d9c98119-004", "d9c98119-005"],
        })
        self.assertEqual(row["project_id"], "5bf8e783.other99")
        self.assertIn("d9c98119-004", row["log_ids"])

    def test_rollback_stays_pending_unless_safe(self):
        pending = dps.propose_rollback({"snapshot_id": "snap-1", "log_ids": ["a", "b"]})
        self.assertEqual(pending["status"], "pending_approval")
        dps.mark_safe("snapshot.reset")
        still = dps.propose_rollback({"snapshot_id": "snap-2", "log_ids": ["c"]})
        self.assertEqual(still["status"], "pending_approval")
        self.assertFalse(still.get("auto_applied"))
        self.assertFalse(dps.approve_rollback(pending["id"]).get("git_reset"))

    def test_github_issue_stays_pending_without_approve(self):
        with patch("backend.services.github_issues_service.create_debugger_issue") as gh:
            gh.return_value = {"ok": True, "html_url": "https://github.com/example/1", "number": 1}
            row = dps.file_issue({
                "project_id": "ce8294df",
                "instance_id": "other99",
                "title": "models missing",
                "log_ids": ["d9c98119-004", "d9c98119-005"],
                "github": True,
            })
            self.assertEqual(row["project_id"], "ce8294df.other99")
            self.assertNotEqual(row["project_id"], "ce8294df")
            self.assertEqual(row["status"], "pending_github")
            self.assertEqual(row["log_chain"], "d9c98119-004 | d9c98119-005")
            gh.assert_not_called()
            approved = dps.approve_issue(row["id"], approve=True, github=True)
            self.assertTrue(approved["github"].get("ok"))
            gh.assert_called_once()

    def test_studio_project_ids_get_tenant_suffix(self):
        self.assertEqual(dps.compose_project_id("ce8294df", "tenant1"), "ce8294df.tenant1")
        self.assertEqual(dps.compose_project_id("5bf8e783"), "5bf8e783")
        self.assertIn("ce8294df", dps.STUDIO_PROJECT_IDS)


if __name__ == "__main__":
    unittest.main()
