"""Wiki-link resolve, relatedness, issue check, and debugger payload."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import context_wiki_service as svc
from backend.services import incident_intelligence_service as incident


class ContextWikiTests(unittest.TestCase):
    def test_known_service_and_start_here(self) -> None:
        self.assertEqual(svc.resolve_rel("render3d.service"), "deploy/render3d.service")
        self.assertTrue((svc._root() / "deploy/render3d.service").is_file())
        start = svc.resolve_rel("./workspace-map.md", from_path="ai-context/START-HERE.md")
        self.assertEqual(start, "ai-context/workspace-map.md")
        self.assertTrue(svc.is_secret(".env"))
        self.assertIsNone(svc.resolve_rel(".env"))

    def test_lists_skills_getting_started_and_logs(self) -> None:
        rows = svc.list_docs()
        paths = {row["path"] for row in rows}
        self.assertIn("ai-context/START-HERE.md", paths)
        self.assertIn("Getting-Started/AGENTS.md", paths)
        self.assertTrue(any(p.endswith("SKILL.md") and p.startswith("backend/skills/") for p in paths))
        groups = {row["group"] for row in rows if row["path"].endswith("SKILL.md")}
        self.assertIn("Skill", groups)

    def test_related_and_issue_check(self) -> None:
        related = svc.relatedness(["backend/skills/cad/SKILL.md", "backend/skills/wiring/SKILL.md"])
        self.assertTrue(related["related"])
        mixed = svc.relatedness(["frontend/studio/app.js", "backend/skills/cad/SKILL.md"])
        self.assertFalse(mixed["related"])
        check = svc.issue_file_check(
            ["deploy/render3d.service"],
            "render3d.service is not working after restart",
        )
        self.assertTrue(check["issue"])
        self.assertEqual(len(check["files"]), 1)
        quiet = svc.issue_file_check(["deploy/render3d.service"], "looks fine")
        self.assertFalse(quiet["issue"])
        self.assertEqual(quiet["component_status"], "ok")

    def test_debugger_payload_fields(self) -> None:
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        patches = [
            patch.object(incident, "ROOT_DIR", root),
            patch.object(incident, "DB_PATH", root / "incident.sqlite3"),
            patch.object(incident, "LOG_ROOT", root / "ai-context" / "debugger" / "incident-intelligence"),
            patch(
                "backend.services.workspace_automation_service.send_user_debugger",
                return_value={"note": {"ok": True, "kind": "bugs"}, "email": {"ok": False}, "github": {"skipped": True}},
            ),
        ]
        for item in patches:
            item.start()
        try:
            result = svc.send_debugger(
                {"id": "sam", "email": "sam@render3d.app", "display_name": "Sam"},
                {
                    "paths": ["deploy/render3d.service", "ai-context/START-HERE.md"],
                    "from_path": "ai-context/START-HERE.md",
                    "reason": "not working after recycle",
                    "status": "degraded",
                    "selected_text": "render3d.service 404",
                },
            )
            self.assertTrue(result["ok"])
            self.assertTrue(result["occurred_at"])
            self.assertEqual(result["reason"], "not working after recycle")
            self.assertIn("target_edited", result["edits"])
            self.assertIn("deps_edited", result["edits"])
            self.assertIn("related", result)
            self.assertIn("issue_check", result)
            self.assertTrue(result["events"])
            self.assertIn(result["status"], {"ok", "degraded", "broken"})
        finally:
            for item in reversed(patches):
                item.stop()
            temp.cleanup()


if __name__ == "__main__":
    unittest.main()
