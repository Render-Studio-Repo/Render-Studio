"""Incoming print requests are opt-in and authenticated."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import social_network_service as social


class PrinterShareTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("sam", "sam@example.com", "Sam", "x", "2026-09-14T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("ada", "ada@example.com", "Ada", "x", "2026-09-14T00:00:00+00:00"),
            )

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_accept_sends_defaults_off(self) -> None:
        settings = social.get_printer_share_settings("sam")
        self.assertFalse(settings["accept_sends"])
        self.assertFalse(settings["show_outline"])
        self.assertEqual(settings["lan_ip"], "")
        self.assertEqual(settings["access_code"], "")
        self.assertEqual(settings["serial"], "")
        self.assertEqual(settings["name"], "")

    def test_lan_fields_persist_without_enabling_print_requests(self) -> None:
        saved = social.save_printer_share_settings(
            "sam",
            lan_ip="192.168.1.34",
            access_code="87654321",
            serial="01S00C123456789",
            name="Shop X1C",
        )
        self.assertEqual(saved["lan_ip"], "192.168.1.34")
        self.assertEqual(saved["serial"], "01S00C123456789")
        self.assertEqual(saved["name"], "Shop X1C")
        self.assertFalse(saved["accept_sends"])
        again = social.get_printer_share_settings("sam")
        self.assertEqual(again["lan_ip"], "192.168.1.34")
        self.assertEqual(again["access_code"], "87654321")
        public = social.client_printer_share(again)
        self.assertEqual(public.get("access_code"), "")
        self.assertTrue(public.get("access_code_set"))

    def test_fence_persists_without_secrets(self) -> None:
        saved = social.save_printer_share_settings(
            "sam",
            show_outline=True,
            fence={"size": [0.4, 0.26, 0.3], "position": [0.2, 0.13, -0.8]},
        )
        self.assertEqual(saved["fence"]["size"][0], 0.4)
        public = social.client_printer_share(saved)
        self.assertEqual(public["fence"]["position"][2], -0.8)
        self.assertEqual(public.get("access_code"), "")

    def test_public_printer_ip_rejected(self) -> None:
        with self.assertRaises(ValueError):
            social.save_printer_share_settings("sam", lan_ip="8.8.8.8")

    def test_send_rejected_until_opt_in(self) -> None:
        sender = {"id": "ada", "display_name": "Ada", "email": "ada@example.com"}
        with self.assertRaises(PermissionError):
            social.send_to_printer(sender, "sam", project_id="p1")
        social.save_printer_share_settings("sam", accept_sends=True)
        result = social.send_to_printer(sender, "sam", project_id="p1", filename="part.glb")
        self.assertTrue(result["ok"])
        inbox = social.list_printer_inbox("sam")
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]["from_user_id"], "ada")


if __name__ == "__main__":
    unittest.main()
