"""Render QA receipt emission and fail-closed gate evaluation."""

from __future__ import annotations

import hashlib
import json
import os
import re
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request as urllib_request

RMQ_ID = "rmq-1789711555"
REPO_ROOT = Path(__file__).resolve().parents[2]
SANDBOX_ROOT = REPO_ROOT / "sandbox-sessions"
RECEIPTS_ROOT = SANDBOX_ROOT / "receipts"
RECEIPT_EXAMPLES_ROOT = RECEIPTS_ROOT / "examples"
RENDER_QA_ROOT = SANDBOX_ROOT / "render-qa"
RENDER_QA_LOGS_ROOT = RENDER_QA_ROOT / "logs"
RENDER_QA_FAIL_PACKS_ROOT = RENDER_QA_ROOT / "fail-packs"
PM_CHART_FEED_PATH = RECEIPTS_ROOT / "pm-chart-feed.json"
SAFE_SLUG_RE = re.compile(r"[^a-z0-9]+")
SAFE_RECEIPT_RE = re.compile(r"^RCPT-[A-Za-z0-9-]+$")
SAFE_FAILURE_RE = re.compile(r"^FAIL-RENDER-[A-Za-z0-9-]+$")
WORKSHOP_INGEST_ENV_KEYS = (
    "RENDER_STUDIO_WORKSHOP_INGEST_URL",
    "RENDER_WORKSHOP_INGEST_URL",
    "WORKSHOP_INGEST_HOOK_URL",
)
PASS_USER_SIGNALS = {"accept", "accepted", "approve", "approved", "green", "pass", "yes"}
FAIL_USER_SIGNALS = {"decline", "declined", "fail", "failed", "no", "reject", "rejected", "red"}
UP_AXIS_ALIASES = {
    "x": "x",
    "x-up": "x",
    "x_up": "x",
    "y": "y",
    "y-up": "y",
    "y_up": "y",
    "z": "z",
    "z-up": "z",
    "z_up": "z",
}
EXPORT_SUFFIXES = (".step", ".stp", ".stl", ".glb", ".gltf")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def _slugify(value: str, *, fallback: str = "render", max_length: int = 64) -> str:
    slug = SAFE_SLUG_RE.sub("-", str(value or "").strip().lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:max_length].strip("-") or fallback


