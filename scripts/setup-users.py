#!/usr/bin/env python3
"""First-run users backend (CLI). UI: /setup.html

    python scripts/setup-users.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.services import instance_setup_service as setup  # noqa: E402


def main() -> None:
    print("Render Studio — users / passwords / AI keys")
    print("  a) Connect YOUR Supabase (recommended)")
    print("  b) Store it locally (sqlite data/render3d.db)")
    choice = input("  Choice [a/b] (default a): ").strip().lower() or "a"
    if choice.startswith("b"):
        result = setup.save_local()
        print(f"Saved. users_backend={result.get('users_backend')}")
        return
    url = input("  SUPABASE_URL (https://YOUR_PROJECT_REF.supabase.co): ").strip()
    pub = input("  Publishable/anon key (optional): ").strip()
    role = input("  Service role (server only, not echoed later): ").strip()
    pat = input("  Management PAT sbp_… (optional): ").strip()
    result = setup.save_supabase(
        url=url,
        publishable_key=pub,
        service_role_key=role,
        access_token=pat,
        apply_schema=True,
    )
    print(f"ok={result.get('ok')} users_backend={result.get('users_backend')} count={result.get('users_count')}")
    if result.get("hint"):
        print(result["hint"])
    print("SQL file: integrations/supabase/install_users.sql")
    print("Harness prompt: integrations/supabase/HARNESS_PROMPT.md")


if __name__ == "__main__":
    main()
