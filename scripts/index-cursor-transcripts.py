#!/usr/bin/env python3
"""Cheap Cursor transcript indexer — no LLM. Writes MD + JSON + CSV cheat sheets.

Usage:
  python3 scripts/index-cursor-transcripts.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import cursor_transcript_index as cti

PROJECTS = Path.home() / ".cursor" / "projects"
OUT = ROOT / "data" / "prompt-trace"
BROKE_RE = re.compile(
    r"\b(broke|broken|break(s|ing)?|crash(ed|es|ing)?|regress(ion|ed)?|"
    r"doesn'?t work|does not work|still (broken|failing)|you broke|"
    r"leak|spike|syntaxerror|typeerror|failed|fix this|undo that)\b",
    re.I,
)
IMPROVE_RE = re.compile(
    r"\b(works|working|nice|good|ship it|keep going|next|also add|now add|"
    r"looks good|perfect|thanks)\b",
    re.I,
)
SKIP_RE = re.compile(
    r"^(Briefly inform the user about the task result|"
    r"<dynamic_tools>|You have access to tools through dynamic namespaces|"
    r"You are an AI coding assistant)",
    re.I,
)
SECRET_RE = re.compile(
    r"(Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,}|"
    r"GROK_MUSIC_API_KEY=\S+|GROK_MCP_TOKEN=\S+|password=\S+)",
    re.I,
)
CATEGORIES = [
    ("vr-xr", r"\b(vr|webxr|quest|headset|hand.?track|xr)\b"),
    ("video-editor", r"video editor|bake|timeline|screen record|clip"),
    ("debugger", r"debugger|memory leak|spike|foundry record"),
    ("cad-generate", r"\b(cad|freecad|step\b|generate|fusion|onshape)\b"),
    ("marketing-grok", r"\b(grok|marketing|youtube music|tweet|x post)\b"),
    ("auth-billing", r"\b(stripe|billing|login|oauth|paypal)\b"),
    ("marketplace", r"marketplace"),
    ("robotics", r"\b(robot|urdf|ros|bambu)\b"),
    ("admin", r"admin dashboard|management dashboard"),
    ("ui-frontend", r"\b(css|layout|frontend|ui|toolbar)\b"),
    ("prompt-trace", r"prompt.?trace|chat history|google drive"),
]
PROJECT_HINTS = [
    ("render-studio", r"render.?studio|render3d|viewport|foundry"),
    ("mycelium", r"mycelium"),
    ("motors", r"\bmotors?\b"),
    ("ahm", r"\bahm\b|arkansas"),
    ("crash-report-sorter", r"crash.?report|snipe.?bot"),
]


def redact(text: str) -> str:
    return SECRET_RE.sub("[redacted]", text or "")


def extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if "text" in content:
            return str(content.get("text") or "")
        if isinstance(content.get("content"), list):
            return extract_text(content["content"])
        return str(content.get("text") or content.get("content") or "")
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") in {"text", "input_text"}:
                parts.append(str(item.get("text") or ""))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return ""


def user_query(text: str) -> str:
    m = re.search(r"<user_query>\s*([\s\S]*?)\s*</user_query>", text)
    if m:
        return m.group(1).strip()
    return re.sub(r"<timestamp>.*?</timestamp>", "", text, flags=re.S).strip()


def first_line(text: str, n: int = 120) -> str:
    t = re.sub(r"\s+", " ", redact(text)).strip()
    return t[: min(int(n or 120), 120)]


def classify(text: str) -> list[str]:
    hits = [name for name, pat in CATEGORIES if re.search(pat, text, re.I)]
    return hits or ["uncategorized"]


def project_from(path: Path, text: str) -> str:
    blob = f"{path} {text}".lower()
    for name, pat in PROJECT_HINTS:
        if re.search(pat, blob):
            return name
    if "Render-Studio" in str(path) or "render-studio" in blob:
        return "render-studio"
    if str(path).endswith("Users-sam") or "/Users-sam/" in str(path):
        return "home-workspace"
    return "other"


def parse_ts(text: str, mtime: float) -> str:
    m = re.search(r"<timestamp>(.*?)</timestamp>", text)
    if m:
        return m.group(1).strip()
    return datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()


def iter_chats():
    return cti.iter_transcript_files()


def load_prompts(path: Path) -> list[dict]:
    return cti.load_prompts(path)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    all_rows: list[dict] = []
    by_project: dict[str, list[dict]] = defaultdict(list)
    by_cat: dict[str, list[dict]] = defaultdict(list)
    chats = 0
    for path in sorted(iter_chats()):
        chats += 1
        for row in load_prompts(path):
            all_rows.append(row)
            by_project[row["project"]].append(row)
            for cat in row["categories"]:
                by_cat[cat].append(row)

    (OUT / "prompts.json").write_text(json.dumps(all_rows, indent=2) + "\n", encoding="utf-8")
    with (OUT / "prompts.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(
            fh,
            fieldnames=[
                "log_id",
                "chat_id",
                "prompt_index",
                "timestamp",
                "project",
                "categories",
                "result",
                "blamed_log_id",
                "last3_log_ids",
                "prompt",
            ],
        )
        w.writeheader()
        for row in all_rows:
            w.writerow(
                {
                    **{k: row.get(k) or "" for k in ["log_id", "chat_id", "prompt_index", "timestamp", "project", "result", "blamed_log_id", "prompt"]},
                    "categories": "|".join(row.get("categories") or []),
                    "last3_log_ids": "|".join(row.get("last3_log_ids") or []),
                }
            )

    results = Counter(r.get("result") for r in all_rows)
    md = [
        "# Cursor prompt cheat sheet",
        "",
        f"Indexed {len(all_rows)} user prompts in {chats} chats (parent transcripts only, no LLM pass).",
        f"Generated {datetime.now(timezone.utc).isoformat()}.",
        "",
        "Use a `log_id` when something is broken: the next prompt should name the blamed prior id from `last3_log_ids`.",
        "",
        "## Result totals",
        "",
        *[f"- `{k}`: {v}" for k, v in results.most_common()],
        "",
        "## Categories (example prompts)",
        "",
    ]
    for cat, rows in sorted(by_cat.items(), key=lambda x: -len(x[1])):
        md.append(f"### {cat} ({len(rows)})")
        md.append("")
        for row in rows[:8]:
            md.append(f"- `{row['log_id']}` [{row['project']}] {row['result']}: {str(row.get('excerpt') or row.get('prompt') or '')[:120]}")
        md.append("")
    md += ["## Projects", ""]
    for proj, rows in sorted(by_project.items(), key=lambda x: -len(x[1])):
        md.append(f"- **{proj}**: {len(rows)} prompts, {sum(1 for r in rows if r.get('result')=='broke')} blamed-as-broke")
    (OUT / "CHEATSHEET.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    readme = [
        "# Development steps by project",
        "",
        "Readable outline of Cursor chats. Machine copy: `prompts.json` / `prompts.csv`.",
        "Raw jsonl stays on disk under `~/.cursor/projects/*/agent-transcripts/` and on Google Drive.",
        "",
        "Do **not** delete local chats. This folder is a backup index.",
        "",
    ]
    proj_dir = OUT / "projects"
    proj_dir.mkdir(exist_ok=True)
    for proj, rows in sorted(by_project.items()):
        days = defaultdict(list)
        for row in rows:
            day = str(row.get("timestamp") or "")[:10] or "unknown"
            days[day].append(row)
        body = [f"# {proj}", "", f"{len(rows)} prompts.", ""]
        for day, items in sorted(days.items()):
            body.append(f"## {day}")
            body.append("")
            for row in items:
                blame = f" ← blamed `{row['blamed_log_id']}`" if row.get("blamed_log_id") else ""
                body.append(f"- `{row['log_id']}` **{row['result']}**{blame} — {row['prompt']}")
            body.append("")
        (proj_dir / f"{proj}.md").write_text("\n".join(body) + "\n", encoding="utf-8")
        readme.append(f"- [{proj}](projects/{proj}.md) — {len(rows)} prompts")
    readme += [
        "",
        "## If we get stumped",
        "",
        "1. Search `CHEATSHEET.md` / `prompts.csv` for the feature.",
        "2. Open the `chat_id` jsonl for the traceback.",
        "3. POST `/api/prompt-trace/prompts` with `result=broke` and `blamed_log_id`.",
        "",
    ]
    (OUT / "README.md").write_text("\n".join(readme) + "\n", encoding="utf-8")
    cov = cti.coverage(indexed=all_rows)
    (OUT / "coverage.json").write_text(json.dumps(cov, indent=2) + "\n", encoding="utf-8")
    cti.print_coverage(cov)
    print(f"wrote {len(all_rows)} prompts from {chats} chats -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
