"""Per-member sidebar hide/show; accept defaults to shown."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import teams_service


class WorkspaceExplorerVisibleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("sam", "sam@example.com", "Sam", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("bob", "bob@example.com", "Bob", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_accept_defaults_to_shown(self) -> None:
        team = teams_service.create_team("Studio", "sam")
        invited = teams_service.invite_user_to_team(team["id"], "bob@example.com", "sam")
        accepted = teams_service.accept_team_invite(invited["invite_id"], "bob", "bob@example.com")
        self.assertEqual(accepted.get("status"), "accepted")
        bob_teams = teams_service.list_teams("bob")
        self.assertEqual(len(bob_teams), 1)
        self.assertTrue(bob_teams[0].get("explorer_visible"))

    def test_member_can_hide_and_show(self) -> None:
        team = teams_service.create_team("Studio", "sam")
        invited = teams_service.invite_user_to_team(team["id"], "bob@example.com", "sam")
        teams_service.accept_team_invite(invited["invite_id"], "bob", "bob@example.com")
        hidden = teams_service.set_explorer_visible(team["id"], "bob", False)
        self.assertFalse(hidden["explorer_visible"])
        listed = {t["id"]: t for t in teams_service.list_teams("bob")}
        self.assertFalse(listed[team["id"]]["explorer_visible"])
        shown = teams_service.set_explorer_visible(team["id"], "bob", True)
        self.assertTrue(shown["explorer_visible"])
        listed = {t["id"]: t for t in teams_service.list_teams("bob")}
        self.assertTrue(listed[team["id"]]["explorer_visible"])

    def test_non_member_cannot_toggle(self) -> None:
        team = teams_service.create_team("Studio", "sam")
        with self.assertRaises(PermissionError):
            teams_service.set_explorer_visible(team["id"], "bob", False)
