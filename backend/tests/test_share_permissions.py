"""View-only share flags, join-project links, and viewer vs editor roles."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.main import _file_share_client_payload, _share_allows_download
from backend.config import settings
from starlette.requests import Request
from backend.services import project_shares_service as shares
from backend.services import teams_service


class SharePermissionTests(unittest.TestCase):
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

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_new_share_defaults_view_only_legacy_allows_download(self) -> None:
        self.assertFalse(_share_allows_download({"allow_download": False}))
        self.assertTrue(_share_allows_download({"allow_download": True}))
        self.assertTrue(_share_allows_download({"filename": "part.glb"}))
        self.assertFalse(_share_allows_download({"allow_remix": False}))

    def test_share_payload_uses_public_origin_for_native_app_downloads(self) -> None:
        request = Request({
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "server": ("127.0.0.1", 8001),
            "path": "/api/projects/proj1/files/part.3mf/share",
            "headers": [(b"host", b"127.0.0.1:8001")],
        })
        with patch.object(settings, "public_base_url", "https://render3d.app"):
            payload = _file_share_client_payload(
                "share-token",
                {"filename": "mesh/part.3mf", "allow_download": True},
                "proj1",
                request,
            )
        self.assertEqual(
            payload["file_url"],
            "https://render3d.app/api/share/share-token/files/mesh/part.3mf",
        )

    def test_join_link_auto_adds_viewer_without_invite_accept(self) -> None:
        link = shares.upsert_project_join_link("proj1", "owner", enabled=True, role="viewer")
        self.assertTrue(link["enabled"])
        self.assertEqual(link["role"], "viewer")
        result = shares.join_project_via_link(link["token"], {"id": "mate"})
        self.assertEqual(result["status"], "joined")
        self.assertEqual(result["role"], "viewer")
        self.assertTrue(shares.is_shared_with("proj1", "mate"))
        self.assertFalse(teams_service.can_edit_project("mate", "proj1"))
        self.assertTrue(teams_service.can_access_project("mate", "proj1"))

    def test_join_link_editor_can_edit_and_rejoin_is_idempotent(self) -> None:
        link = shares.upsert_project_join_link("proj1", "owner", enabled=True, role="editor")
        first = shares.join_project_via_link(link["token"], {"id": "mate"})
        self.assertEqual(first["status"], "joined")
        self.assertTrue(teams_service.can_edit_project("mate", "proj1"))
        again = shares.join_project_via_link(link["token"], {"id": "mate"})
        self.assertTrue(again["already_member"])
        disabled = shares.upsert_project_join_link("proj1", "owner", enabled=False)
        self.assertEqual(disabled["token"], link["token"])
        with self.assertRaises(ValueError):
            shares.join_project_via_link(link["token"], {"id": "mate"})

    def test_join_link_lookup_by_token(self) -> None:
        link = shares.upsert_project_join_link("proj1", "owner", enabled=True, role="viewer")
        found = shares.get_join_link_by_token(link["token"])
        self.assertEqual(found["project_id"], "proj1")
        self.assertEqual(found["created_by"], "owner")
        self.assertTrue(found["enabled"])
        self.assertIsNone(shares.get_join_link_by_token("missing"))

    def test_share_roles_map_view_remix_edit(self) -> None:
        self.assertEqual(shares._normalize_share_role("view"), "viewer")
        self.assertEqual(shares._normalize_share_role("remix only"), "remixer")
        self.assertEqual(shares._normalize_share_role("remix and edit"), "editor")
        self.assertFalse(shares.share_role_can_edit("remixer"))
        self.assertTrue(shares.share_role_can_remix("remixer"))
        self.assertTrue(shares.share_role_can_edit("editor"))
        invited = shares.share_project("proj1", "mate@example.com", "owner", role="remixer")
        self.assertEqual(invited["role"], "remixer")
        shares.accept_project_share_invite(invited["invite_token"], {"id": "mate", "email": "mate@example.com"})
        self.assertTrue(shares.is_shared_with("proj1", "mate"))
        self.assertFalse(teams_service.can_edit_project("mate", "proj1"))
        listed = shares.list_project_shares("proj1", "owner")
        self.assertEqual(listed["shares"][0]["role"], "remixer")
        updated = shares.set_project_share_role("proj1", "mate", "owner", "editor")
        self.assertEqual(updated["role"], "editor")
        self.assertTrue(teams_service.can_edit_project("mate", "proj1"))

    def test_public_share_mode_trio_and_comments(self) -> None:
        from backend.services import share_mode

        view = share_mode.apply_share_mode({}, "view")
        remix = share_mode.apply_share_mode({}, "remix")
        edit = share_mode.apply_share_mode({}, "edit")
        self.assertEqual(share_mode.share_client_flags(view)["allow_download"], False)
        self.assertEqual(share_mode.share_client_flags(remix)["allow_remix"], True)
        self.assertEqual(share_mode.share_client_flags(remix)["allow_edit"], False)
        self.assertEqual(share_mode.share_client_flags(edit)["allow_edit"], True)
        self.assertEqual(share_mode.join_role_for_mode("edit"), "editor")
        self.assertEqual(share_mode.join_role_for_mode("remix"), "remixer")
        share = {"share_mode": "edit", "comments": []}
        comment = share_mode.add_share_comment(share, text="nice cut", t=1.5, kind="pin", allow_pin=True)
        self.assertEqual(comment["kind"], "pin")
        self.assertEqual(len(share_mode.list_share_comments(share)), 1)
        with self.assertRaises(PermissionError):
            share_mode.add_share_comment(share, text="pin", kind="pin", allow_pin=False)
        mark = share_mode.add_share_comment(
            share,
            text="",
            t=2.25,
            kind="markup",
            tool="circle",
            geometry={"x": 0.2, "y": 0.3, "w": 0.2, "h": 0.2},
        )
        self.assertEqual(mark["kind"], "markup")
        self.assertEqual(mark["tool"], "circle")
        self.assertEqual(mark["text"], "circle")
        self.assertAlmostEqual(mark["duration"], 3.2)
        self.assertEqual(len(share_mode.list_share_comments(share)), 2)
        self.assertGreaterEqual(len(share_mode.list_markup_revisions(share)), 1)
        share_mode.delete_share_comment(share, mark["id"])
        self.assertEqual(len(share_mode.list_share_comments(share)), 1)
        share_mode.clear_share_markups(share)
        self.assertTrue(all(not row.get("tool") for row in share_mode.list_share_comments(share)))

    def test_share_target_from_user_id_and_editor_invite(self) -> None:
        self.assertEqual(shares.share_target_from_user_id("mate"), "mate@example.com")
        invited = shares.share_project(
            "proj1",
            shares.share_target_from_user_id("mate"),
            "owner",
            role="editor",
        )
        self.assertEqual(invited["role"], "editor")
        self.assertEqual(invited["status"], "invited")
        self.assertTrue(invited.get("invite_token"))
