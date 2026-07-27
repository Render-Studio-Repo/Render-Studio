"""Prepaid credits for users borrowing Render Studio platform AI keys (OpenAI + Claude + Kimi)."""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from backend.config import settings
from backend.database import get_conn

MARKUP_PERCENT = 15
MIN_CHECKOUT_CENTS = 500
DEFAULT_REFILL_CENTS = 2000
DEFAULT_REFILL_THRESHOLD_CENTS = 500
MAX_PAYMENT_LINK_CENTS = 100_000
SIGNUP_TRIAL_CENTS = 1000  # $10 Render Studio key trial for every account once
TRIAL_GRANTS_PER_WEEK = 10  # company-funded new trial grants per rolling 7 days
TRIAL_IDLE_RECLAIM_DAYS = 7  # unused balance reclaimed after this idle period
TRIAL_DURATION_DAYS = 7  # advertised trial window on popup / status
# Free-trial Quality mode may not use these expensive OpenAI models.
TRIAL_QUALITY_BLOCKED_OPENAI = frozenset({"gpt-5.5", "gpt-5.5-pro"})
TRIAL_QUALITY_OPENAI_FALLBACK = "gpt-5.6-sol"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _stripe():
    key = (getattr(settings, "stripe_secret_key", None) or "").strip()
    if not key:
        return None
    try:
        import stripe
    except ImportError:
        return None
    stripe.api_key = key
    return stripe


def _stripe_as_dict(value: Any) -> dict[str, Any]:
    """Normalize Stripe SDK objects to plain dicts (SDK no longer supports ``.get``)."""
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    for attr in ("to_dict_recursive", "to_dict"):
        fn = getattr(value, attr, None)
        if callable(fn):
            try:
                data = fn()
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
    try:
        return {key: value[key] for key in value.keys()}  # type: ignore[attr-defined]
    except Exception:
        return {}


def _stripe_get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    try:
        return value[key]
    except Exception:
        return default


def _payment_link_url() -> str:
    return (getattr(settings, "stripe_ai_credits_payment_link_url", None) or "").strip()


def _payment_link_id() -> str:
    return (getattr(settings, "stripe_ai_credits_payment_link_id", None) or "").strip()


def _with_query(url: str, params: dict[str, Any]) -> str:
    parsed = urlparse(url)
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for key, value in params.items():
        if value is not None and str(value).strip():
            existing[key] = str(value).strip()
    return urlunparse(parsed._replace(query=urlencode(existing)))


def _user_for_checkout_session(session: dict[str, Any]) -> dict[str, Any] | None:
    session = _stripe_as_dict(session)
    metadata = _stripe_as_dict(session.get("metadata"))
    customer_details = _stripe_as_dict(session.get("customer_details"))
    user_id = str(session.get("client_reference_id") or metadata.get("user_id") or "").strip()
    email = (
        customer_details.get("email")
        or session.get("customer_email")
        or metadata.get("email")
        or ""
    )
    with get_conn() as conn:
        row = None
        if user_id:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row and email:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (str(email).strip().lower(),)).fetchone()
    return dict(row) if row else None


def platform_openai_configured() -> bool:
    return bool((getattr(settings, "openai_api_key", None) or "").strip())


def platform_anthropic_configured() -> bool:
    return bool((getattr(settings, "anthropic_api_key", None) or "").strip())


def platform_kimi_configured() -> bool:
    return bool((getattr(settings, "kimi_api_key", None) or "").strip())


def normalize_platform_provider(provider: str | None) -> str:
    p = str(provider or "openai").strip().lower()
    if p in {"claude", "anthropic"}:
        return "anthropic"
    if p in {"kimi", "moonshot"}:
        return "kimi"
    return "openai"


def platform_models() -> list[dict[str, str]]:
    models: list[tuple[str, str]] = []
    if platform_openai_configured():
        models.extend(
            [
                ("openai", settings.openai_model),
                ("openai", settings.openai_model_quality),
                ("openai", "gpt-5.5"),
                ("openai", "gpt-5.5-pro"),
                ("openai", "gpt-5.3-codex"),
                ("openai", "gpt-5.6-sol"),
            ]
        )
    if platform_anthropic_configured():
        models.extend(
            [
                ("anthropic", settings.anthropic_model),
                ("anthropic", getattr(settings, "anthropic_model_quality", None) or "claude-opus-4-8"),
                ("anthropic", "claude-opus-5"),
                ("anthropic", "claude-fable-5"),
                ("anthropic", "claude-sonnet-4-5"),
                ("anthropic", "claude-opus-4-8"),
                ("anthropic", "claude-4.6-sonnet"),
            ]
        )
    if platform_kimi_configured():
        models.extend(
            [
                ("kimi", getattr(settings, "kimi_model", None) or "kimi-k2.6"),
                ("kimi", getattr(settings, "kimi_model_quality", None) or "kimi-k3"),
                ("kimi", "kimi-k2.6"),
                ("kimi", "kimi-k2.5"),
                ("kimi", "kimi-k3"),
            ]
        )
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, str]] = []
    for provider, model in models:
        name = str(model or "").strip()
        if not name or (provider, name) in seen:
            continue
        seen.add((provider, name))
        out.append({"provider": provider, "model": name})
    return out


def _platform_models_for_account(account: dict[str, Any] | None) -> list[dict[str, str]]:
    models = platform_models()
    # UI still lists GPT-5.5 for Speed; Quality selection is blocked server-side for free trial.
    # Annotate restricted models so the client can hide them in Quality mode.
    on_trial = is_free_trial_credits_account(account)
    out: list[dict[str, str]] = []
    for item in models:
        row = dict(item)
        model = str(row.get("model") or "").strip().lower()
        if on_trial and row.get("provider") == "openai" and model in TRIAL_QUALITY_BLOCKED_OPENAI:
            row["trial_quality_blocked"] = True
        out.append(row)
    return out


