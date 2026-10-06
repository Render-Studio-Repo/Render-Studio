#!/usr/bin/env python3
"""Print (and optionally register) the public X Account Activity webhook URL.

Does not print secrets. Does not call X unless you pass --register AND the
developer-app credentials needed to POST webhooks.json are present.

Usage:
  python3 scripts/register-x-webhook.py
  python3 scripts/register-x-webhook.py --register

Env:
  PUBLIC_BASE_URL          default https://render3d.app
  X_WEBHOOK_PATH           default /api/webhooks/x
  X_WEBHOOK_ENV            premium AAAPI environment label (Dev environments)
  X_CONSUMER_KEY / TWITTER_CLIENT_ID
  X_CONSUMER_SECRET / TWITTER_CLIENT_SECRET
  TWITTER_BEARER_TOKEN     optional; some AAAPI register calls accept Bearer
  TWITTER_ACCESS_TOKEN + TWITTER_ACCESS_TOKEN_SECRET
                           owner user-context OAuth 1.0a (preferred for register)

After CRC succeeds, subscribe the bot user:
  POST .../account_activity/all/{env}/subscriptions.json
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
DEFAULT_PATH = "/api/webhooks/x"
ALIAS_PATH = "/api/x/webhook"
DEFAULT_BASE = "https://render3d.app"

DOTENV_KEYS = (
    "PUBLIC_BASE_URL",
    "X_WEBHOOK_PATH",
    "X_WEBHOOK_ENV",
    "X_CONSUMER_KEY",
    "X_CONSUMER_SECRET",
    "TWITTER_CLIENT_ID",
    "TWITTER_CLIENT_SECRET",
    "TWITTER_BEARER_TOKEN",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_TOKEN_SECRET",
)


def _load_dotenv() -> None:
    if not ENV_PATH.is_file():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key not in DOTENV_KEYS or os.environ.get(key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def _env(name: str) -> str:
    return str(os.environ.get(name) or "").strip()


def _present(name: str) -> bool:
    return bool(_env(name))


def public_url() -> str:
    base = (_env("PUBLIC_BASE_URL") or DEFAULT_BASE).rstrip("/")
    path = _env("X_WEBHOOK_PATH") or DEFAULT_PATH
    if not path.startswith("/"):
        path = "/" + path
    return f"{base}{path}"


def register_endpoint(env_name: str) -> str:
    quoted = urllib.parse.quote(public_url(), safe="")
    if env_name:
        return (
            "https://api.twitter.com/1.1/account_activity/all/"
            f"{urllib.parse.quote(env_name, safe='')}/webhooks.json?url={quoted}"
        )
    return f"https://api.twitter.com/1.1/account_activity/webhooks.json?url={quoted}"


def subscribe_endpoint(env_name: str) -> str:
    if env_name:
        return (
            "https://api.twitter.com/1.1/account_activity/all/"
            f"{urllib.parse.quote(env_name, safe='')}/subscriptions.json"
        )
    return "https://api.twitter.com/1.1/account_activity/webhooks.json"


def _print_status() -> None:
    url = public_url()
    alias = f"{(_env('PUBLIC_BASE_URL') or DEFAULT_BASE).rstrip('/')}{ALIAS_PATH}"
    env_name = _env("X_WEBHOOK_ENV")
    print(f"Public webhook URL: {url}")
    print(f"Alias:               {alias}")
    print(f"CRC:  GET  {url}?crc_token=...  → {{\"response_token\":\"sha256=...\"}}")
    print("POST: header X-Twitter-Webhooks-Signature = sha256=HMAC_SHA256(body, consumer_secret)")
    print()
    print("Credentials (names only, values never printed):")
    print(f"  X_CONSUMER_KEY / TWITTER_CLIENT_ID:     {'set' if (_present('X_CONSUMER_KEY') or _present('TWITTER_CLIENT_ID')) else 'MISSING'}")
    print(f"  X_CONSUMER_SECRET / TWITTER_CLIENT_SECRET: {'set' if (_present('X_CONSUMER_SECRET') or _present('TWITTER_CLIENT_SECRET')) else 'MISSING'}")
    print(f"  TWITTER_BEARER_TOKEN:                   {'set' if _present('TWITTER_BEARER_TOKEN') else 'missing'}")
    print(f"  TWITTER_ACCESS_TOKEN + SECRET:          {'set' if (_present('TWITTER_ACCESS_TOKEN') and _present('TWITTER_ACCESS_TOKEN_SECRET')) else 'missing (needed for --register OAuth 1.0a)'}")
    print(f"  X_WEBHOOK_ENV:                          {env_name or 'MISSING — set the premium AAAPI env label from developer.x.com'}")
    print()
    print("Register in the X developer portal (Account Activity → Register webhook), or:")
    print()
    print(f"  curl -X POST '{register_endpoint(env_name or 'YOUR_ENV')}' \\")
    print("    -H 'Authorization: Bearer $TWITTER_BEARER_TOKEN'")
    print()
    print("Preferred OAuth 1.0a (app owner user context):")
    print(f"  POST {register_endpoint(env_name or 'YOUR_ENV')}")
    print("  then subscribe the bot user:")
    print(f"  POST {subscribe_endpoint(env_name or 'YOUR_ENV')}")
    print()
    print("This script does not call X unless you pass --register.")


def _register() -> int:
    env_name = _env("X_WEBHOOK_ENV")
    if not env_name:
        print("Set X_WEBHOOK_ENV to the Account Activity environment label, then re-run --register.", file=sys.stderr)
        print("Or register the URL in the X developer portal instead.", file=sys.stderr)
        return 2
    key = _env("X_CONSUMER_KEY") or _env("TWITTER_CLIENT_ID")
    secret = _env("X_CONSUMER_SECRET") or _env("TWITTER_CLIENT_SECRET")
    token = _env("TWITTER_ACCESS_TOKEN")
    token_secret = _env("TWITTER_ACCESS_TOKEN_SECRET")
    bearer = _env("TWITTER_BEARER_TOKEN")
    endpoint = register_endpoint(env_name)
    try:
        import requests
    except ImportError:
        print("Install requests to use --register, or paste the curl above.", file=sys.stderr)
        return 2
    headers = {"User-Agent": "render-studio-x-webhook/1"}
    if token and token_secret and key and secret:
        from requests_oauthlib import OAuth1

        auth = OAuth1(key, secret, token, token_secret)
        resp = requests.post(endpoint, auth=auth, headers=headers, timeout=30)
    elif bearer:
        resp = requests.post(
            endpoint,
            headers={**headers, "Authorization": f"Bearer {bearer}"},
            timeout=30,
        )
    else:
        print(
            "Need TWITTER_ACCESS_TOKEN + TWITTER_ACCESS_TOKEN_SECRET (OAuth 1.0a) "
            "or TWITTER_BEARER_TOKEN. Register in the X developer portal instead.",
            file=sys.stderr,
        )
        return 2
    print(f"X register HTTP {resp.status_code}")
    text = (resp.text or "")[:400]
    if text:
        print(text)
    if resp.status_code >= 400:
        return 1
    print("Next: subscribe the bot user (Account Activity subscriptions) if X did not do it automatically.")
    return 0


def main() -> int:
    _load_dotenv()
    parser = argparse.ArgumentParser(description="Print or register the X Account Activity webhook.")
    parser.add_argument(
        "--register",
        action="store_true",
        help="POST webhooks.json to api.twitter.com (only if credentials are present).",
    )
    args = parser.parse_args()
    _print_status()
    if not args.register:
        return 0
    return _register()


if __name__ == "__main__":
    raise SystemExit(main())
