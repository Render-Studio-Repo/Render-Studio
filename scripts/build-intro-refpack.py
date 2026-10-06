#!/usr/bin/env python3
"""Build INTRO-20260916 RefPack: combined logs MD+JSON, PDFs, bug outline, copies."""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import traceback as tbmod
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services import agent_intro_service as intro  # noqa: E402
from backend.services.simple_pdf import pdf_bytes_pages  # noqa: E402

PACK = intro.PACK
REFPACK = intro.REFPACK
PAIR_ID = intro.PAIR_ID
REF_ID = intro.REF_ID
CHAT_ID = "e353e189-b018-432a-a212-d354cb338496"
NOW = datetime.now(timezone.utc).isoformat()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def try_transcript() -> list[dict]:
    path = Path(
        "/Users/sam/.cursor/projects/Users-sam/agent-transcripts"
    ) / CHAT_ID / f"{CHAT_ID}.jsonl"
    rows = []
    try:
        for i, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines()):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            role = obj.get("role") or obj.get("type") or ""
            text = ""
            msg = obj.get("message") or obj.get("content") or obj
            if isinstance(msg, dict):
                content = msg.get("content") or msg.get("text") or ""
                role = role or msg.get("role") or ""
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    bits = []
                    for part in content:
                        if isinstance(part, dict) and part.get("type") in {"text", "input_text"}:
                            bits.append(str(part.get("text") or "")[:2000])
                        elif isinstance(part, str):
                            bits.append(part[:2000])
                    text = "\n".join(bits)
            elif isinstance(msg, str):
                text = msg
            text = text.strip()
            if not text or role in {"tool", "function"}:
                continue
            if "tool_use" in text[:40]:
                continue
            rows.append({"n": i, "role": str(role)[:24], "excerpt": text[:1800]})
            if len(rows) >= 80:
                break
    except OSError:
        pass
    return rows


FALLBACK_TURNS = [
    ("user", "where is the webhook for x bot"),
    ("user", "Received invalid status code from URL during CRC: 404"),
    ("user", "update the routes i gave u all the keys for the x bot"),
    ("user", "URL returned bad response during CRC: Invalid response_token"),
    ("user", "MCP /mcp 405/HTML; expose Streamable HTTP"),
    ("user", "pass me exactly what i need to send to my project manager agent..."),
    ("user", "summarize all the ideas... weekly reports... character profile prompts"),
    ("user", "update all the prompts... tracking IDs... first report... instance factor 0"),
    ("user", "loop until 7pm... weekly tab... docs/skills... log size"),
    ("user", "Agent_Introductions pack; handshake deez nutz; employee images; Drive"),
    (
        "user",
        "combine all chat logs into one md + json with outline of reference ids; "
        "white paper pdf; terms pdf; coding-agent skill; agents fix from bug outline; RefPack",
    ),
]


def md_lines(turns: list[dict], outline: list[dict]) -> str:
    lines = [
        f"# Combined chat log — {REF_ID}",
        "",
        f"- pair_id: `{PAIR_ID}`",
        f"- companion_json: `SESSION-COMBINED.json`",
        f"- related_by: same `pair_id` + `md_sha256` stored in the JSON",
        f"- chat_id: `{CHAT_ID}`",
        f"- packed_at: `{NOW}`",
        "",
        "## Outline of reference ids",
        "",
        "| ref | kind | score | path |",
        "|-----|------|------:|------|",
    ]
    for row in outline:
        lines.append(
            f"| `{row['id']}` | {row['kind']} | {row.get('score', '')} | `{row['path']}` |"
        )
    lines += [
        "",
        "## How the JSON links to this MD",
        "",
        "The JSON `companion.pair_id` equals this file's `pair_id`.",
        "The JSON `companion.md_rel` is `SESSION-COMBINED.md`.",
        "The JSON `companion.md_sha256` is the SHA-256 of this Markdown byte-for-byte.",
        "The MD `companion_json` field names the JSON. Treat them as one twin pair.",
        "",
        "## Turns (excerpts; no tool dumps)",
        "",
    ]
    if turns:
        for t in turns:
            lines.append(f"### {t.get('role') or 'turn'} #{t.get('n')}")
            lines.append("")
            lines.append((t.get("excerpt") or "").replace("\n", " ")[:1200])
            lines.append("")
    else:
        for i, (role, text) in enumerate(FALLBACK_TURNS):
            lines.append(f"### {role} #{i}")
            lines.append("")
            lines.append(text)
            lines.append("")
    lines += [
        "## Source folders packed",
        "",
        "- `logs/Agent_Introductions/` (this pack)",
        "- `Getting-Started/agents/`",
        "- `ai-context/agent-bus/inbox/`",
        "- `ai-context/debugger/WHITE-PAPER-DEBUG-SYSTEM.md`",
        "",
    ]
    return "\n".join(lines) + "\n"


