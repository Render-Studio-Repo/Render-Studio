"""Prepaid credits for users borrowing Render3D platform AI keys (OpenAI + Claude)."""

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
    metadata = session.get("metadata") or {}
    user_id = str(session.get("client_reference_id") or metadata.get("user_id") or "").strip()
    email = (
        (session.get("customer_details") or {}).get("email")
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
                ("anthropic", "claude-fable-5"),
                ("anthropic", "claude-sonnet-4-5"),
                ("anthropic", "claude-opus-4-8"),
                ("anthropic", "claude-4.6-sonnet"),
                ("anthropic", "claude-4.6-opus"),
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


def resolve_platform_credentials(
    account: dict[str, Any] | None,
    *,
    speed: str = "fast",
) -> dict[str, str] | None:
    """Pick Render3D platform OpenAI/Claude credentials for a credit account."""
    preferred = str((account or {}).get("platform_provider") or "openai").strip().lower()
    pinned = str((account or {}).get("platform_model") or "").strip()
    openai_ok = platform_openai_configured()
    anthropic_ok = platform_anthropic_configured()
    if preferred == "anthropic" and not anthropic_ok and openai_ok:
        preferred = "openai"
    elif preferred != "anthropic" and not openai_ok and anthropic_ok:
        preferred = "anthropic"
    if preferred == "anthropic" and anthropic_ok:
        if pinned and not pinned.startswith("gpt"):
            model = pinned
        elif speed == "fast":
            model = settings.anthropic_model
        else:
            model = getattr(settings, "anthropic_model_quality", None) or "claude-opus-4-8"
        return {
            "provider": "anthropic",
            "model": model,
            "api_key": settings.anthropic_api_key.strip(),
            "shared_key_name": "Render3D Claude",
        }
    if openai_ok:
        if pinned and pinned.startswith("gpt"):
            model = pinned if speed != "fast" else settings.openai_model
        elif speed == "fast":
            model = settings.openai_model
        else:
            model = settings.openai_model_quality
        return {
            "provider": "openai",
            "model": model,
            "api_key": settings.openai_api_key.strip(),
            "shared_key_name": "Render3D OpenAI",
        }
    return None


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


def status(user: dict[str, Any]) -> dict[str, Any]:
    account = ensure_account(user["id"])
    balance = int(account.get("balance_cents") or 0)
    last_purchase = _last_purchase(user["id"])
    last_amount = int((last_purchase or {}).get("amount_cents") or 0)
    percent_left = round((balance / last_amount) * 100, 1) if last_amount > 0 else None
    providers = {
        "openai": platform_openai_configured(),
        "anthropic": platform_anthropic_configured(),
    }
    return {
        "available": any(providers.values()),
        "providers": providers,
        "use_platform_key": bool(account.get("use_platform_key")),
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
        "models": platform_models(),
        "stripe_ready": bool(_stripe()),
        "payment_methods": {
            "stripe": bool(_stripe()) or bool(_payment_link_url()),
            "stripe_payment_link": bool(_payment_link_url()) and not bool(_stripe()),
            "paypal": False,
        },
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
    ensure_account(user_id)
    sets: list[str] = []
    vals: list[Any] = []
    if use_platform_key is not None:
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
    if platform_provider is not None:
        provider = str(platform_provider or "openai").strip().lower()
        if provider not in {"openai", "anthropic"}:
            raise ValueError("platform_provider must be openai or anthropic")
        if provider == "openai" and not platform_openai_configured():
            raise ValueError("Render3D OpenAI key is not configured yet.")
        if provider == "anthropic" and not platform_anthropic_configured():
            raise ValueError("Render3D Claude key is not configured yet. Add ANTHROPIC_API_KEY on the server.")
        sets.append("platform_provider = ?")
        vals.append(provider)
    if platform_model is not None:
        sets.append("platform_model = ?")
        vals.append(str(platform_model or "").strip()[:120])
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
    account = ensure_account(user_id)
    balance = int(account.get("balance_cents") or 0)
    if balance < charge_cents:
        raise ValueError("Not enough shared-key credits. Buy more credits to continue.")
    new_balance = balance - charge_cents
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "UPDATE ai_credit_accounts SET balance_cents = ?, updated_at = ? WHERE user_id = ?",
            (new_balance, now, user_id),
        )
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
    return {"charged_cents": charge_cents, "balance_cents": new_balance, "markup_percent": MARKUP_PERCENT}


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
                            "name": "Render3D AI credits",
                            "description": "Prepaid credits for Render3D shared OpenAI & Claude keys",
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

    add_credits(user["id"], amount, provider="demo", meta={"demo": True})
    update_settings(user["id"], use_platform_key=True)
    return {"demo": True, "url": success_url, "credits": status(user)}


def handle_success_session(session_id: str) -> bool:
    if not session_id:
        return False
    stripe = _stripe()
    if not stripe:
        return False
    session = stripe.checkout.Session.retrieve(session_id)
    meta = session.get("metadata") or {}
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
    session = stripe.checkout.Session.retrieve(sid)
    meta = session.get("metadata") or {}
    owner = str(meta.get("user_id") or session.get("client_reference_id") or "").strip()
    if owner and owner != user["id"]:
        raise ValueError("This checkout session belongs to another account.")
    if meta.get("kind") != "ai_credits":
        # Still try payment-link style claim for this user
        if not handle_payment_link_session(dict(session)):
            raise ValueError("Checkout session is not an AI credits purchase.")
    elif not handle_success_session(sid):
        if session.get("payment_status") != "paid":
            raise ValueError("Payment is not complete yet.")
        raise ValueError("Could not apply credits for this session.")
    return status(user)


def handle_payment_link_session(session: dict[str, Any]) -> bool:
    """Credit AI balance for a completed Stripe Payment Link checkout."""
    if not isinstance(session, dict):
        return False
    session_id = str(session.get("id") or "").strip()
    if not session_id or session.get("payment_status") != "paid":
        return False
    metadata = session.get("metadata") or {}
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
    meta = {
        "stripe": True,
        "payment_link": session_link_id,
        "checkout_email": (session.get("customer_details") or {}).get("email") or session.get("customer_email"),
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
    add_credits(user["id"], max(MIN_CHECKOUT_CENTS, int(amount_cents or 0)), provider="demo", meta={"token": secrets.token_hex(4)})
    update_settings(user["id"], use_platform_key=True)
    return status(user)
