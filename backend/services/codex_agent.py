"""Run the Codex CAD agent (earthtojake/text-to-cad skill plugin) for Render Studio.

Upstream text-to-cad is a Codex / Claude Code skill plugin — not an in-process
chat rewrite loop. This module shells out to the Codex CLI with the installed
``cad@text-to-cad`` plugin, in the project workspace, so the agent owns:

  edit gen_step() source → python scripts/step → inspect → snapshot → repair

Render Studio keeps the product shell (viewer, progress UI, Fusion, etc.).
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Optional

from backend.config import DEFAULT_OPENAI_MODEL
from backend.services.prompt_language import with_multilingual_prompt_rule
from backend.services.trace_log import add as trace_add

ProgressCb = Optional[Callable[[dict[str, Any]], None]]
CancelCb = Optional[Callable[[], bool]]
UsageCb = Optional[Callable[[dict[str, int]], None]]

ROOT_DIR = Path(__file__).resolve().parents[2]
# One Codex CAD session can run for hours (desktop VibeCAD-class refine).
# The old 20-minute cap accepted the first STEP/GLB and cut those runs off.
DEFAULT_TIMEOUT_SEC = 16 * 60 * 60
logger = logging.getLogger("render3d.codex_agent")


class CodexUnavailable(RuntimeError):
    """Codex CLI or CAD plugin is not available on this host."""


class CodexFailed(RuntimeError):
    """Codex ran but did not produce a valid STEP/GLB for the project."""


class CodexEditNotProduced(CodexFailed):
    """An edit did not export a new result; never fall back to a new-part run."""


def _codex_auth_mode(home: Path | None = None) -> str:
    try:
        path = (Path(home) if home else Path.home() / ".codex") / "auth.json"
        if home:
            path = Path(home) / "auth.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        return str(data.get("auth_mode") or "").strip().lower()
    except Exception:
        return ""


def _codex_home_for_user(user_id: str | None) -> Path | None:
    uid = str(user_id or "").strip()
    if not uid:
        return None
    try:
        from backend.services.chatgpt_codex_auth import read_chatgpt_auth, user_codex_home

        if read_chatgpt_auth(uid).get("signed_in"):
            return user_codex_home(uid)
    except Exception:
        return None
    return None


def _chatgpt_rejects_api_codex_model(model: str | None) -> bool:
    """ChatGPT logins cannot use API-only Codex skill ids like gpt-5.3-codex."""
    m = str(model or "").strip().lower()
    if not m:
        return False
    if m.startswith("gpt-6-astra"):
        return False
    return "codex" in m


def _model_is_openai_responses_only(model: str | None) -> bool:
    """GPT-5.5 / GPT-5.6 Sol are API Responses-only unless ChatGPT Codex entitles Sol."""
    m = str(model or "").strip().lower()
    if not m:
        return False
    if "codex" in m or m.startswith("gpt-6-astra"):
        return False
    return (
        m.startswith("gpt-5.5")
        or m.startswith("gpt-5.6")
        or m.endswith("-sol")
        or "-sol" in m
        or m.endswith("-pro")
        and "gpt-5" in m
    )


def _chatgpt_home_allows_gpt56_cli(model: str | None) -> bool:
    m = str(model or "").strip().lower()
    return m.startswith("gpt-5.6-sol") or m.startswith("gpt-5.6-luna") or m.startswith("gpt-5.6-terra")


def resolve_codex_cli_model(
    preferred: str | None = None,
    *,
    home: Path | None = None,
    api_key_auth: bool = False,
) -> str | None:
    """Return ``codex exec -m`` id, or None to use the ChatGPT/CLI default."""
    env = (os.environ.get("CODEX_MODEL") or os.environ.get("RENDER3D_CODEX_MODEL") or "").strip()
    name = (preferred or env or "").strip() or DEFAULT_OPENAI_MODEL
    lowered = name.lower()
    if lowered in {"chatgpt", "codex", "default", "chatgpt-default"}:
        return DEFAULT_OPENAI_MODEL
    chatgpt_home = bool(home) and _codex_auth_mode(home) in {"chatgpt", "chat_gpt"}
    if chatgpt_home and lowered.startswith("gpt-6-astra-pro"):
        # ChatGPT Codex 0.153 rejects gpt-6-astra-pro (400). Astra works.
        return "gpt-6-astra"
    if chatgpt_home and lowered.startswith("gpt-6.1-sol"):
        return name
    if _model_is_openai_responses_only(name):
        if api_key_auth:
            return name
        # Sol/Luna/Terra on ChatGPT Codex hit responses websocket 401
        # ("missing bearer"). Astra is the ChatGPT-hosted model.
        if chatgpt_home and _chatgpt_home_allows_gpt56_cli(name):
            return "gpt-6-astra"
        return None
    if chatgpt_home and _chatgpt_rejects_api_codex_model(name):
        return None
    return name


def _event_is_chatgpt_model_unsupported(event: dict[str, Any] | None) -> bool:
    if not isinstance(event, dict):
        return False
    blob = json.dumps(event, default=str).lower()
    return "not supported when using codex with a chatgpt account" in blob


def looks_like_codex_jsonl(text: str | None) -> bool:
    s = str(text or "").lstrip()
    return s.startswith('{"type":"thread.started"') or s.startswith('{"type":"error"')


def codex_cli_failure_message(
    *,
    text: str = "",
    events: list[dict[str, Any]] | None = None,
    stderr: str = "",
    auth_label: str | None = None,
) -> str | None:
    """Turn Codex JSON/stderr into a user-facing error, or None if it looks like a real reply."""
    blob = "\n".join(
        [
            str(text or ""),
            str(stderr or ""),
            json.dumps(events or [], default=str),
        ]
    ).lower()
    if "requires a newer version of codex" in blob:
        return (
            "This GPT-6 Astra run needs Codex CLI 0.153+. The host Codex was outdated "
            "(run `codex update` on the studio machine) — retry the prompt."
        )
    if "model metadata for `gpt-6-astra`" in blob and "not found" in blob:
        return (
            "Codex does not have GPT-6 Astra model metadata yet. Update Codex CLI "
            "(`codex update`) and retry."
        )
    if "401 unauthorized" in blob or "missing bearer" in blob:
        if auth_label == "openai_api":
            return (
                "The selected API key could not authenticate (401). "
                "Check that key under Subscriptions. If it is shared, ask its owner to reconnect it."
            )
        if auth_label == "chatgpt":
            return (
                "The selected ChatGPT subscription could not authenticate (401). "
                "Its owner needs to sign in again under Subscriptions."
            )
        return (
            "Codex could not authenticate (401). Check the selected key or subscription "
            "under Subscriptions. If it is shared, ask its owner to reconnect it."
        )
    if "not supported when using codex with a chatgpt account" in blob:
        if "gpt-6-astra-pro" in blob:
            return (
                "GPT-6 Astra Pro is not available on ChatGPT Codex. "
                "Studio now uses GPT-6 Astra for that picker row — retry the prompt."
            )
        if "gpt-5.6-sol" in blob:
            return (
                "GPT-5.6 Sol is not enabled on this ChatGPT plan for Codex. "
                "Pick Astra, or add an OpenAI API key for Sol."
            )
        return (
            "That model is not supported on ChatGPT Codex. "
            "Pick GPT-6 Astra, or add an API key."
        )
    if looks_like_codex_jsonl(text) and "error" in blob:
        return "Codex CLI returned an error instead of CAD source. Retry, or pick a different model."
    return None


@lru_cache(maxsize=1)
def resolve_codex_bin() -> Path | None:
    env = (os.environ.get("CODEX_BIN") or os.environ.get("RENDER3D_CODEX_BIN") or "").strip()
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env).expanduser())
    which = shutil.which("codex")
    if which:
        candidates.append(Path(which))
    candidates.append(Path.home() / ".local" / "bin" / "codex")
    # Cursor ChatGPT extension ships a Linux Codex binary.
    ext_root = Path.home() / ".cursor-server" / "extensions"
    if ext_root.is_dir():
        for path in sorted(ext_root.glob("openai.chatgpt-*/bin/linux-x86_64/codex"), reverse=True):
            candidates.append(path)
    seen: set[str] = set()
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        if path.is_file() and os.access(path, os.X_OK):
            # Keep the PATH/symlink entry so `codex update` is picked up without
            # pinning a versioned releases/... inode.
            return path
    return None


def codex_available() -> bool:
    return resolve_codex_bin() is not None


def _cad_skill_dir() -> Path:
    from backend.services.skills_service import get_skill_dir

    skill_dir = get_skill_dir("cad")
    if skill_dir and (skill_dir / "scripts").is_dir():
        return Path(skill_dir).resolve()
    fallback = ROOT_DIR / "backend" / "skills" / "cad"
    if (fallback / "scripts").is_dir():
        return fallback.resolve()
    plugin = Path.home() / ".codex" / "plugins" / "cache" / "text-to-cad" / "cad"
    if plugin.is_dir():
        versions = sorted(plugin.iterdir(), reverse=True)
        for ver in versions:
            candidate = ver / "skills" / "cad"
            if (candidate / "scripts").is_dir():
                return candidate.resolve()
    raise CodexUnavailable("CAD skill scripts not found (backend/skills/cad or cad@text-to-cad plugin).")


def _pythonpath_for_skill(skill_dir: Path) -> str:
    from backend.services.skill_runner import _pythonpath_for_skill as _pp

    return _pp(skill_dir)


def _venv_bin() -> Path | None:
    from backend.services.skill_runner import cad_python_bin

    cad_bin = cad_python_bin()
    if cad_bin:
        return cad_bin
    for candidate in (
        ROOT_DIR / ".venv-mac" / "bin",
        ROOT_DIR / ".venv-cad" / "bin",
        ROOT_DIR / ".venv" / "bin",
        Path.home() / ".venv" / "bin",
    ):
        if (candidate / "python").is_file() or (candidate / "python").is_symlink():
            return candidate
    return None


def _ensure_project_scripts(project_path: Path, skill_dir: Path) -> Path:
    """CAD skill workflow expects ``python scripts/step`` from the artifact cwd."""
    from backend.services.skill_runner import ensure_project_cad_scripts

    linked = ensure_project_cad_scripts(project_path)
    if linked is not None:
        return linked
    scripts_link = project_path / "scripts"
    target = (skill_dir / "scripts").resolve()
    if scripts_link.exists():
        return scripts_link
    scripts_link.symlink_to(target, target_is_directory=True)
    return scripts_link


def _ensure_project_agents_md(project_path: Path) -> None:
    path = project_path / "AGENTS.md"
    old_step = (
        "python scripts/step <generator.py> --glb <name>.glb --stl <name>.stl --3mf <name>.3mf --force\n"
    )
    new_step = "python scripts/step <generator.py> --glb <name>.glb --force\n"
    if path.is_file():
        try:
            existing = path.read_text(encoding="utf-8")
        except OSError:
            return
        original = existing
        if old_step in existing:
            existing = existing.replace(old_step, new_step)
        old_sib = (
            "Inspect other STEP files in this folder before authoring. Import and rearrange "
            "siblings instead of ignoring them."
        )
        new_sib = (
            "Inspect other STEP files in this folder before authoring. Keep existing parts in place; "
            "author only the new solid. The host FreeCAD kernel places it beside them or merges it "
            "into the live assembly STEP."
        )
        if old_sib in existing:
            existing = existing.replace(old_sib, new_sib)
        if existing != original:
            path.write_text(existing, encoding="utf-8")
        return
    path.write_text(
        "# Render Studio / Jake CAD workspace\n\n"
        "Use the installed `$cad` skill (earthtojake/text-to-cad).\n"
        "Work in this directory. Run CAD tools as:\n\n"
        "```bash\n"
        "python <model>.py --force\n"
        "python scripts/step <generator.py> --glb <name>.glb --force\n"
        "python scripts/inspect refs <name>.step --facts --planes --positioning\n"
        "python scripts/snapshot --input <name>.step --output <name>_snapshot.png --camera iso --view-labels --size-profile diagnostic\n"
        "```\n\n"
        "Jake 0.5: prefer `@step` models (`from cadgen import step`). `scripts/step` also wraps legacy `gen_step()`.\n"
        "STEP is primary. Prefer surgical edits over rewrites. Skip `$cad-viewer` "
        "handoff — Render Studio owns the viewer.\n"
        "Inspect other STEP files in this folder before authoring. Keep existing parts in place; "
        "author only the new solid. The host FreeCAD kernel places it beside them or merges it "
        "into the live assembly STEP. To move an existing part, write r3d_placements.json.\n",
        encoding="utf-8",
    )


def _trust_project_in_codex_config(project_path: Path, home: Path | None = None) -> None:
    cfg = (Path(home) if home else Path.home() / ".codex") / "config.toml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    key = f'[projects."{project_path.resolve()}"]'
    existing = cfg.read_text(encoding="utf-8") if cfg.is_file() else ""
    if key in existing:
        return
    extra = ""
    if home and "cli_auth_credentials_store" not in existing:
        extra = 'cli_auth_credentials_store = "file"\n'
    block = f'\n\n{extra}{key}\ntrust_level = "trusted"\n'
    cfg.write_text(existing.rstrip() + block, encoding="utf-8")


def _build_prompt(
    *,
    prompt: str,
    cad_brief: str,
    source_name: str,
    step_name: str,
    glb_name: str,
    stl_name: str,
    three_mf_name: str,
    is_edit: bool,
    previous_source: str | None,
    parts_inventory: str = "",
) -> str:
    from backend.services.parts_sourcing_policy import UNRESOLVED_PURCHASED_INTERFACE_RULES

    mode = "EDIT/REVISE the existing generator" if is_edit else "CREATE a new part"
    prev = ""
    if previous_source and is_edit:
        prev = (
            f"\nExisting generator `{source_name}` is already in this workspace "
            "(or will be written before you start). Make the smallest surgical change.\n"
        )
    elif not is_edit:
        prev = (
            f"\nThis is a NEW part. A prior `{source_name}` draft in the workspace is NOT an "
            "approved deliverable — only reuse it if it clearly matches the CAD brief and user "
            "request. Otherwise rewrite it from the brief + reference meshes. Measure the "
            "reference geometry; do not keep a generic placeholder clip.\n"
        )
    parts_block = f"\n{parts_inventory.strip()}\n" if str(parts_inventory or "").strip() else ""
    stem = Path(step_name).stem
    return with_multilingual_prompt_rule(f"""Use the $cad skill (earthtojake/text-to-cad). You are the CAD authoring agent for this project.

