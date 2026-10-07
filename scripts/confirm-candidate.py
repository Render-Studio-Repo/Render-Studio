#!/usr/bin/env python3
"""Confirm or reject a candidate_confirm job on local sqlite.

Live GET/PUT /debug-jobs/{id}/confirm-candidate is 404 until Studio reload.
This calls debugger_swarm_service.confirm_candidate / reject_candidate
directly — same credit rules. Does not set breakage=0. Does not auto-fire.
Does not confirm a job unless Sam passes the job_id.

  /Users/sam/Render-Studio/.venv/bin/python scripts/confirm-candidate.py job_d46c56edfa
  /Users/sam/Render-Studio/.venv/bin/python scripts/confirm-candidate.py --reject job_d46c56edfa
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import debugger_swarm_service as dss


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Confirm or reject a candidate_confirm debug job on local sqlite (no Studio reload).",
    )
    parser.add_argument("job_id", help="Required job_{hex10}, e.g. job_d46c56edfa")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--confirm", dest="action", action="store_const", const="confirm", help="sam_confirmed + credit (default)")
    action.add_argument("--reject", dest="action", action="store_const", const="reject", help="claimed / fix-few-issues; no credit")
    parser.set_defaults(action="confirm")
    return parser.parse_args(argv)


def apply(args: argparse.Namespace) -> dict:
    payload = {"job_id": str(args.job_id).strip()}
    if args.action == "reject":
        return dss.reject_candidate(payload)
    return dss.confirm_candidate(payload)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        out = apply(args)
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc), "job_id": args.job_id, "goal": "OPEN"}, indent=2))
        return 1
    print(json.dumps({
        "ok": out.get("ok"),
        "id": out.get("id"),
        "status": out.get("status"),
        "sam_confirmed": out.get("sam_confirmed"),
        "rejected": out.get("rejected"),
        "candidate_confirm": out.get("candidate_confirm"),
        "executed": out.get("executed"),
        "breakage_zero": out.get("breakage_zero"),
        "goal": out.get("goal") or "OPEN",
        "credit": out.get("credit"),
        "credit_category": out.get("credit_category"),
        "credited_agent": out.get("credited_agent"),
        "auto_fire": out.get("auto_fire", False),
    }, indent=2))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
