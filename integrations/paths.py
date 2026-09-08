"""Portable path helpers for Render Studio integrations.

Always resolve against the repository root (parent of ``integrations/``),
never against the process CWD or a hard-coded ``/Users`` / ``/home`` path.
"""

from __future__ import annotations

import os
from pathlib import Path

# integrations/paths.py → integrations/ → repo root
INTEGRATIONS_DIR = Path(__file__).resolve().parent
REPO_ROOT = INTEGRATIONS_DIR.parent
# Alias used in docs (`from integrations.paths import INTEGRATIONS_ROOT`).
# Prefer integrations_root() when env overrides matter.
INTEGRATIONS_ROOT = INTEGRATIONS_DIR


def repo_root() -> Path:
    override = os.environ.get("RENDER_STUDIO_ROOT") or os.environ.get("RENDER3D_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    return REPO_ROOT


def integrations_root() -> Path:
    override = os.environ.get("INTEGRATIONS_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    return repo_root() / "integrations"


def integration_dir(name: str) -> Path:
    return integrations_root() / name


def ensure_on_sys_path(*names: str) -> list[Path]:
    """Prepend integration package dirs onto ``sys.path`` (idempotent)."""
    import sys

    added: list[Path] = []
    for name in names:
        path = integration_dir(name)
        text = str(path)
        if path.is_dir() and text not in sys.path:
            sys.path.insert(0, text)
            added.append(path)
    return added
