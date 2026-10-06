from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile

import pytest

from backend.services import canvas_board_revision as boards


def test_legacy_payload_round_trip_and_optional_revision():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        dest, revision = boards.write_canvas_board(root, "VR AI Draw", {"elements": [], "spatial_board": {"nodes": {"a": {"id": "a"}}}}, expected_revision="missing")
        result = boards.read_canvas_board(root, "VR AI Draw")
        assert result["storage_revision"] == revision
        assert result["state"]["spatial_board"]["nodes"]["a"]["id"] == "a"
        assert dest.name == "canvas.json"
        _, next_revision = boards.write_canvas_board(root, "VR AI Draw", {"elements": []})
        assert next_revision != revision


def test_stale_revision_never_overwrites_saved_document():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        _, original = boards.write_canvas_board(root, "VR AI Draw", {"text": "first"}, expected_revision="missing")
        boards.write_canvas_board(root, "VR AI Draw", {"text": "second"}, expected_revision=original)
        with pytest.raises(boards.CanvasBoardConflict):
            boards.write_canvas_board(root, "VR AI Draw", {"text": "stale"}, expected_revision=original)
        assert boards.read_canvas_board(root, "VR AI Draw")["state"]["text"] == "second"


def test_concurrent_writers_with_same_revision_have_exactly_one_winner():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        _, revision = boards.write_canvas_board(root, "VR AI Draw", {"text": "base"})

        def save(i):
            try:
                boards.write_canvas_board(root, "VR AI Draw", {"winner": i}, expected_revision=revision)
                return True
            except boards.CanvasBoardConflict:
                return False

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(save, range(8)))
        assert sum(results) == 1
        assert boards.read_canvas_board(root, "VR AI Draw")["state"]["winner"] in range(8)
        assert not list(root.rglob("*.tmp"))


def test_missing_read_does_not_create_a_canvas():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        assert boards.read_canvas_board(root, "VR AI Draw") is None
        assert not list(root.rglob("canvas.json"))


def test_legacy_desktop_save_cannot_replace_the_spatial_document():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        boards.write_canvas_board(root, "VR AI Draw", {"elements": [], "spatial_board": {"revision": 10}}, expected_revision="missing")
        boards.write_canvas_board(root, "VR AI Draw", {"elements": [{"id": "desktop-note"}], "spatial_board": {"revision": 2}})
        state = boards.read_canvas_board(root, "VR AI Draw")["state"]
        assert state["spatial_board"]["revision"] == 10
        assert state["elements"][0]["id"] == "desktop-note"
