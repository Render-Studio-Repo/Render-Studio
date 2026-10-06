"""Cluster opted-in debug packets so Grok can match the same bug across instances.

Stores redacted traceback + feature-check fingerprints locally. Clones that opt in
forward that packet (not prompts, secrets, or project files) to the public hub.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import sqlite3
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from backend.config import ROOT_DIR, settings
from backend.services import log_redact

logger = logging.getLogger("render3d.debug_training")

DB_PATH = Path(settings.data_dir) / "debug_training.sqlite3"
HUB_INGEST = "/api/debug-training/ingest"
HUB_REGISTER = "/api/debug-training/instances/register"
HUB_HEARTBEAT = "/api/debug-training/instances/heartbeat"
DEFAULT_HUB = "https://render3d.app"
VERDICTS = {"spot_on", "missed_earlier", "looked_unrelated", "wrong_then_corrected"}
STATUSES = {"ok", "degraded", "broken", "missing", "unknown"}
MAX_TRACEBACK = 12000
MAX_TITLE = 200

_FRAME_RE = re.compile(r'File "([^"]+)", line \d+, in (\S+)')
_EXC_RE = re.compile(
    r"^([A-Za-z_][\w.]*(?:Error|Exception|Fault|Timeout|Warning|Abort))\s*:",
    re.M,
)
_HOME_RE = re.compile(r"(?i)(/Users|/home)/[^\s/\"']+")
_LINE_RE = re.compile(r"line \d+")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS instances (
            instance_id TEXT PRIMARY KEY,
            secret_hash TEXT NOT NULL,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            public_base_url TEXT DEFAULT '',
            git_sha TEXT DEFAULT '',
            active_user_count INTEGER DEFAULT 0,
            users_backend TEXT DEFAULT '',
            telemetry_opt_in INTEGER DEFAULT 0,
            extra_json TEXT DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            traceback_id TEXT NOT NULL,
            traceback_fp TEXT NOT NULL,
            feature_fp TEXT NOT NULL,
            cluster_key TEXT NOT NULL,
            instance_id TEXT NOT NULL,
            source TEXT DEFAULT '',
            title TEXT DEFAULT '',
            exception TEXT DEFAULT '',
            top_frame TEXT DEFAULT '',
            traceback_text TEXT DEFAULT '',
            feature_check_json TEXT DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reports_cluster ON reports(cluster_key, created_at);
        CREATE INDEX IF NOT EXISTS idx_reports_tb ON reports(traceback_id);
        CREATE TABLE IF NOT EXISTS clusters (
            cluster_key TEXT PRIMARY KEY,
            traceback_fp TEXT NOT NULL,
            feature_fp TEXT NOT NULL,
            similar_count INTEGER DEFAULT 0,
            instance_count INTEGER DEFAULT 0,
            last_traceback_id TEXT DEFAULT '',
            last_instance_id TEXT DEFAULT '',
            exception TEXT DEFAULT '',
            top_frame TEXT DEFAULT '',
            compact_report_json TEXT DEFAULT '{}',
            github_url TEXT DEFAULT '',
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS solve_reports (
            id TEXT PRIMARY KEY,
            traceback_id TEXT NOT NULL,
            cluster_key TEXT DEFAULT '',
            prompts_used INTEGER DEFAULT 0,
            hours_elapsed REAL DEFAULT 0,
            verdict TEXT NOT NULL,
            root_cause TEXT DEFAULT '',
            why TEXT DEFAULT '',
            lesson TEXT DEFAULT '',
            related_paths_json TEXT DEFAULT '[]',
            confirmed INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def is_official_hub() -> bool:
    from backend.services.marketplace_config_service import _is_official_host

    return bool(_is_official_host())


def telemetry_opted_in() -> bool:
    if is_official_hub():
        return True
    from backend.services import instance_setup_service as setup

    return bool(setup.telemetry_opt_in())


def should_forward_to_hub() -> bool:
    return telemetry_opted_in() and not is_official_hub()


def hub_base() -> str:
    from backend.services import marketplace_config_service as market

    url = str((market.load() or {}).get("hub_url") or DEFAULT_HUB).strip().rstrip("/")
    return url or DEFAULT_HUB


def local_identity() -> dict[str, str]:
    from backend.services import marketplace_config_service as market

    cfg = market.ensure_instance_identity()
    return {
        "instance_id": str(cfg.get("instance_id") or "").strip(),
        "instance_secret": str(cfg.get("instance_secret") or "").strip(),
    }


def secret_hash(secret: str) -> str:
    return hashlib.sha256(f"render-debug-instance:{secret or ''}".encode("utf-8")).hexdigest()


def git_sha() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(ROOT_DIR),
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        return out.decode("utf-8", "ignore").strip()[:12]
    except Exception:
        return ""


def active_user_count() -> int:
    try:
        from backend.services import supabase_users_store as sbusers

        n = sbusers.cached_probe().get("count")
        if n is not None:
            return max(0, int(n))
    except Exception:
        pass
    return 0


def redact_traceback(text: str) -> str:
    raw = log_redact.redact_text(str(text or ""))
    raw = _HOME_RE.sub("<home>", raw)
    return raw[:MAX_TRACEBACK]


def traceback_fingerprint(text: str) -> tuple[str, str, str]:
    cleaned = redact_traceback(text)
    frames = _FRAME_RE.findall(cleaned)
    tails = [f"{Path(path).name}:{fn}" for path, fn in frames[-8:]]
    top = tails[-1] if tails else ""
    match = _EXC_RE.search(cleaned)
    exc = match.group(1) if match else ""
    normalized = _LINE_RE.sub("line N", cleaned)
    key = "|".join([exc, *tails]) or normalized[:400]
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]
    return digest, exc, top


def feature_fingerprint(check: dict[str, Any] | None) -> str:
    parts: list[str] = []
    for key in sorted((check or {}).keys()):
        name = str(key or "").strip().lower()
        if not name or len(name) > 80:
            continue
        status = str((check or {}).get(key) or "unknown").strip().lower()
        if status not in STATUSES:
            status = "unknown"
        parts.append(f"{name}:{status}")
    if not parts:
        return ""
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16]


def cluster_key(traceback_fp: str, feature_fp: str) -> str:
    return f"{traceback_fp}:{feature_fp or 'nocheck'}"


def _valid_instance_id(value: str) -> bool:
    return bool(_UUID_RE.match((value or "").strip()))


def register_instance(
    *,
    instance_id: str,
    instance_secret: str,
    public_base_url: str = "",
    git_sha_value: str = "",
    active_users: int = 0,
    users_backend: str = "",
    telemetry_opt_in: bool = False,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    iid = (instance_id or "").strip()
    secret = (instance_secret or "").strip()
    if not _valid_instance_id(iid) or len(secret) < 16:
        raise ValueError("instance_id and instance_secret are required")
    digest = secret_hash(secret)
    stamp = now()
    host = _safe_host(public_base_url)
    with _conn() as conn:
        existing = conn.execute(
            "SELECT secret_hash FROM instances WHERE instance_id = ?", (iid,)
        ).fetchone()
        if existing and not hmac.compare_digest(str(existing["secret_hash"]), digest):
            raise ValueError("instance secret does not match")
        conn.execute(
            """
            INSERT INTO instances (
                instance_id, secret_hash, first_seen, last_seen, public_base_url,
                git_sha, active_user_count, users_backend, telemetry_opt_in, extra_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(instance_id) DO UPDATE SET
                last_seen = excluded.last_seen,
                public_base_url = excluded.public_base_url,
                git_sha = excluded.git_sha,
                active_user_count = excluded.active_user_count,
                users_backend = excluded.users_backend,
                telemetry_opt_in = excluded.telemetry_opt_in,
                extra_json = excluded.extra_json
            """,
            (
                iid,
                digest,
                stamp,
                stamp,
                host,
                (git_sha_value or "")[:12],
                max(0, int(active_users or 0)),
                (users_backend or "")[:40],
                1 if telemetry_opt_in else 0,
                json.dumps(extra or {}, separators=(",", ":"))[:2000],
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM instances WHERE instance_id = ?", (iid,)).fetchone()
    payload = _public_instance(row)
    _maybe_supabase_upsert_instance(payload)
    return payload


def verify_instance(instance_id: str, instance_secret: str) -> bool:
    iid = (instance_id or "").strip()
    secret = (instance_secret or "").strip()
    if not _valid_instance_id(iid) or len(secret) < 16:
        return False
    digest = secret_hash(secret)
    with _conn() as conn:
        row = conn.execute(
            "SELECT secret_hash FROM instances WHERE instance_id = ?", (iid,)
        ).fetchone()
    if not row:
        return False
    return hmac.compare_digest(str(row["secret_hash"]), digest)


def heartbeat_instance(
    *,
    instance_id: str,
    instance_secret: str,
    active_users: int = 0,
    git_sha_value: str = "",
    users_backend: str = "",
    public_base_url: str = "",
) -> dict[str, Any]:
    if not verify_instance(instance_id, instance_secret):
        raise ValueError("unknown instance")
    stamp = now()
    with _conn() as conn:
        conn.execute(
            """
            UPDATE instances SET last_seen = ?, active_user_count = ?, git_sha = ?,
                users_backend = ?, public_base_url = COALESCE(NULLIF(?, ''), public_base_url)
            WHERE instance_id = ?
            """,
            (
                stamp,
                max(0, int(active_users or 0)),
                (git_sha_value or "")[:12],
                (users_backend or "")[:40],
                _safe_host(public_base_url),
                instance_id,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM instances WHERE instance_id = ?", (instance_id,)
        ).fetchone()
    payload = _public_instance(row)
    _maybe_supabase_upsert_instance(payload)
    return payload


def _public_instance(row: sqlite3.Row | None) -> dict[str, Any]:
    data = _row(row) or {}
    data.pop("secret_hash", None)
    data.pop("extra_json", None)
    data["telemetry_opt_in"] = bool(data.get("telemetry_opt_in"))
    return data


def _safe_host(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if not host or host in {"localhost", "127.0.0.1", "::1"}:
        return ""
    return f"{parsed.scheme or 'https'}://{host}"[:200]


def ingest_report(
    *,
    title: str = "",
    traceback_text: str = "",
    feature_check: dict[str, Any] | None = None,
    source: str = "",
    instance_id: str = "",
    traceback_id: str = "",
    forward: bool | None = None,
) -> dict[str, Any]:
    identity = local_identity()
    iid = (instance_id or identity.get("instance_id") or "").strip()
    body = redact_traceback(traceback_text)
    if len(body.strip()) < 8:
        raise ValueError("traceback required")
    tb_fp, exc, top = traceback_fingerprint(body)
    feat_fp = feature_fingerprint(feature_check)
    key = cluster_key(tb_fp, feat_fp)
    tid = (traceback_id or "").strip() or f"trb_{uuid.uuid4().hex[:12]}"
    rid = str(uuid.uuid4())
    stamp = now()
    check = dict(feature_check or {})
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO reports (
                id, traceback_id, traceback_fp, feature_fp, cluster_key, instance_id,
                source, title, exception, top_frame, traceback_text, feature_check_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rid,
                tid,
                tb_fp,
                feat_fp,
                key,
                iid or "local",
                (source or "")[:80],
                (title or "")[:MAX_TITLE],
                exc,
                top,
                body,
                json.dumps(check, separators=(",", ":"))[:4000],
                stamp,
            ),
        )
        similar, instance_count = _cluster_counts(conn, key)
        compact = {
            "traceback_id": tid,
            "instance_id": iid or "local",
            "similar_count": similar,
            "instance_count": instance_count,
            "same_scenario": bool(feat_fp) and similar >= 2,
            "exception": exc,
            "top_frame": top,
            "traceback_fp": tb_fp,
            "feature_fp": feat_fp,
            "cluster_key": key,
        }
        conn.execute(
            """
            INSERT INTO clusters (
                cluster_key, traceback_fp, feature_fp, similar_count, instance_count,
                last_traceback_id, last_instance_id, exception, top_frame,
                compact_report_json, github_url, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
            ON CONFLICT(cluster_key) DO UPDATE SET
                similar_count = excluded.similar_count,
                instance_count = excluded.instance_count,
                last_traceback_id = excluded.last_traceback_id,
                last_instance_id = excluded.last_instance_id,
                exception = excluded.exception,
                top_frame = excluded.top_frame,
                compact_report_json = excluded.compact_report_json,
                updated_at = excluded.updated_at
            """,
            (
                key,
                tb_fp,
                feat_fp,
                similar,
                instance_count,
                tid,
                iid or "local",
                exc,
                top,
                json.dumps(compact, separators=(",", ":")),
                stamp,
            ),
        )
        conn.commit()
        cluster = _row(conn.execute("SELECT * FROM clusters WHERE cluster_key = ?", (key,)).fetchone()) or {}
    github = None
    if is_official_hub() and compact["same_scenario"] and similar >= 2 and not str(cluster.get("github_url") or "").strip():
        github = _maybe_github_note(compact, title)
        if github and github.get("html_url"):
            with _conn() as conn:
                conn.execute(
                    "UPDATE clusters SET github_url = ? WHERE cluster_key = ? AND (github_url IS NULL OR github_url = '')",
                    (str(github.get("html_url")), key),
                )
                conn.commit()
    result = {
        "ok": True,
        "id": rid,
        "traceback_id": tid,
        "cluster": compact,
        "github": github,
        "forwarded": False,
    }
    do_forward = should_forward_to_hub() if forward is None else bool(forward)
    if do_forward:
        result["forwarded"] = bool(_forward_to_hub(title=title, traceback_text=body, feature_check=check, traceback_id=tid, source=source))
    return result


def ingest_quietly(**kwargs: Any) -> dict[str, Any] | None:
    try:
        return ingest_report(**kwargs)
    except Exception:
        logger.warning("debug training ingest skipped", exc_info=True)
        return None


def _cluster_counts(conn: sqlite3.Connection, key: str) -> tuple[int, int]:
    similar = int(conn.execute("SELECT COUNT(*) FROM reports WHERE cluster_key = ?", (key,)).fetchone()[0])
    instances = int(
        conn.execute(
            "SELECT COUNT(DISTINCT instance_id) FROM reports WHERE cluster_key = ?", (key,)
        ).fetchone()[0]
    )
    return similar, instances


def similar_reports(query: str = "", *, limit: int = 40) -> dict[str, Any]:
    q = (query or "").strip().lower()
    cap = max(1, min(int(limit or 40), 100))
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM clusters ORDER BY similar_count DESC, updated_at DESC LIMIT 200"
        ).fetchall()
        solves = conn.execute(
            "SELECT * FROM solve_reports ORDER BY created_at DESC LIMIT 80"
        ).fetchall()
    clusters = []
    for row in rows:
        item = _row(row) or {}
        blob = f"{item.get('exception')} {item.get('top_frame')} {item.get('last_traceback_id')} {item.get('compact_report_json')}".lower()
        if q and q not in blob and q not in str(item.get("cluster_key") or "").lower():
            continue
        try:
            item["compact"] = json.loads(item.get("compact_report_json") or "{}")
        except json.JSONDecodeError:
            item["compact"] = {}
        item.pop("compact_report_json", None)
        clusters.append(item)
        if len(clusters) >= cap:
            break
    return {
        "clusters": clusters,
        "solve_reports": [_public_solve(row) for row in solves[:cap]],
        "query": q,
    }


def overview() -> dict[str, Any]:
    with _conn() as conn:
        cluster_n = int(conn.execute("SELECT COUNT(*) FROM clusters").fetchone()[0])
        report_n = int(conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0])
        instance_n = int(conn.execute("SELECT COUNT(*) FROM instances").fetchone()[0])
        solve_n = int(conn.execute("SELECT COUNT(*) FROM solve_reports").fetchone()[0])
        matched = int(
            conn.execute("SELECT COUNT(*) FROM clusters WHERE similar_count >= 2 AND feature_fp != ''").fetchone()[0]
        )
        hot = conn.execute(
            "SELECT * FROM clusters ORDER BY similar_count DESC, updated_at DESC LIMIT 12"
        ).fetchall()
    identity = local_identity()
    return {
        "local_instance_id": identity.get("instance_id"),
        "official_hub": is_official_hub(),
        "telemetry_opt_in": telemetry_opted_in(),
        "forward_to_hub": should_forward_to_hub(),
        "counts": {
            "clusters": cluster_n,
            "reports": report_n,
            "instances": instance_n,
            "solve_reports": solve_n,
            "same_scenario": matched,
        },
        "hot_clusters": [
            {
                "cluster_key": row["cluster_key"],
                "similar_count": row["similar_count"],
                "instance_count": row["instance_count"],
                "traceback_id": row["last_traceback_id"],
                "instance_id": row["last_instance_id"],
                "exception": row["exception"],
                "top_frame": row["top_frame"],
                "same_scenario": bool(row["feature_fp"]) and int(row["similar_count"] or 0) >= 2,
                "github_url": row["github_url"],
            }
            for row in hot
        ],
    }


def record_solve_report(data: dict[str, Any]) -> dict[str, Any]:
    tid = str(data.get("traceback_id") or "").strip()
    if not tid:
        raise ValueError("traceback_id required")
    verdict = str(data.get("verdict") or "").strip().lower()
    if verdict not in VERDICTS:
        raise ValueError("verdict must be spot_on, missed_earlier, looked_unrelated, or wrong_then_corrected")
    prompts = max(1, int(data.get("prompts_used") or 1))
    hours = data.get("hours_elapsed")
    cluster = _cluster_for_traceback(tid)
    if hours is None:
        hours = _hours_since(cluster.get("started_at") if cluster else None)
    try:
        hours_n = max(0.0, float(hours or 0))
    except (TypeError, ValueError):
        hours_n = 0.0
    paths = data.get("related_paths") or []
    if isinstance(paths, str):
        paths = [paths]
    clean_paths = [str(p).strip()[:200] for p in paths if str(p).strip()][:24]
    rid = str(uuid.uuid4())
    stamp = now()
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO solve_reports (
                id, traceback_id, cluster_key, prompts_used, hours_elapsed, verdict,
                root_cause, why, lesson, related_paths_json, confirmed, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rid,
                tid,
                str((cluster or {}).get("cluster_key") or ""),
                prompts,
                hours_n,
                verdict,
                str(data.get("root_cause") or "")[:800],
                str(data.get("why") or data.get("lesson_why") or "")[:1200],
                str(data.get("lesson") or "")[:1200],
                json.dumps(clean_paths),
                1 if data.get("confirmed") else 0,
                stamp,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM solve_reports WHERE id = ?", (rid,)).fetchone()
    return _public_solve(row)


def _public_solve(row: sqlite3.Row | None) -> dict[str, Any]:
    data = _row(row) or {}
    try:
        data["related_paths"] = json.loads(data.get("related_paths_json") or "[]")
    except json.JSONDecodeError:
        data["related_paths"] = []
    data.pop("related_paths_json", None)
    data["confirmed"] = bool(data.get("confirmed"))
    return data


def _cluster_for_traceback(traceback_id: str) -> dict[str, Any]:
    with _conn() as conn:
        report = conn.execute(
            "SELECT cluster_key, created_at FROM reports WHERE traceback_id = ? ORDER BY created_at ASC LIMIT 1",
            (traceback_id,),
        ).fetchone()
        if not report:
            return {}
        cluster = conn.execute(
            "SELECT * FROM clusters WHERE cluster_key = ?", (report["cluster_key"],)
        ).fetchone()
    out = _row(cluster) or {}
    out["started_at"] = report["created_at"]
    return out


def _hours_since(started_at: str | None) -> float:
    if not started_at:
        return 0.0
    try:
        start = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        return max(0.0, round((datetime.now(timezone.utc) - start).total_seconds() / 3600.0, 3))
    except Exception:
        return 0.0


def ensure_local_instance(*, register_hub: bool | None = None) -> dict[str, Any]:
    identity = local_identity()
    iid = identity.get("instance_id") or ""
    secret = identity.get("instance_secret") or ""
    if not iid or not secret:
        return {"ok": False, "error": "no_instance_identity"}
    from backend.services import supabase_users_store as sbusers

    payload = {
        "instance_id": iid,
        "instance_secret": secret,
        "public_base_url": str(getattr(settings, "public_base_url", "") or ""),
        "git_sha_value": git_sha(),
        "active_users": active_user_count(),
        "users_backend": sbusers.cached_users_backend(),
        "telemetry_opt_in": telemetry_opted_in(),
    }
    local = register_instance(**payload)
    do_hub = should_forward_to_hub() if register_hub is None else bool(register_hub)
    hub = None
    if do_hub:
        hub = _post_hub(HUB_REGISTER, {**payload, "git_sha": payload["git_sha_value"]})
    return {"ok": True, "instance": local, "hub": hub}


def maybe_heartbeat() -> dict[str, Any] | None:
    try:
        identity = local_identity()
        from backend.services import supabase_users_store as sbusers

        body = {
            "instance_id": identity.get("instance_id"),
            "instance_secret": identity.get("instance_secret"),
            "active_users": active_user_count(),
            "git_sha_value": git_sha(),
            "users_backend": sbusers.cached_users_backend(),
            "public_base_url": str(getattr(settings, "public_base_url", "") or ""),
        }
        local = heartbeat_instance(**body) if verify_instance(body["instance_id"], body["instance_secret"]) else register_instance(**{**body, "telemetry_opt_in": telemetry_opted_in()})
        hub = None
        if should_forward_to_hub():
            hub = _post_hub(
                HUB_HEARTBEAT,
                {
                    "instance_id": body["instance_id"],
                    "instance_secret": body["instance_secret"],
                    "active_users": body["active_users"],
                    "git_sha": body["git_sha_value"],
                    "users_backend": body["users_backend"],
                    "public_base_url": body["public_base_url"],
                },
            )
        return {"instance": local, "hub": hub}
    except Exception:
        logger.warning("debug training heartbeat skipped", exc_info=True)
        return None


def list_instances(*, limit: int = 80) -> list[dict[str, Any]]:
    cap = max(1, min(int(limit or 80), 200))
    with _conn() as conn:
        rows = conn.execute(
            "SELECT instance_id, first_seen, last_seen, public_base_url, git_sha, active_user_count, users_backend, telemetry_opt_in FROM instances ORDER BY last_seen DESC LIMIT ?",
            (cap,),
        ).fetchall()
    return [_public_instance(row) for row in rows]


def _forward_to_hub(
    *,
    title: str,
    traceback_text: str,
    feature_check: dict[str, Any],
    traceback_id: str,
    source: str,
) -> dict[str, Any] | None:
    identity = local_identity()
    return _post_hub(
        HUB_INGEST,
        {
            "instance_id": identity.get("instance_id"),
            "instance_secret": identity.get("instance_secret"),
            "title": title,
            "traceback_text": traceback_text,
            "feature_check": feature_check,
            "traceback_id": traceback_id,
            "source": source or "clone",
        },
    )


def _post_hub(path: str, body: dict[str, Any]) -> dict[str, Any] | None:
    base = hub_base()
    if not base or "render3d.app" not in base:
        return None
    try:
        import httpx

        resp = httpx.post(f"{base}{path}", json=body, timeout=4.0)
        if resp.status_code >= 400:
            logger.warning("debug hub %s -> %s", path, resp.status_code)
            return {"ok": False, "status": resp.status_code}
        data = resp.json() if resp.content else {}
        return data if isinstance(data, dict) else {"ok": True}
    except Exception:
        logger.warning("debug hub post failed %s", path, exc_info=True)
        return None


def _maybe_github_note(compact: dict[str, Any], title: str) -> dict[str, Any] | None:
    if not is_official_hub():
        return None
    heading = (title or compact.get("exception") or "matched debug cluster").strip()[:70]
    body = (
        f"traceback_id: {compact.get('traceback_id')}\n"
        f"instance_id: {compact.get('instance_id')}\n"
        f"similar_count: {compact.get('similar_count')}\n"
        f"instance_count: {compact.get('instance_count')}\n"
        f"exception: {compact.get('exception')}\n"
        f"top_frame: {compact.get('top_frame')}\n"
        f"same_scenario: {compact.get('same_scenario')}\n"
    )
    try:
        from backend.services import github_link_service

        return github_link_service.push_bug_note(heading, body)
    except Exception:
        logger.warning("debug cluster github note skipped", exc_info=True)
        return None


def _maybe_supabase_upsert_instance(payload: dict[str, Any]) -> None:
    """Best-effort hub mirror. Missing table is not an error — sqlite is source of truth."""
    if not is_official_hub() or not payload.get("instance_id"):
        return
    try:
        from backend.services import supabase_client

        client = supabase_client.client()
        if not client:
            return
        client.table("debug_instances").upsert(
            {
                "instance_id": payload.get("instance_id"),
                "last_seen": payload.get("last_seen"),
                "first_seen": payload.get("first_seen"),
                "public_base_url": payload.get("public_base_url") or "",
                "git_sha": payload.get("git_sha") or "",
                "active_user_count": int(payload.get("active_user_count") or 0),
                "users_backend": payload.get("users_backend") or "",
                "telemetry_opt_in": bool(payload.get("telemetry_opt_in")),
            },
            on_conflict="instance_id",
        ).execute()
    except Exception:
        logger.debug("debug_instances supabase upsert skipped", exc_info=True)
