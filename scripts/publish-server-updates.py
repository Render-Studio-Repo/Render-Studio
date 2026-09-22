#!/usr/bin/env python3
"""Publish server updates from the local UPDATE-LOG (docs / Slack / Discord / LinkedIn).

Follows docs/UPDATE-PUBLISHING.md and instructions/server/UPDATE-DOCS.md.

Does NOT modify application code, merge PRs, or deploy. It only:
  - reads local server settings + update log
  - posts to configured channels
  - records successes in the publication ledger

Examples:
  .venv/bin/python scripts/publish-server-updates.py
  .venv/bin/python scripts/publish-server-updates.py --dry-run
  .venv/bin/python scripts/publish-server-updates.py --force --id my-update-id
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import server_config_service as server_config  # noqa: E402

SHIPPED = ROOT / "frontend" / "docs" / "updates" / "shipped.json"


def _tool_status() -> dict[str, Any]:
    ffmpeg = subprocess.run(["which", "ffmpeg"], capture_output=True, text=True).returncode == 0
    playwright = False
    try:
        import playwright  # noqa: F401

        playwright = True
    except Exception:
        playwright = False
    brand_script = (ROOT / "scripts" / "brand-update-gifs.py").is_file()
    return {
        "ffmpeg": ffmpeg,
        "playwright": playwright,
        "brand_update_gifs": brand_script,
        "gif_ready": bool(ffmpeg and brand_script),
    }


def _post_docs(entry: dict[str, Any], *, dry_run: bool) -> dict[str, Any]:
    row = {
        "id": entry["id"],
        "date": entry.get("date") or "",
        "kind": entry.get("kind") or "improve",
        "title": entry.get("title") or entry["id"],
        "summary": entry.get("summary") or "",
        "href": entry.get("href") or "/updates.html",
    }
    if entry.get("visual"):
        row["visual"] = entry["visual"]
    if dry_run:
        return {"ok": True, "dry_run": True, "row": row}

    data: dict[str, Any] = {"items": []}
    if SHIPPED.is_file():
        loaded = json.loads(SHIPPED.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            data = loaded
            data.setdefault("items", [])
        elif isinstance(loaded, list):
            data = {"items": loaded}
    items = list(data.get("items") or [])
    existing = {str(x.get("id")) for x in items if isinstance(x, dict)}
    if row["id"] not in existing:
        items.insert(0, row)
        data["items"] = items
        SHIPPED.parent.mkdir(parents=True, exist_ok=True)
        SHIPPED.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    scan = ROOT / "scripts" / "scan-milestones.py"
    if scan.is_file():
        subprocess.run([sys.executable, str(scan)], cwd=str(ROOT), check=False)
    return {"ok": True, "channel": "docs", "id": row["id"], "path": str(SHIPPED.relative_to(ROOT))}


def _post_slack(entry: dict[str, Any], *, dry_run: bool) -> dict[str, Any]:
    webhook = os.getenv("SLACK_UPDATES_WEBHOOK_URL", "").strip()
    if not webhook:
        return {
            "ok": False,
            "skipped": True,
            "reason": "missing_config",
            "detail": "SLACK_UPDATES_WEBHOOK_URL is not set",
        }
    title = entry.get("title") or entry["id"]
    summary = entry.get("summary") or ""
    href = entry.get("href") or "/updates.html"
    text = f"*Render Studio update:* {title}\n{summary}\n{href}"
    blocks: list[dict[str, Any]] = [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Render Studio update*\n*{title}*\n{summary}"},
        }
    ]
    visual = (entry.get("visual") or "").strip()
    if visual.startswith("http://") or visual.startswith("https://"):
        blocks.append({"type": "image", "image_url": visual, "alt_text": str(title)})
    payload = {"text": text, "blocks": blocks}
    if dry_run:
        return {"ok": True, "dry_run": True, "payload": payload}
    req = urllib.request.Request(
        webhook,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        return {"ok": True, "channel": "slack", "response": body[:200]}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:400]
        return {"ok": False, "error": f"Slack HTTP {err.code}: {detail}"}
    except Exception as err:  # noqa: BLE001
        return {"ok": False, "error": str(err)}


def _post_social(entry: dict[str, Any], channel: str, *, dry_run: bool, force: bool) -> dict[str, Any]:
    if dry_run:
        return {"ok": True, "dry_run": True, "channel": channel}
    row = {
        "id": entry["id"],
        "date": entry.get("date") or "",
        "kind": entry.get("kind") or "improve",
        "title": entry.get("title") or entry["id"],
        "summary": entry.get("summary") or "",
        "href": entry.get("href") or "/updates.html",
    }
    if entry.get("visual"):
        row["visual"] = entry["visual"]
    try:
        if channel == "discord":
            from backend.services import discord_updates_service as discord

            if not discord.configured():
                return {
                    "ok": False,
                    "skipped": True,
                    "reason": "missing_config",
                    "detail": "Discord bot/webhook not configured",
                }
            result = discord.announce_update(row, force=force)
            return {"ok": bool(result.get("ok", True)), "channel": "discord", **result}
        if channel == "linkedin":
            from backend.services import linkedin_updates_service as linkedin

            if not linkedin.configured():
                return {
                    "ok": False,
                    "skipped": True,
                    "reason": "missing_config",
                    "detail": "LinkedIn token not configured",
                }
            result = linkedin.announce_update(row, force=force)
            return {"ok": bool(result.get("ok", True)), "channel": "linkedin", **result}
    except Exception as err:  # noqa: BLE001
        return {"ok": False, "channel": channel, "error": str(err)}
    return {"ok": False, "error": f"unknown channel {channel}"}


def _maybe_note_gif(entry: dict[str, Any], tools: dict[str, Any]) -> dict[str, Any]:
    visual = (entry.get("visual") or "").strip()
    kind = str(entry.get("kind") or "").lower()
    wants_visual = kind in {"feature", "tool", "improve"} and not visual
    if not wants_visual:
        return {"needed": False, "visual": visual or None}
    if tools.get("gif_ready"):
        return {
            "needed": True,
            "ready": True,
            "hint": "Capture/brand a GIF via scripts/gif-demos + scripts/brand-update-gifs.py, then set visual: on the log entry.",
        }
    missing = [
        name
        for name, ok in (
            ("ffmpeg", tools.get("ffmpeg")),
            ("brand-update-gifs.py", tools.get("brand_update_gifs")),
            ("playwright", tools.get("playwright")),
        )
        if not ok
    ]
    return {
        "needed": True,
        "ready": False,
        "missing": missing,
        "hint": "GIF tools missing — continuing text-only for enabled channels.",
    }


def publish(*, dry_run: bool = False, force: bool = False, only_id: str | None = None) -> dict[str, Any]:
    local = server_config.ensure_local_settings()
    up = dict(local.get("update_publishing") or {})
    tools = _tool_status()
    report: dict[str, Any] = {
        "enabled": bool(up.get("enabled")),
        "auto_publish": bool(up.get("auto_publish")),
        "targets": dict(up.get("targets") or {}),
        "tools": tools,
        "posted": [],
        "skipped": [],
        "missing": [],
        "errors": [],
    }

    if not up.get("enabled") and not force:
        report["stopped"] = "update_publishing.enabled is false in local server settings"
        report["ok"] = True
        return report

    eligible = server_config.eligible_updates(force=force, only_id=only_id)
    if not eligible:
        report["stopped"] = "no_new_eligible_updates"
        report["ok"] = True
        return report

    for entry in eligible:
        gif_note = _maybe_note_gif(entry, tools)
        if gif_note.get("needed") and not gif_note.get("ready"):
            report["missing"].append({"id": entry["id"], "gif": gif_note})

        title = (entry.get("title") or "").strip()
        summary = (entry.get("summary") or "").strip()
        if not title or not summary:
            report["errors"].append({"id": entry.get("id"), "error": "title and summary are required"})
            continue

        for channel in entry.get("pending_channels") or []:
            if channel == "docs":
                result = _post_docs(entry, dry_run=dry_run)
            elif channel == "slack":
                result = _post_slack(entry, dry_run=dry_run)
            elif channel in {"discord", "linkedin"}:
                result = _post_social(entry, channel, dry_run=dry_run, force=force)
            else:
                result = {"ok": False, "error": f"unsupported channel {channel}"}

            if result.get("skipped"):
                report["skipped"].append({"id": entry["id"], "channel": channel, **result})
                if result.get("reason") == "missing_config":
                    report["missing"].append({"id": entry["id"], "channel": channel, **result})
                continue
            if not result.get("ok"):
                report["errors"].append({"id": entry["id"], "channel": channel, **result})
                continue

            report["posted"].append({"id": entry["id"], "channel": channel, **result})
            if not dry_run:
                server_config.mark_ledger(entry["id"], channel, detail={"title": title})

    report["ok"] = not report["errors"]
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="Ignore enabled flag / re-post selected ids")
    ap.add_argument("--id", dest="only_id", default=None, help="Publish a single update id")
    args = ap.parse_args()
    report = publish(dry_run=args.dry_run, force=args.force, only_id=args.only_id)
    print(json.dumps(report, indent=2))
    if report.get("stopped"):
        return 0
    return 0 if report.get("ok", False) else 1


if __name__ == "__main__":
    raise SystemExit(main())
