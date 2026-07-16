"""Announce product updates to Discord + LinkedIn (best-effort each)."""

from __future__ import annotations

from typing import Any

from backend.services import discord_updates_service as discord
from backend.services import linkedin_updates_service as linkedin


def configured() -> dict[str, bool]:
    return {
        "discord": discord.configured(),
        "linkedin": linkedin.configured(),
        "any": discord.configured() or linkedin.configured(),
    }


def connection_status() -> dict[str, Any]:
    return {
        "discord": discord.connection_status(),
        "linkedin": linkedin.connection_status(),
    }


def announce_update(update: dict[str, Any], *, force: bool = False) -> dict[str, Any]:
    """Post one update to every configured channel."""
    out: dict[str, Any] = {"ok": True, "discord": None, "linkedin": None}
    if discord.configured():
        try:
            out["discord"] = discord.announce_update(update, force=force)
        except Exception as err:
            out["discord"] = {"ok": False, "error": str(err)}
            out["ok"] = False
    else:
        out["discord"] = {"ok": False, "skipped": True, "reason": "not_configured"}

    if linkedin.configured():
        try:
            out["linkedin"] = linkedin.announce_update(update, force=force)
        except Exception as err:
            out["linkedin"] = {"ok": False, "error": str(err)}
            out["ok"] = False
    else:
        out["linkedin"] = {"ok": False, "skipped": True, "reason": "not_configured"}

    # Overall ok if at least one channel posted or skipped-as-already-posted,
    # and none hard-failed when configured.
    disc = out["discord"] or {}
    li = out["linkedin"] or {}
    hard_fail = (discord.configured() and not disc.get("ok")) or (
        linkedin.configured() and not li.get("ok")
    )
    out["ok"] = not hard_fail
    return out


def announce_updates(updates: list[dict[str, Any]], *, force: bool = False) -> dict[str, Any]:
    results = [announce_update(row, force=force) for row in updates]
    return {
        "ok": all(r.get("ok") for r in results) if results else True,
        "count": len(results),
        "results": results,
    }
