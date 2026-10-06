"""Clip-to-GIF encode must keep a real frame size (not a 1×N strip)."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from backend.services.video_ffmpeg import GIF_MAX_SEC, build_gif_cmd, ffmpeg_bin, gif_vf


def _gif_size(data: bytes) -> tuple[int, int]:
    if len(data) < 10 or data[:6] not in {b"GIF87a", b"GIF89a"}:
        raise AssertionError(f"not a GIF header: {data[:16]!r}")
    return int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")


class VideoGifEncodeTests(unittest.TestCase):
    def test_gif_filter_uses_full_palette_and_min_size(self) -> None:
        vf = gif_vf()
        self.assertIn("fps=12", vf)
        self.assertIn("palettegen=stats_mode=full", vf)
        self.assertNotIn("stats_mode=diff", vf)
        self.assertIn(r"max(2\,iw)", vf)
        self.assertIn(r"max(ih\,2)", vf)

    def test_build_gif_cmd_caps_duration_and_audio(self) -> None:
        cmd = build_gif_cmd("/tmp/in.webm", "/tmp/out.gif", ff="ffmpeg")
        self.assertEqual(cmd[cmd.index("-t") + 1], str(GIF_MAX_SEC))
        self.assertIn("-an", cmd)
        self.assertIn("-loop", cmd)
        self.assertEqual(cmd[cmd.index("-vf") + 1], gif_vf())

    def test_convert_endpoint_uses_build_gif_cmd(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index('@app.post("/api/video/convert")')
        chunk = src[start : start + 9000]
        self.assertIn("build_gif_cmd", chunk)
        self.assertNotIn("stats_mode=diff", chunk)

    def test_ffmpeg_gif_is_full_frame(self) -> None:
        ff = ffmpeg_bin()
        try:
            probe = subprocess.run([ff, "-version"], capture_output=True, text=True, timeout=8)
        except (OSError, subprocess.SubprocessError):
            self.skipTest("ffmpeg not available")
        if probe.returncode != 0:
            self.skipTest("ffmpeg not available")
        with tempfile.TemporaryDirectory(prefix="r3d-gif-") as tmp:
            tmp_path = Path(tmp)
            src = tmp_path / "in.mp4"
            out = tmp_path / "out.gif"
            make = subprocess.run(
                [
                    ff, "-y", "-f", "lavfi",
                    "-i", "testsrc=size=320x180:rate=12:duration=1",
                    "-pix_fmt", "yuv420p",
                    str(src),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(make.returncode, 0, make.stderr[-400:])
            cmd = build_gif_cmd(src, out, ff=ff)
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr[-400:])
            data = out.read_bytes()
            width, height = _gif_size(data)
            self.assertGreaterEqual(width, 160)
            self.assertGreaterEqual(height, 90)
            self.assertGreater(len(data), 800)

    def test_hint_gif_asset_is_720x300(self) -> None:
        path = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "studio" / "record-done-hint.gif"
        data = path.read_bytes()
        width, height = _gif_size(data)
        self.assertEqual((width, height), (720, 300))
        self.assertGreater(len(data), 10_000)

    def test_shared_projects_hint_gif_exists(self) -> None:
        path = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "studio" / "shared-projects-hint.gif"
        data = path.read_bytes()
        width, height = _gif_size(data)
        self.assertEqual((width, height), (720, 300))
        self.assertGreater(len(data), 4_000)


if __name__ == "__main__":
    unittest.main()