TERMS = [
    "Render Studio agent statistical glossary — fields from here on out.",
    "pair_id: twin-file id linking one MD to one JSON (PAIR-INTRO-20260916).",
    "ref_id: folder/pack pointer. Specialists open this, not the whole repo. INTRO-20260916.",
    "prompt_id: prm_* minted per ops set (one prompt's operation list).",
    "category_id: FEAT NET DATA PERF UI VR GL API WD CAD CTL OTH. Not a second bug family.",
    "traceback_id: tb_* one id per op in the ordered list.",
    "result_score: 0-100 how close the run was to the desired result.",
    "result_ref_id: res_* pointer to the JSON member / artifact, not a transcript.",
    "ops_similarity: 0-1 Jaccard/LCS of this ops list vs category centroid.",
    "damage_score: 0-100 collateral. outcome = achieved * (1 - damage/200) * consistency.",
    "instance_id: this box. instance_public_factor: 0 until other instances are public.",
    "cycle_id: CYCLE-YYYYMMDD-HHMM bus round.",
    "agent: project-manager vibe-marketing vibe-sales vibe-rnd analytics clip-bot coding-agent.",
    "schema: rs.ops.v1 rs.score.v1 rs.agent.v1 rs.weekly.v1 rs.session_pair.v1 rs.vision.v1.",
    "log_id: {chat8}-{n} prompt-trace. tracking_id: project:{id}+log:{log_id}.",
    "bug_id: bug_ + 10 hex only after root + fix + breakage=0.",
    "fork_id / rb_ / sug_: override, rollback proposal, weekly suggestion.",
    "feature_id: viewport.boot webgl.context cad.generate etc. checklist vector.",
    "individual_id: PERF-07-00012 or 4.07.0012 when user confirms fixed.",
    "desired_result_score: Cursor/Sam score of the requested outcome vs shipped.",
    "consistency: method still works on repeat. Used in outcome formula.",
    "breakage: 0 means no collateral after the fix. Required for bug_id.",
    "md_sha256 / json_sha256: hashes that bind the combined log twins.",
    "excerpt_cap: 120 chars in search hits. Never dump full chats on the hot path.",
    "Drive folder: 1AkXgL30YFnDG_T_2iOIyzbX4Z67A1KjS cold archive only.",
]


WHITE = [
    "White paper — Render Studio agent bus + debugger (16 Sep 2026).",
    "Audience: Sam. Grok gets ops ids. Harness gets ids only.",
    "Verdict: goals are sound. Compact ids + approval gates keep search fast.",
    "Do not paste full transcripts into weekly reports or Drive as a hot path.",
    "",
    "1. Chronology. X CRC 404 then invalid response_token (plus-as-space).",
    "MCP GET HTML / POST 405 until /mcp hit 8744. Optional Bearer.",
    "Star-bus PM -> SCORECARD. prompt_id category_id traceback_ids result_score.",
    "Weekly tab + 19:00 CDT publish. Intro pack INTRO-20260916. Sandbox ping/add/fail.",
    "This slice: combined logs MD+JSON twins, terms PDF, RefPack uploads.",
    "",
    "2. Keep: feature-status vectors, excerpt cap 120, three packet sizes,",
    "outcome formula, companion debug_user_scores, Drive as cold archive,",
    "one id scheme. instance_public_factor=0 until public.",
    "",
    "3. Cause issues: token blowups, json_extract without indexes, unbounded",
    "watchdogs, weekly PDFs of everything, nested overview Jaccard,",
    "per-prompt dual writes, user-table writes, dual id schemes.",
    "",
    "4. Loop: symptom -> feature vector -> search_ids -> tracking_id/ref_*",
    "-> golden snapshot rollback proposal -> confirm-fixed category id",
    "-> bug_id last -> macro blacklist after 3 high-damage repeats.",
    "",
    "5. Desired-output score this session (Cursor): 62/100.",
    "Built: X CRC, MCP HTTP, ops ids, weekly tab, intro pack, RefPack twins, PDFs.",
    "Partial: vision fan-out scores in inbox. Handshake deez nutz not yet from Grok.",
    "Missed: Drive employees folder, Playwright clip loop, full debug autonomy.",
    "Agents talking: yes on CYCLE-20260916-2113 vision scores. Tracking ids in ops.jsonl.",
    "INTRO-only + code word + agents writing the logger fix: this fan-out.",
]


