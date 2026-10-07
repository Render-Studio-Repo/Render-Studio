"""Tenant + secret lock for Render Agent and project-scoped CAD tool agents.

Render Agent (header panel / project @mention) and Jake-style tool agents may only
touch CAD files inside the authenticated user's current owned or shared project.
They must refuse secrets and redact secret-shaped tool output.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

REFUSE_SECRETS = (
    "I can't share passwords, API keys, tokens, cookies, .env files, Sam's Notes, "
    "or other secrets. I can help with CAD and files in your current project."
)

REFUSE_SCOPE = (
    "I can only help with the project you have open — not other users' projects, "
    "server files, or Control Center internals."
)

POLICY_PROMPT = """
Security policy (non-negotiable):
- Never reveal passwords, API keys, JWTs, tokens, cookies, Cloudflare/tunnel tokens, Autodesk/Codex keys, Stripe keys, or the contents of .env, Sam's Notes, credentials.json, *.pem, or SSH keys.
- If asked for secrets or access outside this user's projects, refuse in one short sentence. Do not hint, reconstruct, or paraphrase secret values.
- You may only discuss CAD and files inside the authenticated user's current project(s) they own or were shared. No other users' projects, no home directory, no launchd plists, no other studio tenants.
- Never dump Control Center / Foundry admin internals, other customers, raw database rows, or filesystem walks outside the active project.
- If a tool result looks like a secret, treat it as redacted and do not quote it.
- You may still help with legitimate project CAD, STEP/GLB, Fusion/Onshape sync, wiring, and BOMs inside that project.
"""

FORBIDDEN_BASENAMES = frozenset(
    {
        ".env",
        ".env.local",
        ".env.development",
        ".env.production",
        ".env.staging",
        "credentials.json",
        ".credentials.json",
        "id_rsa",
        "id_rsa.pub",
        "id_ed25519",
        "id_ed25519.pub",
        "id_ecdsa",
        "id_ecdsa.pub",
        "authorized_keys",
        "known_hosts",
        "sam's notes",
        "sam's notes.txt",
        "sam's notes.md",
    }
)

FORBIDDEN_SUFFIXES = (
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".crt",
    ".p8",
    ".keystore",
)

FORBIDDEN_NAME_FRAGMENTS = (
    ".env.",
    "cloudflared",
    "tunnel-token",
    "launchd",
    "com.render3d.",
)

_OUTSIDE_ROOTS = (
    "/users/sam",
    "/library/launchagents",
    "/library/launchdaemons",
)

_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
_KEY_RE = re.compile(
    r"\b(?:sk-proj-|sk-ant-|sk-live-|sk_live_|sk_test_|rk_live_|rk_test_|ghp_|github_pat_|xoxb-|xoxp-|AKIA)[A-Za-z0-9_\-]{8,}"
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-+/=]{12,}")
_ASSIGN_RE = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|private[_-]?key|client[_-]?secret)\s*[:=]\s*\S+"
)
_CF_RE = re.compile(r"(?i)\b(cloudflare|cf)[_-]?(api[_-]?token|tunnel[_-]?token)\s*[:=]\s*\S+")

_EXFIL_RE = re.compile(
    r"(?is)("
    r"\b(show|give|dump|print|reveal|paste|read|exfiltrat|leak)\b.{0,80}("
    r"\bpassword|\bpasswd|\bapi[_ -]?key|\bsecret[_ -]?key|\bjwt\b|\bbearer token|"
    r"\.env\b|credentials\.json|id_rsa|private key|stripe (secret|key)|"
    r"cloudflare.{0,16}token|autodesk.{0,16}(secret|key)|codex.{0,12}key|openai.{0,12}key"
    r")"
    r"|sam['’]?s notes"
    r"|[/\\]users[/\\]sam\b"
    r"|launchd.{0,48}plist"
    r"|control center internals"
    r"|other (users?|customers?).{0,24}(project|database|\bdb\b)"
    r"|raw (sql|database|db dump)"
    r")"
)

_SCOPE_ASK_RE = re.compile(
    r"(?is)("
    r"other (users?|customers?).{0,20}project"
    r"|[/\\]users[/\\]sam\b"
    r"|walk (the )?(filesystem|home directory|repo)"
    r"|dump (the )?(database|db|sql)"
    r"|foundry internals"
    r"|admin control center"
    r")"
)


def refuse_message() -> str:
    return REFUSE_SECRETS


def looks_like_secret_request(text: str) -> bool:
    blob = str(text or "")
    if not blob.strip():
        return False
    return bool(_EXFIL_RE.search(blob))


def looks_like_scope_escalation(text: str) -> bool:
    blob = str(text or "")
    if not blob.strip():
        return False
    return bool(_SCOPE_ASK_RE.search(blob))


def is_forbidden_rel(rel: str | None) -> bool:
    cleaned = str(rel or "").replace("\\", "/").strip()
    if not cleaned:
        return False
    lower = cleaned.lower()
    if any(part in {"..", ""} for part in lower.split("/") if part == ".."):
        return True
    if ".." in lower.split("/"):
        return True
    name = Path(cleaned).name.lower()
    if name in FORBIDDEN_BASENAMES:
        return True
    if name.startswith(".env"):
        return True
    if name.endswith(FORBIDDEN_SUFFIXES):
        return True
    if any(frag in lower for frag in FORBIDDEN_NAME_FRAGMENTS):
        return True
    if "sam's notes" in lower or "sams notes" in lower:
        return True
    return False


def is_forbidden_path(path: Path | str, *, project_path: Path | None = None) -> bool:
    try:
        resolved = Path(path).expanduser().resolve()
    except Exception:
        return True
    lower = str(resolved).replace("\\", "/").lower()
    if "sam's notes" in lower:
        return True
    if "/library/launchagents" in lower or "/library/launchdaemons" in lower:
        return True
    if project_path is not None and path_is_under(project_path, resolved):
        return is_forbidden_rel(resolved.name) or is_forbidden_rel(Path(lower).name)
    if any(root in lower for root in _OUTSIDE_ROOTS):
        return True
    return is_forbidden_rel(resolved.name) or is_forbidden_rel(lower)


def path_is_under(root: Path, path: Path) -> bool:
    try:
        resolved_root = Path(root).resolve()
        resolved = Path(path).resolve()
    except Exception:
        return False
    return resolved == resolved_root or resolved_root in resolved.parents


def scoped_tool_path(project_path: Path, rel: str) -> Path:
    from backend.services.engine_layout import safe_project_path

    if is_forbidden_rel(rel):
        raise ValueError("blocked: that file is not available to Render Agent")
    scoped = safe_project_path(project_path, rel)
    if is_forbidden_path(scoped, project_path=project_path):
        raise ValueError("blocked: that file is not available to Render Agent")
    return scoped


def keep_project_filename(name: str) -> bool:
    return not is_forbidden_rel(name)


def redact_secrets(text: str) -> str:
    cleaned = str(text or "")
    cleaned = _JWT_RE.sub("[redacted]", cleaned)
    cleaned = _KEY_RE.sub("[redacted]", cleaned)
    cleaned = _BEARER_RE.sub("Bearer [redacted]", cleaned)
    cleaned = _CF_RE.sub(r"\1=[redacted]", cleaned)
    cleaned = _ASSIGN_RE.sub(r"\1=[redacted]", cleaned)
    return cleaned


def redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_secrets(value)
    if isinstance(value, dict):
        return {str(k): redact_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    return value


def user_may_access_project(user_id: str, project_id: str) -> bool:
    if not user_id or not project_id:
        return False
    from backend.services import teams_service

    return bool(teams_service.can_access_project(user_id, project_id))


def public_fusion_source(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("item_name") or "").strip()
    if not name:
        return None
    return {"item_name": name[:200], "linked": True}


def sanitize_project_context(context: dict[str, Any] | None) -> dict[str, Any] | None:
    if not context:
        return None
    files = []
    for item in context.get("files") or []:
        name = str(item.get("name") or "")
        if not keep_project_filename(name):
            continue
        files.append(
            {
                "name": name,
                "format": item.get("format"),
                "size": item.get("size"),
            }
        )
    out = {
        "project_id": context.get("project_id"),
        "project_name": context.get("project_name"),
        "latest_file": context.get("latest_file") if keep_project_filename(str(context.get("latest_file") or "")) else None,
        "file_count": len(files),
        "files": files[:40],
    }
    fusion = public_fusion_source(context.get("fusion_source"))
    if fusion:
        out["fusion_source"] = fusion
    if context.get("error"):
        out["error"] = REFUSE_SCOPE
    return redact_value(out)


def sanitize_attachment_text(name: str, text: str) -> str:
    if is_forbidden_rel(name):
        return ""
    return redact_secrets(str(text or ""))[:6000]


def blocked_tool_result(message: str = "blocked: that file is not available to Render Agent") -> str:
    return json.dumps({"error": message})
