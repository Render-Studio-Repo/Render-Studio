#!/usr/bin/env python3
"""Scheduled LinkedIn poster for Render Studio Recent Updates.

Run this from cron hourly. It posts at configured local-hour slots:
- Monday-Friday: LINKEDIN_SCHEDULE_WEEKDAY_HOURS (default 10)
- Sunday: LINKEDIN_SCHEDULE_SUNDAY_HOURS (default 10,16)
- Saturday: no scheduled posts

It chooses a random item from frontend/docs/updates/milestones.js and avoids
reusing any update id from the last LINKEDIN_SCHEDULE_RECENT_WINDOW posts.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.config import settings  # noqa: E402
from backend.services import linkedin_updates_service as linkedin  # noqa: E402

MILESTONES = ROOT / "frontend" / "docs" / "updates" / "milestones.js"
STATE_DIR = ROOT / "data" / "scheduled-social"


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "linkedin"


def state_path() -> Path:
    name = str(getattr(settings, "linkedin_schedule_name", "") or "Sam's posts")
    return STATE_DIR / f"{_slug(name)}.json"


def _parse_js_string(block: str, key: str) -> str:
    m = re.search(rf'{re.escape(key)}:\s*(?:"([^"]*)"|`([^`]*)`)', block, re.S)
    if not m:
        return ""
    return (m.group(1) if m.group(1) is not None else m.group(2) or "").replace("\\n", " ").strip()


def load_updates() -> list[dict[str, Any]]:
    if not MILESTONES.is_file():
        raise FileNotFoundError(f"Missing updates list: {MILESTONES}")
    text = MILESTONES.read_text(encoding="utf-8")
    rows: list[dict[str, Any]] = []
    for block in re.split(r"\n  \},\n", text):
        uid = _parse_js_string(block, "id")
        title = _parse_js_string(block, "title")
        if not uid or not title:
            continue
        rows.append(
            {
                "id": uid,
                "title": title,
                "summary": _parse_js_string(block, "summary"),
                "kind": _parse_js_string(block, "kind") or "feature",
                "href": _parse_js_string(block, "href") or "/updates.html",
                "visual": _parse_js_string(block, "visual"),
            }
        )
    return rows


def load_state() -> dict[str, Any]:
    path = state_path()
    if not path.is_file():
        return {"name": getattr(settings, "linkedin_schedule_name", "Sam's posts"), "posted": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"posted": []}
    except Exception:
        return {"posted": []}


def save_state(state: dict[str, Any]) -> None:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    state["name"] = getattr(settings, "linkedin_schedule_name", "Sam's posts")
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def _hours(value: str, default: list[int]) -> set[int]:
    out: set[int] = set()
    for part in str(value or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            hour = int(part)
        except ValueError:
            continue
        if 0 <= hour <= 23:
            out.add(hour)
    return out or set(default)


def current_slot(now: datetime | None = None) -> str | None:
    tz = ZoneInfo(str(getattr(settings, "linkedin_schedule_timezone", "") or "America/New_York"))
    local = (now or datetime.now(timezone.utc)).astimezone(tz)
    weekday = local.weekday()  # Monday=0, Sunday=6
    if weekday == 5:
        return None
    if weekday == 6:
        hours = _hours(getattr(settings, "linkedin_schedule_sunday_hours", ""), [10, 16])
    else:
        hours = _hours(getattr(settings, "linkedin_schedule_weekday_hours", ""), [10])
    if local.hour not in hours:
        return None
    return f"{local.date().isoformat()}T{local.hour:02d}"


def choose_update(updates: list[dict[str, Any]], state: dict[str, Any]) -> dict[str, Any] | None:
    window = max(1, int(getattr(settings, "linkedin_schedule_recent_window", 10) or 10))
    posted = list(state.get("posted") or [])
    recent_ids = {str(row.get("id")) for row in posted[-window:] if row.get("id")}
    eligible = [row for row in updates if str(row.get("id")) not in recent_ids]
    if not eligible:
        return None
    return random.SystemRandom().choice(eligible)


def media_path_for(update: dict[str, Any]) -> Path | None:
    visual = str(update.get("visual") or "").split("?", 1)[0].strip()
    if not visual:
        return None
    if visual.startswith("/"):
        path = ROOT / "frontend" / visual.lstrip("/")
    else:
        path = ROOT / "frontend" / visual
    return path if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} else None


def post_scheduled(*, dry_run: bool = False, force: bool = False) -> dict[str, Any]:
    state = load_state()
    slot = current_slot()
    if not force and not slot:
        return {"ok": True, "skipped": True, "reason": "outside_schedule"}
    slot = slot or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
    if not force and slot in {str(row.get("slot")) for row in state.get("posted") or []}:
        return {"ok": True, "skipped": True, "reason": "slot_already_posted", "slot": slot}

    updates = load_updates()
    selected = choose_update(updates, state)
    if not selected:
        return {"ok": False, "skipped": True, "reason": "no_update_outside_recent_window"}

    commentary = linkedin.build_commentary(selected)
    media = media_path_for(selected)
    preview = {
        "schedule": getattr(settings, "linkedin_schedule_name", "Sam's posts"),
        "slot": slot,
        "id": selected["id"],
        "title": selected["title"],
        "media": str(media) if media else None,
    }
    if dry_run:
        return {"ok": True, "dry_run": True, **preview, "text": commentary}

    result = linkedin.announce_text(commentary, media_path=media)
    if not result.get("ok") or result.get("skipped"):
        return {"ok": bool(result.get("ok")), "result": result, **preview}
    row = {
        **preview,
        "posted_at": datetime.now(timezone.utc).isoformat(),
        "post_id": result.get("post_id"),
        "ok": result.get("ok"),
        "skipped": False,
    }
    state.setdefault("posted", []).append(row)
    state["posted"] = state["posted"][-200:]
    save_state(state)
    return {"ok": bool(result.get("ok")), "result": result, **preview}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Post now, ignoring schedule and slot dedupe")
    args = parser.parse_args()
    result = post_scheduled(dry_run=args.dry_run, force=args.force)
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") or result.get("skipped") else 1


if __name__ == "__main__":
    raise SystemExit(main())
