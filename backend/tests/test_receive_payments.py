"""Receive-money settings, wallets, and public pay payload."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import marketplace_payments_service as seller_pay
from backend.services import receive_payments_service as recv


class ReceivePaymentsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        recv.ensure_schema()
        now = datetime.now(timezone.utc).isoformat()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u1", "a@example.com", "Ada", "x", now),
            )
            conn.commit()
        self.user = {"id": "u1", "email": "a@example.com"}

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_wallet_validation(self) -> None:
        self.assertEqual(recv.validate_eth("0x0000000000000000000000000000000000000000"), "0x0000000000000000000000000000000000000000")
        with self.assertRaises(ValueError):
            recv.validate_eth("not-an-address")
        self.assertTrue(recv.validate_btc("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"))
        with self.assertRaises(ValueError):
            recv.validate_btc("0xabc")
        sol = recv.validate_sol("7EcDhSYGxXxyUrUcZdXQxHNzCbbG7fDmQNYSxXx4NJ8K")
        self.assertTrue(sol)
        with self.assertRaises(ValueError):
            recv.validate_sol("0x0000000000000000000000000000000000000000")

    def test_x_handle_and_paypal_me(self) -> None:
        self.assertEqual(recv.clean_x_handle("@Cool_Maker"), "Cool_Maker")
        with self.assertRaises(ValueError):
            recv.clean_x_handle("way-too-long-handle-name")
        self.assertEqual(recv.clean_paypal_me("https://www.paypal.me/Ada"), "Ada")

    def test_public_button_requires_method_and_toggle(self) -> None:
        payload = recv.public_payload("u1", handle="ada")
        self.assertFalse(payload["show_button"])
        recv.patch_settings(
            self.user,
            {
                "show_receive_button": True,
                "x_handle": "Ada",
                "x_enabled": True,
                "preferred": "x_money",
            },
        )
        payload = recv.public_payload("u1", handle="ada")
        self.assertTrue(payload["show_button"])
        self.assertEqual(payload["preferred"], "x_money")
        self.assertEqual(payload["action"]["url"], "https://x.com/Ada")

    def test_disconnect_wallet_hides_button(self) -> None:
        recv.save_wallet(self.user, "eth", "0x0000000000000000000000000000000000000000", connected_via="manual")
        recv.patch_settings(self.user, {"show_receive_button": True, "preferred": "eth", "wallets": {"eth": {"enabled": True}}})
        self.assertTrue(recv.public_payload("u1")["show_button"])
        recv.disconnect_wallet(self.user, "eth")
        self.assertFalse(recv.public_payload("u1")["show_button"])

    def test_stripe_disconnect_clears_seller(self) -> None:
        seller_pay.upsert_seller_account(
            "u1",
            stripe_account_id="acct_test_1",
            charges_enabled=1,
            payouts_enabled=1,
            details_submitted=1,
        )
        recv.patch_settings(self.user, {"stripe_enabled": True, "show_receive_button": True, "preferred": "stripe"})
        self.assertTrue(recv.stripe_connected("u1"))
        recv.disconnect_stripe(self.user)
        self.assertFalse(recv.stripe_connected("u1"))
        self.assertFalse(recv.public_payload("u1")["show_button"])

    def test_authorized_apps_paypal_not_fake_connected(self) -> None:
        owner = recv.owner_payload(self.user)
        paypal = next(r for r in owner["authorized_apps"] if r["key"] == "paypal")
        self.assertFalse(paypal["connected"])
        self.assertIn(paypal["cta"], {"Setup needed", "Connect"})

    def test_paypal_not_configured_without_keys(self) -> None:
        self.assertFalse(recv.paypal_configured())

    def test_show_toggles_persist_without_connected_method(self) -> None:
        owner = recv.patch_settings(
            self.user,
            {"show_receive_button": True, "stripe_enabled": True, "paypal_enabled": True, "x_enabled": True},
        )
        self.assertTrue(owner["show_receive_button"])
        self.assertTrue(owner["stripe_enabled"])
        self.assertTrue(owner["paypal_enabled"])
        self.assertTrue(owner["x_enabled"])
        self.assertFalse(recv.public_payload("u1")["show_button"])
        recv.patch_settings(self.user, {"x_handle": "Ada", "x_enabled": True, "preferred": "x_money"})
        self.assertTrue(recv.public_payload("u1", handle="ada")["show_button"])


if __name__ == "__main__":
    unittest.main()
