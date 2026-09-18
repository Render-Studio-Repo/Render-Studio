"""Read Workshop PM score chart rows from receipt or fleet fixture JSON."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SANDBOX_ROOT = REPO_ROOT / "sandbox-sessions"
RECEIPTS_ROOT = SANDBOX_ROOT / "receipts"
FIXTURE_ROOTS = (
    SANDBOX_ROOT / "fixtures",
    REPO_ROOT / "fixtures",
    REPO_ROOT / "ai-context" / "fixtures",
)


def _relative(path: Path) -> str:
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _string(value: Any) -> str:
    return str(value or "").strip()


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _first_present(*values: Any) -> Any:
    for value in values:
        if isinstance(value, str):
            if value.strip():
                return value.strip()
            continue
        if value not in (None, "", [], {}):
            return value
    return None


def _collect_ids(*values: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    stack = list(values)
    while stack:
        value = stack.pop(0)
        if value in (None, ""):
            continue
        if isinstance(value, str):
            for token in [item.strip() for item in value.split(",")]:
                if not token or token in seen:
                    continue
                seen.add(token)
                out.append(token)
            continue
        if isinstance(value, dict):
            maybe_id = _string(value.get("id"))
            if maybe_id and maybe_id not in seen:
                seen.add(maybe_id)
                out.append(maybe_id)
            continue
        if isinstance(value, list):
            stack.extend(value)
    return out


def _candidate_paths() -> list[Path]:
    candidates: list[Path] = []
    if RECEIPTS_ROOT.is_dir():
        latest = RECEIPTS_ROOT / "latest.json"
        if latest.is_file():
            candidates.append(latest)
        candidates.extend(sorted(RECEIPTS_ROOT.glob("RCPT-*.json"), key=lambda path: path.stat().st_mtime, reverse=True))
        candidates.extend(sorted(RECEIPTS_ROOT.glob("fleet*.json"), key=lambda path: path.stat().st_mtime, reverse=True))
    for root in FIXTURE_ROOTS:
        if not root.is_dir():
            continue
        for pattern in ("fleet*.json", "*receipt*.json", "RCPT-*.json"):
            candidates.extend(sorted(root.rglob(pattern), key=lambda path: path.stat().st_mtime, reverse=True))
    deduped: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        rel = _relative(path)
        if rel in seen:
            continue
        seen.add(rel)
        deduped.append(path)
    return deduped


def _extract_row(path: Path, payload: Any) -> dict[str, Any] | None:
    data = _dict(payload)
    body = _dict(data.get("payload"))
    guard = _dict(body.get("guard")) or _dict(data.get("guard"))
    owner = _dict(body.get("owner")) or _dict(data.get("owner"))
    receipt_id = _first_present(data.get("receipt_id"), body.get("receipt_id"), path.stem if path.stem.startswith("RCPT-") else None)
    peer_score = _first_present(
        data.get("peer_score"),
        body.get("peer_score"),
        _dict(body.get("score")).get("peer_score"),
        guard.get("peer_score"),
    )
    guard_color = _first_present(
        data.get("guard_color"),
        data.get("color"),
        body.get("guard_color"),
        guard.get("color"),
    )
    owner_slug = _first_present(
        data.get("owner_slug"),
        body.get("owner_slug"),
        owner.get("slug"),
    )
    open_fail_ids = _collect_ids(
        data.get("open_fail_ids"),
        data.get("related_fail_ids"),
        data.get("failure_id"),
        body.get("open_fail_ids"),
        body.get("related_fail_ids"),
        body.get("failure_id"),
        body.get("failures"),
    )
    open_fix_ids = _collect_ids(
        data.get("open_fix_ids"),
        data.get("related_fix_ids"),
        body.get("open_fix_ids"),
        body.get("related_fix_ids"),
        body.get("fixes"),
    )
    open_receipt_ids = _collect_ids(
        data.get("open_receipt_ids"),
        data.get("related_receipt_ids"),
        body.get("open_receipt_ids"),
        body.get("related_receipt_ids"),
    )
    if not any(
        [
            receipt_id,
            peer_score not in (None, ""),
            guard_color not in (None, ""),
            owner_slug not in (None, ""),
            open_fail_ids,
            open_fix_ids,
            open_receipt_ids,
        ]
    ):
        return None
    open_rcpt_fix_ids = _collect_ids(open_receipt_ids, open_fix_ids)
    updated_at = _first_present(
        data.get("updated_at"),
        data.get("created_at"),
        body.get("created_at"),
        _dict(body.get("when")).get("stopped_at"),
        _dict(body.get("when")).get("updated_at"),
    )
    return {
        "receipt_id": receipt_id,
        "peer_score": peer_score,
        "guard_color": _string(guard_color).lower() or None,
        "open_fail_count": len(open_fail_ids),
        "owner_slug": _string(owner_slug) or None,
        "open_rcpt_fix_ids": open_rcpt_fix_ids,
        "open_fail_ids": open_fail_ids,
        "updated_at": _string(updated_at) or None,
        "source_path": _relative(path),
    }


def get_panel_data(*, limit: int = 6) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    scanned_paths: list[str] = []
    for path in _candidate_paths():
        scanned_paths.append(_relative(path))
        row = _extract_row(path, _read_json(path))
        if row is None:
            continue
        rows.append(row)
    rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    if limit > 0:
        rows = rows[:limit]
    return {
        "has_rows": bool(rows),
        "rows": rows,
        "empty_reason": None if rows else "No fleet receipt or guard fixture JSON found yet.",
        "scanned_paths": scanned_paths[:20],
        "source_note": "Uses committed or sandbox receipt/guard JSON only. No fabricated score or dollar data.",
        "updated_at": rows[0].get("updated_at") if rows else None,
    }