def _ensure_folder(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _write_json(path: Path, payload: Any) -> None:
    _ensure_folder(path.parent)
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def _load_json(path: Path, *, fallback: Any) -> Any:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return fallback
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return fallback
    return parsed


def _relative(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _load_project_meta(project_path: Path) -> dict[str, Any]:
    path = project_path / "project.json"
    try:
        raw = path.read_text(encoding="utf-8")
        parsed = json.loads(raw) if raw.strip() else {}
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
        parsed = {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def _project_label(project_path: Path, meta: dict[str, Any] | None = None) -> str:
    meta = meta if meta is not None else _load_project_meta(project_path)
    return str(meta.get("name") or project_path.name).strip() or project_path.name


def _file_sha256(path: Path) -> str | None:
    try:
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def _image_dimensions_from_bytes(data: bytes | None) -> tuple[int | None, int | None]:
    if not data:
        return None, None
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        try:
            width, height = struct.unpack(">II", data[16:24])
            return int(width), int(height)
        except struct.error:
            return None, None
    if data.startswith(b"\xff\xd8"):
        offset = 2
        size = len(data)
        while offset + 9 < size:
            if data[offset] != 0xFF:
                offset += 1
                continue
            marker = data[offset + 1]
            offset += 2
            if marker in {0xD8, 0xD9}:
                continue
            if offset + 2 > size:
                break
            block_len = struct.unpack(">H", data[offset:offset + 2])[0]
            if block_len < 2 or offset + block_len > size:
                break
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                if offset + 7 <= size:
                    height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
                    return int(width), int(height)
                break
            offset += block_len
    return None, None


def _image_info_from_bytes(data: bytes | None) -> dict[str, Any]:
    if not data:
        return {"exists": False, "width": None, "height": None, "content_hash": None}
    width, height = _image_dimensions_from_bytes(data)
    return {
        "exists": True,
        "width": width,
        "height": height,
        "content_hash": hashlib.sha256(data).hexdigest(),
    }


def _image_info_from_path(path: Path | None) -> dict[str, Any]:
    if path is None or not path.is_file():
        return {"exists": False, "width": None, "height": None, "content_hash": None, "path": _relative(path)}
    try:
        data = path.read_bytes()
    except OSError:
        data = b""
    width, height = _image_dimensions_from_bytes(data)
    return {
        "exists": True,
        "path": _relative(path),
        "filename": path.name,
        "width": width,
        "height": height,
        "size_bytes": path.stat().st_size,
        "content_hash": hashlib.sha256(data).hexdigest() if data else None,
    }


def _normalize_up_axis(value: Any) -> str | None:
    raw = str(value or "").strip().lower()
    return UP_AXIS_ALIASES.get(raw)


def _normalize_user_signal(value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        status = "approved" if value else "rejected"
        return {
            "provided": True,
            "raw": value,
            "status": status,
            "approved": bool(value),
        }
    if isinstance(value, dict):
        raw_status = str(value.get("status") or value.get("signal") or "").strip().lower()
        if not raw_status and "approved" in value:
            approved = bool(value.get("approved"))
            raw_status = "approved" if approved else "rejected"
        normalized = _normalize_user_signal(raw_status) if raw_status else {
            "provided": True,
            "raw": value,
            "status": "unknown",
            "approved": False,
        }
        normalized["raw"] = value
        return normalized
    raw = str(value or "").strip().lower()
    if not raw:
        return {"provided": False, "raw": value, "status": "missing", "approved": False}
    if raw in PASS_USER_SIGNALS:
        return {"provided": True, "raw": value, "status": "approved", "approved": True}
    if raw in FAIL_USER_SIGNALS:
        return {"provided": True, "raw": value, "status": "rejected", "approved": False}
    return {"provided": True, "raw": value, "status": raw, "approved": False}


def _first_existing(paths: list[Path]) -> Path | None:
    for candidate in paths:
        if candidate.is_file():
            return candidate
    return None


def _resolve_project_file(project_path: Path, filename: str | None) -> Path | None:
    safe = Path(str(filename or "")).name
    if not safe:
        return None
    candidates = [
        project_path / safe,
        project_path / "renders" / safe,
        project_path / "references" / safe,
    ]
    return _first_existing(candidates)


def _source_record(project_path: Path, filename: str | None) -> dict[str, Any]:
    path = _resolve_project_file(project_path, filename)
    if path is None:
        return {
            "filename": Path(str(filename or "")).name or None,
            "path": None,
            "exists": False,
            "content_hash": None,
            "format": None,
            "size_bytes": None,
        }
    return {
        "filename": path.name,
        "path": _relative(path),
        "exists": True,
        "content_hash": _file_sha256(path),
        "format": path.suffix.lower().lstrip("."),
        "size_bytes": path.stat().st_size,
    }


def _layout_metadata(project_path: Path, stem: str) -> dict[str, Any] | None:
    candidates = [
        project_path / f"{stem}.layout.json",
        project_path / "layout.json",
    ]
    path = _first_existing(candidates)
    if path is None:
        return None
    payload = _load_json(path, fallback={})
    units_raw = None
    if isinstance(payload, dict):
        units_raw = payload.get("units")
    units_text = str(units_raw or "").strip().lower()
    units = "meters" if units_text in {"m", "meter", "meters", "metre", "metres"} else None
    return {
        "filename": path.name,
        "path": _relative(path),
        "exists": True,
        "content_hash": _file_sha256(path),
        "size_bytes": path.stat().st_size,
        "units": units,
        "units_raw": units_raw,
    }


def _export_records(project_path: Path, source_filename: str | None, source_up_axis: str | None) -> dict[str, Any]:
    safe = Path(str(source_filename or "")).name
    if not safe:
        return {"exports": [], "layout": None}
    stem = Path(safe).stem
    seen: set[Path] = set()
    exports: list[dict[str, Any]] = []
    for suffix in EXPORT_SUFFIXES:
        candidate = project_path / f"{stem}{suffix}"
        if candidate in seen or not candidate.is_file():
            continue
        seen.add(candidate)
        exports.append(
            {
                "filename": candidate.name,
                "path": _relative(candidate),
                "exists": True,
                "format": suffix.lstrip("."),
                "content_hash": _file_sha256(candidate),
                "size_bytes": candidate.stat().st_size,
                "up_axis": source_up_axis,
            }
        )
    return {
        "exports": exports,
        "layout": _layout_metadata(project_path, stem),
    }


def _identity_gate(source: dict[str, Any], render_image: dict[str, Any]) -> dict[str, Any]:
    passed = bool(source.get("exists") and source.get("content_hash") and render_image.get("exists") and render_image.get("content_hash"))
    detail = (
        "Source hash bound to render output."
        if passed
        else "Missing source content hash or render output hash; cannot prove identity."
    )
    return {
        "id": "IDENTITY",
        "status": "pass" if passed else "fail",
        "detail": detail,
        "evidence": {
            "source_filename": source.get("filename"),
            "source_content_hash": source.get("content_hash"),
            "render_content_hash": render_image.get("content_hash"),
        },
    }


def _upright_gate(source_up_axis: str | None, export_bundle: dict[str, Any]) -> dict[str, Any]:
    passed = source_up_axis == "z"
    detail = (
        "Explicit Z-up signal present for the render source."
        if passed
        else "Missing explicit Z-up metadata; fail closed rather than guessing orientation."
    )
    return {
        "id": "UPRIGHT",
        "status": "pass" if passed else "fail",
        "detail": detail,
        "evidence": {
            "source_up_axis": source_up_axis,
            "export_count": len(export_bundle.get("exports") or []),
            "layout_units": ((export_bundle.get("layout") or {}).get("units")),
        },
    }


def _framing_gate(request_image: dict[str, Any], render_image: dict[str, Any]) -> dict[str, Any]:
    width = request_image.get("width")
    height = request_image.get("height")
    render_width = render_image.get("width")
    render_height = render_image.get("height")
    passed = bool(
        request_image.get("exists")
        and render_image.get("exists")
        and isinstance(width, int)
        and isinstance(height, int)
        and isinstance(render_width, int)
        and isinstance(render_height, int)
        and min(width, height) >= 128
        and min(render_width, render_height) >= 128
    )
    detail = (
        "Viewport capture and rendered image both have usable dimensions."
        if passed
        else "Missing or undersized framing evidence; fail closed rather than inventing composition confidence."
    )
    return {
        "id": "FRAMING",
        "status": "pass" if passed else "fail",
        "detail": detail,
        "evidence": {
            "request_width": width,
            "request_height": height,
            "render_width": render_width,
            "render_height": render_height,
        },
    }


def _user_gate(user_signal: dict[str, Any]) -> dict[str, Any]:
    passed = bool(user_signal.get("approved"))
    detail = (
        "Explicit user approval signal present."
        if passed
        else "No explicit user approval signal supplied; fail closed before green."
    )
    return {
        "id": "USER",
        "status": "pass" if passed else "fail",
        "detail": detail,
        "evidence": {
            "provided": bool(user_signal.get("provided")),
            "status": user_signal.get("status"),
        },
    }


def _latest_receipt_id() -> str | None:
    latest = _load_json(RECEIPTS_ROOT / "latest.json", fallback={})
    if not isinstance(latest, dict):
        return None
    receipt_id = str(latest.get("receipt_id") or "").strip()
    return receipt_id or None


def _receipt_shape(value: dict[str, Any]) -> dict[str, Any]:
    receipt_id = str(value.get("receipt_id") or "").strip()
    if not SAFE_RECEIPT_RE.match(receipt_id):
        raise ValueError("receipt_id must start with RCPT-.")
    return {
        "receipt_id": receipt_id,
        "log_id": str(value.get("log_id") or "").strip(),
        "pr_url": str(value.get("pr_url") or "").strip() or None,
        "pr_number": value.get("pr_number"),
        "color": str(value.get("color") or "unset").strip().lower(),
        "guard_note": str(value.get("guard_note") or ""),
        "mule_hop": str(value.get("mule_hop") or ""),
        "rmq": str(value.get("rmq") or RMQ_ID),
        "status": str(value.get("status") or "draft").strip().lower(),
        "failure_id": str(value.get("failure_id") or "").strip() or None,
        "payload": value.get("payload") if isinstance(value.get("payload"), dict) else {},
        "created_at": str(value.get("created_at") or _iso()),
    }


def _write_receipt(receipt: dict[str, Any]) -> tuple[Path, Path, dict[str, Any]]:
    shaped = _receipt_shape(receipt)
    _ensure_folder(RECEIPTS_ROOT)
    _ensure_folder(RECEIPT_EXAMPLES_ROOT)
    receipt_path = RECEIPTS_ROOT / f"{shaped['receipt_id']}.json"
    latest_path = RECEIPTS_ROOT / "latest.json"
    _write_json(receipt_path, shaped)
    _write_json(latest_path, shaped)
    return receipt_path, latest_path, shaped


def _build_pm_chart_feed() -> dict[str, Any]:
    receipts: list[dict[str, Any]] = []
    if RECEIPTS_ROOT.is_dir():
        for path in sorted(RECEIPTS_ROOT.glob("RCPT-*.json"), reverse=True):
            payload = _load_json(path, fallback={})
            if not isinstance(payload, dict):
                continue
            body = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
            gates = body.get("gates") if isinstance(body.get("gates"), list) else []
            receipts.append(
                {
                    "receipt_id": payload.get("receipt_id"),
                    "failure_id": payload.get("failure_id"),
                    "log_id": payload.get("log_id"),
                    "status": payload.get("status"),
                    "color": payload.get("color"),
                    "created_at": payload.get("created_at"),
                    "kind": body.get("kind"),
                    "project_id": ((body.get("project") or {}).get("id")),
                    "render_id": ((body.get("render") or {}).get("render_id")),
                    "source_content_hash": ((body.get("source") or {}).get("content_hash")),
                    "user_signal_status": ((body.get("user_signal") or {}).get("status")),
                    "gates": [
                        {
                            "id": gate.get("id"),
                            "status": gate.get("status"),
                            "detail": gate.get("detail"),
                        }
                        for gate in gates
                        if isinstance(gate, dict)
                    ],
                }
            )
    return {"updated_at": _iso(), "receipts": receipts}


def _write_pm_chart_feed() -> tuple[Path, dict[str, Any]]:
    feed = _build_pm_chart_feed()
    _write_json(PM_CHART_FEED_PATH, feed)
    return PM_CHART_FEED_PATH, feed


def _workshop_ingest_url() -> str:
    for key in WORKSHOP_INGEST_ENV_KEYS:
        value = str(os.getenv(key) or "").strip()
        if value:
            return value
    return ""


def _emit_workshop_ingest(payload: dict[str, Any]) -> dict[str, Any]:
    url = _workshop_ingest_url()
    if not url:
        return {
            "sent": False,
            "transport": "local",
            "url": None,
            "status": "skipped",
            "message": "No Workshop ingest hook URL is configured.",
            "received_at": _iso(),
        }
    data = json.dumps(payload).encode("utf-8")
    req = urllib_request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib_request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            body = json.loads(raw.decode("utf-8")) if raw else {}
        return {
            "sent": True,
            "transport": "hook",
            "url": url,
            "status": str(body.get("status") or "accepted"),
            "message": str(body.get("message") or "Workshop ingest hook accepted the receipt."),
            "received_at": _iso(),
        }
    except Exception as exc:
        return {
            "sent": False,
            "transport": "hook",
            "url": url,
            "status": "error",
            "message": f"Workshop ingest hook failed: {exc}",
            "received_at": _iso(),
        }


def _failure_pack_shape(value: dict[str, Any]) -> dict[str, Any]:
    failure_id = str(value.get("failure_id") or "").strip()
    if not SAFE_FAILURE_RE.match(failure_id):
        raise ValueError("failure_id must start with FAIL-RENDER-.")
    return {
        "failure_id": failure_id,
        "receipt_id": str(value.get("receipt_id") or "").strip() or None,
        "log_id": str(value.get("log_id") or "").strip(),
        "project_id": str(value.get("project_id") or "").strip(),
        "render_id": str(value.get("render_id") or "").strip(),
        "status": str(value.get("status") or "open").strip().lower(),
        "created_at": str(value.get("created_at") or _iso()),
        "failed_gates": value.get("failed_gates") if isinstance(value.get("failed_gates"), list) else [],
        "repair_loop": value.get("repair_loop") if isinstance(value.get("repair_loop"), dict) else {},
        "source": value.get("source") if isinstance(value.get("source"), dict) else {},
        "render": value.get("render") if isinstance(value.get("render"), dict) else {},
    }


def _write_failure_pack(failure_pack: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    shaped = _failure_pack_shape(failure_pack)
    _ensure_folder(RENDER_QA_FAIL_PACKS_ROOT)
    path = RENDER_QA_FAIL_PACKS_ROOT / f"{shaped['failure_id']}.json"
    _write_json(path, shaped)
    return path, shaped


def evaluate_render(
    project_path: Path,
    *,
    project_id: str,
    render_filename: str,
    source_filename: str | None,
    prompt: str,
    kind: str,
    request_image_bytes: bytes | None,
    log_id: str | None = None,
    trace_id: str | None = None,
    user: dict[str, Any] | None = None,
    source_up_axis: Any = None,
    user_signal: Any = None,
) -> dict[str, Any]:
    created_at = _iso()
    meta = _load_project_meta(project_path)
    project_label = _project_label(project_path, meta)
    safe_render_filename = Path(str(render_filename or "")).name
    render_path = _resolve_project_file(project_path, safe_render_filename)
    render_image = _image_info_from_path(render_path)
    source = _source_record(project_path, source_filename)
    normalized_up_axis = _normalize_up_axis(source_up_axis)
    normalized_user_signal = _normalize_user_signal(user_signal)
    export_bundle = _export_records(project_path, source.get("filename"), normalized_up_axis)
    request_image = _image_info_from_bytes(request_image_bytes)
    gates = [
        _identity_gate(source, render_image),
        _upright_gate(normalized_up_axis, export_bundle),
        _framing_gate(request_image, render_image),
        _user_gate(normalized_user_signal),
    ]
    overall_pass = all(gate.get("status") == "pass" for gate in gates)
    log_token = str(log_id or trace_id or safe_render_filename or project_id).strip() or project_id
    receipt_slug = _slugify(f"{project_label}-{Path(safe_render_filename).stem}-{log_token}", fallback="render")
    receipt_id = f"RCPT-RENDER-{_now().strftime('%Y%m%d')}-{receipt_slug[:56]}"
    latest_receipt_id = _latest_receipt_id()
    payload = {
        "kind": "render_qa",
        "render_kind": kind,
        "project": {
            "id": project_id,
            "label": project_label,
        },
        "render": {
            "render_id": safe_render_filename,
            "path": render_image.get("path"),
            "content_hash": render_image.get("content_hash"),
            "width": render_image.get("width"),
            "height": render_image.get("height"),
        },
        "source": {
            "filename": source.get("filename"),
            "path": source.get("path"),
            "content_hash": source.get("content_hash"),
            "format": source.get("format"),
            "size_bytes": source.get("size_bytes"),
            "up_axis": normalized_up_axis,
        },
        "request_capture": {
            "width": request_image.get("width"),
            "height": request_image.get("height"),
            "content_hash": request_image.get("content_hash"),
        },
        "export_metadata": export_bundle,
        "gates": gates,
        "user_signal": normalized_user_signal,
        "related_receipt_ids": [latest_receipt_id] if latest_receipt_id else [],
        "notes": [
            "Render QA never fabricates scores; PM chart feeds project receipt facts only.",
            "If layout.json is absent or not marked meters, units remain unset rather than guessed.",
        ],
    }
    failure_id = None
    failure_pack_path = None
    if not overall_pass:
        failure_id = f"FAIL-RENDER-{_now().strftime('%Y%m%d')}-{receipt_slug[:56]}"
        repair_loop = {
            "owner": "Code Bot",
            "attempt_budget": 3,
            "attempts_used": 0,
            "next_steps": [
                "Prepare structured FAIL pack for Code Bot review.",
                "After a repair attempt, re-run the CAD gate pack before any green state.",
                "Escalate to PM/operator review after the third failed attempt or any missing evidence.",
            ],
            "todos": [
                "TODO: wire automated Code Bot repair submission.",
                "TODO: wire CAD re-gate trigger after each repair attempt.",
                "TODO: wire escalation transport once the receipt SoR branch lands.",
            ],
        }
        failure_pack_path, _ = _write_failure_pack(
            {
                "failure_id": failure_id,
                "receipt_id": receipt_id,
                "log_id": log_token,
                "project_id": project_id,
                "render_id": safe_render_filename,
                "status": "open",
                "created_at": created_at,
                "failed_gates": [gate for gate in gates if gate.get("status") != "pass"],
                "repair_loop": repair_loop,
                "source": payload["source"],
                "render": payload["render"],
            }
        )
        payload["repair_loop"] = {
            "failure_id": failure_id,
            "failure_pack_path": _relative(failure_pack_path),
            **repair_loop,
        }
    receipt = {
        "receipt_id": receipt_id,
        "log_id": log_token,
        "pr_url": None,
        "pr_number": None,
        "color": "green" if overall_pass else "red",
        "guard_note": (
            "All fail-closed render QA gates passed."
            if overall_pass
            else "One or more fail-closed render QA gates blocked green; use the FAIL pack before attempting repair."
        ),
        "mule_hop": f"render-studio://render-qa/{log_token}",
        "rmq": RMQ_ID,
        "status": "pass" if overall_pass else "fail",
        "failure_id": failure_id,
        "payload": payload,
        "created_at": created_at,
    }
    receipt_path, latest_path, shaped_receipt = _write_receipt(receipt)
    chart_feed_path, chart_feed = _write_pm_chart_feed()
    ingest_payload = {
        "receipt": shaped_receipt,
        "failure_pack_path": _relative(failure_pack_path),
        "pm_chart_feed": chart_feed,
    }
    ingest_result = _emit_workshop_ingest(ingest_payload)
    log_payload = {
        "receipt_id": receipt_id,
        "failure_id": failure_id,
        "log_id": log_token,
        "trace_id": trace_id,
        "project_id": project_id,
        "prompt": prompt,
        "kind": kind,
        "created_at": created_at,
        "user": {
            "id": (user or {}).get("id"),
            "display_name": (user or {}).get("display_name"),
            "email": (user or {}).get("email"),
        },
        "source": payload["source"],
        "render": payload["render"],
        "request_capture": payload["request_capture"],
        "export_metadata": payload["export_metadata"],
        "gates": gates,
        "user_signal": normalized_user_signal,
        "receipt_path": _relative(receipt_path),
        "latest_receipt_path": _relative(latest_path),
        "pm_chart_feed_path": _relative(chart_feed_path),
        "failure_pack_path": _relative(failure_pack_path),
        "workshop_ingest": ingest_result,
    }
    _ensure_folder(RENDER_QA_LOGS_ROOT)
    log_path = RENDER_QA_LOGS_ROOT / f"{_slugify(log_token, fallback='render-log', max_length=72)}.json"
    _write_json(log_path, log_payload)
    return {
        "receipt_id": receipt_id,
        "failure_id": failure_id,
        "log_id": log_token,
        "status": "pass" if overall_pass else "fail",
        "color": "green" if overall_pass else "red",
        "receipt_path": _relative(receipt_path),
        "latest_receipt_path": _relative(latest_path),
        "pm_chart_feed_path": _relative(chart_feed_path),
        "failure_pack_path": _relative(failure_pack_path),
        "log_path": _relative(log_path),
        "workshop_ingest": ingest_result,
        "gates": gates,
    }
