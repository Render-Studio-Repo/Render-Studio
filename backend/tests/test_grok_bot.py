"""Grok bot authorized app + MCP wiring (no live tweets)."""

from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import grok_bot_service

ROOT = Path(__file__).resolve().parents[2]
MCP_SERVER = ROOT / "mcp" / "grok-bot" / "server.py"


class GrokBotServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        grok_bot_service.ensure_schema()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u1", "ada@example.com", "Ada", "x", "2026-09-16T00:00:00+00:00"),
            )
        self.user = {"id": "u1", "email": "ada@example.com"}
        self.sb = patch("backend.services.supabase_users_store.enabled", return_value=False)
        self.sb.start()
        self.sb_get = patch("backend.services.supabase_users_store.get_by_id", return_value=None)
        self.sb_get.start()
        self.sb_x = patch("backend.services.supabase_users_store.x_consumer_credentials", return_value=None)
        self.sb_x.start()
        self.sb_set = patch("backend.services.supabase_users_store.set_x_consumer_credentials", return_value=False)
        self.sb_set.start()
        self.sb_bot = patch("backend.services.supabase_users_store.x_bot_token", return_value=None)
        self.sb_bot.start()
        self.sb_set_bot = patch("backend.services.supabase_users_store.set_x_bot_token", return_value=False)
        self.sb_set_bot.start()
        self.sb_patch = patch("backend.services.supabase_users_store.patch_user", return_value=True)
        self.sb_patch.start()

    def tearDown(self) -> None:
        self.sb_patch.stop()
        self.sb_set_bot.stop()
        self.sb_bot.stop()
        self.sb_set.stop()
        self.sb_x.stop()
        self.sb_get.stop()
        self.sb.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_connect_status_hides_secret_and_disconnect_keeps_x_keys(self) -> None:
        with patch.object(grok_bot_service, "_store_xai_key"):
            out = grok_bot_service.connect(
                self.user,
                {"consumer_key": "ckTESTAPPKEY12345", "consumer_secret": "super-secret-consumer"},
            )
        dumped = json.dumps(out)
        self.assertTrue(out["connected"])
        self.assertTrue(out["has_x_app"])
        self.assertIn("ckTESTAPPKEY12345"[-4:], out.get("x_consumer_key_hint") or "")
        self.assertNotIn("super-secret-consumer", dumped)
        off = grok_bot_service.disconnect(self.user)
        self.assertFalse(off["connected"])
        self.assertTrue(off["has_x_app"])
        stored = grok_bot_service._load_x_keys("u1")
        self.assertEqual(stored[0], "ckTESTAPPKEY12345")
        self.assertEqual(stored[1], "super-secret-consumer")

    def test_connect_xchat_bot_token_can_post_and_never_echoes_secret(self) -> None:
        token = "xcbot_TESTONLY_not_a_live_token"
        out = grok_bot_service.connect(self.user, {"bot_token": token})
        dumped = json.dumps(out)
        self.assertTrue(out["connected"])
        self.assertTrue(out["has_x_bot"])
        self.assertTrue(out["can_post"])
        self.assertNotIn(token, dumped)
        self.assertNotIn("TESTONLY", dumped)
        draft = grok_bot_service.draft_or_post(self.user, "hello from bot", confirm=False)
        self.assertTrue(draft["dry_run"])
        self.assertFalse(draft["posted"])
        self.assertEqual(grok_bot_service._load_bot_token("u1"), token)

    def test_x_post_defaults_to_dry_run(self) -> None:
        grok_bot_service.connect(
            self.user,
            {"consumer_key": "ckTESTAPPKEY12345", "consumer_secret": "super-secret-consumer"},
        )
        draft = grok_bot_service.draft_or_post(self.user, "hello from grok bot", confirm=False)
        self.assertTrue(draft["dry_run"])
        self.assertFalse(draft["posted"])

    def test_wiring_has_numbered_steps_and_mcp_json_without_secrets(self) -> None:
        payload = grok_bot_service.wiring_payload()
        self.assertGreaterEqual(len(payload["steps"]), 6)
        snippet = json.dumps(payload["mcp_json"])
        self.assertIn("grok-bot", snippet)
        self.assertIn("mcp/grok-bot/server.py", snippet)
        self.assertNotIn("super-secret", snippet)
        self.assertEqual(payload["mcp_json"]["mcpServers"]["grok-bot"]["env"]["X_CONSUMER_SECRET"], "")
        self.assertEqual(payload["launch_agent"], "com.render3d.grok-bot")
        self.assertEqual(payload["mcp_http"], "https://render3d.app/mcp")
        self.assertEqual(payload["clips_board"], "https://render3d.app/mcp/clips")
        self.assertTrue(any("8744" in step or "LaunchAgent" in step for step in payload["steps"]))
        self.assertTrue(any("render3d.app/mcp" in step for step in payload["steps"]))
        self.assertTrue(any("/api/webhooks/x" in step for step in payload["steps"]))