Task mode: {mode}.
For EDIT/REVISE, preserve the selected model's identity and all existing geometry
except the explicitly requested changes. Additions extend that model; a new
standalone feature is not a replacement for the complete selected model.
Reference geometry_context.point_source is in the loaded file's source frame;
point_world includes viewport placement, and point_mesh_local is per-mesh.
Verify source units and mesh/STEP correspondence before using any coordinates.
Do not use UI label dimensions as measurements. For an EDIT whose selected geometry
reference cannot be resolved, stop rather than exporting an unrelated replacement.
User request:
{prompt.strip()}

CAD brief:
{cad_brief.strip()}
{prev}
Required workflow (do not skip):
1. Author/edit a cadgen `@step` model as `{source_name}` (or legacy `gen_step()` — both work). Return the ASSEMBLED layout.
2. For multi-part assemblies, also define `gen_exploded()` when using gen_step(); `@step` assemblies compose by calling child models.
3. Run from this workspace: `python scripts/step {source_name} --glb {glb_name}`
   (scripts/step auto-writes `{stem}_exploded.step/.glb` when gen_exploded exists). Do NOT pass `--stl` or write `.stl` — live viewport drawing is GLB only.
4. On failure: classify, fix the smallest responsible source section, rerun step.
5. Validate: `python scripts/inspect refs {step_name} --facts --planes --positioning`
6. Mandatory snapshot with the installed CLI shape (NOT a bare STEP arg):
   `python scripts/snapshot --input {step_name} --output {Path(step_name).stem}_snapshot.png --camera iso --view-labels --size-profile diagnostic`
   Snapshot is mandatory. If snapshot tooling fails, do not finish — repair the environment or the model and rerun snapshot.
