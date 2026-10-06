"""Instruction-file registry for Management → Server."""

from __future__ import annotations

import unittest

from backend.services import instruction_files_service


class InstructionFilesTests(unittest.TestCase):
    def test_lists_ops_readme_and_agents(self) -> None:
        rows = instruction_files_service.list_files()
        paths = {row["path"] for row in rows}
        self.assertIn("ai-context/ops/README.md", paths)
        self.assertIn("AGENTS.md", paths)
        self.assertIn("ai-context/ops/DEVELOPER.md", paths)
        self.assertIn("mcp/grok-bot/DEBUG-PATH-TRACER.md", paths)
        ops = next(row for row in rows if row["path"] == "ai-context/ops/README.md")
        self.assertTrue(ops["exists"])
        self.assertTrue(ops["description"])
        self.assertEqual(ops["group"], "Ops")
        self.assertNotIn("body", ops)

    def test_view_returns_body_once(self) -> None:
        meta = next(
            row for row in instruction_files_service.list_files() if row["path"] == "ai-context/ops/README.md"
        )
        data = instruction_files_service.read_file(meta["id"])
        self.assertIsNotNone(data)
        self.assertIn("read this before", (data or {}).get("body", "").lower())

    def test_unknown_id(self) -> None:
        self.assertIsNone(instruction_files_service.read_file("not-a-real-file"))


if __name__ == "__main__":
    unittest.main()
