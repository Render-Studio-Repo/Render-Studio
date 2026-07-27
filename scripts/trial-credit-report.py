#!/usr/bin/env python3
"""Email Sam a free-signup trial credit usage report Mon/Wed/Fri at 9am ET.

Run from cron hourly. Sends only in the America/New_York Mon/Wed/Fri 9:00 hour,
with slot dedupe so each window is emailed once.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import trial_credit_report_service as report  # noqa: E402

STATE_PATH = ROOT / "data" / "scheduled-reports" / "trial-credit-report.json"
TO_EMAIL = "sam@render3d.app"
TZ_NAME = "America/New_York"
SEND_HOUR = 9
SEND_WEEKDAYS = {0, 2, 4}  # Mon, Wed, Fri


def load_state() -> dict[str, Any]:
    if not STATE_PATH.is_file():
        return {"sent": []}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"sent": []}
    return data if isinstance(data, dict) else {"sent": []}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def current_slot(now: datetime | None = None) -> str | None:
    local = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(TZ_NAME))
    if local.weekday() not in SEND_WEEKDAYS:
        return None
    if local.hour != SEND_HOUR:
        return None
    return f"{local.date().isoformat()}T{local.hour:02d}"


def previous_slot_start(now: datetime | None = None) -> datetime:
    return report.default_window_start(now)


def run(*, dry_run: bool = False, force: bool = False, to_email: str = TO_EMAIL) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    state = load_state()
    slot = current_slot(now)
    if not force and not slot:
        return {"ok": True, "skipped": True, "reason": "outside_schedule"}
    slot = slot or now.astimezone(ZoneInfo(TZ_NAME)).strftime("%Y-%m-%dT%H")
    sent_slots = {str(row.get("slot")) for row in state.get("sent") or []}
    if not force and slot in sent_slots:
        return {"ok": True, "skipped": True, "reason": "slot_already_sent", "slot": slot}

    since = previous_slot_start(now)
    # Prefer last successful send time when available for a tighter window.
    for row in reversed(list(state.get("sent") or [])):
        if row.get("ok") and row.get("sent_at"):
            try:
                prev = datetime.fromisoformat(str(row["sent_at"]).replace("Z", "+00:00"))
                if prev.tzinfo is None:
                    prev = prev.replace(tzinfo=timezone.utc)
                since = prev.astimezone(timezone.utc)
            except ValueError:
                pass
            break

    payload = report.build_report(since=since, now=now)
    preview = {
        "slot": slot,
        "to": to_email,
        "window_start": payload.get("window_start"),
        "window_end": payload.get("window_end"),
        "summary": payload.get("summary"),
    }
    if dry_run:
        template = report.render_report_email(payload)
        return {
            "ok": True,
            "dry_run": True,
            **preview,
            "subject": template["subject"],
            "text_preview": template["text"][:1200],
        }

    result = report.send_report_email(payload, to_email=to_email)
    row = {
        **preview,
        "sent_at": now.isoformat(),
        "ok": bool(result.get("ok")),
        "error": result.get("error"),
        "subject": result.get("subject"),
    }
    state.setdefault("sent", []).append(row)
    state["sent"] = state["sent"][-100:]
    save_state(state)
    return {"ok": bool(result.get("ok")), "result": result, **preview}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Build report without sending")
    parser.add_argument("--force", action="store_true", help="Send now, ignoring schedule/dedupe")
    parser.add_argument("--to", default=TO_EMAIL, help="Recipient email (default sam@render3d.app)")
    args = parser.parse_args()
    result = run(dry_run=args.dry_run, force=args.force, to_email=args.to)
    print(json.dumps(result, indent=2, default=str))
    return 0 if result.get("ok") or result.get("skipped") else 1


if __name__ == "__main__":
    raise SystemExit(main())
