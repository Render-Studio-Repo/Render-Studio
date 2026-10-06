"""Audio document comments persist on the existing markup sidecar."""

from __future__ import annotations

import unittest
from pathlib import Path

from backend.services import cad_service


class AudioFileCommentTests(unittest.TestCase):
    def test_markup_sidecar_keeps_audio_comments_when_notes_save(self) -> None:
        root = Path(self.id().replace(".", "_"))
        self.addCleanup(lambda: None)
        audio = Path("/tmp") / "render-studio-audio-comments" / "lozee 2.Mp3"
        audio.parent.mkdir(parents=True, exist_ok=True)
        audio.write_bytes(b"ID3")
        self.addCleanup(lambda: _cleanup(audio))

        cad_service.save_reference_markup(
            audio,
            {
                "notes": "",
                "strokes": [],
                "comments": [
                    {
                        "id": "c1",
                        "text": "drop here",
                        "t": 1.5,
                        "author_name": "Sam",
                        "author_id": "u1",
                        "avatar_url": "/avatars/sam.png",
                    }
                ],
                "waveform_peaks": [0.2, 0.8, 0.4],
            },
        )
        loaded = cad_service.load_reference_markup(audio)
        self.assertEqual(loaded["comments"][0]["text"], "drop here")
        self.assertEqual(loaded["comments"][0]["author_name"], "Sam")
        self.assertAlmostEqual(float(loaded["waveform_peaks"][1]), 0.8)

        cad_service.save_reference_markup(audio, {"notes": "keep notes", "strokes": []})
        again = cad_service.load_reference_markup(audio)
        self.assertEqual(again["notes"], "keep notes")
        self.assertEqual(again["comments"][0]["text"], "drop here")
        self.assertAlmostEqual(float(again["waveform_peaks"][1]), 0.8)

        comment, rows = cad_service.add_reference_file_comment(
            audio,
            text="second take",
            t=4.2,
            author={"id": "u2", "display_name": "Alex", "avatar_url": "/avatars/alex.png"},
        )
        self.assertEqual(comment["text"], "second take")
        self.assertEqual(comment["author_name"], "Alex")
        self.assertEqual(len(rows), 2)
        self.assertTrue(cad_service.can_write_reference_sidecar(audio.parent, audio))
        self.assertEqual(cad_service.reference_kind("lozee 2.Mp3"), "audio")


def _cleanup(audio: Path) -> None:
    side = cad_service.markup_sidecar_path(audio)
    try:
        side.unlink()
    except OSError:
        pass
    try:
        audio.unlink()
    except OSError:
        pass
