"""Sandbox reset + traces for Agent Introductions."""

from __future__ import annotations

import unittest
from pathlib import Path

from backend.services import agent_intro_service as intro


class AgentIntroTests(unittest.TestCase):
    def test_sandbox_reset_and_fail_logs_line(self) -> None:
        intro.sandbox_reset()
        ping = intro.sandbox_run("ping")
        self.assertTrue(ping["ok"])
        add = intro.sandbox_run("add", 2, 3)
        self.assertEqual(add["result"], 5)
        fail = intro.sandbox_run("fail")
        self.assertFalse(fail["ok"])
        self.assertIn("line", fail["trace"])
        hs = intro.handshake("cursor-engineer", "deez nutz")
        self.assertTrue(hs["ok"])

    def test_refpack_upload_copies_allowlisted_file(self) -> None:
        intro.REFPACK.mkdir(parents=True, exist_ok=True)
        src = intro.PACK / "REF"
        src.parent.mkdir(parents=True, exist_ok=True)
        if not src.is_file():
            src.write_text(intro.REF_ID, encoding="utf-8")
        out = intro.refpack_upload("analytics", str(src))
        self.assertTrue(out["ok"])
        self.assertEqual(out["pair_id"], intro.PAIR_ID)
        dest = Path(out["dest"])
        self.assertTrue(dest.is_file())
        with self.assertRaises(ValueError):
            intro.refpack_upload("analytics", str(intro.ROOT / ".env"))

    def test_pdf_pages_starts_with_header(self) -> None:
        from backend.services.simple_pdf import pdf_bytes_pages

        blob = pdf_bytes_pages("t", ["a"] * 60)
        self.assertTrue(blob.startswith(b"%PDF-1.4"))
        self.assertIn(b"/Count 2", blob)
