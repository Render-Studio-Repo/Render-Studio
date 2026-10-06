# SPDX-License-Identifier: LGPL-2.1-or-later
"""Shared paths/config — real module so FreeCAD InitGui exec quirks don't break lookups."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import FreeCAD as App


def _mod_dir() -> Path:
    try:
        return Path(__file__).resolve().parent
    except NameError:
        for name in ("RenderStudio", "RenderStudioMod"):
            mod = sys.modules.get(name)
            if mod and getattr(mod, "__file__", None):
                return Path(mod.__file__).resolve().parent
        for sub in ("v26-3", "v26", "v1-1"):
            for brand in ("VibeCAD", "FreeCAD"):
                user_mod = Path.home() / f"Library/Application Support/{brand}/{sub}/Mod/RenderStudio"
                if user_mod.is_dir() or user_mod.is_symlink():
                    return user_mod.resolve()
        return Path(App.getUserAppDataDir()) / "Mod" / "RenderStudio"


MOD_DIR = _mod_dir()
ROOT_DIR = MOD_DIR.parent.parent  # mac-render-studio/
CONFIG_PATH = ROOT_DIR / "config" / "defaults.json"
ICON_DIR = MOD_DIR / "Resources" / "icons"


def load_config() -> dict:
    defaults = {
        "api_base": "http://127.0.0.1:8001",
        "projects_dir": str(ROOT_DIR.parent / "projects"),
        "workspace_root": str(ROOT_DIR.parent),
        "env_file": str(ROOT_DIR.parent / ".env"),
        "workbench_menu": "Render Studio",
    }
    if CONFIG_PATH.is_file():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                defaults.update(data)
        except Exception as exc:  # noqa: BLE001
            App.Console.PrintWarning(f"[RenderStudio] config read failed: {exc}\n")
    if os.getenv("RENDER_STUDIO_API_BASE"):
        defaults["api_base"] = os.environ["RENDER_STUDIO_API_BASE"]
    if os.getenv("RENDER_STUDIO_PROJECTS_DIR"):
        defaults["projects_dir"] = os.environ["RENDER_STUDIO_PROJECTS_DIR"]
    if os.getenv("RENDER_STUDIO_ENV"):
        defaults["env_file"] = os.environ["RENDER_STUDIO_ENV"]
    defaults["workspace_root"] = str(ROOT_DIR.parent)
    return defaults


CONFIG = load_config()


def icon(name: str) -> str:
    path = ICON_DIR / name
    return str(path) if path.is_file() else ""
