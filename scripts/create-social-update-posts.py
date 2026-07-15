#!/usr/bin/env python3
"""Build Discord + LinkedIn update posts (within platform limits) and optionally post to Discord.

Discord content limit: 2000
LinkedIn practical post limit: ~3000 (we target <= 2800)

Writes drafts to frontend/docs/updates/social/
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import discord_updates_service as discord  # noqa: E402

SOCIAL_DIR = ROOT / "frontend" / "docs" / "updates" / "social"
GIF_DIR = ROOT / "frontend" / "docs" / "media" / "social"
PUBLIC = "https://render3d.app"

# Keep Discord messages short; LinkedIn can be a bit richer.
UPDATES = [
    {
        "id": "render-agent-do-it-for-me",
        "title": "Render Agent: Do it for me",
        "discord": (
            "**New in Render3D — Render Agent: Do it for me**\n"
            "Tell the agent what you want. It gathers the task, project, and object, "
            "then walks each setup step with sticky notes before it runs.\n\n"
            f"👉 [Click here to try it]({PUBLIC}/getting-started.html#render-agent)\n"
            f"Updates: {PUBLIC}/updates.html"
        ),
        "linkedin": (
            "New in Render3D for CAD developers and makers:\n\n"
            "Render Agent → Do it for me\n"
            "Describe the outcome. The agent collects task + project + object context, "
            "explains each setup step with sticky notes, then sends the request for you.\n\n"
            "Built for faster onboarding inside a real AI CAD studio — not a slide deck.\n\n"
            f"Click here to try it: {PUBLIC}/getting-started.html#render-agent\n"
            f"Changelog: {PUBLIC}/updates.html\n\n"
            "#CAD #AI #3DPrinting #Robotics #Render3D #Developers"
        ),
        "gif": "render-agent.social.gif",
        "href": f"{PUBLIC}/getting-started.html#render-agent",
    },
    {
        "id": "mode-2-selected-face-edit",
        "title": "Mode 2.0 selected-face edits",
        "discord": (
            "**New in Render3D — Mode 2.0 face-accurate edits**\n"
            "Pick a face or part, then ask AI to lengthen/extend. Edits stay locked to the "
            "selected object instead of regenerating from an old baseline.\n\n"
            f"👉 [Click here to try it]({PUBLIC}/getting-started.html#picks)\n"
            f"Updates: {PUBLIC}/updates.html"
        ),
        "linkedin": (
            "Shipping a precision upgrade in Render3D Mode 2.0:\n\n"
            "Selected-face length edits\n"
            "Face/component refs now keep generative edit mode on the live viewport object, "
            "so “make this 20mm longer” revises the part you picked — not a stale baseline.\n\n"
            f"Click here to try it: {PUBLIC}/getting-started.html#picks\n"
            f"More updates: {PUBLIC}/updates.html\n\n"
            "#GenerativeDesign #CAD #AI #Manufacturing #Render3D"
        ),
        "gif": "picks.social.gif",
        "href": f"{PUBLIC}/getting-started.html#picks",
    },
    {
        "id": "mobile-app-chrome",
        "title": "App-like mobile studio",
        "discord": (
            "**New in Render3D — App-like mobile studio**\n"
            "Hamburger grid menu, profile top-right, tools FAB, and a locked viewport "
            "(no accidental zoom while tapping menus). Pick a model in Explorer and it opens "
            "instantly — no extra × tap.\n\n"
            f"👉 [Click here to try it]({PUBLIC}/)\n"
            f"Updates: {PUBLIC}/updates.html"
        ),
        "linkedin": (
            "Render3D mobile just got a true app shell:\n\n"
            "• Central ☰ menu grid for studio actions\n"
            "• Profile control top-right (same as desktop)\n"
            "• Bottom tools FAB for Grid / Transparent / Orbit / AI\n"
            "• Viewport zoom locked so menus feel native\n"
            "• Explorer model select auto-opens the part\n\n"
            f"Click here to try it: {PUBLIC}/\n"
            f"Changelog: {PUBLIC}/updates.html\n\n"
            "#MobileCAD #AI #3D #ProductDesign #Render3D"
        ),
        "gif": "select-object.social.gif",
        "href": f"{PUBLIC}/",
    },
    {
        "id": "gen-loader-ready-banner",
        "title": "Metallic gen loader + ready banner",
        "discord": (
            "**New in Render3D — Generation HUD**\n"
            "Bottom-right metallic loader with a mini printer + robot: the part prints with "
            "the progress bar, then the robot picks & places at 100%. When the model is ready, "
            "a status banner fades in above it.\n\n"
            f"👉 [Click here to try it]({PUBLIC}/)\n"
            f"Updates: {PUBLIC}/updates.html"
        ),
        "linkedin": (
            "A small UX detail that changes how AI CAD feels in Render3D:\n\n"
            "Generation HUD (bottom-right)\n"
            "• Metallic loader card\n"
            "• Printer builds the part with the progress bar\n"
            "• Robot picks and places at 100%\n"
            "• “Model ready” banner with prompt/project/file/trace context, then auto-fade\n\n"
            "Also fixed the Generate double-click race so the loader appears on the first click.\n\n"
            f"Click here to try it: {PUBLIC}/\n"
            f"Updates: {PUBLIC}/updates.html\n\n"
            "#UX #AI #CAD #Render3D #DeveloperExperience"
        ),
        "gif": "ai-generate.social.gif",
        "href": f"{PUBLIC}/",
    },
    {
        "id": "realtime-editor-popup",
        "title": "Realtime editor viewport popup",
        "discord": (
            "**New in Render3D — Realtime editor popup**\n"
            "Open a large realtime viewport from the workspace strip. After import/open it "
            "collapses to a compact left chip for the active object.\n\n"
            f"👉 [Click here to try it]({PUBLIC}/)\n"
            f"Updates: {PUBLIC}/updates.html"
        ),
        "linkedin": (
            "Render3D realtime collaboration got a cleaner viewport flow:\n\n"
            "Realtime editor popup\n"
            "Launch a large shared viewport from the workspace strip, then collapse it to a "
            "compact chip once the active object is open — better for reviews without losing context.\n\n"
            f"Click here to try it: {PUBLIC}/\n"
            f"Updates: {PUBLIC}/updates.html\n\n"
            "#Collaboration #CAD #Realtime #Render3D"
        ),
        "gif": "workspaces.social.gif",
        "href": f"{PUBLIC}/",
    },
]


def _validate_limits(posts: list[dict]) -> None:
    for p in posts:
        d = p["discord"]
        l = p["linkedin"]
        if len(d) > 2000:
            raise SystemExit(f"Discord over limit for {p['id']}: {len(d)}")
        if len(l) > 2800:
            raise SystemExit(f"LinkedIn over target for {p['id']}: {len(l)}")


def write_drafts(posts: list[dict]) -> Path:
    SOCIAL_DIR.mkdir(parents=True, exist_ok=True)
    discord_md = SOCIAL_DIR / "discord-posts.md"
    linkedin_md = SOCIAL_DIR / "linkedin-posts.md"
    json_path = SOCIAL_DIR / "posts.json"

    d_lines = ["# Discord update posts\n", "_Each message ≤ 2000 chars. Attach the matching branded GIF._\n"]
    l_lines = ["# LinkedIn developer posts\n", "_Each post ≤ 2800 chars. Upload the matching branded GIF as media._\n"]
    for i, p in enumerate(posts, 1):
        gif = p.get("gif") or ""
        d_lines += [
            f"\n## {i}. {p['title']}\n",
            f"GIF: `docs/media/social/{gif}`\n\n",
            "```\n",
            p["discord"],
            "\n```\n",
            f"Chars: {len(p['discord'])}\n",
        ]
        l_lines += [
            f"\n## {i}. {p['title']}\n",
            f"Media: `docs/media/social/{gif}`\n\n",
            "```\n",
            p["linkedin"],
            "\n```\n",
            f"Chars: {len(p['linkedin'])}\n",
        ]

    discord_md.write_text("".join(d_lines), encoding="utf-8")
    linkedin_md.write_text("".join(l_lines), encoding="utf-8")
    json_path.write_text(json.dumps(posts, indent=2) + "\n", encoding="utf-8")
    return SOCIAL_DIR


def post_to_discord(posts: list[dict], *, limit: int = 0) -> dict:
    st = discord.connection_status()
    if st.get("error") or not st.get("channel_ok"):
        return {"ok": False, "status": st, "posted": []}

    posted = []
    selected = posts[: limit or None]
    for p in selected:
        gif_path = GIF_DIR / p["gif"]
        if gif_path.is_file():
            msg = discord.send_channel_message_with_file(p["discord"][:2000], gif_path)
        else:
            msg = discord.announce_text(p["discord"])
            msg = {"id": msg.get("message_id")}
        try:
            posted_ids = discord._load_posted()
            posted_ids.add(p["id"])
            discord._save_posted(posted_ids)
        except Exception:
            pass
        posted.append({"id": p["id"], "message_id": msg.get("id")})
    return {"ok": True, "posted": posted, "status": st}


def post_to_linkedin(posts: list[dict], *, limit: int = 0) -> dict:
    from backend.services import linkedin_updates_service as linkedin

    st = linkedin.connection_status()
    if not linkedin.configured():
        return {"ok": False, "status": st, "posted": [], "reason": "not_configured"}

    posted = []
    selected = posts[: limit or None]
    for p in selected:
        gif_path = GIF_DIR / p["gif"]
        row = {
            "id": p["id"],
            "title": p["title"],
            "linkedin": p["linkedin"],
            "href": p.get("href") or "/updates.html",
            "media": str(gif_path) if gif_path.is_file() else None,
        }
        try:
            result = linkedin.announce_update(row, force=False)
            posted.append({"id": p["id"], **result})
        except Exception as err:
            posted.append({"id": p["id"], "ok": False, "error": str(err)})
    failed = sum(1 for r in posted if not r.get("ok") and not r.get("skipped"))
    return {
        "ok": failed == 0,
        "posted": posted,
        "status": st,
        "failed": failed,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--post-discord", action="store_true")
    ap.add_argument("--post-linkedin", action="store_true")
    ap.add_argument("--post-all", action="store_true", help="Post to Discord + LinkedIn")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--wait-discord", type=int, default=0, help="Seconds to wait for Discord bot invite")
    args = ap.parse_args()

    posts = UPDATES
    _validate_limits(posts)
    out = write_drafts(posts)
    print(f"Wrote drafts to {out.relative_to(ROOT)}")
    for p in posts:
        print(f"  - {p['id']}: discord={len(p['discord'])} linkedin={len(p['linkedin'])} gif={p['gif']}")

    do_discord = args.post_discord or args.post_all
    do_linkedin = args.post_linkedin or args.post_all
    exit_code = 0

    if do_discord and args.wait_discord > 0:
        import time

        deadline = time.time() + args.wait_discord
        while time.time() < deadline:
            st = discord.connection_status()
            if st.get("channel_ok"):
                print("Discord ready.")
                break
            print("Waiting for Discord bot invite…", st.get("error") or st.get("invite_url"))
            time.sleep(8)
        else:
            print("Timed out waiting for Discord.")
            exit_code = 1

    if do_discord:
        result = post_to_discord(posts, limit=args.limit)
        print("Discord:", json.dumps({k: v for k, v in result.items() if k != "status"}, indent=2))
        if not result.get("ok"):
            st = result.get("status") or {}
            print("Discord not ready:", st.get("error") or st)
            if st.get("invite_url"):
                print("Invite:", st["invite_url"])
            exit_code = 1

    if do_linkedin:
        result = post_to_linkedin(posts, limit=args.limit)
        print("LinkedIn:", json.dumps({k: v for k, v in result.items() if k != "status"}, indent=2))
        if not result.get("ok"):
            st = result.get("status") or {}
            print("LinkedIn not ready:", st.get("error") or result.get("reason") or st)
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
