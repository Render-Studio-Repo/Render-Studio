"""Cursor/Claude subscription listing is CLI-signed-in, not a dummy email row."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import ai_subscriptions_service as subs


class CliSubscriptionListingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        self.cursor_on = False
        self.claude_on = False
        self.credits = {
            "available": False,
            "balance_cents": 0,
            "use_platform_key": False,
        }
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("host", "sam@example.com", "Sam", "x", "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()
        self.chatgpt_patch = patch(
            "backend.services.chatgpt_codex_auth.device_auth_status",
            return_value={"available": True, "status": "not_signed_in", "signed_in": False},
        )
        self.cursor_patch = patch(
            "backend.services.cursor_cli_auth.login_status",
            side_effect=lambda uid: {
                "available": True,
                "status": "signed_in" if self.cursor_on else "not_signed_in",
                "signed_in": self.cursor_on,
                "account_email": "sam@render3d.app" if self.cursor_on else "",
                "plan_label": "Cursor" if self.cursor_on else "",
                "login_url": "https://cursor.com/loginDeepControl",
            },
        )
        self.claude_patch = patch(
            "backend.services.claude_cli_auth.login_status",
            side_effect=lambda uid: {
                "available": True,
                "status": "signed_in" if self.claude_on else "not_signed_in",
                "signed_in": self.claude_on,
                "account_email": "sam@render3d.app" if self.claude_on else "",
                "plan_label": "Claude" if self.claude_on else "",
                "login_url": "https://claude.ai/login",
                "needs_code": False,
            },
        )
        self.keys_patch = patch(
            "backend.services.user_ai_keys_service.list_keys",
            return_value=[],
        )
        self.credits_patch = patch(
            "backend.services.ai_credit_service.status",
            side_effect=lambda user: dict(self.credits),
        )
        self.chatgpt_patch.start()
        self.cursor_patch.start()
        self.claude_patch.start()
        self.keys_patch.start()
        self.credits_patch.start()

    def tearDown(self) -> None:
        for p in (self.credits_patch, self.keys_patch, self.claude_patch, self.cursor_patch, self.chatgpt_patch, self.db_patch):
            p.stop()
        self.tmp.cleanup()

    def _row(self, listing: dict, provider: str) -> dict:
        return next(p for p in listing["providers"] if p["id"] == provider)

    def test_cursor_is_not_a_connectable_provider(self) -> None:
        self.cursor_on = True
        subs.connect_subscription("host", "cursor", account_email="sam@render3d.app", plan_label="Cursor")
        listing = subs.list_subscriptions("host")
        ids = [p["id"] for p in listing["providers"]]
        self.assertEqual(ids, ["cloud", "openai", "claude"])
        self.assertNotIn("cursor", ids)
        self.assertTrue(listing["cursor"]["signed_in"])

    def test_dummy_cursor_email_is_not_listed(self) -> None:
        subs.connect_subscription("host", "cursor", account_email="sam@render3d.app", plan_label="Cursor")
        listing = subs.list_subscriptions("host")
        ids = [p["id"] for p in listing["providers"]]
        self.assertNotIn("cursor", ids)
        self.assertFalse(listing["cursor"]["signed_in"])

    def test_claude_subscription_is_listed_as_connectable(self) -> None:
        self.claude_on = True
        listing = subs.list_subscriptions("host")
        ids = [p["id"] for p in listing["providers"]]
        self.assertEqual(ids, ["cloud", "openai", "claude"])
        claude = self._row(listing, "claude")
        self.assertTrue(claude["connected"])
        self.assertEqual(claude["auth_status"], "signed_in")
        self.assertTrue(listing["claude"]["signed_in"])

    def test_cloud_credits_are_listed(self) -> None:
        listing = subs.list_subscriptions("host")
        cloud = self._row(listing, "cloud")
        self.assertEqual(cloud["label"], "Cloud")
        self.assertFalse(cloud["connected"])
        self.assertEqual(cloud["auth_status"], "not_signed_in")

    def test_claude_login_progress_reaches_provider_row(self) -> None:
        for status in ("starting", "awaiting_browser", "error"):
            with self.subTest(status=status), patch(
                "backend.services.claude_cli_auth.login_status",
                return_value={"available": True, "status": status, "signed_in": False,
                              "needs_code": status == "awaiting_browser", "login_url": ""},
            ):
                listing = subs.list_subscriptions("host")
                row = self._row(listing, "claude")
                self.assertEqual(row["auth_status"], status)
                self.assertEqual(row["needs_code"], status == "awaiting_browser")
                self.assertEqual(row["login_url"], "")
                self.assertFalse(row["cad_ready"])

    def test_cloud_credits_on_is_cad_ready(self) -> None:
        self.credits = {
            "available": True,
            "balance_cents": 2500,
            "use_platform_key": True,
            "platform_provider": "openai",
        }
        listing = subs.list_subscriptions("host")
        cloud = self._row(listing, "cloud")
        self.assertTrue(cloud["connected"])
        self.assertTrue(cloud["cad_ready"])
        self.assertEqual(cloud["auth_status"], "signed_in")
        self.assertIn("$25.00", cloud["plan_label"])

    def test_saved_chatgpt_subscription_stays_connected_when_cli_status_is_temporarily_offline(self) -> None:
        subs.connect_subscription(
            "host",
            "openai",
            account_email="sam@example.com",
            plan_label="ChatGPT Plus",
        )

        listing = subs.list_subscriptions("host")
        chatgpt = self._row(listing, "openai")

        self.assertTrue(chatgpt["connected"])
        self.assertFalse(chatgpt["cad_ready"])
        self.assertEqual(chatgpt["account_email"], "sam@example.com")
        self.assertEqual(chatgpt["plan_label"], "ChatGPT Plus")

    def test_explicit_chatgpt_logout_removes_saved_connection(self) -> None:
        subs.connect_subscription(
            "host",
            "openai",
            account_email="sam@example.com",
            plan_label="ChatGPT Plus",
        )

        listing = subs.disconnect_subscription("host", "openai")

        self.assertFalse(self._row(listing, "openai")["connected"])


if __name__ == "__main__":
    unittest.main()
