#!/usr/bin/env python3
"""Hello ping, vibe-marketing tweet draft/post, PM classification, email Sam."""
from __future__ import annotations

import importlib.util
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.services import vision_desk_service as desk  # noqa: E402

MCP = ROOT / "mcp" / "grok-bot" / "server.py"
TWEET = (
    "We published the Render Studio debugger / agent-bus white paper. "
    "Searchable, next to Roadmap. Ask the Render Agent about the vision, or leave an anonymous comment.\n\n"
    "https://render3d.app/white-paper.html"
)
AGENTS = [
    "project-manager",
    "vibe-marketing",
    "vibe-sales",
    "vibe-rnd",
    "analytics",
    "clip-bot",
    "coding-agent",
]


def grok():
    spec = importlib.util.spec_from_file_location("grok_bot_mcp_server", MCP)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    mod._load_dotenv_keys()
    return mod


def call(mod, prompt, system):
    try:
        return mod.grok_chat(prompt, system)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:400]}


def main() -> dict:
    desk.ensure_schema()
    mod = grok()
    out: dict = {"tweet": TWEET, "hellos": {}, "posted": None, "task": None, "email": None, "pm": None}

    def hello(agent: str):
        sys_p = (
            "You are "
            + agent
            + ". You have no tools. First word of your reply must be hello. Then one sentence."
        )
        return agent, call(mod, "Say hello.", sys_p)

    with ThreadPoolExecutor(max_workers=7) as pool:
        futs = [pool.submit(hello, a) for a in AGENTS]
        for fut in as_completed(futs):
            agent, payload = fut.result()
            text = str(payload.get("text") or payload.get("error") or "")
            desk.record_hello(agent, text)
            out["hellos"][agent] = text[:200]

    mkt = call(
        mod,
        "Write the X caption only, under 280 chars, include https://render3d.app/white-paper.html . No hashtag dump.",
        "You are vibe-marketing. No tools. Output the tweet only.",
    )
    caption = str(mkt.get("text") or TWEET).strip()[:280]
    if "render3d.app/white-paper" not in caption:
        caption = TWEET
    out["caption"] = caption

    post = None
    err = ""
    try:
        post = mod.x_post(caption, confirm=True)
    except Exception as exc:
        err = str(exc)[:300]
        post = {"ok": False, "error": err}
    out["posted"] = post
    if not (isinstance(post, dict) and post.get("posted")):
        out["task"] = desk.create_task("vibe-marketing", "x_post failed: " + (err or str(post)[:200]))
        pm_fail = call(
            mod,
            f"vibe-marketing failed to post. task_id={out['task']['task_id']}. Tell Cursor they failed. One paragraph.",
            "You are project-manager. No tools. Acknowledge the failed X post.",
        )
        out["pm_fail"] = str(pm_fail.get("text") or "")[:500]

    pm = call(
        mod,
        "How should we classify agent instructions in the future so results improve 10% tomorrow? "
        "Stay on FEAT/NET/DATA/PERF/UI/VR/GL/API/WD/CAD/CTL/OTH. No second bug family. Under 200 words.",
        "You are project-manager. No tools. Be concrete.",
    )
    out["pm"] = str(pm.get("text") or "")[:1500]
    body = (
        "Sam — vision desk report 16 Sep 2026.\n\n"
        f"Census: {json.dumps(desk.census(), indent=2)[:3500]}\n\n"
        f"Credit: {json.dumps(desk.credit_score())}\n\n"
        f"PM classification:\n{out['pm']}\n\n"
        f"X caption:\n{caption}\n\n"
        f"Posted: {json.dumps(post)[:800]}\n"
        f"Task: {json.dumps(out.get('task'))}\n\n"
        "ML: not required. Weighted five-factor credit is enough until N>200 labeled outcomes.\n"
        "System prompt change for +10%: max 7 numbered goals per prompt; overflow later[]; every goal maps to one category_id; "
        "end with result_score+result_ref_id; refuse dual id families.\n"
        "Suggestions page: https://render3d.app/suggestions.html\n"
        "White paper: https://render3d.app/white-paper.html\n"
    )
    out["email"] = desk.email_sam("Vision desk census + credit 16 Sep 2026", body)
    Path("/Users/sam/Render-Studio/logs/Agent_Introductions/RefPack/EMAIL-SAM.txt").write_text(body, encoding="utf-8")
    out["ranking"] = desk.ranking_from_hellos()
    Path("/Users/sam/Render-Studio/logs/Agent_Introductions/RefPack/RANKING.json").write_text(
        json.dumps(out["ranking"], indent=2), encoding="utf-8"
    )
    Path("/Users/sam/Render-Studio/logs/Agent_Introductions/RefPack/HELLO.json").write_text(
        json.dumps(out["hellos"], indent=2), encoding="utf-8"
    )
    return out


if __name__ == "__main__":
    print(json.dumps(main(), indent=2)[:12000])
