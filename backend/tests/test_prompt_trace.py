"""Prompt-trace record + blame without touching live YouTube/Drive."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import prompt_trace_service as trace


class PromptTraceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.patches = [
            patch.object(trace, "STORE", self.dir),
            patch.object(trace, "INDEX", self.dir / "live-prompts.jsonl"),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_broke_blames_last_of_last3(self) -> None:
        first = trace.record(
            {
                "log_id": "chat-001",
                "prompt": "add video editor bake",
                "result": "continued",
            }
        )
        broke = trace.record(
            {
                "log_id": "chat-002",
                "prompt": "you broke the bake it crashes",
                "result": "broke",
                "last3_log_ids": ["chat-001"],
            }
        )
        self.assertEqual(broke["prompt"]["blamed_log_id"], "chat-001")
        chain = trace.blame_chain("chat-002")
        self.assertEqual(chain["blamed"]["log_id"], "chat-001")
        dumped = json.dumps(broke)
        self.assertNotIn("PROMPT_TRACE_API_KEY", dumped)


if __name__ == "__main__":
    unittest.main()
