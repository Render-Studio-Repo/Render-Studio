"""Marketplace payments — Stripe Connect (bank) + Link checkout, 10% platform fee."""

from __future__ import annotations

import logging
import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.marketplace_payments")

PLATFORM_FEE_BPS = 1000  # 10.00%
PLATFORM_FEE_PERCENT = 10
MIN_PRICE_CENTS = 100  # $1.00

VALID_KINDS = {"agent", "model", "knowledge"}
VALID_PAYOUT_METHODS = {"stripe", "paypal", "phantom", "cash_app", "venmo", "apple_pay"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stripe():
    key = (getattr(settings, "stripe_secret_key", None) or "").strip()
    if not key:
        return None
    try:
        import stripe
    except ImportError:
        logger.warning("stripe package not installed")
        return None
    stripe.api_key = key
    return stripe


def configured() -> bool:
    return bool((getattr(settings, "stripe_secret_key", None) or "").strip())


def public_config() -> dict[str, Any]:
    return {
        "configured": configured(),
        "publishable_key": (getattr(settings, "stripe_publishable_key", None) or "").strip(),
        "platform_fee_percent": PLATFORM_FEE_PERCENT,
        "platform_fee_bps": PLATFORM_FEE_BPS,
        "min_price_cents": MIN_PRICE_CENTS,
        "supports_link": True,
        "supports_bank_payouts": True,
        "supports_paypal": True,
        "supports_crypto_wallet": True,
        "supports_cash_app": True,
        "supports_venmo": True,
        "supports_apple_pay": True,
    }


def platform_fee_cents(price_cents: int) -> int:
    price = max(0, int(price_cents or 0))
    return max(0, (price * PLATFORM_FEE_BPS + 5000) // 10000)


def seller_net_cents(price_cents: int) -> int:
    return max(0, int(price_cents or 0) - platform_fee_cents(price_cents))


def get_seller_account(user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM marketplace_seller_accounts WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def upsert_seller_account(user_id: str, **fields: Any) -> dict[str, Any]:
    existing = get_seller_account(user_id)
    now = _now()
    if not existing:
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO marketplace_seller_accounts (
                  user_id, stripe_account_id, charges_enabled, payouts_enabled,
                  details_submitted, paypal_email, payout_method, payout_details_json, created_at, updated_at
                ) VALUES (?, ?, 0, 0, 0, '', 'stripe', '{}', ?, ?)
                """,
                (user_id, fields.get("stripe_account_id") or None, now, now),
            )
        existing = get_seller_account(user_id) or {"user_id": user_id}

    sets: list[str] = []
    vals: list[Any] = []
    for key in (
        "stripe_account_id",
        "charges_enabled",
        "payouts_enabled",
        "details_submitted",
        "paypal_email",
        "payout_method",
        "payout_details_json",
    ):
        if key in fields and fields[key] is not None:
            sets.append(f"{key} = ?")
            vals.append(fields[key])
    if sets:
        sets.append("updated_at = ?")
        vals.append(now)
        vals.append(user_id)
        with get_conn() as conn:
            conn.execute(
                f"UPDATE marketplace_seller_accounts SET {', '.join(sets)} WHERE user_id = ?",
                vals,
            )
    return get_seller_account(user_id) or existing


def seller_status(user: dict[str, Any]) -> dict[str, Any]:
    account = get_seller_account(user["id"]) or {}
    stripe_ready = bool(account.get("charges_enabled") and account.get("payouts_enabled"))
    paypal = str(account.get("paypal_email") or "").strip()
    try:
        payout_details = json.loads(account.get("payout_details_json") or "{}")
    except Exception:
        payout_details = {}
    return {
        **public_config(),
        "user_id": user["id"],
        "stripe_account_id": account.get("stripe_account_id"),
        "charges_enabled": bool(account.get("charges_enabled")),
        "payouts_enabled": bool(account.get("payouts_enabled")),
        "details_submitted": bool(account.get("details_submitted")),
        "paypal_email": paypal,
        "payout_details": payout_details if isinstance(payout_details, dict) else {},
        "payout_method": account.get("payout_method") or ("paypal" if paypal and not stripe_ready else "stripe"),
        "can_sell_paid": bool(stripe_ready or paypal or payout_details),
        "stripe_ready": stripe_ready,
    }


def create_connect_onboarding_link(
    user: dict[str, Any],
    *,
    return_url: str,
    refresh_url: str,
) -> dict[str, Any]:
    stripe = _stripe()
    if not stripe:
        # Demo/local path so UI works without keys: mark seller as connected.
        upsert_seller_account(
            user["id"],
            stripe_account_id=f"acct_demo_{user['id'][:8]}",
            charges_enabled=1,
            payouts_enabled=1,
            details_submitted=1,
            payout_method="stripe",
        )
        return {
            "url": return_url,
            "demo": True,
            "message": "Stripe keys not configured — demo seller account enabled for local testing.",
            "seller": seller_status(user),
        }

    account = get_seller_account(user["id"])
    acct_id = account.get("stripe_account_id") if account else None
    if not acct_id or str(acct_id).startswith("acct_demo_"):
        created = stripe.Account.create(
            type="express",
            email=user.get("email") or None,
            capabilities={
                "card_payments": {"requested": True},
                "transfers": {"requested": True},
            },
            business_type="individual",
            metadata={"render3d_user_id": user["id"]},
        )
        acct_id = created["id"]
        upsert_seller_account(user["id"], stripe_account_id=acct_id, payout_method="stripe")

    link = stripe.AccountLink.create(
        account=acct_id,
        refresh_url=refresh_url,
        return_url=return_url,
        type="account_onboarding",
    )
    return {"url": link["url"], "account_id": acct_id, "seller": seller_status(user)}


def refresh_connect_status(user: dict[str, Any]) -> dict[str, Any]:
    account = get_seller_account(user["id"])
    if not account or not account.get("stripe_account_id"):
        return seller_status(user)
    acct_id = account["stripe_account_id"]
    if str(acct_id).startswith("acct_demo_"):
        return seller_status(user)
    stripe = _stripe()
    if not stripe:
        return seller_status(user)
    try:
        remote = stripe.Account.retrieve(acct_id)
        if hasattr(remote, "to_dict_recursive"):
            remote = remote.to_dict_recursive()
        elif hasattr(remote, "to_dict"):
            remote = remote.to_dict()
        if not isinstance(remote, dict):
            remote = {
                "charges_enabled": remote["charges_enabled"],
                "payouts_enabled": remote["payouts_enabled"],
                "details_submitted": remote["details_submitted"],
            }
        upsert_seller_account(
            user["id"],
            charges_enabled=1 if remote.get("charges_enabled") else 0,
            payouts_enabled=1 if remote.get("payouts_enabled") else 0,
            details_submitted=1 if remote.get("details_submitted") else 0,
        )
    except Exception as exc:
        logger.warning("Stripe account refresh failed: %s", exc)
    return seller_status(user)


def set_paypal_email(user: dict[str, Any], email: str) -> dict[str, Any]:
    email = str(email or "").strip().lower()
    if email and ("@" not in email or "." not in email.split("@")[-1]):
        raise ValueError("Enter a valid PayPal email.")
    upsert_seller_account(
        user["id"],
        paypal_email=email,
        payout_method="paypal" if email else (get_seller_account(user["id"]) or {}).get("payout_method") or "stripe",
    )
    return seller_status(user)


def set_payout_preference(user: dict[str, Any], method: str, details: dict[str, Any]) -> dict[str, Any]:
    method = str(method or "").strip().lower().replace("-", "_")
    if method not in VALID_PAYOUT_METHODS:
        raise ValueError("Unsupported payout method.")
    clean: dict[str, Any] = {}
    if isinstance(details, dict):
        for key, value in details.items():
            safe_key = str(key or "").strip().lower().replace("-", "_")[:40]
            if not safe_key:
                continue
            clean[safe_key] = str(value or "").strip()[:240]
    account = get_seller_account(user["id"]) or {}
    try:
        existing = json.loads(account.get("payout_details_json") or "{}")
    except Exception:
        existing = {}
    if not isinstance(existing, dict):
        existing = {}
    if method == "paypal":
        email = clean.get("email") or ""
        if email:
            return set_paypal_email(user, email)
    existing[method] = clean
    upsert_seller_account(
        user["id"],
        payout_method=method,
        payout_details_json=json.dumps(existing, separators=(",", ":")),
    )
    return seller_status(user)


def user_owns_listing(user_id: str, kind: str, listing: dict[str, Any]) -> bool:
    owner = listing.get("created_by") or (listing.get("owner") or {}).get("id")
    return bool(owner and owner == user_id)


def has_entitlement(user_id: str, kind: str, listing_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM marketplace_purchases
            WHERE buyer_user_id = ? AND kind = ? AND listing_id = ? AND status = 'paid'
            LIMIT 1
            """,
            (user_id, kind, listing_id),
        ).fetchone()
    return bool(row)


def record_purchase(
    *,
    buyer_user_id: str,
    seller_user_id: str,
    kind: str,
    listing_id: str,
    listing_slug: str,
    price_cents: int,
    currency: str,
    stripe_session_id: str | None = None,
    stripe_payment_intent: str | None = None,
    status: str = "paid",
) -> dict[str, Any]:
    fee = platform_fee_cents(price_cents)
    purchase_id = str(uuid.uuid4())
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_purchases (
              id, kind, listing_id, listing_slug, buyer_user_id, seller_user_id,
              price_cents, platform_fee_cents, seller_net_cents, currency,
              stripe_session_id, stripe_payment_intent, status, created_at, paid_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                purchase_id,
                kind,
                listing_id,
                listing_slug,
                buyer_user_id,
                seller_user_id,
                int(price_cents),
                fee,
                int(price_cents) - fee,
                (currency or "USD").upper(),
                stripe_session_id,
                stripe_payment_intent,
                status,
                now,
                now if status == "paid" else None,
            ),
        )
    return {
        "id": purchase_id,
        "kind": kind,
        "listing_id": listing_id,
        "price_cents": price_cents,
        "platform_fee_cents": fee,
        "seller_net_cents": int(price_cents) - fee,
        "status": status,
    }


def create_checkout_session(
    *,
    buyer: dict[str, Any],
    kind: str,
    listing: dict[str, Any],
    success_url: str,
    cancel_url: str,
) -> dict[str, Any]:
    if kind not in VALID_KINDS:
        raise ValueError("Invalid listing kind.")
    price = int(listing.get("price_cents") or 0)
    access = str(listing.get("access_mode") or "free")
    if access != "paid" and price <= 0:
        raise ValueError("This listing is not paid.")
    if price < MIN_PRICE_CENTS:
        raise ValueError(f"Minimum paid price is {MIN_PRICE_CENTS} cents.")

    seller_id = listing.get("created_by") or (listing.get("owner") or {}).get("id")
    if not seller_id:
        raise ValueError("Listing has no seller.")
    if seller_id == buyer["id"]:
        raise ValueError("You already own this listing.")
    if has_entitlement(buyer["id"], kind, listing["id"]):
        return {"already_owned": True, "listing_id": listing["id"]}

    seller = get_seller_account(seller_id) or {}
    fee = platform_fee_cents(price)
    currency = (listing.get("currency") or "USD").lower()

    stripe = _stripe()
    destination = seller.get("stripe_account_id")
    can_transfer = bool(
        destination
        and not str(destination).startswith("acct_demo_")
        and seller.get("charges_enabled")
    )

    if not stripe:
        # Local/demo: grant entitlement immediately.
        purchase = record_purchase(
            buyer_user_id=buyer["id"],
            seller_user_id=seller_id,
            kind=kind,
            listing_id=listing["id"],
            listing_slug=str(listing.get("slug") or ""),
            price_cents=price,
            currency=currency.upper(),
            stripe_session_id=f"demo_{secrets.token_hex(8)}",
            status="paid",
        )
        return {
            "demo": True,
            "url": success_url,
            "purchase": purchase,
            "message": "Stripe not configured — demo purchase recorded and access granted.",
        }

    metadata = {
        "kind": kind,
        "listing_id": listing["id"],
        "listing_slug": str(listing.get("slug") or ""),
        "buyer_user_id": buyer["id"],
        "seller_user_id": seller_id,
        "platform_fee_cents": str(fee),
    }

    params: dict[str, Any] = {
        "mode": "payment",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "customer_email": buyer.get("email") or None,
        "line_items": [
            {
                "quantity": 1,
                "price_data": {
                    "currency": currency,
                    "unit_amount": price,
                    "product_data": {
                        "name": str(listing.get("name") or "Render Studio product")[:120],
                        "description": str(listing.get("tagline") or "")[:400] or None,
                    },
                },
            }
        ],
        "payment_method_types": ["card", "link"],
        "metadata": metadata,
        "payment_intent_data": {"metadata": metadata},
    }
    if can_transfer:
        params["payment_intent_data"] = {
            **params["payment_intent_data"],
            "application_fee_amount": fee,
            "transfer_data": {"destination": destination},
        }

    session = stripe.checkout.Session.create(**params)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_purchases (
              id, kind, listing_id, listing_slug, buyer_user_id, seller_user_id,
              price_cents, platform_fee_cents, seller_net_cents, currency,
              stripe_session_id, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                str(uuid.uuid4()),
                kind,
                listing["id"],
                str(listing.get("slug") or ""),
                buyer["id"],
                seller_id,
                price,
                fee,
                price - fee,
                currency.upper(),
                session["id"],
                _now(),
            ),
        )
    return {"url": session["url"], "session_id": session["id"], "platform_fee_cents": fee}


