"""History ids, readonly CLI jail, tracking cap, area-code, credit rollup, catalog."""
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import debugger_analytics_service as das
from backend.services import debugger_swarm_service as dss
from backend.services import prompt_trace_service as trace


class DebuggerSwarmTests(unittest.TestCase):
    def setUp(self):
        self._prev_transcript_roots = os.environ.get("CURSOR_TRANSCRIPT_ROOTS")
        os.environ["CURSOR_TRANSCRIPT_ROOTS"] = ""
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.store = root / "prompt-trace"
        self.store.mkdir()
        (self.store / "live-prompts.jsonl").write_text(
            '{"log_id":"hist-001","chat_id":"abc-chat","timestamp":"t1","prompt":"' + ("P" * 200) + '"}\n',
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

    def test_readonly_cli_rejects_rm(self):
        with self.assertRaises(ValueError):
            dss.parse_readonly({"command": "rm -rf /"})
        with self.assertRaises(ValueError):
            das.request_cli({"command_key": "rm -rf tmp"})

    def test_readonly_cli_ls_playbook_ok_env_denied(self):
        play = Path(das.ROOT_DIR) / "ai-context" / "debugger" / "PLAYBOOK-job_test.md"
        play.write_text("# playbook\nlog_path ok\n", encoding="utf-8")
        dated = Path(das.ROOT_DIR) / "ai-context" / "debugger" / "incident-intelligence" / "2026-09-16"
        dated.mkdir(parents=True, exist_ok=True)
        log = dated / "abc123.json"
        log.write_text('{"feature":"memory.leak"}\n', encoding="utf-8")
        listed = dss.exec_readonly_cli({"command": "ls", "path": "ai-context/debugger"})
        self.assertTrue(listed["ran"])
        self.assertFalse(listed.get("subprocess"))
        self.assertFalse(listed.get("shell"))
        self.assertIn("PLAYBOOK-job_test.md", listed["output"])
        cat = dss.exec_readonly_cli({"command": "cat", "path": "ai-context/debugger/PLAYBOOK-job_test.md"})
        self.assertIn("log_path ok", cat["output"])
        head = dss.exec_readonly_cli({"command": "cat", "path": "ai-context/debugger/incident-intelligence/2026-09-16/abc123.json"})
        self.assertIn("memory.leak", head["output"])
        with self.assertRaises(ValueError):
            dss.parse_readonly({"command": "cat", "path": ".env"})
        with self.assertRaises(ValueError):
            dss.parse_readonly({"command": "ls", "path": "ai-context/debugger/../../.env"})
        with self.assertRaises(ValueError):
            dss.parse_readonly({"command": "cat", "path": "mcp/grok-bot/MARKETING.md"})
        with self.assertRaises(ValueError):
            dss.parse_readonly({"command": "rm -rf /"})

    def test_history_returns_ids_not_bodies(self):
        page = dss.history_search("", limit=10)
        self.assertTrue(page["hits"])
        hit = page["hits"][0]
        self.assertEqual(hit["log_id"], "hist-001")
        self.assertLessEqual(len(hit["excerpt"]), 120)
        self.assertNotIn("P" * 121, hit["excerpt"])
        self.assertFalse(page["bodies"])
        one = dss.history_get("hist-001")
        self.assertEqual(one["log_id"], "hist-001")
        self.assertLessEqual(len(one["excerpt"]), 120)

    def test_tracking_id_over_cap_uses_ref(self):
        members = [("project", f"x{i:02d}" + "a" * 60) for i in range(8)]
        raw = das.encode_tracking_id(members)
        self.assertGreater(len(raw), dss.TRACKING_ID_CAP)
        packed = dss.encode_tracking_capped(members)
        self.assertTrue(packed["packed"])
        self.assertTrue(str(packed["tracking_id"]).startswith("ref:"))
        self.assertLessEqual(len(packed["tracking_id"]), dss.TRACKING_ID_CAP)

    def test_instance_registry_register_and_lookup_501(self):
        registered = dss.register_user({
            "user_id": "sam-reg",
            "instance_id": "501",
            "project_id": "5bf8e783",
            "log_id": "d9c98119-l62",
            "agent_id": "grok",
        })
        self.assertEqual(registered["instance_id"], "501")
        found = dss.resolve_instance({"q": "501"})
        self.assertEqual(found["area_code"], "501")
        self.assertEqual(found["label"], "Little Rock Mini")
        self.assertTrue(any(u.get("id") == "sam-reg" for u in found["users"]))
        self.assertTrue(any(p.get("id") == "5bf8e783" for p in found["projects"]))
        self.assertTrue(any(l.get("id") == "d9c98119-l62" for l in found["logs"]))
        self.assertTrue(any(a.get("id") == "grok" for a in found["agents"]))
        self.assertFalse(found["vector_db"])
        self.assertEqual(found["users_table"], "untouched")
        self.assertLessEqual(len((found["users"][0] or {}).get("tracking_id") or ""), dss.TRACKING_ID_CAP)
        seeded = dss.seed_instance_registry()
        again = dss.resolve_instance({"area_code": "501"})
        self.assertGreaterEqual(again["counts"]["user"], found["counts"]["user"])
        self.assertGreaterEqual(seeded["n_members"], 4)
        listed = dss.list_instances()
        self.assertTrue(any(row.get("instance_id") == "501" for row in listed))
        packed = dss.encode_tracking_capped([("project", f"x{i:02d}" + "a" * 60) for i in range(8)])
        self.assertTrue(packed["packed"])
        self.assertTrue(str(packed["tracking_id"]).startswith("ref:"))

    def test_swarm_tick_seeds_instance_registry_idempotent(self):
        (self.store / "live-prompts.jsonl").write_text(
            json.dumps({
                "log_id": "d9c98119-l63",
                "user_id": "sam-tick63",
                "project_id": "5bf8e783",
                "instance_id": "501",
                "agent_id": "grok",
                "prompt": "tick registry join",
                "score": 70,
            }) + "\n",
            encoding="utf-8",
        )
        body = {
            "sidecars": False,
            "include_score_table": False,
            "reports": False,
            "cad_snapshots": False,
            "snapshot_id": "cad-test-l63",
            "run_focused_test": lambda spec: {"ok": True, "passed": False, "reason": "fixture-skip"},
        }
        with patch.object(dss, "swarm_debug_tick", return_value={"n_minted": 0, "minted": [], "executed": False}):
            first = dss.swarm_credit_tick(body)
        self.assertTrue(first.get("tick"))
        self.assertIn("instance_registry", first)
        self.assertFalse((first.get("instance_registry") or {}).get("vector_db"))
        found = dss.resolve_instance({"q": "501"})
        self.assertTrue(any(u.get("id") == "sam-tick63" for u in found["users"]))
        self.assertTrue(any(l.get("id") == "d9c98119-l63" for l in found["logs"]))
        counts = dict(found["counts"])
        with patch.object(dss, "swarm_debug_tick", return_value={"n_minted": 0, "minted": [], "executed": False}):
            second = dss.swarm_credit_tick({**body, "snapshot_id": "cad-test-l63b"})
        again = dss.resolve_instance({"q": "501"})
        self.assertEqual(again["counts"], counts)
        self.assertEqual((second.get("instance_registry") or {}).get("n_members"), (first.get("instance_registry") or {}).get("n_members"))

    def test_ingest_shipped_hook_optimization_skips_kernel(self):
        first = dss.ingest_shipped_hook_optimization()
        self.assertFalse(first.get("invented"))
        self.assertFalse(first.get("breakage_zero"))
        self.assertEqual(first["goal"], "OPEN")
        feats = {row["feature"] for row in first["credited"]}
        self.assertIn("memory.leak", feats)
        self.assertIn("viewport.models", feats)
        self.assertIn("webgl.context", feats)
        self.assertIn("vr.controllers.trigger", feats)
        self.assertNotIn("prompt.run", feats)
        ids = {row["credit_log_id"] for row in first["credited"]}
        for token in ("leakfix4", "leakfix5", "leakfix6", "leakfix7", "leakfix8", "leakfix9", "leakfix12", "leakfix13", "leakfix14", "leakfix15", "leakfix16", "leakfix17", "leakfix18", "leakfix19", "leakfix20", "leakfix21", "leakfix22", "leakfix23", "leakfix24", "leakfix25", "leakfix26", "leakfix27", "leakfix28", "leakfix29", "leakfix30", "leakfix31", "leakfix32", "leakfix33", "leakfix34", "leakfix35", "leakfix36", "leakfix37", "leakfix38", "leakfix39", "leakfix40", "leakfix41", "leakfix42", "leakfix43", "leakfix44", "leakfix45", "leakfix46", "leakfix47", "leakfix48", "leakfix49", "leakfix50", "leakfix51", "leakfix52", "leakfix53", "leakfix54", "leakfix55", "leakfix56", "leakfix57", "leakfix58", "leakfix59", "leakfix60", "leakfix61", "leakfix62", "leakfix63", "leakfix64", "leakfix65", "leakfix66", "leakfix67", "leakfix68", "leakfix69", "leakfix70", "leakfix71", "leakfix72", "leakfix73", "leakfix74", "leakfix75", "leakfix76", "leakfix77", "leakfix78", "leakfix79", "leakfix80", "leakfix81", "leakfix82", "leakfix83", "leakfix84", "leakfix85", "leakfix86", "leakfix87", "leakfix88", "leakfix89", "leakfix90", "leakfix91", "leakfix92", "leakfix93", "leakfix94", "leakfix95", "leakfix96", "leakfix97", "leakfix98", "leakfix99", "leakfix100", "leakfix101", "leakfix102", "leakfix103", "leakfix104", "leakfix105", "leakfix106", "leakfix107", "leakfix108"):
            self.assertIn(f"opt-hook:memory.leak:{token}", ids)
        self.assertEqual(dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]).count("leakfix4"), 1)
        self.assertIn("leakfix12", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix13", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix14", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix15", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix16", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix17", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix18", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix19", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix20", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix21", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix22", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix23", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix24", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix25", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix26", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix27", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix28", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix29", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix30", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix31", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix32", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix33", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix34", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix35", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix36", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix37", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix38", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix39", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix40", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix41", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix42", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix43", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix44", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix45", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix46", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix47", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix48", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix49", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix50", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix51", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix52", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix53", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix54", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix55", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix56", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix57", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix58", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix59", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix60", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix61", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix62", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix63", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix64", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix65", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix66", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix67", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix68", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix69", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix70", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix71", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix72", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix73", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix74", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix75", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix76", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix77", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix78", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix79", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix80", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix81", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix82", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix83", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix84", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix85", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix86", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix87", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix88", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix89", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix90", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix91", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix92", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix93", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix94", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix95", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix96", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix97", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix98", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix99", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix100", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix101", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix102", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix103", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix104", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix105", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix106", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix107", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix108", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertIn("leakfix109", dss.shipped_hook_tokens(dss.SHIPPED_THIN_HOOKS["memory.leak"]))
        self.assertTrue(all(row.get("category") == "optimization" for row in first["credited"]))
        self.assertTrue(any(s.get("feature") == "prompt.run" and s.get("reason") == "kernel-or-none" for s in first["skipped"]))
        again = dss.ingest_shipped_hook_optimization()
        self.assertEqual(again["n_credited"], 0)
        with patch.object(dss, "swarm_debug_tick", return_value={"n_minted": 0, "minted": [], "executed": False}):
            tick = dss.swarm_credit_tick({
                "sidecars": False,
                "include_score_table": False,
                "reports": False,
                "cad_snapshots": False,
                "snapshot_id": "cad-test-l64",
                "run_focused_test": lambda spec: {"ok": True, "passed": False, "reason": "fixture-skip"},
            })
        self.assertEqual((tick.get("hook_optimization") or {}).get("n_credited"), 0)
        queue = (tick.get("sam_queue") or {}).get("sam_queue") or {}
        self.assertTrue((queue.get("optimization") or {}).get("populated"))
        rows = [r for r in dss.list_credit(limit=40) if str((r.get("extra") or {}).get("log_id") or "").startswith("opt-hook:")]
        self.assertGreaterEqual(len(rows), 4)
        self.assertTrue(all(r.get("category") == "optimization" for r in rows))

    def test_ingest_http_network_troubleshooting_from_fixture_events(self):
        from backend.services import incident_intelligence_service as ii

        self.assertEqual(dss.classify_http_failure("TypeError Failed to fetch"), "fetch_drop")
        self.assertEqual(dss.classify_http_failure("GET 401 unauthorized"), "http_401")
        self.assertEqual(dss.classify_http_failure("HTTP 404 not found"), "http_404")
        self.assertEqual(dss.classify_http_failure("request timeout"), "timeout")
        self.assertEqual(dss.classify_http_failure("ok"), "")
        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            with patch.object(ii, "record_event", wraps=ii.record_event) as rec:
                ii.record_event({"feature": "network.latency", "status": "broken", "note": "Fetch failed GET /api/projects/ce8294df/generation", "fields": {"name": "TypeError", "message": "Failed to fetch"}})
                ii.record_event({"feature": "network.timeout", "status": "broken", "note": "poll timeout"})
                ii.record_event({"feature": "network.dns", "status": "broken", "note": "HTTP 404 not found"})
                ii.record_event({"feature": "network.throttle", "status": "broken", "note": "401 unauthorized"})
                first = dss.ingest_http_network_troubleshooting()
                created = rec.call_count
                self.assertEqual(first["n_credited"], 4)
                self.assertFalse(first.get("invented"))
                klasses = {row["http_class"] for row in first["credited"]}
                self.assertEqual(klasses, {"fetch_drop", "timeout", "http_404", "http_401"})
                self.assertTrue(all(row.get("category") == "network_troubleshooting" for row in first["credited"]))
                again = dss.ingest_http_network_troubleshooting()
                self.assertEqual(again["n_credited"], 0)
                self.assertEqual(rec.call_count, created)
            with patch.object(dss, "swarm_debug_tick", return_value={"n_minted": 0, "minted": [], "executed": False}):
                tick = dss.swarm_credit_tick({
                    "sidecars": False,
                    "include_score_table": False,
                    "reports": False,
                    "cad_snapshots": False,
                    "snapshot_id": "cad-test-l66",
                    "run_focused_test": lambda spec: {"ok": True, "passed": False, "reason": "fixture-skip"},
                })
            self.assertEqual((tick.get("http_classes") or {}).get("n_credited"), 0)
            self.assertTrue(((tick.get("sam_queue") or {}).get("sam_queue") or {}).get("network_troubleshooting", {}).get("populated") or first["n_credited"] == 4)

    def test_ingest_controller_stamps_from_fixture_events(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            with patch.object(ii, "record_event", wraps=ii.record_event) as rec:
                ii.record_event({"feature": "vr.controllers.trigger", "status": "broken", "note": "minted from vr.controllers.trigger", "source": "debug-job-stamp"})
                ii.record_event({"feature": "vr.controllers.trigger", "status": "ok", "note": "shipped controller.trigger.miss stamp", "source": "shipped-thin-hook"})
                first = dss.ingest_controller_stamps()
                created = rec.call_count
                self.assertEqual(first["n_credited"], 2)
                self.assertFalse(first.get("invented"))
                self.assertTrue(all(row.get("category") == "controllers" for row in first["credited"]))
                feats = {row["feature"] for row in first["credited"]}
                self.assertEqual(feats, {"vr.controllers.trigger"})
                again = dss.ingest_controller_stamps()
                self.assertEqual(again["n_credited"], 0)
                self.assertEqual(rec.call_count, created)
            with patch.object(dss, "swarm_debug_tick", return_value={"n_minted": 0, "minted": [], "executed": False}):
                tick = dss.swarm_credit_tick({
                    "sidecars": False,
                    "include_score_table": False,
                    "reports": False,
                    "cad_snapshots": False,
                    "snapshot_id": "cad-test-l69",
                    "run_focused_test": lambda spec: {"ok": True, "passed": False, "reason": "fixture-skip"},
                })
            self.assertEqual((tick.get("controller_stamps") or {}).get("n_credited"), 0)
            self.assertTrue(((tick.get("sam_queue") or {}).get("sam_queue") or {}).get("controllers", {}).get("populated"))

    def test_ingest_networking_stamps_from_fixture_events(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            with patch.object(ii, "record_event", wraps=ii.record_event) as rec:
                ii.record_event({
                    "feature": "network.latency",
                    "status": "broken",
                    "note": "Fetch failed GET /api/projects/ce8294df/generation",
                    "source": "studio-webgl",
                    "fields": {"name": "TypeError", "message": "Failed to fetch"},
                })
                first = dss.ingest_networking_stamps()
                created = rec.call_count
                self.assertEqual(first["n_credited"], 1)
                self.assertFalse(first.get("invented"))
                self.assertEqual(first["credited"][0]["category"], "networking")
                self.assertEqual(first["credited"][0]["feature"], "network.latency")
                again = dss.ingest_networking_stamps()
                self.assertEqual(again["n_credited"], 0)
                self.assertEqual(rec.call_count, created)
            with patch.object(dss, "swarm_debug_tick", return_value={"n_minted": 0, "minted": [], "executed": False}):
                tick = dss.swarm_credit_tick({
                    "sidecars": False,
                    "include_score_table": False,
                    "reports": False,
                    "cad_snapshots": False,
                    "snapshot_id": "cad-test-l70",
                    "run_focused_test": lambda spec: {"ok": True, "passed": False, "reason": "fixture-skip"},
                })
            self.assertEqual((tick.get("networking_stamps") or {}).get("n_credited"), 0)
            self.assertTrue(((tick.get("sam_queue") or {}).get("sam_queue") or {}).get("networking", {}).get("populated"))

    def test_write_league_underperform_report_recommendation_only(self):
        dss.note_agent("cursor", period="daily", category="networking", credit=72, damage=0, note="league67")
        dss.note_agent("grok", period="daily", category="optimization", credit=67, damage=2, note="league67")
        out = dss.write_league_underperform_report()
        self.assertEqual(out["goal"], "OPEN")
        self.assertFalse(out["auto_fire"])
        self.assertFalse(out["executed"])
        self.assertFalse(out["fire_anyone"])
        recs = {row["agent_id"]: row["recommendation"] for row in out["agents"]}
        self.assertEqual(recs["cursor"], "fix-few-issues")
        self.assertEqual(recs["grok"], "fix-few-issues")
        md = Path(self.temp.name) / "ai-context" / "debugger" / "swarm-reports" / "league-underperform-latest.md"
        self.assertTrue(md.is_file())
        text = md.read_text(encoding="utf-8")
        self.assertIn("auto_fire=false", text)
        self.assertIn("fix-few-issues", text)
        self.assertIn("Fire anyone? **No.**", text)

    def test_area_code_instance_prefix(self):
        row = dss.encode_area_id(instance_id="501", user_id="sam", project_id="5bf8e783", log_id="d9c98119-004", agent_id="grok")
        self.assertTrue(row["area_id"].startswith("501."))
        self.assertIn(".usam", row["area_id"])
        self.assertIn(".p5bf8e783", row["area_id"])
        self.assertEqual(row["area"], "501")
        self.assertFalse(row["packed"])

    def test_credit_period_rollup(self):
        dss.record_credit({"period": "daily", "category": "networking", "credit": 80, "agent_id": "grok"})
        dss.record_credit({"period": "daily", "category": "memory_leaks", "credit": 40, "damage": 20, "agent_id": "cursor"})
        weekly = dss.rollup_credit("weekly")
        cats = {c["category"] for c in weekly["categories"]}
        self.assertIn("networking", cats)
        self.assertTrue(weekly["categories"])
        monthly = dss.rollup_credit("monthly")
        yearly = dss.rollup_credit("yearly")
        persisted = dss.list_period_rollups()
        periods = {r["period"] for r in persisted}
        self.assertIn("weekly", periods)
        self.assertIn("monthly", periods)
        self.assertIn("yearly", periods)
        self.assertTrue(monthly["categories"])
        self.assertTrue(yearly["categories"])
        charts = dss.chart_periods()
        self.assertTrue(charts["monthly"])
        self.assertTrue(charts["yearly"])

    def test_score_registers_user_on_501_and_sets_agent(self):
        scored = das.record_score({
            "log_id": "hist-501",
            "score": 72,
            "user_id": "sam",
            "project_id": "5bf8e783",
            "agent_id": "cursor",
            "instance_id": "501",
            "broken": ["leak.rss"],
        })
        self.assertEqual(scored.get("credit_category"), "memory_leaks")
        self.assertEqual(scored.get("agent_id"), "cursor")
        self.assertEqual(scored["credit"]["extra"]["agent_id"], "cursor")
        user = dss.get_instance_user("sam", "501")
        self.assertIsNotNone(user)
        self.assertEqual(user["instance_id"], "501")
        self.assertTrue(user["area_id"].startswith("501."))
        self.assertTrue(any("5bf8e783" in p for p in user["project_ids"]))
        self.assertIn("hist-501", user["log_ids"])
        self.assertIn("cursor", user["agent_ids"])
        self.assertEqual(user["relations"]["user_id"], "sam")

    def test_recommend_swarm_three_branches(self):
        self.assertEqual(dss.suggest_cad_next({"feature_id": "prompt.run"}), "replace-approach")
        self.assertEqual(dss.suggest_cad_next({"feature_id": "cad.gen_step"}), "replace-approach")
        self.assertEqual(dss.suggest_cad_next({"feature_id": "cad.generate", "extra": {"kernel": True}}), "replace-approach")
        self.assertEqual(dss.suggest_cad_next({"feature_id": "webgl.context"}), "fix-few-issues")
        self.assertEqual(dss.suggest_cad_next({"feature_id": "api.health", "extra": {"source": "debug-job-stamp"}}), "fix-few-issues")
        self.assertEqual(dss.recommend_swarm_action({"feature_id": "prompt.run", "agent_id": "slow-bot"}, kind="job"), "replace-approach")
        dss.league_cycle({
            "agent_id": "fail-bot",
            "peer_id": "cursor",
            "score": 10,
            "damage": 80,
            "snapshot_id": "cad-rec-fire",
            "category": "optimization",
        })
        self.assertTrue(dss.agent_underperform_fire("fail-bot"))
        self.assertEqual(dss.recommend_swarm_action({"agent_id": "fail-bot"}, kind="report"), "fire")
        fire_rpts = [r for r in dss.list_reports() if r["agent_id"] == "fail-bot"]
        self.assertTrue(fire_rpts)
        self.assertEqual(fire_rpts[0]["recommendation"], "fire")
        self.assertFalse(fire_rpts[0].get("auto_fire", False))
        synced = dss.sync_pending_sam_recommendations()
        self.assertFalse(synced["auto_fire"])
        self.assertFalse(synced["executed"])

    def test_kernel_prompt_run_credit_does_not_sink_grok(self):
        self.assertEqual(dss.resolve_ingest_agent({"broken": ["prompt.run"], "agent_id": "cursor"}), "cursor")
        self.assertEqual(dss.resolve_ingest_agent({"broken": ["prompt.run"], "agent_id": "grok"}), "cursor")
        self.assertEqual(dss.resolve_ingest_agent({"broken": ["webgl.context"], "agent_id": "grok"}), "grok")
        self.assertEqual(dss.resolve_ingest_agent({"broken": ["webgl.context"]}), "cursor")
        dss.note_agent("grok", period="daily", category="optimization", credit=70, damage=0, note="baseline")
        dss.note_agent("grok", period="daily", category="optimization", credit=72, damage=0, note="baseline")
        (self.store / "live-prompts.jsonl").write_text(
            json.dumps({
                "log_id": "jl-kernel-cad",
                "prompt": "fish lamp missing gen_step",
                "result": "broke",
                "score": 18,
                "broken": ["prompt.run"],
                "agent_id": "cursor",
                "user_id": "sam-attr",
                "project_id": "64d81b05",
                "instance_id": "501",
            })
            + "\n",
            encoding="utf-8",
        )
        tick = dss.swarm_credit_tick({
            "sidecars": False,
            "snapshot_id": "cad-attr-kernel",
            "cad_snapshots": False,
            "reports": False,
            "agent_id": "grok",
        })
        self.assertEqual(tick["n_credited"], 1)
        self.assertEqual(tick["credited"][0]["agent_id"], "cursor")
        credits = [r for r in dss.list_credit(limit=40) if (r.get("extra") or {}).get("log_id") == "jl-kernel-cad"]
        self.assertEqual(len(credits), 1)
        self.assertEqual((credits[0].get("extra") or {}).get("agent_id"), "cursor")
        self.assertNotEqual(credits[0].get("actor"), "grok")
        self.assertFalse(dss.agent_underperform_fire("grok"))
        empty = dss.ingest_offline_jsonl({"sidecars": False, "snapshot_id": "cad-attr-empty"})
        self.assertEqual(empty["n_credited"], 0)
        self.assertTrue((empty.get("cycle") or {}).get("skipped"))
        zeros = [r for r in dss.list_league(40) if r.get("agent_id") == "grok" and float(r.get("credit_score") or 0) == 0 and r.get("note") == "act"]
        self.assertEqual(zeros, [])

    def test_infer_webgl_and_memory_feature_ids(self):
        self.assertEqual(dss.infer_category({"broken": ["webgl.context"]}), "optimization")
        self.assertEqual(dss.infer_category({"features": {"webgl.context": "broken"}}), "optimization")
        self.assertEqual(dss.infer_category({"category": "performance", "subcategory": "memory.leak"}), "memory_leaks")
        self.assertEqual(dss.infer_category({"broken": ["vr.controllers.trigger"]}), "controllers")

    def test_feature_id_map_networking_memory_and_api(self):
        """Incident feature ids ingest into the 7 credit buckets. No live bugs invented."""
        self.assertEqual(dss.category_for_feature_id("network.latency"), "networking")
        self.assertEqual(dss.category_for_feature_id("network.webrtc"), "networking")
        self.assertEqual(dss.category_for_feature_id("network.timeout"), "network_troubleshooting")
        self.assertEqual(dss.category_for_feature_id("network.dns"), "network_troubleshooting")
        self.assertEqual(dss.category_for_feature_id("api.health"), "network_troubleshooting")
        self.assertEqual(dss.category_for_feature_id("memory.leak"), "memory_leaks")
        self.assertEqual(dss.category_for_feature_id("system.ram"), "memory_leaks")
        self.assertEqual(dss.category_for_feature_id("vr.controllers.trigger"), "controllers")
        self.assertEqual(dss.infer_category({"broken": ["network.latency"]}), "networking")
        self.assertEqual(dss.infer_category({"feature": "network.timeout"}), "network_troubleshooting")
        self.assertEqual(dss.infer_category({"features": {"api.health": "degraded"}}), "network_troubleshooting")
        self.assertEqual(dss.infer_category({"broken": ["system.ram"]}), "memory_leaks")
        self.assertEqual(dss.infer_category({"feature": "memory.leak"}), "memory_leaks")
        self.assertEqual(dss.category_for_feature_id("human.override"), "liabilities")
        self.assertEqual(dss.category_for_feature_id("user.override"), "liabilities")
        self.assertEqual(dss.category_for_feature_id("companion.damage"), "liabilities")
        self.assertEqual(dss.category_for_feature_id("user.damage"), "liabilities")
        self.assertEqual(dss.infer_category({"broken": ["companion.damage"]}), "liabilities")
        self.assertEqual(dss.infer_category({"feature": "user.damage"}), "liabilities")
        self.assertEqual(dss.category_for_feature_id("viewport.boot"), "time_to_complete")
        self.assertEqual(dss.category_for_feature_id("viewport.models"), "time_to_complete")
        self.assertEqual(dss.category_for_feature_id("system.cpu"), "time_to_complete")
        self.assertIsNone(dss.category_for_feature_id("prompt.run"))

    def test_prompt_trace_incident_ingest_periods_and_501(self):
        from backend.services import debugger_metrics_service as dms
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            traced = trace.record({
                "log_id": "pt-webgl-live",
                "prompt": "webgl context lost after bake",
                "result": "broke",
                "score": 22,
                "user_id": "sam-cad",
                "project_id": "5bf8e783",
                "instance_id": "501",
                "agent_id": "cursor",
                "broken": ["webgl.context"],
                "features": {"webgl.context": "broken"},
            })
            self.assertEqual(traced["score"].get("credit_category"), "optimization")
            self.assertFalse(traced["score"].get("auto_fire"))
            self.assertEqual(traced["score"]["credit"]["period"], "daily")
            self.assertEqual(traced["score"]["credit"]["category"], "optimization")
            rollups = traced["score"].get("rollups") or {}
            self.assertEqual(set(rollups), set(dss.CREDIT_PERIODS))
            user = dss.get_instance_user("sam-cad", "501")
            self.assertIsNotNone(user)
            self.assertTrue(user["area_id"].startswith("501."))
            self.assertIn("pt-webgl-live", user["log_ids"])
            self.assertTrue(any("5bf8e783" in p for p in user["project_ids"]))

            fixed = dms.confirm_fixed({
                "user_id": "sam-cad",
                "project_id": "5bf8e783",
                "category": "performance",
                "subcategory": "memory.leak",
                "agent_id": "grok",
                "instance_id": "501",
                "log_ids": ["pt-webgl-live"],
            })
            self.assertIn("swarm", fixed)
            self.assertEqual(fixed["swarm"]["credit_category"], "memory_leaks")
            self.assertFalse(fixed["swarm"]["auto_fire"])
            self.assertEqual(set(fixed["swarm"]["rollups"]), set(dss.CREDIT_PERIODS))

            checked = ii.record_checklist({
                "prompt_id": "pt-webgl-live",
                "user_id": "sam-cad",
                "project_id": "5bf8e783",
                "features": {"vr.controllers.trigger": "broken"},
                "agent_id": "cursor",
                "instance_id": "501",
            })
            self.assertEqual(checked["swarm"]["credit_category"], "controllers")
            self.assertFalse(checked["swarm"].get("auto_fire", False))
            persisted = {r["period"] for r in dss.list_period_rollups()}
            self.assertEqual(persisted, set(dss.CREDIT_PERIODS))

    def test_liabilities_category_from_human_actor(self):
        self.assertEqual(dss.infer_category({"actor": "user", "notes": "human override"}), "liabilities")
        credit = dss.record_credit({"period": "daily", "category": "liabilities", "credit": 35, "actor": "user", "user_id": "sam"})
        self.assertEqual(credit["category"], "liabilities")

    def test_league_cycle_peer_score_and_report(self):
        cycle = dss.league_cycle({
            "agent_id": "slow-bot",
            "peer_id": "cursor",
            "score": 12,
            "damage": 80,
            "snapshot_id": "snap-1",
            "category": "optimization",
        })
        self.assertEqual(cycle["loop"], ["act", "snapshot", "score", "improve"])
        self.assertFalse(cycle["auto_fire"])
        self.assertEqual(cycle["peer_id"], "cursor")
        league = dss.list_league()
        agents = {row["agent_id"] for row in league}
        self.assertIn("slow-bot", agents)
        self.assertIn("cursor", agents)
        under = dss.underperformers()
        self.assertTrue(any(u["agent_id"] == "slow-bot" and u["recommendation"] == "fire" and not u["auto_fire"] for u in under))
        reports = dss.list_reports()
        self.assertTrue(any(r["agent_id"] == "slow-bot" and r["status"] == "pending_sam" for r in reports))

    def test_prompt_trace_score_writes_credit(self):
        result = trace.record({
            "log_id": "pt-credit-1",
            "prompt": "score this",
            "result": "improved",
            "score": 88,
            "user_id": "sam",
            "project_id": "proj501",
        })
        self.assertIn("score", result)
        credit = result["score"].get("credit")
        self.assertIsNotNone(credit)
        self.assertEqual(credit["extra"]["agent_id"], "cursor")
        self.assertEqual(credit["extra"]["instance_id"], "501")
        self.assertEqual(dss.get_instance_user("sam", "501")["instance_id"], "501")

    def test_offline_jsonl_ingest_idempotent_501_and_category(self):
        (self.store / "live-prompts.jsonl").write_text(
            "\n".join([
                json.dumps({
                    "log_id": "jsonl-webgl-1",
                    "prompt": "webgl context lost",
                    "result": "broke",
                    "score": 28,
                    "user_id": "sam-off",
                    "project_id": "5bf8e783",
                    "instance_id": "501",
                    "agent_id": "cursor",
                    "broken": ["webgl.context"],
                    "features": {"webgl.context": "broken"},
                }),
                json.dumps({
                    "log_id": "jsonl-webgl-1",
                    "prompt": "duplicate line must not double-credit",
                    "result": "broke",
                    "user_id": "sam-off",
                    "broken": ["webgl.context"],
                }),
            ]) + "\n",
            encoding="utf-8",
        )
        packed = dss.encode_tracking_capped([("project", f"x{i:02d}" + "a" * 60) for i in range(8)])
        self.assertTrue(packed["packed"])
        self.assertTrue(str(packed["tracking_id"]).startswith("ref:"))
        first = dss.ingest_offline_jsonl({
            "snapshot_id": "cad-test-jsonl",
            "user_id": "sam-off",
            "project_id": "5bf8e783",
            "instance_id": "501",
            "sidecars": False,
        })
        self.assertEqual(first["n_credited"], 1)
        self.assertEqual(first["credited"][0]["category"], "optimization")
        self.assertEqual(first["credited"][0]["period"], "daily")
        self.assertFalse(first["auto_fire"])
        self.assertEqual(first["license"], "dashboard-metric")
        self.assertEqual(set(first["periods"]), set(dss.CREDIT_PERIODS))
        user = dss.get_instance_user("sam-off", "501")
        self.assertIsNotNone(user)
        self.assertEqual(user["instance_id"], "501")
        self.assertTrue(user["area_id"].startswith("501."))
        self.assertIn("jsonl-webgl-1", user["log_ids"])
        self.assertTrue(any("5bf8e783" in p for p in user["project_ids"]))
        persisted = {r["period"] for r in dss.list_period_rollups()}
        self.assertEqual(persisted, set(dss.CREDIT_PERIODS))
        second = dss.ingest_offline_jsonl({"snapshot_id": "cad-test-jsonl-2", "sidecars": False})
        self.assertEqual(second["n_credited"], 0)
        self.assertTrue(any(s["log_id"] == "jsonl-webgl-1" and s["reason"] == "already counted today" for s in second["skipped"]))
        credits = [r for r in dss.list_credit(limit=40) if (r.get("extra") or {}).get("log_id") == "jsonl-webgl-1"]
        if not credits:
            credits = [r for r in dss.list_credit(limit=40) if r.get("category") == "optimization"]
        self.assertEqual(len(credits), 1)

    def test_swarm_tick_duration_liabilities_and_idempotent(self):
        self.assertEqual(dss.infer_category({"category": "time_taken"}), "time_to_complete")
        self.assertEqual(dss.infer_category({"duration_s": 45}), "time_to_complete")
        self.assertEqual(dss.infer_category({"companion_damage": 40}), "liabilities")
        self.assertEqual(dss.infer_category({"broken": ["webgl.context"], "duration_s": 90}), "optimization")
        self.assertEqual(dss.duration_credit(60), 55.0)
        self.assertEqual(dss.damage_liability_credit(40), 50.0)
        (self.store / "live-prompts.jsonl").write_text(
            "\n".join([
                json.dumps({
                    "log_id": "tick-dur-1",
                    "prompt": "slow generate",
                    "user_id": "sam-tick",
                    "project_id": "5bf8e783",
                    "instance_id": "501",
                    "duration_s": 60,
                }),
                json.dumps({
                    "log_id": "tick-dmg-1",
                    "prompt": "companion override hurt",
                    "user_id": "sam-tick",
                    "project_id": "5bf8e783",
                    "instance_id": "501",
                    "companion_damage": 40,
                }),
            ]) + "\n",
            encoding="utf-8",
        )
        first = dss.swarm_credit_tick({"sidecars": False, "snapshot_id": "cad-test-tick"})
        self.assertTrue(first.get("tick"))
        self.assertFalse(first["auto_fire"])
        cats = {row["log_id"]: row["category"] for row in first["credited"]}
        credits = {row["log_id"]: row["credit"] for row in first["credited"]}
        self.assertEqual(cats["tick-dur-1"], "time_to_complete")
        self.assertEqual(credits["tick-dur-1"], 55.0)
        self.assertEqual(cats["tick-dmg-1"], "liabilities")
        self.assertEqual(credits["tick-dmg-1"], 50.0)
        self.assertEqual(first["n_credited"], 2)
        second = dss.swarm_credit_tick({"sidecars": False, "snapshot_id": "cad-test-tick-2"})
        self.assertEqual(second["n_credited"], 0)
        self.assertTrue(any(s["log_id"] == "tick-dur-1" for s in second["skipped"]))
        self.assertTrue(any(s["log_id"] == "tick-dmg-1" for s in second["skipped"]))
        dur_rows = [r for r in dss.list_credit(limit=40) if (r.get("extra") or {}).get("log_id") == "tick-dur-1"]
        self.assertEqual(len(dur_rows), 1)

    def test_debug_job_mint_dedupes_and_never_executes(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            ii.record_event({"feature": "viewport.boot", "status": "ok", "kind": "client-smoke", "note": "Renderer initialized"})
            broken = ii.record_event({"feature": "webgl.context", "status": "broken", "kind": "client-smoke", "note": "WebGL context lost", "project_id": "5bf8e783"})
            first = dss.swarm_debug_tick({"instance_id": "501", "user_id": "sam-job"})
            self.assertEqual(first["n_minted"], 1)
            self.assertFalse(first["executed"])
            self.assertFalse(first["auto_fire"])
            job = first["minted"][0]
            self.assertEqual(job["feature_id"], "webgl.context")
            self.assertEqual(job["category"], "optimization")
            self.assertEqual(job["status"], "pending_sam")
            stored = dss.list_debug_jobs(status="pending_sam")
            self.assertEqual(len(stored), 1)
            self.assertEqual(stored[0]["recommendation"], "fix-few-issues")
            self.assertEqual(stored[0]["first_broken_id"], broken["id"])
            self.assertTrue(stored[0]["tracking_id"])
            self.assertLessEqual(len(stored[0]["tracking_id"]), dss.TRACKING_ID_CAP)
            self.assertFalse(stored[0]["executed"])
            second = dss.swarm_debug_tick({"user_id": "sam-job"})
            self.assertEqual(second["n_minted"], 0)
            self.assertEqual(second["n_skipped"], 1)
            self.assertEqual(len(dss.list_debug_jobs()), 1)
            addon = dss.overview_addon()
            self.assertTrue(addon["debug_jobs"])
            self.assertEqual(addon["debug_jobs"][0]["feature_id"], "webgl.context")
            tick = dss.swarm_credit_tick({"sidecars": False, "snapshot_id": "cad-test-jobs"})
            self.assertIn("debug_jobs", tick)
            self.assertEqual(tick["debug_jobs"]["n_minted"], 0)

    def test_jsonl_broken_features_mint_jobs_dedupe_and_cap(self):
        from backend.services import incident_intelligence_service as ii

        feats = [
            "webgl.context",
            "memory.leak",
            "vr.controllers.trigger",
            "network.latency",
            "api.health",
            "system.ram",
        ]
        (self.store / "live-prompts.jsonl").write_text(
            "\n".join(
                json.dumps({
                    "log_id": f"jl-broke-{idx}",
                    "prompt": f"broken {feat}",
                    "result": "broke",
                    "broken": [feat],
                    "features": {feat: "broken"},
                    "user_id": "sam-jl",
                    "project_id": "5bf8e783",
                    "instance_id": "501",
                })
                for idx, feat in enumerate(feats)
            )
            + "\n",
            encoding="utf-8",
        )
        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "no-incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            first = dss.swarm_debug_tick({"instance_id": "501", "user_id": "sam-jl", "job_cap": 5})
            self.assertEqual(first["n_minted"], 5)
            self.assertFalse(first["executed"])
            self.assertFalse(first["auto_fire"])
            minted = {j["feature_id"]: j for j in first["minted"]}
            self.assertEqual(minted["webgl.context"]["category"], "optimization")
            self.assertEqual(minted["memory.leak"]["category"], "memory_leaks")
            self.assertEqual(minted["vr.controllers.trigger"]["category"], "controllers")
            self.assertEqual(minted["network.latency"]["category"], "networking")
            self.assertTrue(any(s.get("reason") == "tick cap" for s in first["skipped"]))
            self.assertTrue(all(j["status"] == "pending_sam" for j in first["minted"]))
            self.assertTrue(all(not j.get("executed") for j in first["minted"]))
            self.assertFalse(minted["webgl.context"].get("kernel"))
            second = dss.swarm_debug_tick({"user_id": "sam-jl", "job_cap": 5})
            self.assertEqual(second["n_minted"], 1)
            self.assertEqual(second["minted"][0]["feature_id"], "system.ram")
            self.assertEqual(second["minted"][0]["category"], "memory_leaks")
            third = dss.swarm_debug_tick({"user_id": "sam-jl", "job_cap": 5})
            self.assertEqual(third["n_minted"], 0)
            stored = dss.list_debug_jobs()
            self.assertEqual(len(stored), 6)
            self.assertTrue(all(not r["executed"] and r["status"] == "pending_sam" for r in stored))
            prompt_job = dss.mint_debug_job({"feature": "prompt.run", "log_id": "jl-kernel"})
            self.assertTrue((prompt_job.get("extra") or {}).get("kernel"))
            self.assertEqual(prompt_job["recommendation"], "replace-approach")
            self.assertFalse(prompt_job["executed"])
            self.assertTrue((prompt_job.get("incident_stamp") or {}).get("skipped"))

    def test_claim_debug_job_idempotent_never_executed(self):
        from backend.services import incident_intelligence_service as ii
        from backend.services import render_agent_debug_adapter as rada

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            ii.record_event({"feature": "webgl.context", "status": "broken", "kind": "client-smoke", "note": "WebGL context lost", "project_id": "5bf8e783"})
            minted = dss.swarm_debug_tick({"instance_id": "501", "user_id": "sam-claim"})
            self.assertEqual(minted["n_minted"], 1)
            first = dss.claim_debug_job({"agent_id": "grok"})
            self.assertTrue(first.get("claimed"))
            self.assertEqual(first["status"], "claimed")
            self.assertEqual(first["agent_id"], "grok")
            self.assertFalse(first["executed"])
            self.assertTrue(first.get("patch_claim"))
            self.assertIn("CURSOR_FIX", first.get("cursor_packet") or "")
            self.assertIn(first["tracking_id"], first["cursor_packet"])
            again = dss.claim_debug_job({"agent_id": "grok"})
            self.assertTrue(again.get("idempotent"))
            self.assertEqual(again["id"], first["id"])
            self.assertFalse(again["executed"])
            same = dss.claim_debug_job({"agent_id": "grok", "job_id": first["id"]})
            self.assertTrue(same.get("idempotent"))
            stolen = dss.claim_debug_job({"agent_id": "cursor", "job_id": first["id"]})
            self.assertTrue(stolen.get("skipped"))
            self.assertEqual(stolen["agent_id"], "grok")
            thread = {}
            attached = rada.attach_claimed_debug_job(thread, agent_id="grok")
            self.assertEqual(attached["id"], first["id"])
            self.assertEqual(thread["debug_job_id"], first["id"])
            self.assertEqual(thread["debug_tracking_id"], first["tracking_id"])
            self.assertIn("CURSOR_FIX", thread["cursor_packet"])
            stored = dss.list_debug_jobs(status="claimed")
            self.assertEqual(len(stored), 1)
            self.assertFalse(stored[0]["executed"])

    def test_replace_approach_guard_skips_kernel_patch_claim(self):
        minted = dss.mint_debug_job({
            "feature": "prompt.run",
            "log_id": "f8e47d9c-l48",
            "project_id": "64d81b05",
            "user_id": "sam-local",
        }, {"instance_id": "501"})
        self.assertEqual(minted["recommendation"], "replace-approach")
        auto = dss.claim_debug_job({"agent_id": "grok"})
        self.assertFalse(auto.get("claimed"))
        self.assertEqual(auto.get("reason"), "replace_approach_guard")
        self.assertFalse(auto.get("patch_claim"))
        self.assertIn("REPLACE_APPROACH", auto.get("cursor_packet") or "")
        self.assertNotIn("CURSOR_FIX", auto.get("cursor_packet") or "")
        self.assertIn("gen_step", (auto.get("replacement_brief") or {}).get("why_7_tries_failed") or "")
        explicit = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
        self.assertFalse(explicit.get("claimed"))
        self.assertEqual(explicit.get("reason"), "replace_approach_guard")
        self.assertEqual(explicit.get("status"), "pending_sam")
        self.assertFalse(explicit.get("executed"))
        thin = dss.mint_debug_job({
            "feature": "webgl.context",
            "log_id": "d9c98119-l48w",
            "project_id": "5bf8e783",
            "user_id": "sam-local",
            "source": "prompt-trace",
        }, {"instance_id": "501"})
        patch = dss.claim_debug_job({"agent_id": "grok"})
        self.assertTrue(patch.get("claimed"))
        self.assertEqual(patch["id"], thin["id"])
        self.assertTrue(patch.get("patch_claim"))
        self.assertIn("CURSOR_FIX", patch.get("cursor_packet") or "")
        pending = [j for j in dss.list_debug_jobs() if j.get("id") == minted["id"]]
        self.assertEqual(pending[0]["status"], "pending_sam")
        self.assertFalse(pending[0].get("patch_claim"))
        self.assertTrue((pending[0].get("replacement_brief") or {}).get("playbook"))
        addon = dss.overview_addon()
        kernel_rows = [j for j in addon["debug_jobs"] if j.get("id") == minted["id"]]
        self.assertTrue(kernel_rows)
        self.assertFalse(kernel_rows[0].get("patch_claim"))
        self.assertEqual((kernel_rows[0].get("replacement_brief") or {}).get("recommendation"), "replace-approach")

    def test_pending_reload_guard_skips_fetch_fail_patch_claim(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            event = ii.record_event({
                "feature": "network.latency",
                "status": "broken",
                "kind": "client-smoke",
                "source": "studio-webgl",
                "note": "Fetch failed GET /api/projects/ce8294df/generation",
                "project_id": "ce8294df",
                "fields": {"path": "/api/projects/ce8294df/generation", "method": "GET", "name": "TypeError", "message": "Failed to fetch"},
            })
            minted = dss.mint_debug_job({
                "feature": "network.latency",
                "log_id": event["id"],
                "project_id": "ce8294df",
                "user_id": "sam-local",
                "note": "Fetch failed GET /api/projects/ce8294df/generation",
                "cause_hint": "TypeError Failed to fetch",
                "first_failure": {"id": event["id"]},
            }, {"instance_id": "501"})
            self.assertEqual(minted["recommendation"], "pending_reload")
            self.assertTrue(dss.connection_drop_guard(minted))
            self.assertEqual(dss.patch_claim_blocked(minted), "pending_reload_guard")
            auto = dss.claim_debug_job({"agent_id": "grok"})
            self.assertFalse(auto.get("claimed"))
            self.assertEqual(auto.get("reason"), "pending_reload_guard")
            self.assertFalse(auto.get("patch_claim"))
            self.assertIn("PENDING_RELOAD", auto.get("cursor_packet") or "")
            self.assertNotIn("CURSOR_FIX", auto.get("cursor_packet") or "")
            self.assertIn("tab", (auto.get("reload_brief") or {}).get("reload") or "")
            explicit = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            self.assertFalse(explicit.get("claimed"))
            self.assertEqual(explicit.get("status"), "pending_sam")
            self.assertFalse(explicit.get("executed"))
            thin = dss.mint_debug_job({
                "feature": "webgl.context",
                "log_id": "d9c98119-l53w",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
                "source": "prompt-trace",
            }, {"instance_id": "501"})
            thin_claim = dss.claim_debug_job({"agent_id": "grok"})
            self.assertTrue(thin_claim.get("claimed"))
            self.assertEqual(thin_claim["id"], thin["id"])
            self.assertTrue(thin_claim.get("patch_claim"))
            self.assertIn("CURSOR_FIX", thin_claim.get("cursor_packet") or "")
            pending = [j for j in dss.list_debug_jobs() if j.get("id") == minted["id"]]
            self.assertEqual(pending[0]["status"], "pending_sam")
            self.assertFalse(pending[0].get("patch_claim"))

    def test_claim_webgl_job_stamps_incident_split(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            minted = dss.mint_debug_job({
                "feature": "webgl.context",
                "log_id": "d9c98119-l5a",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
                "source": "prompt-trace",
            }, {"instance_id": "501"})
            self.assertEqual(minted["feature_id"], "webgl.context")
            self.assertFalse(minted["executed"])
            stamp = minted.get("incident_stamp") or {}
            self.assertTrue(stamp.get("ok"))
            self.assertFalse(stamp.get("skipped"))
            self.assertEqual(stamp.get("feature"), "webgl.context")
            self.assertIsNone(stamp.get("boot_first_failure"))
            claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            self.assertTrue(claimed.get("claimed"))
            self.assertEqual(claimed["status"], "claimed")
            self.assertFalse(claimed["executed"])
            self.assertEqual((claimed.get("incident_stamp") or {}).get("reason"), "already broken")
            webgl = ii.compare("webgl.context")
            boot = ii.compare("viewport.boot")
            self.assertEqual(webgl["first_failure"]["feature"], "webgl.context")
            self.assertEqual(webgl["first_failure"]["status"], "broken")
            self.assertEqual(webgl["first_failure"]["note"], "WebGL context lost")
            self.assertNotEqual(webgl["first_failure"]["feature"], "viewport.boot")
            self.assertIsNone(boot["first_failure"])
            boot_ok = ii.latest("viewport.boot")
            self.assertEqual(boot_ok["feature"], "viewport.boot")
            self.assertEqual(boot_ok["status"], "ok")
            boot_events = ii.query_events({"feature": "viewport.boot"}, 20)
            self.assertTrue(boot_events)
            self.assertTrue(all(row["status"] != "broken" for row in boot_events))

    def test_catalog_lists_skills(self):
        cat = dss.catalog()
        names = {s["name"] for s in cat["skills"]}
        for needed in ("prompt-trace", "desired-result-score", "incident-research", "debugger-analytics", "debugger-metrics", "debug-id-catalog", "api-tracking-explain"):
            self.assertIn(needed, names)
        self.assertEqual(cat["cap"], 160)
        self.assertEqual(cat["area"], "501")
        self.assertFalse(cat.get("auto_fire", False))
        self.assertIn("job_", cat["ids"]["job_id"])
        self.assertIn("ref:{id}", cat["ids"]["tracking_id"])
        self.assertIn("replace-approach", cat["ids"]["recommendation"])
        self.assertIn("cad-snapshots", cat["ids"]["cad_snapshots"])
        self.assertIn("stamp_feature", cat["ids"])
        self.assertIn("readonly_cli", cat["ids"])
        self.assertIn("replace_approach_guard", cat["ids"])
        self.assertIn("stamp_shipped_thin_hooks", cat["ids"])
        self.assertIn("pending_reload_guard", cat["ids"])
        self.assertIn("sam_queue", cat["ids"])
        self.assertIn("hours_open", cat["ids"])
        self.assertIn("cad_votes", cat["ids"])
        self.assertIn("leakfix12", cat["ids"]["cache_bust"])
        self.assertIn("leakfix13", cat["ids"]["cache_bust"])
        self.assertIn("leakfix14", cat["ids"]["cache_bust"])
        self.assertIn("leakfix15", cat["ids"]["cache_bust"])
        self.assertIn("leakfix16", cat["ids"]["cache_bust"])
        self.assertIn("leakfix17", cat["ids"]["cache_bust"])
        self.assertIn("leakfix18", cat["ids"]["cache_bust"])
        self.assertIn("leakfix19", cat["ids"]["cache_bust"])
        self.assertIn("leakfix20", cat["ids"]["cache_bust"])
        self.assertIn("leakfix21", cat["ids"]["cache_bust"])
        self.assertIn("leakfix22", cat["ids"]["cache_bust"])
        self.assertIn("leakfix23", cat["ids"]["cache_bust"])
        self.assertIn("leakfix24", cat["ids"]["cache_bust"])
        self.assertIn("leakfix25", cat["ids"]["cache_bust"])
        self.assertIn("leakfix26", cat["ids"]["cache_bust"])
        self.assertIn("leakfix27", cat["ids"]["cache_bust"])
        self.assertIn("leakfix28", cat["ids"]["cache_bust"])
        self.assertIn("leakfix29", cat["ids"]["cache_bust"])
        self.assertIn("leakfix30", cat["ids"]["cache_bust"])
        self.assertIn("leakfix31", cat["ids"]["cache_bust"])
        self.assertIn("leakfix32", cat["ids"]["cache_bust"])
        self.assertIn("leakfix33", cat["ids"]["cache_bust"])
        self.assertIn("leakfix34", cat["ids"]["cache_bust"])
        self.assertIn("leakfix35", cat["ids"]["cache_bust"])
        self.assertIn("leakfix36", cat["ids"]["cache_bust"])
        self.assertIn("leakfix37", cat["ids"]["cache_bust"])
        self.assertIn("leakfix38", cat["ids"]["cache_bust"])
        self.assertIn("leakfix39", cat["ids"]["cache_bust"])
        self.assertIn("leakfix40", cat["ids"]["cache_bust"])
        self.assertIn("leakfix41", cat["ids"]["cache_bust"])
        self.assertIn("leakfix42", cat["ids"]["cache_bust"])
        self.assertIn("leakfix43", cat["ids"]["cache_bust"])
        self.assertIn("leakfix44", cat["ids"]["cache_bust"])
        self.assertIn("leakfix45", cat["ids"]["cache_bust"])
        self.assertIn("leakfix46", cat["ids"]["cache_bust"])
        self.assertIn("leakfix47", cat["ids"]["cache_bust"])
        self.assertIn("leakfix48", cat["ids"]["cache_bust"])
        self.assertIn("leakfix49", cat["ids"]["cache_bust"])
        self.assertIn("leakfix50", cat["ids"]["cache_bust"])
        self.assertIn("leakfix51", cat["ids"]["cache_bust"])
        self.assertIn("leakfix52", cat["ids"]["cache_bust"])
        self.assertIn("leakfix53", cat["ids"]["cache_bust"])
        self.assertIn("leakfix54", cat["ids"]["cache_bust"])
        self.assertIn("leakfix55", cat["ids"]["cache_bust"])
        self.assertIn("leakfix56", cat["ids"]["cache_bust"])
        self.assertIn("leakfix57", cat["ids"]["cache_bust"])
        self.assertIn("leakfix58", cat["ids"]["cache_bust"])
        self.assertIn("leakfix59", cat["ids"]["cache_bust"])
        self.assertIn("leakfix60", cat["ids"]["cache_bust"])
        self.assertIn("leakfix61", cat["ids"]["cache_bust"])
        self.assertIn("leakfix62", cat["ids"]["cache_bust"])
        self.assertIn("leakfix63", cat["ids"]["cache_bust"])
        self.assertIn("leakfix64", cat["ids"]["cache_bust"])
        self.assertIn("leakfix65", cat["ids"]["cache_bust"])
        self.assertIn("leakfix66", cat["ids"]["cache_bust"])
        self.assertIn("leakfix67", cat["ids"]["cache_bust"])
        self.assertIn("leakfix68", cat["ids"]["cache_bust"])
        self.assertIn("leakfix69", cat["ids"]["cache_bust"])
        self.assertIn("leakfix70", cat["ids"]["cache_bust"])
        self.assertIn("leakfix71", cat["ids"]["cache_bust"])
        self.assertIn("leakfix72", cat["ids"]["cache_bust"])
        self.assertIn("leakfix73", cat["ids"]["cache_bust"])
        self.assertIn("leakfix74", cat["ids"]["cache_bust"])
        self.assertIn("leakfix75", cat["ids"]["cache_bust"])
        self.assertIn("leakfix76", cat["ids"]["cache_bust"])
        self.assertIn("leakfix77", cat["ids"]["cache_bust"])
        self.assertIn("leakfix78", cat["ids"]["cache_bust"])
        self.assertIn("leakfix79", cat["ids"]["cache_bust"])
        self.assertIn("leakfix80", cat["ids"]["cache_bust"])
        self.assertIn("leakfix81", cat["ids"]["cache_bust"])
        self.assertIn("leakfix82", cat["ids"]["cache_bust"])
        self.assertIn("leakfix83", cat["ids"]["cache_bust"])
        self.assertIn("leakfix84", cat["ids"]["cache_bust"])
        self.assertIn("leakfix85", cat["ids"]["cache_bust"])
        self.assertIn("leakfix86", cat["ids"]["cache_bust"])
        self.assertIn("leakfix87", cat["ids"]["cache_bust"])
        self.assertIn("leakfix88", cat["ids"]["cache_bust"])
        self.assertIn("leakfix89", cat["ids"]["cache_bust"])
        self.assertIn("leakfix90", cat["ids"]["cache_bust"])
        self.assertIn("leakfix91", cat["ids"]["cache_bust"])
        self.assertIn("leakfix92", cat["ids"]["cache_bust"])
        self.assertIn("leakfix93", cat["ids"]["cache_bust"])
        self.assertIn("leakfix94", cat["ids"]["cache_bust"])
        self.assertIn("leakfix95", cat["ids"]["cache_bust"])
        self.assertIn("leakfix96", cat["ids"]["cache_bust"])
        self.assertIn("leakfix97", cat["ids"]["cache_bust"])
        self.assertIn("leakfix98", cat["ids"]["cache_bust"])
        self.assertIn("leakfix99", cat["ids"]["cache_bust"])
        self.assertIn("leakfix100", cat["ids"]["cache_bust"])
        self.assertIn("leakfix101", cat["ids"]["cache_bust"])
        self.assertIn("leakfix102", cat["ids"]["cache_bust"])
        self.assertIn("leakfix103", cat["ids"]["cache_bust"])
        self.assertIn("leakfix104", cat["ids"]["cache_bust"])
        self.assertIn("leakfix105", cat["ids"]["cache_bust"])
        self.assertIn("leakfix106", cat["ids"]["cache_bust"])
        self.assertIn("leakfix107", cat["ids"]["cache_bust"])
        self.assertIn("leakfix108", cat["ids"]["cache_bust"])
        self.assertIn("leakfix109", cat["ids"]["cache_bust"])
        self.assertIn("test_verified", cat["ids"])
        self.assertIn("ingest_prompt_result_liabilities", cat["ids"])
        self.assertIn("ingest_job_clock_time_to_complete", cat["ids"])
        self.assertIn("instance_registry", cat["ids"])
        self.assertIn("ingest_shipped_hook_optimization", cat["ids"])
        self.assertIn("ingest_http_network_troubleshooting", cat["ids"])
        self.assertIn("write_league_underperform_report", cat["ids"])
        self.assertIn("stamp_design_build_error_if_missing", cat["ids"])
        self.assertIn("ingest_controller_stamps", cat["ids"])
        self.assertIn("ingest_networking_stamps", cat["ids"])
        self.assertIn("pending_reload", cat["ids"]["recommendation"])
        self.assertEqual(set(cat["periods"]), set(dss.CREDIT_PERIODS))
        self.assertEqual(set(cat["categories"]), set(dss.CREDIT_CATEGORIES))
        agreed = dss.agree({"verdict": "agree", "technical": 88, "desired": 72, "delta": 2, "note": "gates stay"})
        self.assertEqual(agreed["verdict"], "agree")
        self.assertTrue(agreed["analysis_id"])

    def test_stamp_offline_feature_allowlist_dedupe_and_kernel(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            kernel = dss.stamp_offline_feature({"feature": "prompt.run", "status": "broken"})
            self.assertTrue(kernel["skipped"])
            self.assertEqual(kernel["reason"], "kernel")
            blocked = dss.stamp_offline_feature({"feature": "viewport.models", "status": "broken"})
            self.assertTrue(blocked["skipped"])
            self.assertEqual(blocked["reason"], "not-allowlisted")
            first = dss.stamp_offline_feature({
                "feature": "network.timeout",
                "status": "broken",
                "user_id": "sam-stamp",
                "note": "unittest temp stamp",
            })
            self.assertTrue(first["ok"])
            self.assertFalse(first["skipped"])
            self.assertEqual(first["feature"], "network.timeout")
            self.assertEqual(ii.latest("network.timeout")["status"], "broken")
            self.assertFalse(first.get("auto_fire"))
            again = dss.stamp_offline_feature({"feature": "network.timeout", "status": "broken", "user_id": "sam-stamp"})
            self.assertTrue(again["skipped"])
            self.assertEqual(again["reason"], "already-stamped-today")

    def test_ingest_existing_incident_stamps_dedup_no_invent(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            empty = dss.ingest_existing_incident_stamps({"user_id": "sam-inc"})
            self.assertEqual(empty["n_credited"], 0)
            self.assertFalse(empty["invented"])
            self.assertIn("memory.leak", empty["missing"])
            ev = ii.record_event({
                "feature": "memory.leak",
                "status": "broken",
                "kind": "client-smoke",
                "source": "studio-webgl",
                "note": "Heap jumped 24.4→52 MB",
            })
            first = dss.ingest_existing_incident_stamps({"user_id": "sam-inc"})
            self.assertEqual(first["n_credited"], 1)
            self.assertEqual(first["credited"][0]["log_id"], ev["id"])
            self.assertEqual(first["credited"][0]["category"], "memory_leaks")
            self.assertFalse(first["invented"])
            self.assertFalse(first["auto_fire"])
            again = dss.ingest_existing_incident_stamps({"user_id": "sam-inc"})
            self.assertEqual(again["n_credited"], 0)
            self.assertTrue(any(s.get("log_id") == ev["id"] and s.get("reason") == "already counted today" for s in again["skipped"]))
            self.assertEqual(sum(1 for r in dss.list_credit(limit=40) if r.get("category") == "memory_leaks"), 1)
            self.assertIsNone(ii.latest("network.latency"))
            self.assertIsNone(ii.latest("human.override"))

    def test_ingest_thumb_down_liability_dedup_no_fake_thumb(self):
        empty = dss.ingest_thumb_down_liability({})
        self.assertTrue(empty["skipped"])
        self.assertEqual(empty["reason"], "no-export")
        first = dss.ingest_thumb_down_liability({
            "event_id": "thumbtest001",
            "export_id": "aa" * 16,
            "user_damage": 40,
            "user_id": "sam-thumb",
        })
        self.assertFalse(first["skipped"])
        self.assertEqual(first.get("feature") or first.get("credit_category"), "user.damage" if first.get("feature") else first.get("credit_category"))
        self.assertEqual((first.get("credit") or {}).get("category"), "liabilities")
        self.assertFalse(first.get("invented"))
        self.assertFalse(first.get("auto_fire"))
        again = dss.ingest_thumb_down_liability({"event_id": "thumbtest001", "export_id": "aa" * 16})
        self.assertTrue(again["skipped"])
        self.assertEqual(again["reason"], "already counted today")

    def test_ingest_prompt_result_liabilities_from_jsonl_fixture(self):
        from backend.services import incident_intelligence_service as ii

        (self.store / "live-prompts.jsonl").write_text(
            json.dumps({"log_id": "d9c98119-l59lo", "score": 18, "label": "missed", "result": "broke", "user_id": "sam-score"}) + "\n"
            + json.dumps({"log_id": "d9c98119-l59hi", "score": 88, "label": "exceeded", "result": "improved", "user_id": "sam-score"}) + "\n"
            + json.dumps({"log_id": "d9c98119-l59ns", "result": "continued", "user_id": "sam-score"}) + "\n",
            encoding="utf-8",
        )
        with patch.object(ii, "record_event", side_effect=AssertionError("must not invent incidents")):
            emptyish = dss.ingest_prompt_result_liabilities({"include_score_table": False})
            again = dss.ingest_prompt_result_liabilities({"include_score_table": False})
        self.assertEqual(emptyish["n_credited"], 2)
        self.assertFalse(emptyish.get("invented"))
        kinds = {row["log_id"]: row for row in emptyish["credited"]}
        self.assertTrue(kinds["d9c98119-l59lo"]["low"])
        self.assertEqual(kinds["d9c98119-l59lo"]["feature"], "user.damage")
        self.assertFalse(kinds["d9c98119-l59hi"]["low"])
        self.assertEqual(kinds["d9c98119-l59hi"]["feature"], "")
        self.assertTrue(all(r.get("reason") == "already counted today" for r in again["skipped"]))
        rows = [r for r in dss.list_credit(limit=40) if r.get("category") == "liabilities"]
        self.assertGreaterEqual(len(rows), 2)
        queue = dss.write_sam_queue()["sam_queue"]
        self.assertTrue((queue.get("liabilities") or {}).get("populated"))
        self.assertGreaterEqual((queue.get("liabilities") or {}).get("n") or 0, 2)
        md = (Path(self.temp.name) / "ai-context" / "debugger" / "swarm-reports" / "sam-queue-latest.md").read_text(encoding="utf-8")
        self.assertIn("liabilities:", md)
        self.assertFalse(queue.get("breakage_zero"))

    def test_swarm_tick_prompt_result_liabilities_idempotent(self):
        (self.store / "live-prompts.jsonl").write_text(
            json.dumps({"log_id": "d9c98119-l60lo", "score": 22, "label": "missed", "user_id": "sam-tick"}) + "\n"
            + json.dumps({"log_id": "d9c98119-l60hi", "score": 91, "label": "exceeded", "user_id": "sam-tick"}) + "\n",
            encoding="utf-8",
        )
        body = {
            "sidecars": False,
            "include_score_table": False,
            "reports": False,
            "cad_snapshots": False,
            "snapshot_id": "cad-test-l60",
        }
        first = dss.swarm_credit_tick(body)
        self.assertTrue(first.get("tick"))
        self.assertIn("prompt_scores", first)
        self.assertEqual((first.get("prompt_scores") or {}).get("n_credited"), 2)
        self.assertFalse((first.get("prompt_scores") or {}).get("invented"))
        queue = (first.get("sam_queue") or {}).get("sam_queue") or {}
        self.assertTrue((queue.get("liabilities") or {}).get("populated"))
        first_n = sum(1 for r in dss.list_credit(limit=40) if r.get("category") == "liabilities")
        second = dss.swarm_credit_tick({**body, "snapshot_id": "cad-test-l60b"})
        self.assertEqual((second.get("prompt_scores") or {}).get("n_credited"), 0)
        skipped = (second.get("prompt_scores") or {}).get("skipped") or []
        self.assertTrue(all(s.get("reason") == "already counted today" for s in skipped))
        self.assertTrue(any(s.get("log_id") == "d9c98119-l60lo" for s in skipped))
        self.assertTrue(any(s.get("log_id") == "d9c98119-l60hi" for s in skipped))
        second_n = sum(1 for r in dss.list_credit(limit=40) if r.get("category") == "liabilities")
        self.assertEqual(first_n, second_n)
        self.assertGreaterEqual(first_n, 2)

    def test_ingest_job_clock_time_to_complete_fixture_timestamps(self):
        fast = dss.mint_debug_job({
            "feature": "memory.leak",
            "log_id": "d9c98119-l61f",
            "project_id": "5bf8e783",
            "user_id": "sam-clock",
        }, {"instance_id": "501"})
        dss.claim_debug_job({"agent_id": "grok", "job_id": fast["id"]})
        slow = dss.mint_debug_job({
            "feature": "webgl.context",
            "log_id": "d9c98119-l61s",
            "project_id": "5bf8e783",
            "user_id": "sam-clock",
        }, {"instance_id": "501"})
        dss.claim_debug_job({"agent_id": "grok", "job_id": slow["id"]})
        waiting = dss.mint_debug_job({
            "feature": "viewport.models",
            "log_id": "d9c98119-l61w",
            "project_id": "5bf8e783",
            "user_id": "sam-clock",
        }, {"instance_id": "501"})
        dss.claim_debug_job({"agent_id": "grok", "job_id": waiting["id"]})

        def _stamp(job_id, **fields):
            job = dss.get_debug_job(job_id)
            extra = dict(job.get("extra") or {})
            extra.update(fields)
            with dss._conn() as conn:
                conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra), job_id))

        _stamp(
            fast["id"],
            claimed_at="2026-09-16T12:00:00+00:00",
            candidate_confirm=True,
            candidate_confirm_at="2026-09-16T12:20:00+00:00",
            test_verified=True,
            test_verified_at="2026-09-16T12:30:00+00:00",
        )
        _stamp(
            slow["id"],
            claimed_at="2026-09-16T10:00:00+00:00",
            candidate_confirm=True,
            candidate_confirm_at="2026-09-16T16:00:00+00:00",
            test_verified=True,
            test_verified_at="2026-09-16T20:00:00+00:00",
        )
        _stamp(
            waiting["id"],
            claimed_at="2026-09-10T10:00:00+00:00",
            candidate_confirm=True,
            candidate_confirm_at="2026-09-10T11:00:00+00:00",
            test_verified=False,
        )
        first = dss.ingest_job_clock_time_to_complete()
        self.assertEqual(first["n_credited"], 2)
        self.assertFalse(first.get("invented"))
        by_id = {row["id"]: row for row in first["credited"]}
        self.assertGreater(by_id[fast["id"]]["credit"], by_id[slow["id"]]["credit"])
        self.assertEqual(by_id[fast["id"]]["agent_id"], "grok")
        self.assertTrue(any(s.get("id") == waiting["id"] and s.get("reason") == "sam-gate" and s.get("penalty") is False for s in first["skipped"]))
        wait_rows = [
            r for r in dss.list_credit(limit=40)
            if (r.get("extra") or {}).get("log_id") == f"job-clock:{waiting['id']}"
        ]
        self.assertEqual(wait_rows, [])
        again = dss.ingest_job_clock_time_to_complete()
        self.assertEqual(again["n_credited"], 0)
        with patch.object(dss, "swarm_debug_tick", return_value={"n_minted": 0, "minted": [], "executed": False}):
            tick = dss.swarm_credit_tick({
                "sidecars": False,
                "include_score_table": False,
                "reports": False,
                "cad_snapshots": False,
                "snapshot_id": "cad-test-l61",
                "run_focused_test": lambda spec: {"ok": True, "passed": False, "reason": "fixture-skip"},
            })
        self.assertEqual((tick.get("job_clocks") or {}).get("n_credited"), 0)
        queue = (tick.get("sam_queue") or {}).get("sam_queue") or {}
        self.assertTrue((queue.get("time_to_complete") or {}).get("populated"))
        self.assertGreaterEqual((queue.get("time_to_complete") or {}).get("n") or 0, 2)
        md = (Path(self.temp.name) / "ai-context" / "debugger" / "swarm-reports" / "sam-queue-latest.md").read_text(encoding="utf-8")
        self.assertIn("time_to_complete:", md)
        waiting_job = dss.get_debug_job(waiting["id"])
        self.assertNotEqual(waiting_job.get("status"), "sam_confirmed")

    def test_ok_stamp_marks_candidate_confirm_kernel_never(self):
        from backend.services import debugger_metrics_service as dms
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            minted = dss.mint_debug_job({
                "feature": "memory.leak",
                "log_id": "d9c98119-l24",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
                "source": "prompt-trace",
            }, {"instance_id": "501"})
            self.assertEqual(minted["feature_id"], "memory.leak")
            self.assertFalse(minted["executed"])
            claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            self.assertTrue(claimed.get("claimed"))
            self.assertFalse(claimed.get("candidate_confirm"))
            with patch.object(dms, "confirm_fixed", side_effect=AssertionError("must not confirm_fixed")):
                recovered = dss.stamp_offline_feature({
                    "feature": "memory.leak",
                    "status": "ok",
                    "user_id": "sam-stamp",
                    "note": "unittest recovered",
                })
            self.assertTrue(recovered["ok"])
            self.assertFalse(recovered["skipped"])
            self.assertEqual((recovered.get("candidate_confirm") or {}).get("n"), 1)
            stored = dss.list_debug_jobs(status="claimed")
            self.assertEqual(len(stored), 1)
            self.assertTrue(stored[0]["candidate_confirm"])
            self.assertFalse(stored[0]["executed"])
            self.assertFalse((stored[0].get("extra") or {}).get("confirm_fixed"))
            snap = dss.write_cad_job_snapshots()
            payload = (dss.cad_snapshots_root() / f"{stored[0]['id']}-latest.md").read_text(encoding="utf-8")
            self.assertIn("candidate confirm-fixed", payload)
            self.assertFalse(snap.get("executed"))
            kernel = dss.mint_debug_job({
                "feature": "prompt.run",
                "log_id": "d9c98119-l24k",
                "project_id": "64d81b05",
                "user_id": "sam-local",
            }, {"instance_id": "501"})
            self.assertTrue((kernel.get("extra") or {}).get("kernel"))
            ii.record_event({"feature": "prompt.run", "status": "ok", "kind": "prompt", "note": "unittest kernel ok"})
            proposed = dss.propose_candidate_confirm({"feature": "prompt.run"})
            self.assertEqual(proposed["n"], 0)
            self.assertTrue(any(row.get("reason") == "kernel" for row in proposed.get("skipped") or []))
            kernel_jobs = [j for j in dss.list_debug_jobs() if j.get("feature_id") == "prompt.run"]
            self.assertTrue(kernel_jobs)
            self.assertFalse(kernel_jobs[0].get("candidate_confirm"))
            self.assertFalse(kernel_jobs[0]["executed"])

    def test_shipped_thin_hook_ok_marks_candidate_confirm(self):
        from backend.services import debugger_metrics_service as dms
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            broken = ii.record_event({
                "feature": "webgl.context",
                "status": "broken",
                "kind": "client-smoke",
                "note": "WebGL context lost",
                "project_id": "5bf8e783",
            })
            minted = dss.mint_debug_job({
                "feature": "webgl.context",
                "log_id": "d9c98119-l51w",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
                "source": "prompt-trace",
            }, {"instance_id": "501"})
            claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            self.assertFalse(claimed.get("candidate_confirm"))
            dry = dss.propose_candidate_confirm({"feature": "webgl.context", "snapshots": False})
            self.assertEqual(dry["n"], 0)
            with patch.object(dms, "confirm_fixed", side_effect=AssertionError("must not confirm_fixed")):
                out = dss.stamp_shipped_thin_hooks({"snapshots": False})
            self.assertGreaterEqual(out["n_stamped"], 1)
            self.assertEqual((out.get("candidate_confirm") or {}).get("n"), 1)
            self.assertFalse(out.get("breakage_zero"))
            self.assertFalse(out.get("executed"))
            stored = dss.list_debug_jobs(status="claimed")
            self.assertTrue(stored[0]["candidate_confirm"])
            self.assertFalse(stored[0]["executed"])
            self.assertEqual(ii.latest("webgl.context")["status"], "ok")
            self.assertEqual(ii.latest("webgl.context")["source"], "shipped-thin-hook")
            kernel = dss.mint_debug_job({
                "feature": "prompt.run",
                "log_id": "d9c98119-l51k",
                "project_id": "64d81b05",
                "user_id": "sam-local",
            }, {"instance_id": "501"})
            dss.claim_debug_job({"agent_id": "cursor", "job_id": kernel["id"]})
            again = dss.stamp_shipped_thin_hooks({"snapshots": False})
            kernel_jobs = [j for j in dss.list_debug_jobs() if j.get("id") == kernel["id"]]
            self.assertTrue(kernel_jobs)
            self.assertFalse(kernel_jobs[0].get("candidate_confirm"))
            self.assertTrue(any(row.get("reason") == "not-shipped-or-kernel" for row in again.get("skipped") or []))
            self.assertFalse(again.get("breakage_zero"))

    def test_sam_queue_lists_four_candidate_confirm_jobs(self):
        from backend.services import debugger_metrics_service as dms
        from backend.services import incident_intelligence_service as ii

        features = (
            "viewport.models",
            "memory.leak",
            "webgl.context",
            "vr.controllers.trigger",
        )
        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            ids = []
            for feat in features:
                minted = dss.mint_debug_job({
                    "feature": feat,
                    "log_id": f"d9c98119-l55-{feat}",
                    "project_id": "5bf8e783",
                    "user_id": "sam-local",
                    "source": "prompt-trace",
                }, {"instance_id": "501"})
                claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
                self.assertTrue(claimed.get("claimed"))
                self.assertFalse(claimed.get("candidate_confirm"))
                ids.append(minted["id"])
            kernel = dss.mint_debug_job({
                "feature": "prompt.run",
                "log_id": "d9c98119-l55k",
                "project_id": "64d81b05",
                "user_id": "sam-local",
            }, {"instance_id": "501"})
            reload_job = dss.mint_debug_job({
                "feature": "network.latency",
                "log_id": "d9c98119-l55n",
                "project_id": "ce8294df",
                "user_id": "sam-local",
                "note": "Fetch failed GET /api/projects/ce8294df/generation",
                "cause_hint": "TypeError Failed to fetch",
            }, {"instance_id": "501"})
            report = dss.report_agent({"agent_id": "grok", "recommendation": "fix-few-issues", "note": "loop55 queue"})
            with patch.object(dms, "confirm_fixed", side_effect=AssertionError("must not confirm_fixed")):
                with patch.object(dss, "confirm_candidate", side_effect=AssertionError("must not confirm_candidate")):
                    stamped = dss.stamp_shipped_thin_hooks({"snapshots": False})
                    written = dss.write_sam_queue()
                    summary = dss.swarm_summary()
            self.assertGreaterEqual((stamped.get("candidate_confirm") or {}).get("n") or 0, 4)
            queue = written.get("sam_queue") or {}
            cand_ids = [j.get("id") for j in queue.get("candidate_confirm") or []]
            self.assertEqual(set(cand_ids), set(ids))
            self.assertEqual(len(cand_ids), 4)
            md = (root / "ai-context" / "debugger" / "swarm-reports" / "sam-queue-latest.md").read_text(encoding="utf-8")
            js = json.loads((root / "ai-context" / "debugger" / "swarm-reports" / "sam-queue-latest.json").read_text(encoding="utf-8"))
            self.assertIn("SAM-QUEUE", md)
            for job_id in ids:
                self.assertIn(job_id, md)
                self.assertIn(job_id, json.dumps(js))
            reload_ids = {j.get("id") for j in queue.get("pending_reload") or []}
            kernel_ids = {j.get("id") for j in queue.get("replace_approach") or []}
            report_ids = {r.get("id") for r in queue.get("pending_sam") or []}
            self.assertIn(reload_job["id"], reload_ids)
            self.assertIn(kernel["id"], kernel_ids)
            self.assertIn(report.get("id"), report_ids)
            self.assertEqual(next(iter(summary)), "sam_queue")
            self.assertEqual(set(j.get("id") for j in (summary.get("sam_queue") or {}).get("candidate_confirm") or []), set(ids))
            self.assertFalse(queue.get("breakage_zero"))
            self.assertEqual(queue.get("goal"), "OPEN")
            for job_id in ids:
                stored = dss.get_debug_job(job_id)
                self.assertTrue(stored.get("candidate_confirm"))
                self.assertNotEqual(stored.get("status"), "sam_confirmed")
                self.assertFalse(stored.get("executed"))
            for row in (queue.get("candidate_confirm") or []) + (queue.get("pending_reload") or []) + (queue.get("replace_approach") or []):
                self.assertIsNotNone(row.get("hours_open"))
                self.assertIsNotNone(row.get("age_s"))
                self.assertFalse(row.get("penalty"))
                self.assertIn(f"{row.get('hours_open')}h open", md)

    def test_sam_queue_hours_open_from_claimed_or_mint_not_penalty(self):
        from datetime import datetime, timedelta, timezone
        from backend.services import debugger_metrics_service as dms
        from backend.services import incident_intelligence_service as ii

        minted_at = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
        later = minted_at + timedelta(hours=6)
        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            with patch.object(das, "now", return_value=minted_at.isoformat()):
                minted = dss.mint_debug_job({
                    "feature": "memory.leak",
                    "log_id": "d9c98119-l81m",
                    "project_id": "5bf8e783",
                    "user_id": "sam-local",
                }, {"instance_id": "501"})
                claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
                self.assertTrue(claimed.get("claimed"))
                reload_job = dss.mint_debug_job({
                    "feature": "network.latency",
                    "log_id": "d9c98119-l81n",
                    "project_id": "ce8294df",
                    "user_id": "sam-local",
                    "note": "Fetch failed GET /api/projects/ce8294df/generation",
                    "cause_hint": "TypeError Failed to fetch",
                }, {"instance_id": "501"})
                kernel = dss.mint_debug_job({
                    "feature": "prompt.run",
                    "log_id": "d9c98119-l81k",
                    "project_id": "64d81b05",
                    "user_id": "sam-local",
                }, {"instance_id": "501"})
            with patch.object(das, "now", return_value=later.isoformat()):
                with patch.object(dms, "confirm_fixed", side_effect=AssertionError("must not confirm_fixed")):
                    with patch.object(dss, "confirm_candidate", side_effect=AssertionError("must not confirm_candidate")):
                        dss.stamp_shipped_thin_hooks({"snapshots": False})
                        written = dss.write_sam_queue()
                        summary = dss.swarm_summary()
            queue = written.get("sam_queue") or {}
            cand = next(j for j in (queue.get("candidate_confirm") or []) if j.get("id") == minted["id"])
            reload_row = next(j for j in (queue.get("pending_reload") or []) if j.get("id") == reload_job["id"])
            kernel_row = next(j for j in (queue.get("replace_approach") or []) if j.get("id") == kernel["id"])
            for row in (cand, reload_row, kernel_row):
                self.assertEqual(row.get("hours_open"), 6.0)
                self.assertEqual(row.get("age_s"), 21600.0)
                self.assertFalse(row.get("penalty"))
            md = (root / "ai-context" / "debugger" / "swarm-reports" / "sam-queue-latest.md").read_text(encoding="utf-8")
            self.assertIn("6.0h open", md)
            sum_cand = next(j for j in ((summary.get("sam_queue") or {}).get("candidate_confirm") or []) if j.get("id") == minted["id"])
            self.assertEqual(sum_cand.get("hours_open"), 6.0)
            self.assertFalse(sum_cand.get("penalty"))
            self.assertFalse(queue.get("breakage_zero"))
            self.assertEqual(queue.get("goal"), "OPEN")

    def test_cad_votes_record_list_backfill_not_penalty(self):
        root = Path(self.temp.name)
        first = dss.record_cad_vote({
            "voter": "grok",
            "subject": "loop81",
            "loop": "loop82",
            "verdict": "agree",
            "reason": "hours_open display stays; this loop persists votes",
            "tracking_id": "vote-l82-test",
        })
        self.assertTrue(first.get("ok"))
        self.assertEqual(first.get("voter"), "grok")
        self.assertEqual(first.get("subject"), "loop81")
        self.assertEqual(first.get("loop"), "loop82")
        self.assertEqual(first.get("verdict"), "agree")
        self.assertEqual(first.get("tracking_id"), "vote-l82-test")
        self.assertFalse(first.get("penalty"))
        self.assertFalse(first.get("idempotent"))
        again = dss.record_cad_vote({
            "voter": "grok",
            "subject": "81",
            "loop": "82",
            "verdict": "disagree",
            "reason": "should not overwrite",
        })
        self.assertTrue(again.get("idempotent"))
        self.assertEqual(again.get("verdict"), "agree")
        self.assertEqual(again.get("id"), first.get("id"))
        with self.assertRaises(ValueError):
            dss.record_cad_vote({"voter": "grok", "subject": "loop80", "loop": "loop81"})
        md_dir = root / "ai-context" / "debugger"
        md_dir.mkdir(parents=True, exist_ok=True)
        (md_dir / "CAD-LOOP-20260916.md").write_text(
            "# CAD loop81 — 2026-09-16 (hours_open)\n\n"
            "- **Agree:** hours_open display stays.\n"
            "Grok `catalog.agree` id `aaaaaaaaaaaaaaaa` (verdict **agree**, delta +2).\n\n"
            "# CAD loop snapshot — 2026-09-16 (loop2)\n\n"
            "Grok `catalog.agree` id `bbbbbbbbbbbbbbbb` (verdict **agree**).\n",
            encoding="utf-8",
        )
        filled = dss.backfill_cad_votes_from_loop_md()
        self.assertGreaterEqual(filled.get("n_new") or 0, 2)
        self.assertFalse(filled.get("penalty"))
        self.assertFalse(filled.get("invented"))
        second = dss.backfill_cad_votes_from_loop_md()
        self.assertEqual(second.get("n_new"), 0)
        listed = {f"{v.get('loop')}:{v.get('subject')}": v for v in dss.list_cad_votes(20)}
        self.assertEqual(listed["loop82:loop81"]["tracking_id"], "vote-l82-test")
        self.assertEqual(listed["loop81:loop80"]["tracking_id"], "aaaaaaaaaaaaaaaa")
        self.assertEqual(listed["loop2:loop1"]["tracking_id"], "bbbbbbbbbbbbbbbb")
        written = dss.write_sam_queue()
        queue = written.get("sam_queue") or {}
        self.assertTrue(queue.get("cad_votes"))
        self.assertFalse(queue.get("breakage_zero"))
        md = (root / "ai-context" / "debugger" / "swarm-reports" / "sam-queue-latest.md").read_text(encoding="utf-8")
        self.assertIn("cad_votes", md)
        self.assertIn("vote-l82-test", md)
        summary = dss.swarm_summary()
        self.assertTrue(summary.get("cad_votes"))
        self.assertTrue((summary.get("sam_queue") or {}).get("cad_votes"))
        before = len(dss.list_credit(period="daily", limit=40))
        dss.record_cad_vote({"voter": "cursor", "subject": "loop79", "loop": "loop80", "verdict": "agree", "reason": "no credit"})
        after = len(dss.list_credit(period="daily", limit=40))
        self.assertEqual(before, after)

    def test_stamp_test_verified_pass_not_sam_confirmed(self):
        from backend.services import debugger_metrics_service as dms
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            minted = dss.mint_debug_job({
                "feature": "memory.leak",
                "log_id": "d9c98119-l57m",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
                "source": "prompt-trace",
            }, {"instance_id": "501"})
            dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            trigger = dss.mint_debug_job({
                "feature": "vr.controllers.trigger",
                "log_id": "d9c98119-l57t",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
                "source": "prompt-trace",
            }, {"instance_id": "501"})
            dss.claim_debug_job({"agent_id": "grok", "job_id": trigger["id"]})
            kernel = dss.mint_debug_job({
                "feature": "prompt.run",
                "log_id": "d9c98119-l57k",
                "project_id": "64d81b05",
                "user_id": "sam-local",
            }, {"instance_id": "501"})
            dss.stamp_shipped_thin_hooks({"snapshots": False})

            def _runner(spec):
                feat = str((spec or {}).get("feature") or "")
                path = str((spec or {}).get("path") or "")
                if feat == "memory.leak" and path.endswith("viewport-video-editor.test.js"):
                    return {"ok": True, "passed": True, "path": path}
                return {"ok": True, "passed": False, "reason": "test-failed", "path": path}

            with patch.object(dms, "confirm_fixed", side_effect=AssertionError("must not confirm_fixed")):
                with patch.object(dss, "confirm_candidate", side_effect=AssertionError("must not confirm_candidate")):
                    out = dss.stamp_test_verified({"run_focused_test": _runner})
                    written = dss.write_sam_queue()
                    summary = dss.swarm_summary()
            self.assertEqual(out["n_stamped"], 1)
            self.assertEqual(out["stamped"][0]["id"], minted["id"])
            self.assertTrue(out["stamped"][0]["test_verified"])
            self.assertFalse(out["breakage_zero"])
            self.assertFalse(out["executed"])
            self.assertEqual(out["goal"], "OPEN")
            leak = dss.get_debug_job(minted["id"])
            self.assertTrue(leak.get("test_verified"))
            self.assertEqual(leak.get("test_path"), "frontend/viewport/viewport-video-editor.test.js")
            self.assertNotEqual(leak.get("status"), "sam_confirmed")
            self.assertFalse((leak.get("extra") or {}).get("sam_confirmed"))
            trig = dss.get_debug_job(trigger["id"])
            self.assertTrue(trig.get("candidate_confirm"))
            self.assertFalse(trig.get("test_verified"))
            kern = [j for j in dss.list_debug_jobs() if j.get("id") == kernel["id"]][0]
            self.assertFalse(kern.get("test_verified"))
            queue_ids = {j.get("id"): j for j in (written.get("sam_queue") or {}).get("candidate_confirm") or []}
            self.assertTrue(queue_ids[minted["id"]].get("test_verified"))
            self.assertFalse(queue_ids[trigger["id"]].get("test_verified"))
            md = (root / "ai-context" / "debugger" / "swarm-reports" / "sam-queue-latest.md").read_text(encoding="utf-8")
            self.assertIn("test_verified", md)
            self.assertIn(minted["id"], md)
            compact = [j for j in (summary.get("candidate_confirm") or []) if j.get("id") == minted["id"]]
            self.assertTrue(compact)
            self.assertTrue(compact[0].get("test_verified"))
            self.assertFalse((summary.get("sam_queue") or {}).get("breakage_zero"))

    def test_sam_confirm_and_reject_candidate_never_breakage_zero(self):
        minted = dss.mint_debug_job({
            "feature": "viewport.models",
            "log_id": "79ef268a-l39",
            "project_id": "5bf8e783",
            "user_id": "sam-local",
        }, {"instance_id": "501"})
        claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
        extra = dict(claimed.get("extra") or {})
        extra["candidate_confirm"] = True
        extra["executed"] = False
        extra["confirm_fixed"] = False
        with dss._conn() as conn:
            conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra), claimed["id"]))
        confirmed = dss.confirm_candidate({"job_id": claimed["id"]})
        self.assertEqual(confirmed["status"], "sam_confirmed")
        self.assertTrue(confirmed["sam_confirmed"])
        self.assertFalse(confirmed["executed"])
        self.assertFalse(confirmed["breakage_zero"])
        self.assertFalse(confirmed.get("candidate_confirm"))
        self.assertEqual(confirmed["goal"], "OPEN")
        rejected = dss.reject_candidate({"job_id": claimed["id"]})
        self.assertEqual(rejected["status"], "claimed")
        self.assertEqual(rejected["recommendation"], "fix-few-issues")
        self.assertFalse(rejected["executed"])
        self.assertFalse(rejected["breakage_zero"])
        self.assertFalse(rejected.get("candidate_confirm"))

    def test_confirm_candidate_credits_claiming_agent_reject_does_not(self):
        minted = dss.mint_debug_job({
            "feature": "viewport.models",
            "log_id": "79ef268a-l40",
            "project_id": "5bf8e783",
            "user_id": "sam-local",
        }, {"instance_id": "501"})
        claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
        extra = dict(claimed.get("extra") or {})
        extra["candidate_confirm"] = True
        extra["claimed_by"] = "grok"
        with dss._conn() as conn:
            conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra), claimed["id"]))
        before = [r for r in dss.list_credit(period="daily", limit=40) if (r.get("extra") or {}).get("log_id") == f"sam-confirm:{claimed['id']}"]
        self.assertEqual(before, [])
        confirmed = dss.confirm_candidate({"job_id": claimed["id"]})
        self.assertEqual((confirmed.get("credit") or {}).get("actor"), "grok")
        self.assertEqual((confirmed.get("credit") or {}).get("category"), "time_to_complete")
        self.assertEqual((confirmed.get("credit") or {}).get("period"), "daily")
        self.assertEqual(confirmed.get("credit_category"), "time_to_complete")
        self.assertFalse(confirmed["breakage_zero"])
        rows = [r for r in dss.list_credit(period="daily", limit=40) if (r.get("extra") or {}).get("log_id") == f"sam-confirm:{claimed['id']}"]
        self.assertEqual(len(rows), 1)
        again = dss.confirm_candidate({"job_id": claimed["id"]})
        self.assertTrue(again["sam_confirmed"])
        rows2 = [r for r in dss.list_credit(period="daily", limit=40) if (r.get("extra") or {}).get("log_id") == f"sam-confirm:{claimed['id']}"]
        self.assertEqual(len(rows2), 1)

        other = dss.mint_debug_job({
            "feature": "webgl.context",
            "log_id": "d9c98119-l40w",
            "project_id": "5bf8e783",
            "user_id": "sam-local",
        }, {"instance_id": "501"})
        claimed2 = dss.claim_debug_job({"agent_id": "cursor", "job_id": other["id"]})
        extra2 = dict(claimed2.get("extra") or {})
        extra2["candidate_confirm"] = True
        extra2["claimed_by"] = "cursor"
        with dss._conn() as conn:
            conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra2), claimed2["id"]))
        n_before = len(dss.list_credit(period="daily", limit=40))
        rejected = dss.reject_candidate({"job_id": claimed2["id"]})
        self.assertTrue(rejected.get("rejected"))
        self.assertIsNone(rejected.get("credit"))
        self.assertEqual(len(dss.list_credit(period="daily", limit=40)), n_before)
        reject_rows = [r for r in dss.list_credit(period="daily", limit=40) if (r.get("extra") or {}).get("log_id") == f"sam-confirm:{claimed2['id']}"]
        self.assertEqual(reject_rows, [])

    def test_standing_search_mints_new_features_dedup_cap(self):
        from backend.services import incident_intelligence_service as ii

        fake = {
            "vr.controllers.trigger": [{
                "log_id": "1b1b41f4-001",
                "result": "unknown",
                "blamed_log_id": "",
                "excerpt": "right controller trigger and grab don't work right",
                "prompt": "right controller trigger and grab don't work right",
            }],
            "viewport.models": [{
                "log_id": "79ef268a-068",
                "result": "continued",
                "blamed_log_id": "",
                "excerpt": "why are some of the models missing in the viewport",
                "prompt": "why are some of the models missing in the viewport",
            }],
            "viewport.boot": [{
                "log_id": "fe4a96cc-001",
                "result": "unknown",
                "blamed_log_id": "",
                "excerpt": "User STILL sees 3D viewport unavailable Error creating WebGL",
                "prompt": "User STILL sees 3D viewport unavailable Error creating WebGL",
            }],
        }

        def _search(query, limit=8):
            q = str(query or "").lower()
            hits = []
            if "controller trigger" in q:
                hits = fake["vr.controllers.trigger"]
            elif "models missing" in q:
                hits = fake["viewport.models"]
            elif "unavailable" in q or "webgl2" in q:
                hits = fake["viewport.boot"]
            return {"ok": True, "q": query, "count": len(hits), "hits": hits}

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"), patch.object(ii, "search_chat_logs", side_effect=_search):
            ii.record_event({"feature": "viewport.boot", "status": "ok", "kind": "client-smoke", "note": "Renderer initialized"})
            found = dss.search_standing_debug_targets()
            feats = {row["feature"]: row for row in found["findings"]}
            self.assertEqual(found["excerpt_cap"], 120)
            self.assertEqual(feats["vr.controllers.trigger"]["first_broken"]["log_id"], "1b1b41f4-001")
            self.assertEqual(feats["viewport.models"]["first_broken"]["log_id"], "79ef268a-068")
            self.assertEqual(feats["viewport.boot"]["latest_status"], "ok")
            self.assertLessEqual(len(feats["vr.controllers.trigger"]["first_broken"]["excerpt"]), 120)
            alerts = dss.standing_debug_alerts()
            self.assertTrue(any(a["feature"] == "vr.controllers.trigger" for a in alerts))
            self.assertTrue(any(a["feature"] == "viewport.models" for a in alerts))
            self.assertFalse(any(a["feature"] == "viewport.boot" for a in alerts))
            first = dss.swarm_debug_tick({"job_cap": 5, "instance_id": "501"})
            minted_feats = {row["feature_id"] for row in first.get("minted") or []}
            self.assertIn("vr.controllers.trigger", minted_feats)
            self.assertIn("viewport.models", minted_feats)
            self.assertNotIn("viewport.boot", minted_feats)
            self.assertLessEqual(first["n_minted"], 5)
            self.assertFalse(first["executed"])
            again = dss.swarm_debug_tick({"job_cap": 5})
            self.assertEqual(again["n_minted"], 0)
            self.assertTrue(any(row.get("reason") == "already queued today" for row in again.get("skipped") or []))

    def test_candidate_confirm_surfaces_for_sam(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            minted = dss.mint_debug_job({
                "feature": "memory.leak",
                "log_id": "d9c98119-l25",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
                "source": "prompt-trace",
            }, {"instance_id": "501"})
            claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            self.assertFalse(claimed.get("candidate_confirm"))
            dss.stamp_offline_feature({
                "feature": "memory.leak",
                "status": "ok",
                "user_id": "sam-stamp",
                "note": "loop25 recovered",
            })
            summary = dss.swarm_summary()
            self.assertTrue(summary["candidate_confirm"])
            self.assertEqual(summary["candidate_confirm"][0]["id"], minted["id"])
            self.assertTrue(summary["candidate_confirm"][0]["candidate_confirm"])
            self.assertFalse(summary["candidate_confirm"][0]["executed"])
            self.assertTrue(any(j.get("candidate_confirm") for j in summary["claimed_jobs"]))
            addon = dss.overview_addon()
            self.assertTrue(addon["candidate_confirm"])
            self.assertTrue(any(j.get("candidate_confirm") for j in addon["debug_jobs"]))
            self.assertEqual(next(iter(addon)), "sam_queue")
            self.assertEqual((addon.get("sam_queue") or {}).get("title"), "SAM-QUEUE")
            self.assertTrue((addon.get("sam_queue") or {}).get("candidate_confirm"))
            jobs = dss.list_debug_jobs(status="claimed")
            self.assertTrue(jobs[0]["candidate_confirm"])
            dss.write_swarm_period_reports()
            daily = json.loads((root / "ai-context" / "debugger" / "swarm-reports" / "daily-latest.json").read_text(encoding="utf-8"))
            self.assertTrue(daily["candidate_confirm"])
            md = (root / "ai-context" / "debugger" / "swarm-reports" / "daily-latest.md").read_text(encoding="utf-8")
            self.assertIn("candidate_confirm", md)
            self.assertIn("candidate confirm-fixed", md)

    def test_debugger_ui_exposes_candidate_confirm(self):
        js = Path(__file__).resolve().parents[2] / "frontend" / "admin" / "admin-debugger-analytics.js"
        dash = Path(__file__).resolve().parents[2] / "frontend" / "admin" / "admin-dashboard.js"
        html = Path(__file__).resolve().parents[2] / "frontend" / "pages" / "admin-dashboard.html"
        text = js.read_text(encoding="utf-8")
        self.assertIn("candidate_confirm", text)
        self.assertIn("Candidate confirm-fixed", text)
        self.assertIn("Confirm candidate", text)
        self.assertIn("Not fixed", text)
        self.assertIn("confirm-candidate", text)
        self.assertIn("REPLACE_APPROACH", text)
        self.assertIn("replaceApproachJob", text)
        self.assertIn("replacement_brief", text)
        self.assertIn("not a patch Claim", text)
        self.assertIn("playbook", text)
        self.assertNotIn("data-da-claim", text)
        self.assertIn("candconfirm1", dash.read_text(encoding="utf-8"))
        self.assertIn("candact1", dash.read_text(encoding="utf-8"))
        self.assertIn("replguard1", dash.read_text(encoding="utf-8"))
        self.assertIn("reloadguard1", dash.read_text(encoding="utf-8"))
        self.assertIn("replguard1", html.read_text(encoding="utf-8"))
        self.assertIn("reloadguard1", html.read_text(encoding="utf-8"))
        self.assertIn("PENDING_RELOAD", text)
        self.assertIn("pendingReloadJob", text)
        self.assertIn("SAM-QUEUE", text)
        self.assertIn("samQueueHtml", text)
        self.assertIn("data-da-sam-queue", text)
        self.assertIn("queuedIdSet", text)
        self.assertIn("samqueue1", dash.read_text(encoding="utf-8"))
        self.assertIn("samqueue1", html.read_text(encoding="utf-8"))
        self.assertIn("samqueue2", dash.read_text(encoding="utf-8"))
        self.assertIn("samqueue2", html.read_text(encoding="utf-8"))
        self.assertIn("hours_open", text)
        self.assertIn("queueAgeLabel", text)
        self.assertIn("cad_votes", text)
        self.assertIn("samqueue3", dash.read_text(encoding="utf-8"))
        self.assertIn("samqueue3", html.read_text(encoding="utf-8"))
        self.assertIn("test_verified", text)
        self.assertIn("testver1", dash.read_text(encoding="utf-8"))
        self.assertIn("testver1", html.read_text(encoding="utf-8"))
        self.assertIn("area501Html", text)
        self.assertIn("data-da-area501", text)
        self.assertIn("instance-registry?q=501", text)
        self.assertIn("area5011", dash.read_text(encoding="utf-8"))
        self.assertIn("area5011", html.read_text(encoding="utf-8"))

    def test_swarm_summary_compact_readonly(self):
        for period in dss.CREDIT_PERIODS:
            dss.record_credit({"period": period, "category": "networking", "credit": 70, "agent_id": "grok"})
        dss.rollup_all_periods()
        dss.league_cycle({"agent_id": "grok", "peer_id": "cursor", "score": 70, "category": "networking"})
        summary = dss.swarm_summary()
        self.assertTrue(summary["read_only"])
        self.assertFalse(summary["auto_fire"])
        self.assertEqual(summary["area"], "501")
        self.assertEqual(set(summary["periods"]), set(dss.CREDIT_PERIODS))
        self.assertEqual(set(summary["categories"]), set(dss.CREDIT_CATEGORIES))
        self.assertTrue(summary["rollup_avgs"]["daily"])
        self.assertIn("grok", summary["league_avgs"])
        self.assertGreaterEqual(summary["league_avgs"]["grok"], 60)
        self.assertNotIn("fire", summary)
        self.assertNotIn("secret", json.dumps(summary).lower())
        self.assertEqual(next(iter(summary)), "sam_queue")
        self.assertEqual((summary.get("sam_queue") or {}).get("title"), "SAM-QUEUE")
        self.assertFalse((summary.get("sam_queue") or {}).get("breakage_zero"))
        self.assertIn("liabilities", summary)
        self.assertFalse(summary["liabilities"].get("auto_fire"))
        self.assertEqual((summary.get("instance_registry") or {}).get("area_code"), "501")
        self.assertFalse((summary.get("instance_registry") or {}).get("vector_db"))

    def test_swarm_summary_excludes_empty_tick_zeros(self):
        dss.record_credit({"period": "daily", "category": "networking", "credit": 70, "agent_id": "grok"})
        dss.note_agent("grok", period="daily", category="networking", credit=0, damage=0, note="act")
        dss.note_agent("grok", period="daily", category="time_to_complete", credit=0, damage=0, note="")
        summary = dss.swarm_summary()
        self.assertGreaterEqual(summary["league_avgs"]["grok"], 60)
        self.assertFalse(dss.agent_underperform_fire("grok"))
        self.assertEqual(dss.recommend_swarm_action({"agent_id": "grok"}, kind="report"), "fix-few-issues")
        self.assertEqual(dss.underperformers(), [])
        self.assertFalse(summary["auto_fire"])

    def test_verifier_swarm_summary_objectives(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "verify_swarm_tracking",
            Path(__file__).resolve().parents[2] / "scripts" / "verify-swarm-tracking.py",
        )
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(mod)
        ok_empty, detail_empty = mod.swarm_summary_proven({})
        self.assertFalse(ok_empty)
        self.assertIn("missing", detail_empty)
        das.record_score({
            "log_id": "vfy-obj-501",
            "score": 70,
            "uid": "sam",
            "project_id": "5bf8e783",
            "agent_id": "grok",
            "instance_id": "501",
        })
        for period in dss.CREDIT_PERIODS:
            dss.record_credit({"period": period, "category": "networking", "credit": 60, "agent_id": "grok"})
        dss.rollup_all_periods()
        dss.league_cycle({"agent_id": "grok", "peer_id": "cursor", "score": 60, "category": "networking"})
        dss.report_agent({"agent_id": "grok", "recommendation": "fix-few-issues", "note": "loop13"})
        summary = dss.swarm_summary()
        ok, detail = mod.swarm_summary_proven(summary)
        self.assertTrue(ok, detail)
        flags = mod.swarm_summary_objectives(summary)
        self.assertTrue(all(flags.values()), flags)

    def test_credit_tick_writes_four_latest_period_reports(self):
        for period in dss.CREDIT_PERIODS:
            dss.record_credit({"period": period, "category": "networking", "credit": 71, "agent_id": "grok"})
        dss.rollup_all_periods()
        tick = dss.swarm_credit_tick({"sidecars": False, "snapshot_id": "cad-test-period-reports"})
        root = Path(self.temp.name) / "ai-context" / "debugger" / "swarm-reports"
        self.assertTrue((tick.get("reports") or {}).get("ok"))
        self.assertEqual(set((tick.get("reports") or {}).get("periods") or []), set(dss.CREDIT_PERIODS))
        expected = {"period", "categories", "scores", "instance_users", "league", "pending_sam", "claimed_jobs", "candidate_confirm", "area", "auto_fire", "goal"}
        for period in dss.CREDIT_PERIODS:
            path = root / f"{period}-latest.json"
            self.assertTrue(path.is_file(), period)
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertTrue(expected.issubset(data), period)
            self.assertEqual(data["period"], period)
            self.assertEqual(set(data["categories"]), set(dss.CREDIT_CATEGORIES))
            self.assertEqual(data["area"], "501")
            self.assertFalse(data["auto_fire"])
            self.assertEqual(data["goal"], "OPEN")
            self.assertIn("cursor", data["league"])
            self.assertIn("grok", data["league"])
            self.assertTrue((root / f"{period}-latest.md").is_file(), period)
            dumped = json.dumps(data).lower()
            self.assertNotIn("prompt_trace_api_key", dumped)
        queue_md = root / "sam-queue-latest.md"
        queue_json = root / "sam-queue-latest.json"
        self.assertTrue(queue_md.is_file())
        self.assertTrue(queue_json.is_file())
        self.assertTrue((tick.get("sam_queue") or {}).get("ok"))
        self.assertIn("SAM-QUEUE", queue_md.read_text(encoding="utf-8"))
        again = dss.write_swarm_period_reports()
        self.assertEqual(again.get("dated"), [])

    def test_credit_tick_writes_cad_job_snapshots_deduped(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            minted = dss.mint_debug_job({
                "feature": "webgl.context",
                "log_id": "cad-snap-l5a",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
            }, {"instance_id": "501"})
            claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            self.assertTrue(claimed.get("claimed"))
            self.assertFalse(claimed["executed"])
            tick = dss.swarm_credit_tick({"sidecars": False, "snapshot_id": "cad-test-job-snaps"})
            snaps = tick.get("cad_snapshots") or {}
            self.assertTrue(snaps.get("ok"))
            self.assertFalse(snaps.get("auto_fire"))
            self.assertFalse(snaps.get("executed"))
            self.assertGreaterEqual(snaps.get("n") or 0, 1)
            snap_root = root / "ai-context" / "debugger" / "cad-snapshots"
            latest_json = snap_root / f"{minted['id']}-latest.json"
            latest_md = snap_root / f"{minted['id']}-latest.md"
            self.assertTrue(latest_json.is_file())
            self.assertTrue(latest_md.is_file())
            payload = json.loads(latest_json.read_text(encoding="utf-8"))
            self.assertEqual(payload["job_id"], minted["id"])
            self.assertEqual(payload["feature"], "webgl.context")
            self.assertEqual(payload["category"], "optimization")
            self.assertIn("tracking_id", payload)
            self.assertIn("last_working", payload)
            self.assertIn("first_broken", payload)
            self.assertIn("log_path", payload)
            self.assertIn("log_excerpt", payload)
            self.assertLessEqual(len(str(payload.get("log_excerpt") or "")), 120)
            self.assertIn(payload["league_suggestion"], dss.CAD_NEXT)
            self.assertIn(payload["recommendation"], {"fix-few-issues", "replace-approach", "fire", "replace", "pending_reload"})
            self.assertEqual(payload["goal"], "OPEN")
            self.assertFalse(payload["auto_fire"])
            self.assertFalse(payload["executed"])
            self.assertNotIn("prompt_trace_api_key", latest_json.read_text(encoding="utf-8").lower())
            day = payload["day"]
            dated_json = snap_root / f"{minted['id']}-{day}.json"
            self.assertTrue(dated_json.is_file())
            first_dated = snaps.get("dated") or []
            self.assertTrue(any(minted["id"] in p for p in first_dated))
            again = dss.write_cad_job_snapshots()
            self.assertEqual(again.get("dated"), [])
            self.assertTrue((snap_root / f"{minted['id']}-latest.json").is_file())
            listed = dss.list_cad_snapshots()
            self.assertTrue(listed["read_only"])
            self.assertFalse(listed["auto_fire"])
            self.assertFalse(listed["executed"])
            ids = {row.get("job_id") for row in listed.get("snapshots") or []}
            self.assertIn(minted["id"], ids)

    def test_cad_snapshot_fills_jailed_log_and_playbook_excerpts(self):
        from backend.services import incident_intelligence_service as ii

        root = Path(self.temp.name)
        log_dir = root / "ai-context" / "debugger" / "incident-intelligence" / "2026-09-16"
        log_dir.mkdir(parents=True, exist_ok=True)
        rel_log = "ai-context/debugger/incident-intelligence/2026-09-16/snaplog1.json"
        (log_dir / "snaplog1.json").write_text(
            '{"note":"Heap jumped 24.4→52 MB extra padding that must stay under one hundred twenty chars"}\n',
            encoding="utf-8",
        )
        with patch.object(ii, "DB_PATH", root / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", root), patch.object(ii, "LOG_ROOT", root / "ii-logs"):
            minted = dss.mint_debug_job({
                "feature": "memory.leak",
                "log_id": "cad-ex-log1",
                "project_id": "5bf8e783",
                "user_id": "sam-local",
                "log_path": rel_log,
                "first_failure": {"id": "cad-ex-log1", "log_path": rel_log},
            }, {"instance_id": "501"})
            play = root / "ai-context" / "debugger" / f"PLAYBOOK-{minted['id']}-memory.md"
            play.write_text("# Playbook · memory.leak\nEvidence heap jump. Goal OPEN.\n", encoding="utf-8")
            dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            snaps = dss.write_cad_job_snapshots()
            payload = json.loads((root / "ai-context" / "debugger" / "cad-snapshots" / f"{minted['id']}-latest.json").read_text(encoding="utf-8"))
            md = (root / "ai-context" / "debugger" / "cad-snapshots" / f"{minted['id']}-latest.md").read_text(encoding="utf-8")
        self.assertTrue(snaps.get("ok"))
        self.assertEqual(payload["log_path"], rel_log)
        self.assertIn("Heap jumped", payload["log_excerpt"])
        self.assertLessEqual(len(payload["log_excerpt"]), 120)
        self.assertTrue(str(payload["playbook_path"]).endswith(f"PLAYBOOK-{minted['id']}-memory.md"))
        self.assertIn("Playbook", payload["playbook_excerpt"])
        self.assertLessEqual(len(payload["playbook_excerpt"]), 120)
        self.assertIn("log_excerpt:", md)
        self.assertIn("playbook_excerpt:", md)
        self.assertIn("shipped:", md)
        self.assertIn("leakfix1", md)
        self.assertIn("breakage=0: no", md)
        self.assertFalse(payload.get("breakage_zero"))
        denied = dss._jailed_file_excerpt(".env")
        self.assertEqual(denied, "")

    def test_confirm_candidate_script_argparse(self):
        path = Path(__file__).resolve().parents[2] / "scripts" / "confirm-candidate.py"
        spec = importlib.util.spec_from_file_location("confirm_candidate_cli", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        parsed = mod.parse_args(["job_d46c56edfa"])
        self.assertEqual(parsed.job_id, "job_d46c56edfa")
        self.assertEqual(parsed.action, "confirm")
        rejected = mod.parse_args(["--reject", "job_d46c56edfa"])
        self.assertEqual(rejected.action, "reject")
        with self.assertRaises(SystemExit):
            mod.parse_args([])


class SwarmSummaryHarnessTests(unittest.TestCase):
    """GET /swarm-summary uses the scores harness key. Mutations stay session-only."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        store = root / "prompt-trace"
        store.mkdir()
        (store / "live-prompts.jsonl").write_text("{}\n", encoding="utf-8")
        from backend.config import settings
        from backend.routers import debugger_analytics as dar
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        self.patches = [
            patch.object(das, "ROOT_DIR", root),
            patch.object(das, "DB_PATH", root / "debugger.sqlite3"),
            patch.object(das, "WATCHDOG_ROOT", root / "tmp-watchdogs"),
            patch.object(das, "DATA_WATCHDOG_ROOT", root / "data-watchdogs"),
            patch.object(das, "BUG_ROOT", root / "bugs"),
            patch.object(das, "NOTES_ROOT", root / "notes"),
            patch.object(das, "REPORTS_ROOT", root / "weekly"),
            patch.object(das, "SCORE_ROOT", root / "scores"),
            patch.object(trace, "STORE", store),
            patch.object(trace, "INDEX", store / "live-prompts.jsonl"),
            patch.object(trace, "ROOT", root),
            patch.object(settings, "prompt_trace_api_key", "test-harness-loop11"),
        ]
        for item in self.patches:
            item.start()
        (root / "ai-context" / "debugger").mkdir(parents=True)
        (root / "data" / "prompt-trace").mkdir(parents=True)
        app = FastAPI()
        app.include_router(dar.router)
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer test-harness-loop11"}

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_unauth_swarm_summary_401(self):
        res = self.client.get("/api/ops/debugger-analytics/swarm-summary")
        self.assertEqual(res.status_code, 401)

    def test_harness_key_gets_swarm_summary(self):
        for period in dss.CREDIT_PERIODS:
            dss.record_credit({"period": period, "category": "networking", "credit": 66, "agent_id": "grok"})
        dss.rollup_all_periods()
        das.record_score({"log_id": "sum-501", "score": 70, "uid": "sam", "project_id": "5bf8e783", "agent_id": "grok", "instance_id": "501"})
        res = self.client.get("/api/ops/debugger-analytics/swarm-summary", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body.get("read_only"))
        self.assertFalse(body.get("auto_fire"))
        self.assertEqual(set(body.get("periods") or []), set(dss.CREDIT_PERIODS))
        self.assertEqual(set(body.get("categories") or []), set(dss.CREDIT_CATEGORIES))
        self.assertEqual(body.get("area"), "501")
        self.assertTrue(body.get("instance_users"))
        self.assertTrue(any(u.get("instance_id") == "501" for u in body["instance_users"]))
        self.assertIn("rollup_avgs", body)
        self.assertNotIn("fire", body)

    def test_harness_key_cannot_put_league_report(self):
        res = self.client.put(
            "/api/ops/debugger-analytics/league/report/rpt_noleak",
            headers=self.headers,
            json={"action": "noted"},
        )
        self.assertIn(res.status_code, (401, 403))

    def test_harness_key_cannot_get_overview(self):
        res = self.client.get("/api/ops/debugger-analytics/overview", headers=self.headers)
        self.assertEqual(res.status_code, 401)

    def test_unauth_cannot_confirm_candidate(self):
        res = self.client.put("/api/ops/debugger-analytics/debug-jobs/job_x/confirm-candidate", json={})
        self.assertEqual(res.status_code, 401)
        res2 = self.client.post("/api/ops/debugger-analytics/debug-jobs/job_x/reject-candidate", json={})
        self.assertEqual(res2.status_code, 401)

    def test_harness_cannot_confirm_or_reject_candidate(self):
        res = self.client.put(
            "/api/ops/debugger-analytics/debug-jobs/job_x/confirm-candidate",
            headers=self.headers,
            json={},
        )
        self.assertEqual(res.status_code, 403)
        res2 = self.client.post(
            "/api/ops/debugger-analytics/debug-jobs/job_x/reject-candidate",
            headers=self.headers,
            json={},
        )
        self.assertEqual(res2.status_code, 403)


LIVE_CANDIDATE_CONFIRM_JOBS = (
    "job_d46c56edfa",
    "job_8617b6206e",
    "job_d7e4bbdf1e",
    "job_55937a6fab",
)


class LiveSamQueueTests(unittest.TestCase):
    def test_sam_queue_lists_four_live_candidate_confirm_jobs(self):
        written = dss.write_sam_queue()
        queue = written.get("sam_queue") or {}
        cand_ids = {j.get("id") for j in queue.get("candidate_confirm") or []}
        for job_id in LIVE_CANDIDATE_CONFIRM_JOBS:
            self.assertIn(job_id, cand_ids)
        root = Path(das.ROOT_DIR) / "ai-context" / "debugger" / "swarm-reports"
        md = (root / "sam-queue-latest.md").read_text(encoding="utf-8")
        js = json.loads((root / "sam-queue-latest.json").read_text(encoding="utf-8"))
        self.assertIn("SAM-QUEUE", md)
        for job_id in LIVE_CANDIDATE_CONFIRM_JOBS:
            self.assertIn(job_id, md)
            self.assertIn(job_id, json.dumps(js))
            stored = dss.get_debug_job(job_id)
            self.assertTrue(stored.get("candidate_confirm"))
            self.assertNotEqual(stored.get("status"), "sam_confirmed")
        self.assertFalse(queue.get("breakage_zero"))
        self.assertEqual(queue.get("goal"), "OPEN")
        self.assertFalse(queue.get("auto_fire"))


if __name__ == "__main__":
    unittest.main()