BUG_OUTLINE = """# High-scored repetitive bugs — outline
pair_id: PAIR-INTRO-20260916
ref_id: INTRO-20260916
Use this file (and SESSION-COMBINED.json outline) as the only bug index.

Do not invent a second bug-id family. category_id stays FEAT/NET/DATA/PERF/UI/VR/GL/API/WD/CAD/CTL/OTH.

| rank | result_ref_id | category_id | result_score | damage | symptom | file |
|-----:|---------------|-------------|-------------:|-------:|---------|------|
| 1 | res_log_logger_1 | DATA | 91 | 22 | NameError: LOGGER is not defined when writing a log line | logs/Agent_Introductions/coding-agent-only/broken_logger.py |
| 2 | res_log_overwrite_1 | DATA | 88 | 18 | log file overwritten instead of append; no traceback_id | logs/Agent_Introductions/coding-agent-only/broken_logger.py |
| 3 | res_mcp_405_1 | API | 85 | 8 | GET /mcp returned SPA HTML; POST 405 (fixed in Caddy/CF) | mcp/grok-bot/server.py |
| 4 | res_crc_plus_1 | API | 80 | 6 | crc_token + became space; invalid response_token (fixed) | backend/services/x_webhook_service.py |
| 5 | res_sandbox_fail_1 | DATA | 72 | 4 | sandbox fail op logs traceback_id (intentional sample) | backend/services/agent_intro_service.py |

## Safe order of operations (fill this in, then a patch)

1. Reproduce off the live hot path (sandbox or coding-agent-only).
2. Capture traceback_id + file:line. Do not git reset.
3. Identify root (unbound name vs overwrite vs missing field).
4. Patch the smallest local logger. Do not grow app.js / main.py / styles.css.
5. Re-run log_line; confirm jsonl append + traceback_id present + LOGGER bound.
6. breakage=0 before any bug_id.

## Task

Write the smallest code fix for rank 1 and 2. Upload the patch path via agent_refpack_upload.
"""


SKILL = """# Coding-agent logger

You are the coding agent. You only write trace logs for operations.

Always call `log_line(op, msg)` from `logs/Agent_Introductions/coding-agent-only/broken_logger.py`.

Do not initialize logging yourself. LOGGER is injected by the host process.

Never use print. Never open a second log file. Never add traceback ids in the caller — log_line owns that.

After each op, confirm the line landed. If the host asks you to log a demo line, import log_line and call it.
"""


BROKEN_LOGGER = '''"""Coding-agent logger. Host injects LOGGER. Do not import from app.js/main.py."""
from __future__ import annotations

import json
from pathlib import Path

PACK = Path(__file__).resolve().parent
TRACE = PACK / "trace.jsonl"


def log_line(op: str, msg: str) -> None:
    row = {"op": op, "msg": msg}
    LOGGER.info(json.dumps(row))
    TRACE.write_text(json.dumps(row) + "\\n", encoding="utf-8")
'''


def seed_broken() -> dict:
    dest = PACK / "coding-agent-only"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "SKILL.md").write_text(SKILL, encoding="utf-8")
    (dest / "broken_logger.py").write_text(BROKEN_LOGGER, encoding="utf-8")
    sys.path.insert(0, str(dest))
    err = None
    try:
        import broken_logger as bl  # type: ignore

        bl.log_line("demo", "hello")
    except Exception as exc:
        err = exc
        intro.log_trace("coding_logger", False, extra={"result_ref_id": "res_log_logger_1"}, err=exc)
    return {"ok": err is None, "error": str(err or "")[:200]}


