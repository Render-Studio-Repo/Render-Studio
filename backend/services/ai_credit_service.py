"""Prepaid credits for users borrowing the platform AI key."""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.config import settings
from backend.database import get_conn

MARKUP_PERCENT = 15
MIN_CHECKOUT_CENTS = 500
DEFAULT_REFILL_CENTS = 2000
DEFAULT_REFILL_THRESHOLD_CENTS = 500


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


def platform_models() -> list[dict[str, str]]:
    models = [
        settings.openai_model,
        settings.openai_model_quality,
        "gpt-5.5",
        "gpt-5.5-pro",
        "gpt-5.3-codex",
        "gpt-5.6-sol",
    ]
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for model in models:
        name = str(model or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({"provider": "openai", "model": name})
    return out


def ensure_account(user_id: str) -> dict[str, Any]:
    now = _now()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM ai_credit_accounts WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            conn.execute(
                """
                INSERT INTO ai_credit_accounts (
                  user_id, balance_cents, auto_refill_enabled, auto_refill_threshold_cents,
                  auto_refill_amount_cents, use_platform_key, created_at, updated_at
                ) VALUES (?, 0, 0, ?, ?, 0, ?, ?)
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
    return {
        "available": bool((settings.openai_api_key or "").strip()),
        "use_platform_key": bool(account.get("use_platform_key")),
        "balance_cents": balance,
        "balance_usd": round(balance / 100, 2),
        "markup_percent": MARKUP_PERCENT,
        "auto_refill_enabled": bool(account.get("auto_refill_enabled")),
        "auto_refill_threshold_cents": int(account.get("auto_refill_threshold_cents") or DEFAULT_REFILL_THRESHOLD_CENTS),
        "auto_refill_amount_cents": int(account.get("auto_refill_amount_cents") or DEFAULT_REFILL_CENTS),
        "last_purchase_cents": last_amount,
        "last_purchase_percent_left": percent_left,
        "models": platform_models(),
        "payment_methods": {"stripe": True, "paypal": False},
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


def update_settings(
    user_id: str,
    *,
    use_platform_key: bool | None = None,
    auto_refill_enabled: bool | None = None,
    auto_refill_threshold_cents: int | None = None,
    auto_refill_amount_cents: int | None = None,
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
    stripe = _stripe()
    if not stripe:
        add_credits(user["id"], amount, provider="demo", meta={"demo": True})
        return {"demo": True, "url": success_url, "credits": status(user)}
    session = stripe.checkout.Session.create(
        mode="payment",
        success_url=success_url,
        cancel_url=cancel_url,
        customer_email=user.get("email") or None,
        line_items=[
            {
                "quantity": 1,
                "price_data": {
                    "currency": "usd",
                    "unit_amount": amount,
                    "product_data": {"name": "Render3D shared AI credits"},
                },
            }
        ],
        metadata={"kind": "ai_credits", "user_id": user["id"], "amount_cents": str(amount)},
    )
    return {"url": session["url"], "session_id": session["id"]}


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
    user_id = meta.get("user_id")
    amount = int(meta.get("amount_cents") or 0)
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
        conn.execute("UPDATE ai_credit_accounts SET balance_cents = ?, updated_at = ? WHERE user_id = ?", (balance, now, user_id))
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


def demo_add(user: dict[str, Any], amount_cents: int) -> dict[str, Any]:
    add_credits(user["id"], max(MIN_CHECKOUT_CENTS, int(amount_cents or 0)), provider="demo", meta={"token": secrets.token_hex(4)})
    update_settings(user["id"], use_platform_key=True)
    return status(user)
