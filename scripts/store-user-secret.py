#!/usr/bin/env python3
"""Store a secret on a Users row or the GitHub Auth provider. Never prints the value.

  python3 scripts/store-user-secret.py --email sam@example.com --kind github_pat
  # then paste the secret, newline, EOF (or pipe stdin)

Kinds: github_pat, github_oauth (needs --client-id), x_consumer_secret (needs --consumer-key), x_bot_token
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="Upsert a user secret into Supabase without printing it.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--kind", required=True)
    parser.add_argument("--client-id", default="")
    parser.add_argument("--consumer-key", default="")
    parser.add_argument("--user-id", default="")
    args = parser.parse_args()
    secret = sys.stdin.read().strip()
    if not secret:
        print("Pass the secret on stdin.", file=sys.stderr)
        return 2
    from backend.services import supabase_users_store as sbusers

    uid = str(args.user_id or "").strip()
    if not uid:
        row = sbusers.get_by_email(args.email)
        uid = str((row or {}).get("id") or "").strip()
    if not uid:
        print("No Users row for that email.", file=sys.stderr)
        return 3
    extra = {}
    if args.client_id:
        extra["client_id"] = args.client_id
    if args.consumer_key:
        extra["consumer_key"] = args.consumer_key
    result = sbusers.store_user_secret(uid, args.kind, secret, extra=extra)
    print("ok" if result.get("ok") else "failed", result.get("kind") or args.kind, result.get("error") or "")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
