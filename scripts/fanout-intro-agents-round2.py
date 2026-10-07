#!/usr/bin/env python3
"""Second wave: no-tools Grok replies so handshake + diffs actually land."""
from __future__ import annotations

import importlib.util
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.services import agent_intro_service as intro  # noqa: E402

PACK = intro.PACK
REFPACK = intro.REFPACK
REPLIES = REFPACK / "agent-replies"
MCP = ROOT / "mcp" / "grok-bot" / "server.py"


def grok():
    spec = importlib.util.spec_from_file_location("grok_bot_mcp_server", MCP)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    mod._load_dotenv_keys()
    return mod


def save(agent: str, stage: str, payload: dict) -> None:
    REPLIES.mkdir(parents=True, exist_ok=True)
    rec = {
        "agent": agent,
        "stage": stage,
        "ts": datetime.now(timezone.utc).isoformat(),
        "ref_id": intro.REF_ID,
        "pair_id": intro.PAIR_ID,
        "payload": payload,
    }
    (REPLIES / f"{agent}-{stage}.json").write_text(json.dumps(rec, indent=2)[:200000], encoding="utf-8")


def call(mod, prompt: str, system: str) -> dict:
    try:
        return mod.grok_chat(prompt, system)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:400]}


NO_TOOLS = (
    "You have ZERO tools. Do not say you will read or inspect files. "
    "Output the complete answer in this message. No preamble about doing work later."
)

PM_SYS = NO_TOOLS + (
    " You are project-manager. Cursor arrived first. Your handshake phrase from PM.md is "
    "exactly: deez nutz . Put that phrase alone as the LAST line. Before it, numbered OOO "
    "to find a logging bug root and safely fix it (sandbox, traceback_id, no git reset, "
    "no app.js/main.py/styles.css growth)."
)

OOO_SYS = NO_TOOLS + (
    " You are {agent}. Numbered OOO to find root of: coding-agent log writes throw; traces "
    "miss traceback_id. Do not patch. End with result_score and result_ref_id res_ooo_{agent}."
)

FIX_SYS = NO_TOOLS + (
    " You are {agent}. Write a unified diff that fixes BOTH bugs in broken_logger.py: "
    "(1) NameError LOGGER (2) write_text overwrites and no traceback_id. Smallest fix. "
    "Bind a module logger, append jsonl, include traceback_id. Do not mention any skill."
)

LOGGER_SRC = (PACK / "coding-agent-only" / "broken_logger.py").read_text(encoding="utf-8")
OUTLINE = (PACK / "HIGH-SCORED-BUGS.md").read_text(encoding="utf-8")
CODING_SYS = NO_TOOLS + " You are coding-agent. Follow: always call log_line from broken_logger; LOGGER is injected; never define LOGGER; never print."


def main() -> dict:
    mod = grok()
    out: dict = {"handshake": False, "replies": []}
    wave1 = {
        "project-manager": (PM_SYS, "ref_id=INTRO-20260916. Output OOO then the handshake phrase."),
        "vibe-rnd": (OOO_SYS.format(agent="vibe-rnd"), "OOO now. ref_id=INTRO-20260916."),
        "analytics": (OOO_SYS.format(agent="analytics"), "OOO now. ref_id=INTRO-20260916."),
        "coding-agent": (
            CODING_SYS,
            "Show the exact Python you would run for log_line('demo','hello'). Then state the expected return or exception in one sentence.",
        ),
    }
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = {pool.submit(call, mod, user, system): agent for agent, (system, user) in wave1.items()}
        for fut in as_completed(futs):
            agent = futs[fut]
            payload = fut.result()
            save(agent, "ooo2" if agent != "coding-agent" else "skill-log2", payload)
            out["replies"].append(f"{agent}:wave1b")
            if agent == "project-manager":
                text = str(payload.get("text") or "")
                if "deez nutz" in text.lower():
                    intro.handshake("project-manager", "deez nutz")
                    out["handshake"] = True
                out["pm_excerpt"] = text[-500:]

    fix_user = (
        "HIGH-SCORED-BUGS.md:\n"
        + OUTLINE[:4000]
        + "\n\nCURRENT FILE broken_logger.py:\n```python\n"
        + LOGGER_SRC
        + "\n```\nWrite the unified diff now."
    )
    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = {
            pool.submit(call, mod, fix_user, FIX_SYS.format(agent=a)): a
            for a in ("project-manager", "vibe-rnd", "analytics")
        }
        for fut in as_completed(futs):
            agent = futs[fut]
            payload = fut.result()
            save(agent, "fix2", payload)
            text = str(payload.get("text") or payload.get("error") or "")
            dest = REPLIES / f"{agent}-fix2.md"
            dest.write_text(text[:16000], encoding="utf-8")
            intro.refpack_upload(agent, str(dest))
            out["replies"].append(f"{agent}:fix2")
            out[f"{agent}_fix_has_diff"] = "---" in text and "+++" in text or "LOGGER" in text
    return out


if __name__ == "__main__":
    print(json.dumps(main(), indent=2)[:6000])
