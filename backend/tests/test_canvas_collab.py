"""Canvas collab permissions, author stamps, timeline, and remix."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import canvas_collab, cad_service, canvas_board_revision, project_shares_service as shares


class CanvasCollabTests(unittest.TestCase):
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
                "INSERT INTO project_access (project_id, team_id, created_by, created_at) VALUES (?,?,?,?)",
                ("proj1", "team1", "owner", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        self.root = Path(self.tmp.name) / "proj1"
        self.root.mkdir()
        (self.root / "references").mkdir()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_permission_enum_view_remix_edit(self) -> None:
        self.assertEqual(canvas_collab.CANVAS_SHARE_MODES, ("view", "remix", "edit"))
        self.assertEqual(canvas_collab.normalize_canvas_share_mode("view and remix"), "remix")
        self.assertEqual(canvas_collab.normalize_canvas_share_mode("view_edit_remix"), "edit")
        self.assertFalse(canvas_collab.canvas_share_mode_allows_edit("view"))
        self.assertFalse(canvas_collab.canvas_share_mode_allows_edit("remix"))
        self.assertTrue(canvas_collab.canvas_share_mode_allows_edit("edit"))
        self.assertFalse(canvas_collab.canvas_share_mode_allows_remix("view"))
        self.assertTrue(canvas_collab.canvas_share_mode_allows_remix("remix"))
        self.assertEqual(canvas_collab.join_role_for_canvas_mode("remix"), "remixer")
        self.assertEqual(canvas_collab.CANVAS_SHARE_MODE_LABELS["edit"]["title"], "View, edit, remix")

    def test_objects_carry_author_user_id(self) -> None:
        el = {"id": "pen-1", "type": "pen"}
        canvas_collab.stamp_canvas_author(el, {"id": "owner", "display_name": "Owner"})
        self.assertEqual(canvas_collab.canvas_object_author_id(el), "owner")
        canvas_collab.stamp_canvas_author(el, {"id": "mate", "display_name": "Mate"})
        self.assertEqual(el["authorUserId"], "owner")
        self.assertEqual(canvas_collab.canvas_object_author_id({"id": "legacy"}), "")

    def test_timeline_visible_iff_multi_author(self) -> None:
        mine = [{"id": "a", "authorUserId": "owner"}]
        ours = [{"id": "a", "authorUserId": "owner"}, {"id": "b", "authorUserId": "mate"}]
        self.assertFalse(canvas_collab.should_show_canvas_edit_timeline(
            elements=mine, local_user_id="owner",
        ))
        self.assertTrue(canvas_collab.should_show_canvas_edit_timeline(
            elements=ours, local_user_id="owner",
        ))
        self.assertTrue(canvas_collab.should_show_canvas_edit_timeline(
            elements=mine, presence_user_ids=["mate"], local_user_id="owner",
        ))

    def test_remix_duplicates_canvas_into_destination(self) -> None:
        canvas_board_revision.write_canvas_board(
            self.root,
            "Front View",
            {"elements": [{"id": "a", "type": "pen", "authorUserId": "owner"}]},
        )
        dest = Path(self.tmp.name) / "proj2"
        dest.mkdir()
        (dest / "references").mkdir()
        result = canvas_collab.remix_canvas_board(self.root, "Front View", dest)
        self.assertEqual(result["source_name"], "Front View")
        copied = canvas_board_revision.read_canvas_board(dest, result["name"])
        self.assertEqual(copied["state"]["elements"][0]["authorUserId"], "owner")
        self.assertNotEqual(result["name"], None)

    def test_share_roles_map_view_remix_edit_labels(self) -> None:
        self.assertEqual(shares._normalize_share_role("view_edit_remix"), "editor")
        self.assertEqual(shares._normalize_share_role("view and remix"), "remixer")
        invited = shares.share_project("proj1", "mate@example.com", "owner", role="remixer")
        self.assertEqual(invited["role"], "remixer")
        shares.accept_project_share_invite(invited["invite_token"], {"id": "mate", "email": "mate@example.com"})
        with patch.object(canvas_collab.teams_service, "can_edit_project", side_effect=lambda uid, pid: uid == "owner"):
            with patch.object(canvas_collab.teams_service, "can_access_project", return_value=True):
                self.assertEqual(canvas_collab.canvas_permission_for_user("mate", "proj1"), "remix")
                self.assertEqual(canvas_collab.canvas_permission_for_user("owner", "proj1"), "edit")
        self.assertEqual(shares.share_role_for_user("proj1", "mate"), "remixer")