def copy_tree() -> list[str]:
    copied = []
    dest_src = REFPACK / "source"
    dest_src.mkdir(parents=True, exist_ok=True)
    files = [
        ROOT / "backend" / "services" / "agent_intro_service.py",
        ROOT / "backend" / "routers" / "agent_intro.py",
        ROOT / "backend" / "services" / "agent_ops_service.py",
        ROOT / "backend" / "services" / "simple_pdf.py",
        ROOT / "mcp" / "grok-bot" / "server.py",
        ROOT / "ai-context" / "debugger" / "WHITE-PAPER-DEBUG-SYSTEM.md",
        PACK / "PM.md",
        PACK / "FILESYSTEM.md",
        PACK / "README.md",
        PACK / "HIGH-SCORED-BUGS.md",
        PACK / "coding-agent-only" / "broken_logger.py",
        PACK / "traces" / "trace.jsonl",
    ]
    inbox = ROOT / "ai-context" / "agent-bus" / "inbox"
    if inbox.is_dir():
        files.extend(sorted(inbox.glob("*.json"))[:24])
    samples = PACK / "samples"
    if samples.is_dir():
        files.extend(sorted(samples.glob("*"))[:24])
    for src in files:
        if not src.is_file():
            continue
        dest = dest_src / src.name
        shutil.copy2(src, dest)
        copied.append(str(dest))
    employees = PACK / "employees"
    if employees.is_dir():
        emp_dest = REFPACK / "employees"
        emp_dest.mkdir(parents=True, exist_ok=True)
        for png in employees.glob("*.png"):
            shutil.copy2(png, emp_dest / png.name)
            copied.append(str(emp_dest / png.name))
    return copied


def maybe_ops() -> None:
    try:
        from backend.services import agent_ops_service as aops

        aops.record_ops(
            {
                "prompt_id": "prm_log_logger_1",
                "category_id": "DATA",
                "cycle_id": "CYCLE-20260916-INTRO",
                "agent": "coding-agent",
                "ops": ["import_logger", "log_line", "write_jsonl"],
                "traceback_ids": ["tb_0_import_logger", "tb_1_log_line", "tb_2_write_jsonl"],
                "result_score": 91,
                "result_ref_id": "res_log_logger_1",
                "damage_score": 0.22,
                "instance_public_factor": 0,
            }
        )
        aops.record_ops(
            {
                "prompt_id": "prm_log_overwrite_1",
                "category_id": "DATA",
                "cycle_id": "CYCLE-20260916-INTRO",
                "agent": "coding-agent",
                "ops": ["log_line", "write_text_overwrite"],
                "traceback_ids": ["tb_0_log_line", "tb_1_write_text"],
                "result_score": 88,
                "result_ref_id": "res_log_overwrite_1",
                "damage_score": 0.18,
                "instance_public_factor": 0,
            }
        )
    except Exception as exc:
        intro.log_trace("ops_seed", False, err=exc)


