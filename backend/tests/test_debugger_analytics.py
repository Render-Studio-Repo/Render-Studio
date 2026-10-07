"""Debugger analytics: approvals, throttle, similarity, gated bugs, scores."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import debugger_analytics_service as svc


class DebuggerAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [
            patch.object(svc, "ROOT_DIR", root),
            patch.object(svc, "DB_PATH", root / "debugger.sqlite3"),
            patch.object(svc, "WATCHDOG_ROOT", root / "ai-context" / "debugger" / "incident-intelligence" / "tmp-watchdogs"),
            patch.object(svc, "DATA_WATCHDOG_ROOT", root / "data" / "debugger" / "tmp-watchdogs"),
            patch.object(svc, "BUG_ROOT", root / "ai-context" / "debugger" / "incident-intelligence" / "bug-reports"),
            patch.object(svc, "NOTES_ROOT", root / "ai-context" / "debugger" / "incident-intelligence" / "architecture-notes"),
            patch.object(svc, "REPORTS_ROOT", root / "ai-context" / "debugger" / "incident-intelligence" / "weekly"),
            patch.object(svc, "SCORE_ROOT", root / "data" / "debugger" / "scores"),
            patch.object(svc, "SKILL_WRITE_ROOTS", (root / "mcp" / "grok-bot" / "skills", root / "ai-context" / "skills")),
            patch.object(svc, "_local_instance_id", return_value="local-test"),
        ]
        for item in self.patches:
            item.start()
        (root / "ai-context" / "debugger").mkdir(parents=True)
        (root / "mcp" / "grok-bot" / "skills" / "debugger-analytics").mkdir(parents=True)
        (root / "ai-context" / "skills").mkdir(parents=True)

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_draft_watchdog_cannot_run(self):
        draft = svc.draft_watchdog({"title": "tmp net watch", "kind": "log", "note": "pending"})
        self.assertEqual(draft["status"], "pending_approval")
        self.assertTrue((svc.WATCHDOG_ROOT / draft["id"] / "spec.json").is_file())
        with self.assertRaises(ValueError):
            svc.start_watchdog(draft["id"])
        approved = svc.approve_watchdog(draft["id"])
        self.assertEqual(approved["status"], "approved")
        running = svc.start_watchdog(draft["id"])
        self.assertEqual(running["status"], "running")

    def test_throttle_disables_child_and_writes_analysis(self):
        draft = svc.draft_watchdog({"title": "noisy", "spec": {"poll_ms": 10, "noisy_paths": ["*.jsonl"]}})
        svc.approve_watchdog(draft["id"])
        svc.start_watchdog(draft["id"])
        result = svc.record_usage(draft["id"], bytes_n=500_000, requests=40, seconds=1)
        self.assertEqual(result["status"], "throttled")
        self.assertTrue(result["throttle_cause"])
        self.assertTrue(result.get("analysis_id"))
        analysis = svc.list_analysis()
        self.assertTrue(any(row["throttle"] for row in analysis))
        spec = (svc.WATCHDOG_ROOT / draft["id"] / "spec.json").read_text(encoding="utf-8")
        self.assertIn("optimized", spec)
        alerts = svc.list_alerts()
        self.assertTrue(any(row["kind"] == "log.throttle" for row in alerts))

    def test_similarity_viewport_vs_cad_is_false(self):
        viewport = {"viewport.boot": "broken", "viewport.models": "missing", "cad.generate": "ok"}
        cad = {"viewport.boot": "ok", "viewport.models": "missing", "cad.generate": "broken"}
        cmp = svc.compare_feature_vectors(viewport, cad)
        self.assertFalse(cmp["similar"])
        same = svc.compare_feature_vectors(viewport, {"viewport.boot": "broken", "viewport.models": "missing", "webgl.context": "ok"})
        self.assertTrue(same["similar"])

    def test_bug_id_requires_solved_without_collateral(self):
        with self.assertRaises(ValueError):
            svc.create_bug({"name": "models gone", "root_cause": "guess", "solved": False, "features": {"viewport.models": "missing"}})
        with self.assertRaises(ValueError):
            svc.create_bug({
                "name": "fixed but broke vr",
                "root_cause": "rigging hide",
                "solved": True,
                "before_features": {"viewport.models": "missing", "vr.controls": "ok"},
                "after_features": {"viewport.models": "ok", "vr.controls": "broken"},
                "features": {"viewport.models": "ok", "vr.controls": "broken"},
            })
        bug = svc.create_bug({
            "name": "rigging hid models",
            "root_cause": "rig attach hid the mesh group",
            "solved": True,
            "feature": "viewport.models",
            "features": {"viewport.boot": "ok", "viewport.models": "ok"},
            "before_features": {"viewport.models": "missing", "viewport.boot": "ok"},
            "after_features": {"viewport.models": "ok", "viewport.boot": "ok"},
            "prompt": "models disappeared after rigging",
        })
        self.assertTrue(bug["id"].startswith("bug_"))
        self.assertTrue((svc.BUG_ROOT / bug["id"] / "sam.pdf").is_file())
        self.assertTrue((svc.BUG_ROOT / bug["id"] / "grok.pdf").is_file())
        self.assertTrue((svc.BUG_ROOT / bug["id"] / "harness.pdf").is_file())
        ping = svc.ping_bug(bug["id"])
        self.assertEqual(ping["instance_count"], 1)

    def test_skill_proposal_stays_pending(self):
        path = "mcp/grok-bot/skills/debugger-analytics/SKILL.md"
        (svc.ROOT_DIR / path).parent.mkdir(parents=True, exist_ok=True)
        proposal = svc.propose_skill({"path": path, "body": "# draft\n", "note": "try compact ping"})
        self.assertEqual(proposal["status"], "pending_approval")
        with self.assertRaises(ValueError):
            svc.apply_skill(proposal["id"])
        for _ in range(3):
            svc.approve_skill(proposal["id"])
            svc.confirm_skill_solve(proposal["id"], breakage=0)
        applied = svc.apply_skill(proposal["id"])
        self.assertEqual(applied["status"], "applied")
        self.assertTrue((svc.ROOT_DIR / path).is_file())

    def test_search_caps_excerpts(self):
        svc.record_score({
            "log_id": "d9c98119-004",
            "score": 20,
            "notes": "x" * 400,
            "features": {"viewport.models": "missing"},
        })
        with patch("backend.services.incident_intelligence_service.search_chat_logs", return_value={
            "hits": [{"log_id": "d9c98119-010", "prompt": "P" * 400, "result": "broke", "blamed_log_id": "d9c98119-009"}],
        }):
            hits = svc.search_ids("viewport")
        self.assertTrue(hits["hits"])
        self.assertLessEqual(len(hits["hits"][0]["excerpt"]), 120)
        self.assertNotIn("P" * 121, hits["hits"][0]["excerpt"])

    def test_tracking_id_encode_decode_and_multi_break(self):
        composite = svc.encode_tracking_id([
            ("project", "5bf8e783"),
            ("project", "5bf8e783"),
            ("project", "5bf8e783"),
        ])
        self.assertEqual(composite, "project:5bf8e783+project:5bf8e783+project:5bf8e783")
        self.assertEqual([m["id"] for m in svc.decode_tracking_id(composite)], ["5bf8e783"] * 3)
        scored = svc.record_score({
            "log_id": "d9c98119-012",
            "prompt_id": "d9c98119-012",
            "project_id": "5bf8e783",
            "project_ids": ["5bf8e783", "5bf8e783", "5bf8e783"],
            "score": 15,
            "broken": ["viewport.boot", "viewport.models"],
            "traceback_ids": ["trb_one", "trb_two"],
            "features": {"viewport.boot": "broken", "viewport.models": "missing"},
            "steps": ["compare snapshots", "search webgl"],
        })
        self.assertTrue(scored["tracking_id"])
        self.assertIn("project:5bf8e783", scored["tracking_id"])
        self.assertTrue(scored["ref_id"].startswith("ref_"))
        ref = svc.get_ref(scored["ref_id"])
        self.assertEqual(ref["composite"], scored["tracking_id"])
        self.assertGreaterEqual(len(ref["members"]), 3)

    def test_cli_stays_queued_until_approved(self):
        req = svc.request_cli({"command_key": "list_debugger", "note": "list debugger files"})
        self.assertEqual(req["status"], "pending_approval")
        with self.assertRaises(ValueError):
            svc.run_cli(req["id"])
        svc.approve_cli(req["id"])
        ran = svc.run_cli(req["id"])
        self.assertEqual(ran["status"], "ran")

    def test_result_ref_on_token_swing(self):
        for _ in range(5):
            svc.record_score({"log_id": "warm", "score": 70, "token_cost": 100, "duration_s": 10})
        swing = svc.record_score({"log_id": "cheap", "score": 90, "token_cost": 20, "duration_s": 2, "project_id": "5bf8e783"})
        self.assertTrue(swing["result_ref"].startswith("res_"))


if __name__ == "__main__":
    unittest.main()
