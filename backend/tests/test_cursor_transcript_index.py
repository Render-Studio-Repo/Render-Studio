"""Cheap transcript index covers nested chats + subagents. Excerpt ≤120."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import cursor_transcript_index as cti
from backend.services import debugger_swarm_service as dss
from backend.services import incident_intelligence_service as ii
from backend.services import prompt_trace_service as trace


def _write_chat(path: Path, query: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({
            "role": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": f"<user_query>{query}</user_query>"}],
            },
        }) + "\n",
        encoding="utf-8",
    )


class CursorTranscriptIndexTests(unittest.TestCase):
    def setUp(self):
        self.prev = os.environ.get("CURSOR_TRANSCRIPT_ROOTS")
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "agent-transcripts"
        self.root.mkdir()
        _write_chat(self.root / "aaaa1111-flat.jsonl", "flat parent chat webgl context lost")
        nested = self.root / "bbbb2222-nested" / "bbbb2222-nested.jsonl"
        _write_chat(nested, "nested parent chat studio viewport")
        _write_chat(self.root / "bbbb2222-nested" / "subagents" / "cccc3333-sub.jsonl", "subagent webgl restore")
        _write_chat(self.root / "secrets" / "leak.jsonl", "must not index this secret chat")
        os.environ["CURSOR_TRANSCRIPT_ROOTS"] = str(self.root)
        cti._DISK_CACHE["sig"] = None
        cti._DISK_CACHE["rows"] = []

    def tearDown(self):
        self.temp.cleanup()
        if self.prev is None:
            os.environ.pop("CURSOR_TRANSCRIPT_ROOTS", None)
        else:
            os.environ["CURSOR_TRANSCRIPT_ROOTS"] = self.prev
        cti._DISK_CACHE["sig"] = None
        cti._DISK_CACHE["rows"] = []

    def test_nested_subagent_not_secrets_and_counts(self):
        files = cti.iter_transcript_files()
        names = {p.name for p in files}
        self.assertEqual(len(files), 3)
        self.assertIn("aaaa1111-flat.jsonl", names)
        self.assertIn("bbbb2222-nested.jsonl", names)
        self.assertIn("cccc3333-sub.jsonl", names)
        self.assertNotIn("leak.jsonl", names)
        served = cti.merge_missing([])
        cov = cti.coverage(indexed=served)
        cti.print_coverage(cov)
        self.assertEqual(cov["disk_count"], 3)
        self.assertEqual(cov["indexed_count"], 3)
        self.assertEqual(cov["missing_count"], 0)
        self.assertEqual(cov["excerpt_cap"], 120)
        self.assertTrue(all(len(str(r.get("excerpt") or r.get("prompt") or "")) <= 120 for r in served))

    def test_history_and_search_chat_logs_excerpt(self):
        with patch.object(trace, "indexed_prompts", return_value=[]), patch.object(trace, "_load_live", return_value=[]):
            page = dss.history_search("webgl", limit=10)
            self.assertTrue(page["hits"])
            self.assertLessEqual(len(page["hits"][0]["excerpt"]), 120)
            self.assertFalse(page["bodies"])
            self.assertEqual((page.get("coverage") or {}).get("disk_count"), 3)
            hits = ii.search_chat_logs("webgl")
            self.assertTrue(hits["hits"])
            self.assertLessEqual(len(hits["hits"][0]["excerpt"]), 120)
            self.assertLessEqual(len(hits["hits"][0]["prompt"]), 120)

    def test_live_disk_counts_print(self):
        if self.prev is None:
            os.environ.pop("CURSOR_TRANSCRIPT_ROOTS", None)
        else:
            os.environ["CURSOR_TRANSCRIPT_ROOTS"] = self.prev
        cti._DISK_CACHE["sig"] = None
        live = cti.coverage(indexed=list(trace.indexed_prompts() or []))
        cti.print_coverage(live)
        self.assertGreaterEqual(live["disk_count"], 1)
        self.assertGreaterEqual(live["served_count"], live["disk_count"])