7. Repair until scripts/step, inspect, AND snapshot all succeed. Do not publish without snapshot PNGs.

Rules:
- Millimeters. `gen_step()` returns the assembled STEP-ready shape; do not write files inside gen_step().
- Prefer surgical edits over full-file rewrites when revising; for NEW parts, a full rewrite is fine.
- Never assign bare floats to list-like `*_positions` constants (wrong: `rod_hole_positions = 10.0`).
- When the prompt mentions motors/servos/ESC/battery/wiring/electronics: model visible labeled electronics solids and wire runs — not empty pockets alone.
- Target basenames: source={source_name}, step={step_name}, glb={glb_name} (assembled primary).
- Do not export STL (`--stl`, `@stl`, or `{stl_name}`). STL is a download, not a live-draw mesh.
- Skip `$cad-viewer` handoff — Render Studio owns the product viewer. Report final file names when done.
- Do not ask clarifying questions; proceed with explicit assumptions.
- {UNRESOLVED_PURCHASED_INTERFACE_RULES}
- Other STEP/GLB files in this project are live parts. Inspect them (`python scripts/inspect refs <file>.step --facts --planes --positioning`). Do not re-import or rescale them into a new compound. Author only the new solid; the host FreeCAD kernel places it beside existing parts or merges it into the live assembly STEP. To move an existing file without rewriting it, write `r3d_placements.json` with millimetre translation / rotation_deg.
{parts_block}
""")


def _stage_from_text(text: str) -> str:
    lower = (text or "").lower()
    if "scripts/snapshot" in lower or "snapshot" in lower:
        return "snapshot"
    if "scripts/inspect" in lower or "inspect refs" in lower:
        return "inspect"
    if "scripts/step" in lower or "gen_step" in lower:
        return "step"
    if "brief" in lower:
        return "brief"
    if "repair" in lower or "fix" in lower or "str_replace" in lower or "edit" in lower:
        return "repair"
    return "authoring"


def _item_plain_text(item: dict[str, Any], event: dict[str, Any]) -> str:
    """Best-effort text from a Codex JSONL item (message, reasoning, or delta)."""
    for key in ("text", "message"):
        val = item.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    content = item.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        bits: list[str] = []
        for part in content:
            if isinstance(part, str) and part.strip():
                bits.append(part.strip())
            elif isinstance(part, dict):
                piece = str(part.get("text") or part.get("content") or "").strip()
                if piece:
                    bits.append(piece)
        if bits:
            return "\n".join(bits)
    delta = item.get("delta") if isinstance(item.get("delta"), (str, dict)) else event.get("delta")
    if delta is None and isinstance(event.get("delta"), (str, dict)):
        delta = event.get("delta")
    if isinstance(delta, str) and delta.strip():
        return delta.strip()
    if isinstance(delta, dict):
        for key in ("text", "content", "reasoning"):
            val = delta.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
            if isinstance(val, list):
                bits = []
                for part in val:
                    if isinstance(part, str) and part.strip():
                        bits.append(part.strip())
                    elif isinstance(part, dict) and str(part.get("text") or "").strip():
                        bits.append(str(part.get("text")).strip())
                if bits:
                    return "\n".join(bits)
    summary = item.get("summary")
    if isinstance(summary, list):
        bits: list[str] = []
        for part in summary:
            if isinstance(part, dict) and str(part.get("text") or "").strip():
                bits.append(str(part.get("text")).strip())
            elif isinstance(part, str) and part.strip():
                bits.append(part.strip())
        if bits:
            return "\n".join(bits)
    top = event.get("text")
    if isinstance(top, str) and top.strip() and "item" not in str(event.get("type") or "").lower():
        return top.strip()
    return ""


def _event_activity(event: dict[str, Any]) -> tuple[str | None, str | None, bool]:
    """Return (stage, activity_text, is_thinking) from a Codex JSONL event."""
    etype = str(event.get("type") or "")
    item = event.get("item") if isinstance(event.get("item"), dict) else {}
    item_type = str(item.get("type") or "")
    thinking_types = {"reasoning", "agent_reasoning", "thinking"}
    is_thinking = (
        item_type in thinking_types
        or "reasoning" in etype.lower()
        or "thinking" in etype.lower()
    )

    if item_type in thinking_types or etype in {
        "item.delta",
        "item.updated",
        "agent_message.delta",
        "agent_reasoning.delta",
        "response.reasoning_summary_text.delta",
    }:
        text = _item_plain_text(item, event)
        if text and (is_thinking or item_type in {"agent_message", "reasoning", "agent_reasoning", "thinking"}):
            return "authoring", text[:2000], True
        if text and is_thinking:
            return "authoring", text[:2000], True
    if etype == "item.completed" and item_type == "agent_message":
        text = _item_plain_text(item, event)
        if text:
            return _stage_from_text(text), text[:2000], True
    if etype == "item.completed" and item_type in {"command_execution", "bash", "shell_call", "tool_call"}:
        cmd = (
            item.get("command")
            or item.get("cmd")
            or item.get("input")
            or item.get("text")
            or ""
        )
        cmd_s = str(cmd).strip()
        if cmd_s:
            return _stage_from_text(cmd_s), f"$ {cmd_s[:240]}", False
    if etype == "item.started" and item:
        summary = str(item.get("command") or item.get("text") or item.get("type") or "").strip()
        if summary and item_type not in {"reasoning", "agent_reasoning", "thinking"}:
            return _stage_from_text(summary), summary[:240], False
    if etype in {"turn.started", "thread.started"}:
        return "authoring", "Codex CAD agent started", False
    if etype == "turn.completed":
        return "authoring", "Codex turn completed", False
    if etype == "error":
        msg = str(event.get("message") or event.get("error") or "Codex error")
        return "authoring", msg[:280], False
    return None, None, False


def _normalize_codex_usage_block(block: Any) -> dict[str, int] | None:
    """Map a Codex token-usage object onto Render Studio's usage dict."""
    if not isinstance(block, dict):
        return None
    inp = int(block.get("input_tokens") or 0)
    out = int(block.get("output_tokens") or 0)
    cached = int(block.get("cached_input_tokens") or 0)
    reasoning = int(
        block.get("reasoning_output_tokens")
        or block.get("reasoning_tokens")
        or 0
    )
    total = int(block.get("total_tokens") or 0) or (inp + out)
    if inp <= 0 and out <= 0 and cached <= 0 and total <= 0:
        return None
    payload: dict[str, int] = {
        "input_tokens": inp,
        "output_tokens": out,
        "total_tokens": total or (inp + out),
    }
    if cached:
        payload["cached_input_tokens"] = cached
    if reasoning:
        payload["reasoning_tokens"] = reasoning
    return payload


