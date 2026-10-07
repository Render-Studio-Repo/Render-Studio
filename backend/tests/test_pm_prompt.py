"""Project-manager first-prompt loop: score, hire, MCP prompts."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import pm_prompt_service as pms

ROOT = Path(__file__).resolve().parents[2]
MCP_SERVER = ROOT / "mcp" / "grok-bot" / "server.py"

STRONG = """
Cycle CYCLE-20260916-PM1. This week's goals: stand up team communication and initial interviews.

What do you need from Cursor this week? I need engineer_asks and tickets[] so I can fan work. I will not ship.

I will use mcp pm_prompt_submit then agent_bus_submit a PM_PACKET. Inbox only. ref_id INTRO-20260916. prompt_id prm_pm_test. category_id DATA. cycle_id CYCLE-20260916-PM1.

Please tell me how to distribute Getting-Started/agents/PROMPT skills. I will interview each specialist with the same battery and collect SCORECARDs. Team comms: one folder, ACK the ref_id, no DMs.
"""

WEAK = "hey ship the app"


class PmPromptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.mails: list[tuple[str, str]] = []
        self.patches = [
            patch.object(pms, "ROOT", root),
            patch.object(pms, "STORE", root / "store"),
            patch.object(pms, "OUTBOX", root / "outbox"),
            patch.object(pms, "_email_sam", side_effect=self._mail),
        ]
        for p in self.patches:
            p.start()

    def _mail(self, subject: str, body: str) -> dict:
        self.mails.append((subject, body))
        return {"ok": True, "to": [pms.SAM_EMAIL]}

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_strong_prompt_hires_and_emails(self) -> None:
        scored = pms.score_prompt(STRONG)
        self.assertGreaterEqual(scored["score"], 70)
        self.assertEqual(scored["hire"], "yes")
        out = pms.submit({"prompt": STRONG, "cycle_id": "CYCLE-20260916-PM1", "prompt_id": "prm_pm_hires"})
        self.assertTrue(out["ok"])
        self.assertTrue(out["is_first"])
        self.assertEqual(out["hire"], "yes")
        self.assertIn("OUTLINE", out["cursor_reply"])
        self.assertIn("team communication", out["cursor_reply"].lower())
        self.assertEqual(len(self.mails), 1)
        subject, body = self.mails[0]
        self.assertIn("HIRE YES", subject)
        self.assertIn("What do you need from Cursor", body)
        self.assertIn("sam@render3d.app", pms.SAM_EMAIL)

    def test_weak_prompt_no_hire_still_replies_outline(self) -> None:
        out = pms.submit({"prompt": WEAK, "cycle_id": "CYCLE-20260916-PM1"})
        self.assertEqual(out["hire"], "no")
        self.assertLess(out["score"], 70)
        self.assertIn("OUTLINE", out["cursor_reply"])
        self.assertIn("HIRE NO", self.mails[0][0])

    def test_followup_freezes_first_hire(self) -> None:
        pms.submit({"prompt": WEAK, "cycle_id": "CYCLE-20260916-PM1", "prompt_id": "a"})
        two = pms.submit({"prompt": STRONG, "cycle_id": "CYCLE-20260916-PM1", "prompt_id": "b"})
        self.assertFalse(two["is_first"])
        self.assertEqual(two["hire"], "no")
        self.assertIn("follow-up", self.mails[1][0])
        self.assertIn("hey ship the app", self.mails[1][1])

    def test_kit_contains_starter(self) -> None:
        kit = pms.kit("CYCLE-20260916-PM1")
        self.assertIn("pm_prompt_submit", kit["starter_prompt"])
        self.assertEqual(kit["cycle_id"], "CYCLE-20260916-PM1")
        self.assertEqual(kit["email_to"], "sam@render3d.app")
        self.assertEqual(kit["cursor_prompt"], "PROMPT-cursor-engineer.md")


class PmPromptMcpTests(unittest.TestCase):
    def setUp(self) -> None:
        spec = importlib.util.spec_from_file_location("grok_bot_mcp_server_pm", MCP_SERVER)
        self.mod = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(self.mod)

    def test_prompts_list_and_get(self) -> None:
        listed = self.mod.handle({"jsonrpc": "2.0", "id": 1, "method": "prompts/list"})
        names = {p["name"] for p in listed["result"]["prompts"]}
        self.assertEqual(names, {"pm-first-loop", "pm-hire-screen", "mcp-watchdog-hello", "cursor-engineer-wake", "harness-message"})
        got = self.mod.handle(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "prompts/get",
                "params": {"name": "pm-first-loop", "arguments": {"cycle_id": "CYCLE-20260916-PM1"}},
            }
        )
        text = got["result"]["messages"][0]["content"]["text"]
        self.assertIn("pm_prompt_submit", text)
        self.assertIn("CYCLE-20260916-PM1", text)

    def test_tools_include_pm_prompt(self) -> None:
        reply = self.mod.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
        names = {t["name"] for t in reply["result"]["tools"]}
        self.assertIn("pm_prompt_kit", names)
        self.assertIn("pm_prompt_submit", names)
        self.assertIn("pm_prompt_status", names)

    def test_kit_tool_returns_starter(self) -> None:
        reply = self.mod.handle(
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {"name": "pm_prompt_kit", "arguments": {"cycle_id": "CYCLE-20260916-PM1"}},
            }
        )
        payload = json.loads(reply["result"]["content"][0]["text"])
        self.assertIn("You are Render Studio's project-manager", payload["starter_prompt"])
