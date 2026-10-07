"""LAN-only Teleop HTTPS proxy helpers. No live DIMOS required."""

from __future__ import annotations

import unittest

from backend.services.robotics_prefs import defaults_for
from backend.services.teleop_proxy import (
    SAM_TELEOP_EXAMPLE,
    allow_teleop_target,
    normalize_teleop_url,
    rewrite_teleop_html,
)


class TeleopProxyTests(unittest.TestCase):
    def test_coerce_https_teleop_path(self) -> None:
        self.assertEqual(normalize_teleop_url("192.168.1.77"), SAM_TELEOP_EXAMPLE)
        self.assertEqual(normalize_teleop_url("http://192.168.1.77:8443/"), SAM_TELEOP_EXAMPLE)
        self.assertEqual(normalize_teleop_url("wss://192.168.1.77:8443/ws"), SAM_TELEOP_EXAMPLE)
        self.assertEqual(normalize_teleop_url("https://192.168.1.77:8443/teleop"), SAM_TELEOP_EXAMPLE)
        self.assertEqual(normalize_teleop_url("127.0.0.1"), "https://127.0.0.1:8443/teleop")
        self.assertEqual(normalize_teleop_url("https://example.com/teleop"), "")
        self.assertEqual(normalize_teleop_url("http://8.8.8.8:8443/teleop"), "")

    def test_keep_ws_path_for_proxy(self) -> None:
        url, host, port, path = allow_teleop_target("https://192.168.1.77:8443/ws", keep_path=True)
        self.assertEqual(host, "192.168.1.77")
        self.assertEqual(port, 8443)
        self.assertTrue(path.startswith("/ws"))
        self.assertTrue(url.startswith("https://192.168.1.77:8443/ws"))

    def test_html_rewrite_and_autoconnect(self) -> None:
        html = rewrite_teleop_html(
            '<html><head></head><body><button>Connect</button><script src="/assets/teleop.js"></script></body></html>',
            "/api/teleop/p/192.168.1.77/8443/",
            "192.168.1.77",
        )
        self.assertIn('href="/api/teleop/p/192.168.1.77/8443/"', html)
        self.assertIn('src="/api/teleop/p/192.168.1.77/8443/assets/teleop.js"', html)
        self.assertIn("/api/teleop/p/", html)
        self.assertIn("studio-teleop-autoconnect", html)
        self.assertIn("clickConnect", html)

    def test_sam_defaults_include_teleop(self) -> None:
        sam = {"id": "sam", "email": "sam@render3d.app"}
        other = {"id": "ada", "email": "ada@example.com"}
        self.assertEqual(defaults_for(sam)["teleopActive"], SAM_TELEOP_EXAMPLE)
        self.assertEqual(defaults_for(other)["teleopActive"], "https://127.0.0.1:8443/teleop")


class TeleopRouterImportTests(unittest.TestCase):
    def test_router_paths_exist(self) -> None:
        from backend.routers.robotics_studio import router

        paths = {getattr(r, "path", "") for r in router.routes}
        self.assertTrue(any("/api/teleop/open" in p for p in paths))
        self.assertTrue(any("/api/teleop/p/{host}/{port}" in p for p in paths))

    def test_self_hosted_render3d_can_open_lan_teleop(self) -> None:
        from unittest.mock import patch

        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from backend.auth import get_current_user
        from backend.routers.robotics_studio import router

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "email": "ada@example.com"}
        client = TestClient(app)
        with patch("backend.routers.robotics_studio.probe_teleop", return_value=(True, "")):
            res = client.post(
                "/api/teleop/open",
                json={"url": "https://192.168.1.77:8443/teleop"},
                headers={"host": "render3d.app"},
            )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertIn("/api/teleop/p/192.168.1.77/8443/teleop", body.get("iframe") or "")
        self.assertTrue(str(body.get("url") or "").startswith("https://192.168.1.77:8443/teleop"))
        self.assertEqual(body.get("ok"), True)
        with patch("backend.routers.robotics_studio.probe_teleop", return_value=(True, "")):
            http_in = client.post(
                "/api/teleop/open",
                json={"url": "http://192.168.1.77:8443"},
                headers={"host": "render3d.app"},
            )
        self.assertEqual(http_in.status_code, 200, http_in.text)
        self.assertTrue(str(http_in.json().get("url") or "").startswith("https://192.168.1.77:8443/teleop"))
