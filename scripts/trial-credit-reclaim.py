#!/usr/bin/env python3
"""Reclaim idle free-trial credits and fund waitlisted users from the pool.

Run from cron hourly. Safe to call often (idempotent).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.database import init_db  # noqa: E402
from backend.services import ai_credit_service  # noqa: E402


def main() -> int:
    init_db()
    result = ai_credit_service.reclaim_idle_trial_credits()
    print(json.dumps({"ok": True, **result}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