def _platform_model_matches_provider(model: str | None, provider: str) -> bool:
    m = str(model or "").strip().lower()
    if not m:
        return True
    prov = normalize_platform_provider(provider)
    if prov == "anthropic":
        return not (m.startswith(("gpt", "o1", "o3", "chatgpt")) or m.startswith("kimi"))
    if prov == "kimi":
        return m.startswith("kimi") or "moonshot" in m
    return m.startswith(("gpt", "o1", "o3", "chatgpt"))


def _default_platform_model(provider: str, *, speed: str = "fast") -> str:
    prov = normalize_platform_provider(provider)
    if prov == "anthropic":
        if speed == "fast":
            return str(settings.anthropic_model or "claude-sonnet-4-5")
        return str(getattr(settings, "anthropic_model_quality", None) or "claude-opus-4-8")
    if prov == "kimi":
        if speed == "fast":
            return str(getattr(settings, "kimi_model", None) or "kimi-k2.6")
        return str(getattr(settings, "kimi_model_quality", None) or "kimi-k3")
    # Never default a provider switch to Pro — Quality mode can still pick Pro when OpenAI is active.
    return str(settings.openai_model or "gpt-5.5")


def resolve_platform_credentials(
    account: dict[str, Any] | None,
    *,
    speed: str = "fast",
    provider: str | None = None,
    model: str | None = None,
) -> dict[str, str] | None:
    """Pick Render Studio platform OpenAI/Claude/Kimi credentials for a credit account.

    ``provider`` / ``model`` let a prompt request pick a shared provider explicitly
    instead of only the account's single preferred shared model.
    """
    preferred = normalize_platform_provider(
        provider or (account or {}).get("platform_provider") or "openai"
    )
    pinned = str(model if model is not None else ((account or {}).get("platform_model") or "")).strip()
    openai_ok = platform_openai_configured()
    anthropic_ok = platform_anthropic_configured()
    kimi_ok = platform_kimi_configured()
    configured = {
        "openai": openai_ok,
        "anthropic": anthropic_ok,
        "kimi": kimi_ok,
    }
    # Only fall back across providers when the caller did not pin a provider.
    if provider is None and not configured.get(preferred):
        for candidate in ("openai", "anthropic", "kimi"):
            if configured.get(candidate):
                preferred = candidate
                break

    if preferred == "anthropic":
        if not anthropic_ok:
            return None
        if pinned and not _platform_model_matches_provider(pinned, "anthropic"):
            pinned = ""
        if pinned:
            chosen = pinned
        elif speed == "fast":
            chosen = settings.anthropic_model
        else:
            chosen = getattr(settings, "anthropic_model_quality", None) or "claude-opus-4-8"
        return {
            "provider": "anthropic",
            "model": chosen,
            "api_key": settings.anthropic_api_key.strip(),
            "shared_key_name": "Render Studio Key",
            "key_id": "anthropic",
            "source": "platform",
        }

    if preferred == "kimi":
        if not kimi_ok:
            return None
        if pinned and not _platform_model_matches_provider(pinned, "kimi"):
            pinned = ""
        if pinned:
            chosen = pinned
        elif speed == "fast":
            chosen = getattr(settings, "kimi_model", None) or "kimi-k2.6"
        else:
            chosen = getattr(settings, "kimi_model_quality", None) or "kimi-k3"
        return {
            "provider": "kimi",
            "model": chosen,
            "api_key": settings.kimi_api_key.strip(),
            "shared_key_name": "Render Studio Key",
            "key_id": "kimi",
            "source": "platform",
        }

    if not openai_ok:
        return None
    if pinned and not _platform_model_matches_provider(pinned, "openai"):
        pinned = ""
    if pinned and speed != "fast":
        chosen = pinned
    elif speed == "fast":
        chosen = settings.openai_model
    else:
        chosen = settings.openai_model_quality
    # Free-trial Quality: never run GPT-5.5 / GPT-5.5 Pro on shared credits.
    if (
        speed != "fast"
        and is_free_trial_credits_account(account)
        and str(chosen or "").strip().lower() in TRIAL_QUALITY_BLOCKED_OPENAI
    ):
        chosen = TRIAL_QUALITY_OPENAI_FALLBACK
    return {
        "provider": "openai",
        "model": chosen,
        "api_key": settings.openai_api_key.strip(),
        "shared_key_name": "Render Studio Key",
        "key_id": "openai",
        "source": "platform",
    }


def ensure_account(user_id: str) -> dict[str, Any]:
    now = _now()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ai_credit_accounts WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            conn.execute(
                """
                INSERT INTO ai_credit_accounts (
                  user_id, balance_cents, auto_refill_enabled, auto_refill_threshold_cents,
                  auto_refill_amount_cents, use_platform_key, platform_provider, platform_model,
                  created_at, updated_at
                ) VALUES (?, 0, 0, ?, ?, 0, 'openai', '', ?, ?)
                """,
                (user_id, DEFAULT_REFILL_THRESHOLD_CENTS, DEFAULT_REFILL_CENTS, now, now),
            )
            row = conn.execute("SELECT * FROM ai_credit_accounts WHERE user_id = ?", (user_id,)).fetchone()
    return dict(row) if row else {"user_id": user_id, "balance_cents": 0}


def _trial_info(account: dict[str, Any]) -> dict[str, Any]:
    granted_at = str(account.get("trial_granted_at") or "").strip() or None
    popup_seen_at = str(account.get("trial_popup_seen_at") or "").strip() or None
    email_sent_at = str(account.get("trial_email_sent_at") or "").strip() or None
    reclaimed_at = str(account.get("trial_reclaimed_at") or "").strip() or None
    balance = int(account.get("balance_cents") or 0)
    uid = str(account.get("user_id") or "")
    on_free = is_free_trial_credits_account(account, user_id=uid or None)
    # Only advertise free credits when the user still has a usable trial balance.
    # Weekly-cap / waitlisted users never get granted_at, and spent/reclaimed
    # trials must not keep showing the "$10 free" popup.
    show_popup = bool(
        granted_at
        and not popup_seen_at
        and not reclaimed_at
        and balance > 0
        and on_free
    )
    return {
        "granted": bool(granted_at),
        "granted_at": granted_at,
        "reclaimed_at": reclaimed_at,
        "amount_cents": SIGNUP_TRIAL_CENTS,
        "amount_usd": round(SIGNUP_TRIAL_CENTS / 100, 2),
        "duration_days": TRIAL_DURATION_DAYS,
        "idle_reclaim_days": TRIAL_IDLE_RECLAIM_DAYS,
        "weekly_grant_cap": TRIAL_GRANTS_PER_WEEK,
        "popup_seen": bool(popup_seen_at),
        "show_popup": show_popup,
        "email_sent": bool(email_sent_at),
        "active": bool(granted_at and balance > 0 and account.get("use_platform_key") and not reclaimed_at),
        "on_free_trial": on_free,
        "quality_blocked_openai_models": sorted(TRIAL_QUALITY_BLOCKED_OPENAI),
        "key_label": "Render Studio Key",
    }



