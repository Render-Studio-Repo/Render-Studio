"""Caps on in-memory traces and rotating host health logs."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from backend.services import trace_log


def test_trace_log_clips_payload_and_caps_count() -> None:
    trace_log.clear()
    try:
        huge = {"blob": "x" * 20_000, "nested": {"plan": list(range(400))}}
        entry = trace_log.add("info", "ok " + ("m" * 800), data=huge)
        assert len(entry["message"]) <= trace_log._MAX_MESSAGE
        assert entry["data"].get("_clipped") is True
        for i in range(200):
            trace_log.add("info", f"n-{i}")
        listed = trace_log.list_entries(limit=200)
        assert len(listed) <= trace_log._MAX
    finally:
        trace_log.clear()


def test_memory_guard_rotates_append_logs(tmp_path: Path) -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "memory-guard.py"
    spec = importlib.util.spec_from_file_location("memory_guard_under_test", script)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    path = tmp_path / "actions.log"
    path.write_bytes(b"x" * 1024)
    mod.rotate_file_if_needed(path, 512)
    assert not path.exists()
    assert (tmp_path / "actions.log.1").is_file()
    mod._append(path, "hello")
    assert path.is_file()
    assert "hello" in path.read_text(encoding="utf-8")
