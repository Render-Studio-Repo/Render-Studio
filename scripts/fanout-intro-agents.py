#!/usr/bin/env python3
"""Fan-out INTRO pack to Grok personas. Coding-agent gets the logger skill; others do not."""
from __future__ import annotations

import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import agent_intro_service as intro  # noqa: E402

PACK = intro.PACK
REFPACK = intro.REFPACK
MCP = ROOT / "mcp" / "grok-bot" / "server.py"
REPLIES = REFPACK / "agent-replies"
OUTLINE = PACK / "HIGH-SCORED-BUGS.md"


def grok_mod():
    spec = importlib.util.spec_from_file_location("grok_bot_mcp_server", MCP)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    mod._load_dotenv_keys()
    return mod


PM_SYS = (
    "You are project-manager for Render Studio. Read only ref_id INTRO-20260916 at "
    "logs/Agent_Introductions/. If Cursor arrived first, your handshake phrase is the "
    "code word from PM.md. Reply with that phrase on its own last line. "
    "Then give a numbered order of operations to FIND the root of a logging bug "
    "and safely fix it (sandbox first, traceback_id, no git reset, no app.js/main.py growth). "
    "Do not apply a patch yet. No secrets."
)

OOO_SYS = (
    "You are {agent} for Render Studio. Read only ref_id INTRO-20260916. "
    "A logging bug is failing traces. Write a numbered order of operations to find "
    "the root cause and safely fix it. Do not patch yet. No secrets. "
    "End with result_score 0-100 for this reply and result_ref_id res_ooo_{agent}."
)

OOO_USER = (
    "ref_id=INTRO-20260916 pair_id=PAIR-INTRO-20260916. "
    "Symptom: coding-agent log writes sometimes throw and traces miss traceback_id. "
    "Write the OOO only. Upload listing: you will copy logs/source into "
    "logs/Agent_Introductions/RefPack via agent_refpack_upload when tools are available."
)

CODING_SYS = (
    Path("/Users/sam/Render-Studio/logs/Agent_Introductions/coding-agent-only/SKILL.md").read_text(
        encoding="utf-8"
    )
    + "\nYou are coding-agent. Follow the skill. Do not skip log_line."
)

CODING_USER = (
    "Import logs/Agent_Introductions/coding-agent-only/broken_logger.py and call "
    "log_line('demo','hello'). Report exactly what happened. Then write a 3-line "
    "Python snippet showing how you would log the next op using only log_line."
)

FIX_SYS = (
    "You are {agent}. You already proposed a safe OOO. Now you MAY write the smallest "
    "code fix. The only bug index is logs/Agent_Introductions/HIGH-SCORED-BUGS.md "
    "(also RefPack/HIGH-SCORED-BUGS.md). Fix rank 1 and 2 only. "
    "Do not grow app.js, main.py, or styles.css. Return a unified diff for broken_logger.py."
)

FIX_USER = None  # filled at runtime


def save(agent: str, stage: str, payload: dict) -> Path:
    REPLIES.mkdir(parents=True, exist_ok=True)
    path = REPLIES / f"{agent}-{stage}.json"
    rec = {
        "agent": agent,
        "stage": stage,
        "ts": datetime.now(timezone.utc).isoformat(),
        "ref_id": intro.REF_ID,
        "pair_id": intro.PAIR_ID,
        "payload": payload,
    }
    path.write_text(json.dumps(rec, indent=2)[:200000], encoding="utf-8")
    return path


def call(mod, prompt: str, system: str) -> dict:
    try:
        return mod.grok_chat(prompt, system)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:400]}


def main() -> dict:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    REPLIES.mkdir(parents=True, exist_ok=True)
    outline = OUTLINE.read_text(encoding="utf-8") if OUTLINE.is_file() else ""
    global FIX_USER
    FIX_USER = "Here is HIGH-SCORED-BUGS.md:\n\n" + outline[:6000] + "\n\nWrite the fix now."
    mod = grok_mod()
    out: dict = {"ok": True, "replies": []}

    wave1 = {
        "project-manager": (OOO_USER, PM_SYS),
        "vibe-rnd": (OOO_USER, OOO_SYS.format(agent="vibe-rnd")),
        "analytics": (OOO_USER, OOO_SYS.format(agent="analytics")),
        "vibe-marketing": (OOO_USER, OOO_SYS.format(agent="vibe-marketing")),
        "coding-agent": (CODING_USER, CODING_SYS),
    }
    with ThreadPoolExecutor(max_workers=5) as pool:
        futs = {pool.submit(call, mod, prompt, system): agent for agent, (prompt, system) in wave1.items()}
        for fut in as_completed(futs):
            agent = futs[fut]
            payload = fut.result()
            save(agent, "skill-log" if agent == "coding-agent" else "ooo", payload)
            out["replies"].append(f"{agent}:wave1")
            if agent == "project-manager":
                text = str((payload.get("text") or payload.get("error") or "")).lower()
                if "deez nutz" in text:
                    intro.handshake("project-manager", "deez nutz")
                    out["handshake"] = True
                else:
                    out["handshake"] = False
                    out["pm_excerpt"] = str(payload.get("text") or payload.get("error") or "")[:400]

    wave2 = ("project-manager", "vibe-rnd", "analytics")
    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = {pool.submit(call, mod, FIX_USER, FIX_SYS.format(agent=agent)): agent for agent in wave2}
        for fut in as_completed(futs):
            agent = futs[fut]
            payload = fut.result()
            save(agent, "fix", payload)
            out["replies"].append(f"{agent}:fix")
            dest = REPLIES / f"{agent}-fix-excerpt.md"
            dest.write_text(str(payload.get("text") or payload.get("error") or "")[:12000], encoding="utf-8")
            try:
                intro.refpack_upload(agent, str(dest))
            except Exception:
                pass

    try:
        intro.refpack_upload("coding-agent", str(PACK / "coding-agent-only" / "broken_logger.py"))
        intro.refpack_upload("coding-agent", str(PACK / "coding-agent-only" / "SKILL.md"))
    except Exception:
        pass
    return out


if __name__ == "__main__":
    print(json.dumps(main(), indent=2)[:8000])
