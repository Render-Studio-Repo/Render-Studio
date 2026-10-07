"""Cheap Cursor transcript index — no LLM. Excerpt cap 120. No secret files."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

EXCERPT_CAP = 120
HOME_PROJECTS = Path.home() / ".cursor" / "projects"
SECRET_NAME_RE = re.compile(r"(\.env$|\.env\.|credentials|secrets?)", re.I)
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

_DISK_CACHE: dict[str, Any] = {"sig": None, "rows": []}


def excerpt(text: Any, cap: int = EXCERPT_CAP) -> str:
    t = SECRET_RE.sub("[redacted]", re.sub(r"\s+", " ", str(text or "")).strip())
    return t[: max(1, min(int(cap or EXCERPT_CAP), EXCERPT_CAP))]


def redact(text: str) -> str:
    return SECRET_RE.sub("[redacted]", text or "")


def is_secret_path(path: Path | str) -> bool:
    return any(SECRET_NAME_RE.search(part) for part in Path(path).parts)


def transcript_roots(extra: Iterable[Path | str] | None = None) -> list[Path]:
    roots: list[Path] = []
    raw: list[str] = []
    if extra:
        raw.extend(str(p) for p in extra)
    if "CURSOR_TRANSCRIPT_ROOTS" in os.environ:
        raw.extend(p.strip() for p in os.environ.get("CURSOR_TRANSCRIPT_ROOTS", "").split(os.pathsep) if p.strip())
        for item in raw:
            path = Path(item).expanduser()
            if path.is_dir() and path not in roots:
                roots.append(path)
        return roots
    if HOME_PROJECTS.is_dir():
        for child in sorted(HOME_PROJECTS.iterdir()):
            at = child / "agent-transcripts"
            if at.is_dir():
                roots.append(at)
    for name in ("Users-sam-Render-Studio", "Users-sam-Documents-Render-Studio"):
        at = HOME_PROJECTS / name / "agent-transcripts"
        if at.is_dir() and at not in roots:
            roots.append(at)
    for item in raw:
        path = Path(item).expanduser()
        if path.is_dir() and path not in roots:
            roots.append(path)
    return roots


def iter_transcript_files(roots: Iterable[Path] | None = None) -> list[Path]:
    """All jsonl under transcript roots, including nested chats + subagents. Skip secrets."""
    found: list[Path] = []
    seen: set[Path] = set()
    for root in list(roots or transcript_roots()):
        if not root.is_dir():
            continue
        for jsonl in sorted(root.rglob("*.jsonl")):
            if is_secret_path(jsonl):
                continue
            resolved = jsonl.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            found.append(jsonl)
    return found


def extract_text(content: Any) -> str:
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


def load_prompts(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return rows
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = 0
    chat_id = path.stem
    idx = 0
    for line in lines:
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        role = obj.get("role") or (obj.get("message") or {}).get("role")
        if role != "user":
            continue
        msg = obj.get("message") or obj
        text = user_query(extract_text(msg.get("content")))
        if not text or SKIP_RE.search(text.strip()):
            continue
        if text.strip().startswith("<dynamic_tools>") or "GetDynamicTools" in text[:200]:
            continue
        idx += 1
        rows.append(
            {
                "log_id": f"{chat_id[:8]}-{idx:03d}",
                "chat_id": chat_id,
                "prompt_index": idx,
                "timestamp": parse_ts(text, mtime),
                "project": project_from(path, text),
                "categories": classify(text),
                "prompt": excerpt(text, EXCERPT_CAP),
                "excerpt": excerpt(text, EXCERPT_CAP),
                "broke_signal": bool(BROKE_RE.search(text)),
                "path": str(path),
            }
        )
    for i, row in enumerate(rows):
        nxt = rows[i + 1] if i + 1 < len(rows) else None
        if nxt and nxt["broke_signal"]:
            row["result"] = "broke"
            nxt["blamed_log_id"] = row["log_id"]
        elif nxt and IMPROVE_RE.search(nxt["prompt"]) and not nxt["broke_signal"]:
            row["result"] = "improved"
        elif nxt:
            row["result"] = "continued"
        else:
            row["result"] = "unknown"
        last3 = [r["log_id"] for r in rows[max(0, i - 3) : i]]
        row["last3_log_ids"] = last3
        if row["broke_signal"] and last3:
            row.setdefault("blamed_log_id", last3[-1])
    return rows


def indexed_paths(rows: Iterable[dict[str, Any]] | None = None) -> set[str]:
    out: set[str] = set()
    for row in rows or []:
        path = str(row.get("path") or "").strip()
        if not path:
            continue
        try:
            out.add(str(Path(path).resolve()))
        except OSError:
            out.add(path)
    return out


def disk_prompts(*, roots: Iterable[Path] | None = None, only_missing: set[str] | None = None) -> list[dict[str, Any]]:
    files = iter_transcript_files(roots)
    sig = tuple((str(p), p.stat().st_mtime if p.is_file() else 0) for p in files)
    if only_missing is None and _DISK_CACHE.get("sig") == sig:
        return list(_DISK_CACHE.get("rows") or [])
    rows: list[dict[str, Any]] = []
    for path in files:
        resolved = str(path.resolve())
        if only_missing is not None and resolved in only_missing:
            continue
        rows.extend(load_prompts(path))
    if only_missing is None:
        _DISK_CACHE["sig"] = sig
        _DISK_CACHE["rows"] = rows
    return rows


def merge_missing(indexed: list[dict[str, Any]], *, roots: Iterable[Path] | None = None) -> list[dict[str, Any]]:
    have = indexed_paths(indexed)
    extra = disk_prompts(roots=roots, only_missing=have)
    return list(indexed) + extra


def coverage(*, indexed: list[dict[str, Any]] | None = None, roots: Iterable[Path] | None = None) -> dict[str, Any]:
    files = iter_transcript_files(roots)
    have = indexed_paths(indexed)
    disk_resolved = [str(p.resolve()) for p in files]
    missing = [p for p in disk_resolved if p not in have]
    served = set(have) | set(disk_resolved)
    return {
        "ok": True,
        "disk_count": len(disk_resolved),
        "indexed_count": len(have),
        "missing_count": len(missing),
        "served_count": len(served),
        "roots": [str(r) for r in (roots or transcript_roots())],
        "include_subagents": True,
        "excerpt_cap": EXCERPT_CAP,
        "auto_fire": False,
        "goal": "OPEN",
    }


def print_coverage(cov: dict[str, Any] | None = None) -> dict[str, Any]:
    row = cov or coverage()
    print(
        f"indexed_count={row.get('indexed_count')} disk_count={row.get('disk_count')} "
        f"missing_count={row.get('missing_count')} served_count={row.get('served_count')}"
    )
    return row
