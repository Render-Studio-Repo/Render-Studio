"""POST /api/auth/login — expected failures are 401/503, never a bare 500."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.services import auth_rate_limit
from backend.services import teams_service


class LoginRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from backend.main import app

        cls.app = app

    def setUp(self) -> None:
        auth_rate_limit.reset()
        self.misconfig = patch(
            "backend.services.supabase_client.supabase_login_misconfigured",
            return_value="",
        )
        self.misconfig.start()

    def tearDown(self) -> None:
        self.misconfig.stop()
        auth_rate_limit.reset()

    def _post(self, payload: dict | None = None, *, raise_server: bool = False) -> object:
        client = TestClient(self.app, raise_server_exceptions=raise_server)
        return client.post(
            "/api/auth/login",
            json=payload or {"email": "sam@example.com", "password": "secret1"},
        )

    def test_rate_limit_module_imports(self) -> None:
        from backend.services.auth_rate_limit import allow

        self.assertTrue(allow(ip="127.0.0.1", email="sam@example.com"))

    def test_wrong_password_is_401_with_request_id(self) -> None:
        with patch("backend.main.teams_service.authenticate", return_value=None):
            res = self._post()
        self.assertEqual(res.status_code, 401)
        body = res.json()
        self.assertEqual(body["detail"], "Invalid email or password")
        self.assertTrue(body.get("request_id"))
        self.assertEqual(res.headers.get("x-request-id"), body["request_id"])

    def test_unavailable_account_service_is_503(self) -> None:
        with patch(
            "backend.main.teams_service.authenticate",
            side_effect=teams_service.AccountServiceUnavailable("supabase_unreachable"),
        ):
            res = self._post()
        self.assertEqual(res.status_code, 503)
        body = res.json()
        self.assertIn("unavailable", body["detail"].lower())
        self.assertTrue(body.get("request_id"))

    def test_unexpected_authenticate_crash_is_500_with_detail(self) -> None:
        with patch("backend.main.teams_service.authenticate", side_effect=RuntimeError("boom")):
            res = self._post()
        self.assertEqual(res.status_code, 500)
        body = res.json()
        self.assertIn("account service", body["detail"].lower())
        self.assertNotEqual(body["detail"], "Login failed (500)")
        self.assertTrue(body.get("request_id"))
        self.assertTrue(res.headers.get("x-request-id"))

    def test_missing_supabase_env_is_503(self) -> None:
        with patch(
            "backend.services.supabase_client.supabase_login_misconfigured",
            return_value="Account service is missing SUPABASE_URL.",
        ):
            res = self._post()
        self.assertEqual(res.status_code, 503)
        body = res.json()
        self.assertIn("SUPABASE_URL", body["detail"])
        self.assertTrue(body.get("request_id"))

    def test_invalid_email_is_422_not_500(self) -> None:
        res = self._post({"email": "not-an-email", "password": "secret1"})
        self.assertEqual(res.status_code, 422)
        body = res.json()
        self.assertTrue(body.get("detail"))
        self.assertTrue(body.get("request_id"))

    def test_list_teams_crash_does_not_fail_login(self) -> None:
        user = {"id": "u1", "email": "sam@example.com", "display_name": "Sam"}
        with (
            patch("backend.main.teams_service.authenticate", return_value=user),
            patch("backend.main.teams_service.list_teams", side_effect=RuntimeError("teams down")),
        ):
            res = self._post()
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json().get("token"))
        self.assertEqual(res.json()["user"]["id"], "u1")
        self.assertEqual(res.json()["teams"], [])


if __name__ == "__main__":
    unittest.main()
