"""X Account Activity webhook: CRC, HMAC reject/accept, Grok bot inbound."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.database import get_conn, init_db
from backend.routers.x_webhook import router
from backend.services import grok_bot_service, x_webhook_service as xwh

SECRET = "unit-test-consumer-secret"
CRC_TOKEN = "challenge-token-1"


def _sha256_b64(secret: str, message: bytes) -> str:
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


class CrcAndSignatureTests(unittest.TestCase):
    def test_crc_token_keeps_plus_from_raw_query(self) -> None:
        raw = b"crc_token=abc+def%2Fg"
        self.assertEqual(xwh.crc_token_from_query(raw), "abc+def/g")
        self.assertEqual(xwh.crc_token_from_query(b""), "")

    def test_crc_matches_x_hmac_sha256_spec(self) -> None:
        out = xwh.crc_response(CRC_TOKEN, SECRET)
        expected = "sha256=" + _sha256_b64(SECRET, CRC_TOKEN.encode("utf-8"))
        self.assertEqual(out["response_token"], expected)
        self.assertTrue(out["response_token"].startswith("sha256="))
        self.assertNotIn(SECRET, json.dumps(out))

    def test_signature_accepts_matching_hmac_and_rejects_wrong(self) -> None:
        body = b'{"for_user_id":"1"}'
        good = xwh.signature_header_value(body, SECRET)
        self.assertTrue(xwh.verify_signature(body, good, SECRET))
        self.assertFalse(xwh.verify_signature(body, "sha256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", SECRET))
        self.assertFalse(xwh.verify_signature(body, None, SECRET))
        self.assertFalse(xwh.verify_signature(body, good[:-1] + ("B" if good[-1] != "B" else "A"), SECRET))


class ExtractInboundTests(unittest.TestCase):
    def test_skips_self_tweets_and_keeps_mentions_and_dms(self) -> None:
        payload = {
            "for_user_id": "99",
            "tweet_create_events": [
                {"id_str": "1", "text": "own tweet", "user": {"id_str": "99"}},
                {"id_str": "2", "text": "@bot hello", "user": {"id_str": "55"}},
                {"id_str": "3", "text": "rt", "user": {"id_str": "55"}, "retweeted_status": {"id": "0"}},
            ],
            "direct_message_events": [
                {
                    "id": "dm1",
                    "message_create": {
                        "sender_id": "99",
                        "message_data": {"text": "echo"},
                    },
                },
                {
                    "id": "dm2",
                    "message_create": {
                        "sender_id": "55",
                        "message_data": {"text": "help with CAD"},
                    },
                },
            ],
        }
        messages = xwh.extract_inbound_messages(payload)
        kinds = {(m["kind"], m["text"]) for m in messages}
        self.assertEqual(kinds, {("mention", "@bot hello"), ("dm", "help with CAD")})


class WebhookRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.secret_patch = patch.object(xwh, "consumer_secret", return_value=SECRET)
        self.secret_patch.start()
        self.inbound_patch = patch.object(
            grok_bot_service, "handle_inbound_messages", return_value=[{"status": "drafted"}]
        )
        self.inbound_patch.start()

    def tearDown(self) -> None:
        self.inbound_patch.stop()
        self.secret_patch.stop()

    def test_get_crc_token_returns_response_token(self) -> None:
        res = self.client.get("/api/webhooks/x", params={"crc_token": CRC_TOKEN})
        self.assertEqual(res.status_code, 200)
        expected = "sha256=" + _sha256_b64(SECRET, CRC_TOKEN.encode("utf-8"))
        self.assertEqual(res.json()["response_token"], expected)
        alias = self.client.get("/api/x/webhook", params={"crc_token": CRC_TOKEN})
        self.assertEqual(alias.json()["response_token"], expected)
        extra = self.client.get("/webhooks/x", params={"crc_token": CRC_TOKEN})
        self.assertEqual(extra.status_code, 200)
        self.assertEqual(extra.json()["response_token"], expected)
        head = self.client.head("/api/webhooks/x", params={"crc_token": CRC_TOKEN})
        self.assertEqual(head.status_code, 200)
        plus = "abc+def/ghi"
        plus_res = self.client.get("/api/webhooks/x?crc_token=abc+def%2Fghi")
        self.assertEqual(plus_res.status_code, 200)
        self.assertEqual(
            plus_res.json()["response_token"],
            "sha256=" + _sha256_b64(SECRET, plus.encode("utf-8")),
        )

    def test_get_without_crc_is_health(self) -> None:
        res = self.client.get("/api/webhooks/x")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["service"], "x-account-activity")
        self.assertIn("/api/webhooks/x", body["paths"])
        self.assertTrue(str(body["public_url"]).startswith("https://render3d.app/"))

    def test_post_rejects_bad_signature(self) -> None:
        res = self.client.post(
            "/api/webhooks/x",
            content=b'{"for_user_id":"1"}',
            headers={"X-Twitter-Webhooks-Signature": "sha256=deadbeef", "Content-Type": "application/json"},
        )
        self.assertEqual(res.status_code, 403)

    def test_post_accepts_valid_signature_and_wires_bot(self) -> None:
        payload = {
            "for_user_id": "99",
            "tweet_create_events": [
                {"id_str": "2", "text": "@bot hello", "user": {"id_str": "55"}},
            ],
        }
        body = json.dumps(payload).encode("utf-8")
        sig = xwh.signature_header_value(body, SECRET)
        res = self.client.post(
            "/api/webhooks/x",
            content=body,
            headers={"X-Twitter-Webhooks-Signature": sig, "Content-Type": "application/json"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["events"], 1)
        grok_bot_service.handle_inbound_messages.assert_called_once()


class InboundGrokBotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        grok_bot_service.ensure_schema()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u1", "ada@example.com", "Ada", "x", "2026-09-16T00:00:00+00:00"),
            )
        self.user = {"id": "u1"}
        self.sb = patch("backend.services.supabase_users_store.enabled", return_value=False)
        self.sb.start()
        self.sb_x = patch("backend.services.supabase_users_store.x_consumer_credentials", return_value=None)
        self.sb_x.start()
        self.sb_set = patch("backend.services.supabase_users_store.set_x_consumer_credentials", return_value=False)
        self.sb_set.start()
        self.sb_bot = patch("backend.services.supabase_users_store.x_bot_token", return_value="")
        self.sb_bot.start()

    def tearDown(self) -> None:
        self.sb_bot.stop()
        self.sb_set.stop()
        self.sb_x.stop()
        self.sb.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_inbound_mention_drafts_via_grok_chat_and_does_not_post(self) -> None:
        grok_bot_service.connect(
            self.user,
            {"consumer_key": "ckTESTAPPKEY12345", "consumer_secret": "super-secret-consumer"},
        )
        with patch.object(
            grok_bot_service, "chat", return_value={"ok": True, "text": "hello from grok"}
        ) as chat, patch.object(grok_bot_service.settings, "x_webhook_auto_reply", False):
            out = grok_bot_service.handle_inbound_messages(
                [
                    {
                        "kind": "mention",
                        "text": "@bot make a gear",
                        "sender_id": "55",
                        "tweet_id": "2",
                        "for_user_id": "99",
                    }
                ]
            )
        self.assertEqual(out[0]["status"], "drafted")
        self.assertTrue(out[0]["dry_run"])
        self.assertFalse(out[0]["posted"])
        chat.assert_called_once()
        self.assertIn("make a gear", chat.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
