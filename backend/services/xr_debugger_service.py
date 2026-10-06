"""XR headset perf logs for the in-headset developer debugger.

Writes a sanitized JSON/JSONL file the user can download, plus a copy under
``ai-context/debugger/`` so local agents can read it without a download step.
No tokens, cookies, or emails.
"""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings

SECRET_KEYS = {
    "token",
    "password",
    "authorization",
    "cookie",
    "secret",
    "api_key",
    "apikey",
    "jwt",
    "email",
    "access_token",
    "refresh_token",
}
_SLUG_RE = re.compile(r"[^a-z0-9-]+")
_SAFE_USER_RE = re.compile(r"[^a-zA-Z0-9_-]+")
MAX_SAMPLES = 2400
MAX_ACTIONS = 80
MAX_CONTROL_ROWS = 240
MAX_CONTROL_EVENTS = 48
MAX_SPIKES = 40
MAX_CLICKS = 240
MAX_BODY_BYTES = 96_000
KEEP_MAX = 10
KEEP_NAMES = {"last-xr-perf.jsonl", "last-xr-ctl.jsonl", "last-desk-dbg.jsonl", "last-bambu-plate.jsonl", "last-round-table.jsonl", "readme.md"}
DESC_MAX = 160
SESSION_GLOBS = ("*-xr-perf.jsonl", "*-xr-ctl.jsonl", "*-desk-dbg.jsonl", "*-bambu-plate.jsonl", "*-round-table.jsonl")


def xr_perf_log_filename(when: datetime | None = None, slug: str = "xr-perf") -> str:
    now = when or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%d-%H%M")
    safe = _SLUG_RE.sub("-", (slug or "xr-perf").strip().lower()).strip("-")[:24] or "xr-perf"
    return f"{stamp}-{safe}.jsonl"


def ai_debugger_dir() -> Path:
    path = ROOT_DIR / "ai-context" / "debugger"
    path.mkdir(parents=True, exist_ok=True)
    return path


def user_debugger_dir(user_id: str) -> Path:
    uid = _SAFE_USER_RE.sub("", str(user_id or "anon"))[:64] or "anon"
    path = Path(settings.data_dir) / "debugger" / uid
    path.mkdir(parents=True, exist_ok=True)
    return path


def _strip_secrets(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return None
    if isinstance(value, dict):
        out = {}
        for key, val in value.items():
            k = str(key).lower()
            if k in SECRET_KEYS or "token" in k or "secret" in k or "password" in k:
                continue
            out[str(key)[:40]] = _strip_secrets(val, depth + 1)
        return out
    if isinstance(value, list):
        return [_strip_secrets(v, depth + 1) for v in value[:MAX_SAMPLES]]
    if isinstance(value, str):
        return value[:200]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:80]


def _compact_control_hand(row: Any) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    ax = row.get("ax") if isinstance(row.get("ax"), list) else []
    extra = row.get("x") if isinstance(row.get("x"), list) else []
    packed = {
        "tr": int(row.get("tr") or 0),
        "sq": int(row.get("sq") or 0),
        "a": int(row.get("a") or 0),
        "b": int(row.get("b") or 0),
        "g": int(row.get("g") or 0),
        "ax": [float(v) for v in ax[:4]],
        "m": str(row.get("m") or "")[:16],
    }
    extra_ids = [int(v) for v in extra[:8] if str(v).lstrip("-").isdigit()]
    if extra_ids:
        packed["x"] = extra_ids
    if row.get("st"):
        packed["st"] = int(row.get("st") or 0)
    if row.get("menu"):
        packed["menu"] = int(row.get("menu") or 0)
    if row.get("move"):
        packed["move"] = 1
    on = row.get("on")
    if isinstance(on, list) and on:
        packed["on"] = [str(v)[:28] for v in on[:12] if v]
    return packed


