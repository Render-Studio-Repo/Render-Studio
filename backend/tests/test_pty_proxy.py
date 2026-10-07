from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.auth import get_current_user
from backend.routers import robotics_studio
from backend.routers.robotics_studio import router
from backend.services.pty_proxy import allow_pty_target


class PtyProxyTests(unittest.TestCase):
    def test_allow_loopback_and_lan_not_public(self) -> None:
        url, host, port = allow_pty_target("127.0.0.1", 8765)
        self.assertEqual(host, "127.0.0.1")
        self.assertEqual(port, 8765)
        self.assertTrue(url.startswith("ws://127.0.0.1:8765"))
        allow_pty_target("192.168.1.83", 8765)
        with self.assertRaises(ValueError):
            allow_pty_target("8.8.8.8", 8765)
        with self.assertRaises(ValueError):
            allow_pty_target("example.com", 8765)

    def test_proxy_401_without_auth(self) -> None:
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        res = client.get("/api/pty/p/127.0.0.1/8765/")
        self.assertEqual(res.status_code, 401)
        opened = client.post(
            "/api/pty/open",
            json={"host": "127.0.0.1", "port": 8765, "token": "not-a-real-token"},
        )
        self.assertEqual(opened.status_code, 401)

    def test_open_issues_ticket_then_http_ok(self) -> None:
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "email": "sam@render3d.app"}
        robotics_studio._pty_tickets.clear()
        client = TestClient(app)
        with patch("backend.routers.robotics_studio.probe_pty", return_value=(False, "Sidecar not running")):
            res = client.post(
                "/api/pty/open",
                json={"host": "127.0.0.1", "port": 8765, "token": "sidecar-token-value"},
                headers={"host": "render3d.app"},
            )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body.get("ws"), "/api/pty/p/127.0.0.1/8765/")
        self.assertEqual(body.get("ok"), False)
        self.assertIn("pty_ticket", res.cookies)
        gated = client.get("/api/pty/p/127.0.0.1/8765/", headers={"host": "render3d.app"})
        self.assertEqual(gated.status_code, 200, gated.text)
        bare = TestClient(app)
        self.assertEqual(bare.get("/api/pty/p/127.0.0.1/8765/").status_code, 401)
