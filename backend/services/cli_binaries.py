"""Locate Cursor Agent and Claude Code CLIs on the Render Studio host."""

from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path


def _first_executable(candidates: list[Path]) -> Path | None:
    seen: set[str] = set()
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        if path.is_file() and os.access(path, os.X_OK):
            return path
    return None


def _home_candidates(names: tuple[str, ...]) -> list[Path]:
    home = Path.home()
    out: list[Path] = []
    for name in names:
        out.extend(
            [
                home / ".local" / "bin" / name,
                home / ".cursor" / "bin" / name,
                Path("/opt/homebrew/bin") / name,
                Path("/usr/local/bin") / name,
            ]
        )
    return out


def _cursor_versioned_bins() -> list[Path]:
    versions = Path.home() / ".local" / "share" / "cursor-agent" / "versions"
    out: list[Path] = []
    if versions.is_dir():
        for child in sorted(versions.iterdir(), reverse=True):
            cand = child / "cursor-agent"
            if cand.is_file():
                out.append(cand)
    return out


@lru_cache(maxsize=1)
def resolve_cursor_agent_bin() -> Path | None:
    env = (
        os.environ.get("CURSOR_AGENT_BIN")
        or os.environ.get("RENDER3D_CURSOR_AGENT_BIN")
        or os.environ.get("AGENT_BIN")
        or ""
    ).strip()
    names = ("agent", "cursor-agent")
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env).expanduser())
    for name in names:
        which = shutil.which(name)
        if which:
            candidates.append(Path(which))
    candidates.extend(_home_candidates(names))
    candidates.extend(_cursor_versioned_bins())
    return _first_executable(candidates)


@lru_cache(maxsize=1)
def resolve_claude_bin() -> Path | None:
    env = (
        os.environ.get("CLAUDE_BIN")
        or os.environ.get("RENDER3D_CLAUDE_BIN")
        or os.environ.get("CLAUDE_CODE_BIN")
        or ""
    ).strip()
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env).expanduser())
    which = shutil.which("claude")
    if which:
        candidates.append(Path(which))
    candidates.extend(_home_candidates(("claude",)))
    return _first_executable(candidates)
