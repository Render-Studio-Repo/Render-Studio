#!/usr/bin/env python3
"""Poll one connected X account and repost every new post from another.

Example cron entry (every 5 minutes):

*/5 * * * * cd /workspace && python3 scripts/x-auto-repost.py \
  --email a1projects@protonmail.com \
  --source Winstead_Works \
  --repost-as A1_Projects >> data/scheduled-social/x-auto-repost.log 2>&1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import twitter_repost_service  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", default="", help="Render Studio user id")
    parser.add_argument("--email", default="", help="Render Studio user email")
    parser.add_argument("--username", default="", help="Render Studio handle or display name")
    parser.add_argument("--source", default=twitter_repost_service.DEFAULT_SOURCE_USERNAME, help="Connected X account to watch")
    parser.add_argument("--repost-as", default=twitter_repost_service.DEFAULT_REPOST_AS_USERNAME, help="Connected X account that will repost")
    parser.add_argument("--dry-run", action="store_true", help="Fetch new post ids without reposting them")
    args = parser.parse_args()

    user_id = twitter_repost_service.resolve_user_id(
        user_id=args.user_id,
        email=args.email,
        username=args.username,
    )
    result = twitter_repost_service.poll_and_repost(
        user_id,
        source_username=args.source,
        repost_as_username=args.repost_as,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
