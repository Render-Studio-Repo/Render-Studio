"""Folder leave/delete permissions for shared workspace folders."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import folders_service as folders


class FolderShareLeaveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("owner", "owner@example.com", "Owner", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("mate", "mate@example.com", "Mate", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?,?,?,?)",
                ("team1", "Render3D", "owner", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("team1", "owner", "owner", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                ("team1", "mate", "member", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def _share_row(self, folder_id: str, user_id: str, shared_by: str = "owner") -> None:
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO folder_shares (folder_id, user_id, shared_by, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (folder_id, user_id, shared_by, "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()

    def test_recipient_can_leave_own_folder_share(self) -> None:
        folder = folders.create_folder("team1", "main_", "owner")
        self._share_row(folder["id"], "mate")
        listed = {f["id"]: f for f in folders.list_folders("team1", "mate")}
        self.assertTrue(listed[folder["id"]]["received_share"])
        self.assertTrue(listed[folder["id"]]["shared_with_me"])
        self.assertFalse(listed[folder["id"]]["can_manage"])

        result = folders.remove_folder_share(folder["id"], "mate", "mate")
        self.assertEqual(result["status"], "removed")
        listed = {f["id"]: f for f in folders.list_folders("team1", "mate")}
        self.assertFalse(listed[folder["id"]]["received_share"])

    def test_member_cannot_remove_someone_elses_share(self) -> None:
        folder = folders.create_folder("team1", "main_", "owner")
        self._share_row(folder["id"], "mate")
        with self.assertRaises(PermissionError):
            folders.remove_folder_share(folder["id"], "owner", "mate")

    def test_member_without_share_cannot_self_unshare(self) -> None:
        folder = folders.create_folder("team1", "new", "owner")
        with self.assertRaises(PermissionError):
            folders.remove_folder_share(folder["id"], "mate", "mate")

    def test_workspace_admin_can_delete_teammate_folder(self) -> None:
        folder = folders.create_folder("team1", "new", "mate")
        listed = {f["id"]: f for f in folders.list_folders("team1", "owner")}
        self.assertTrue(listed[folder["id"]]["can_manage"])
        self.assertTrue(listed[folder["id"]]["shared_with_me"])
        deleted = folders.delete_folder(folder["id"], "owner")
        self.assertEqual(deleted["id"], folder["id"])
        ids = {f["id"] for f in folders.list_folders("team1", "owner")}
        self.assertNotIn(folder["id"], ids)

    def test_member_cannot_delete_teammate_folder(self) -> None:
        folder = folders.create_folder("team1", "main_", "owner")
        with self.assertRaises(PermissionError):
            folders.delete_folder(folder["id"], "mate")


if __name__ == "__main__":
    unittest.main()
