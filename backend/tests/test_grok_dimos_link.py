"""Tests for Grok ↔ DIMOS LAN link (save + normalize only)."""

from __future__ import annotations

import unittest

from backend.services import grok_dimos_link as gdl
from backend.services.dimos_teleop_proxy import normalize_dimos_upstream


class GrokDimosLinkTests(unittest.TestCase):
    def test_normalize_accepts_lan_ip(self):
        self.assertEqual(normalize_dimos_upstream("192.168.1.77"), "wss://192.168.1.77:8443/ws")
        self.assertEqual(gdl.host_display("wss://192.168.1.77:8443/ws"), "192.168.1.77:8443")
        self.assertEqual(gdl.https_teleop_url("wss://10.0.0.5:8443/ws"), "https://10.0.0.5:8443/teleop")

    def test_api_catalog_on_get_shape(self):
        # Shape only — no DB user required for helpers
        self.assertIn("studio_ws", {
            "get": "GET /api/integrations/grok-bot/dimos",
            "connect": 'POST /api/integrations/grok-bot/dimos {"host":"192.168.1.77"}',
            "studio_ws": "/api/dimos/ws?upstream=wss://HOST:8443/ws",
        })

    def test_invalid_host_rejected(self):
        with self.assertRaises(ValueError):
            gdl.connect_link("test-user-no-db-maybe", "evil.example.com")


if __name__ == "__main__":
    unittest.main()
