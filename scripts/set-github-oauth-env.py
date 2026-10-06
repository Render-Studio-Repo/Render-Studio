#!/usr/bin/env python3
"""Write GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET into repo .env without printing them.

Usage:
  GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... python3 scripts/set-github-oauth-env.py

Optional:
  GITHUB_REDIRECT_URI=https://render3d.app/oauth/github/callback

Does not restart the app. After writing, restart com.render3d.app / render3d.service
when generations are idle.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
DEFAULT_REDIRECT = "https://render3d.app/oauth/github/callback"


def _upsert(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    line = f"{key}={value}"
    if pattern.search(text):
        return pattern.sub(line, text, count=1)
    if text and not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"


def main() -> int:
    client_id = (os.environ.get("GITHUB_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("GITHUB_CLIENT_SECRET") or "").strip()
    redirect = (os.environ.get("GITHUB_REDIRECT_URI") or DEFAULT_REDIRECT).strip() or DEFAULT_REDIRECT
    if not client_id or not client_secret:
        print("Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in the environment, then re-run.", file=sys.stderr)
        return 2
    if not ENV.exists():
        print(f"Missing {ENV}", file=sys.stderr)
        return 2
    text = ENV.read_text()
    text = _upsert(text, "GITHUB_CLIENT_ID", client_id)
    text = _upsert(text, "GITHUB_CLIENT_SECRET", client_secret)
    text = _upsert(text, "GITHUB_REDIRECT_URI", redirect)
    ENV.write_text(text)
    loc = "localhost" if ("localhost" in redirect or "127.0.0.1" in redirect) else "production-callback"
    print(f"Wrote GitHub OAuth env keys to .env (redirect: {loc}). Restart the app service when idle.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
