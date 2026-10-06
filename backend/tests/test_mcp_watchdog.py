"""MCP comms watchdog: hello, converse, headcount, HTTP catalog."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import mcp_watchdog_service as wd

ROOT = Path(__file__).resolve().parents[2]
MCP_SERVER = ROOT / "mcp" / "grok-bot" / "server.py"


class McpWatchdogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.patches = [
            patch.object(wd, "STORE", root / "store"),
            patch.object(wd, "REPORT_MD", root / "store" / "REPORT-COMMS-20260916.md"),
            patch.object(wd, "EVENTS", root / "store" / "events.jsonl"),
            patch.object(wd, "STATE", root / "store" / "state.json"),
            patch.object(wd, "WEBHOOKS", root / "store" / "webhooks.json"),
            patch.object(wd, "BROADCAST", root / "store" / "broadcast.jsonl"),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_hello_then_converse_counts(self) -> None:
        hello = wd.hello({"agent": "project-manager"})
        self.assertTrue(hello["ok"])
        self.assertEqual(hello["headcount"]["hello"], 1)
        talk = wd.converse(
            {
                "agent": "project-manager",
                "vote": "mcp_star",
                "text": "Keep MCP star bus with conv_id thread_id msg_id. No DMs.",
            }
        )
        self.assertEqual(talk["headcount"]["opinions"], 1)
        self.assertEqual(talk["decision"], "mcp_star")
        snap = wd.snapshot()
        self.assertIn("conv-CYCLE-20260916-WD1-comms", snap["report_md"])
        self.assertTrue(any(e["url"].endswith("/mcp/watchdog") for e in snap["endpoints"]))

    def test_converse_to_cursor_writes_harness_inbox(self) -> None:
        inbox = Path(self.tmp.name) / "harness-inbox"
        with patch.object(wd, "HARNESS_INBOX", inbox):
            wd.hello({"agent": "project-manager"})
            talk = wd.converse(
                {
                    "agent": "project-manager",
                    "vote": "mcp_star",
                    "to": "cursor-engineer",
                    "text": "Ticket T-TEST-01 for the harness. Not posted as RM.",
                }
            )
            self.assertEqual(talk.get("to"), "cursor-engineer")
            self.assertTrue(talk.get("harness_inbox"))
            listed = wd.list_harness_inbox()
            self.assertTrue(listed["files"])
            ping = json.loads((inbox / listed["files"][0]).read_text(encoding="utf-8"))
            self.assertEqual(ping["from"], "project-manager")
            self.assertEqual(ping["to"], "cursor-engineer")
            self.assertEqual(ping["agent"], "project-manager")
            self.assertEqual(talk.get("code"), "COMM_QUEUED")
            self.assertFalse(talk.get("wake"))
            code, body, _ = wd.http_get("/mcp/harness-inbox")
            self.assertEqual(code, 200)
            self.assertIn(listed["files"][0], body.decode())

    def test_rm_queue_and_no_wake_code(self) -> None:
        inbox = Path(self.tmp.name) / "harness-inbox"
        with patch.object(wd, "HARNESS_INBOX", inbox):
            queued = wd.rm_queue({"agent": "project-manager", "text": "T-RPT-HTML-01"})
            self.assertEqual(queued["code"], "COMM_QUEUED")
            self.assertFalse(queued["wake"])
            fake = wd.converse({"agent": "cursor-engineer", "text": "impersonation"})
            self.assertEqual(fake.get("failure_code"), "COMM_NO_WAKE")
            self.assertFalse(fake.get("wake"))
            codes = wd.http_get("/mcp/comms-codes")
            self.assertEqual(codes[0], 200)
            self.assertIn("COMM_NO_WAKE", codes[1].decode())
            hooked = wd.ingest_webhook({"ping": "step1"})
            self.assertTrue(hooked["ok"])
            fail = wd.fanout_event({"kind": "test"})
            self.assertEqual(fail["code"], "COMM_BROADCAST")
            wd.register_webhook("http://127.0.0.1:9/nope")
            dead = wd.fanout_event({"kind": "test-fail"})
            self.assertEqual(dead["code"], "COMM_FANOUT_FAIL")

    def test_http_headcount(self) -> None:
        wd.hello({"agent": "analytics"})
        code, body, ctype = wd.http_get("/mcp/watchdog/headcount")
        self.assertEqual(code, 200)
        self.assertIn("json", ctype)
        data = json.loads(body.decode())
        self.assertEqual(data["headcount"]["hello"], 1)
        code, md, ct = wd.http_get("/mcp/watchdog/report.md")
        self.assertEqual(code, 200)
        self.assertIn("markdown", ct)
        self.assertIn("analytics", md.decode())


class McpWatchdogMcpTests(unittest.TestCase):
    def setUp(self) -> None:
        spec = importlib.util.spec_from_file_location("grok_bot_mcp_wd", MCP_SERVER)
        self.mod = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(self.mod)

    def test_tools_and_prompt(self) -> None:
        tools = {t["name"] for t in self.mod.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"]}
        self.assertIn("agent_hello", tools)
        self.assertIn("agent_converse", tools)
        self.assertIn("mcp_watchdog_status", tools)
        self.assertIn("rm_queue", tools)
        self.assertIn("comms_webhook_register", tools)
        self.assertIn("comms_broadcast", tools)
        listed = self.mod.handle({"jsonrpc": "2.0", "id": 2, "method": "prompts/list"})
        names = {p["name"] for p in listed["result"]["prompts"]}
        self.assertIn("mcp-watchdog-hello", names)
        self.assertIn("harness-message", names)
        self.assertIn("cursor-engineer-wake", names)
        woke = self.mod.handle(
            {"jsonrpc": "2.0", "id": 3, "method": "prompts/get", "params": {"name": "harness-message"}}
        )
        text = woke["result"]["messages"][0]["content"]["text"]
        self.assertNotIn("CAD-LOOP", text)
        self.assertNotIn("START-EVERY", text)
        self.assertNotIn(".md", text)
