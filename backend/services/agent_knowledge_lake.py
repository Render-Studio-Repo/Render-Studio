"""Crew knowledge lake: scores, receipts, jobs, training — hot index + optional 8TB cold store.

Internal SSD is ~256 GB. Catalog stays local. Blobs move to the external volume when it is mounted.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings

TOKEN = "kb1"
KINDS = ("score", "receipt", "job", "learning", "training", "agent")
AGENTS = (
    "cursor-engineer",
    "astra",
    "harness-mule",
    "instruction-auditor",
    "vibe-rnd",
    "analytics",
    "ledger",
    "vibe-marketing",
    "printer-bot",
    "grok-bot",
    "render-agent",
    "clip-bot",
    "cad-bot",
)

# Plug-in names we will claim when an 8TB disk appears.
VOLUME_CANDIDATES = (
    "RenderKB",
    "Render-KB",
    "8TB",
    "T7",
    "T7 Shield",
    "Samsung",
    "Elements",
    "Expansion",
    "G-DRIVE",
    "G-RAID",
    "LaCie",
    "OWC",
    "Extreme SSD",
)

HOT_REL = Path("agent-knowledge")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def detect_cold_root() -> dict[str, Any]:
    env = str(os.environ.get("RENDER_KB_ROOT") or "").strip()
    if env:
        p = Path(env).expanduser()
        if p.is_dir() and os.access(p, os.W_OK):
            return {"ok": True, "path": str(p), "source": "env", "mounted": True}
    volumes = Path("/Volumes")
    found: list[str] = []
    if volumes.is_dir():
        for name in VOLUME_CANDIDATES:
            cand = volumes / name
            if cand.is_dir() and os.access(cand, os.W_OK):
                return {"ok": True, "path": str(cand / "Render-Knowledge"), "source": "volume", "mounted": True, "volume": name}
        found = sorted(p.name for p in volumes.iterdir() if p.name not in {".", ".."})
    return {
        "ok": False,
        "path": None,
        "source": "unmounted",
        "mounted": False,
        "volumes": found,
        "thunderbolt": "no 8TB disk visible — plug the drive, then re-run detect",
        "hint": "Internal Macintosh HD is 256 GB (~51 GB free). Do not dump training blobs here.",
    }


def hot_root() -> Path:
    root = Path(settings.data_dir) / HOT_REL
    root.mkdir(parents=True, exist_ok=True)
    return root


def sandbox_root() -> Path:
    root = ROOT_DIR / "frontend" / "sandbox" / "sandbox-sessions" / "knowledge"
    root.mkdir(parents=True, exist_ok=True)
    return root


def cold_root() -> Path | None:
    hit = detect_cold_root()
    if not hit.get("ok"):
        return None
    p = Path(str(hit["path"]))
    p.mkdir(parents=True, exist_ok=True)
    (p / "blobs").mkdir(exist_ok=True)
    (p / "transcripts").mkdir(exist_ok=True)
    (p / "training").mkdir(exist_ok=True)
    return p


def layout() -> dict[str, Any]:
    hot = hot_root()
    sand = sandbox_root()
    cold = cold_root()
    detect = detect_cold_root()
    for folder in ("scores", "receipts", "jobs", "agents", "learning", "training"):
        (hot / folder).mkdir(parents=True, exist_ok=True)
        (sand / folder).mkdir(parents=True, exist_ok=True)
        if cold:
            (cold / folder).mkdir(parents=True, exist_ok=True)
    return {
        "token": TOKEN,
        "hot": str(hot),
        "sandbox": str(sand),
        "cold": str(cold) if cold else None,
        "detect": detect,
        "agents": list(AGENTS),
        "kinds": list(KINDS),
    }


def _db_path() -> Path:
    return hot_root() / "catalog.sqlite"


def _conn() -> sqlite3.Connection:
    path = _db_path()
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            agent_id TEXT NOT NULL DEFAULT '',
            log_id TEXT NOT NULL DEFAULT '',
            receipt_id TEXT NOT NULL DEFAULT '',
            score INTEGER,
            label TEXT NOT NULL DEFAULT '',
            beneficial INTEGER,
            summary TEXT NOT NULL DEFAULT '',
            path TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_kb_kind ON records(kind, created_at);
        CREATE INDEX IF NOT EXISTS idx_kb_agent ON records(agent_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_kb_log ON records(log_id);
        CREATE INDEX IF NOT EXISTS idx_kb_receipt ON records(receipt_id, created_at);
        CREATE TABLE IF NOT EXISTS feature_contracts (
            feature_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lock_state TEXT NOT NULL,
            criticality TEXT NOT NULL DEFAULT '',
            paths_json TEXT NOT NULL,
            receipt_ids_json TEXT NOT NULL,
            checks_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_feature_lock ON feature_contracts(lock_state, criticality);
        CREATE TABLE IF NOT EXISTS receipt_features (
            record_id TEXT NOT NULL,
            receipt_id TEXT NOT NULL,
            feature_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (record_id, feature_id)
        );
        CREATE INDEX IF NOT EXISTS idx_receipt_features_feature ON receipt_features(feature_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_receipt_features_receipt ON receipt_features(receipt_id, feature_id);
        """
    )
    return conn


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def ingest(record: dict[str, Any]) -> dict[str, Any]:
    kind = str(record.get("kind") or "learning").lower()
    if kind not in KINDS:
        kind = "learning"
    agent_id = str(record.get("agent_id") or record.get("author") or "cursor-engineer")[:80]
    log_id = str(record.get("log_id") or "")[:80]
    receipt_id = str(record.get("receipt_id") or "")[:80]
    score = record.get("score")
    try:
        score_i = int(score) if score is not None and str(score) != "" else None
    except (TypeError, ValueError):
        score_i = None
    if score_i is not None:
        score_i = max(0, min(100, score_i))
    label = str(record.get("label") or "")[:40]
    beneficial = record.get("beneficial")
    if beneficial is None and score_i is not None:
        beneficial = score_i >= 60
    summary = str(record.get("summary") or record.get("notes") or "")[:800]
    created = str(record.get("at") or record.get("created_at") or _now())
    rec_id = str(record.get("id") or f"{kind}-{created.replace(':', '')[:20]}-{agent_id}")[:120]
    payload = {
        "id": rec_id,
        "kind": kind,
        "agent_id": agent_id,
        "log_id": log_id,
        "receipt_id": receipt_id,
        "score": score_i,
        "label": label,
        "beneficial": bool(beneficial) if beneficial is not None else None,
        "summary": summary,
        "body": record.get("body") if isinstance(record.get("body"), dict) else {},
        "created_at": created,
        "token": TOKEN,
    }
    lay = layout()
    rel = {
        "score": "scores.jsonl",
        "receipt": "receipts.jsonl",
        "job": "jobs.jsonl",
        "learning": "learning.jsonl",
        "training": "training.jsonl",
        "agent": f"agents/{agent_id or 'crew'}.jsonl",
    }.get(kind, "learning.jsonl")
    for root in (Path(lay["hot"]), Path(lay["sandbox"])):
        _append_jsonl(root / rel, payload)
        _append_jsonl(root / "latest.jsonl", payload)
    if lay["cold"]:
        _append_jsonl(Path(lay["cold"]) / rel, payload)
    with _conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO records
            (id, kind, agent_id, log_id, receipt_id, score, label, beneficial, summary, path, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec_id,
                kind,
                agent_id,
                log_id,
                receipt_id,
                score_i,
                label,
                None if payload["beneficial"] is None else int(bool(payload["beneficial"])),
                summary,
                rel,
                created,
            ),
        )
        conn.commit()
    (Path(lay["sandbox"]) / "latest.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {"ok": True, "record": payload, "storage": {"hot": lay["hot"], "cold": lay["cold"], "mounted": bool(lay["cold"])}}


def ingest_receipt(receipt: dict[str, Any], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    # Score metadata cannot change the receipt's identity, kind, evidence or author.
    extra = {k: v for k, v in (extra or {}).items() if k in {"id", "score", "label", "beneficial"}}
    result = ingest({
        "kind": "receipt",
        "agent_id": receipt.get("author") or "cursor-engineer",
        "log_id": receipt.get("log_id"),
        "receipt_id": receipt.get("receipt_id"),
        "score": extra.get("score"),
        "label": extra.get("label") or receipt.get("bot_verdict"),
        "beneficial": extra.get("beneficial"),
        "summary": receipt.get("summary"),
        "body": receipt,
        "at": receipt.get("at"),
        **extra,
    })
    feature_ids = sorted({str(value)[:120] for value in receipt.get("feature_ids", []) if str(value).strip()})
    if feature_ids:
        record = result["record"]
        with _conn() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO receipt_features (record_id, receipt_id, feature_id, created_at) VALUES (?, ?, ?, ?)",
                [(record["id"], record["receipt_id"], feature_id, record["created_at"]) for feature_id in feature_ids],
            )
            conn.commit()
    return result


def sync_feature_map(feature_map: dict[str, Any]) -> dict[str, Any]:
    """Replace the searchable contract index from the file-backed source of truth."""
    updated_at = str(feature_map.get("updated_at") or _now())
    rows = []
    for feature in feature_map.get("features", []):
        feature_id = str(feature.get("id") or "").strip()[:120]
        if not feature_id:
            continue
        rows.append((
            feature_id,
            str(feature.get("name") or feature_id)[:240],
            str(feature.get("lock") or "off")[:20],
            str(feature.get("criticality") or "")[:40],
            json.dumps(feature.get("paths") or [], separators=(",", ":")),
            json.dumps(feature.get("receipt_ids") or [], separators=(",", ":")),
            json.dumps(feature.get("checks") or [], separators=(",", ":")),
            updated_at,
        ))
    with _conn() as conn:
        conn.execute("DELETE FROM feature_contracts")
        conn.executemany(
            """INSERT INTO feature_contracts
            (feature_id, name, lock_state, criticality, paths_json, receipt_ids_json, checks_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        conn.commit()
    return {"ok": True, "features_indexed": len(rows), "updated_at": updated_at}


def ingest_score(score: dict[str, Any]) -> dict[str, Any]:
    return ingest({
        "kind": "score",
        "agent_id": score.get("agent_id") or score.get("author") or "cursor-engineer",
        "log_id": score.get("log_id"),
        "receipt_id": score.get("receipt_id"),
        "score": score.get("score"),
        "label": score.get("label"),
        "beneficial": score.get("beneficial"),
        "summary": score.get("notes") or score.get("summary"),
        "body": score,
        "at": score.get("at"),
    })


def status() -> dict[str, Any]:
    lay = layout()
    counts: dict[str, int] = {}
    try:
        with _conn() as conn:
            for kind, n in conn.execute("SELECT kind, COUNT(*) FROM records GROUP BY kind"):
                counts[str(kind)] = int(n)
            total = conn.execute("SELECT COUNT(*) FROM records").fetchone()[0]
    except sqlite3.Error:
        total = 0
    return {
        "ok": True,
        "token": TOKEN,
        "layout": lay,
        "counts": counts,
        "total": int(total or 0),
        "need_8tb": not bool(lay["cold"]),
    }


def search(query: str = "", kind: str = "", agent_id: str = "", feature_id: str = "", limit: int = 40) -> dict[str, Any]:
    limit = max(1, min(200, int(limit or 40)))
    sql = "SELECT * FROM records WHERE 1=1"
    args: list[Any] = []
    if kind:
        sql += " AND kind = ?"
        args.append(kind)
    if agent_id:
        sql += " AND agent_id = ?"
        args.append(agent_id)
    if feature_id:
        sql += " AND EXISTS (SELECT 1 FROM receipt_features rf WHERE rf.record_id = records.id AND rf.feature_id = ?)"
        args.append(feature_id)
    if query:
        sql += " AND (summary LIKE ? OR log_id LIKE ? OR receipt_id LIKE ?)"
        like = f"%{query}%"
        args.extend([like, like, like])
    sql += " ORDER BY created_at DESC LIMIT ?"
    args.append(limit)
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute(sql, args)]
    return {"ok": True, "rows": rows, "n": len(rows)}


def search_features(query: str = "", locked_only: bool = True, limit: int = 100) -> dict[str, Any]:
    limit = max(1, min(200, int(limit or 100)))
    sql = "SELECT * FROM feature_contracts WHERE 1=1"
    args: list[Any] = []
    if locked_only:
        sql += " AND lock_state = 'on'"
    if query:
        sql += " AND (feature_id LIKE ? OR name LIKE ? OR paths_json LIKE ? OR receipt_ids_json LIKE ?)"
        like = f"%{query}%"
        args.extend([like, like, like, like])
    sql += " ORDER BY criticality, feature_id LIMIT ?"
    args.append(limit)
    with _conn() as conn:
        rows = [dict(row) for row in conn.execute(sql, args)]
    return {"ok": True, "rows": rows, "n": len(rows)}


def seed_if_empty() -> dict[str, Any]:
    st = status()
    if st["total"]:
        return st
    ingest_score({
        "log_id": "da6e44bf-004",
        "agent_id": "astra",
        "score": 64,
        "label": "partial",
        "beneficial": True,
        "notes": "CAD bot diagnosis beneficial; pin Ø8.6 vs Ø4.56 not scaled. FAIL-CAD-PROMPT-0009c214-pin",
        "receipt_id": "RCPT-20260918-001200-workshop-mvp",
        "at": _now(),
    })
    receipt_path = ROOT_DIR / "frontend" / "sandbox" / "sandbox-sessions" / "receipts" / "latest.json"
    if receipt_path.is_file():
        try:
            ingest_receipt(json.loads(receipt_path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    return status()
