"""Per-user AI default source preferences (subscription vs keys) + workspace overrides."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn

VALID_SOURCES = {"subscription", "personal", "key"}
VALID_KEY_SOURCES = {"personal", "team", "platform"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_tables() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS user_ai_default_prefs (
                user_id TEXT PRIMARY KEY,
                source TEXT NOT NULL DEFAULT 'subscription',
                key_id TEXT,
                key_source TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_workspace_ai_defaults (
                user_id TEXT NOT NULL,
                team_id TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'subscription',
                key_id TEXT,
                key_source TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, team_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
            );
            """
        )


def _normalize_source(source: str | None) -> str:
    s = str(source or "subscription").strip().lower()
    if s in {"sub", "credits", "platform", "render", "renderstudio", "subscription"}:
        return "subscription"
    if s in {"own", "personal", "user"}:
        return "personal"
    if s in {"key", "specific", "custom"}:
        return "key"
    if s in VALID_SOURCES:
        return s
    return "subscription"


def _normalize_key_source(key_source: str | None, source: str) -> str | None:
    if source == "subscription":
        return "platform"
    if source == "personal":
        return "personal"
    ks = str(key_source or "personal").strip().lower()
    if ks in {"platform", "subscription", "credits"}:
        return "platform"
    if ks in {"team", "shared"}:
        return "team"
    if ks in {"personal", "user", "own"}:
        return "personal"
    return "personal"


def _row_to_pref(row: Any | None) -> dict[str, Any]:
    if not row:
        return {
            "source": "subscription",
            "key_id": None,
            "key_source": "platform",
            "label": "Subscription (Render Studio credits)",
        }
    source = _normalize_source(row["source"] if isinstance(row, dict) else row["source"])
    key_id = (row["key_id"] if isinstance(row, dict) else row["key_id"]) or None
    key_source = _normalize_key_source(
        row["key_source"] if isinstance(row, dict) else row["key_source"],
        source,
    )
    return {
        "source": source,
        "key_id": key_id,
        "key_source": key_source,
        "label": _label(source, key_id, key_source),
    }


def _label(source: str, key_id: str | None, key_source: str | None) -> str:
    if source == "subscription":
        return "Subscription (Render Studio credits)"
    if source == "personal":
        return "Active personal API key"
    ks = key_source or "personal"
    return f"Specific {ks} key" + (f" ({key_id[:8]}…)" if key_id else "")


def get_global_pref(user_id: str) -> dict[str, Any]:
    ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT source, key_id, key_source, updated_at FROM user_ai_default_prefs WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    pref = _row_to_pref(row)
    if row:
        pref["updated_at"] = row["updated_at"]
    return pref