def usage_from_codex_event(event: dict[str, Any] | None) -> dict[str, int] | None:
    """Extract usage from one ``codex exec --json`` event, if present."""
    if not isinstance(event, dict):
        return None
    etype = str(event.get("type") or "")
    if etype == "turn.completed" and isinstance(event.get("usage"), dict):
        return _normalize_codex_usage_block(event.get("usage"))
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else None
    inner = payload if etype == "event_msg" and payload else event
    if str(inner.get("type") or "") != "token_count":
        return None
    info = inner.get("info") if isinstance(inner.get("info"), dict) else inner
    if not isinstance(info, dict):
        return None
    return _normalize_codex_usage_block(
        info.get("total_token_usage") or info.get("last_token_usage") or info
    )


def usage_from_codex_events(events: list[dict[str, Any]] | None) -> dict[str, int] | None:
    """Prefer session-cumulative ``total_token_usage``; else sum turn.completed."""
    latest_total: dict[str, int] | None = None
    turn_sum: dict[str, int] = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "cached_input_tokens": 0,
        "reasoning_tokens": 0,
    }
    turns = 0
    for event in events or []:
        if not isinstance(event, dict):
            continue
        etype = str(event.get("type") or "")
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else None
        inner = payload if etype == "event_msg" and payload else event
        if str((inner or {}).get("type") or "") == "token_count":
            parsed = usage_from_codex_event(event)
            if parsed:
                latest_total = parsed
            continue
        if etype == "turn.completed":
            parsed = _normalize_codex_usage_block(event.get("usage"))
            if parsed:
                turns += 1
                for key, value in parsed.items():
                    turn_sum[key] = int(turn_sum.get(key) or 0) + int(value or 0)
    if latest_total:
        return latest_total
    if turns:
        if not turn_sum.get("total_tokens"):
            turn_sum["total_tokens"] = turn_sum["input_tokens"] + turn_sum["output_tokens"]
        return {key: value for key, value in turn_sum.items() if value}
    return None