def _compact_control_interaction(raw: Any) -> dict[str, Any] | None:
    """Keep numeric controller poses and bounded target labels only."""
    if not isinstance(raw, dict):
        return None
    result = {}
    for hand in ("l", "r"):
        source = raw.get(hand)
        if not isinstance(source, dict):
            continue
        side = {}
        for key in ("aim", "grip"):
            pose = source.get(key)
            if isinstance(pose, list) and len(pose) == 7 and all(
                isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                for value in pose
            ):
                side[key] = [round(value, 3) for value in pose]
        for key in ("hit", "near", "held"):
            if isinstance(source.get(key), str):
                side[key] = source[key][:64]
        distance = source.get("distance")
        if isinstance(distance, (int, float)) and not isinstance(distance, bool) and math.isfinite(distance):
            side["distance"] = round(distance, 3)
        if side:
            result[hand] = side
    return result or None


def sanitize_xr_controls(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    rows_in = src.get("rows") if isinstance(src.get("rows"), list) else []
    ev_in = src.get("ev") if isinstance(src.get("ev"), list) else []
    src_in = src.get("src") if isinstance(src.get("src"), list) else []
    clean_rows = []
    for row in rows_in[-MAX_CONTROL_ROWS:]:
        if not isinstance(row, dict):
            continue
        item: dict[str, Any] = {
            "t": int(row.get("t") or 0),
            "f": float(row.get("f") or 0),
            "dt": float(row.get("dt") or 0),
            "drop": int(row.get("drop") or 0),
            "th": int(row.get("th") or 0),
            "n": int(row.get("n") or 0),
        }
        for hand in ("l", "r", "u"):
            packed = _compact_control_hand(row.get(hand))
            if packed:
                item[hand] = packed
        if row.get("c"):
            item["c"] = str(row.get("c") or "")[:12]
        if row.get("ev"):
            item["ev"] = str(row.get("ev") or "")[:8]
        if row.get("hit"):
            item["hit"] = str(row.get("hit") or "")[:12]
        if row.get("h"):
            item["h"] = str(row.get("h") or "")[:2]
        interaction = _compact_control_interaction(row.get("interaction"))
        if interaction:
            item["interaction"] = interaction
        clean_rows.append(item)
    clean_ev = []
    for row in ev_in[-MAX_CONTROL_EVENTS:]:
        if not isinstance(row, dict):
            continue
        event = {
            "t": int(row.get("t") or 0),
            "ev": str(row.get("ev") or "")[:8],
            "c": str(row.get("c") or "")[:12],
            "h": str(row.get("h") or "")[:2],
        }
        for hand in ("l", "r", "u"):
            packed = _compact_control_hand(row.get(hand))
            if packed:
                event[hand] = packed
        if "n" in row:
            event["n"] = int(row.get("n") or 0)
        if row.get("hit"):
            event["hit"] = str(row.get("hit") or "")[:12]
        interaction = _compact_control_interaction(row.get("interaction"))
        if interaction:
            event["interaction"] = interaction
        clean_ev.append(event)
    clean_src = []
    for row in src_in[:4]:
        if not isinstance(row, dict):
            continue
        clean_src.append({
            "h": str(row.get("h") or "")[:2],
            "m": str(row.get("m") or "")[:16],
            "p": str(row.get("p") or "")[:28],
            "g": int(row.get("g") or 0),
            "map": str(row.get("map") or "")[:12],
            "n": int(row.get("n") or 0),
            "hand": int(row.get("hand") or 0),
        })
    sess = src.get("sess") if isinstance(src.get("sess"), dict) else {}
    ov = src.get("ov") if isinstance(src.get("ov"), dict) else {}
    return {
        "section": "xr-controls",
        "build": re.sub(r"[^a-zA-Z0-9._-]", "", str(src.get("build") or ""))[:48],
        "hz": int(src.get("hz") or 8),
        "windowMs": int(src.get("windowMs") or 8000),
        "sess": {
            "on": int(sess.get("on") or 0),
            "end": int(sess.get("end") or 0),
            "mode": str(sess.get("mode") or "")[:16],
            "ref": str(sess.get("ref") or "")[:16],
            "blend": str(sess.get("blend") or "")[:12],
            "n": int(sess.get("n") or 0),
        },
        "src": clean_src,
        "ov": {
            "d": int(ov.get("d") or 0),
            "s": int(ov.get("s") or 0),
            "st": int(ov.get("st") or 0),
            "l": int(ov.get("l") or 0),
        },
        "ev": clean_ev,
        "rows": clean_rows,
        "durationMs": int(src.get("durationMs") or 0),
    }


def sanitize_xr_perf_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    raw = payload if isinstance(payload, dict) else {}
    samples = raw.get("samples") if isinstance(raw.get("samples"), list) else []
    actions = raw.get("actions") if isinstance(raw.get("actions"), list) else []
    clean_samples = []
    for row in samples[-MAX_SAMPLES:]:
        if not isinstance(row, dict):
            continue
        item = {
            "t": int(row.get("t") or 0),
            "fps": float(row.get("fps") or 0),
            "dt": float(row.get("dt") or 0),
        }
        if "memMb" in row:
            try:
                item["memMb"] = float(row.get("memMb") or 0)
            except (TypeError, ValueError):
                pass
        if "cpu" in row:
            try:
                item["cpu"] = float(row.get("cpu") or 0)
            except (TypeError, ValueError):
                pass
        clean_samples.append(item)
    clean_actions = []
    for row in actions[-MAX_ACTIONS:]:
        if not isinstance(row, dict):
            continue
        tool = str(row.get("tool") or row.get("id") or "")[:40]
        if not tool:
            continue
        clean_actions.append({"t": int(row.get("t") or 0), "tool": tool})
    extra = _strip_secrets({
        k: v for k, v in raw.items()
        if k not in {"samples", "actions", "filename", "controls", "spikes", "clicks", "kind", "tag", "spikeTrace"}
    })
    if not isinstance(extra, dict):
        extra = {}
    spikes_in = raw.get("spikes") if isinstance(raw.get("spikes"), list) else []
    clean_spikes = []
    for row in spikes_in[-MAX_SPIKES:]:
        if not isinstance(row, dict):
            continue
        item = {
            "t": int(row.get("t") or 0),
            "dt": float(row.get("dt") or 0),
            "fps": float(row.get("fps") or 0),
        }
        if "memMb" in row:
            try:
                item["memMb"] = float(row.get("memMb") or 0)
            except (TypeError, ValueError):
                pass
        if "cpu" in row:
            try:
                item["cpu"] = float(row.get("cpu") or 0)
            except (TypeError, ValueError):
                pass
        if row.get("heap"):
            item["heap"] = 1
        if row.get("where"):
            item["where"] = str(row.get("where") or "")[:160]
        if row.get("stack"):
            item["stack"] = str(row.get("stack") or "")[:400]
        if row.get("lastClick"):
            item["lastClick"] = str(row.get("lastClick") or "")[:160]
        clean_spikes.append(item)
    clicks_in = raw.get("clicks") if isinstance(raw.get("clicks"), list) else []
    clean_clicks = []
    for row in clicks_in[-MAX_CLICKS:]:
        if not isinstance(row, dict):
            continue
        path = str(row.get("path") or row.get("sel") or "")[:160]
        if not path:
            continue
        click = {
            "t": int(row.get("t") or 0),
            "path": path,
        }
        if "x" in row:
            click["x"] = int(row.get("x") or 0)
        if "y" in row:
            click["y"] = int(row.get("y") or 0)
        if row.get("type"):
            click["type"] = str(row.get("type") or "")[:12]
        clean_clicks.append(click)
    kind_raw = str(raw.get("kind") or extra.get("kind") or "xr-perf").strip().lower()
    if kind_raw in {"desktop-perf", "desktop-dbg", "desk-dbg"}:
        kind = "desktop-perf"
    elif kind_raw in {"bambu-plate", "slicer-plate"}:
        kind = "bambu-plate"
    elif kind_raw in {"round-table", "roundtbl", "ai-round-table"}:
        kind = "round-table"
    else:
        kind = "xr-perf"
    body = {
        "v": int(raw.get("v") or 1),
        "kind": kind,
        "samples": clean_samples,
        "actions": clean_actions,
        "clicks": clean_clicks,
        "controls": sanitize_xr_controls(raw.get("controls")),
        "spikes": clean_spikes,
        "extra": extra,
    }
    for key in (
        "avgMs", "p95Ms", "n", "auto", "manual",
        "framebufferScale", "foveation", "hudScale",
        "presenting", "laser", "durationMs", "hitchCount", "maxDt", "memMb",
    ):
        if isinstance(extra, dict) and key in extra:
            body[key] = extra[key]
    hitch = 0
    try:
        hitch = int(body.get("hitchCount") or 0)
    except (TypeError, ValueError):
        hitch = 0
    if not hitch:
        hitch = len(clean_spikes)
        body["hitchCount"] = hitch
    tag_in = str(raw.get("tag") or extra.get("tag") or "").strip().lower()
    body["tag"] = "spike" if tag_in == "spike" or hitch > 0 else "normal"
    traces = []
    for row in clean_spikes[-8:]:
        traces.append(
            " ".join(
                part
                for part in (
                    f"{row.get('t')}ms",
                    f"dt={row.get('dt')}",
                    str(row.get("where") or "").strip(),
                    str(row.get("stack") or "").strip(),
                )
                if part
            )
        )
    body["spikeTrace"] = str(raw.get("spikeTrace") or extra.get("spikeTrace") or " | ".join(traces))[:500]
    stamp, description = session_log_meta(raw, body)
    body["timestamp"] = stamp
    body["description"] = description
    return body


def session_log_meta(raw: dict[str, Any] | None, body: dict[str, Any] | None = None) -> tuple[str, str]:
    payload = raw if isinstance(raw, dict) else {}
    merged = body if isinstance(body, dict) else {}
    stamp = str(payload.get("timestamp") or merged.get("timestamp") or "").strip()
    if not stamp:
        stamp = datetime.now(timezone.utc).isoformat()
    desc = str(payload.get("description") or merged.get("description") or "").strip()[:DESC_MAX]
    if not desc:
        auto = bool(payload.get("auto") if payload.get("auto") is not None else merged.get("auto"))
        n = payload.get("n")
        if n is None:
            n = merged.get("n")
        if auto:
            desc = "XR session enter (auto perf)"
        else:
            kind = str(payload.get("kind") or merged.get("kind") or "")
            if kind in {"desktop-perf", "desktop-dbg", "desk-dbg"}:
                desc = "Desktop debugger session"
            else:
                desc = "XR debugger session"
        try:
            frames = int(n or 0)
        except (TypeError, ValueError):
            frames = 0
        if frames > 0:
            desc = f"{desc} · {frames} frames"
    return stamp, desc


def should_accept_xr_debugger_upload(payload: dict[str, Any] | None) -> bool:
    """Stick-hold Send only. Auto session dumps (0707 / 10s enter) are rejected."""
    raw = payload if isinstance(payload, dict) else {}
    if raw.get("auto") is True:
        return False
    return True


def write_xr_perf_log(user: dict[str, Any] | None, payload: dict[str, Any] | None) -> dict[str, Any]:
    user = user or {}
    if not should_accept_xr_debugger_upload(payload):
        return {
            "ok": False,
            "skipped": "auto",
            "name": "",
            "path": "",
            "user_rel": "",
            "ai_path": "",
            "sample_count": 0,
            "action_count": 0,
        }
    name = str((payload or {}).get("filename") or "").strip()
    if not name.endswith(".jsonl") and not name.endswith(".json"):
        name = xr_perf_log_filename()
    name = Path(name).name
    if not re.match(r"^[0-9]{8}-[0-9]{4}-[a-z0-9-]+\.(jsonl|json)$", name):
        name = xr_perf_log_filename()
    body = sanitize_xr_perf_payload(payload)
    name = body.get("filename") or name
    body["filename"] = name
    text = json.dumps(body, separators=(",", ":")) + "\n"
    if len(text.encode("utf-8")) > MAX_BODY_BYTES:
        body["samples"] = body["samples"][-400:]
        controls = body.get("controls") if isinstance(body.get("controls"), dict) else {}
        rows = controls.get("rows") if isinstance(controls.get("rows"), list) else []
        controls["rows"] = rows[-40:]
        body["controls"] = controls
        text = json.dumps(body, separators=(",", ":")) + "\n"
    user_path = user_debugger_dir(str(user.get("id") or "anon")) / name
    user_path.write_text(text, encoding="utf-8")
    ai_dir = ai_debugger_dir()
    (ai_dir / name).write_text(text, encoding="utf-8")
    if body.get("kind") == "desktop-perf":
        (ai_dir / "last-desk-dbg.jsonl").write_text(text, encoding="utf-8")
    elif body.get("kind") == "bambu-plate":
        (ai_dir / "last-bambu-plate.jsonl").write_text(text, encoding="utf-8")
    elif body.get("kind") == "round-table":
        (ai_dir / "last-round-table.jsonl").write_text(text, encoding="utf-8")
    else:
        (ai_dir / "last-xr-perf.jsonl").write_text(text, encoding="utf-8")
        if body.get("controls"):
            (ai_dir / "last-xr-ctl.jsonl").write_text(text, encoding="utf-8")
    prune_logs(user_path.parent)
    prune_logs(ai_dir)
    rel_ai = f"ai-context/debugger/{name}"
    return {
        "ok": True,
        "name": name,
        "path": rel_ai,
        "user_rel": f"data/debugger/{Path(user_path).parent.name}/{name}",
        "ai_path": rel_ai,
        "sample_count": len(body["samples"]),
        "action_count": len(body["actions"]),
    }


def prune_logs(folder: Path) -> int:
    """Keep the newest KEEP_MAX session dumps. Never touch last-xr-perf."""
    if not folder.is_dir():
        return 0
    files = [
        p
        for p in folder.glob("*")
        if p.is_file() and p.name.lower() not in KEEP_NAMES and p.suffix.lower() in {".jsonl", ".json"}
    ]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    removed = 0
    for idx, fp in enumerate(files):
        if idx < KEEP_MAX:
            continue
        try:
            fp.unlink()
            removed += 1
        except OSError:
            pass
    return removed


def _log_time_epoch(row: dict[str, Any]) -> float:
    for key in ("timestamp", "mtime"):
        raw = str(row.get(key) or "").strip()
        if not raw:
            continue
        try:
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            return datetime.fromisoformat(raw).timestamp()
        except ValueError:
            continue
    return 0.0


def sort_xr_perf_log_rows(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Newest session first (top), oldest last. Timestamp, then filename."""
    items = [row for row in (rows or []) if isinstance(row, dict)]
    items.sort(key=lambda row: (_log_time_epoch(row), str(row.get("name") or "")), reverse=True)
    return items


def prune_all() -> dict[str, int]:
    removed = prune_logs(ai_debugger_dir())
    data_root = Path(settings.data_dir) / "debugger"
    if data_root.is_dir():
        for child in data_root.iterdir():
            if child.is_dir():
                removed += prune_logs(child)
    return {"removed": removed}


def _glob_session_logs(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    files: list[Path] = []
    for pattern in SESSION_GLOBS:
        files.extend(sorted(folder.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True))
    return files


def _session_fields_from_file(fp: Path, mtime_iso: str) -> dict[str, Any]:
    stamp = mtime_iso
    desc = ""
    tag = "normal"
    hitch_count = 0
    kind = ""
    spike_trace = ""
    try:
        line = fp.read_text(encoding="utf-8").splitlines()[0]
        data = json.loads(line) if line else {}
        if isinstance(data, dict):
            stamp = str(data.get("timestamp") or "").strip() or stamp
            desc = str(data.get("description") or "").strip()[:DESC_MAX]
            if not desc:
                _, desc = session_log_meta(data, data)
            kind = str(data.get("kind") or "")[:32]
            try:
                hitch_count = int(data.get("hitchCount") or 0)
            except (TypeError, ValueError):
                hitch_count = 0
            spikes = data.get("spikes") if isinstance(data.get("spikes"), list) else []
            if not hitch_count:
                hitch_count = len(spikes)
            tag_in = str(data.get("tag") or "").strip().lower()
            tag = "spike" if tag_in == "spike" or hitch_count > 0 else "normal"
            spike_trace = str(data.get("spikeTrace") or "")[:500]
            if not spike_trace and tag == "spike":
                traces = []
                for row in spikes[-3:]:
                    if not isinstance(row, dict):
                        continue
                    traces.append(
                        " ".join(
                            part
                            for part in (
                                f"{row.get('t')}ms",
                                f"dt={row.get('dt')}",
                                str(row.get("where") or "").strip(),
                                str(row.get("stack") or "").strip(),
                            )
                            if part
                        )
                    )
                spike_trace = " | ".join(traces)[:500]
    except (OSError, json.JSONDecodeError, IndexError):
        pass
    if not desc:
        desc = "XR session"
    return {
        "timestamp": stamp,
        "description": desc,
        "tag": tag,
        "hitchCount": hitch_count,
        "kind": kind,
        "spikeTrace": spike_trace,
    }


def list_xr_perf_logs(user: dict[str, Any] | None, *, super_admin: bool = False) -> list[dict[str, Any]]:
    user = user or {}
    mine = user_debugger_dir(str(user.get("id") or "anon"))
    prune_logs(mine)
    files: list[Path] = []
    files.extend(_glob_session_logs(mine))
    if super_admin:
        ai = ai_debugger_dir()
        prune_logs(ai)
        files.extend(_glob_session_logs(ai))
        data_root = Path(settings.data_dir) / "debugger"
        if data_root.is_dir():
            for child in data_root.iterdir():
                if child.is_dir():
                    prune_logs(child)
                    files.extend(_glob_session_logs(child))
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for fp in files:
        if fp.name in seen or fp.name in KEEP_NAMES:
            continue
        seen.add(fp.name)
        try:
            stat = fp.stat()
        except OSError:
            continue
        mtime = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
        meta = _session_fields_from_file(fp, mtime)
        out.append(
            {
                "name": fp.name,
                "timestamp": meta["timestamp"],
                "description": meta["description"],
                "mtime": mtime,
                "bytes": stat.st_size,
                "path": str(fp),
                "tag": meta["tag"],
                "hitchCount": meta["hitchCount"],
                "kind": meta["kind"],
                "spikeTrace": meta["spikeTrace"],
            }
        )
    return sort_xr_perf_log_rows(out)[:KEEP_MAX]


def read_xr_perf_log(user: dict[str, Any] | None, name: str, *, super_admin: bool = False) -> tuple[str, str]:
    safe = Path(str(name or "")).name
    if not re.match(r"^[0-9]{8}-[0-9]{4}-[a-z0-9-]+\.(jsonl|json)$", safe):
        raise FileNotFoundError(safe)
    candidates = [user_debugger_dir(str((user or {}).get("id") or "anon")) / safe, ai_debugger_dir() / safe]
    if super_admin:
        data_root = Path(settings.data_dir) / "debugger"
        if data_root.is_dir():
            candidates.extend(data_root.glob(f"*/{safe}"))
    for fp in candidates:
        if fp.is_file():
            return safe, fp.read_text(encoding="utf-8")
    raise FileNotFoundError(safe)
