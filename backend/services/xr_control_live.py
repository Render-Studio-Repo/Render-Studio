"""Live VR control config, notes, and wire-to-scene queue. Token xrctrl2.

Headset polls GET /mcp/sandbox/controls or /api/xr/control-config.
Edits apply to the current session when simulate or listen is on.
Wiring into Sam's production scene stays pending_approval until explicit Approve
(same queue pattern as debugger ask_safe). Never auto-applies. Never wipes
roundtbl1/sandbox1 trees.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]

TOKEN = "xrctrl2"
PRIVILEGE = "xr.controls.wire_scene"
DATA_DIR = ROOT_DIR / "data" / "xr-control-live"
CONTROLS_PATH = DATA_DIR / "controls.json"
WIRE_PATH = DATA_DIR / "wire-queue.json"
NOTES_PATH = DATA_DIR / "notes.jsonl"
SANDBOX_CONTROLS = ROOT_DIR / "frontend" / "sandbox" / "controls.json"
SANDBOX_NOTES = ROOT_DIR / "frontend" / "sandbox" / "control-notes.jsonl"

SEED_NOTES = (
    {
        "feature": "trigger",
        "ok": False,
        "attempt": "selectstart on Quest AR",
        "note": "Quest often skips controller selectstart; trigger felt dead.",
    },
    {
        "feature": "trigger",
        "ok": True,
        "attempt": "poll gamepad buttons[0]",
        "note": "Poll buttons[0] fires present even when selectstart is missing.",
    },
    {
        "feature": "dimos",
        "ok": False,
        "attempt": "empty visor overlay owns trigger",
        "note": "DimOS overlay stole trigger while Astra talk / Studio HUD needed it.",
    },
    {
        "feature": "dimos",
        "ok": True,
        "attempt": "ui beats overlay",
        "note": "Studio HUD / overlayHit wins; empty visor must not eat trigger.",
    },
    {
        "feature": "squeeze",
        "ok": False,
        "attempt": "grip-only grab",
        "note": "Grip worked, trigger did not — grab felt squeeze-only.",
    },
    {
        "feature": "grab",
        "ok": True,
        "attempt": "squeeze OR trigger",
        "note": "Squeeze or trigger alone can grab CAD.",
    },
    {
        "feature": "windows",
        "ok": False,
        "attempt": "default spawn distance",
        "note": "Windows too far from the head.",
    },
    {
        "feature": "windows",
        "ok": True,
        "attempt": "clampPanelNearHead",
        "note": "Near-head clamp / closer spawn succeeded.",
    },
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _default_map() -> dict[str, Any]:
    return {
        "trigger": {"btn": 0, "kind": "button", "source": "poll"},
        "squeeze": {"btn": 1, "kind": "button", "source": "grip"},
        "menu": {"btn": 4, "kind": "button"},
        "laser": {"btn": 5, "kind": "button"},
        "stickClick": {"btn": 3, "kind": "button"},
        "restart": {"btn": 7, "kind": "left-menu"},
    }


def default_config() -> dict[str, Any]:
    return {
        "v": 1,
        "token": TOKEN,
        "rev": 1,
        "simulate": False,
        "listen": False,
        "poll_ms": 800,
        "apply_scene": False,
        "wire_status": "idle",
        "headset": "quest3",
        "profiles": {"quest3": _default_map()},
        "session": {
            "selectstart": "ui-then-poll",
            "grab": "squeeze-or-trigger",
            "dimos": "ui-beats-overlay",
            "windows": "near-head",
        },
        "how": (
            "Poll this JSON while the XR session is up. Changing bindings updates "
            "selectstart/squeeze/UI in the current session when simulate or listen is on. "
            "Wire-to-scene stays queued until Sam Approves."
        ),
    }


def _ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SANDBOX_CONTROLS.parent.mkdir(parents=True, exist_ok=True)


def _strip_secrets(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for key, val in obj.items():
            low = str(key).lower()
            if any(s in low for s in ("secret", "password", "token_key", "authorization", "api_key")):
                continue
            out[str(key)[:48]] = _strip_secrets(val)
        return out
    if isinstance(obj, list):
        return [_strip_secrets(v) for v in obj[:80]]
    if isinstance(obj, str):
        return obj[:800]
    return obj


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _normalize_map(raw: Any) -> dict[str, Any]:
    base = _default_map()
    src = raw if isinstance(raw, dict) else {}
    for key, row in base.items():
        item = src.get(key)
        if not isinstance(item, dict):
            continue
        btn = item.get("btn")
        try:
            n = int(btn)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 15:
            next_row = {**row, "btn": n}
            if item.get("kind"):
                next_row["kind"] = str(item.get("kind"))[:24]
            if item.get("source"):
                next_row["source"] = str(item.get("source"))[:24]
            base[key] = next_row
    return base


def normalize_config(raw: Any) -> dict[str, Any]:
    base = default_config()
    src = raw if isinstance(raw, dict) else {}
    try:
        rev = int(src.get("rev") or 1)
    except (TypeError, ValueError):
        rev = 1
    base["rev"] = max(1, rev)
    base["simulate"] = bool(src.get("simulate"))
    base["listen"] = bool(src.get("listen"))
    try:
        poll = int(src.get("poll_ms") or 800)
    except (TypeError, ValueError):
        poll = 800
    base["poll_ms"] = max(250, min(5000, poll))
    base["apply_scene"] = bool(src.get("apply_scene"))
    wire = str(src.get("wire_status") or "idle")[:32]
    if wire not in {"idle", "pending_approval", "approved", "rejected"}:
        wire = "idle"
    base["wire_status"] = wire
    hid = str(src.get("headset") or "quest3")[:24] or "quest3"
    base["headset"] = hid
    profiles = src.get("profiles") if isinstance(src.get("profiles"), dict) else {}
    base["profiles"] = {hid: _normalize_map(profiles.get(hid) or src.get("map") or src.get("bindings"))}
    session = src.get("session") if isinstance(src.get("session"), dict) else {}
    for key in ("selectstart", "grab", "dimos", "windows"):
        if session.get(key):
            base["session"][key] = str(session[key])[:48]
    if src.get("updated"):
        base["updated"] = str(src.get("updated"))[:40]
    return base


def _bump(cfg: dict[str, Any]) -> dict[str, Any]:
    cfg = normalize_config(cfg)
    cfg["rev"] = int(cfg.get("rev") or 1) + 1
    cfg["updated"] = _now()
    cfg["token"] = TOKEN
    return cfg


def load_config() -> dict[str, Any]:
    _ensure_dirs()
    raw = _read_json(CONTROLS_PATH, None)
    if raw is None:
        raw = _read_json(SANDBOX_CONTROLS, None)
    if raw is None:
        cfg = default_config()
        save_config(cfg, bump=False)
        return cfg
    return normalize_config(raw)


def save_config(cfg: dict[str, Any], *, bump: bool = True) -> dict[str, Any]:
    _ensure_dirs()
    next_cfg = _bump(cfg) if bump else normalize_config(cfg)
    next_cfg["token"] = TOKEN
    next_cfg["updated"] = next_cfg.get("updated") or _now()
    _write_json(CONTROLS_PATH, next_cfg)
    _write_json(SANDBOX_CONTROLS, next_cfg)
    return next_cfg


def patch_config(partial: dict[str, Any] | None = None) -> dict[str, Any]:
    cur = load_config()
    src = partial if isinstance(partial, dict) else {}
    merged = {**cur, **{k: v for k, v in src.items() if k not in {"token", "v", "how"}}}
    if "profiles" in src or "map" in src or "bindings" in src:
        hid = str(src.get("headset") or cur.get("headset") or "quest3")
        profiles = src.get("profiles") if isinstance(src.get("profiles"), dict) else cur.get("profiles") or {}
        profiles = {**profiles}
        profiles[hid] = _normalize_map(
            (src.get("profiles") or {}).get(hid) or src.get("map") or src.get("bindings") or profiles.get(hid)
        )
        merged["profiles"] = profiles
        merged["headset"] = hid
    return save_config(merged)


def _seed_notes_if_empty() -> None:
    if NOTES_PATH.is_file() or SANDBOX_NOTES.is_file():
        return
    for row in SEED_NOTES:
        add_note({**row, "seed": True, "source": "prior"})


def add_note(body: dict[str, Any] | None = None) -> dict[str, Any]:
    _ensure_dirs()
    src = _strip_secrets(body if isinstance(body, dict) else {})
    feature = str(src.get("feature") or src.get("kind") or "control")[:32]
    ok = src.get("ok")
    if ok is None:
        ok = str(src.get("result") or "").lower() in {"ok", "success", "succeeded", "true", "1"}
    row = {
        "id": "note_" + uuid.uuid4().hex[:10],
        "ts": _now(),
        "token": TOKEN,
        "feature": feature,
        "ok": bool(ok),
        "attempt": str(src.get("attempt") or src.get("mapping") or "")[:160],
        "note": str(src.get("note") or src.get("text") or src.get("description") or "")[:400],
        "source": str(src.get("source") or "headset")[:32],
        "agent": str(src.get("agent") or "")[:40],
    }
    line = json.dumps(row) + "\n"
    for path in (NOTES_PATH, SANDBOX_NOTES):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line)
    return {"ok": True, "note": row, "token": TOKEN}


def list_notes(limit: int = 40) -> list[dict[str, Any]]:
    _seed_notes_if_empty()
    path = NOTES_PATH if NOTES_PATH.is_file() else SANDBOX_NOTES
    rows: list[dict[str, Any]] = []
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines()[-200:]:
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(rec, dict):
                rows.append(rec)
    n = max(1, min(int(limit or 40), 80))
    return rows[-n:]


def suggest_fixes(notes: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    rows = notes if notes is not None else list_notes(40)
    succeeded = {str(r.get("feature")): r for r in rows if r.get("ok")}
    failed = [r for r in rows if not r.get("ok")]
    out = []
    for feat, row in succeeded.items():
        out.append({
            "feature": feat,
            "keep": True,
            "text": f"Keep {feat}: {row.get('attempt') or row.get('note')}",
            "agent": "vibe-rnd",
        })
    seen = {s["feature"] for s in out}
    for row in failed:
        feat = str(row.get("feature") or "control")
        if feat in seen:
            continue
        out.append({
            "feature": feat,
            "keep": False,
            "text": f"Retry {feat}: {row.get('attempt') or row.get('note')}",
            "agent": "analytics",
        })
        seen.add(feat)
    if not out:
        out = [
            {"feature": "trigger", "keep": True, "text": "Poll buttons[0]; do not rely on selectstart.", "agent": "astra"},
            {"feature": "dimos", "keep": True, "text": "UI overlay beats DimOS visor.", "agent": "vibe-rnd"},
        ]
    return out[:12]


def debugger_packet(topic: str = "") -> dict[str, Any]:
    notes = list_notes(24)
    suggestions = suggest_fixes(notes)
    return {
        "ok": True,
        "mode": "debugger",
        "token": TOKEN,
        "privilege": PRIVILEGE,
        "topic": str(topic or "VR controls")[:120],
        "notes": notes[-12:],
        "suggestions": suggestions,
        "auto_apply": False,
        "wire": "pending_approval until Sam accepts Wire to my scene",
        "config": load_config(),
    }


def _wire_state() -> dict[str, Any]:
    raw = _read_json(WIRE_PATH, {"items": []})
    if not isinstance(raw, dict):
        raw = {"items": []}
    items = raw.get("items") if isinstance(raw.get("items"), list) else []
    return {"items": items[-40:]}


def _save_wire(state: dict[str, Any]) -> dict[str, Any]:
    _write_json(WIRE_PATH, state)
    return state


def ask_wire(*, agent: str = "astra", note: str = "", config: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = normalize_config(config or load_config())
    cfg["apply_scene"] = False
    cfg["wire_status"] = "pending_approval"
    save_config(cfg, bump=True)
    item = {
        "id": "wire_" + uuid.uuid4().hex[:10],
        "ts": _now(),
        "status": "pending_approval",
        "agent": str(agent or "astra")[:40],
        "note": str(note or "Wire sandbox/live VR controls into Sam's scene")[:400],
        "privilege": PRIVILEGE,
        "auto_apply": False,
        "apply": False,
        "token": TOKEN,
        "rev": cfg.get("rev"),
        "config": cfg,
    }
    state = _wire_state()
    state["items"].append(item)
    _save_wire(state)
    try:
        from backend.services.debugger_privilege_service import ask_to_mark_safe

        ask_to_mark_safe(PRIVILEGE, note=item["note"])
    except Exception:
        pass
    try:
        from backend.services import mcp_watchdog_service

        mcp_watchdog_service.rm_queue({
            "agent": "astra",
            "text": (
                f"WIRE-SCENE {item['id']} privilege={PRIVILEGE} status=pending_approval "
                f"token={TOKEN} apply=false auto_apply=false Wait for Sam Approve."
            )[:900],
            "tickets": ["XR-WIRE-SCENE"],
        })
    except Exception:
        pass
    return {
        "ok": True,
        "applied": False,
        "status": "pending_approval",
        "item": item,
        "how": "Debugger privilege queue. Sam Approves before production scene bindings change.",
        "token": TOKEN,
        "privilege": PRIVILEGE,
    }


def list_wire() -> dict[str, Any]:
    pending = [i for i in _wire_state()["items"] if i.get("status") == "pending_approval"]
    return {
        "ok": True,
        "pending": pending,
        "items": _wire_state()["items"][-20:],
        "privilege": PRIVILEGE,
        "token": TOKEN,
    }


def approve_wire(wire_id: str = "", *, action: str = "approve") -> dict[str, Any]:
    verb = str(action or "approve").strip().lower()
    state = _wire_state()
    items = state["items"]
    target = None
    wid = str(wire_id or "").strip()
    if wid:
        target = next((i for i in reversed(items) if str(i.get("id")) == wid), None)
    if target is None:
        target = next((i for i in reversed(items) if i.get("status") == "pending_approval"), None)
    if target is None:
        raise ValueError("no pending wire-to-scene request")
    if verb in {"reject", "deny"}:
        target["status"] = "rejected"
        cfg = load_config()
        cfg["apply_scene"] = False
        cfg["wire_status"] = "rejected"
        save_config(cfg)
        _save_wire(state)
        return {"ok": True, "applied": False, "status": "rejected", "item": target, "token": TOKEN}
    target["status"] = "approved"
    target["approved_at"] = _now()
    cfg = normalize_config(target.get("config") or load_config())
    cfg["apply_scene"] = True
    cfg["wire_status"] = "approved"
    cfg["simulate"] = False
    save_config(cfg)
    _save_wire(state)
    return {
        "ok": True,
        "applied": False,
        "apply_scene": True,
        "status": "approved",
        "item": target,
        "token": TOKEN,
        "how": "Approved. Next headset poll persistXrControlStore into Sam's scene. Not auto-written earlier.",
    }


def handle(action: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    args = body if isinstance(body, dict) else {}
    verb = str(action or args.get("action") or "get").strip().lower()
    if verb in {"get", "read", "config", "controls"}:
        return {"ok": True, **load_config()}
    if verb in {"put", "patch", "write", "set"}:
        return {"ok": True, **patch_config(args)}
    if verb in {"note", "notes_add"}:
        return add_note(args)
    if verb in {"notes", "list_notes"}:
        return {"ok": True, "notes": list_notes(int(args.get("limit") or 40)), "token": TOKEN}
    if verb in {"debugger", "debug", "suggest"}:
        return debugger_packet(str(args.get("topic") or args.get("text") or ""))
    if verb in {"wire", "wire_scene", "ask_wire"}:
        return ask_wire(
            agent=str(args.get("agent") or "astra"),
            note=str(args.get("note") or args.get("text") or ""),
            config=args.get("config") if isinstance(args.get("config"), dict) else None,
        )
    if verb in {"wire_list", "pending"}:
        return list_wire()
    if verb in {"approve", "approve_wire", "reject", "reject_wire"}:
        act = "reject" if "reject" in verb else str(args.get("decision") or "approve")
        return approve_wire(str(args.get("id") or args.get("wire_id") or ""), action=act)
    if verb in {"simulate"}:
        return {"ok": True, **patch_config({"simulate": args.get("on", args.get("simulate", True))})}
    if verb in {"listen"}:
        return {"ok": True, **patch_config({"listen": args.get("on", args.get("listen", True))})}
    raise ValueError("unknown xr control live action")