def usage_from_codex_jsonl(text: str | None) -> dict[str, int] | None:
    events: list[dict[str, Any]] = []
    for line in str(text or "").splitlines():
        raw = line.strip()
        if not raw.startswith("{"):
            continue
        try:
            event = json.loads(raw)
        except Exception:
            continue
        if isinstance(event, dict):
            events.append(event)
    return usage_from_codex_events(events)


def _pick_artifacts(
    project_path: Path,
    preferred_base: str,
    *,
    min_mtime: float | None = None,
    require_fresh: bool = False,
    preferred_only: bool = False,
) -> dict[str, str]:
    """Find the best source/step/glb trio after Codex finishes.

    When ``require_fresh`` is set with ``min_mtime`` (unix seconds), ignore
    pre-existing STEP/GLB exports that were not rewritten during this run.
    That prevents early-accept from treating an older project model as the
    new generation result.
    """
    from backend.services.cad_authoring_agent import source_has_cad_model

    preferred_base = re.sub(r"[^a-zA-Z0-9_-]+", "_", preferred_base).strip("_") or "model"
    candidates: list[tuple[float, str, Path, Path, Path]] = []
    slack = 2.0

    def _is_fresh(path: Path) -> bool:
        if min_mtime is None:
            return True
        try:
            return path.stat().st_mtime >= (min_mtime - slack)
        except OSError:
            return False

    for py in project_path.glob("*.py"):
        if py.name.startswith(".") or py.name == "AGENTS.md":
            continue
        try:
            text = py.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if not source_has_cad_model(text):
            continue
        stem = py.stem
        if preferred_only and stem != preferred_base:
            continue
        step = project_path / f"{stem}.step"
        glb = project_path / f"{stem}.glb"
        jake_glb = project_path / f".{stem}.step.glb"
        if jake_glb.is_file() and (not glb.is_file() or (
            require_fresh and not _is_fresh(glb) and _is_fresh(jake_glb)
        )):
            try:
                shutil.copy2(jake_glb, glb)
            except Exception:
                glb = jake_glb
        if not step.is_file():
            continue
        if require_fresh and not (_is_fresh(step) and glb.is_file() and _is_fresh(glb)):
            continue
        score = step.stat().st_mtime
        if stem == preferred_base:
            score += 1e12
        if glb.is_file():
            score += 1e6
            if require_fresh and _is_fresh(glb):
                score += 1e5
        if require_fresh and _is_fresh(step):
            score += 5e4
        if require_fresh and _is_fresh(py):
            score += 1e4
        candidates.append((score, stem, py, step, glb if glb.is_file() else step))

    if not candidates:
        # Fall back to preferred names if present (and fresh when required).
        py = project_path / f"{preferred_base}.py"
        step = project_path / f"{preferred_base}.step"
        glb = project_path / f"{preferred_base}.glb"
        if py.is_file() and step.is_file() and (not require_fresh or (_is_fresh(step) and glb.is_file() and _is_fresh(glb))):
            return {
                "source": py.name,
                "step": step.name,
                "glb": glb.name if glb.is_file() else step.name,
                "base": preferred_base,
            }
        raise CodexFailed(
            "Codex finished without fresh STEP and GLB exports for a Python generator."
            if require_fresh
            else "Codex finished without a gen_step() Python + STEP pair."
        )

    candidates.sort(key=lambda row: row[0], reverse=True)
    _, stem, py, step, glb = candidates[0]
    out_glb = project_path / f"{stem}.glb"
    if not out_glb.is_file() and glb.is_file() and glb.suffix == ".glb":
        out_glb = glb
    return {
        "source": py.name,
        "step": step.name,
        "glb": out_glb.name if out_glb.is_file() else f"{stem}.glb",
        "base": stem,
    }


