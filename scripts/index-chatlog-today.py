#!/usr/bin/env python3
"""Index today's chat/bus logs. Fast: mtime-today only. prm_rnd_index_1."""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import date
from pathlib import Path

ROOT = Path("/Users/sam/Render-Studio")
OUT_JSON = ROOT / "frontend/docs/media/results-20260916.json"
OUT_SQL = ROOT / "frontend/docs/media/results-20260916.sqlite"
TODAY = date(2026, 9, 16)
SOURCES = [
    ROOT / "ai-context/agent-bus",
    ROOT / "data/prompt-trace/live-prompts.jsonl",
    Path("/Users/sam/.cursor/projects/Users-sam/agent-transcripts/fef1369a-66e7-42a3-bf4d-6ef390ab3f90"),
]


def today(p: Path) -> bool:
    try:
        return date.fromtimestamp(p.stat().st_mtime) == TODAY
    except OSError:
        return False


def walk(root: Path):
    if root.is_file():
        if today(root):
            yield root
        return
    if not root.is_dir():
        return
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            it = d.iterdir()
        except OSError:
            continue
        for p in it:
            if p.is_dir():
                stack.append(p)
            elif p.suffix in {".json", ".jsonl", ".md"} and today(p):
                yield p


def row_from(path: Path, obj: dict | None, line_no: int) -> dict:
    o = obj or {}
    return {
        "path": str(path.relative_to(ROOT) if str(path).startswith(str(ROOT)) else path),
        "line": line_no,
        "agent": o.get("agent") or o.get("from") or "",
        "chat_id": o.get("chat_id") or o.get("conv_id") or o.get("cycle_id") or "",
        "instance_id": o.get("instance_id") or "501",
        "group_id": o.get("group") or o.get("kind") or "",
        "cycle_id": o.get("cycle_id") or "",
        "model": o.get("model") or "",
        "tweet_id": o.get("tweet_id") or o.get("id") if o.get("posted") else "",
        "result_score": o.get("result_score") or o.get("score") or "",
        "prompt_id": o.get("prompt_id") or "",
        "ts": o.get("ts") or o.get("timestamp") or "",
    }


def main() -> None:
    rows = []
    for src in SOURCES:
        for path in walk(src):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if path.suffix == ".jsonl":
                for i, line in enumerate(text.splitlines(), 1):
                    if not line.strip():
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        obj = {"raw": line[:120]}
                    rows.append(row_from(path, obj if isinstance(obj, dict) else {}, i))
            elif path.suffix == ".json":
                try:
                    obj = json.loads(text)
                except json.JSONDecodeError:
                    obj = {}
                rows.append(row_from(path, obj if isinstance(obj, dict) else {}, 1))
            else:
                rows.append(row_from(path, {"group": "md"}, 1))
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "day": str(TODAY),
        "count": len(rows),
        "forgot_then_added": ["instance_id", "group_id", "chat_id", "model", "tweet_id", "cycle_id"],
        "hire": "qa-verify",
        "indexed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "rows": rows[:5000],
    }
    OUT_JSON.write_text(json.dumps(payload), encoding="utf-8")
    if OUT_SQL.exists():
        OUT_SQL.unlink()
    con = sqlite3.connect(OUT_SQL)
    con.execute(
        "CREATE TABLE logs (path TEXT, line INT, agent TEXT, chat_id TEXT, instance_id TEXT, group_id TEXT, cycle_id TEXT, model TEXT, tweet_id TEXT, result_score TEXT, prompt_id TEXT, ts TEXT)"
    )
    con.executemany(
        "INSERT INTO logs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                r["path"],
                r["line"],
                r["agent"],
                r["chat_id"],
                r["instance_id"],
                r["group_id"],
                r["cycle_id"],
                r["model"],
                r["tweet_id"],
                str(r["result_score"]),
                r["prompt_id"],
                r["ts"],
            )
            for r in rows
        ],
    )
    con.commit()
    con.close()
    print(json.dumps({"ok": True, "count": len(rows), "json": str(OUT_JSON), "sqlite": str(OUT_SQL)}))


if __name__ == "__main__":
    main()
