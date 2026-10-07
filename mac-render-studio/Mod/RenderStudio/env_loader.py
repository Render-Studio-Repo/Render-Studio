# SPDX-License-Identifier: LGPL-2.1-or-later
"""Load Render Studio workspace .env for Mac app + VibeCAD providers."""

from __future__ import annotations

import os
from pathlib import Path

import FreeCAD as App

# Keys consumed by VibeCAD auth + Render backend (never log values).
_ENV_KEYS = (
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_MODEL_QUALITY",
    "OPENAI_REASONING_EFFORT",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_MODEL_QUALITY",
    "KIMI_API_KEY",
    "KIMI_MODEL",
    "KIMI_MODEL_QUALITY",
    "XAI_API_KEY",
    "XAI_MODEL",
    "JWT_SECRET",
    "PUBLIC_BASE_URL",
    "HOST",
    "PORT",
    "PROJECTS_DIR",
    "DATA_DIR",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SECRETS_FERNET_KEY",
)

_LOADED = False


def workspace_root(config: dict | None = None) -> Path:
    if config and config.get("workspace_root"):
        return Path(config["workspace_root"]).expanduser()
    env_root = os.getenv("RENDER_STUDIO_WORKSPACE")
    if env_root:
        return Path(env_root).expanduser()
    try:
        import InitGui

        return InitGui.ROOT_DIR.parent
    except Exception:
        pass
    try:
        from RenderStudio import InitGui as rs_init

        return rs_init.ROOT_DIR.parent
    except Exception:
        return Path(__file__).resolve().parents[3]


def resolve_env_path(config: dict | None = None) -> Path | None:
    explicit = os.getenv("RENDER_STUDIO_ENV") or (config or {}).get("env_file")
    if explicit:
        path = Path(str(explicit)).expanduser()
        return path if path.is_file() else None
    candidate = workspace_root(config) / ".env"
    return candidate if candidate.is_file() else None


def parse_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        App.Console.PrintWarning(f"[RenderStudio] .env read failed: {exc}\n")
        return values
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        if key:
            values[key] = val
    return values


def provider_status(config: dict | None = None) -> dict[str, bool]:
    path = resolve_env_path(config)
    merged = dict(os.environ)
    if path:
        merged.update(parse_dotenv(path))
    return {
        "openai": bool(str(merged.get("OPENAI_API_KEY", "")).strip()),
        "anthropic": bool(str(merged.get("ANTHROPIC_API_KEY", "")).strip()),
        "kimi": bool(str(merged.get("KIMI_API_KEY", "")).strip()),
        "xai": bool(str(merged.get("XAI_API_KEY", "")).strip()),
    }


def apply_env(config: dict | None = None) -> Path | None:
    """Load workspace .env into process env and VibeCAD preferences."""
    global _LOADED
    path = resolve_env_path(config)
    if not path:
        App.Console.PrintWarning("[RenderStudio] No .env found — set RENDER_STUDIO_ENV\n")
        return None

    parsed = parse_dotenv(path)
    applied = 0
    for key in _ENV_KEYS:
        val = parsed.get(key)
        if val is not None and str(val).strip():
            os.environ[key] = str(val).strip()
            applied += 1

    os.environ["RENDER_STUDIO_ENV"] = str(path)
    _sync_vibecad_preferences(path, parsed)
    if not _LOADED:
        App.Console.PrintMessage(
            f"[RenderStudio] Loaded .env ({applied} keys) from {path}\n"
        )
        _LOADED = True
    return path


def _sync_vibecad_preferences(env_path: Path, parsed: dict[str, str]) -> None:
    try:
        from dataclasses import replace

        from VibeCADPreferences import load_settings, save_settings
    except ImportError:
        App.Console.PrintWarning(
            "[RenderStudio] VibeCAD preferences unavailable — keys in os.environ only\n"
        )
        return

    settings = load_settings()
    provider = settings.provider
    if parsed.get("OPENAI_API_KEY"):
        provider = "openai"
    elif parsed.get("ANTHROPIC_API_KEY") and not parsed.get("OPENAI_API_KEY"):
        provider = "anthropic"

    try:
        save_settings(
            replace(
                settings,
                dotenv_path=str(env_path),
                use_online_provider=True,
                model=(parsed.get("OPENAI_MODEL") or settings.model).strip(),
                anthropic_model=(
                    parsed.get("ANTHROPIC_MODEL") or settings.anthropic_model
                ).strip(),
                reasoning_effort=(
                    parsed.get("OPENAI_REASONING_EFFORT") or settings.reasoning_effort
                )
                .strip()
                .lower(),
                provider=provider,
            )
        )
    except Exception as exc:  # noqa: BLE001
        App.Console.PrintWarning(f"[RenderStudio] VibeCAD pref sync failed: {exc}\n")