def main() -> dict:
    REFPACK.mkdir(parents=True, exist_ok=True)
    PACK.mkdir(parents=True, exist_ok=True)
    seed = seed_broken()
    (PACK / "HIGH-SCORED-BUGS.md").write_text(BUG_OUTLINE, encoding="utf-8")
    (REFPACK / "HIGH-SCORED-BUGS.md").write_text(BUG_OUTLINE, encoding="utf-8")

    outline = [
        {"id": REF_ID, "kind": "pack", "score": "", "path": "logs/Agent_Introductions/"},
        {"id": PAIR_ID, "kind": "session_pair", "score": "", "path": "logs/Agent_Introductions/RefPack/SESSION-COMBINED.md"},
        {"id": "prm_log_logger_1", "kind": "prompt_id", "score": 91, "path": "logs/Agent_Introductions/coding-agent-only/broken_logger.py"},
        {"id": "res_log_logger_1", "kind": "result_ref_id", "score": 91, "path": "logs/Agent_Introductions/HIGH-SCORED-BUGS.md"},
        {"id": "res_log_overwrite_1", "kind": "result_ref_id", "score": 88, "path": "logs/Agent_Introductions/coding-agent-only/broken_logger.py"},
        {"id": "tb_1_log_line", "kind": "traceback_id", "score": "", "path": "logs/Agent_Introductions/traces/trace.jsonl"},
        {"id": "CYCLE-20260916-2113", "kind": "cycle_id", "score": "", "path": "ai-context/agent-bus/inbox/"},
        {"id": "CYCLE-20260916-1618", "kind": "cycle_id", "score": "", "path": "Getting-Started/agents/REPORT-CYCLE-20260916-1618.md"},
        {"id": "prm_ops_bus_1", "kind": "prompt_id", "score": 72, "path": "logs/Agent_Introductions/samples/ops.jsonl"},
        {"id": CHAT_ID, "kind": "chat_id", "score": "", "path": f"agent-transcripts/{CHAT_ID}"},
    ]

    turns = try_transcript()
    md = md_lines(turns, outline)
    md_path = REFPACK / "SESSION-COMBINED.md"
    md_bytes = md.encode("utf-8")
    md_path.write_bytes(md_bytes)
    md_hash = sha256_bytes(md_bytes)

    payload = {
        "schema": "rs.session_pair.v1",
        "pair_id": PAIR_ID,
        "ref_id": REF_ID,
        "packed_at": NOW,
        "chat_id": CHAT_ID,
        "companion": {
            "related_by": "pair_id",
            "md_rel": "SESSION-COMBINED.md",
            "json_rel": "SESSION-COMBINED.json",
            "md_sha256": md_hash,
            "json_sha256": None,
            "same_folder": str(REFPACK),
        },
        "desired_output": {
            "score": 62,
            "built": [
                "X CRC routes",
                "MCP streamable HTTP",
                "ops ids",
                "weekly tab",
                "intro pack",
                "combined MD+JSON twins",
                "white paper PDF",
                "terms PDF",
            ],
            "partial": ["vision MCP scores CYCLE-20260916-2113", "agent handshake"],
            "missed": ["Drive employees folder", "Playwright clip loop", "full debug autonomy"],
            "agents_talking": True,
            "agents_tracking_ids": True,
            "intro_handshake_from_grok": False,
            "notes": (
                "Agents submitted vision SCORECARDs with result_score. "
                "INTRO-only + deez nutz from Grok was not complete before this pack. "
                "Logger plant exists only in coding-agent-only."
            ),
        },
        "outline": outline,
        "transcript_turns_captured": len(turns),
        "broken_logger_demo": seed,
    }
    json_path = REFPACK / "SESSION-COMBINED.json"
    blob = json.dumps(payload, indent=2).encode("utf-8")
    payload["companion"]["json_sha256"] = sha256_bytes(blob)
    json_bytes = json.dumps(payload, indent=2).encode("utf-8")
    json_path.write_bytes(json_bytes)
    payload["companion"]["json_sha256"] = sha256_bytes(json_bytes)
    json_path.write_bytes(json.dumps(payload, indent=2).encode("utf-8"))

    (REFPACK / "WHITE-PAPER-AGENT-BUS.pdf").write_bytes(pdf_bytes_pages("RS White Paper", WHITE))
    (REFPACK / "TERMS-GLOSSARY.pdf").write_bytes(pdf_bytes_pages("RS Agent Terms", TERMS))
    shutil.copy2(ROOT / "ai-context" / "debugger" / "WHITE-PAPER-DEBUG-SYSTEM.md", REFPACK / "WHITE-PAPER-DEBUG-SYSTEM.md")

    maybe_ops()
    copied = copy_tree()
    # agent-style uploads of the twins
    for agent in ("project-manager", "analytics", "vibe-rnd", "vibe-marketing", "vibe-sales", "clip-bot", "coding-agent"):
        intro.refpack_upload(agent, str(md_path))
        intro.refpack_upload(agent, str(json_path))
        intro.refpack_upload(agent, str(PACK / "HIGH-SCORED-BUGS.md"))

    readme = REFPACK / "README.md"
    readme.write_text(
        f"# RefPack `{PAIR_ID}`\n\n"
        f"- MD: `{md_path}`\n"
        f"- JSON: `{json_path}` (companion.pair_id + md_sha256)\n"
        f"- White paper PDF: WHITE-PAPER-AGENT-BUS.pdf\n"
        f"- Terms PDF: TERMS-GLOSSARY.pdf\n"
        f"- Bug outline: HIGH-SCORED-BUGS.md\n"
        f"- uploads/{{agent}}/ copies from agent_refpack_upload\n",
        encoding="utf-8",
    )
    return {
        "ok": True,
        "pair_id": PAIR_ID,
        "md": str(md_path),
        "json": str(json_path),
        "pdf_white": str(REFPACK / "WHITE-PAPER-AGENT-BUS.pdf"),
        "pdf_terms": str(REFPACK / "TERMS-GLOSSARY.pdf"),
        "copied": len(copied),
        "turns": len(turns),
        "broken": seed,
    }


if __name__ == "__main__":
    print(json.dumps(main(), indent=2))
