"""Voice-mold prototype: model catalog, session config, Astra JSON parse."""

from __future__ import annotations

import unittest

from backend.services import voice_mold_service as vm


class VoiceMoldCatalogTests(unittest.TestCase):
    def test_catalog_includes_realtime_and_astra(self):
        ids = [row["id"] for row in vm.model_catalog()]
        self.assertIn("gpt-realtime-mini", ids)
        self.assertIn("gpt-realtime", ids)
        self.assertIn("gpt-6-astra", ids)
        self.assertIn("gpt-6-astra-pro", ids)
        self.assertIn("claude-opus-4-8", ids)

    def test_realtime_mini_is_websocket_transport(self):
        info = vm.resolve_model("gpt-realtime-mini")
        self.assertEqual(info["transport"], "realtime")
        self.assertEqual(info["latency"], "lowest")

    def test_astra_is_turn_based(self):
        info = vm.resolve_model("gpt-6-astra")
        self.assertEqual(info["transport"], "turn")
        self.assertEqual(info["latency"], "high")
        self.assertTrue(vm.is_realtime_model("gpt-realtime"))
        self.assertFalse(vm.is_realtime_model("gpt-6-astra-pro"))

    def test_claude_subscription_is_a_separate_buffered_turn_provider(self):
        info = vm.resolve_model("claude-opus-4-8")
        self.assertEqual(info["transport"], "turn")
        self.assertEqual(info["subscription_provider"], "claude")
        self.assertIn("transcription", info["hint"].lower())

    def test_unknown_model_raises(self):
        with self.assertRaises(ValueError):
            vm.resolve_model("gpt-5.6-luna")


class VoiceMoldSessionTests(unittest.TestCase):
    def test_instructions_cover_micro_edits(self):
        text = vm.design_instructions({
            "selected": "sun_gear",
            "catalog": "sun_gear.step",
            "parts": ["sun_gear.step", "planet_carrier.step"],
        })
        lower = text.lower()
        self.assertIn("sun_gear", text)
        self.assertIn("gear", lower)
        self.assertIn("fillet", lower)
        self.assertIn("assembly", lower)
        self.assertIn("apply_micro_edit", lower)

    def test_tools_include_context_and_edit(self):
        names = [t["name"] for t in vm.realtime_tools()]
        self.assertEqual(names, ["get_design_context", "apply_micro_edit"])

    def test_review_companion_preserves_wire_sources_and_never_instructs_immediate_edits(self):
        context = {
            "agent_review": True, "agent_settings": {"name": "Nova", "prompt": "Be concise."},
            "generationModel": "selected-cad-model", "wire": {
                "id": "W1", "gauge": "22 AWG", "source": "https://manufacturer.example/pinout",
            },
        }
        text = vm.design_instructions(context)
        self.assertIn("Nova", text)
        self.assertIn("22 AWG", text)
        self.assertIn("https://manufacturer.example/pinout", text)
        self.assertIn("selected-cad-model", text)
        self.assertIn("Never execute a CAD edit", text)
        self.assertNotIn("Set apply_now true", text)
        self.assertIn('"request_review": boolean', vm.astra_turn_system_prompt(context))

    def test_parse_client_secret_nested_and_flat(self):
        self.assertEqual(vm.parse_client_secret_payload({"value": "ek_flat"}), "ek_flat")
        self.assertEqual(
            vm.parse_client_secret_payload({"client_secret": {"value": "ek_nested"}}),
            "ek_nested",
        )
        with self.assertRaises(ValueError):
            vm.parse_client_secret_payload({"ok": True})

    def test_session_config_keeps_a_live_socket_session(self):
        cfg = vm.session_config("gpt-realtime-mini", "Be brief.")
        self.assertEqual(cfg["type"], "realtime")
        self.assertEqual(cfg["model"], "gpt-realtime-mini")
        self.assertEqual(cfg["audio"]["input"]["format"]["rate"], 24000)
        self.assertEqual(cfg["audio"]["input"]["turn_detection"]["type"], "server_vad")

    def test_proxy_path_and_full_session_update(self):
        self.assertEqual(vm.PROXY_WS_PATH, "/api/voice-mold/ws")
        msg = vm.session_update_message("gpt-realtime-mini", "Be brief.")
        self.assertEqual(msg["type"], "session.update")
        self.assertEqual(msg["session"]["type"], "realtime")
        self.assertIn("audio", msg["session"])
        self.assertIn("tools", msg["session"])
        self.assertEqual(msg["session"]["output_modalities"], ["audio"])

    def test_origin_exposes_voice_mold_proxy_route(self):
        from pathlib import Path

        main = Path(__file__).resolve().parents[1] / "main.py"
        text = main.read_text(encoding="utf-8")
        self.assertIn('@app.websocket("/api/voice-mold/ws")', text)
        self.assertIn('@app.post("/api/voice-mold/preview")', text)
        self.assertIn("await serve_realtime_proxy(websocket, info[\"id\"], api_key, instructions)", text)
        self.assertNotIn("**minted", text.split("async def voice_mold_session", 1)[-1].split("@app.post(\"/api/voice-mold/turn\")", 1)[0])


