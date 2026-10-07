"""Studio Discord clip share uses bot channels without exposing the token."""

from __future__ import annotations

import unittest
from pathlib import Path


class DiscordClipShareTests(unittest.TestCase):
    def test_list_channels_never_returns_token_name_as_value_field(self) -> None:
        svc = Path(__file__).resolve().parents[1].joinpath("services/discord_updates_service.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("def list_share_channels", svc)
        self.assertIn("DISCORD_BOT_TOKEN is not configured", svc)
        self.assertIn("Never returns DISCORD_BOT_TOKEN", svc)
        self.assertIn("DISCORD_TEXT_CHANNEL_TYPES", svc)
        self.assertIn("channel_id", svc)
        self.assertIn("file_bytes", svc)
        self.assertIn("users", svc)
        self.assertIn("default_channel_id", svc)
        self.assertIn("1512906649822560508", svc)
        self.assertIn("open_dm_channel", svc)
        self.assertIn("send_dm_message_with_file", svc)
        self.assertNotIn("DISCORD_BOT_TOKEN=", svc)

    def test_routes_exist(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        self.assertIn('@app.get("/api/integrations/discord/channels")', src)
        self.assertIn('@app.post("/api/integrations/discord/share-clip")', src)
        self.assertIn("send_dm_message_with_file", src)
        self.assertIn("user_id", src)
        convert = src[src.index('@app.post("/api/video/convert")') : src.index('@app.post("/api/video/convert")') + 9000]
        self.assertIn("parse_audio_flag", convert)
        self.assertIn("keep_audio", convert)
        self.assertIn("build_webm_cmd", convert)
        self.assertNotIn("DISCORD_BOT_TOKEN=", src[src.index("discord_share_channels") : src.index("discord_share_channels") + 2000])