def is_free_trial_credits_account(account: dict[str, Any] | None, user_id: str | None = None) -> bool:
    """True while the user is still on unpaid signup-trial credits (no purchase yet)."""
    if not account:
        return False
    if not str(account.get("trial_granted_at") or "").strip():
        return False
    if str(account.get("trial_reclaimed_at") or "").strip():
        return False
    uid = str(user_id or account.get("user_id") or "").strip()
    if uid and _last_purchase(uid):
        return False
    return True


def _ensure_trial_pool(conn) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO ai_credit_trial_pool (id, balance_cents, updated_at)
        VALUES (1, 0, ?)
        """,
        (_now(),),
    )


def get_trial_pool_cents() -> int:
    with get_conn() as conn:
        _ensure_trial_pool(conn)
        row = conn.execute("SELECT balance_cents FROM ai_credit_trial_pool WHERE id = 1").fetchone()
    return int((row["balance_cents"] if row else 0) or 0)


def _company_trial_grants_since(conn, since_iso: str) -> int:
    # Prefer Supabase ledger when connected (tamper-resistant weekly cap).
    try:
        from backend.services import supabase_security_store as sbsec

        remote = sbsec.company_grants_since(since_iso)
        if remote is not None:
            return int(remote)
    except Exception:
        pass
    rows = conn.execute(
        """
        SELECT meta_json FROM ai_credit_transactions
        WHERE kind = 'trial' AND created_at >= ?
        """,
        (since_iso,),
    ).fetchall()
    count = 0
    for row in rows:
        try:
            meta = json.loads(row["meta_json"] or "{}")
        except Exception:
            meta = {}
        if meta.get("from_pool"):
            continue
        count += 1
    return count


def _enqueue_trial_waitlist(conn, user_id: str, ip: str | None) -> None:
    conn.execute(
        """
        INSERT INTO ai_credit_trial_waitlist (user_id, ip, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET ip = COALESCE(excluded.ip, ai_credit_trial_waitlist.ip)
        """,
        (user_id, (ip or None), _now()),
    )
    try:
        from backend.services import supabase_security_store as sbsec

        sbsec.enqueue_waitlist(user_id, ip)
    except Exception:
        pass


def _remove_trial_waitlist(conn, user_id: str) -> None:
    conn.execute("DELETE FROM ai_credit_trial_waitlist WHERE user_id = ?", (user_id,))
    try:
        from backend.services import supabase_security_store as sbsec

        sbsec.remove_waitlist(user_id)
    except Exception:
        pass


def _trial_last_activity_at(conn, user_id: str, granted_at: str) -> datetime:
    row = conn.execute(
        """
        SELECT created_at FROM ai_credit_transactions
        WHERE user_id = ? AND kind = 'usage'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    usage_dt = _parse_iso(row["created_at"]) if row else None
    grant_dt = _parse_iso(granted_at) or datetime.now(timezone.utc)
    if usage_dt and usage_dt > grant_dt:
        return usage_dt
    return grant_dt


def reclaim_idle_trial_credits(*, now: datetime | None = None) -> dict[str, Any]:
    """Zero idle unused trial balances and move leftovers into the redistributable pool.

    After ``TRIAL_IDLE_RECLAIM_DAYS`` with no usage (and no paid purchase), remaining
    trial balance is reclaimed so it can fund another waitlisted user's free credits.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=TRIAL_IDLE_RECLAIM_DAYS)
    reclaimed_users: list[dict[str, Any]] = []
    funded_users: list[str] = []
    with get_conn() as conn:
        _ensure_trial_pool(conn)
        rows = conn.execute(
            """
            SELECT * FROM ai_credit_accounts
            WHERE trial_granted_at IS NOT NULL
              AND TRIM(COALESCE(trial_granted_at, '')) != ''
              AND (trial_reclaimed_at IS NULL OR TRIM(COALESCE(trial_reclaimed_at, '')) = '')
              AND balance_cents > 0
            """
        ).fetchall()
        pool_add = 0
        for row in rows:
            account = dict(row)
            uid = str(account["user_id"])
            # Never reclaim once they bought credits — paid balance is theirs.
            purchased = conn.execute(
                """
                SELECT 1 FROM ai_credit_transactions
                WHERE user_id = ? AND kind IN ('purchase', 'demo_purchase')
                LIMIT 1
                """,
                (uid,),
            ).fetchone()
            if purchased:
                continue
            last_activity = _trial_last_activity_at(conn, uid, str(account.get("trial_granted_at") or ""))
            if last_activity > cutoff:
                continue
            amount = int(account.get("balance_cents") or 0)
            if amount <= 0:
                continue
            stamp = now.isoformat()
            conn.execute(
                """
                UPDATE ai_credit_accounts
                SET balance_cents = 0,
                    use_platform_key = 0,
                    trial_reclaimed_at = ?,
                    updated_at = ?
                WHERE user_id = ?
                """,
                (stamp, stamp, uid),
            )
            conn.execute(
                """
                INSERT INTO ai_credit_transactions (
                  id, user_id, kind, amount_cents, balance_after_cents, provider, meta_json, created_at
                ) VALUES (?, ?, 'trial_reclaim', ?, 0, 'render3d', ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    uid,
                    -amount,
                    json.dumps(
                        {
                            "idle_days": TRIAL_IDLE_RECLAIM_DAYS,
                            "note": "Unused free trial credits reclaimed after idle week.",
                        }
                    ),
                    stamp,
                ),
            )
            pool_add += amount
            reclaimed_users.append({"user_id": uid, "amount_cents": amount})
            try:
                from backend.services import supabase_security_store as sbsec

                sbsec.record_reclaim(
                    user_id=uid,
                    amount_cents=amount,
                    meta={"idle_days": TRIAL_IDLE_RECLAIM_DAYS},
                )
            except Exception:
                pass

        if pool_add:
            conn.execute(
                """
                UPDATE ai_credit_trial_pool
                SET balance_cents = balance_cents + ?, updated_at = ?
                WHERE id = 1
                """,
                (pool_add, now.isoformat()),
            )
            try:
                from backend.services import supabase_security_store as sbsec

                sbsec.add_pool_cents(pool_add)
            except Exception:
                pass

        # Fund waitlisted users from the pool ($10 each when available).
        while True:
            pool_row = conn.execute("SELECT balance_cents FROM ai_credit_trial_pool WHERE id = 1").fetchone()
            pool_bal = int((pool_row["balance_cents"] if pool_row else 0) or 0)
            if pool_bal < SIGNUP_TRIAL_CENTS:
                break
            waiter = conn.execute(
                """
                SELECT w.user_id, w.ip FROM ai_credit_trial_waitlist w
                LEFT JOIN ai_credit_accounts a ON a.user_id = w.user_id
                WHERE a.trial_granted_at IS NULL
                   OR TRIM(COALESCE(a.trial_granted_at, '')) = ''
                ORDER BY w.created_at ASC
                LIMIT 1
                """
            ).fetchone()
            if not waiter:
                break
            ok = _grant_trial_to_user(
                conn,
                user_id=str(waiter["user_id"]),
                ip=str(waiter["ip"] or "").strip() or None,
                from_pool=True,
                amount=SIGNUP_TRIAL_CENTS,
            )
            if not ok:
                break
            funded_users.append(str(waiter["user_id"]))

    return {
        "reclaimed": reclaimed_users,
        "reclaimed_cents": sum(u["amount_cents"] for u in reclaimed_users),
        "funded_user_ids": funded_users,
        "pool_cents": get_trial_pool_cents(),
    }