def mark_session_paid(session_id: str, payment_intent: str | None = None) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM marketplace_purchases WHERE stripe_session_id = ?",
            (session_id,),
        ).fetchone()
        if not row:
            return None
        if row["status"] == "paid":
            return dict(row)
        conn.execute(
            """
            UPDATE marketplace_purchases
            SET status = 'paid', paid_at = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent)
            WHERE stripe_session_id = ?
            """,
            (_now(), payment_intent, session_id),
        )
        row = conn.execute(
            "SELECT * FROM marketplace_purchases WHERE stripe_session_id = ?",
            (session_id,),
        ).fetchone()
    return dict(row) if row else None


def handle_stripe_webhook(payload: bytes, sig_header: str | None) -> dict[str, Any]:
    stripe = _stripe()
    if not stripe:
        raise RuntimeError("Stripe not configured")
    secret = (getattr(settings, "stripe_webhook_secret", None) or "").strip()
    if secret:
        event = stripe.Webhook.construct_event(payload, sig_header, secret)
    else:
        import json

        event = json.loads(payload.decode("utf-8"))

    # Newer Stripe SDK objects do not support ``.get`` — normalize to dicts.
    if hasattr(event, "to_dict_recursive"):
        event = event.to_dict_recursive()
    elif hasattr(event, "to_dict"):
        event = event.to_dict()
    if not isinstance(event, dict):
        event = {"type": event["type"], "data": {"object": event["data"]["object"]}}

    etype = event.get("type")
    data = ((event.get("data") or {}).get("object")) or {}
    if not isinstance(data, dict) and hasattr(data, "to_dict_recursive"):
        data = data.to_dict_recursive()
    elif not isinstance(data, dict) and hasattr(data, "to_dict"):
        data = data.to_dict()
    if not isinstance(data, dict):
        data = {}

    if etype == "checkout.session.completed":
        session_id = data.get("id")
        metadata = data.get("metadata") or {}
        if not isinstance(metadata, dict) and hasattr(metadata, "to_dict"):
            metadata = metadata.to_dict()
        if not isinstance(metadata, dict):
            metadata = {}
        if metadata.get("kind") == "ai_credits":
            from backend.services import ai_credit_service

            credited = ai_credit_service.handle_success_session(session_id)
            return {"handled": True, "ai_credits": credited}
        from backend.services import ai_credit_service

        credited = ai_credit_service.handle_payment_link_session(data)
        if credited:
            return {"handled": True, "ai_credits": True, "payment_link": True}
        pi = data.get("payment_intent")
        if isinstance(pi, dict):
            pi = pi.get("id")
        purchase = mark_session_paid(session_id, pi)
        return {"handled": True, "purchase": purchase}
    if etype == "account.updated":
        acct_id = data.get("id")
        with get_conn() as conn:
            row = conn.execute(
                "SELECT user_id FROM marketplace_seller_accounts WHERE stripe_account_id = ?",
                (acct_id,),
            ).fetchone()
        if row:
            upsert_seller_account(
                row["user_id"],
                charges_enabled=1 if data.get("charges_enabled") else 0,
                payouts_enabled=1 if data.get("payouts_enabled") else 0,
                details_submitted=1 if data.get("details_submitted") else 0,
            )
        return {"handled": True, "account": acct_id}
    return {"handled": False, "type": etype}


def fee_breakdown(price_cents: int) -> dict[str, Any]:
    fee = platform_fee_cents(price_cents)
    return {
        "price_cents": int(price_cents),
        "platform_fee_cents": fee,
        "platform_fee_percent": PLATFORM_FEE_PERCENT,
        "seller_net_cents": max(0, int(price_cents) - fee),
    }
