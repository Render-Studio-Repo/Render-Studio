#!/usr/bin/env python3
"""Publish the weekly bus report. Default: wait until 19:00 America/Chicago on 16 Sep 2026."""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TZ = ZoneInfo("America/Chicago")
TARGET = datetime(2026, 9, 16, 19, 0, tzinfo=TZ)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--now", action="store_true")
    args = parser.parse_args()
    if not args.now:
        while datetime.now(TZ) < TARGET:
            time.sleep(15)
    from backend.services.weekly_bus_report_service import publish

    row = publish()
    print(row.get("id"), row.get("cursor", {}).get("score"), row.get("report_path"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
