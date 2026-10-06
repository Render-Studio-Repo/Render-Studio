"""JWT signing secret stays stable across process-style restarts."""

from __future__ import annotations

import tempfile
import unittest
import sqlite3
from pathlib import Path
from unittest.mock import patch

from backend import auth
from starlette.requests import Request
from starlette.responses import Response


class JwtSecretPersistTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.tmp.name)
        auth.reset_jwt_secret_cache()
        self.dir_patch = patch.object(auth.settings, "data_dir", str(self.data_dir))
        self.secret_patch = patch.object(auth.settings, "jwt_secret", "")
        self.dir_patch.start()
        self.secret_patch.start()
        self.session_db = self.data_dir / "sessions.db"
        with sqlite3.connect(self.session_db) as conn:
            conn.execute(
                "CREATE TABLE auth_device_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at REAL NOT NULL, last_used_at REAL NOT NULL, expires_at REAL NOT NULL)"
            )
        def session_conn():
            conn = sqlite3.connect(self.session_db)
            conn.row_factory = sqlite3.Row
            return conn
        self.conn_patch = patch.object(auth, "get_conn", session_conn)
        self.conn_patch.start()

    def tearDown(self) -> None:
        auth.reset_jwt_secret_cache()
        self.conn_patch.stop()
        self.secret_patch.stop()
        self.dir_patch.stop()
        self.tmp.cleanup()

    def test_secret_is_written_and_reused_after_cache_reset(self) -> None:
        first = auth._jwt_secret()
        path = auth.jwt_secret_path()
        self.assertTrue(path.is_file())
        self.assertEqual(path.read_text(encoding="utf-8").strip(), first)
        auth.reset_jwt_secret_cache()
        second = auth._jwt_secret()
        self.assertEqual(first, second)

    def test_access_token_survives_simulated_restart(self) -> None:
        token = auth.create_access_token("user-1")
        auth.reset_jwt_secret_cache()
        self.assertEqual(auth.decode_token(token), "user-1")

    def test_session_cookie_survives_simulated_restart(self) -> None:
        token = auth.create_access_token("user-cookie")
        from starlette.responses import Response

        resp = Response()
        auth.attach_session_cookie(resp, token, secure=False)
        header = resp.headers.get("set-cookie") or ""
        self.assertIn(auth.SESSION_COOKIE_NAME, header)
        self.assertIn("HttpOnly", header)
        self.assertIn("Path=/", header)
        self.assertNotIn("password", header.lower())
        auth.reset_jwt_secret_cache()
        self.assertEqual(
            auth.access_token_from_parts("", token),
            token,
        )
        self.assertEqual(auth.decode_token(token), "user-cookie")

    def test_access_token_from_parts_prefers_bearer_then_cookie(self) -> None:
        self.assertEqual(auth.access_token_from_parts("Bearer abc.def", "cookie-tok"), "abc.def")
        self.assertEqual(auth.access_token_from_parts("", "cookie-tok"), "cookie-tok")
        self.assertEqual(auth.access_token_from_parts(None, None), "")

    def test_device_session_is_opaque_resolvable_and_revocable(self) -> None:
        response = Response()
        auth.attach_device_session_cookie(response, "user-device", secure=False)
        header = response.headers.get("set-cookie") or ""
        self.assertIn(auth.DEVICE_SESSION_COOKIE_NAME, header)
        self.assertIn("HttpOnly", header)
        token = header.split("=", 1)[1].split(";", 1)[0]
        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/auth/refresh",
            "headers": [(b"cookie", f"{auth.DEVICE_SESSION_COOKIE_NAME}={token}".encode())],
        })
        self.assertEqual(auth.device_session_from_request(request), ("user-device", token))
        cleared = Response()
        auth.clear_device_session(cleared, request)
        self.assertEqual(auth.device_session_from_request(request), ("", ""))

    def test_provisioned_env_secret_wins_over_file(self) -> None:
        auth._write_jwt_secret_file("file-secret-value-not-used")
        auth.reset_jwt_secret_cache()
        with patch.object(auth.settings, "jwt_secret", "env-provisioned-secret"):
            self.assertEqual(auth._jwt_secret(), "env-provisioned-secret")
            token = auth.create_access_token("user-2")
            auth.reset_jwt_secret_cache()
            self.assertEqual(auth.decode_token(token), "user-2")


if __name__ == "__main__":
    unittest.main()
