#!/usr/bin/env python3
"""First-run marketplace install question (CLI).

Usage (from the Render-Studio repo root):

    python scripts/setup-marketplace.py

Super-admin UI equivalent: /setup-marketplace.html
or Dashboard → Server → Marketplace.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.services import marketplace_config_service  # noqa: E402


def main() -> None:
    print("Render Studio — include the marketplace on this instance?")
    include = input("  Include marketplace? [Y/n] ").strip().lower() not in {"n", "no"}
    print("  Modes:")
    print("    a) public  — browse Render’s public catalog; publishing requires hub approval")
    print("    b) private — instance-local marketplace only")
    print("    c) hybrid  — local now, connect later via Server Settings")
    choice = input("  Mode [a/b/c] (default c): ").strip().lower()
    mode = {"a": "public", "b": "private", "c": "hybrid"}.get(choice, "hybrid")
    cfg = marketplace_config_service.answer_install(include=include, mode=mode)
    print(f"Saved. enabled={cfg['enabled']} mode={cfg['mode']}")
    print("Config file: data/marketplace_settings.json")
    if cfg["mode"] == "public":
        print("Connected read-only to https://render3d.app. Official purchases and fees stay on the Render hub.")
    print("Local projects and uploads remain in PROJECTS_DIR (repo/projects by default).")


if __name__ == "__main__":
    main()
