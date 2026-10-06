"""Public share video download: formats + with/without audio, no sign-in."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.main import download_share_video
from backend.services.video_ffmpeg import (
    build_strip_audio_cmd,
    build_webm_cmd,
    can_passthrough_share_video,
    is_windows_friendly_mp4,
    media_container_kind,
    mp4_ftyp_has_avc1,
    parse_audio_flag,
    share_video_download_name,
)


class ShareVideoDownloadTests(unittest.TestCase):
    def test_audio_flag_defaults_to_with_audio(self) -> None:
        self.assertTrue(parse_audio_flag(None))
        self.assertTrue(parse_audio_flag("1"))
        self.assertTrue(parse_audio_flag("with-audio"))
        self.assertFalse(parse_audio_flag("0"))
        self.assertFalse(parse_audio_flag("mute"))
        self.assertFalse(parse_audio_flag("without"))

    def test_webm_cmd_keeps_or_drops_audio(self) -> None:
        with_audio = build_webm_cmd("/tmp/in.mp4", "/tmp/out.webm", with_audio=True, ff="ffmpeg")
        self.assertIn("libopus", with_audio)
        self.assertNotIn("-an", with_audio)
        silent = build_webm_cmd("/tmp/in.mp4", "/tmp/out.webm", with_audio=False, ff="ffmpeg")
        self.assertIn("-an", silent)
        self.assertNotIn("libopus", silent)

    def test_strip_audio_copies_video_bitstream(self) -> None:
        cmd = build_strip_audio_cmd("/tmp/in.mp4", "/tmp/out.mp4", ff="ffmpeg")
        self.assertIn("-an", cmd)
        self.assertEqual(cmd[cmd.index("-c:v") + 1], "copy")
        self.assertIn("+faststart", cmd)

    def test_passthrough_only_windows_friendly_h264_mp4(self) -> None:
        avc1 = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
        webm = b"\x1a\x45\xdf\xa3" + b"\x00" * 24
        self.assertTrue(mp4_ftyp_has_avc1(avc1))
        self.assertEqual(media_container_kind("x.mp4", webm), "webm")
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "clip.mp4"
            good.write_bytes(avc1 + b"\x00" * 8)
            fake = Path(tmp) / "named.mp4"
            fake.write_bytes(webm)
            webm_file = Path(tmp) / "clip.webm"
            webm_file.write_bytes(webm)
            self.assertTrue(is_windows_friendly_mp4(good))
            self.assertFalse(is_windows_friendly_mp4(fake))
            self.assertTrue(can_passthrough_share_video(good, "mp4", with_audio=True))
            self.assertFalse(can_passthrough_share_video(good, "mp4", with_audio=False))
            self.assertFalse(can_passthrough_share_video(fake, "mp4", with_audio=True))
            self.assertFalse(can_passthrough_share_video(good, "webm", with_audio=True))
            self.assertTrue(can_passthrough_share_video(webm_file, "webm", with_audio=True))

    def test_silent_download_name(self) -> None:
        self.assertEqual(share_video_download_name("a.mp4", "mp4", with_audio=True), "a.mp4")
        self.assertEqual(share_video_download_name("a.mp4", "mp4", with_audio=False), "a-silent.mp4")
        self.assertEqual(share_video_download_name("a.mp4", "gif", with_audio=True), "a.gif")
        self.assertEqual(share_video_download_name("a.mp4", "mp4", with_audio=True, with_markup=True), "a-marked.mp4")

    def test_share_route_is_public_and_reuses_ffmpeg_stack(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index('@app.api_route("/api/share/{token}/video-download"')
        chunk = src[start : start + 4500]
        self.assertNotIn("get_current_user", chunk.split("def download_share_video", 1)[1][:400])
        self.assertIn("export_clip_bytes", chunk)
        self.assertIn("parse_audio_flag", chunk)
        self.assertIn("can_passthrough_share_video", chunk)
        self.assertIn("parse_markup_flag", chunk)
        self.assertIn("not with_markup and can_passthrough_share_video", chunk)
        self.assertIn("Converted MP4 was not H.264.", chunk)
        self.assertIn("is_windows_friendly_mp4", Path(__file__).resolve().parents[1].joinpath("services/video_ffmpeg.py").read_text(encoding="utf-8"))
        self.assertTrue(callable(download_share_video))

    def test_spa_fallback_never_serves_html_for_api_or_video_download(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index("async def frontend_spa_fallback")
        chunk = src[start : start + 2200]
        self.assertIn('raw.startswith("api/")', chunk)
        self.assertIn('raise HTTPException(404, "Not found")', chunk)
        files_start = src.index('def get_share_file(')
        files_chunk = src[files_start : files_start + 5000]
        self.assertIn("download", files_chunk)
        self.assertIn('["Content-Type"] = "video/mp4"', files_chunk)
        self.assertIn("attachment", files_chunk)
        from fastapi.testclient import TestClient

        from backend.main import app

        paths = {getattr(route, "path", None) for route in app.routes}
        self.assertIn("/api/share/{token}/video-download", paths)
        client = TestClient(app)
        missing = client.get("/api/zz-missing-share-video-download-probe-9f3")
        self.assertEqual(missing.status_code, 404)
        self.assertNotIn("text/html", (missing.headers.get("content-type") or "").lower())
        self.assertFalse((missing.content or b"").lstrip().startswith(b"<!DOCTYPE"))
        converted = client.get("/api/share/notarealtoken/video-download?format=mp4&audio=1")
        self.assertEqual(converted.status_code, 404)
        self.assertNotIn("text/html", (converted.headers.get("content-type") or "").lower())
        self.assertFalse((converted.content or b"").lstrip().startswith(b"<!DOCTYPE"))


if __name__ == "__main__":
    unittest.main()
