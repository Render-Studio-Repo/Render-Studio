#!/usr/bin/env python3
"""Send due signup check-in emails and poll the studio inbox for replies.

Safe to run by hand. Does not email accounts older than 14 days who never got a
check-in. The live server already runs this hourly from uvicorn startup.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import signup_checkin_service as checkin  # noqa: E402


def main() -> int:
    result = checkin.run_cycle()
    print(json.dumps(result, indent=2, default=str))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