class GrokBotMcpTests(unittest.TestCase):
    def setUp(self) -> None:
        self._prev_transcript_roots = os.environ.get("CURSOR_TRANSCRIPT_ROOTS")
        os.environ["CURSOR_TRANSCRIPT_ROOTS"] = ""
        spec = importlib.util.spec_from_file_location("grok_bot_mcp_server", MCP_SERVER)
        self.mod = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(self.mod)

    def tearDown(self) -> None:
        if self._prev_transcript_roots is None:
            os.environ.pop("CURSOR_TRANSCRIPT_ROOTS", None)
        else:
            os.environ["CURSOR_TRANSCRIPT_ROOTS"] = self._prev_transcript_roots

    def test_tools_list_includes_chat_status_wiring(self) -> None:
        reply = self.mod.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        names = {t["name"] for t in reply["result"]["tools"]}
        self.assertIn("grok_sandbox", names)
        self.assertIn("grok_group_chat", names)
        self.assertIn("grok_status", names)
        self.assertIn("grok_vote", names)
        required = {
                "grok_incident",
                "grok_debugger",
                "grok_status",
                "agent_intro_pack",
                "agent_intro_handshake",
                "agent_sandbox_reset",
                "agent_sandbox_run",
                "agent_refpack_upload",
                "grok_chat",
                "grok_wiring",
                "grok_marketing",
                "agent_bus_submit",
                "agent_bus_inbox",
                "agent_ops_submit",
                "agent_ops_similar",
                "pm_prompt_kit",
                "pm_prompt_submit",
                "pm_prompt_status",
                "agent_hello",
                "agent_converse",
                "mcp_watchdog_status",
                "rm_queue",
                "comms_webhook_register",
                "comms_broadcast",
                "team_status_now",
                "pm_goals_submit",
                "grok_auth_event",
                "grok_auth_status",
                "grok_key_index",
                "grok_group_chat",
                "grok_sandbox",
                "grok_tweet_for_agent",
                "grok_request_clip",
                "grok_clip_status",
                "grok_clips",
                "grok_clip_grab",
                "grok_clip_wait",
                "x_post",
                "grok_music_request",
                "grok_music_library",
                "grok_social_post",
                "grok_social_checkin",
                "grok_social_weekly",
                "grok_taste",
            }
        self.assertTrue(required <= names)

    def test_x_post_tool_is_draft_without_confirm(self) -> None:
        reply = self.mod.handle(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "x_post", "arguments": {"text": "no live tweet"}},
            }
        )
        text = reply["result"]["content"][0]["text"]
        self.assertIn("dry_run", text)
        payload = json.loads(text)
        self.assertTrue(payload["dry_run"])
        self.assertFalse(payload["posted"])

    def test_auth_event_does_not_store_totp(self) -> None:
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        tmp = Path(tempfile.mkdtemp()) / "auth-events.jsonl"
        with patch.object(self.mod, "AUTH_LOG", tmp):
            reply = self.mod.handle(
                {
                    "jsonrpc": "2.0",
                    "id": 9,
                    "method": "tools/call",
                    "params": {
                        "name": "grok_auth_event",
                        "arguments": {
                            "plugin": "plugin-google-drive-google-drive",
                            "email": "lawfirmreports@gmail.com",
                            "status": "connected",
                        },
                    },
                }
            )
        payload = json.loads(reply["result"]["content"][0]["text"])
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["logged"]["totp_stored"])
        self.assertEqual(payload["logged"]["agent"], "project-manager")
        blob = tmp.read_text(encoding="utf-8")
        self.assertNotIn("totp", blob.lower().replace("totp_stored", ""))
        self.assertIn("lawfirmreports@gmail.com", blob)

    def test_incident_guide_loads_debug_path_tracer(self) -> None:
        reply = self.mod.handle(
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "grok_incident", "arguments": {"action": "guide"}},
            }
        )
        payload = json.loads(reply["result"]["content"][0]["text"])
        self.assertIn("skill", payload)
        self.assertEqual(payload["debug_path_tracer_path"], "mcp/grok-bot/DEBUG-PATH-TRACER.md")
        self.assertIn("Debug path tracer", payload["debug_path_tracer"])
        self.assertIn("occurred_at", payload["debug_path_tracer"])
        self.assertNotRegex(payload["debug_path_tracer"], r"(?i)(xai-|sk-|x_consumer_secret\s*=)")

    def test_debugger_swarm_summary_offline_when_studio_404(self) -> None:
        from backend.services import debugger_analytics_service as das
        from backend.services import debugger_swarm_service as dss
        from backend.services import prompt_trace_service as trace

        tool = next(t for t in self.mod.TOOLS if t["name"] == "grok_debugger")
        self.assertIn("swarm_summary", tool["inputSchema"]["properties"]["action"]["enum"])
        self.assertIn("instance_registry", tool["inputSchema"]["properties"]["action"]["enum"])
        self.assertIn("cad_votes", tool["inputSchema"]["properties"]["action"]["enum"])
        self.assertIn("record_cad_vote", tool["inputSchema"]["properties"]["action"]["enum"])
        self.assertIn("cad_snapshots", tool["inputSchema"]["properties"]["action"]["enum"])
        self.assertIn("stamp_feature", tool["inputSchema"]["properties"]["action"]["enum"])
        self.assertIn("readonly_cli", tool["inputSchema"]["properties"]["action"]["enum"])
        self.assertIn("cli_readonly", tool["inputSchema"]["properties"]["action"]["enum"])
        tmp = Path(tempfile.mkdtemp())
        store = tmp / "prompt-trace"
        store.mkdir()
        (store / "live-prompts.jsonl").write_text("{}\n", encoding="utf-8")
        patches = [
            patch.object(self.mod, "_studio", side_effect=RuntimeError("HTTP 404: Not Found")),
            patch.object(das, "ROOT_DIR", tmp),
            patch.object(das, "DB_PATH", tmp / "debugger.sqlite3"),
            patch.object(das, "WATCHDOG_ROOT", tmp / "tmp-watchdogs"),
            patch.object(das, "DATA_WATCHDOG_ROOT", tmp / "data-watchdogs"),
            patch.object(das, "BUG_ROOT", tmp / "bugs"),
            patch.object(das, "NOTES_ROOT", tmp / "notes"),
            patch.object(das, "REPORTS_ROOT", tmp / "weekly"),
            patch.object(das, "SCORE_ROOT", tmp / "scores"),
            patch.object(trace, "STORE", store),
            patch.object(trace, "INDEX", store / "live-prompts.jsonl"),
            patch.object(trace, "ROOT", tmp),
        ]
        for item in patches:
            item.start()
        (tmp / "ai-context" / "debugger").mkdir(parents=True)
        (tmp / "data" / "prompt-trace").mkdir(parents=True)
        try:
            for period in dss.CREDIT_PERIODS:
                dss.record_credit({"period": period, "category": "networking", "credit": 55, "agent_id": "grok"})
            dss.rollup_all_periods()
            out = self.mod._call_tool("grok_debugger", {"action": "swarm_summary"})
            self.assertEqual(out.get("via"), "local")
            self.assertTrue(out.get("read_only"))
            self.assertFalse(out.get("auto_fire"))
            self.assertEqual(set(out.get("periods") or []), set(dss.CREDIT_PERIODS))
            self.assertEqual(set(out.get("categories") or []), set(dss.CREDIT_CATEGORIES))
            self.assertEqual(out.get("area"), "501")
            self.assertTrue(out.get("rollup_avgs"))
            self.assertIn("candidate_confirm", out)
            self.assertIn("sam_queue", out)
            self.assertEqual((out.get("sam_queue") or {}).get("title"), "SAM-QUEUE")
            self.assertFalse((out.get("sam_queue") or {}).get("breakage_zero"))
            self.assertIn("liabilities", out)
            self.assertIn("liabilities", out.get("sam_queue") or {})
            dss.register_user({
                "user_id": "sam-mcp",
                "instance_id": "501",
                "project_id": "5bf8e783",
                "log_id": "d9c98119-l62m",
                "agent_id": "grok",
            })
            area = self.mod._call_tool("grok_debugger", {"action": "instance_registry", "q": "501"})
            self.assertEqual(area.get("via"), "local")
            self.assertEqual(area.get("area_code"), "501")
            self.assertFalse(area.get("vector_db"))
            self.assertTrue(any(u.get("id") == "sam-mcp" for u in area.get("users") or []))
            jobs = self.mod._call_tool("grok_debugger", {"action": "debug_jobs"})
            self.assertEqual(jobs.get("via"), "local")
            self.assertIn("candidate_confirm", jobs)
            self.assertIn("jobs", jobs)
            self.assertFalse(jobs.get("executed"))
            snap_dir = tmp / "ai-context" / "debugger" / "cad-snapshots"
            snap_dir.mkdir(parents=True, exist_ok=True)
            (snap_dir / "job_mcpcad16-latest.json").write_text(
                json.dumps({
                    "job_id": "job_mcpcad16",
                    "feature": "webgl.context",
                    "league_suggestion": "fix-few-issues",
                    "auto_fire": False,
                    "executed": False,
                    "goal": "OPEN",
                }),
                encoding="utf-8",
            )
            snaps = self.mod._call_tool("grok_debugger", {"action": "cad_snapshots"})
            self.assertEqual(snaps.get("via"), "local")
            self.assertTrue(snaps.get("read_only"))
            self.assertFalse(snaps.get("auto_fire"))
            self.assertFalse(snaps.get("executed"))
            self.assertTrue(any(row.get("job_id") == "job_mcpcad16" for row in snaps.get("snapshots") or []))
        finally:
            for item in reversed(patches):
                item.stop()

    def test_debugger_history_offline_when_studio_404(self) -> None:
        from backend.services import debugger_analytics_service as das
        from backend.services import prompt_trace_service as trace

        tmp = Path(tempfile.mkdtemp())
        store = tmp / "prompt-trace"
        store.mkdir()
        (store / "live-prompts.jsonl").write_text(
            '{"log_id":"hist-off","chat_id":"chat-off","timestamp":"t1","prompt":"' + ("H" * 200) + '"}\n',
            encoding="utf-8",
        )
        patches = [
            patch.object(self.mod, "_studio", side_effect=RuntimeError("HTTP 404: Not Found")),
            patch.object(das, "ROOT_DIR", tmp),
            patch.object(das, "DB_PATH", tmp / "debugger.sqlite3"),
            patch.object(das, "WATCHDOG_ROOT", tmp / "tmp-watchdogs"),
            patch.object(das, "DATA_WATCHDOG_ROOT", tmp / "data-watchdogs"),
            patch.object(das, "BUG_ROOT", tmp / "bugs"),
            patch.object(das, "NOTES_ROOT", tmp / "notes"),
            patch.object(das, "REPORTS_ROOT", tmp / "weekly"),
            patch.object(das, "SCORE_ROOT", tmp / "scores"),
            patch.object(trace, "STORE", store),
            patch.object(trace, "INDEX", store / "live-prompts.jsonl"),
            patch.object(trace, "ROOT", tmp),
        ]
        for item in patches:
            item.start()
        (tmp / "ai-context" / "debugger").mkdir(parents=True)
        (tmp / "data" / "prompt-trace").mkdir(parents=True)
        try:
            out = self.mod._call_tool("grok_debugger", {"action": "history", "q": "hist-off"})
            self.assertEqual(out.get("via"), "local")
            self.assertTrue(out.get("hits"))
            hit = out["hits"][0]
            self.assertEqual(hit["log_id"], "hist-off")
            self.assertLessEqual(len(hit["excerpt"]), 120)
            self.assertFalse(out.get("bodies"))
            catalog = self.mod._call_tool("grok_debugger", {"action": "catalog"})
            self.assertEqual(catalog.get("via"), "local")
            self.assertEqual(catalog.get("area"), "501")
            self.assertEqual(catalog.get("cap"), 160)
            self.assertIn("vision", catalog)
            self.assertFalse(catalog.get("auto_fire", False))
            (store / "live-prompts.jsonl").write_text(
                '{"log_id":"jsonl-off-1","prompt":"webgl lost","result":"broke","score":30,"user_id":"sam-mcp","project_id":"5bf8e783","broken":["webgl.context"]}\n',
                encoding="utf-8",
            )
            ingested = self.mod._call_tool("grok_debugger", {"action": "ingest_jsonl", "data": {"sidecars": False, "snapshot_id": "cad-mcp-jsonl"}})
            self.assertEqual(ingested.get("via"), "local")
            self.assertEqual(ingested.get("n_credited"), 1)
            self.assertFalse(ingested.get("auto_fire"))
            again = self.mod._call_tool("grok_debugger", {"action": "rollup_live", "data": {"sidecars": False}})
            self.assertEqual(again.get("n_credited"), 0)
            from backend.services import incident_intelligence_service as ii

            with patch.object(ii, "DB_PATH", tmp / "incident.sqlite3"), patch.object(ii, "ROOT_DIR", tmp), patch.object(ii, "LOG_ROOT", tmp / "ii-logs"):
                stamped = self.mod._call_tool("grok_debugger", {
                    "action": "stamp_feature",
                    "feature": "memory.leak",
                    "data": {"status": "broken", "user_id": "sam-mcp", "note": "unittest temp stamp"},
                })
                self.assertEqual(stamped.get("via"), "local")
                self.assertTrue(stamped.get("ok"))
                self.assertFalse(stamped.get("skipped"))
                self.assertEqual(stamped.get("feature"), "memory.leak")
                self.assertFalse(stamped.get("auto_fire"))
                again = self.mod._call_tool("grok_debugger", {"action": "stamp_feature", "feature": "memory.leak", "data": {"status": "broken"}})
                self.assertTrue(again.get("skipped"))
                kernel = self.mod._call_tool("grok_debugger", {"action": "stamp_feature", "feature": "prompt.run", "data": {"status": "broken"}})
                self.assertTrue(kernel.get("skipped"))
                self.assertEqual(kernel.get("reason"), "kernel")
            with self.assertRaises(RuntimeError) as blocked:
                self.mod._call_tool("grok_debugger", {"action": "approve", "data": {"kind": "cli", "id": "nope"}})
            self.assertIn("Fail-closed", str(blocked.exception))
            queued = self.mod._call_tool("grok_debugger", {"action": "readonly_cli", "q": "pwd"})
            self.assertEqual(queued.get("status"), "ran")
            self.assertTrue(queued.get("ran"))
            self.assertFalse(queued.get("shell"))
            alias = self.mod._call_tool("grok_debugger", {"action": "cli_readonly", "q": "date"})
            self.assertEqual(alias.get("status"), "ran")
        finally:
            for item in reversed(patches):
                item.stop()

    def test_debugger_confirm_candidate_mcp_requires_job_id(self) -> None:
        from backend.services import debugger_analytics_service as das
        from backend.services import debugger_swarm_service as dss
        from backend.services import prompt_trace_service as trace

        tool = next(t for t in self.mod.TOOLS if t["name"] == "grok_debugger")
        enum = tool["inputSchema"]["properties"]["action"]["enum"]
        self.assertIn("confirm_candidate", enum)
        self.assertIn("reject_candidate", enum)
        self.assertIn("job_id", tool["inputSchema"]["properties"])
        tmp = Path(tempfile.mkdtemp())
        store = tmp / "prompt-trace"
        store.mkdir()
        (store / "live-prompts.jsonl").write_text("{}\n", encoding="utf-8")
        patches = [
            patch.object(self.mod, "_studio", side_effect=RuntimeError("HTTP 404: Not Found")),
            patch.object(das, "ROOT_DIR", tmp),
            patch.object(das, "DB_PATH", tmp / "debugger.sqlite3"),
            patch.object(das, "WATCHDOG_ROOT", tmp / "tmp-watchdogs"),
            patch.object(das, "DATA_WATCHDOG_ROOT", tmp / "data-watchdogs"),
            patch.object(das, "BUG_ROOT", tmp / "bugs"),
            patch.object(das, "NOTES_ROOT", tmp / "notes"),
            patch.object(das, "REPORTS_ROOT", tmp / "weekly"),
            patch.object(das, "SCORE_ROOT", tmp / "scores"),
            patch.object(trace, "STORE", store),
            patch.object(trace, "INDEX", store / "live-prompts.jsonl"),
            patch.object(trace, "ROOT", tmp),
        ]
        for item in patches:
            item.start()
        (tmp / "ai-context" / "debugger").mkdir(parents=True)
        try:
            with self.assertRaises(ValueError) as missing:
                self.mod._call_tool("grok_debugger", {"action": "confirm_candidate"})
            self.assertIn("job_id required", str(missing.exception))
            with self.assertRaises(ValueError) as missing_reject:
                self.mod._call_tool("grok_debugger", {"action": "reject_candidate", "data": {}})
            self.assertIn("job_id required", str(missing_reject.exception))
            minted = dss.mint_debug_job({
                "feature": "viewport.models",
                "log_id": "mcp-cand-044",
                "project_id": "5bf8e783",
                "user_id": "sam-mcp",
            }, {"instance_id": "501"})
            claimed = dss.claim_debug_job({"agent_id": "grok", "job_id": minted["id"]})
            self.assertNotEqual(claimed["id"], "job_d46c56edfa")
            extra = dict(claimed.get("extra") or {})
            extra["candidate_confirm"] = True
            extra["claimed_by"] = "grok"
            with dss._conn() as conn:
                conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra), claimed["id"]))
            confirmed = self.mod._call_tool("grok_debugger", {"action": "confirm_candidate", "job_id": claimed["id"]})
            self.assertEqual(confirmed.get("status"), "sam_confirmed")
            self.assertTrue(confirmed.get("sam_confirmed"))
            self.assertFalse(confirmed.get("executed"))
            self.assertFalse(confirmed.get("breakage_zero"))
            self.assertEqual(confirmed.get("goal"), "OPEN")
            other = dss.mint_debug_job({
                "feature": "webgl.context",
                "log_id": "mcp-rej-044",
                "project_id": "5bf8e783",
                "user_id": "sam-mcp",
            }, {"instance_id": "501"})
            claimed2 = dss.claim_debug_job({"agent_id": "cursor", "job_id": other["id"]})
            extra2 = dict(claimed2.get("extra") or {})
            extra2["candidate_confirm"] = True
            extra2["claimed_by"] = "cursor"
            with dss._conn() as conn:
                conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra2), claimed2["id"]))
            n_before = len(dss.list_credit(period="daily", limit=40))
            rejected = self.mod._call_tool("grok_debugger", {"action": "reject_candidate", "job_id": claimed2["id"]})
            self.assertTrue(rejected.get("rejected"))
            self.assertFalse(rejected.get("breakage_zero"))
            self.assertIsNone(rejected.get("credit"))
            self.assertEqual(len(dss.list_credit(period="daily", limit=40)), n_before)
        finally:
            for item in reversed(patches):
                item.stop()

    def test_swarm_credit_tick_disabled_when_interval_zero(self):
        self.assertIsNone(self.mod.start_swarm_credit_tick(0))


