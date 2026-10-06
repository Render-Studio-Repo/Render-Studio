"""Prompt-ops traceback store (taxonomy + similarity)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import init_db
from backend.services import agent_ops_service as ops


class AgentOpsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.patch = patch("backend.database.DB_PATH", self.db)
        self.patch.start()
        init_db()
        ops.ensure_schema()

    def tearDown(self) -> None:
        self.patch.stop()
        self.tmp.cleanup()

    def test_record_and_similar(self) -> None:
        a = ops.record_ops(
            {
                "prompt_id": "prm_ops_bus_1",
                "category_id": "DATA",
                "cycle_id": "CYCLE-20260916-1618",
                "agent": "cursor-engineer",
                "ops": ["reanalyze", "move_md", "update_prompts", "api", "mcp"],
                "traceback_ids": ["tb_re", "tb_md", "tb_pr", "tb_api", "tb_mcp"],
                "result_score": 72,
                "damage_score": 0.2,
                "instance_id": "local",
                "instance_public_factor": 0,
            }
        )
        self.assertEqual(a["prompt_id"], "prm_ops_bus_1")
        self.assertEqual(a["category_id"], "DATA")
        self.assertEqual(a["instance_public_factor"], 0)
        self.assertEqual(a["ops_similarity"], 1.0)
        b = ops.record_ops(
            {
                "category_id": "DATA",
                "agent": "analytics",
                "ops": ["reanalyze", "move_md", "score"],
                "result_score": 60,
                "instance_public_factor": 0,
            }
        )
        self.assertGreaterEqual(b["ops_similarity"], 0.2)
        sim = ops.similar("DATA", ["reanalyze", "move_md", "update_prompts", "api", "mcp"])
        self.assertEqual(sim["matches"][0]["prompt_id"], "prm_ops_bus_1")