def _grant_trial_to_user(
    conn,
    *,
    user_id: str,
    ip: str | None,
    from_pool: bool,
    amount: int,
) -> bool:
    """Insert a trial grant inside an open connection. Returns False if skipped."""
    ensure_row = conn.execute("SELECT * FROM ai_credit_accounts WHERE user_id = ?", (user_id,)).fetchone()
    if not ensure_row:
        now0 = _now()
        conn.execute(
            """
            INSERT INTO ai_credit_accounts (
              user_id, balance_cents, auto_refill_enabled, auto_refill_threshold_cents,
              auto_refill_amount_cents, use_platform_key, platform_provider, platform_model,
              created_at, updated_at
            ) VALUES (?, 0, 0, ?, ?, 0, 'openai', '', ?, ?)
            """,
            (user_id, DEFAULT_REFILL_THRESHOLD_CENTS, DEFAULT_REFILL_CENTS, now0, now0),
        )
    else:
        if str(ensure_row["trial_granted_at"] or "").strip():
            _remove_trial_waitlist(conn, user_id)
            return False

    if ip:
        try:
            from backend.services import supabase_security_store as sbsec

            remote_owner = sbsec.ip_owner(ip)
            if remote_owner and remote_owner != str(user_id):
                return False
        except Exception:
            pass
        prior = conn.execute("SELECT user_id FROM ai_credit_trial_ips WHERE ip = ?", (ip,)).fetchone()
        if prior and str(prior["user_id"]) != str(user_id):
            return False

    if from_pool:
        cur = conn.execute(
            """
            UPDATE ai_credit_trial_pool
            SET balance_cents = balance_cents - ?, updated_at = ?
            WHERE id = 1 AND balance_cents >= ?
            """,
            (amount, _now(), amount),
        )
        if cur.rowcount == 0:
            return False

    now = _now()
    cur = conn.execute(
        """
        UPDATE ai_credit_accounts
        SET balance_cents = balance_cents + ?,
            use_platform_key = 1,
            trial_granted_at = ?,
            trial_reclaimed_at = NULL,
            trial_grant_ip = COALESCE(NULLIF(trial_grant_ip, ''), ?),
            updated_at = ?
        WHERE user_id = ?
          AND (trial_granted_at IS NULL OR TRIM(COALESCE(trial_granted_at, '')) = '')
        """,
        (amount, now, ip, now, user_id),
    )
    if cur.rowcount == 0:
        if from_pool:
            conn.execute(
                "UPDATE ai_credit_trial_pool SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = 1",
                (amount, now),
            )
        return False

    if ip:
        try:
            conn.execute(
                "INSERT INTO ai_credit_trial_ips (ip, user_id, granted_at) VALUES (?, ?, ?)",
                (ip, user_id, now),
            )
        except Exception:
            other = conn.execute("SELECT user_id FROM ai_credit_trial_ips WHERE ip = ?", (ip,)).fetchone()
            if other and str(other["user_id"]) != str(user_id):
                conn.execute(
                    """
                    UPDATE ai_credit_accounts
                    SET balance_cents = CASE WHEN balance_cents > ? THEN balance_cents - ? ELSE 0 END,
                        use_platform_key = 0,
                        trial_granted_at = NULL,
                        trial_grant_ip = NULL,
                        updated_at = ?
                    WHERE user_id = ?
                    """,
                    (amount, amount, now, user_id),
                )
                if from_pool:
                    conn.execute(
                        "UPDATE ai_credit_trial_pool SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = 1",
                        (amount, now),
                    )
                return False

    row = conn.execute("SELECT balance_cents FROM ai_credit_accounts WHERE user_id = ?", (user_id,)).fetchone()
    balance = int((row["balance_cents"] if row else 0) or 0)
    meta = {
        "signup_trial": True,
        "key_label": "Render Studio Key",
        "from_pool": bool(from_pool),
        "duration_days": TRIAL_DURATION_DAYS,
        "client_ip": ip,
        "note": (
            "Funded from reclaimed unused free credits."
            if from_pool
            else "Temporary shared Render Studio key credits for OpenAI, Anthropic, and Kimi."
        ),
    }
    conn.execute(
        """
        INSERT INTO ai_credit_transactions (
          id, user_id, kind, amount_cents, balance_after_cents, provider, meta_json, created_at
        ) VALUES (?, ?, 'trial', ?, ?, 'render3d', ?, ?)
        """,
        (str(uuid.uuid4()), user_id, amount, balance, json.dumps(meta), now),
    )
    _remove_trial_waitlist(conn, user_id)
    try:
        from backend.services import supabase_security_store as sbsec

        if ip:
            sbsec.claim_ip(ip, user_id, granted_at=now)
        if from_pool:
            # Local pool already debited; mirror remote pool if it lagged.
            remote = sbsec.get_pool_cents()
            local_row = conn.execute(
                "SELECT balance_cents FROM ai_credit_trial_pool WHERE id = 1"
            ).fetchone()
            local_bal = int((local_row["balance_cents"] if local_row else 0) or 0)
            if remote is not None and remote != local_bal:
                sbsec.add_pool_cents(local_bal - remote)
        sbsec.record_grant(
            user_id=user_id,
            amount_cents=amount,
            from_pool=bool(from_pool),
            client_ip=ip,
            meta=meta,
        )
    except Exception:
        pass
    return True


