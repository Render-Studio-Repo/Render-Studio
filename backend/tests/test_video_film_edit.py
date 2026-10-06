"""Film-edit assemble helper runs off the event loop."""

from __future__ import annotations

import unittest
from pathlib import Path

from backend.services.video_film_edit import normalize_transition, normalize_zoom, plan_from_prompt


class VideoFilmEditTests(unittest.TestCase):
    def test_normalize_dissolve_as_crossfade(self) -> None:
        self.assertEqual(normalize_transition("dissolve"), "crossfade")
        self.assertEqual(normalize_transition("fade"), "fade")
        self.assertEqual(normalize_zoom("punch"), "in")

    def test_prompt_plan_zoom(self) -> None:
        plan = plan_from_prompt("make a single clip with cool video editing and zooms")
        self.assertEqual(plan.get("zoom"), "in")

    def test_image_clip_loops_in_ffmpeg_args(self) -> None:
        from backend.services.video_film_edit import _src_input_args

        args = _src_input_args(Path("still.png"), 0)
        self.assertIn("-loop", args)
        self.assertIn("still.png", args)
        self.assertEqual(_src_input_args(Path("take.webm"), 0.0)[0], "-i")

    def test_film_edit_endpoint_persists_detached_job(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = src.index('@app.post("/api/video/film-edit")')
        chunk = src[start : start + 9000]
        self.assertIn("_queue_generation_task", chunk)
        self.assertIn("video_film_edit.background_film_edit", chunk)
        self.assertIn("generation_service.start", chunk)
        self.assertIn("persist_film_edit_job", chunk)
        self.assertIn("fade_in", chunk)
        self.assertIn("clip_path_", chunk)
        self.assertIn("ai_key_source", chunk)
        self.assertIn("status_code=202", chunk)

    def test_persist_and_load_film_edit_spec(self) -> None:
        from backend.services.video_film_edit import (
            FILM_EDIT_KIND,
            load_film_edit_spec,
            persist_film_edit_job,
            provider_from_key_source,
            write_job_bytes,
        )

        self.assertEqual(provider_from_key_source("chatgpt", "gpt-6-astra"), "openai")
        self.assertEqual(provider_from_key_source("claude", "claude-fable-5"), "anthropic")
        import tempfile

        with tempfile.TemporaryDirectory(prefix="r3d-film-job-") as tmp:
            project = Path(tmp)
            spec = {
                "fmt": "webm",
                "model": "gpt-6-astra",
                "provider": "openai",
                "clips": [],
            }
            dest = persist_film_edit_job(project, "trace-vidjob1", spec)
            write_job_bytes(dest, "in_0.webm", b"fake-webm")
            loaded = load_film_edit_spec(project, "trace-vidjob1")
            self.assertEqual(loaded["model"], "gpt-6-astra")
            self.assertEqual(loaded["trace_id"], "trace-vidjob1")
            self.assertEqual(FILM_EDIT_KIND, "video")

    def test_complete_writes_quoted_relative_url(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("services/video_film_edit.py").read_text(encoding="utf-8")
        self.assertIn('rel = dest.relative_to(project_path).as_posix()', src)
        self.assertIn('quote(rel, safe=\'/\')', src)
        self.assertIn('quote(project_id, safe=\'\')', src)
        from backend.services.generation_service import _project_file_url

        url = _project_file_url("proj a", "references/Video Editor/clip.webm")
        self.assertIn("/api/projects/", url)
        self.assertIn("Video%20Editor", url)
        self.assertIn("references/", url)
        self.assertNotIn("Video Editor", url)

    def test_completed_video_job_exposes_editor_name(self) -> None:
        from backend.services.generation_service import _public_job

        job = _public_job(
            {"status": "complete", "kind": "video", "trace_id": "film-1", "editor_name": "Recording edit"},
            project_id="project-1",
        )
        self.assertEqual(job["editor_name"], "Recording edit")

    def test_stream_copy_skips_vp9_master_encode(self) -> None:
        from backend.services.video_film_edit import (
            _zoom_vf,
            film_edit_needs_video_reencode,
            stream_copy_trim_cmd,
        )

        self.assertFalse(
            film_edit_needs_video_reencode(
                zoom="none",
                transition="cut",
                clip_paths=[Path("take.webm"), Path("take2.webm")],
            )
        )
        self.assertTrue(film_edit_needs_video_reencode(zoom="in", clip_paths=[Path("take.webm")]))
        self.assertNotIn("1920:1080", _zoom_vf("none"))
        cmd = stream_copy_trim_cmd("ffmpeg", Path("take.webm"), Path("out.webm"), 0.5, 2.0, False)
        self.assertIn("-c", cmd)
        self.assertIn("copy", cmd)
        src = Path(__file__).resolve().parents[1].joinpath("services/video_film_edit.py").read_text(encoding="utf-8")
        self.assertNotIn("libvpx-vp9", src)
        self.assertIn("mp4_codec_args", src)
        self.assertIn("on_progress", src)
        self.assertIn("shutil.copyfile", src)
        main = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        start = main.index('@app.post("/api/video/film-edit")')
        chunk = main[start : start + 1200]
        self.assertIn('form.get("format") or "mp4"', chunk)

    def test_hardware_encoder_has_software_fallback(self) -> None:
        from backend.services.video_film_edit import _mp4_codec_candidates

        candidates = _mp4_codec_candidates(["-c:v", "h264_videotoolbox"])
        self.assertEqual(candidates[0], ["-c:v", "h264_videotoolbox"])
        self.assertIn("libx264", candidates[1])
        self.assertEqual(_mp4_codec_candidates(["-c:v", "libx264"]), [["-c:v", "libx264"]])


class FilmEditMediaRegressionTests(unittest.TestCase):
    """Use real media: a completed job must contain the whole clip and requested audio."""

    def test_webm_music_and_missing_ffprobe(self):
        import subprocess
        import tempfile
        from unittest.mock import patch
        from backend.services.video_ffmpeg import ffmpeg_bin
        from backend.services.video_film_edit import run_film_edit, _probe_duration, _media_header
        ff = ffmpeg_bin()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src, music = root / "silent.webm", root / "music.wav"
            subprocess.run([ff, "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=20",
                "-t", "3", "-c:v", "libvpx", "-deadline", "realtime", str(src)], check=True)
            subprocess.run([ff, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440",
                "-t", "1", str(music)], check=True)
            with patch("backend.services.video_film_edit.shutil.which", return_value=None):
                self.assertAlmostEqual(_probe_duration(ff, src), 3, delta=0.15)
                output = run_film_edit(root, [src], durations=[0], trim_in=[0], trim_out=[None],
                    music_path=music, music_start_sec=0.25)
            self.assertGreater(_probe_duration(ff, output), 2.8)
            header = _media_header(ff, output)
            self.assertIn("Audio: opus", header)
            self.assertIn("Video: vp8", header)  # Video stayed stream-copied.

    def test_unknown_duration_is_not_a_one_second_success(self):
        from unittest.mock import patch
        from backend.services.video_film_edit import _clip_use_duration
        with patch("backend.services.video_film_edit._probe_duration", return_value=0):
            with self.assertRaisesRegex(RuntimeError, "duration"):
                _clip_use_duration("ffmpeg", Path("broken.webm"), full_dur=0, tin=0, tout=None)

    def test_failed_music_mix_is_reported(self):
        from unittest.mock import patch
        from backend.services.video_film_edit import _mix_music
        with patch("backend.services.video_film_edit._media_header", return_value=""), \
             patch("backend.services.video_film_edit._run_ffmpeg", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "mix the music"):
                _mix_music("ffmpeg", Path("clip.webm"), Path("out.webm"), Path("music.wav"),
                    music_volume=0.4, music_trim_in=0, music_trim_out=None)
