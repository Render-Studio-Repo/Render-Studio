"""Team-shared Cursor / Claude CLI logins."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import subscription_share_service as share


class SubscriptionShareTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        self.signed_in: set[tuple[str, str]] = set()
        self.auth_patch = patch(
            "backend.services.subscription_share_service._signed_in",
            side_effect=lambda provider, uid: (str(provider), str(uid)) in self.signed_in,
        )
        self.auth_patch.start()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("host", "a1projects@protonmail.com", "Sam W", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("mate", "mate@example.com", "Teammate", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?,?,?,?)",
                ("team1", "Studio", "host", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("team1", "host", "owner", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("team1", "mate", "member", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        self.signed_in.add(("cursor", "host"))
        self.signed_in.add(("claude", "host"))

    def tearDown(self) -> None:
        self.auth_patch.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_cannot_share_cursor_until_signed_in(self) -> None:
        self.signed_in.discard(("cursor", "host"))
        with self.assertRaises(ValueError):
            share.share_with_team("team1", "host", "cursor")

    def test_cursor_team_share_default_deny(self) -> None:
        share.share_with_team("team1", "host", "cursor")
        resolved = share.resolve_owner("mate", "cursor")
        self.assertIsNone(resolved["owner_user_id"])
        members = share.list_share_members(
            "team1",
            share.list_team_shares("team1", "host", "cursor")[0]["id"],
            "host",
            "cursor",
        )
        mate = next(m for m in members if m["user_id"] == "mate")
        self.assertFalse(mate["granted"])
        share.set_member_access(
            "team1",
            share.list_team_shares("team1", "host", "cursor")[0]["id"],
            "mate",
            granted=True,
            requester_id="host",
            provider="cursor",
        )
        resolved = share.resolve_owner("mate", "cursor")
        self.assertEqual(resolved["kind"], "team")
        self.assertEqual(resolved["owner_user_id"], "host")

    def test_own_cursor_login_beats_team_share(self) -> None:
        share.share_with_team("team1", "host", "cursor")
        share.set_member_access(
            "team1",
            share.list_team_shares("team1", "host", "cursor")[0]["id"],
            "mate",
            granted=True,
            requester_id="host",
            provider="cursor",
        )
        self.signed_in.add(("cursor", "mate"))
        resolved = share.resolve_owner("mate", "cursor")
        self.assertEqual(resolved["kind"], "self")
        self.assertEqual(resolved["owner_user_id"], "mate")

    def test_claude_share_same_grant_model(self) -> None:
        share.share_with_team("team1", "host", "claude")
        share.set_member_access(
            "team1",
            share.list_team_shares("team1", "host", "claude")[0]["id"],
            "mate",
            granted=True,
            requester_id="host",
            provider="claude",
        )
        resolved = share.resolve_owner("mate", "claude")
        self.assertEqual(resolved["kind"], "team")
        self.assertEqual(resolved["owner_user_id"], "host")


if __name__ == "__main__":
    unittest.main()