def run_codex_agent(
    *,
    project_path: Path,
    prompt: str,
    cad_brief: str,
    source_name: str,
    step_name: str,
    glb_name: str,
    stl_name: str | None = None,
    three_mf_name: str | None = None,
    previous_source: str | None = None,
    is_edit: bool = False,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
    trace_id: str | None = None,
    timeout_sec: float | None = None,
    model: str | None = None,
    user_id: str | None = None,
    ai: Any = None,
) -> dict[str, Any]:
    """Run Codex / Cursor / Claude non-interactively with the CAD skill in ``project_path``."""
    from types import SimpleNamespace

    from backend.services.cad_host_runtime import resolve_codex_launch

    stub = ai or SimpleNamespace(
        billing_source="chatgpt_subscription",
        billing_user_id=user_id,
        model=model,
        provider="openai",
        api_key="",
    )
    if model and not getattr(stub, "model", None):
        stub.model = model
    billing = str(getattr(stub, "billing_source", "") or "")
    if billing in {"cursor_subscription", "claude_subscription"}:
        from backend.services.cli_subscription_ai import cli_host_id
        from backend.services.cli_subscription_llm import exec_in_workspace as cli_exec

        project_path = Path(project_path).resolve()
        project_path.mkdir(parents=True, exist_ok=True)
        skill_dir = _cad_skill_dir()
        _ensure_project_scripts(project_path, skill_dir)
        _ensure_project_agents_md(project_path)
        started = time.time()
        agent_prompt = _build_prompt(
            prompt=prompt,
            cad_brief=cad_brief,
            source_name=source_name,
            step_name=step_name,
            glb_name=glb_name,
            stl_name=stl_name or f"{Path(source_name).stem}.stl",
            three_mf_name=three_mf_name or f"{Path(source_name).stem}.3mf",
            is_edit=is_edit,
            previous_source=previous_source,
            parts_inventory="",
        )
        last_message, _trace = cli_exec(
            host=cli_host_id(stub),
            project_path=project_path,
            prompt=agent_prompt,
            trace_id=trace_id,
            timeout_sec=timeout_sec,
            usage_callback=usage_callback,
            cancel_check=cancel_check,
            progress_callback=progress_callback,
            user_id=str(getattr(stub, "billing_user_id", None) or user_id or ""),
            model=str(getattr(stub, "model", None) or model or ""),
        )
        try:
            artifacts = _pick_artifacts(
                project_path,
                Path(source_name).stem,
                min_mtime=started,
                require_fresh=True,
                preferred_only=is_edit,
            )
        except CodexFailed as exc:
            if is_edit:
                raise CodexEditNotProduced("Edit Selected produced no fresh result. " + last_message[:2000]) from exc
            raise
        return {
            "ok": True,
            "runtime": cli_host_id(stub),
            "source": artifacts["source"],
            "step": artifacts["step"],
            "glb": artifacts["glb"],
            "base": artifacts["base"],
            "summary": last_message or "CAD agent completed.",
            "exit_code": 0,
            "events": [],
            "usage": {},
            "skill_dir": str(skill_dir),
        }
    launch = resolve_codex_launch(stub, user_id=user_id, project_path=Path(project_path))
    home = launch.home
    auth_mode = _codex_auth_mode(home)
    if not home and auth_mode in {"chatgpt", "chat_gpt"}:
        raise CodexUnavailable(
            "Codex CLI is signed in with a ChatGPT account, which cannot use API Codex "
            "models (gpt-5.3-codex). Sign in under Subscriptions so CAD uses your ChatGPT "
            "login, or add an OpenAI API key."
        )
    codex = resolve_codex_bin()
    if not codex:
        raise CodexUnavailable(
            "Codex CLI not found. Install Codex or set CODEX_BIN to the binary path."
        )

    project_path = Path(project_path).resolve()
    project_path.mkdir(parents=True, exist_ok=True)
    skill_dir = _cad_skill_dir()
    _ensure_project_scripts(project_path, skill_dir)
    _ensure_project_agents_md(project_path)
    _trust_project_in_codex_config(project_path, home)

    base = Path(source_name).stem
    stl_name = stl_name or f"{base}.stl"
    three_mf_name = three_mf_name or f"{base}.3mf"

    if previous_source and is_edit:
        src_path = project_path / source_name
        if not src_path.is_file():
            src_path.write_text(previous_source.rstrip() + "\n", encoding="utf-8")

    parts_md = ""
    try:
        from backend.services.cad_harness import format_parts_inventory_markdown, project_parts_inventory

        parts_md = format_parts_inventory_markdown(project_parts_inventory(project_path))
        if parts_md:
            (project_path / "PROJECT_PARTS.md").write_text(parts_md + "\n", encoding="utf-8")
    except Exception:
        parts_md = ""

    agent_prompt = _build_prompt(
        prompt=prompt,
        cad_brief=cad_brief,
        source_name=source_name,
        step_name=step_name,
        glb_name=glb_name,
        stl_name=stl_name,
        three_mf_name=three_mf_name,
        is_edit=is_edit,
        previous_source=previous_source,
        parts_inventory=parts_md,
    )

    from backend.services.codex_launch_env import codex_launch_env

    env = codex_launch_env(dict(launch.env or {}))
    env["PYTHONPATH"] = _pythonpath_for_skill(skill_dir)
    env.pop("PYTHONHOME", None)
    venv_bin = _venv_bin()
    if venv_bin:
        env["PATH"] = f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"
        env["VIRTUAL_ENV"] = str(venv_bin.parent)
    from backend.services.skill_runner import _inject_cad_node

    _inject_cad_node(env)
    env.setdefault("CADGEN_DAEMON", "0")
    env["INIT_CWD"] = str(project_path)
    env["PWD"] = str(project_path)
    env["CODEX_HOME"] = str(home)
    env["TERM"] = env.get("TERM") or "dumb"
    if launch.pop_openai_key:
        env.pop("OPENAI_API_KEY", None)

    cmd = [
        str(codex),
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-C",
        str(project_path),
        "-s",
        "workspace-write",
        "--dangerously-bypass-approvals-and-sandbox",
        "--ephemeral",
    ]
    if launch.extra_cli:
        cmd.extend(launch.extra_cli)
    cli_model = launch.cli_model
    if cli_model:
        cmd.extend(["-m", str(cli_model)])
    cmd.append("-")  # read prompt from stdin

    timeout = float(timeout_sec or os.environ.get("CODEX_TIMEOUT_SEC") or os.environ.get("JAKE_CODEX_TIMEOUT_SEC") or DEFAULT_TIMEOUT_SEC)
    started_at = time.time()

    def _emit(stage: str, text: str, pct: int | None = None, *, thinking: bool = False) -> None:
        if not progress_callback:
            return
        payload: dict[str, Any] = {"stage": stage}
        if thinking:
            payload["thinking"] = text[:4000]
            payload["thinking_append"] = text[:2000]
        else:
            payload["label"] = text
            payload["thinking"] = text
        if pct is not None:
            payload["pct"] = pct
        try:
            from backend.services.cad_service import mcmaster_parts_progress

            payload.update(mcmaster_parts_progress(project_path))
        except Exception:
            pass
        progress_callback(payload)

    def _mcm_extra() -> dict[str, Any]:
        try:
            from backend.services.cad_service import mcmaster_parts_progress

            return mcmaster_parts_progress(project_path)
        except Exception:
            return {}

    def _maybe_live_preview(label: str = "CAD · drawing in viewport…") -> None:
        if not progress_callback:
            return
        try:
            from backend.services.live_preview import publish_live_preview

            publish_live_preview(
                progress_callback,
                project_path,
                min_mtime=started_at,
                extra=_mcm_extra() or None,
                label=label,
            )
        except Exception:
            pass

    _emit(
        "authoring",
        f"Starting Codex CAD agent ({cli_model})…" if cli_model else "Starting Codex CAD agent…",
        18,
    )
    trace_add(
        "info",
        f"[2.0/text-to-cad] Codex agent: {codex} model={cli_model or 'chatgpt-default'} in {project_path}",
        trace_id=trace_id,
    )

    last_message_path = project_path / ".codex_last_message.txt"
    if last_message_path.exists():
        try:
            last_message_path.unlink()
        except Exception:
            pass
    cmd_with_out = list(cmd)
    # Insert output-last-message before the final "-" stdin marker.
    cmd_with_out[-1:-1] = ["-o", str(last_message_path)]

    proc = subprocess.Popen(
        cmd_with_out,
        cwd=str(project_path),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None

    # Feed prompt and close stdin so Codex does not hang on "Reading additional input".
    try:
        proc.stdin.write(agent_prompt)
        proc.stdin.close()
    except Exception:
        pass

    events: list[dict[str, Any]] = []
    activity_n = 0
    stderr_chunks: list[str] = []
    stop_reader = threading.Event()

    def _read_stderr() -> None:
        assert proc.stderr is not None
        try:
            for line in proc.stderr:
                stderr_chunks.append(line)
                if stop_reader.is_set():
                    break
        except Exception:
            return

    err_thread = threading.Thread(target=_read_stderr, name="codex-stderr", daemon=True)
    err_thread.start()

    deadline = time.monotonic() + timeout
    last_usage_sig: tuple[int, int, int] | None = None

    def _emit_usage() -> None:
        nonlocal last_usage_sig
        if not usage_callback:
            return
        usage = usage_from_codex_events(events)
        if not usage:
            return
        sig = (
            int(usage.get("input_tokens") or 0),
            int(usage.get("output_tokens") or 0),
            int(usage.get("total_tokens") or 0),
        )
        if sig == last_usage_sig:
            return
        last_usage_sig = sig
        try:
            usage_callback(usage)
        except Exception:
            pass

    preview_stop = threading.Event()
    if progress_callback:
        try:
            from backend.services.live_preview import start_live_preview_watcher

            preview_stop, _preview_thread = start_live_preview_watcher(
                project_path,
                progress_callback,
                min_mtime=started_at,
                extra_fn=_mcm_extra,
            )
        except Exception:
            pass
    try:
        while True:
            if cancel_check and cancel_check():
                _kill_proc(proc)
                raise RuntimeError("Generation canceled.")
            if time.monotonic() > deadline:
                _kill_proc(proc)
                # Prefer returning a renderable model over hard-failing after timeout,
                # but only if Codex actually wrote fresh artifacts during this run.
                try:
                    early = _pick_artifacts(
                        project_path,
                        base,
                        min_mtime=started_at,
                        require_fresh=True,
                    )
                    if (project_path / early["glb"]).is_file() and (project_path / early["step"]).is_file():
                        events.append({"type": "render3d.early_accept", "reason": "timeout_with_artifacts"})
                        break
                except Exception:
                    pass
                raise CodexFailed(f"Codex CAD agent timed out after {int(timeout)}s.")

            activity_holder = {"n": activity_n}
            if proc.poll() is not None:
                # Drain remaining stdout.
                rest = proc.stdout.read() or ""
                for line in rest.splitlines():
                    prev_n = activity_holder["n"]
                    _handle_json_line(
                        line,
                        events=events,
                        emit=_emit,
                        activity_n_holder=activity_holder,
                    )
                activity_n = activity_holder["n"]
                _emit_usage()
                break
            line = proc.stdout.readline()
            if not line:
                time.sleep(0.05)
                continue
            activity_n = _handle_json_line(
                line,
                events=events,
                emit=_emit,
                activity_n_holder=activity_holder,
            )
            _emit_usage()
            if events and _event_is_chatgpt_model_unsupported(events[-1]):
                _kill_proc(proc)
                raise CodexUnavailable(
                    "Codex ChatGPT login cannot use the API Codex model id. "
                    "Falling back to the selected BYOK model."
                )

    finally:
        preview_stop.set()
        stop_reader.set()
        try:
            proc.wait(timeout=2)
        except Exception:
            _kill_proc(proc)
        err_thread.join(timeout=1.0)

    if any(_event_is_chatgpt_model_unsupported(ev) for ev in events):
        raise CodexUnavailable(
            "Codex ChatGPT login cannot use the API Codex model id. "
            "Falling back to the selected BYOK model."
        )

    exit_code = proc.returncode if proc.returncode is not None else -1
    last_message = ""
    if last_message_path.is_file():
        try:
            last_message = last_message_path.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            last_message = ""
    if looks_like_codex_jsonl(last_message):
        last_message = ""
    cli_fail = codex_cli_failure_message(
        text=last_message,
        events=events,
        stderr="".join(stderr_chunks),
        auth_label=launch.auth_label,
    )
    if cli_fail:
        if is_edit:
            raise CodexEditNotProduced(cli_fail)
        raise CodexFailed(cli_fail)

    artifacts = None
    artifact_error = None
    if is_edit and exit_code != 0:
        raise CodexEditNotProduced(
            f"Edit Selected did not finish successfully (exit {exit_code}); no result was applied. "
            + last_message[:2000]
        )
    try:
        artifacts = _pick_artifacts(
            project_path,
            base,
            min_mtime=started_at,
            require_fresh=True,
            preferred_only=is_edit,
        )
    except Exception as exc:
        artifact_error = str(exc)
        if is_edit:
            raise CodexEditNotProduced(
                "Edit Selected produced no fresh STEP and GLB. The existing model must remain loaded. "
                + (last_message[:2000] or artifact_error)
            ) from exc

    if is_edit and artifacts and artifacts["base"] != base:
        raise CodexEditNotProduced(
            f"Edit Selected returned {artifacts['base']} instead of the selected model {base}. "
            "The result was not applied. " + last_message[:1000]
        )

    if artifacts is None:
        detail = artifact_error or "no STEP artifacts"
        stderr_tail = "".join(stderr_chunks)[-2000:]
        raise CodexFailed(
            f"Codex CAD agent exit={exit_code}: {detail}. "
            f"last_message={last_message[:500]!r} stderr={stderr_tail[:800]!r}"
        )

    # Ensure shell GLB basename exists when only the hidden sidecar was written.
    glb_path = project_path / artifacts["glb"]
    jake_hidden = project_path / f".{artifacts['base']}.step.glb"
    if not glb_path.is_file() and jake_hidden.is_file():
        shutil.copy2(jake_hidden, project_path / f"{artifacts['base']}.glb")
        artifacts["glb"] = f"{artifacts['base']}.glb"
        glb_path = project_path / artifacts["glb"]
    _maybe_live_preview("CAD · drawing in viewport…")

    placements: list[dict[str, Any]] = []
    used: list[dict[str, Any]] = []
    try:
        from backend.services.cad_harness import finalize_harness_run

        finalized = finalize_harness_run(
            project_path,
            published_step=artifacts.get("step"),
            is_edit=bool(is_edit),
        ) or {}
        placements = list(finalized.get("placements") or [])
        used = list(finalized.get("mcmaster_used") or [])
        if placements:
            _emit("finalize", f"Rearranged {len(placements)} existing part(s)", 90)
            trace_add(
                "info",
                f"[2.0/text-to-cad] Applied {len(placements)} project placements",
                trace_id=trace_id,
            )
    except Exception as exc:
        logger.warning("Could not finalize harness artifacts: %s", exc)

    _emit("finalize", f"Codex finished: {artifacts['source']} → {artifacts['step']}", 88)
    usage = usage_from_codex_events(events)
    _emit_usage()
    trace_add(
        "info",
        f"[2.0/text-to-cad] Codex produced {artifacts['source']} / {artifacts['step']}",
        trace_id=trace_id,
    )

    return {
        "ok": True,
        "runtime": "codex",
        "source": artifacts["source"],
        "step": artifacts["step"],
        "glb": artifacts["glb"],
        "base": artifacts["base"],
        "summary": last_message or "Codex CAD agent completed.",
        "exit_code": exit_code,
        "events": events[-80:],
        "usage": usage,
        "codex_bin": str(codex),
        "skill_dir": str(skill_dir),
        "placements": placements,
        "mcmaster_used": used,
    }


def _handle_json_line(
    line: str,
    *,
    events: list[dict[str, Any]],
    emit: Callable[..., None],
    activity_n_holder: dict[str, int],
) -> int:
    raw = (line or "").strip()
    if not raw:
        return activity_n_holder.get("n", 0)
    try:
        event = json.loads(raw)
    except Exception:
        return activity_n_holder.get("n", 0)
    if not isinstance(event, dict):
        return activity_n_holder.get("n", 0)
    events.append(event)
    stage, text, is_thinking = _event_activity(event)
    if text:
        n = int(activity_n_holder.get("n", 0)) + 1
        activity_n_holder["n"] = n
        stage_id = stage or "authoring"
        base = {
            "analyze": 10,
            "brief": 18,
            "authoring": 28,
            "ai_source": 28,
            "repair": 34,
            "step": 48,
            "export": 52,
            "inspect": 62,
            "snapshot": 78,
            "snapshot_review": 88,
            "finalize": 94,
            "done": 100,
        }.get(stage_id, 28)
        # Event count only nudges within the stage — Astra JSONL used to hit 85% in seconds.
        pct = min(94, base + min(6, n // 4))
        emit(stage_id, text, pct, thinking=is_thinking)
        return n
    return activity_n_holder.get("n", 0)


def _kill_proc(proc: subprocess.Popen) -> None:
    try:
        pgid = os.getpgid(proc.pid)
    except Exception:
        pgid = -1
    if pgid > 0:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(pgid, sig)
            except Exception:
                break
            time.sleep(0.1)
    try:
        if proc.poll() is None:
            proc.kill()
    except Exception:
        pass


def run_codex_agent_safe(**kwargs: Any) -> dict[str, Any]:
    """Same as ``run_codex_agent`` — kept for symmetry with tool agent."""
    return run_codex_agent(**kwargs)
