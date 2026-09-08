"""Repository Governance — Secure Publish Policy Pack + Server Settings APIs."""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
GOV_DIR = ROOT / "repository-governance"
NOTES_DIR = GOV_DIR / "notes"
FEEDBACK_README = NOTES_DIR / "README.md"
OFF_LIMITS_PATH = GOV_DIR / "off-limits.yaml"
SAFEGUARD_NOTES_PATH = NOTES_DIR / "safeguard-notes.md"

ALLOWED_DOC_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,160}$")
SAFE_REL_PATH = re.compile(r"^(?:[A-Za-z0-9._-]+)(?:/[A-Za-z0-9._-]+)*$")

DOC_ORDER = [
    "README.md",
    "AGENT-PUSH-PROTOCOL.md",
    "PUSH-CHECKLIST.md",
    "publish-manifest.yaml",
    "fence.yaml",
    "off-limits.yaml",
    "secret-patterns.txt",
    "notes/README.md",
]

ALWAYS_FENCED = ["premium-features", "premium-features/**"]

SECTION_LOG_SUGGESTIONS: dict[str, list[dict[str, str]]] = {
    "server-settings": [
        {"id": "journal-render3d", "label": "render3d.service journal (last 200)", "command": "journalctl -u render3d -n 200 --no-pager"},
        {"id": "governance-gate", "label": "Repository Governance gate", "command": "python3 scripts/check-repository-governance.py"},
        {"id": "health", "label": "API health", "command": "curl -s http://127.0.0.1:8001/api/health"},
    ],
    "repository-governance": [
        {"id": "governance-gate", "label": "Repository Governance gate", "command": "python3 scripts/check-repository-governance.py"},
        {"id": "governance-staged", "label": "Staged-only gate", "command": "python3 scripts/check-repository-governance.py --staged"},
        {"id": "git-status", "label": "Git status (names only)", "command": "git status -sb"},
    ],
    "off-limits": [
        {"id": "off-limits-file", "label": "Current off-limits.yaml", "command": "sed -n '1,120p' repository-governance/off-limits.yaml"},
        {"id": "governance-gate", "label": "Repository Governance gate", "command": "python3 scripts/check-repository-governance.py"},
    ],
    "ai-keys": [
        {"id": "journal-render3d", "label": "render3d.service journal (last 200)", "command": "journalctl -u render3d -n 200 --no-pager"},
        {"id": "ai-errors", "label": "Recent AI/key errors in journal", "command": "journalctl -u render3d -n 400 --no-pager | rg -i 'ai.?key|platform.?key|credit|openai|anthropic|401|403|402' || true"},
    ],
    "default": [
        {"id": "journal-render3d", "label": "render3d.service journal (last 200)", "command": "journalctl -u render3d -n 200 --no-pager"},
        {"id": "governance-gate", "label": "Repository Governance gate", "command": "python3 scripts/check-repository-governance.py"},
        {"id": "health", "label": "API health", "command": "curl -s http://127.0.0.1:8001/api/health"},
    ],
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def pack_root() -> Path:
    return GOV_DIR


def ensure_pack_files() -> None:
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    if not FEEDBACK_README.is_file():
        FEEDBACK_README.write_text(
            "# Operator feedback\n\n| Votes | Count |\n|-------|------:|\n| 👍 Working well | 0 |\n| 👎 Needs work | 0 |\n\n## Latest sentiment\n\n_No votes yet._\n\n## Notes from operators\n\n_No notes yet._\n\n## Issue reports\n\n_No issue reports yet._\n",
            encoding="utf-8",
        )
    if not OFF_LIMITS_PATH.is_file():
        OFF_LIMITS_PATH.write_text(
            "version: 1\nupdated_at: null\nupdated_by: null\npaths:\n  - premium-features/**\n",
            encoding="utf-8",
        )
    if not SAFEGUARD_NOTES_PATH.is_file():
        SAFEGUARD_NOTES_PATH.write_text(
            "# Safeguard notes\n\nOperator notes and generated safeguarding instructions from Server Settings.\n",
            encoding="utf-8",
        )


def list_documents() -> list[dict[str, Any]]:
    ensure_pack_files()
    docs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for name in DOC_ORDER:
        path = GOV_DIR / name
        if path.is_file():
            docs.append(_doc_meta(path, rel=name))
            seen.add(name)
    for path in sorted(GOV_DIR.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(GOV_DIR).as_posix()
        if rel in seen or path.name.startswith("."):
            continue
        if not ALLOWED_DOC_NAME.match(rel):
            continue
        docs.append(_doc_meta(path, rel=rel))
    return docs


def _doc_meta(path: Path, rel: str | None = None) -> dict[str, Any]:
    rel = rel or path.name
    stat = path.stat()
    return {
        "name": Path(rel).name,
        "rel": rel,
        "path": f"repository-governance/{rel}",
        "bytes": stat.st_size,
        "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "kind": _kind_for(path.name),
    }


def _kind_for(name: str) -> str:
    lower = name.lower()
    if lower.endswith((".md", ".markdown")):
        return "markdown"
    if lower.endswith((".yaml", ".yml")):
        return "yaml"
    if lower.endswith(".txt"):
        return "text"
    return "file"


def read_document(name: str) -> dict[str, Any]:
    ensure_pack_files()
    rel = (name or "").strip().lstrip("/")
    if not ALLOWED_DOC_NAME.match(rel):
        raise ValueError("Invalid document name")
    path = (GOV_DIR / rel).resolve()
    if not path.is_file() or not path.is_relative_to(GOV_DIR.resolve()):
        raise FileNotFoundError(rel)
    meta = _doc_meta(path, rel=rel)
    meta["content"] = path.read_text(encoding="utf-8")
    return meta


def _parse_off_limits_paths(text: str) -> list[str]:
    paths: list[str] = []
    in_paths = False
    for line in text.splitlines():
        raw = line.split("#", 1)[0].rstrip()
        s = raw.strip()
        if not s:
            continue
        if s.startswith("paths:"):
            in_paths = True
            continue
        if in_paths and s.endswith(":") and not s.startswith("-"):
            in_paths = False
            continue
        if in_paths and s.startswith("- "):
            item = s[2:].strip().strip('"').strip("'")
            if item:
                paths.append(item)
    return paths


def get_off_limits() -> dict[str, Any]:
    ensure_pack_files()
    text = OFF_LIMITS_PATH.read_text(encoding="utf-8")
    paths = _parse_off_limits_paths(text)
    # Always surface premium-features
    for required in ALWAYS_FENCED:
        if required not in paths:
            paths.insert(0, required)
    # de-dupe preserve order
    seen: set[str] = set()
    uniq: list[str] = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    updated_at = None
    updated_by = None
    for line in text.splitlines():
        if line.strip().startswith("updated_at:"):
            updated_at = line.split(":", 1)[1].strip() or None
            if updated_at in {"null", "None"}:
                updated_at = None
        if line.strip().startswith("updated_by:"):
            updated_by = line.split(":", 1)[1].strip() or None
            if updated_by in {"null", "None"}:
                updated_by = None
    return {
        "paths": uniq,
        "always_fenced": list(ALWAYS_FENCED),
        "updated_at": updated_at,
        "updated_by": updated_by,
        "file": "repository-governance/off-limits.yaml",
    }


def _validate_off_limit_path(path: str) -> str:
    p = (path or "").strip().replace("\\", "/").lstrip("./")
    if not p:
        raise ValueError("Path is required")
    if ".." in p.split("/"):
        raise ValueError("Path traversal is not allowed")
    if p.startswith("/") or re.match(r"^[A-Za-z]:", p):
        raise ValueError("Use repo-relative paths only")
    # Allow globs
    cleaned = p.replace("**", "x").replace("*", "x").replace("?", "x")
    if not SAFE_REL_PATH.match(cleaned.rstrip("/")) and cleaned not in {"x", "xx"}:
        # still allow simple glob forms like foo/** or *.pem
        if not re.match(r"^[A-Za-z0-9._*/?-]+$", p):
            raise ValueError(f"Unsafe path: {path}")
    return p


def set_off_limits(paths: list[str], *, updated_by: str | None = None) -> dict[str, Any]:
    ensure_pack_files()
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in paths or []:
        item = _validate_off_limit_path(str(raw))
        if item not in seen:
            seen.add(item)
            cleaned.append(item)
    for required in ALWAYS_FENCED:
        if required not in seen:
            cleaned.insert(0, required)
            seen.add(required)
    lines = [
        "# Operator-managed off-limits paths (Server Settings).",
        "# Merged into the publish fence at gate time. Safe to commit — lists paths only.",
        "",
        "version: 1",
        f"updated_at: {_now()}",
        f"updated_by: {json.dumps(updated_by or 'admin')}",
        "paths:",
    ]
    for p in cleaned:
        lines.append(f"  - {p}")
    lines.append("")
    OFF_LIMITS_PATH.write_text("\n".join(lines), encoding="utf-8")
    return get_off_limits()


def list_root_candidates(max_entries: int = 80) -> list[dict[str, Any]]:
    """List top-level folders/files admins can mark off-limits."""
    entries: list[dict[str, Any]] = []
    skip_names = {".git", ".venv", "myenv", "node_modules", "__pycache__"}
    try:
        children = sorted(ROOT.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError:
        return []
    for child in children:
        if child.name in skip_names or child.name.startswith("."):
            continue
        rel = child.name
        entries.append(
            {
                "path": rel + ("/**" if child.is_dir() else ""),
                "name": child.name,
                "kind": "dir" if child.is_dir() else "file",
                "locked": child.name == "premium-features",
            }
        )
        if len(entries) >= max_entries:
            break
    return entries


def configuration_summary() -> dict[str, Any]:
    ensure_pack_files()
    docs = list_documents()
    off = get_off_limits()
    feedback = get_feedback_summary()
    return {
        "enterprise_name": "Repository Governance",
        "also_known_as": [
            "Secure Publish Policy Pack",
            "Source Control Guardrails",
            "System Settings notes (legacy informal name)",
        ],
        "folder": "repository-governance/",
        "premium_folder": "premium-features/",
        "mode": "allowlist-first",
        "publish_goal": "Push engine/application code; never push premium-features or secrets",
        "documents": docs,
        "off_limits": off,
        "feedback": feedback,
        "gate_script": "scripts/check-repository-governance.py",
        "agent_entrypoint": "repository-governance/AGENT-PUSH-PROTOCOL.md",
        "defaults": {
            "ai_prompt_billing": "subscription",
            "note": "Studio prompts default to Render Studio subscription credits unless the user picks a personal/team key.",
        },
    }


def build_explain_context(extra_question: str | None = None) -> str:
    summary = configuration_summary()
    parts = [
        "You are explaining Render Studio Repository Governance (Secure Publish Policy Pack).",
        "Speak clearly for a super-admin. Do not invent secret values. Do not ask for API keys.",
        f"Enterprise name: {summary['enterprise_name']}",
        f"Folder: {summary['folder']}",
        f"Premium (never push): {summary['premium_folder']}",
        f"Mode: {summary['mode']}",
        f"Goal: {summary['publish_goal']}",
        f"Off-limits paths: {', '.join(summary['off_limits']['paths'])}",
        f"Documents: {', '.join(d.get('rel') or d['name'] for d in summary['documents'])}",
        f"Gate script: {summary['gate_script']}",
        "Agents must read the pack and run the gate before any git push.",
    ]
    try:
        readme = (GOV_DIR / "README.md").read_text(encoding="utf-8")[:3500]
        parts.append("--- README.md excerpt ---\n" + readme)
    except OSError:
        pass
    if extra_question:
        parts.append("Admin question:\n" + extra_question.strip()[:4000])
    return "\n\n".join(parts)


def build_safeguard_prompt(
    *,
    selected_paths: list[str],
    operator_prompt: str,
    generate_instructions: bool,
) -> str:
    paths = [_validate_off_limit_path(p) for p in (selected_paths or [])]
    prompt = (operator_prompt or "").strip()
    if generate_instructions:
        return (
            "Write clear safeguarding instructions for Render Studio Repository Governance.\n"
            "Output markdown only. Include: (1) what must stay off GitHub, (2) concrete "
            "off-limits path entries, (3) agent checklist bullets, (4) what IS safe to publish "
            "(engine code). Do not invent secrets.\n\n"
            f"Selected paths/folders:\n- "
            + ("\n- ".join(paths) if paths else "(none selected)")
            + f"\n\nOperator intent:\n{prompt or '(no extra prompt — use selected paths only)'}\n"
        )
    return prompt


def append_safeguard_note(
    *,
    title: str,
    body: str,
    selected_paths: list[str] | None = None,
    generated: bool = False,
    author: str | None = None,
) -> dict[str, Any]:
    ensure_pack_files()
    title_s = (title or "Safeguard note").strip()[:160] or "Safeguard note"
    body_s = (body or "").strip()
    if not body_s:
        raise ValueError("Note body is required")
    paths = []
    for p in selected_paths or []:
        try:
            paths.append(_validate_off_limit_path(str(p)))
        except ValueError:
            continue
    stamp = _now()
    block = [
        "",
        f"## {title_s}",
        f"- When: `{stamp}`",
        f"- Author: {author or 'admin'}",
        f"- Mode: {'generated-instructions' if generated else 'note-only'}",
    ]
    if paths:
        block.append("- Paths: " + ", ".join(f"`{p}`" for p in paths))
    block.append("")
    block.append(body_s)
    block.append("")
    with SAFEGUARD_NOTES_PATH.open("a", encoding="utf-8") as fh:
        fh.write("\n".join(block))
    return {
        "ok": True,
        "path": "repository-governance/notes/safeguard-notes.md",
        "title": title_s,
        "generated": generated,
        "mtime": stamp,
    }


def suggested_logs(section: str | None = None) -> list[dict[str, str]]:
    key = str(section or "default").strip().lower() or "default"
    if key not in SECTION_LOG_SUGGESTIONS:
        # fuzzy
        for cand in SECTION_LOG_SUGGESTIONS:
            if cand in key or key in cand:
                key = cand
                break
        else:
            key = "default"
    return list(SECTION_LOG_SUGGESTIONS[key])


def collect_log_snippets(log_ids: list[str], *, section: str | None = None, max_chars: int = 12000) -> list[dict[str, Any]]:
    suggestions = {row["id"]: row for row in suggested_logs(section)}
    # also allow any known id across sections
    for rows in SECTION_LOG_SUGGESTIONS.values():
        for row in rows:
            suggestions.setdefault(row["id"], row)
    out: list[dict[str, Any]] = []
    remaining = max_chars
    for lid in log_ids or []:
        row = suggestions.get(lid)
        if not row or remaining <= 0:
            continue
        cmd = row["command"]
        try:
            proc = subprocess.run(
                ["bash", "-lc", cmd],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                timeout=12,
            )
            text = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        except Exception as exc:
            text = f"(failed to collect: {exc})"
        text = text[-min(len(text), remaining) :]
        remaining -= len(text)
        out.append({"id": lid, "label": row["label"], "command": cmd, "excerpt": text})
    return out


def _parse_feedback_counts(text: str) -> tuple[int, int]:
    up = down = 0
    for line in text.splitlines():
        if "👍" in line or "Working well" in line:
            m = re.search(r"\|\s*(\d+)\s*\|", line)
            if m:
                up = int(m.group(1))
        if "👎" in line or "Needs work" in line:
            m = re.search(r"\|\s*(\d+)\s*\|", line)
            if m:
                down = int(m.group(1))
    return up, down


def get_feedback_summary() -> dict[str, Any]:
    ensure_pack_files()
    text = FEEDBACK_README.read_text(encoding="utf-8")
    up, down = _parse_feedback_counts(text)
    return {
        "path": "repository-governance/notes/README.md",
        "thumbs_up": up,
        "thumbs_down": down,
        "mtime": datetime.fromtimestamp(FEEDBACK_README.stat().st_mtime, tz=timezone.utc).isoformat(),
    }


def record_feedback_vote(
    *,
    vote: str,
    note: str | None = None,
    contact: str | None = None,
    author: str | None = None,
) -> dict[str, Any]:
    ensure_pack_files()
    v = str(vote or "").strip().lower()
    if v in {"up", "thumbsup", "👍", "yes", "good"}:
        v = "up"
    elif v in {"down", "thumbsdown", "👎", "no", "bad"}:
        v = "down"
    else:
        raise ValueError("vote must be up or down")
    text = FEEDBACK_README.read_text(encoding="utf-8")
    up, down = _parse_feedback_counts(text)
    if v == "up":
        up += 1
    else:
        down += 1

    # Rewrite counts table lines
    lines = text.splitlines()
    new_lines: list[str] = []
    for line in lines:
        if "Working well" in line:
            new_lines.append(f"| 👍 Working well | {up} |")
        elif "Needs work" in line:
            new_lines.append(f"| 👎 Needs work | {down} |")
        else:
            new_lines.append(line)
    text = "\n".join(new_lines)

    stamp = _now()
    sentiment = (
        f"## Latest sentiment\n\n"
        f"**{'👍 Working well' if v == 'up' else '👎 Needs work'}** — `{stamp}`"
        + (f" · {author}" if author else "")
        + "\n"
    )
    if "## Latest sentiment" in text:
        text = re.sub(
            r"## Latest sentiment\n\n.*?(?=\n## |\Z)",
            sentiment + "\n",
            text,
            count=1,
            flags=re.S,
        )
    else:
        text += "\n" + sentiment

    note_s = (note or "").strip()
    contact_s = (contact or "").strip()
    if note_s or contact_s:
        entry = f"\n### Note ({stamp})\n\n- Vote: {'👍' if v == 'up' else '👎'}\n"
        if author:
            entry += f"- Author: {author}\n"
        if contact_s:
            entry += f"- Contact: {contact_s}\n"
        if note_s:
            entry += f"\n{note_s}\n"
        if "## Notes from operators" in text:
            # Append before Issue reports if possible
            if "## Issue reports" in text:
                text = text.replace("## Issue reports", entry + "\n## Issue reports", 1)
            else:
                text += entry
        else:
            text += "\n## Notes from operators\n" + entry

    FEEDBACK_README.write_text(text.rstrip() + "\n", encoding="utf-8")
    return get_feedback_summary()


def record_issue_report(
    *,
    note: str,
    section: str | None = None,
    contact: str | None = None,
    log_ids: list[str] | None = None,
    include_log_excerpts: bool = True,
    author: str | None = None,
) -> dict[str, Any]:
    ensure_pack_files()
    note_s = (note or "").strip()
    if not note_s:
        raise ValueError("Issue note is required")
    section_s = (section or "server-settings").strip() or "server-settings"
    suggestions = suggested_logs(section_s)
    logs = collect_log_snippets(log_ids or [s["id"] for s in suggestions[:2]], section=section_s) if include_log_excerpts else []
    stamp = _now()
    entry_lines = [
        "",
        f"### Issue ({stamp})",
        f"- Section: `{section_s}`",
    ]
    if author:
        entry_lines.append(f"- Author: {author}")
    if contact:
        entry_lines.append(f"- Contact: {contact.strip()}")
    entry_lines.append("")
    entry_lines.append(note_s)
    entry_lines.append("")
    entry_lines.append("Suggested logs for this section:")
    for s in suggestions:
        mark = "✓" if any(l["id"] == s["id"] for l in logs) else "·"
        entry_lines.append(f"- {mark} `{s['id']}` — {s['label']} — `{s['command']}`")
    if logs:
        entry_lines.append("")
        entry_lines.append("<details><summary>Attached log excerpts</summary>")
        entry_lines.append("")
        for block in logs:
            entry_lines.append(f"#### {block['label']}")
            entry_lines.append(f"`{block['command']}`")
            entry_lines.append("```text")
            entry_lines.append((block.get("excerpt") or "")[:8000])
            entry_lines.append("```")
            entry_lines.append("")
        entry_lines.append("</details>")
        entry_lines.append("")

    text = FEEDBACK_README.read_text(encoding="utf-8")
    if "## Issue reports" in text:
        # Append at end of file under issue reports
        text = text.rstrip() + "\n" + "\n".join(entry_lines) + "\n"
    else:
        text = text.rstrip() + "\n\n## Issue reports\n" + "\n".join(entry_lines) + "\n"
    FEEDBACK_README.write_text(text, encoding="utf-8")
    return {
        "ok": True,
        "path": "repository-governance/notes/README.md",
        "section": section_s,
        "suggested_logs": suggestions,
        "attached_logs": [{"id": l["id"], "label": l["label"]} for l in logs],
        "feedback": get_feedback_summary(),
    }