class GrokBotHttpAndLaunchdTests(unittest.TestCase):
    def setUp(self) -> None:
        spec = importlib.util.spec_from_file_location("grok_bot_mcp_server", MCP_SERVER)
        self.mod = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(self.mod)

    def test_http_health_and_tools_list(self) -> None:
        import threading
        from http.server import ThreadingHTTPServer
        from urllib.request import Request, urlopen

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), self.mod.GrokBotHttpHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = httpd.server_address
            health = json.loads(urlopen(f"http://{host}:{port}/health", timeout=5).read().decode())
            self.assertTrue(health["ok"])
            self.assertEqual(health["name"], "grok-bot")
            req = Request(
                f"http://{host}:{port}/mcp",
                data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode(),
                method="POST",
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
            reply = json.loads(urlopen(req, timeout=5).read().decode())
            names = {t["name"] for t in reply["result"]["tools"]}
            self.assertIn("grok_status", names)
            self.assertIn("grok_wiring", names)
            self.assertIn("grok_request_clip", names)
            self.assertIn("grok_clips", names)
            self.assertIn("grok_clip_grab", names)
            self.assertIn("grok_music_request", names)
            self.assertIn("grok_taste", names)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_http_requires_bearer_when_token_configured(self) -> None:
        import threading
        from http.server import ThreadingHTTPServer
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen

        saved = os.environ.get("GROK_MCP_TOKEN")
        os.environ["GROK_MCP_TOKEN"] = "test-mcp-token-not-live"
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), self.mod.GrokBotHttpHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = httpd.server_address
            health = json.loads(urlopen(f"http://{host}:{port}/health", timeout=5).read().decode())
            self.assertTrue(health["ok"])
            with self.assertRaises(HTTPError) as blocked:
                urlopen(
                    Request(
                        f"http://{host}:{port}/mcp",
                        method="GET",
                        headers={"Authorization": "Bearer wrong-token-not-live"},
                    ),
                    timeout=5,
                )
            self.assertEqual(blocked.exception.code, 401)
            init = Request(
                f"http://{host}:{port}/mcp",
                data=json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {"name": "probe", "version": "0"},
                        },
                    }
                ).encode(),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
            )
            init_reply = json.loads(urlopen(init, timeout=5).read().decode())
            self.assertEqual(init_reply["result"]["serverInfo"]["name"], "grok-bot")
            req = Request(
                f"http://{host}:{port}/mcp",
                data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode(),
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": "Bearer test-mcp-token-not-live",
                },
            )
            reply = json.loads(urlopen(req, timeout=5).read().decode())
            names = {t["name"] for t in reply["result"]["tools"]}
            self.assertIn("grok_status", names)
        finally:
            httpd.shutdown()
            httpd.server_close()
            if saved is None:
                os.environ.pop("GROK_MCP_TOKEN", None)
            else:
                os.environ["GROK_MCP_TOKEN"] = saved

    def test_request_clip_writes_studio_dark_gif(self) -> None:
        import tempfile
        from unittest.mock import patch

        tmp = Path(tempfile.mkdtemp())
        media = tmp / "media"
        jobs = tmp / "jobs"
        inbox = tmp / "inbox.md"
        clip = self.mod._clip_harness()
        with patch.object(clip, "MEDIA_DIR", media):
            with patch.object(clip, "JOBS_DIR", jobs):
                with patch.object(clip, "INBOX", inbox):
                    out = clip.request_clip(
                        "Viewport finder",
                        "Cmd+F opens finder. Type a project. Open it.",
                    )
                    self.assertTrue(out.get("ok"), out)
                    self.assertEqual(out.get("status"), "done")
                    self.assertTrue((media / "viewport-finder.gif").is_file())
                    self.assertTrue(str(out.get("url") or "").endswith("/docs/media/viewport-finder.gif"))
                    self.assertTrue(inbox.is_file())
                    self.assertIn("Do **not** run paid Generate", inbox.read_text(encoding="utf-8"))
                    board = clip.clips_board()
                    self.assertEqual(board["ready_count"], 1)
                    grabbed = clip.mark_grabbed(str(out["id"]), grabbed_by="test")
                    self.assertTrue(grabbed.get("grabbed"))
                    self.assertEqual(clip.clips_board(ungrabbed=True)["ready_count"], 0)
                    waited = clip.wait_for_job(str(out["id"]), 2)
                    self.assertTrue(waited.get("ok"))
                    self.assertFalse(waited.get("timeout"))

    def test_live_clip_returns_recording_and_wait_url(self) -> None:
        import tempfile
        from unittest.mock import patch

        tmp = Path(tempfile.mkdtemp())
        media = tmp / "media"
        jobs = tmp / "jobs"
        inbox = tmp / "inbox.md"
        clip = self.mod._clip_harness()
        with patch.object(clip, "MEDIA_DIR", media), patch.object(clip, "JOBS_DIR", jobs), patch.object(
            clip, "INBOX", inbox
        ), patch.object(clip, "_live_worker"):
            out = clip.request_clip(
                "Canvas workspace (live site)",
                "Live Render Studio UI on render3d.app via Playwright",
                live=True,
            )
            self.assertEqual(out.get("status"), "recording")
            pub = clip.job_public(clip.read_job(out["id"]))
            self.assertIn("wait=90", pub["wait_url"])
            waited = clip.wait_for_job(str(out["id"]), 1)
            self.assertTrue(waited.get("timeout"))
            self.assertEqual(waited.get("status"), "recording")

    def test_http_clip_board_create_list_and_grab(self) -> None:
        import tempfile
        import threading
        from http.server import ThreadingHTTPServer
        from unittest.mock import patch
        from urllib.request import Request, urlopen

        tmp = Path(tempfile.mkdtemp())
        media = tmp / "media"
        jobs = tmp / "jobs"
        inbox = tmp / "inbox.md"
        clip = self.mod._clip_harness()
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), self.mod.GrokBotHttpHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = httpd.server_address
            with patch.object(clip, "MEDIA_DIR", media), patch.object(clip, "JOBS_DIR", jobs), patch.object(
                clip, "INBOX", inbox
            ):
                create = Request(
                    f"http://{host}:{port}/mcp/clips",
                    data=json.dumps({"title": "Wiring", "prompt": "Open Wiring. Drop a motor. Connect 24V."}).encode(),
                    method="POST",
                    headers={"Content-Type": "application/json", "Accept": "application/json"},
                )
                created = json.loads(urlopen(create, timeout=20).read().decode())
                self.assertTrue(created.get("ok"), created)
                self.assertTrue(str(created.get("url") or "").endswith("/docs/media/wiring.gif"))
                board = json.loads(urlopen(f"http://{host}:{port}/mcp/clips", timeout=5).read().decode())
                self.assertGreaterEqual(board.get("ready_count") or 0, 1)
                jid = created["id"]
                grab = Request(
                    f"http://{host}:{port}/mcp/clips/{jid}/grab",
                    data=json.dumps({"by": "grok-bot"}).encode(),
                    method="POST",
                    headers={"Content-Type": "application/json"},
                )
                grabbed = json.loads(urlopen(grab, timeout=5).read().decode())
                self.assertTrue(grabbed.get("grabbed"))
                wiring = json.loads(urlopen(f"http://{host}:{port}/mcp/wiring", timeout=5).read().decode())
                self.assertIn("mcp/clips", json.dumps(wiring))
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_dotenv_loads_only_allowlisted_keys(self) -> None:
        env_file = Path(tempfile.mkdtemp()) / ".env"
        env_file.write_text("XAI_API_KEY=xai-test-not-live\nSTRIPE_SECRET_KEY=sk_live_should_not_load\n", encoding="utf-8")
        saved_xai = os.environ.pop("XAI_API_KEY", None)
        saved_stripe = os.environ.pop("STRIPE_SECRET_KEY", None)
        try:
            self.mod._load_dotenv_keys(env_file)
            self.assertEqual(os.environ.get("XAI_API_KEY"), "xai-test-not-live")
            self.assertIsNone(os.environ.get("STRIPE_SECRET_KEY"))
        finally:
            os.environ.pop("XAI_API_KEY", None)
            os.environ.pop("STRIPE_SECRET_KEY", None)
            if saved_xai is not None:
                os.environ["XAI_API_KEY"] = saved_xai
            if saved_stripe is not None:
                os.environ["STRIPE_SECRET_KEY"] = saved_stripe

    def test_launchd_plist_restarts_on_boot_and_failure(self) -> None:
        plist = (ROOT / "deploy" / "mac" / "com.render3d.grok-bot.plist").read_text(encoding="utf-8")
        script = (ROOT / "deploy" / "mac" / "run-grok-bot.sh").read_text(encoding="utf-8")
        self.assertIn("<string>com.render3d.grok-bot</string>", plist)
        self.assertIn("<key>RunAtLoad</key>", plist)
        self.assertIn("<key>KeepAlive</key>", plist)
        self.assertIn("<true/>", plist)
        self.assertIn("run-grok-bot.sh", plist)
        self.assertIn("while true", script)
        self.assertIn("--http", script)
        self.assertIn("restart in 2s", script)

    def test_sandbox_jails_writes_and_exposes_feed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "ok.md").write_text("# sandbox", encoding="utf-8")
            with patch.object(self.mod, "SANDBOX_DIR", root):
                listed = self.mod.grok_sandbox({"action": "list"})
                self.assertTrue(listed["ok"])
                self.assertEqual(listed["token"], "sandbox1")
                self.assertTrue(any(f["path"] == "ok.md" for f in listed["files"]))
                with self.assertRaises(ValueError):
                    self.mod._sandbox_resolve("../studio/app.js")
                with self.assertRaises(ValueError):
                    self.mod.grok_sandbox({"action": "write", "path": "../studio/app.js", "text": "nope"})
                wrote = self.mod.grok_sandbox({"action": "write", "path": "live-note.md", "text": "hot"})
                self.assertTrue(wrote["hot_reload"])
                self.assertTrue((root / "live-note.md").is_file())
                expl = self.mod.grok_sandbox({"action": "explain", "q": "last3"})
                self.assertTrue(expl["ok"])
                self.assertEqual(expl["token"], "harness1")
                self.assertTrue(expl["explain_only"])
                self.assertFalse(expl["auto_apply"])
                self.assertIn("d9c98119", expl["last3_example"])
                corr = self.mod.grok_sandbox({"action": "correct", "text": "That's wrong, change the kicker"})
                self.assertTrue(corr["hot_reload"])
                self.assertFalse(corr["auto_apply"])
                self.assertEqual(corr["token"], "harness1")
                self.assertTrue((root / "examples" / "live-correction.md").is_file())
                via_dbg = self.mod.handle({
                    "jsonrpc": "2.0",
                    "id": 9,
                    "method": "tools/call",
                    "params": {"name": "grok_debugger", "arguments": {"action": "explain_tracking", "q": "privileges"}},
                })
                body = via_dbg["result"]["content"][0]["text"] if isinstance(via_dbg.get("result"), dict) else str(via_dbg)
                self.assertIn("harness1", body)
        feed = self.mod.team_chat_feed({"limit": 5})
        self.assertTrue(feed["ok"])
        self.assertIn("messages", feed)
        self.assertEqual(feed["token"], "sandbox1")

    def test_grok_mujoco_run_reads_feed(self) -> None:
        sample = {
            "kind": "openarm_mujoco_analysis",
            "token": "mujoco1",
            "scene": "pedestal/pedestal.xml",
            "run_reason": "scene-ready",
            "feature_checks": {"openarm.ik_converged": "ok"},
            "ik_errors": {"left": {"pos_mm": 1.2}, "right": {"pos_mm": 0.8}},
        }
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            feed = root / "openarm-mujoco" / "runs"
            feed.mkdir(parents=True)
            (feed / "latest.json").write_text(json.dumps(sample), encoding="utf-8")
            with patch.object(self.mod, "SANDBOX_DIR", root):
                out = self.mod.grok_mujoco_run()
        self.assertTrue(out["ok"])
        self.assertEqual(out["token"], "mujoco1")
        self.assertEqual(out["summary"]["scene"], "pedestal/pedestal.xml")
        self.assertEqual(out["summary"]["ik_left_mm"], 1.2)

    def test_grok_robotics_runbook_returns_text(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "examples").mkdir()
            (root / "examples" / "robotics-runbook.md").write_text("# runbook\n", encoding="utf-8")
            with patch.object(self.mod, "SANDBOX_DIR", root):
                out = self.mod.grok_robotics_runbook()
        self.assertTrue(out["ok"])
        self.assertIn("runbook", out["text"])
        self.assertEqual(out["mujoco_feed"], "openarm-mujoco/runs/latest.json")

    def test_marketing_slides_and_decision_brief(self) -> None:
        slides = self.mod.grok_marketing_slides({"action": "deck"})
        self.assertTrue(slides["ok"])
        self.assertEqual(slides["token"], "mktpres1")
        self.assertEqual(slides["agent"], "vibe-marketing")
        self.assertGreaterEqual(len(slides["pages"]), 4)
        brief = self.mod.grok_decision_brief({"topic": "headset miss", "kind": "debug", "post": False})
        self.assertTrue(brief["ok"])
        self.assertEqual(brief["speaker"], "astra")
        self.assertIn("Risk:", brief["script"])
        self.assertGreaterEqual(len(brief["votes"]), 6)

    def test_pitch_deck_writes_sandbox_pdf_and_names_real_handles(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "examples").mkdir()
            with patch.object(self.mod, "SANDBOX_DIR", root):
                out = self.mod.grok_pitch_deck({"action": "generate", "post": False})
                self.assertTrue(out["ok"])
                self.assertEqual(out["token"], "mktpitch1")
                self.assertIn("a1_projects", out["handles"])
                self.assertIn("winstead_works", out["handles"])
                self.assertTrue((root / "examples" / "pitch-social-growth.md").is_file())
                pdf = (root / "examples" / "pitch-social-growth.pdf").read_bytes()
                self.assertTrue(pdf.startswith(b"%PDF"))
                self.assertFalse(out.get("auto_publish"))
                bench = self.mod.grok_rnd_benchmarks({"action": "plan", "post": False})
                self.assertEqual(bench["agent"], "vibe-rnd")
                self.assertIn("webgl_count=1", bench["metrics"])

    def test_cloudflare_routes_render3d_mcp_path_to_local_service(self) -> None:
        conf = (ROOT / "deploy" / "mac" / "cloudflare" / "config.yml").read_text(encoding="utf-8")
        self.assertIn("hostname: render3d.app", conf)
        self.assertIn("path: /mcp", conf)
        self.assertIn("path: ^/mcp", conf)
        self.assertIn("http://127.0.0.1:8744", conf)
        self.assertLess(conf.index("path: /mcp"), conf.index("service: http://127.0.0.1:8001"))
        main = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        self.assertIn('@app.api_route("/mcp"', main)
