"""Solo users without a team still get a personal workspace for + project."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backend.database import get_conn, init_db
from backend.services import teams_service


class EnsurePersonalTeamTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.live_patch = patch("backend.services.teams_service._ws_live", return_value=False)
        self.ws = Mock()
        self.ws_patch = patch("backend.services.teams_service._ws", return_value=self.ws)
        self.db_patch.start()
        self.live_patch.start()
        self.ws_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("sam", "sam@example.com", "Sam Williams", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        self.user = {"id": "sam", "email": "sam@example.com", "display_name": "Sam Williams"}

    def tearDown(self) -> None:
        self.ws_patch.stop()
        self.live_patch.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_ensure_creates_named_personal_workspace(self) -> None:
        self.assertEqual(teams_service.list_teams("sam"), [])
        team = teams_service.ensure_personal_team(self.user)
        self.assertEqual(team["name"], "Sam's Workspace")
        self.assertEqual(team["role"], "owner")
        self.assertTrue(team.get("can_edit"))
        listed = teams_service.list_teams("sam")
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["id"], team["id"])

    def test_ensure_is_idempotent(self) -> None:
        first = teams_service.ensure_personal_team(self.user)
        second = teams_service.ensure_personal_team(self.user)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(teams_service.list_teams("sam")), 1)

    def test_ensure_reuses_existing_team(self) -> None:
        existing = teams_service.create_team("Studio", "sam")
        team = teams_service.ensure_personal_team(self.user)
        self.assertEqual(team["id"], existing["id"])

    def test_resolve_writable_creates_when_empty(self) -> None:
        tid = teams_service.resolve_writable_team_id(self.user, None)
        self.assertTrue(tid)
        self.assertEqual(tid, teams_service.personal_team_id("sam"))
        self.assertTrue(teams_service.member_can_edit(tid, "sam"))

    def test_resolve_writable_falls_back_from_unknown_team_id(self) -> None:
        personal = teams_service.ensure_personal_team(self.user)
        tid = teams_service.resolve_writable_team_id(self.user, "missing")
        self.assertEqual(tid, personal["id"])

    def test_list_teams_falls_back_to_sqlite_when_supabase_empty(self) -> None:
        created = teams_service.create_team("Sam's Workspace", "sam")
        self.ws.list_teams_for_user.return_value = []
        self.live_patch.stop()
        try:
            with patch("backend.services.teams_service._ws_live", return_value=True):
                listed = teams_service.list_teams("sam")
        finally:
            self.live_patch.start()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["id"], created["id"])

    def test_create_project_without_teams_succeeds(self) -> None:
        from backend.main import create_project

        projects = Path(self.tmp.name) / "projects"
        projects.mkdir()
        with (
            patch("backend.main.PROJECTS", projects),
            patch("backend.main._notify_workspace"),
        ):
            body = create_project(user=self.user, name=None, team_id=None)
        self.assertTrue(body.get("project_id"))
        self.assertTrue(body.get("team_id"))
        self.assertEqual(body["team_id"], teams_service.personal_team_id("sam"))
        self.assertTrue((projects / body["project_id"]).is_dir())

    def test_create_project_unknown_team_uses_personal(self) -> None:
        from backend.main import create_project

        personal = teams_service.ensure_personal_team(self.user)
        projects = Path(self.tmp.name) / "projects"
        projects.mkdir()
        with (
            patch("backend.main.PROJECTS", projects),
            patch("backend.main._notify_workspace"),
        ):
            body = create_project(user=self.user, name=None, team_id="stale-select")
        self.assertEqual(body["team_id"], personal["id"])


if __name__ == "__main__":
    unittest.main()
