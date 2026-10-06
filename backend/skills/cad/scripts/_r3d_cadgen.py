"""Dispatch to pip-installed cadgen 0.5+ (never a vendored 0.4 tree)."""

from __future__ import annotations

import os
from pathlib import Path


def _ensure_node() -> None:
    os.environ.setdefault("CADGEN_DAEMON", "0")
    existing = (os.environ.get("CADGEN_NODE") or "").strip()
    if existing and Path(existing).is_file():
        return
    home = Path(os.environ.get("HOME") or Path.home())
    for candidate in (
        *sorted((home / "bin" / "node-dist").glob("*/bin/node"), reverse=True),
        home / "Library/Application Support/Render3D/node/bin/node",
        Path("/opt/homebrew/bin/node"),
        Path("/usr/local/bin/node"),
        home / ".local/bin/node",
    ):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            os.environ["CADGEN_NODE"] = str(candidate)
            os.environ["PATH"] = f"{candidate.parent}{os.pathsep}{os.environ.get('PATH', '')}"
            return


def cadgen_main(argv: list[str]) -> int:
    _ensure_node()
    from cadgen.cli import main as _main

    return int(_main(list(argv)) or 0)
