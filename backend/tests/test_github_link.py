"""GitHub authorized-app link (not a second login identity)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import github_link_service


class GithubLinkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        self.pat_patch = patch("backend.services.supabase_users_store.github_pat", return_value=None)
        self.pat_patch.start()
        self.provider_patch = patch(
            "backend.services.supabase_client.github_auth_provider_status",
            return_value={},
        )
        self.provider_patch.start()

    def tearDown(self) -> None:
        self.provider_patch.stop()
        self.pat_patch.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_safe_next_path(self) -> None:
        self.assertEqual(github_link_service.safe_next_path("/"), "/")
        self.assertEqual(github_link_service.safe_next_path("/foundry.html"), "/foundry.html")
        self.assertEqual(github_link_service.safe_next_path("https://evil.example"), "/foundry.html")

    def test_unconfigured_link_url(self) -> None:
        with patch.object(github_link_service.settings, "github_client_id", ""):
            with patch.object(github_link_service.settings, "github_client_secret", ""):
                with patch("backend.services.github_link_service.oauth_app_credentials", return_value=("", "")):
                    self.assertFalse(github_link_service.configured())
                    with self.assertRaises(RuntimeError):
                        github_link_service.link_url("sam")

    def test_status_unconfigured_payload(self) -> None:
        with patch.object(github_link_service.settings, "github_client_id", ""):
            with patch.object(github_link_service.settings, "github_client_secret", ""):
                with patch.object(
                    github_link_service.settings,
                    "github_redirect_uri",
                    "https://render3d.app/oauth/github/callback",
                ):
                    with patch("backend.services.github_link_service.oauth_app_credentials", return_value=("", "")):
                        with patch(
                            "backend.services.supabase_client.github_auth_provider_status",
                            return_value={},
                        ):
                            st = github_link_service.status({"id": "sam"})
                    self.assertFalse(st["configured"])
                    self.assertFalse(st["connected"])
                    self.assertFalse(st["can_list_prs"])
                    self.assertTrue(st["pat_available"])
                    self.assertFalse(st["can_submit"])
                    self.assertEqual(st["redirect_uri"], "https://render3d.app/oauth/github/callback")
                    self.assertEqual(st["project_repo"], "wprojects/Render-Studio")
                    self.assertIn("https://render3d.app/oauth/github/callback", st["callback_uris"])

    def test_status_configured_payload(self) -> None:
        with patch.object(github_link_service.settings, "github_client_id", "id"):
            with patch.object(github_link_service.settings, "github_client_secret", "sec"):
                with patch(
                    "backend.services.supabase_client.github_auth_provider_status",
                    return_value={"enabled": True, "client_id_set": True},
                ):
                    st = github_link_service.status({"id": "sam"})
                self.assertTrue(st["configured"])
                self.assertFalse(st["connected"])
                self.assertFalse(st["can_list_prs"])
                self.assertTrue(st["pat_available"])

    def test_save_personal_token_rejects_junk(self) -> None:
        with self.assertRaises(ValueError):
            github_link_service.save_personal_token("sam", "not-a-token")

    def test_submit_requires_link(self) -> None:
        with self.assertRaises(ValueError):
            github_link_service.submit_to_project("sam", "Idea", "Please add this")

    def test_save_oauth_app_writes_env_without_returning_secret(self) -> None:
        env = Path(self.tmp.name) / ".env"
        env.write_text("GITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\nGITHUB_REDIRECT_URI=https://render3d.app/oauth/github/callback\n")
        with patch.object(github_link_service.settings, "github_client_id", ""):
            with patch.object(github_link_service.settings, "github_client_secret", ""):
                with patch(
                    "backend.services.supabase_client.configure_github_auth_provider",
                    return_value={"ok": True},
                ) as cfg:
                    out = github_link_service.save_oauth_app("oauthclientid", "oauthclientsecret", env_path=env)
        self.assertTrue(out["configured"])
        self.assertTrue(out["needs_restart"])
        self.assertTrue(out["supabase_auth_provider"])
        self.assertNotIn("oauthclientsecret", str(out))
        cfg.assert_called_once()
        args, _kwargs = cfg.call_args
        self.assertEqual(args[0], "oauthclientid")
        text = env.read_text()
        self.assertIn("GITHUB_CLIENT_ID=oauthclientid", text)
        self.assertIn("GITHUB_CLIENT_SECRET=oauthclientsecret", text)

    def test_github_tokens_table(self) -> None:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("sam", "sam@example.com", "Sam", "x", "2026-09-08T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO github_tokens (user_id, access_token, login, updated_at) VALUES (?,?,?,?)",
                ("sam", "tok", "octocat", "2026-09-08T00:00:00+00:00"),
            )
            row = conn.execute("SELECT login FROM github_tokens WHERE user_id='sam'").fetchone()
        self.assertEqual(row["login"], "octocat")

    def test_persist_link_stores_encrypted_pat_on_users(self) -> None:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("sam", "sam@example.com", "Sam", "x", "2026-09-16T00:00:00+00:00"),
            )
        with patch("backend.services.supabase_users_store.set_github_pat", return_value=True) as set_pat:
            out = github_link_service._persist_link(
                "sam",
                "gho_fixture_token_not_live",
                {"id": "99", "login": "octocat", "name": "O", "avatar_url": ""},
            )
        self.assertEqual(out["login"], "octocat")
        set_pat.assert_called_once_with("sam", "gho_fixture_token_not_live")

    def test_status_names_supabase_provider_and_callback(self) -> None:
        with patch.object(github_link_service.settings, "github_client_id", "id"):
            with patch.object(github_link_service.settings, "github_client_secret", "sec"):
                with patch(
                    "backend.services.supabase_client.github_auth_provider_status",
                    return_value={"enabled": True, "client_id_set": True},
                ):
                    st = github_link_service.status({"id": "sam"})
        self.assertEqual(st["oauth_via"], "supabase_auth_github_provider")
        self.assertEqual(st["secrets_column"], "github_pat")
        self.assertTrue(st["supabase_github_provider"])
        self.assertEqual(st["redirect_uri"], "https://render3d.app/oauth/github/callback")
        self.assertIn("https://render3d.app/oauth/github/callback", st["callback_uris"])

    def test_migration_revokes_github_pat_and_docs_omit_live_secrets(self) -> None:
        import re

        root = Path(__file__).resolve().parents[2]
        sql = (root / "integrations/supabase/migrations/008_github_user_secrets.sql").read_text()
        self.assertIn("github_pat", sql)
        self.assertIn("revoke select (github_pat)", sql)
        self.assertIn("service_role", sql.lower() + " service role only")
        readme = (root / "integrations/supabase/GITHUB.md").read_text()
        self.assertIn("/oauth/github/callback", readme)
        self.assertIn("github_pat", readme)
        self.assertIn("Supabase Auth", readme)
        skill = (root / ".cursor/skills/store-secrets-supabase/SKILL.md").read_text()
        self.assertIn("store-secrets-supabase", skill)
        main = (root / "backend/main.py").read_text()
        self.assertIn("/oauth/{provider}/callback", main)
        self.assertIn('provider_key == "github"', main)
        self.assertIn("upsert_supabase_github_link", main)
        live_pat = re.compile(r"github_pat_[A-Za-z0-9_]{12,}")
        live_hex = re.compile(r"\b[0-9a-f]{40}\b")
        for path in (
            root / "integrations/supabase/GITHUB.md",
            root / "integrations/supabase/migrations/008_github_user_secrets.sql",
            root / ".cursor/skills/store-secrets-supabase/SKILL.md",
            root / "frontend/docs/updates/milestones.js",
            root / "frontend/pages/updates.html",
        ):
            text = path.read_text()
            self.assertIsNone(live_pat.search(text), f"live PAT shape in {path.name}")
            self.assertIsNone(live_hex.search(text), f"40-hex secret in {path.name}")


if __name__ == "__main__":
    unittest.main()
