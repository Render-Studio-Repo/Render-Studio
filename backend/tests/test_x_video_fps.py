"""X video encode must CFR-cap at 60 fps (Chrome WebM looks like 1000 fps)."""

from __future__ import annotations

import unittest
from pathlib import Path

from backend.services.video_ffmpeg import (
    X_MAX_FPS,
    apply_ffmpeg_trim,
    build_mp4_cmd,
    build_mux_audio_cmd,
    build_trim_copy_cmd,
    cap_fps_vf,
    clamp_x_fps,
    even_h264_vf,
    mp4_scale_vf,
    mp4_software_codec_args,
    parse_audio_start,
    x_h264_vf,
    x_output_rate_args,
)


class XVideoFpsTests(unittest.TestCase):
    def test_x_max_is_60(self) -> None:
        self.assertEqual(X_MAX_FPS, 60)

    def test_clamp_never_exceeds_x_max(self) -> None:
        self.assertEqual(clamp_x_fps(1000), 60)
        self.assertEqual(clamp_x_fps(120), 60)
        self.assertEqual(clamp_x_fps(60), 60)
        self.assertEqual(clamp_x_fps(30), 30)
        self.assertEqual(clamp_x_fps(None), 60)

    def test_x_filter_starts_with_fps_60(self) -> None:
        vf = x_h264_vf()
        self.assertTrue(vf.startswith("fps=60,"), vf)
        self.assertIn("yuv420p", vf)
        self.assertNotIn("unsharp", vf)

    def test_share_and_x_use_the_fast_1080_cap(self) -> None:
        self.assertEqual(mp4_scale_vf("x"), x_h264_vf())
        self.assertEqual(mp4_scale_vf("share"), x_h264_vf())
        self.assertIn("1920", mp4_scale_vf("x"))

    def test_download_mp4_filter_also_caps_fps(self) -> None:
        self.assertTrue(even_h264_vf().startswith("fps=60,"))

    def test_output_rate_is_60(self) -> None:
        self.assertEqual(x_output_rate_args(), ["-r", "60"])
        self.assertEqual(x_output_rate_args(1000), ["-r", "60"])

    def test_cap_fps_prefixes_chain(self) -> None:
        self.assertEqual(cap_fps_vf("format=yuv420p", 1000), "fps=60,format=yuv420p")

    def test_software_encode_is_veryfast_not_medium(self) -> None:
        args = mp4_software_codec_args("x")
        self.assertIn("-preset", args)
        self.assertEqual(args[args.index("-preset") + 1], "veryfast")
        self.assertEqual(args[args.index("-crf") + 1], "19")
        share = mp4_software_codec_args("share")
        self.assertEqual(share[share.index("-crf") + 1], "18")

    def test_quality_overrides_default_crf(self) -> None:
        std = mp4_software_codec_args("x", "standard")
        ultra = mp4_software_codec_args("x", "ultra")
        self.assertEqual(std[std.index("-crf") + 1], "23")
        self.assertEqual(ultra[ultra.index("-crf") + 1], "17")
        cmd = build_mp4_cmd(
            "/tmp/in.webm", "/tmp/out.mp4", intent="x", encoder="libx264", ff="ffmpeg", quality="standard"
        )
        self.assertEqual(cmd[cmd.index("-crf") + 1], "23")

    def test_build_mp4_cmd_orders_audio_before_faststart(self) -> None:
        cmd = build_mp4_cmd("/tmp/in.webm", "/tmp/out.mp4", intent="x", encoder="libx264", ff="ffmpeg")
        self.assertLess(cmd.index("-c:a"), cmd.index("-movflags"))
        self.assertEqual(cmd[cmd.index("-preset") + 1], "veryfast")
        silent = build_mp4_cmd(
            "/tmp/in.webm", "/tmp/out.mp4", intent="x", encoder="libx264", with_audio=False, ff="ffmpeg"
        )
        self.assertIn("-an", silent)
        self.assertNotIn("-c:a", silent)

    def test_mux_audio_copies_video_and_trims_song(self) -> None:
        self.assertEqual(parse_audio_start("12.5"), 12.5)
        self.assertEqual(parse_audio_start("nope"), 0.0)
        cmd = build_mux_audio_cmd(
            "/tmp/in.mp4",
            "/tmp/song.mp3",
            "/tmp/out.mp4",
            audio_start=8.25,
            duration=6.0,
            ff="ffmpeg",
            fmt="mp4",
        )
        self.assertEqual(cmd[cmd.index("-c:v") + 1], "copy")
        self.assertEqual(cmd[cmd.index("-ss") + 1], "8.250")
        self.assertEqual(cmd[cmd.index("-t") + 1], "6.000")
        self.assertIn("aac", cmd)
        self.assertNotIn("libx264", cmd)
        self.assertNotIn("h264_videotoolbox", cmd)

    def test_convert_route_muxes_overlay_without_video_reencode(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index('@app.post("/api/video/convert")')
        chunk = src[start : start + 12000]
        self.assertIn("overlay_audio", chunk)
        self.assertIn("build_mux_audio_cmd", chunk)
        self.assertIn("skip_convert", chunk)
        self.assertIn("c:v copy", " ".join(build_mux_audio_cmd("/v.mp4", "/a.mp3", "/o.mp4", ff="ffmpeg")))

    def test_trim_copy_seeks_then_copies(self) -> None:
        cmd = build_trim_copy_cmd("/tmp/in.mp4", "/tmp/out.mp4", trim_in=1.25, duration=4.5, ff="ffmpeg")
        self.assertEqual(cmd[cmd.index("-ss") + 1], "1.250")
        self.assertEqual(cmd[cmd.index("-t") + 1], "4.500")
        self.assertEqual(cmd[cmd.index("-c") + 1], "copy")
        patched = apply_ffmpeg_trim(
            ["ffmpeg", "-y", "-i", "/in.webm", "-c:v", "libx264", "/out.mp4"],
            trim_in=2,
            duration=3,
        )
        self.assertEqual(patched[patched.index("-ss") + 1], "2.000")
        self.assertEqual(patched[patched.index("-t") + 1], "3.000")
        self.assertLess(patched.index("-ss"), patched.index("-i"))
        convert = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        chunk = convert[convert.index('@app.post("/api/video/convert")') : convert.index('@app.post("/api/video/convert")') + 14000]
        self.assertIn("build_trim_copy_cmd", chunk)
        self.assertIn("trim_in", chunk)


if __name__ == "__main__":
    unittest.main()
