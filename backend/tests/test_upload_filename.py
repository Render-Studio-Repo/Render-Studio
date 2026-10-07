"""Single-file uploads must not escape their destination or bypass write access."""
from __future__ import annotations

import asyncio
import io
from unittest.mock import Mock

import pytest
from fastapi import BackgroundTasks, HTTPException, UploadFile

from backend.services.upload_filename import validate_upload_filename


@pytest.mark.parametrize("name", [
    "robot.glb", "My model v2 (final).step", "机械 手臂.urdf", "café prototype.csv",
    "cafe\u0301.png", "家族 👨‍👩‍👧 model.glb", ".gitignore", "gear..v2.glb", " part.glb ",
])
def test_preserves_safe_unicode_and_spaces(name):
    assert validate_upload_filename(name) == name


@pytest.mark.parametrize("name", [
    None, "", "  ", ".", "..", " .. ", "../payload.glb", "folder/model.glb",
    "/tmp/payload.urdf", "..\\payload.glb", "folder\\model.glb", "C:payload.glb",
    "C:\\tmp\\payload.glb", "\\\\host\\share\\model.glb", "bad\x00.glb", "bad\n.glb",
    "bad\r.glb", "bad\t.glb", "bad\x7f.glb", "bad\u0085.glb", "bad\ud800.glb",
    "bad\u202e.glb", "bad\u2066.glb", "a" * 256, "界" * 86,
])
def test_rejects_ambiguous_or_pathlike_names(name):
    with pytest.raises(ValueError):
        validate_upload_filename(name)


def test_utf8_limit_counts_bytes_not_characters():
    assert validate_upload_filename("界" * 85) == "界" * 85
    with pytest.raises(ValueError):
        validate_upload_filename("界" * 85 + "a")


@pytest.fixture
def upload_endpoint(monkeypatch, tmp_path):
    # Importing the actual endpoint must not initialize or alter the live database.
    from backend import database
    from backend.services import project_incognito_service
    with monkeypatch.context() as importing:
        importing.setattr(database, "DB_PATH", tmp_path / "isolated.db")
        importing.setattr(project_incognito_service, "ensure_tables", lambda: None)
        from backend import main
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setattr(main, "_require_project", Mock(side_effect=AssertionError("Access-only gate must not authorize uploads")))
    touch = Mock()
    notify = Mock()
    monkeypatch.setattr(main.project_store, "touch_project", touch)
    monkeypatch.setattr(main, "_notify_project", notify)
    return main, project, touch, notify


def _upload(main, file):
    return asyncio.run(main.upload_file(
        project_id="project", background_tasks=BackgroundTasks(), file=file,
        history_kind=None, history_label=None, reference_folder=None,
        user={"id": "buyer", "display_name": "Fixture buyer"},
    ))


class UnreadPayload(io.BytesIO):
    def read(self, *args, **kwargs):
        raise AssertionError("Rejected uploads must not read or copy file contents")


def test_actual_upload_checks_write_permission_before_reading_payload(upload_endpoint, monkeypatch):
    main, project, touch, notify = upload_endpoint
    denied = Mock(side_effect=HTTPException(403, "This workspace is read-only"))
    monkeypatch.setattr(main, "_require_project_write", denied)
    with pytest.raises(HTTPException) as failure:
        _upload(main, UploadFile(filename="robot.urdf", file=UnreadPayload(b"should-not-write")))
    assert failure.value.status_code == 403
    denied.assert_called_once_with({"id": "buyer", "display_name": "Fixture buyer"}, "project")
    assert list(project.iterdir()) == []
    touch.assert_not_called()
    notify.assert_not_called()


@pytest.mark.parametrize("name", ["../escape.urdf", "nested/payload.glb", "..\\escape.urdf", "/tmp/escape.glb", "bad\x00.urdf", "bad\n.urdf", "", None])
def test_actual_upload_rejects_unsafe_filename_before_writing(upload_endpoint, monkeypatch, name):
    main, project, touch, notify = upload_endpoint
    monkeypatch.setattr(main, "_require_project_write", Mock(return_value=project))
    with pytest.raises(HTTPException) as failure:
        _upload(main, UploadFile(filename=name, file=UnreadPayload(b"should-not-write")))
    assert failure.value.status_code == 400
    assert list(project.iterdir()) == []
    assert not (project.parent / "escape.urdf").exists()
    touch.assert_not_called()
    notify.assert_not_called()


def test_actual_upload_preserves_unicode_name_for_authorized_writer(upload_endpoint, monkeypatch):
    main, project, touch, notify = upload_endpoint
    allowed = Mock(return_value=project)
    monkeypatch.setattr(main, "_require_project_write", allowed)
    name = "机械 手臂 v2.urdf"
    result = _upload(main, UploadFile(filename=name, file=io.BytesIO(b"<robot name='fixture'/>")))
    assert result["filename"] == name
    assert (project / name).read_bytes() == b"<robot name='fixture'/>"
    allowed.assert_called_once()
    touch.assert_called_once_with(project)
    notify.assert_called_once()


def test_electronics_sourcing_upload_replaces_and_consolidates_legacy_notes(upload_endpoint, monkeypatch):
    main, project, touch, notify = upload_endpoint
    allowed = Mock(return_value=project)
    monkeypatch.setattr(main, "_require_project_write", allowed)
    wiring = project / "references" / "Electronics wiring"
    wiring.mkdir(parents=True)
    (wiring / "electronics_build_sourcing.md").write_text("old canonical")
    (wiring / "electronics_build_sourcing_2.md").write_text("old duplicate")
    (wiring / "Electronics Build Sourcing 18.Md").write_text("newer duplicate")
    unrelated = wiring / "electronics_build_notes_2.md"
    unrelated.write_text("keep")

    result = asyncio.run(main.upload_file(
        project_id="project",
        background_tasks=BackgroundTasks(),
        file=UploadFile(filename="Electronics Build Sourcing 19.Md", file=io.BytesIO(b"latest")),
        history_kind=None,
        history_label=None,
        reference_folder="Electronics wiring",
        replace_existing="1",
        user={"id": "buyer", "display_name": "Fixture buyer"},
    ))

    names = sorted(path.name for path in wiring.iterdir())
    assert names == ["electronics_build_notes_2.md", "electronics_build_sourcing.md"]
    assert (wiring / "electronics_build_sourcing.md").read_bytes() == b"latest"
    assert result["filename"] == "electronics_build_sourcing.md"
    assert unrelated.read_text() == "keep"
    touch.assert_called_once_with(project)
    notify.assert_called_once()