def _claim_trial_ip_for_user(user_id: str, ip: str, *, granted_at: str | None = None) -> None:
    """Record that this IP already received a free trial (best-effort, race-safe)."""
    ip = str(ip or "").strip()
    if not user_id or not ip:
        return
    now = granted_at or _now()
    try:
        from backend.services import supabase_security_store as sbsec

        sbsec.claim_ip(ip, user_id, granted_at=now)
    except Exception:
        pass
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT user_id FROM ai_credit_trial_ips WHERE ip = ?",
            (ip,),
        ).fetchone()
        if existing:
            return
        try:
            conn.execute(
                "INSERT INTO ai_credit_trial_ips (ip, user_id, granted_at) VALUES (?, ?, ?)",
                (ip, user_id, now),
            )
        except Exception:
            return
        conn.execute(
            """
            UPDATE ai_credit_accounts
            SET trial_grant_ip = COALESCE(NULLIF(trial_grant_ip, ''), ?)
            WHERE user_id = ?
            """,
            (ip, user_id),
        )


def grant_signup_trial_if_needed(
    user: dict[str, Any] | None,
    *,
    client_ip: str | None = None,
) -> dict[str, Any]:
    """One-time $10 Render Studio-key trial (max 10 company-funded grants / rolling week).

    Idle unused balances are reclaimed after a week and redistributed from the pool
    to waitlisted users. Idempotent per user; one trial per client IP.
    """
    empty = {
        "granted": False,
        "just_granted": False,
        "show_popup": False,
        "amount_cents": SIGNUP_TRIAL_CENTS,
        "amount_usd": round(SIGNUP_TRIAL_CENTS / 100, 2),
        "email_sent": False,
        "blocked_ip": False,
        "blocked_weekly_cap": False,
        "duration_days": TRIAL_DURATION_DAYS,
    }
    if not user or not user.get("id"):
        return empty

    # Opportunistic reclaim/redistribute before deciding new grants.
    try:
        reclaim_idle_trial_credits()
    except Exception:
        pass

    try:
        from backend.request_context import get_client_ip
    except Exception:
        get_client_ip = lambda: ""  # noqa: E731
    ip = str(client_ip if client_ip is not None else get_client_ip() or "").strip()

    if not (platform_openai_configured() or platform_anthropic_configured() or platform_kimi_configured()):
        account = ensure_account(user["id"])
        info = _trial_info(account)
        info["just_granted"] = False
        info["blocked_ip"] = False
        info["blocked_weekly_cap"] = False
        return info

    account = ensure_account(user["id"])
    if str(account.get("trial_granted_at") or "").strip():
        if ip:
            _claim_trial_ip_for_user(user["id"], ip, granted_at=str(account.get("trial_granted_at") or "") or None)
        info = _trial_info(account)
        info["just_granted"] = False
        info["blocked_ip"] = False
        info["blocked_weekly_cap"] = False
        return info

    if not ip:
        info = _trial_info(account)
        info["just_granted"] = False
        info["blocked_ip"] = True
        info["blocked_weekly_cap"] = False
        info["show_popup"] = False
        info["blocked_reason"] = (
            "Could not verify your network for the free trial. "
            "Try again from a normal browser connection."
        )
        return info

    amount = SIGNUP_TRIAL_CENTS
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    with get_conn() as conn:
        _ensure_trial_pool(conn)
        # Supabase IP ledger is authoritative when connected.
        try:
            from backend.services import supabase_security_store as sbsec

            remote_owner = sbsec.ip_owner(ip)
            if remote_owner and remote_owner != str(user["id"]):
                info = _trial_info(account)
                info["just_granted"] = False
                info["blocked_ip"] = True
                info["blocked_weekly_cap"] = False
                info["show_popup"] = False
                info["blocked_reason"] = "Free trial credits were already claimed from this network."
                return info
        except Exception:
            pass
        prior = conn.execute(
            "SELECT user_id FROM ai_credit_trial_ips WHERE ip = ?",
            (ip,),
        ).fetchone()
        if prior and str(prior["user_id"]) != str(user["id"]):
            info = _trial_info(account)
            info["just_granted"] = False
            info["blocked_ip"] = True
            info["blocked_weekly_cap"] = False
            info["show_popup"] = False
            info["blocked_reason"] = "Free trial credits were already claimed from this network."
            return info

        company_grants = _company_trial_grants_since(conn, week_ago)
        pool_row = conn.execute("SELECT balance_cents FROM ai_credit_trial_pool WHERE id = 1").fetchone()
        pool_bal = int((pool_row["balance_cents"] if pool_row else 0) or 0)
        from_pool = False
        if company_grants >= TRIAL_GRANTS_PER_WEEK:
            if pool_bal >= amount:
                from_pool = True
            else:
                _enqueue_trial_waitlist(conn, user["id"], ip)
                info = _trial_info(account)
                info["just_granted"] = False
                info["blocked_ip"] = False
                info["blocked_weekly_cap"] = True
                info["waitlisted"] = True
                info["show_popup"] = False
                info["blocked_reason"] = (
                    f"Free trial spots are limited to {TRIAL_GRANTS_PER_WEEK} new users per week. "
                    "You're on the waitlist — unused credits from idle trials may open a spot."
                )
                return info

        ok = _grant_trial_to_user(
            conn,
            user_id=user["id"],
            ip=ip,
            from_pool=from_pool,
            amount=amount,
        )
        if not ok:
            account = ensure_account(user["id"])
            info = _trial_info(account)
            info["just_granted"] = False
            info["blocked_ip"] = False
            info["blocked_weekly_cap"] = False
            return info

    account = ensure_account(user["id"])
    info = _trial_info(account)
    info["just_granted"] = True
    info["blocked_ip"] = False
    info["blocked_weekly_cap"] = False
    info["from_pool"] = from_pool
    return info


