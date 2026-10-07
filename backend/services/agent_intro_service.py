"""Agent Introductions pack: traces, wipeable sandbox, handshake."""

from __future__ import annotations

import json
import shutil
import time
import traceback as tbmod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "logs" / "Agent_Introductions"
REFPACK = PACK / "RefPack"
REF_ID = "INTRO-20260916"
PAIR_ID = "PAIR-INTRO-20260916"
PHRASE = "deez nutz"
ALLOWED_OPS = {"ping", "add", "fail"}
FORBIDDEN_UPLOAD_NAMES = {".env", "credentials.json", "secrets.json", ".env.local"}
ALLOWED_UPLOAD_ROOTS = (
    PACK,
    ROOT / "Getting-Started",
    ROOT / "ai-context",
    ROOT / "mcp" / "grok-bot",
    ROOT / "backend" / "services",
    ROOT / "backend" / "routers",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def pack_info() -> dict[str, Any]:
    return {
        "ref_id": REF_ID,
        "pair_id": PAIR_ID,
        "path": str(PACK),
        "refpack": str(REFPACK),
        "session_md": str(REFPACK / "SESSION-COMBINED.md"),
        "session_json": str(REFPACK / "SESSION-COMBINED.json"),
        "pm": str(PACK / "PM.md"),
        "mcp": [
            "agent_intro_pack",
            "agent_intro_handshake",
            "agent_sandbox_reset",
            "agent_sandbox_run",
            "agent_refpack_upload",
            "pm_prompt_kit",
            "pm_prompt_submit",
            "pm_prompt_status",
        ],
        "prompts": ["pm-first-loop", "pm-hire-screen"],
        "phrase_hint": "project-manager replies the handshake phrase if Cursor arrived first",
    }


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def refpack_upload(agent: str, src: str) -> dict[str, Any]:
    path = Path(src).expanduser()
    if not path.is_absolute():
        path = (ROOT / src).resolve()
    else:
        path = path.resolve()
    if path.name in FORBIDDEN_UPLOAD_NAMES or path.suffix.lower() in {".pem", ".key"}:
        raise ValueError("forbidden file")
    if not path.is_file():
        raise ValueError("file not found")
    if not any(_is_under(path, root) for root in ALLOWED_UPLOAD_ROOTS):
        raise ValueError("path not allowlisted for RefPack")
    dest_dir = REFPACK / "uploads" / str(agent or "unknown")[:40]
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / path.name
    shutil.copy2(path, dest)
    row = log_trace("refpack_upload", True, {"agent": str(agent)[:40], "src": str(path)[-80:], "dest": str(dest)[-80:]})
    return {
        "ok": True,
        "ref_id": REF_ID,
        "pair_id": PAIR_ID,
        "agent": str(agent or "unknown")[:40],
        "dest": str(dest),
        "trace": row,
    }


def _trace_path() -> Path:
    path = PACK / "traces" / "trace.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def log_trace(op: str, ok: bool, extra: dict[str, Any] | None = None, err: BaseException | None = None) -> dict[str, Any]:
    frame = tbmod.extract_stack(limit=8)[-2] if err is None else tbmod.extract_tb(err.__traceback__)[-1]
    row = {
        "ref_id": REF_ID,
        "traceback_id": f"tb_{op}",
        "op": op,
        "ok": ok,
        "ts": _now(),
        "file": str(getattr(frame, "filename", "") or "")[-80:],
        "line": int(getattr(frame, "lineno", 0) or 0),
        "error": (str(err)[:240] if err else ""),
    }
    if extra:
        row.update(extra)
    path = _trace_path()
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
        if path.stat().st_size > 2_000_000:
            path.replace(path.with_suffix(".jsonl.1"))
    return row


def sandbox_dir() -> Path:
    path = PACK / "sandbox"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sandbox_reset() -> dict[str, Any]:
    path = sandbox_dir()
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)
    (path / "scratch.txt").write_text("reset " + _now() + "\n", encoding="utf-8")
    row = log_trace("sandbox_reset", True)
    return {"ok": True, "path": str(path), "trace": row}


def sandbox_run(op: str, a: int = 0, b: int = 0) -> dict[str, Any]:
    name = str(op or "ping").strip().lower()
    if name not in ALLOWED_OPS:
        raise ValueError("op must be ping, add, or fail")
    try:
        if name == "fail":
            raise RuntimeError("sandbox fail (intentional)")
        result: Any = "pong" if name == "ping" else int(a) + int(b)
        (sandbox_dir() / "last.json").write_text(json.dumps({"op": name, "result": result}), encoding="utf-8")
        row = log_trace(name, True, {"result": result})
        return {"ok": True, "result": result, "trace": row}
    except Exception as exc:
        row = log_trace(name, False, err=exc)
        return {"ok": False, "trace": row}


def handshake(agent: str, phrase: str) -> dict[str, Any]:
    got = " ".join(str(phrase or "").lower().split())
    expect = PHRASE
    ok = got == expect
    rec = {
        "agent": str(agent or "unknown")[:40],
        "ok": ok,
        "ts": _now(),
        "ref_id": REF_ID,
        "elapsed_hint_ms": None,
    }
    dest = PACK / "handshake" / f"{rec['agent']}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    log_trace("handshake", ok, {"agent": rec["agent"]})
    out = dict(rec)
    if ok:
        out["code_word"] = PHRASE
    return out


def handshake_status() -> dict[str, Any]:
    folder = PACK / "handshake"
    files = sorted(folder.glob("*.json")) if folder.is_dir() else []
    rows = []
    for path in files:
        try:
            rows.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    pm = next((r for r in rows if r.get("agent") == "project-manager" and r.get("ok")), None)
    return {"ref_id": REF_ID, "receipts": rows, "pm_ok": bool(pm)}
