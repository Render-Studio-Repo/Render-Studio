"""Join-project share links must unfurl the project/user thumbnail, not the site banner."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.main import apply_studio_join_og
from backend.services import project_shares_service as shares


class JoinLinkOgTests(unittest.TestCase):
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
            conn.commit()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_join_og_uses_join_thumb_not_site_banner(self) -> None:
        source = """<!-- STUDIO_OG_START -->
  <meta property="og:image" content="https://render3d.app/render3d-og-banner.jpg?v=old" />
  <meta name="twitter:image" content="https://render3d.app/render3d-og-banner.jpg?v=old" />
  <!-- STUDIO_OG_END -->"""
        request = SimpleNamespace(query_params={"join_project": "JoinTok123"}, headers={})
        with patch("backend.main._join_preview_source", return_value={
            "project_id": "abc",
            "project_name": "Holonomic Base",
            "kind": "project_thumb",
            "media_type": "image/jpeg",
        }):
            with patch("backend.main._request_origin", return_value="https://render3d.app"):
                out = apply_studio_join_og(source, request)
        self.assertIn("/api/join/JoinTok123/thumb", out)
        self.assertNotIn("render3d-og-banner.jpg", out)
        self.assertIn("Holonomic Base", out)
        self.assertIn("og:url\" content=\"https://render3d.app/?join_project=JoinTok123\"", out)

    def test_join_og_untouched_without_token(self) -> None:
        source = "<!-- STUDIO_OG_START -->banner<!-- STUDIO_OG_END -->"
        request = SimpleNamespace(query_params={}, headers={})
        self.assertEqual(apply_studio_join_og(source, request), source)

    def test_get_join_link_by_token_roundtrip(self) -> None:
        with get_conn() as conn:
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
        link = shares.upsert_project_join_link("proj1", "owner", enabled=True, role="viewer")
        found = shares.get_join_link_by_token(link["token"])
        self.assertEqual(found["project_id"], "proj1")
