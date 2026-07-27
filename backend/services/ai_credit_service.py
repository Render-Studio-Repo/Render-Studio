"""Prepaid credits for users borrowing Render Studio platform AI keys (OpenAI + Claude + Kimi)."""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timezone
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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    balance = int(account.get("balance_cents") or 0)
    return {
        "granted": bool(granted_at),
        "granted_at": granted_at,
        "amount_cents": SIGNUP_TRIAL_CENTS,
        "amount_usd": round(SIGNUP_TRIAL_CENTS / 100, 2),
        "popup_seen": bool(popup_seen_at),
        "show_popup": bool(granted_at and not popup_seen_at),
        "email_sent": bool(email_sent_at),
        "active": bool(granted_at and balance > 0 and account.get("use_platform_key")),
        "key_label": "Render Studio Key",
    }


def _claim_trial_ip_for_user(user_id: str, ip: str, *, granted_at: str | None = None) -> None:
    """Record that this IP already received a free trial (best-effort, race-safe)."""
    ip = str(ip or "").strip()
    if not user_id or not ip:
        return
    now = granted_at or _now()
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
    """One-time $10 Render Studio-key trial for every user (new or returning).

    Idempotent. Enables the temporary Render Studio Key (OpenAI / Anthropic / Kimi)
    until the balance is spent; the key option disappears at $0.

    Only one free trial is allowed per client IP — additional accounts from the
    same IP do not receive credits.
    """
    empty = {
        "granted": False,
        "just_granted": False,
        "show_popup": False,
        "amount_cents": SIGNUP_TRIAL_CENTS,
        "amount_usd": round(SIGNUP_TRIAL_CENTS / 100, 2),
        "email_sent": False,
        "blocked_ip": False,
    }
    if not user or not user.get("id"):
        return empty

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
        return info

    account = ensure_account(user["id"])
    if str(account.get("trial_granted_at") or "").strip():
        # Existing trial holders claim their current IP so later signups from it are blocked.
        if ip:
            _claim_trial_ip_for_user(user["id"], ip, granted_at=str(account.get("trial_granted_at") or "") or None)
        info = _trial_info(account)
        info["just_granted"] = False
        info["blocked_ip"] = False
        return info

    # No usable client IP → refuse grant (blocks unlimited trials when IP is blank).
    if not ip:
        info = _trial_info(account)
        info["just_granted"] = False
        info["blocked_ip"] = True
        info["blocked_reason"] = (
            "Could not verify your network for the free trial. "
            "Try again from a normal browser connection."
        )
        return info

    amount = SIGNUP_TRIAL_CENTS
    now = _now()
    meta = {
        "signup_trial": True,
        "key_label": "Render Studio Key",
        "note": "Temporary shared Render Studio key credits for OpenAI, Anthropic, and Kimi.",
        "client_ip": ip,
    }
    with get_conn() as conn:
        prior = conn.execute(
            "SELECT user_id FROM ai_credit_trial_ips WHERE ip = ?",
            (ip,),
        ).fetchone()
        if prior and str(prior["user_id"]) != str(user["id"]):
            info = _trial_info(account)
            info["just_granted"] = False
            info["blocked_ip"] = True
            info["blocked_reason"] = "Free trial credits were already claimed from this network."
            return info

        cur = conn.execute(
            """
            UPDATE ai_credit_accounts
            SET balance_cents = balance_cents + ?,
                use_platform_key = 1,
                trial_granted_at = ?,
                trial_grant_ip = COALESCE(NULLIF(trial_grant_ip, ''), ?),
                updated_at = ?
            WHERE user_id = ?
              AND (trial_granted_at IS NULL OR TRIM(COALESCE(trial_granted_at, '')) = '')
            """,
            (amount, now, ip, now, user["id"]),
        )
        if cur.rowcount == 0:
            account = dict(
                conn.execute("SELECT * FROM ai_credit_accounts WHERE user_id = ?", (user["id"],)).fetchone() or {}
            )
            info = _trial_info(account)
            info["just_granted"] = False
            info["blocked_ip"] = False
            return info

        # Claim the IP atomically; if another signup won the race, roll back this grant.
        try:
            conn.execute(
                """
                INSERT INTO ai_credit_trial_ips (ip, user_id, granted_at)
                VALUES (?, ?, ?)
                """,
                (ip, user["id"], now),
            )
        except Exception:
            other = conn.execute(
                "SELECT user_id FROM ai_credit_trial_ips WHERE ip = ?",
                (ip,),
            ).fetchone()
            if other and str(other["user_id"]) != str(user["id"]):
                conn.execute(
                    """
                    UPDATE ai_credit_accounts
                    SET balance_cents = CASE
                          WHEN balance_cents > ? THEN balance_cents - ?
                          ELSE 0
                        END,
                        use_platform_key = 0,
                        trial_granted_at = NULL,
                        trial_grant_ip = NULL,
                        updated_at = ?
                    WHERE user_id = ?
                    """,
                    (amount, amount, now, user["id"]),
                )
                info = _trial_info(ensure_account(user["id"]))
                info["just_granted"] = False
                info["blocked_ip"] = True
                info["blocked_reason"] = "Free trial credits were already claimed from this network."
                return info

        row = conn.execute("SELECT balance_cents FROM ai_credit_accounts WHERE user_id = ?", (user["id"],)).fetchone()
        balance = int((row["balance_cents"] if row else 0) or 0)
        conn.execute(
            """
            INSERT INTO ai_credit_transactions (
              id, user_id, kind, amount_cents, balance_after_cents, provider, meta_json, created_at
            ) VALUES (?, ?, 'trial', ?, ?, 'render3d', ?, ?)
            """,
            (str(uuid.uuid4()), user["id"], amount, balance, json.dumps(meta), now),
        )
    account = ensure_account(user["id"])
    info = _trial_info(account)
    info["just_granted"] = True
    info["blocked_ip"] = False
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
        "models": platform_models() if balance > 0 else [],
        "stripe_ready": bool(_stripe()),
        "payment_methods": {
            "stripe": bool(_stripe()) or bool(_payment_link_url()),
            "stripe_payment_link": bool(_payment_link_url()) and not bool(_stripe()),
            "paypal": False,
        },
        "trial": _trial_info(account),
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
