"""Resolve workspace wiki-link paths, edit/related status, and debugger sends.

Does not print secrets. Reuses ops notes + Foundry debugger + incident intel.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR

MAX_BODY = 80_000
EDIT_WINDOW_HOURS = 48
MAX_LIST = 400
MAX_DEPS = 40

SECRET_NAMES = {
    ".env",
    "credentials.json",
    "render3d.db",
    "id_rsa",
}
SECRET_SUFFIXES = {".pem", ".key", ".p12", ".pfx"}
SECRET_PARTS = (".env.", "secrets", "github_tokens")

READ_SUFFIXES = {
    ".md",
    ".mdc",
    ".js",
    ".mjs",
    ".cjs",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".css",
    ".html",
    ".json",
    ".yml",
    ".yaml",
    ".toml",
    ".sh",
    ".svg",
    ".plist",
    ".service",
    ".jsonl",
    ".txt",
}

KNOWN_FILES = {
    "render3d.service": "deploy/render3d.service",
    "render3d-stray-cleanup.service": "deploy/render3d-stray-cleanup.service",
    "render3d-worker-watch.service": "deploy/render3d-worker-watch.service",
    "com.render3d.app.plist": "deploy/mac/com.render3d.app.plist",
    "com.render3d.watchdog.plist": "deploy/mac/com.render3d.watchdog.plist",
}

DOC_GLOBS = (
    "ai-context/*.md",
    "ai-context/**/*.md",
    "ai-context/skills/**/SKILL.md",
    "Getting-Started/*.md",
    "backend/skills/**/SKILL.md",
    "backend/skills/**/*.md",
    "docs/**/*.md",
    "logs/**/*.md",
)

SKIP_DIR_PARTS = ("/logs/logs/", "/node_modules/", "/.venv/", "/vendor/", "/backups/", "/milestones/")
ISSUE_RE = re.compile(
    r"\b(not working|broken|broke|404|lag|crash|fail(?:ed|ure)?|error|exception|timeout|hang|wrong|missing|degraded|down|outage)\b",
    re.I,
)
JS_IMPORT_RE = re.compile(r"""(?:from|import)\s*\(?['"]([^'"]+)['"]\)?""")
PY_IMPORT_RE = re.compile(r"^(?:from|import)\s+([a-zA-Z_][\w.]*)", re.M)
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)|\[\[([^\]|]+)(?:\|[^\]]+)?\]\]|`([^`]{2,160})`")
FEATURE_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,79}$")


def _root() -> Path:
    return Path(ROOT_DIR)


def _posix(rel: str) -> str:
    return str(rel or "").replace("\\", "/").lstrip("/")


def is_secret(rel: str) -> bool:
    path = _posix(rel)
    name = Path(path).name.lower()
    if name in SECRET_NAMES or name.startswith(".env"):
        return True
    if Path(path).suffix.lower() in SECRET_SUFFIXES:
        return True
    lower = f"/{path.lower()}/"
    return any(part in lower for part in SECRET_PARTS)


def _skip_rel(rel: str) -> bool:
    path = f"/{_posix(rel)}/"
    return any(part in path for part in SKIP_DIR_PARTS)


def feature_for(path: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", ".", _posix(path).lower()).strip(".")
    key = f"file.{slug}"[:80]
    return key if FEATURE_RE.fullmatch(key) else "file.unknown"


def classify(rel: str) -> str:
    path = _posix(rel)
    if path.endswith("SKILL.md") or "/skills/" in path:
        return "Skill"
    if path.startswith("Getting-Started/"):
        return "Getting-Started"
    if "/ops/" in path or path.startswith("ai-context/debugger/") or path.startswith("logs/"):
        return "Log"
    if path.startswith("ai-context/"):
        return "Agent"
    if path.startswith("docs/"):
        return "Product"
    if path.startswith(".cursor/"):
        return "Cursor"
    return "Other"


def resolve_rel(target: str, *, from_path: str | None = None) -> str | None:
    raw = _posix(str(target or "").split("?", 1)[0]).strip()
    if not raw or is_secret(raw):
        return None
    known = KNOWN_FILES.get(raw) or KNOWN_FILES.get(Path(raw).name)
    if known:
        raw = known
    root = _root()
    candidates: list[Path] = []
    if raw.startswith("./") or raw.startswith("../"):
        base = (root / _posix(from_path or ".")).parent if from_path else root
        candidates.append((base / raw).resolve())
    else:
        candidates.append((root / raw).resolve())
        if from_path:
            candidates.append(((root / _posix(from_path)).parent / raw).resolve())
        for prefix in ("ai-context", "Getting-Started", "backend/skills", "deploy"):
            candidates.append((root / prefix / Path(raw).name).resolve())
    root_resolved = root.resolve()
    for cand in candidates:
        try:
            rel = cand.relative_to(root_resolved).as_posix()
        except ValueError:
            continue
        if is_secret(rel) or _skip_rel(rel):
            continue
        if cand.is_file():
            return rel
    try:
        fallback = (root / raw).resolve().relative_to(root_resolved).as_posix()
    except ValueError:
        return None
    if is_secret(fallback):
        return None
    return fallback


def _safe_file(rel: str) -> Path | None:
    path = _posix(rel)
    if not path or is_secret(path) or _skip_rel(path):
        return None
    full = (_root() / path).resolve()
    try:
        full.relative_to(_root().resolve())
    except ValueError:
        return None
    if not full.is_file():
        return None
    if full.suffix.lower() not in READ_SUFFIXES and full.name not in KNOWN_FILES:
        return None
    return full


def list_docs() -> list[dict[str, Any]]:
    from backend.services import instruction_files_service

    root = _root()
    seen: dict[str, None] = {}
    for row in instruction_files_service.list_files():
        rel = _posix(row.get("path") or "")
        if rel and not is_secret(rel):
            seen[rel] = None
    for pattern in DOC_GLOBS:
        for path in root.glob(pattern):
            if not path.is_file():
                continue
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                continue
            if is_secret(rel) or _skip_rel(rel):
                continue
            seen.setdefault(rel, None)
    rows: list[dict[str, Any]] = []
    for rel in seen:
        path = root / rel
        exists = path.is_file()
        mtime = None
        size = 0
        if exists:
            try:
                stat = path.stat()
                size = int(stat.st_size)
                mtime = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
            except OSError:
                exists = False
        rows.append(
            {
                "path": rel,
                "name": Path(rel).name,
                "group": classify(rel),
                "exists": exists,
                "bytes": size,
                "mtime": mtime,
            }
        )
        if len(rows) >= MAX_LIST:
            break
    group_order = {
        "Agent": 0,
        "Getting-Started": 1,
        "Skill": 2,
        "Log": 3,
        "Ops": 4,
        "Foundry": 5,
        "Cursor": 6,
        "Product": 7,
        "Other": 9,
    }
    rows.sort(key=lambda r: (group_order.get(str(r["group"]), 8), str(r["path"])))
    return rows


def _mtime_iso(path: Path) -> str | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    except OSError:
        return None


def _parse_js_deps(rel: str, text: str) -> list[str]:
    here = Path(rel).parent
    out: list[str] = []
    for match in JS_IMPORT_RE.finditer(text):
        spec = match.group(1).split("?", 1)[0]
        if spec.startswith(".") or spec.startswith("/"):
            resolved = resolve_rel(spec, from_path=rel)
            if resolved:
                out.append(resolved)
            else:
                guess = (here / spec).as_posix()
                if not is_secret(guess):
                    out.append(_posix(guess))
    return out


def _parse_py_deps(text: str) -> list[str]:
    out: list[str] = []
    for match in PY_IMPORT_RE.finditer(text):
        mod = match.group(1)
        if not mod.startswith("backend"):
            continue
        rel = mod.replace(".", "/") + ".py"
        init = mod.replace(".", "/") + "/__init__.py"
        for candidate in (rel, init):
            if (_root() / candidate).is_file() and not is_secret(candidate):
                out.append(candidate)
                break
    return out


def _parse_md_deps(rel: str, text: str) -> list[str]:
    out: list[str] = []
    for match in MD_LINK_RE.finditer(text):
        target = match.group(2) or match.group(3) or match.group(4) or ""
        if not target or target.startswith("http"):
            continue
        resolved = resolve_rel(target, from_path=rel)
        if resolved:
            out.append(resolved)
    return out


def dependency_paths(rel: str, text: str | None = None) -> list[str]:
    path = _safe_file(rel)
    if path is None:
        return []
    body = text if text is not None else path.read_text(encoding="utf-8", errors="replace")[:40_000]
    suffix = path.suffix.lower()
    found: list[str] = []
    if suffix in {".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".css"}:
        found.extend(_parse_js_deps(rel, body))
    if suffix == ".py":
        found.extend(_parse_py_deps(body))
    if suffix in {".md", ".mdc"}:
        found.extend(_parse_md_deps(rel, body))
    uniq: list[str] = []
    seen: set[str] = set()
    for item in found:
        if item in seen or is_secret(item):
            continue
        seen.add(item)
        uniq.append(item)
        if len(uniq) >= MAX_DEPS:
            break
    return uniq


def _baseline_iso(feature: str) -> str:
    try:
        from backend.services import incident_intelligence_service as incident

        prev = incident.latest(feature)
        if prev and prev.get("ts"):
            return str(prev["ts"])
    except Exception:
        pass
    return (datetime.now(timezone.utc) - timedelta(hours=EDIT_WINDOW_HOURS)).isoformat()


def analyze_edits(rel: str) -> dict[str, Any]:
    path = _safe_file(rel)
    now = datetime.now(timezone.utc)
    baseline = _baseline_iso(feature_for(rel))
    target_mtime = _mtime_iso(path) if path else None
    target_edited = bool(target_mtime and target_mtime > baseline)
    deps = dependency_paths(rel) if path else []
    edited_deps: list[str] = []
    dep_rows: list[dict[str, Any]] = []
    for dep in deps:
        dep_path = _safe_file(dep)
        stamp = _mtime_iso(dep_path) if dep_path else None
        edited = bool(stamp and stamp > baseline)
        dep_rows.append({"path": dep, "mtime": stamp, "edited": edited, "exists": bool(dep_path)})
        if edited:
            edited_deps.append(dep)
    edited_paths = ([rel] if target_edited else []) + edited_deps
    return {
        "path": rel,
        "exists": bool(path),
        "target_mtime": target_mtime,
        "target_edited": target_edited,
        "deps_edited": bool(edited_deps),
        "edited_paths": edited_paths[:12],
        "dependencies": dep_rows[:MAX_DEPS],
        "baseline": baseline,
        "checked_at": now.isoformat(),
    }


def relatedness(paths: list[str]) -> dict[str, Any]:
    clean = []
    seen: set[str] = set()
    for raw in paths or []:
        rel = resolve_rel(raw) or _posix(raw)
        if not rel or rel in seen or is_secret(rel):
            continue
        seen.add(rel)
        clean.append(rel)
    if len(clean) < 2:
        return {"related": True, "label": "single file", "reason": "Only one file.", "paths": clean}
    dirs = {str(Path(p).parent.as_posix()) for p in clean}
    if len(dirs) == 1:
        return {"related": True, "label": "related", "reason": "Same folder.", "paths": clean}
    prefixes = (
        "frontend/xr",
        "frontend/studio",
        "frontend/site",
        "frontend/admin",
        "frontend/wiring",
        "backend/skills",
        "backend/services",
        "ai-context/ops",
        "ai-context/debugger",
        "Getting-Started",
        "deploy",
    )
    for prefix in prefixes:
        if all(p == prefix or p.startswith(prefix + "/") for p in clean):
            return {"related": True, "label": "related", "reason": f"Same area: {prefix}.", "paths": clean}
    dep_hits = 0
    for item in clean:
        deps = set(dependency_paths(item))
        if any(other in deps for other in clean if other != item):
            dep_hits += 1
    if dep_hits:
        return {"related": True, "label": "related", "reason": "Import / wiki-link dependency.", "paths": clean}
    roots = {p.split("/", 1)[0] for p in clean}
    if len(roots) == 1:
        return {"related": True, "label": "related", "reason": f"Same tree: {next(iter(roots))}/.", "paths": clean}
    return {"related": False, "label": "unrelated", "reason": "Different trees; no shared import.", "paths": clean}


def _mentions_in_ops(rel: str) -> bool:
    try:
        from backend.services import ops_log_service

        name = Path(rel).name.lower()
        for note in ops_log_service.list_notes(limit=40):
            preview = str(note.get("preview") or "").lower()
            if rel.lower() in preview or name in preview:
                return True
    except Exception:
        return False
    return False


def _incident_status(rel: str) -> str | None:
    try:
        from backend.services import incident_intelligence_service as incident

        row = incident.latest(feature_for(rel))
        if row:
            return str(row.get("status") or "")
    except Exception:
        return None
    return None


def issue_file_check(paths: list[str], prompt: str) -> dict[str, Any]:
    issue = bool(ISSUE_RE.search(str(prompt or "")))
    files: list[dict[str, Any]] = []
    implicated: list[str] = []
    for raw in paths or []:
        rel = resolve_rel(raw) or _posix(raw)
        if not rel or is_secret(rel):
            continue
        edits = analyze_edits(rel)
        incident = _incident_status(rel)
        ops_hit = _mentions_in_ops(rel)
        broken = False
        why = "no issue language"
        if issue:
            if incident in {"broken", "missing", "degraded"}:
                broken = True
                why = f"incident status {incident}"
            elif ops_hit:
                broken = True
                why = "named in a debugger / ops note"
            elif edits.get("target_edited") or edits.get("deps_edited"):
                broken = True
                why = "recent edit on file or a dependency"
            else:
                why = "issue reported; no edit or debugger hit"
        status = "broken" if broken else ("degraded" if issue else "ok")
        if broken:
            implicated.append(rel)
        files.append(
            {
                "path": rel,
                "name": Path(rel).name,
                "issue": issue,
                "implicated": broken,
                "status": status,
                "why": why,
                "target_edited": edits.get("target_edited"),
                "deps_edited": edits.get("deps_edited"),
                "edited_paths": edits.get("edited_paths") or [],
            }
        )
    return {
        "issue": issue,
        "implicated": implicated,
        "files": files,
        "component_status": "broken" if implicated else ("degraded" if issue else "ok"),
    }


def read_file(target: str, *, from_path: str | None = None) -> dict[str, Any] | None:
    rel = resolve_rel(target, from_path=from_path)
    if not rel:
        return None
    path = _safe_file(rel)
    meta = {
        "path": rel,
        "name": Path(rel).name,
        "group": classify(rel),
        "exists": bool(path),
        "kind": "markdown" if rel.endswith((".md", ".mdc")) else "code",
        "edits": analyze_edits(rel),
    }
    if path is None:
        return {**meta, "body": "", "truncated": False, "bytes": 0}
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    truncated = len(text) > MAX_BODY
    if truncated:
        text = text[:MAX_BODY]
    return {**meta, "body": text, "truncated": truncated, "bytes": len(text.encode("utf-8"))}


def send_debugger(user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    from backend.services import incident_intelligence_service as incident
    from backend.services import workspace_automation_service

    raw_paths = payload.get("paths") or []
    if isinstance(raw_paths, str):
        raw_paths = [raw_paths]
    if payload.get("path") and not raw_paths:
        raw_paths = [payload.get("path")]
    paths = []
    for item in raw_paths:
        rel = resolve_rel(str(item), from_path=str(payload.get("from_path") or "") or None) or _posix(str(item))
        if rel and not is_secret(rel):
            paths.append(rel)
    paths = list(dict.fromkeys(paths))
    if not paths:
        raise ValueError("No safe file paths to log")
    reason = str(payload.get("reason") or payload.get("selected_text") or "wiki-link debugger").strip()[:800]
    selected = str(payload.get("selected_text") or "").strip()[:800]
    related = relatedness(paths)
    check = issue_file_check(paths, f"{reason}\n{selected}")
    requested = str(payload.get("status") or "").lower()
    if requested not in {"ok", "degraded", "broken", "missing", "unknown"}:
        requested = check["component_status"]
    occurred = datetime.now(timezone.utc).isoformat()
    lines = [
        f"when: {occurred}",
        f"why: {reason}",
        f"files: {', '.join(Path(p).name for p in paths)}",
        f"related: {related['label']}",
        f"issue_implicated: {', '.join(check['implicated']) or 'none'}",
    ]
    first_edits = analyze_edits(paths[0])
    lines.append(
        f"edited: file={'yes' if first_edits.get('target_edited') else 'no'} deps={'yes' if first_edits.get('deps_edited') else 'no'}"
    )
    lines.append(f"status: {requested}")
    body = "\n".join(lines)
    title = f"wiki {Path(paths[0]).name}"
    foundry = workspace_automation_service.send_user_debugger(user, title, body, send_bug_branch=False)
    events = []
    for item in check["files"]:
        edits = analyze_edits(item["path"])
        status = requested if len(check["files"]) == 1 else item["status"]
        if requested == "broken":
            status = "broken"
        events.append(
            incident.record_event(
                {
                    "feature": feature_for(item["path"]),
                    "status": status,
                    "kind": "wiki-debugger",
                    "source": "context-wiki",
                    "note": reason,
                    "fields": {
                        "wiki.path": item["path"],
                        "wiki.source_doc": str(payload.get("from_path") or "")[:160],
                        "wiki.reason": reason[:400],
                        "wiki.target_edited": bool(edits.get("target_edited")),
                        "wiki.deps_edited": bool(edits.get("deps_edited")),
                        "wiki.occurred_at": occurred,
                        "wiki.component_status": status,
                        "wiki.related": related["related"],
                        "wiki.implicated": bool(item["implicated"]),
                    },
                }
            )
        )
    return {
        "ok": True,
        "occurred_at": occurred,
        "paths": paths,
        "related": related,
        "issue_check": check,
        "edits": first_edits,
        "status": requested,
        "reason": reason,
        "debugger": foundry,
        "events": [{"id": row.get("id"), "feature": row.get("feature"), "status": row.get("status")} for row in events],
    }