class VoiceMoldPreviewTests(unittest.IsolatedAsyncioTestCase):
    def test_preview_request_is_short_tts_not_a_live_session_or_cad_job(self):
        vm.clear_voice_preview_cache()
        payload = vm.preview_speech_request("Cedar", None)
        self.assertEqual(payload["model"], vm.TTS_PREVIEW_MODEL)
        self.assertEqual(payload["voice"], "cedar")
        self.assertEqual(payload["input"], "Hi, I'm Cedar. This is how I sound.")
        self.assertEqual(payload["response_format"], "mp3")
        self.assertNotIn("tools", payload)
        self.assertNotIn("instructions", payload)
        self.assertEqual(vm.normalize_realtime_voice("nope"), "marin")

    async def test_preview_cache_avoids_a_second_provider_call(self):
        from unittest.mock import AsyncMock, patch

        vm.clear_voice_preview_cache()
        response = type("Resp", (), {"status_code": 200, "content": b"ID3fake"})()
        client = type("Client", (), {"post": AsyncMock(return_value=response)})()
        manager = AsyncMock()
        manager.__aenter__.return_value = client
        with patch("httpx.AsyncClient", return_value=manager):
            first = await vm.synthesize_voice_preview("sk-test", "alloy")
            second = await vm.synthesize_voice_preview("sk-test", "alloy")
        self.assertEqual(first, b"ID3fake")
        self.assertEqual(second, b"ID3fake")
        self.assertEqual(client.post.await_count, 1)
        self.assertEqual(client.post.call_args.args[0], vm.TTS_PREVIEW_URL)
        self.assertNotIn("apply_micro_edit", str(client.post.call_args))


class VoiceMoldAstraParseTests(unittest.TestCase):
    def test_parse_speak_and_edit(self):
        raw = '{"speak":"Rounding that corner.","edit":{"instruction":"fillet 2mm on the pointed boss","apply_now":true}}'
        out = vm.parse_astra_turn_json(raw)
        self.assertEqual(out["speak"], "Rounding that corner.")
        self.assertEqual(out["edit"]["instruction"], "fillet 2mm on the pointed boss")
        self.assertTrue(out["edit"]["apply_now"])

    def test_parse_plain_text_fallback(self):
        out = vm.parse_astra_turn_json("Just talking, no JSON.")
        self.assertIn("Just talking", out["speak"])
        self.assertIsNone(out["edit"])

    def test_review_request_can_open_existing_queue_without_inventing_an_edit(self):
        out = vm.parse_astra_turn_json('{"speak":"Here are the changes for review.","edit":null,"request_review":true}')
        self.assertTrue(out["request_review"])
        self.assertIsNone(out["edit"])

    def test_review_target_ids_and_title_survive_turn_parse(self):
        out = vm.parse_astra_turn_json('{"speak":"Review this route.","edit":{"instruction":"route W1 along left wall","targetIds":["W1"],"title":"Route sensor cable"},"request_review":true}')
        self.assertEqual(out["edit"]["targetIds"], ["W1"])
        self.assertEqual(out["edit"]["title"], "Route sensor cable")
        self.assertTrue(out["edit"]["request_review"])
        self.assertFalse(out["edit"]["apply_now"])


if __name__ == "__main__":
    unittest.main()
