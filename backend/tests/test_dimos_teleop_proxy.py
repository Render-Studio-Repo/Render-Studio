"""LAN-only DIMOS upstream allowlist for the Studio Quest pipe."""

from __future__ import annotations

import unittest

from backend.services.dimos_teleop_proxy import (
    DIMOS_WS_DEFAULT,
    normalize_dimos_upstream,
    studio_can_proxy_lan,
)


class DimosTeleopProxyTests(unittest.TestCase):
    def test_default_lan_openarm_ws(self) -> None:
        self.assertEqual(normalize_dimos_upstream(None), DIMOS_WS_DEFAULT)
        self.assertEqual(normalize_dimos_upstream(""), DIMOS_WS_DEFAULT)
        self.assertEqual(normalize_dimos_upstream(DIMOS_WS_DEFAULT), "wss://192.168.1.83:8443/ws")

    def test_localhost_8443_allowed(self) -> None:
        self.assertEqual(normalize_dimos_upstream("wss://127.0.0.1:8443/ws"), "wss://127.0.0.1:8443/ws")
        self.assertEqual(normalize_dimos_upstream("ws://localhost:8443/ws"), "ws://localhost:8443/ws")

    def test_other_lan_pc_8443_allowed(self) -> None:
        self.assertEqual(normalize_dimos_upstream("192.168.1.50"), "wss://192.168.1.50:8443/ws")
        self.assertEqual(normalize_dimos_upstream("10.0.0.12:8443"), "wss://10.0.0.12:8443/ws")
        self.assertEqual(normalize_dimos_upstream("wss://172.16.4.8:8443/ws"), "wss://172.16.4.8:8443/ws")

    def test_rejects_ssrf_and_wrong_path(self) -> None:
        self.assertEqual(normalize_dimos_upstream("wss://192.168.1.83:8443/teleop"), "")
        self.assertEqual(normalize_dimos_upstream("wss://evil.example:8443/ws"), "")
        self.assertEqual(normalize_dimos_upstream("wss://192.168.1.83:443/ws"), "")
        self.assertEqual(normalize_dimos_upstream("https://192.168.1.83:8443/ws"), "")
        self.assertEqual(normalize_dimos_upstream("wss://169.254.169.254:8443/ws"), "")
        self.assertEqual(normalize_dimos_upstream("wss://8.8.8.8:8443/ws"), "")
        self.assertEqual(normalize_dimos_upstream("wss://render3d.app:8443/ws"), "")

    def test_self_hosted_public_host_can_proxy_lan(self) -> None:
        self.assertTrue(studio_can_proxy_lan("render3d.app"))
        self.assertTrue(studio_can_proxy_lan("app.render3d.app:443"))
        self.assertTrue(studio_can_proxy_lan("192.168.1.83:8001"))
        self.assertTrue(studio_can_proxy_lan("127.0.0.1:8001"))
        self.assertTrue(studio_can_proxy_lan(""))

    def test_explicit_cloud_worker_still_blocks_public_host(self) -> None:
        import os

        os.environ["RENDER3D_CLOUD_WORKER"] = "1"
        try:
            self.assertFalse(studio_can_proxy_lan("render3d.app"))
            self.assertFalse(studio_can_proxy_lan("app.render3d.app:443"))
            self.assertTrue(studio_can_proxy_lan("192.168.1.83:8001"))
            self.assertTrue(studio_can_proxy_lan("127.0.0.1:8001"))
        finally:
            os.environ.pop("RENDER3D_CLOUD_WORKER", None)