def ack_trial_popup(user_id: str) -> dict[str, Any]:
    account = ensure_account(user_id)
    now = _now()
    if not str(account.get("trial_popup_seen_at") or "").strip():
        with get_conn() as conn:
            conn.execute(
                "UPDATE ai_credit_accounts SET trial_popup_seen_at = ?, updated_at = ? WHERE user_id = ?",
                (now, now, user_id),
            )
    return status({"id": user_id})


def mark_trial_email_sent(user_id: str) -> None:
    account = ensure_account(user_id)
    if str(account.get("trial_email_sent_at") or "").strip():
        return
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "UPDATE ai_credit_accounts SET trial_email_sent_at = ?, updated_at = ? WHERE user_id = ?",
            (now, now, user_id),
        )


def status(user: dict[str, Any]) -> dict[str, Any]:
    try:
        reclaim_idle_trial_credits()
    except Exception:
        pass
    account = ensure_account(user["id"])
    balance = int(account.get("balance_cents") or 0)
    # Temporary Render Studio key must not stay selected once credits are gone.
    if balance <= 0 and account.get("use_platform_key"):
        with get_conn() as conn:
            conn.execute(
                "UPDATE ai_credit_accounts SET use_platform_key = 0, updated_at = ? WHERE user_id = ?",
                (_now(), user["id"]),
            )
        account = ensure_account(user["id"])
    last_purchase = _last_purchase(user["id"])
    last_amount = int((last_purchase or {}).get("amount_cents") or 0)
    percent_left = round((balance / last_amount) * 100, 1) if last_amount > 0 else None
    providers = {
        "openai": platform_openai_configured(),
        "anthropic": platform_anthropic_configured(),
        "kimi": platform_kimi_configured(),
    }
    return {
        "available": any(providers.values()),
        "providers": providers,
        "use_platform_key": bool(account.get("use_platform_key")) and balance > 0,
        "platform_provider": str(account.get("platform_provider") or "openai"),
        "platform_model": str(account.get("platform_model") or ""),
        "balance_cents": balance,
        "balance_usd": round(balance / 100, 2),
        "markup_percent": MARKUP_PERCENT,
        "auto_refill_enabled": bool(account.get("auto_refill_enabled")),
        "auto_refill_threshold_cents": int(account.get("auto_refill_threshold_cents") or DEFAULT_REFILL_THRESHOLD_CENTS),
        "auto_refill_amount_cents": int(account.get("auto_refill_amount_cents") or DEFAULT_REFILL_CENTS),
        "last_purchase_cents": last_amount,
        "last_purchase_percent_left": percent_left,
        "models": _platform_models_for_account(account) if balance > 0 else [],
        "stripe_ready": bool(_stripe()),
        "payment_methods": {
            "stripe": bool(_stripe()) or bool(_payment_link_url()),
            "stripe_payment_link": bool(_payment_link_url()) and not bool(_stripe()),
            "paypal": False,
        },
        "trial": _trial_info(account),
        "on_free_trial": is_free_trial_credits_account(account, user_id=user["id"]),
        "key_configured": any(providers.values()),
    }


def _last_purchase(user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT * FROM ai_credit_transactions
            WHERE user_id = ? AND kind IN ('purchase', 'demo_purchase')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def list_transactions(user_id: str, *, limit: int = 40) -> list[dict[str, Any]]:
    ensure_account(user_id)
    lim = max(1, min(100, int(limit or 40)))
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, kind, amount_cents, balance_after_cents, provider, model,
                   project_id, stripe_session_id, meta_json, created_at
            FROM ai_credit_transactions
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, lim),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            item["meta"] = json.loads(item.pop("meta_json") or "{}")
        except Exception:
            item["meta"] = {}
            item.pop("meta_json", None)
        item["amount_usd"] = round(int(item.get("amount_cents") or 0) / 100, 4)
        item["balance_after_usd"] = round(int(item.get("balance_after_cents") or 0) / 100, 2)
        out.append(item)
    return out


