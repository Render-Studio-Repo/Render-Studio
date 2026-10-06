"""Onshape OAuth redirect URI must match the developer-portal callback exactly."""

from __future__ import annotations

import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.database import init_db
from backend.services import onshape_oauth


class OnshapeRedirectUriTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_rewrites_loopback_ip_to_localhost(self) -> None:
        with patch.object(onshape_oauth.settings, "onshape_redirect_uri", "http://127.0.0.1:8001/oauth/callback"):
            self.assertEqual(
                onshape_oauth.canonical_redirect_uri(),
                "http://localhost:8001/oauth/callback",
            )

    def test_strips_trailing_slash(self) -> None:
        self.assertEqual(
            onshape_oauth.canonical_redirect_uri("https://render3d.app/oauth/callback/"),
            "https://render3d.app/oauth/callback",
        )

    def test_origin_localhost_uses_localhost_not_configured_host(self) -> None:
        with patch.object(onshape_oauth.settings, "onshape_redirect_uri", "https://render3d.app/oauth/callback"):
            self.assertEqual(
                onshape_oauth.redirect_uri_for_origin("http://127.0.0.1:8001"),
                "http://localhost:8001/oauth/callback",
            )
            self.assertEqual(
                onshape_oauth.redirect_uri_for_origin("https://render3d.app"),
                "https://render3d.app/oauth/callback",
            )
            self.assertEqual(
                onshape_oauth.redirect_uri_for_origin("https://www.render3d.app"),
                "https://render3d.app/oauth/callback",
            )

    def test_authorize_and_state_share_the_same_redirect_uri(self) -> None:
        with patch.object(onshape_oauth.settings, "onshape_client_id", "cid"):
            with patch.object(onshape_oauth.settings, "onshape_client_secret", "sec"):
                with patch.object(onshape_oauth.settings, "onshape_redirect_uri", "https://render3d.app/oauth/callback"):
                    url = onshape_oauth.build_authorization_url(user_id="sam")
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(params["redirect_uri"], ["https://render3d.app/oauth/callback"])
        rec = onshape_oauth.consume_oauth_state(params["state"][0])
        self.assertNotEqual(rec, False)
        self.assertEqual(rec["user_id"], "sam")
        self.assertEqual(rec["redirect_uri"], "https://render3d.app/oauth/callback")

    def test_token_error_explains_missing_redirect_url(self) -> None:
        resp = MagicMock()
        resp.status_code = 400
        resp.text = (
            '{"message":"error=\\"invalid_grant\\", '
            'error_description=\\"Application requested an invalid redirect URL\\"",'
            '"status":400}'
        )
        resp.json.return_value = {
            "message": 'error="invalid_grant", error_description="Application requested an invalid redirect URL"',
            "status": 400,
        }
        err = onshape_oauth._token_exchange_error(resp, "https://render3d.app/oauth/callback")
        self.assertIn("https://render3d.app/oauth/callback", str(err))
        self.assertIn("Redirect URL", str(err))


class OnshapeThumbnailTests(unittest.TestCase):
    def test_only_cad_onshape_thumbnail_urls_are_proxied(self):
        self.assertTrue(
            onshape_oauth.is_onshape_thumbnail_url(
                "https://cad.onshape.com/api/thumbnails/d/abc/w/def"
            )
        )
        self.assertFalse(onshape_oauth.is_onshape_thumbnail_url("http://cad.onshape.com/api/thumbnails/d/a/w/b"))
        self.assertFalse(onshape_oauth.is_onshape_thumbnail_url("https://evil.example/thumbnails/x"))
        self.assertFalse(onshape_oauth.is_onshape_thumbnail_url(""))

    def test_element_and_document_thumbnail_paths(self):
        self.assertEqual(
            onshape_oauth.thumbnail_api_url("did1", "wid1"),
            "https://cad.onshape.com/api/v6/thumbnails/d/did1/w/wid1",
        )
        self.assertEqual(
            onshape_oauth.thumbnail_api_url("did1", "wid1", "eid1"),
            "https://cad.onshape.com/api/v6/thumbnails/d/did1/w/wid1/e/eid1",
        )
        self.assertEqual(onshape_oauth.normalize_thumb_size("nope"), "300x170")
        self.assertEqual(onshape_oauth.normalize_thumb_size("nope", large=True), "300x300")
        self.assertEqual(onshape_oauth.normalize_thumb_size("600x340"), "600x340")

    def test_fetch_thumbnail_uses_element_api_then_fallback(self):
        png = b"\x89PNG\r\n\x1a\n"
        ok = MagicMock()
        ok.is_success = True
        ok.content = png
        ok.headers = {"content-type": "image/png"}
        with patch("backend.services.onshape_oauth.httpx.get", return_value=ok) as get:
            result = onshape_oauth.fetch_thumbnail(
                "tok",
                did="did12345",
                wid="wid12345",
                eid="eid12345",
                fallback_url="https://cad.onshape.com/api/thumbnails/d/did12345/w/wid12345",
            )
        self.assertEqual(result, (png, "image/png"))
        self.assertEqual(get.call_count, 1)
        self.assertIn("/thumbnails/d/did12345/w/wid12345/e/eid12345", get.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
