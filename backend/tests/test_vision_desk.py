from __future__ import annotations

import unittest

from backend.services import vision_desk_service as desk


class VisionDeskTests(unittest.TestCase):
    def test_comment_and_vision_ask(self) -> None:
        desk.ensure_schema()
        c = desk.add_comment("ship the ids", "Sam")
        self.assertTrue(c["id"].startswith("cmt_"))
        a = desk.ask_agent("tell me about the vision and roadmap", "sess1")
        self.assertTrue(a["about_vision"])
        st = desk.stats()
        self.assertGreaterEqual(st["vision_questions"], 1)
        cen = desk.census()
        self.assertGreaterEqual(cen["total_instructions"], 20)
        self.assertEqual(cen["new_bug_families_created"], 0)
        cr = desk.credit_score()
        self.assertGreater(cr["credit_score"], 0)
        self.assertFalse(cr["ml_needed"])
        hello = desk.record_hello("project-manager", "hello from PM")
        self.assertTrue(hello["has_hello"])
        rank = desk.ranking_from_hellos()
        self.assertEqual(rank["process"], "1-shot (no review loop)")
        names = [r["actor"] for r in rank["ranked"]]
        self.assertIn("sam", names)

    def test_anonymous_comment(self) -> None:
        c = desk.add_comment("anon note")
        self.assertEqual(c["name"], "anonymous")
