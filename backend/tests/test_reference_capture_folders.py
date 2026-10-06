"""Reference Files folders: Screen Recordings / Screenshots only appear when they have files."""

import os
import tempfile
import unittest
from pathlib import Path

from backend.services import cad_service


class ReferenceCaptureFoldersTests(unittest.TestCase):
    def test_alias_recordings_writes_screen_recordings(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        dest = cad_service.unique_reference_path(tmp, "clip.webm", folder="recordings")
        self.assertEqual(dest.parent.name, "Screen Recordings")
        self.assertEqual(cad_service.canonical_reference_folder("Screen Recordings"), "Screen Recordings")
        self.assertEqual(cad_service.canonical_reference_folder("screenshots"), "Screenshots")

    def test_empty_capture_folders_are_not_listed(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "references" / "Screen Recordings").mkdir(parents=True)
        (tmp / "references" / "Screenshots").mkdir(parents=True)
        self.assertEqual(cad_service.list_reference_files(tmp), [])

    def test_listed_files_keep_folder_and_skip_empty_siblings(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        rec = tmp / "references" / "Screen Recordings"
        rec.mkdir(parents=True)
        (tmp / "references" / "Screenshots").mkdir(parents=True)
        (rec / "helmet-viewport-20260906-154412.webm").write_bytes(b"webm")
        refs = cad_service.list_reference_files(tmp)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["folder"], "Screen Recordings")
        self.assertEqual(refs[0]["name"], "helmet-viewport-20260906-154412.webm")
        self.assertIn("mtime", refs[0])

    def test_electronics_sourcing_note_overwrites_instead_of_numbering(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        folder = "Electronics wiring"
        first = cad_service.reference_upload_destination(tmp, "electronics_build_sourcing.md", folder=folder)
        first.parent.mkdir(parents=True, exist_ok=True)
        first.write_text("one")
        second = cad_service.reference_upload_destination(tmp, "electronics_build_sourcing.md", folder=folder)
        self.assertEqual(second, first)
        numbered = cad_service.unique_reference_path(tmp, "electronics_build_sourcing.md", folder=folder)
        self.assertNotEqual(numbered.name, first.name)
        part = cad_service.reference_upload_destination(
            tmp, "electronics_motor.md", folder=folder, replace=True,
        )
        part.write_text("a")
        again = cad_service.reference_upload_destination(
            tmp, "electronics_motor.md", folder=folder, replace=True,
        )
        self.assertEqual(again, part)
        other = cad_service.reference_upload_destination(tmp, "notes.md", folder=folder, replace=True)
        other.write_text("n")
        bumped = cad_service.reference_upload_destination(tmp, "notes.md", folder=folder, replace=True)
        self.assertNotEqual(bumped, other)

    def test_numbered_electronics_sourcing_upload_converges_to_one_live_note(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        folder = "Electronics wiring"
        wiring = tmp / "references" / folder
        wiring.mkdir(parents=True)
        legacy = [
            wiring / "electronics_build_sourcing_2.md",
            wiring / "Electronics Build Sourcing 17.Md",
        ]
        for path in legacy:
            path.write_text(path.name)
        unrelated = wiring / "electronics_build_notes_2.md"
        unrelated.write_text("keep")

        dest = cad_service.reference_upload_destination(
            tmp,
            "Electronics Build Sourcing 22.Md",
            folder=folder,
            replace=True,
        )
        self.assertEqual(dest.name, "electronics_build_sourcing.md")
        dest.write_text("current")
        removed = cad_service.remove_legacy_electronics_sourcing_references(
            tmp,
            folder=folder,
            keep=dest,
        )

        self.assertEqual({path.name for path in removed}, {path.name for path in legacy})
        self.assertEqual(dest.read_text(), "current")
        self.assertTrue(unrelated.is_file())

    def test_capture_folder_lists_newest_first(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        rec = tmp / "references" / "Screen Recordings"
        rec.mkdir(parents=True)
        older = rec / "Viewport-recording.webm"
        newer = rec / "Full-page-recording.webm"
        older.write_bytes(b"old")
        newer.write_bytes(b"new")
        older_time = 1_700_000_000
        newer_time = 1_800_000_000
        os.utime(older, (older_time, older_time))
        os.utime(newer, (newer_time, newer_time))
        refs = cad_service.list_reference_files(tmp)
        names = [row["name"] for row in refs if row.get("folder") == "Screen Recordings"]
        self.assertEqual(names, ["Full-page-recording.webm", "Viewport-recording.webm"])

    def test_clock_recording_collision_uses_paren_suffix(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        rec = tmp / "references" / "Screen Recordings"
        rec.mkdir(parents=True)
        name = "recording 3:30 PM 12.21.26.webm"
        (rec / name).write_bytes(b"first")
        dest = cad_service.unique_reference_path(tmp, name, folder="Screen Recordings")
        self.assertEqual(dest.name, "recording 3:30 PM 12.21.26 (2).webm")

    def test_write_reference_capture_overwrite_replaces_same_name(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        first = cad_service.write_reference_capture(
            tmp,
            "Fullscreen-recording_3.webm",
            folder="Screen Recordings",
            source=b"one",
        )
        second = cad_service.write_reference_capture(
            tmp,
            "Fullscreen-recording_3.webm",
            folder="Screen Recordings",
            source=b"two-bytes",
            overwrite=True,
        )
        self.assertEqual(first.name, second.name)
        self.assertEqual(second.read_bytes(), b"two-bytes")
        refs = cad_service.list_reference_files(tmp)
        names = [row["name"] for row in refs if row.get("folder") == "Screen Recordings"]
        self.assertEqual(names, ["Fullscreen-recording_3.webm"])

    def test_write_reference_capture_streams_webm(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        from io import BytesIO

        folder = cad_service.capture_reference_folder("video")
        dest = cad_service.write_reference_capture(
            tmp,
            "helmet-viewport-20260906-155959.webm",
            folder=folder,
            source=BytesIO(b"webm-bytes"),
        )
        self.assertEqual(dest.parent.name, "Screen Recordings")
        self.assertTrue(dest.is_file())
        refs = cad_service.list_reference_files(tmp)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0]["folder"], "Screen Recordings")

    def test_infer_suffix_from_webm_mime(self) -> None:
        self.assertEqual(
            cad_service.infer_reference_suffix("blob", "video/webm;codecs=vp9,opus"),
            ".webm",
        )
        self.assertEqual(
            cad_service.capture_reference_folder("screenshot"),
            "Screenshots",
        )
        self.assertEqual(
            cad_service.canonical_reference_folder("Electronics wiring"),
            "Electronics wiring",
        )
        self.assertEqual(
            cad_service.canonical_reference_folder("electronics"),
            "Electronics wiring",
        )

    def test_video_editor_folder_only_lists_when_it_has_files(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        empty = tmp / "references" / "Video Editor"
        empty.mkdir(parents=True)
        self.assertEqual(cad_service.list_reference_files(tmp), [])
        dest = cad_service.write_reference_capture(
            tmp,
            "timeline-edit.webm",
            folder="Video Editor",
            source=b"webm-bytes",
        )
        self.assertEqual(dest.parent.name, "Video Editor")
        # Loose copies at Video Editor root are hidden — project folders list instead.
        self.assertEqual(
            [row for row in cad_service.list_reference_files(tmp) if row.get("folder") == "Video Editor"],
            [],
        )
        created = cad_service.write_video_editor_project(
            tmp,
            "Harbor Cut",
            sources=[{"path": "Video Editor/timeline-edit.webm", "kind": "video"}],
        )
        self.assertEqual(created["folder"], "Video Editor/Harbor Cut")
        refs = cad_service.list_reference_files(tmp)
        self.assertTrue(any(row.get("folder") == "Video Editor/Harbor Cut" for row in refs))
        self.assertEqual(
            cad_service.canonical_reference_folder("video-editor"),
            "Video Editor",
        )
        self.assertEqual(
            cad_service.capture_reference_folder("video-editor"),
            "Video Editor",
        )

    def test_video_editor_create_lists_empty_project_folder(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        created = cad_service.write_video_editor_project(
            tmp,
            "Harbor Cut",
            editor={"id": "u1", "display_name": "Sam"},
            unique=True,
        )
        self.assertEqual(created["name"], "Harbor Cut")
        self.assertEqual(created["folder"], "Video Editor/Harbor Cut")
        listed = cad_service.list_video_editor_projects(tmp)
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["name"], "Harbor Cut")
        self.assertEqual(listed[0]["has_media"], False)
        refs = cad_service.list_reference_files(tmp)
        self.assertTrue(any(row.get("folder") == "Video Editor/Harbor Cut" for row in refs))
        renamed = cad_service.rename_video_editor_store(tmp, "Harbor Cut", "Ember Reel")
        self.assertEqual(renamed, "Ember Reel")
        self.assertTrue(cad_service.delete_video_editor_store(tmp, "Ember Reel"))
        self.assertEqual(cad_service.list_video_editor_projects(tmp), [])

    def test_canvas_boards_list_and_timestamp_folder(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        cad_service.write_canvas_board(tmp, "Canvas 2026-09-15 02.29", {"elements": []})
        cad_service.write_canvas_board(tmp, "Front View", {"elements": [{"type": "rect"}]})
        listed = cad_service.list_canvas_boards(tmp)
        names = [row["name"] for row in listed]
        self.assertIn("Front View", names)
        self.assertIn("Canvas 2026-09-15 02.29", names)
        refs = cad_service.list_reference_files(tmp)
        self.assertTrue(any(row.get("folder") == "Canvas/Front View" for row in refs))
        renamed = cad_service.rename_canvas_store(tmp, "Front View", "Side View")
        self.assertEqual(renamed, "Side View")
        self.assertTrue(any(row["name"] == "Side View" for row in cad_service.list_canvas_boards(tmp)))

    def test_canvas_boards_list_mtime_not_alphabetical(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        cad_service.write_canvas_board(tmp, "Zebra View", {"elements": []})
        cad_service.write_canvas_board(tmp, "Apple Board", {"elements": []})
        cad_service.write_canvas_board(tmp, "Front View", {"elements": [{"type": "rect"}]})
        listed = cad_service.list_canvas_boards(tmp)
        names = [row["name"] for row in listed]
        self.assertEqual(names[0], "Front View")
        self.assertNotEqual(names[0], "Apple Board")

    def test_video_editor_folder_lists_dropped_audio(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        cad_service.write_video_editor_project(tmp, "Amber Cut", unique=True)
        dest = cad_service.write_reference_capture(
            tmp,
            "LoveSickness.mp3",
            folder="Video Editor/Amber Cut",
            source=b"id3-fake",
        )
        self.assertTrue(dest.is_file())
        self.assertEqual(cad_service.reference_kind("LoveSickness.mp3"), "audio")
        self.assertEqual(cad_service.infer_reference_suffix("blob", "audio/mpeg"), ".mp3")
        payload = cad_service.video_editor_project_payload(tmp, "Amber Cut")
        kinds = {row["kind"] for row in payload["files"]}
        self.assertIn("audio", kinds)
        self.assertTrue(payload["has_media"])
        saved = cad_service.write_video_editor_project(
            tmp,
            "Amber Cut",
            timeline={"music": {"filename": "LoveSickness.mp3", "volume": 0.2, "startSec": 1.5}},
        )
        self.assertEqual(saved["timeline"]["music"]["filename"], "LoveSickness.mp3")
        self.assertEqual(saved["timeline"]["music"]["volume"], 0.2)
        kept = cad_service.write_video_editor_project(tmp, "Amber Cut", caption="hi")
        self.assertEqual(kept["timeline"]["music"]["startSec"], 1.5)

    def test_video_editor_reuses_project_and_stores_path_refs(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        rec = tmp / "references" / "Screen Recordings"
        rec.mkdir(parents=True)
        src = rec / "Fullscreen Recording.webm"
        src.write_bytes(b"webm-bytes-original")
        first = cad_service.write_video_editor_project(
            tmp,
            "Fullscreen Recording",
            sources=[{"path": "Screen Recordings/Fullscreen Recording.webm", "kind": "video"}],
        )
        second = cad_service.write_video_editor_project(
            tmp,
            "Fullscreen Recording",
            sources=[{"path": "Screen Recordings/Fullscreen Recording.webm", "kind": "video"}],
        )
        self.assertEqual(first["name"], "Fullscreen Recording")
        self.assertEqual(second["name"], "Fullscreen Recording")
        self.assertEqual(first["folder"], "Video Editor/Fullscreen Recording")
        self.assertTrue(first.get("created"))
        self.assertFalse(second.get("created"))
        dest_dir = tmp / "references" / "Video Editor" / "Fullscreen Recording"
        copies = [p for p in dest_dir.iterdir() if p.suffix.lower() == ".webm"]
        self.assertEqual(copies, [])
        self.assertEqual(src.read_bytes(), b"webm-bytes-original")
        self.assertEqual(len(cad_service.list_video_editor_projects(tmp)), 1)
        refs = cad_service.list_reference_files(tmp)
        ve_videos = [
            row
            for row in refs
            if row.get("folder") == "Video Editor/Fullscreen Recording" and row.get("kind") == "video"
        ]
        self.assertEqual(len(ve_videos), 1)
        self.assertTrue(ve_videos[0].get("path_ref"))
        self.assertEqual(ve_videos[0]["source_path"], "Screen Recordings/Fullscreen Recording.webm")
        self.assertEqual(ve_videos[0]["filename"], "Screen Recordings/Fullscreen Recording.webm")
        cad_service.write_reference_capture(
            tmp,
            "Fullscreen Recording-edited.webm",
            folder="Video Editor",
            source=b"wasted-copy",
        )
        listed = cad_service.list_reference_files(tmp)
        loose = [
            row
            for row in listed
            if row.get("folder") == "Video Editor" and str(row.get("name") or "").endswith(".webm")
        ]
        self.assertEqual(loose, [])


if __name__ == "__main__":
    unittest.main()