def update_settings(
    user_id: str,
    *,
    use_platform_key: bool | None = None,
    auto_refill_enabled: bool | None = None,
    auto_refill_threshold_cents: int | None = None,
    auto_refill_amount_cents: int | None = None,
    platform_provider: str | None = None,
    platform_model: str | None = None,
) -> dict[str, Any]:
    account = ensure_account(user_id)
    sets: list[str] = []
    vals: list[Any] = []
    if use_platform_key is not None:
        if use_platform_key and int(account.get("balance_cents") or 0) <= 0:
            raise ValueError("Buy shared-key credits before enabling the Render Studio Key.")
        sets.append("use_platform_key = ?")
        vals.append(1 if use_platform_key else 0)
    if auto_refill_enabled is not None:
        sets.append("auto_refill_enabled = ?")
        vals.append(1 if auto_refill_enabled else 0)
    if auto_refill_threshold_cents is not None:
        sets.append("auto_refill_threshold_cents = ?")
        vals.append(max(0, int(auto_refill_threshold_cents)))
    if auto_refill_amount_cents is not None:
        sets.append("auto_refill_amount_cents = ?")
        vals.append(max(MIN_CHECKOUT_CENTS, int(auto_refill_amount_cents)))

    provider_out: str | None = None
    model_out: str | None = None
    if platform_provider is not None or platform_model is not None:
        provider = normalize_platform_provider(
            platform_provider
            if platform_provider is not None
            else (account.get("platform_provider") or "openai")
        )
        if provider not in {"openai", "anthropic", "kimi"}:
            raise ValueError("platform_provider must be openai, anthropic, or kimi")
        if provider == "openai" and not platform_openai_configured():
            raise ValueError("Render Studio OpenAI key is not configured yet.")
        if provider == "anthropic" and not platform_anthropic_configured():
            raise ValueError("Render Studio Claude key is not configured yet. Add ANTHROPIC_API_KEY on the server.")
        if provider == "kimi" and not platform_kimi_configured():
            raise ValueError("Render Studio Kimi key is not configured yet. Add KIMI_API_KEY on the server.")
        model = (
            str(platform_model).strip()[:120]
            if platform_model is not None
            else str(account.get("platform_model") or "").strip()[:120]
        )
        if not _platform_model_matches_provider(model, provider):
            # Selecting Anthropic/Kimi must never keep a leftover GPT pin (and vice versa).
            model = _default_platform_model(
                provider,
                speed="quality" if provider in {"anthropic", "kimi"} else "fast",
            )
        provider_out = provider
        model_out = model
        sets.append("platform_provider = ?")
        vals.append(provider_out)
        sets.append("platform_model = ?")
        vals.append(model_out)

    if sets:
        sets.append("updated_at = ?")
        vals.extend([_now(), user_id])
        with get_conn() as conn:
            conn.execute(f"UPDATE ai_credit_accounts SET {', '.join(sets)} WHERE user_id = ?", vals)
    return ensure_account(user_id)


def add_credits(user_id: str, amount_cents: int, *, provider: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    amount = max(0, int(amount_cents or 0))
    account = ensure_account(user_id)
    balance = int(account.get("balance_cents") or 0) + amount
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "UPDATE ai_credit_accounts SET balance_cents = ?, updated_at = ? WHERE user_id = ?",
            (balance, now, user_id),
        )
        conn.execute(
            """
            INSERT INTO ai_credit_transactions (
              id, user_id, kind, amount_cents, balance_after_cents, provider, meta_json, created_at
            ) VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), user_id, amount, balance, provider, json.dumps(meta or {}), now),
        )
    return ensure_account(user_id)


def spend_for_trace(user_id: str, trace: dict[str, Any] | None, *, project_id: str | None = None) -> dict[str, Any] | None:
    if not trace:
        return None
    base_cost = trace.get("cost_usd")
    if base_cost is None:
        return None
    base_cents = max(1, round(float(base_cost) * 100))
    charge_cents = max(1, round(base_cents * (1 + MARKUP_PERCENT / 100)))
    ensure_account(user_id)
    now = _now()
    with get_conn() as conn:
        # Atomic debit — prevents concurrent overspend past the prepaid balance.
        cur = conn.execute(
            """
            UPDATE ai_credit_accounts
            SET balance_cents = balance_cents - ?,
                use_platform_key = CASE
                  WHEN balance_cents - ? <= 0 THEN 0
                  ELSE use_platform_key
                END,
                updated_at = ?
            WHERE user_id = ?
              AND balance_cents >= ?
            """,
            (charge_cents, charge_cents, now, user_id, charge_cents),
        )
        if cur.rowcount == 0:
            raise ValueError("Not enough shared-key credits. Buy more credits to continue.")
        row = conn.execute(
            "SELECT balance_cents FROM ai_credit_accounts WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        new_balance = int((row["balance_cents"] if row else 0) or 0)
        disable_platform = new_balance <= 0
        conn.execute(
            """
            INSERT INTO ai_credit_transactions (
              id, user_id, kind, amount_cents, balance_after_cents, provider, model,
              project_id, meta_json, created_at
            ) VALUES (?, ?, 'usage', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                user_id,
                -charge_cents,
                new_balance,
                str(trace.get("provider") or "openai"),
                str(trace.get("model") or ""),
                project_id,
                json.dumps({"base_cost_usd": base_cost, "markup_percent": MARKUP_PERCENT}),
                now,
            ),
        )
    return {
        "charged_cents": charge_cents,
        "balance_cents": new_balance,
        "markup_percent": MARKUP_PERCENT,
        "platform_key_disabled": bool(disable_platform),
    }


def create_checkout_session(
    user: dict[str, Any],
    *,
    amount_cents: int,
    provider: str,
    success_url: str,
    cancel_url: str,
) -> dict[str, Any]:
    amount = max(MIN_CHECKOUT_CENTS, int(amount_cents or 0))
    provider = str(provider or "stripe").strip().lower()
    if provider == "paypal":
        raise ValueError("PayPal credit checkout is not configured yet. Use Stripe for now.")

    # Prefer live Stripe Checkout Sessions so amount + user metadata are reliable.
    stripe = _stripe()
    if stripe:
        success = success_url
        if "{CHECKOUT_SESSION_ID}" not in success:
            sep = "&" if "?" in success else "?"
            success = f"{success}{sep}session_id={{CHECKOUT_SESSION_ID}}"
        session = stripe.checkout.Session.create(
            mode="payment",
            success_url=success,
            cancel_url=cancel_url,
            customer_email=user.get("email") or None,
            client_reference_id=user["id"],
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": amount,
                        "product_data": {
                            "name": "render credits",
                            "description": "Prepaid credits for Render Studio shared OpenAI & Claude keys",
                        },
                    },
                }
            ],
            metadata={
                "kind": "ai_credits",
                "user_id": user["id"],
                "amount_cents": str(amount),
                "email": user.get("email") or "",
            },
        )
        return {"url": session["url"], "session_id": session["id"], "checkout": True}

    link_url = _payment_link_url()
    if link_url:
        return {
            "url": _with_query(
                link_url,
                {
                    "client_reference_id": user["id"],
                    "prefilled_email": user.get("email") or None,
                    "amount_cents": amount,
                },
            ),
            "payment_link": True,
        }

    raise ValueError(
        "Stripe checkout is not configured. Credits cannot be added without payment."
    )


