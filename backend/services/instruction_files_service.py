"""Super-admin catalog of instruction / runbook files.

Lists filename + a human description (first heading or registry). Bodies are
only returned from ``read_file`` when the admin clicks View.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR

MAX_VIEW_CHARS = 80_000

# Stable registry: path relative to repo root, group, fallback description.
REGISTRY: tuple[tuple[str, str, str], ...] = (
    ("AGENTS.md", "Agent", "Workspace agent instructions: live server, additive modules, cache-bust, locked CAD rules."),
    ("README.md", "Product", "Render Studio product README — viewer, CAD, wiring, and feature overview."),
    (
        "ai-context/START-HERE.md",
        "Agent",
        "Entrypoint for AI agents: what Render Studio is, layout, golden rules, live-server safety.",
    ),
    (
        "ai-context/workspace-map.md",
        "Agent",
        "Where load-bearing files live (god-files vs feature modules) before exploring the tree.",
    ),
    (
        "ai-context/conventions-and-safety.md",
        "Agent",
        "How not to break the live app: additive modules, cache-bust, CSS, edit-risk zones.",
    ),
    (
        "ai-context/verify-and-test.md",
        "Agent",
        "Verification runbook: Playwright screenshots, venv, and backend checks before claiming done.",
    ),
    (
        "ai-context/help-system.md",
        "Product",
        "Help/docs architecture: DOC_FEATURES catalog feeding docs, Quest Book, and Getting Started.",
    ),
    (
        "ai-context/quest-book-roadmap.md",
        "Product",
        "Quest Book state and roadmap — learning map plus feature-usage event bus.",
    ),
    (
        "ai-context/ops/README.md",
        "Ops",
        "Mandatory ops root: debugger folders, prune rules, and when automations may write notes.",
    ),
    (
        "ai-context/ops/SKILL.md",
        "Ops",
        "Ops-debuggers skill for agents: miniaturized notes, folders, push rule, watchdogs.",
    ),
    (
        "ai-context/ops/DEVELOPER.md",
        "Foundry",
        "Foundry / Management desks, roles, workspace hub, watchdogs, and GitHub link notes.",
    ),
    (
        "ai-context/ops/ACCEPTED-BETA.md",
        "Ops",
        "Bot-accepted beta vs master — short table, no diffs.",
    ),
    (
        "ai-context/debugger/README.md",
        "Ops",
        "XR perf logs from headset developer mode (no PII). Distinct from ops/debugger/ push folder.",
    ),
    (
        "mcp/grok-bot/DEBUG-PATH-TRACER.md",
        "Ops",
        "Grok bot: trace mentioned-file status, relatedness to the bug, bot vs Sam when fixed, collateral breakage.",
    ),
    (
        "backend/skills/ops-debuggers/SKILL.md",
        "Ops",
        "Shipped copy of the ops-debuggers skill so instructions travel with downloaded repos.",
    ),
    (
        "docs/marketplace-hub.md",
        "Marketplace",
        "Marketplace hub vs instance catalog: modes, env keys, Hub API — secrets stay in env.",
    ),
    (
        ".cursor/rules/render-studio.mdc",
        "Cursor",
        "Cursor rule: pstack defaults, boot-file protection, and Sam VR control lock.",
    ),
)

EXTRA_GLOBS = (
    "ai-context/ops/*/README.md",
    "Getting-Started/*.md",
    "backend/skills/*/SKILL.md",
    ".cursor/rules/*.md",
    ".cursor/rules/*.mdc",
)

_HEADING_RE = re.compile(r"^#{1,3}\s+(.+)$", re.M)
_FRONT_RE = re.compile(r"^---\n.*?\n---\s*", re.S)


def _repo_root() -> Path:
    return Path(ROOT_DIR)


def _id_for(rel: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", rel.lower()).strip("-")
    return slug[:80] or "file"


def _first_heading(text: str) -> str:
    body = _FRONT_RE.sub("", text or "", count=1)
    match = _HEADING_RE.search(body)
    if match:
        return match.group(1).strip()[:160]
    for line in body.splitlines():
        line = line.strip()
        if line:
            return line[:160]
    return ""


def _description(path: Path, fallback: str) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")[:8000]
    except OSError:
        return fallback
    heading = _first_heading(text)
    if heading and heading.lower() not in {"untitled", path.stem.lower()}:
        return heading
    return fallback or heading or path.name


def _known() -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    for rel, group, desc in REGISTRY:
        out[rel.replace("\\", "/")] = (group, desc)
    return out


def _discover() -> list[str]:
    root = _repo_root()
    seen: dict[str, None] = {}
    for rel, _, _ in REGISTRY:
        seen[rel.replace("\\", "/")] = None
    for pattern in EXTRA_GLOBS:
        for path in root.glob(pattern):
            if not path.is_file():
                continue
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                continue
            if "/logs/" in f"/{rel}/":
                continue
            seen.setdefault(rel, None)
    return list(seen.keys())


def list_files() -> list[dict[str, Any]]:
    root = _repo_root()
    known = _known()
    rows: list[dict[str, Any]] = []
    for rel in _discover():
        path = root / rel
        group, fallback = known.get(rel, ("Other", ""))
        if not group:
            group = "Other"
        exists = path.is_file()
        desc = fallback
        mtime = None
        size = 0
        if exists:
            desc = _description(path, fallback)
            try:
                stat = path.stat()
                size = int(stat.st_size)
                mtime = stat.st_mtime
            except OSError:
                exists = False
        rows.append(
            {
                "id": _id_for(rel),
                "path": rel,
                "name": Path(rel).name,
                "group": group,
                "description": desc,
                "exists": exists,
                "bytes": size,
                "mtime": mtime,
            }
        )
    group_order = {"Agent": 0, "Ops": 1, "Foundry": 2, "Cursor": 3, "Marketplace": 4, "Product": 5, "Other": 9}
    rows.sort(key=lambda r: (group_order.get(str(r["group"]), 8), str(r["path"])))
    return rows


def get_file(file_id: str) -> dict[str, Any] | None:
    wanted = str(file_id or "").strip()
    if not wanted:
        return None
    for row in list_files():
        if row["id"] == wanted or row["path"] == wanted:
            return row
    return None


def read_file(file_id: str) -> dict[str, Any] | None:
    meta = get_file(file_id)
    if not meta or not meta.get("exists"):
        return None
    path = _repo_root() / str(meta["path"])
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    truncated = len(text) > MAX_VIEW_CHARS
    if truncated:
        text = text[:MAX_VIEW_CHARS]
    return {**meta, "body": text, "truncated": truncated}