def list_workspace_overrides(user_id: str) -> list[dict[str, Any]]:
    ensure_tables()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT d.team_id, d.source, d.key_id, d.key_source, d.updated_at, t.name AS team_name
            FROM user_workspace_ai_defaults d
            LEFT JOIN teams t ON t.id = d.team_id
            WHERE d.user_id = ?
            ORDER BY t.name COLLATE NOCASE, d.team_id
            """,
            (user_id,),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        pref = _row_to_pref(row)
        pref["team_id"] = row["team_id"]
        pref["team_name"] = row["team_name"] or row["team_id"]
        pref["updated_at"] = row["updated_at"]
        out.append(pref)
    return out


def status_for_user(user_id: str, *, team_id: str | None = None) -> dict[str, Any]:
    ensure_tables()
    global_pref = get_global_pref(user_id)
    overrides = list_workspace_overrides(user_id)
    effective = dict(global_pref)
    matched_override = None
    if team_id:
        for row in overrides:
            if row["team_id"] == team_id:
                matched_override = row
                effective = {
                    "source": row["source"],
                    "key_id": row["key_id"],
                    "key_source": row["key_source"],
                    "label": row["label"],
                    "from_workspace": True,
                    "team_id": team_id,
                    "team_name": row.get("team_name"),
                }
                break
    if "from_workspace" not in effective:
        effective["from_workspace"] = False
    return {
        "default_source": global_pref["source"],
        "global": global_pref,
        "effective": effective,
        "workspace_overrides": overrides,
        "always_default_to_subscription": True,
        "options": [
            {"id": "subscription", "label": "Subscription (Render Studio credits)"},
            {"id": "personal", "label": "Active personal API key"},
            {"id": "key", "label": "Choose a specific key"},
        ],
    }


def set_global_pref(
    user_id: str,
    *,
    source: str = "subscription",
    key_id: str | None = None,
    key_source: str | None = None,
) -> dict[str, Any]:
    ensure_tables()
    source_n = _normalize_source(source)
    key_source_n = _normalize_key_source(key_source, source_n)
    key_id_n = (key_id or "").strip() or None
    if source_n != "key":
        key_id_n = None if source_n == "subscription" else key_id_n
    if source_n == "key" and not key_id_n:
        raise ValueError("Choose a specific key when default source is 'key'")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_ai_default_prefs (user_id, source, key_id, key_source, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              source = excluded.source,
              key_id = excluded.key_id,
              key_source = excluded.key_source,
              updated_at = excluded.updated_at
            """,
            (user_id, source_n, key_id_n, key_source_n, _now()),
        )
        conn.commit()
    # Keep platform toggle aligned when subscription is the default.
    if source_n == "subscription":
        try:
            from backend.services import ai_credit_service

            account = ai_credit_service.ensure_account(user_id)
            if int(account.get("balance_cents") or 0) > 0:
                ai_credit_service.update_settings(user_id, use_platform_key=True)
        except Exception:
            pass
    return status_for_user(user_id)


def set_workspace_override(
    user_id: str,
    team_id: str,
    *,
    source: str = "subscription",
    key_id: str | None = None,
    key_source: str | None = None,
) -> dict[str, Any]:
    ensure_tables()
    team_id = (team_id or "").strip()
    if not team_id:
        raise ValueError("team_id is required")
    with get_conn() as conn:
        member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (team_id, user_id),
        ).fetchone()
        if not member:
            raise ValueError("You are not a member of that workspace")
    source_n = _normalize_source(source)
    key_source_n = _normalize_key_source(key_source, source_n)
    key_id_n = (key_id or "").strip() or None
    if source_n != "key":
        key_id_n = None if source_n == "subscription" else key_id_n
    if source_n == "key" and not key_id_n:
        raise ValueError("Choose a specific key when default source is 'key'")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_workspace_ai_defaults
              (user_id, team_id, source, key_id, key_source, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, team_id) DO UPDATE SET
              source = excluded.source,
              key_id = excluded.key_id,
              key_source = excluded.key_source,
              updated_at = excluded.updated_at
            """,
            (user_id, team_id, source_n, key_id_n, key_source_n, _now()),
        )
        conn.commit()
    return status_for_user(user_id, team_id=team_id)


def clear_workspace_override(user_id: str, team_id: str) -> dict[str, Any]:
    ensure_tables()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM user_workspace_ai_defaults WHERE user_id = ? AND team_id = ?",
            (user_id, team_id),
        )
        conn.commit()
    return status_for_user(user_id)


def prompt_option_value(pref: dict[str, Any] | None) -> str:
    """Map a pref dict to the frontend prompt select value (platform:… / personal:… / team:…)."""
    if not pref:
        return "platform:openai"
    source = _normalize_source(pref.get("source"))
    if source == "subscription":
        provider = str(pref.get("key_id") or "openai").strip() or "openai"
        if provider in {"personal", "team", "platform", "subscription"}:
            provider = "openai"
        return f"platform:{provider}"
    if source == "personal":
        kid = (pref.get("key_id") or "").strip()
        return f"personal:{kid}" if kid else ""
    kid = (pref.get("key_id") or "").strip()
    ks = _normalize_key_source(pref.get("key_source"), "key")
    if not kid:
        return "platform:openai" if ks == "platform" else ""
    if ks == "platform":
        return f"platform:{kid}"
    if ks == "team":
        return f"team:{kid}"
    return f"personal:{kid}"