def handle_success_session(session_id: str) -> bool:
    if not session_id:
        return False
    stripe = _stripe()
    if not stripe:
        return False
    session = _stripe_as_dict(stripe.checkout.Session.retrieve(session_id))
    meta = _stripe_as_dict(session.get("metadata"))
    if meta.get("kind") != "ai_credits" or session.get("payment_status") != "paid":
        return False
    user_id = meta.get("user_id") or session.get("client_reference_id")
    amount = int(meta.get("amount_cents") or session.get("amount_total") or 0)
    if not user_id or amount <= 0:
        return False
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM ai_credit_transactions WHERE stripe_session_id = ? LIMIT 1",
            (session_id,),
        ).fetchone()
    if existing:
        return True
    account = ensure_account(user_id)
    balance = int(account.get("balance_cents") or 0) + amount
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "UPDATE ai_credit_accounts SET balance_cents = ?, use_platform_key = 1, updated_at = ? WHERE user_id = ?",
            (balance, now, user_id),
        )
        conn.execute(
            """
            INSERT INTO ai_credit_transactions (
              id, user_id, kind, amount_cents, balance_after_cents, provider,
              stripe_session_id, meta_json, created_at
            ) VALUES (?, ?, 'purchase', ?, ?, 'stripe', ?, ?, ?)
            """,
            (str(uuid.uuid4()), user_id, amount, balance, session_id, json.dumps({"stripe": True}), now),
        )
    return True


def claim_checkout_session(user: dict[str, Any], session_id: str) -> dict[str, Any]:
    """Apply a paid Stripe session to this user (webhook backup on return)."""
    sid = str(session_id or "").strip()
    if not sid:
        raise ValueError("session_id is required")
    stripe = _stripe()
    if not stripe:
        raise ValueError("Stripe is not configured")
    session = _stripe_as_dict(stripe.checkout.Session.retrieve(sid))
    meta = _stripe_as_dict(session.get("metadata"))
    owner = str(meta.get("user_id") or session.get("client_reference_id") or "").strip()
    if owner and owner != user["id"]:
        raise ValueError("This checkout session belongs to another account.")
    if meta.get("kind") != "ai_credits":
        # Still try payment-link style claim for this user
        if not handle_payment_link_session(session):
            raise ValueError("Checkout session is not an AI credits purchase.")
    elif not handle_success_session(sid):
        if session.get("payment_status") != "paid":
            raise ValueError("Payment is not complete yet.")
        raise ValueError("Could not apply credits for this session.")
    return status(user)

def handle_payment_link_session(session: dict[str, Any]) -> bool:
    """Credit AI balance for a completed Stripe Payment Link checkout."""
    session = _stripe_as_dict(session)
    if not session:
        return False
    session_id = str(session.get("id") or "").strip()
    if not session_id or session.get("payment_status") != "paid":
        return False
    metadata = _stripe_as_dict(session.get("metadata"))
    if metadata.get("kind"):
        return False

    configured_link_id = _payment_link_id()
    session_link_id = str(session.get("payment_link") or "").strip()
    if configured_link_id and session_link_id != configured_link_id:
        return False
    if not configured_link_id and not (_payment_link_url() and session_link_id):
        return False

    amount = int(session.get("amount_total") or 0)
    currency = str(session.get("currency") or "usd").lower()
    if currency != "usd" or amount < MIN_CHECKOUT_CENTS or amount > MAX_PAYMENT_LINK_CENTS:
        return False

    user = _user_for_checkout_session(session)
    if not user:
        return False

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM ai_credit_transactions WHERE stripe_session_id = ? LIMIT 1",
            (session_id,),
        ).fetchone()
    if existing:
        return True

    account = ensure_account(user["id"])
    balance = int(account.get("balance_cents") or 0) + amount
    now = _now()
    customer_details = _stripe_as_dict(session.get("customer_details"))
    meta = {
        "stripe": True,
        "payment_link": session_link_id,
        "checkout_email": customer_details.get("email") or session.get("customer_email"),
    }
    with get_conn() as conn:
        conn.execute(
            "UPDATE ai_credit_accounts SET balance_cents = ?, use_platform_key = 1, updated_at = ? WHERE user_id = ?",
            (balance, now, user["id"]),
        )
        conn.execute(
            """
            INSERT INTO ai_credit_transactions (
              id, user_id, kind, amount_cents, balance_after_cents, provider,
              stripe_session_id, meta_json, created_at
            ) VALUES (?, ?, 'purchase', ?, ?, 'stripe_payment_link', ?, ?, ?)
            """,
            (str(uuid.uuid4()), user["id"], amount, balance, session_id, json.dumps(meta), now),
        )
    return True


def demo_add(user: dict[str, Any], amount_cents: int) -> dict[str, Any]:
    """Admin-only test top-up. Never expose to regular users."""
    amount = max(MIN_CHECKOUT_CENTS, min(MAX_PAYMENT_LINK_CENTS, int(amount_cents or 0)))
    add_credits(user["id"], amount, provider="demo", meta={"token": secrets.token_hex(4), "admin_demo": True})
    update_settings(user["id"], use_platform_key=True)
    return status(user)
