#!/usr/bin/env python3
"""Cron entry: email sam@ when the host is near collapse.

Usage:
  /home/ubuntu/.venv/bin/python /home/ubuntu/scripts/capacity-alert.py
  /home/ubuntu/.venv/bin/python /home/ubuntu/scripts/capacity-alert.py --dry-run
  /home/ubuntu/.venv/bin/python /home/ubuntu/scripts/capacity-alert.py --force
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.services.capacity_alert_service import check_and_alert, collect_snapshot  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Render3D capacity alert")
    parser.add_argument("--dry-run", action="store_true", help="Print snapshot; never send email")
    parser.add_argument("--force", action="store_true", help="Send even if cooldown says wait (still needs warn/critical)")
    parser.add_argument("--json", action="store_true", help="Print full JSON result")
    args = parser.parse_args()

    if args.dry_run and not args.force:
        snap = collect_snapshot()
        payload = {
            "level": snap.level,
            "reasons": snap.reasons,
            "mem_used_pct": snap.mem_used_pct,
            "mem_available_mb": snap.mem_available_mb,
            "swap_used_pct": snap.swap_used_pct,
            "load1": snap.load1,
            "disk_used_pct": snap.disk_used_pct,
            "running_generations": snap.running_generations,
            "registered_users": snap.registered_users,
            "instance_hint": snap.instance_hint,
            "guidance": snap.guidance,
        }
        print(json.dumps(payload, indent=2))
        return 0

    result = check_and_alert(force=args.force, dry_run=args.dry_run)
    if args.json or args.dry_run:
        print(json.dumps(result, indent=2, default=str))
    else:
        snap = result.get("snapshot") or {}
        print(
            f"level={snap.get('level')} sent={result.get('sent')} "
            f"smtp={result.get('smtp_configured')} reasons={snap.get('reasons')}"
        )
        if result.get("error"):
            print(f"error={result['error']}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
