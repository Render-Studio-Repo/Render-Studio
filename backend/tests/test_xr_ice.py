"""GET /api/rtc/ice: Google STUN plus configured servers. No invented vendor."""

from __future__ import annotations

import unittest
from pathlib import Path

from backend.services.xr_hot_path import rtc_ice_payload, rtc_ice_payload_for_client, xr_ice_servers


class XrIceTests(unittest.TestCase):
    def test_empty_env_is_google_stun_only(self):
        payload = rtc_ice_payload({})
        urls = [str(s.get("urls")) for s in payload["iceServers"]]
        self.assertTrue(any("stun.l.google.com" in u for u in urls))
        self.assertFalse(payload["has_turn"])
        self.assertEqual(xr_ice_servers({}), payload["iceServers"])

    def test_json_turn_from_env(self):
        payload = rtc_ice_payload({
            "XR_ICE_SERVERS_JSON": '[{"urls":"turn:ops.example:3478","username":"ops","credential":"secret"}]',
        })
        self.assertTrue(payload["has_turn"])
        turn = next(s for s in payload["iceServers"] if "turn:" in str(s.get("urls")))
        self.assertEqual(turn["username"], "ops")
        self.assertEqual(turn["credential"], "secret")

    def test_turns_urls_and_csv_alias(self):
        payload = rtc_ice_payload({
            "XR_TURN_URLS": "turns:ops.example:5349,stun:extra.example:3478",
            "XR_TURN_USERNAME": "ops",
            "XR_TURN_CREDENTIAL": "secret",
        })
        self.assertTrue(payload["has_turn"])
        urls = [str(s.get("urls")) for s in payload["iceServers"]]
        self.assertTrue(any(u.startswith("turns:") for u in urls))
        self.assertTrue(any("stun.l.google.com" in u for u in urls))

    def test_render3d_alias_and_bad_json_ignored(self):
        payload = rtc_ice_payload({
            "RENDER3D_ICE_SERVERS_JSON": "not-json",
            "RENDER3D_TURN_URLS": "turn:alias.example:3478",
            "RENDER3D_TURN_USERNAME": "ops",
        })
        self.assertTrue(payload["has_turn"])
        self.assertTrue(any("alias.example" in str(s.get("urls")) for s in payload["iceServers"]))

    def test_rejects_http_urls(self):
        payload = rtc_ice_payload({
            "XR_ICE_SERVERS_JSON": '[{"urls":"https://evil.example/ice"}]',
        })
        self.assertFalse(any("evil.example" in str(s.get("urls")) for s in payload["iceServers"]))
        self.assertFalse(payload["has_turn"])

    def test_route_exists_in_main(self):
        src = (Path(__file__).resolve().parents[1] / "main.py").read_text(encoding="utf-8")
        self.assertIn('@app.get("/api/rtc/ice")', src)
        ice_src = src.split('@app.get("/api/rtc/ice")', 1)[1][:600]
        self.assertIn("rtc_ice_payload_for_client", ice_src)
        self.assertIn("get_current_user_optional", ice_src)

    def test_anonymous_clients_do_not_receive_turn(self):
        env = {
            "XR_TURN_URLS": "turn:ops.example:3478",
            "XR_TURN_USERNAME": "ops",
            "XR_TURN_CREDENTIAL": "secret",
        }
        anon = rtc_ice_payload_for_client(authenticated=False, environ=env)
        signed = rtc_ice_payload_for_client(authenticated=True, environ=env)
        self.assertFalse(anon["has_turn"])
        self.assertFalse(any("turn:" in str(s.get("urls")) for s in anon["iceServers"]))
        self.assertTrue(signed["has_turn"])
        self.assertTrue(any("turn:" in str(s.get("urls")) for s in signed["iceServers"]))
        self.assertTrue(any("stun.l.google.com" in str(s.get("urls")) for s in anon["iceServers"]))


if __name__ == "__main__":
    unittest.main()
