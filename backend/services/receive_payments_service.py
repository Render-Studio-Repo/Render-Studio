"""Receive-money integrations: Stripe Connect, PayPal OAuth, X handle, crypto wallets."""

from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from backend.config import settings
from backend.database import get_conn
from backend.services import marketplace_payments_service as seller_pay
from backend.services.social_oauth import consume_oauth_state_record, create_oauth_state

logger = logging.getLogger("render3d.receive_payments")

WALLET_CHAINS = ("eth", "sol", "btc")
PREFERRED_KINDS = ("stripe", "paypal", "x_money", "eth", "sol", "btc")
MIN_TIP_CENTS = 100
MAX_TIP_CENTS = 1_000_000

ETH_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
BTC_LEGACY_RE = re.compile(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$")
BTC_BECH32_RE = re.compile(r"^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,87}$")
SOL_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
X_HANDLE_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
PAYPAL_ME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

ALLOWED_NEXT = {
    "/",
    "/marketplace.html",
    "/marketplace.html#/sell",
    "/marketplace.html?receive_paypal=connected#/sell",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_schema() -> None:
    with get_conn() as conn:
        try:
            conn.execute("ALTER TABLE users ADD COLUMN receive_payments_json TEXT")
        except Exception:
            pass
        conn.commit()


def paypal_configured() -> bool:
    return bool((getattr(settings, "paypal_client_id", None) or "").strip() and (getattr(settings, "paypal_client_secret", None) or "").strip())


def paypal_mode() -> str:
    mode = str(getattr(settings, "paypal_mode", None) or "live").strip().lower()
    return "sandbox" if mode == "sandbox" else "live"


def paypal_redirect_uri() -> str:
    raw = (getattr(settings, "paypal_redirect_uri", None) or "").strip()
    if raw:
        return raw
    base = str(getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")
    return f"{base}/oauth/paypal/callback"


def _paypal_hosts() -> tuple[str, str]:
    if paypal_mode() == "sandbox":
        return "https://www.sandbox.paypal.com", "https://api-m.sandbox.paypal.com"
    return "https://www.paypal.com", "https://api-m.paypal.com"


def default_settings() -> dict[str, Any]:
    return {
        "show_receive_button": False,
        "preferred": "",
        "x_handle": "",
        "x_enabled": False,
        "paypal_me": "",
        "paypal_enabled": False,
        "stripe_enabled": False,
        "paypal_oauth": {},
        "wallets": {
            "eth": {"address": "", "enabled": False, "connected_via": ""},
            "sol": {"address": "", "enabled": False, "connected_via": ""},
            "btc": {"address": "", "enabled": False, "connected_via": ""},
        },
    }


def validate_eth(address: str) -> str:
    addr = str(address or "").strip()
    if not ETH_RE.match(addr):
        raise ValueError("Enter a valid Ethereum address (0x + 40 hex characters).")
    return addr


def validate_btc(address: str) -> str:
    addr = str(address or "").strip()
    if BTC_BECH32_RE.match(addr.lower()) or BTC_LEGACY_RE.match(addr):
        return addr
    raise ValueError("Enter a valid Bitcoin address (legacy 1/3 or bc1).")


def validate_sol(address: str) -> str:
    addr = str(address or "").strip()
    if addr.startswith("0x") or not SOL_RE.match(addr):
        raise ValueError("Enter a valid Solana address.")
    return addr


def validate_wallet(chain: str, address: str) -> str:
    chain = _chain(chain)
    if chain == "eth":
        return validate_eth(address)
    if chain == "btc":
        return validate_btc(address)
    return validate_sol(address)


def clean_x_handle(value: str) -> str:
    handle = str(value or "").strip().lstrip("@")
    if handle.startswith("https://"):
        handle = handle.rstrip("/").rsplit("/", 1)[-1]
    if handle and not X_HANDLE_RE.match(handle):
        raise ValueError("X handle must be 1–15 letters, numbers, or underscores.")
    return handle


def clean_paypal_me(value: str) -> str:
    raw = str(value or "").strip().lstrip("@")
    raw = raw.replace("https://www.paypal.me/", "").replace("https://paypal.me/", "")
    raw = raw.split("?")[0].strip("/")
    if raw and not PAYPAL_ME_RE.match(raw):
        raise ValueError("PayPal.me handle can use letters, numbers, dots, _ or -.")
    return raw


def _chain(chain: str) -> str:
    key = str(chain or "").strip().lower().replace("-", "_")
    aliases = {"ethereum": "eth", "solana": "sol", "bitcoin": "btc", "phantom": "sol"}
    key = aliases.get(key, key)
    if key not in WALLET_CHAINS:
        raise ValueError("Unsupported wallet network.")
    return key


def _blank_wallet() -> dict[str, Any]:
    return {"address": "", "enabled": False, "connected_via": ""}


def _merge(raw: Any) -> dict[str, Any]:
    data = default_settings()
    if not isinstance(raw, dict):
        return data
    data["show_receive_button"] = bool(raw.get("show_receive_button"))
    preferred = str(raw.get("preferred") or "").strip().lower()
    data["preferred"] = preferred if preferred in PREFERRED_KINDS else ""
    try:
        data["x_handle"] = clean_x_handle(raw.get("x_handle") or "")
    except ValueError:
        data["x_handle"] = str(raw.get("x_handle") or "").strip().lstrip("@")[:15]
    data["x_enabled"] = bool(raw.get("x_enabled"))
    try:
        data["paypal_me"] = clean_paypal_me(raw.get("paypal_me") or "")
    except ValueError:
        data["paypal_me"] = ""
    data["paypal_enabled"] = bool(raw.get("paypal_enabled"))
    data["stripe_enabled"] = bool(raw.get("stripe_enabled"))
    oauth = raw.get("paypal_oauth") if isinstance(raw.get("paypal_oauth"), dict) else {}
    data["paypal_oauth"] = {
        "payer_id": str(oauth.get("payer_id") or "").strip()[:64],
        "email": str(oauth.get("email") or "").strip()[:180],
        "name": str(oauth.get("name") or "").strip()[:120],
        "connected_at": str(oauth.get("connected_at") or "").strip()[:64],
    }
    wallets = raw.get("wallets") if isinstance(raw.get("wallets"), dict) else {}
    for chain in WALLET_CHAINS:
        src = wallets.get(chain) if isinstance(wallets.get(chain), dict) else {}
        data["wallets"][chain] = {
            "address": str(src.get("address") or "").strip()[:120],
            "enabled": bool(src.get("enabled")),
            "connected_via": str(src.get("connected_via") or "").strip()[:32],
        }
    return data


def _load(user_id: str) -> dict[str, Any]:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute("SELECT receive_payments_json FROM users WHERE id = ?", (user_id,)).fetchone()
    raw = {}
    if row:
        try:
            keys = row.keys()
            blob = row["receive_payments_json"] if "receive_payments_json" in keys else None
            raw = json.loads(blob or "{}") if blob else {}
        except Exception:
            raw = {}
    data = _merge(raw)
    return _sync_from_seller(user_id, data)


def _save(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    cleaned = _merge(data)
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET receive_payments_json = ? WHERE id = ?",
            (json.dumps(cleaned, separators=(",", ":"), sort_keys=True), user_id),
        )
        conn.commit()
    return cleaned


def _sync_from_seller(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    account = seller_pay.get_seller_account(user_id) or {}
    try:
        details = json.loads(account.get("payout_details_json") or "{}")
    except Exception:
        details = {}
    if not isinstance(details, dict):
        details = {}
    phantom = details.get("phantom") if isinstance(details.get("phantom"), dict) else {}
    sol_addr = str(phantom.get("wallet_address") or "").strip()
    current = data["wallets"]["sol"]
    if sol_addr and not current.get("address"):
        data["wallets"]["sol"] = {
            "address": sol_addr,
            "enabled": True if current.get("enabled") or not current.get("address") else bool(current.get("enabled")),
            "connected_via": current.get("connected_via") or "phantom",
        }
    return data


def _write_seller_sol(user_id: str, address: str) -> None:
    account = seller_pay.get_seller_account(user_id) or {}
    try:
        details = json.loads(account.get("payout_details_json") or "{}")
    except Exception:
        details = {}
    if not isinstance(details, dict):
        details = {}
    if address:
        details["phantom"] = {"wallet_address": address, "network": "solana"}
        seller_pay.upsert_seller_account(
            user_id,
            payout_details_json=json.dumps(details, separators=(",", ":")),
        )
    else:
        details.pop("phantom", None)
        seller_pay.upsert_seller_account(
            user_id,
            payout_details_json=json.dumps(details, separators=(",", ":")),
        )


def get_settings(user_id: str) -> dict[str, Any]:
    return _load(user_id)


def stripe_connected(user_id: str) -> bool:
    account = seller_pay.get_seller_account(user_id) or {}
    return bool(str(account.get("stripe_account_id") or "").strip())


def paypal_oauth_connected(data: dict[str, Any] | None) -> bool:
    oauth = (data or {}).get("paypal_oauth") or {}
    return bool(str(oauth.get("payer_id") or "").strip())


def method_ready(user_id: str, kind: str, data: dict[str, Any] | None = None) -> bool:
    data = data or _load(user_id)
    kind = str(kind or "").strip().lower()
    if kind == "stripe":
        return bool(data.get("stripe_enabled") and stripe_connected(user_id))
    if kind == "paypal":
        return bool(data.get("paypal_enabled") and (paypal_oauth_connected(data) or data.get("paypal_me")))
    if kind == "x_money":
        return bool(data.get("x_enabled") and data.get("x_handle"))
    if kind in WALLET_CHAINS:
        wallet = (data.get("wallets") or {}).get(kind) or {}
        return bool(wallet.get("enabled") and wallet.get("address"))
    return False


def available_methods(user_id: str, data: dict[str, Any] | None = None) -> list[str]:
    data = data or _load(user_id)
    return [kind for kind in PREFERRED_KINDS if method_ready(user_id, kind, data)]


def _clear_preferred_if_gone(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    ready = available_methods(user_id, data)
    if data.get("preferred") and data["preferred"] not in ready:
        data["preferred"] = ready[0] if ready else ""
    # Keep show_receive_button intent. public_payload still hides until a method is ready.
    return data


def patch_settings(user: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    data = _load(user["id"])
    if "show_receive_button" in body:
        data["show_receive_button"] = bool(body.get("show_receive_button"))
    if "preferred" in body:
        preferred = str(body.get("preferred") or "").strip().lower()
        if preferred and preferred not in PREFERRED_KINDS:
            raise ValueError("Unknown preferred payment method.")
        data["preferred"] = preferred
    if "x_handle" in body:
        data["x_handle"] = clean_x_handle(body.get("x_handle") or "")
    if "x_enabled" in body:
        data["x_enabled"] = bool(body.get("x_enabled"))
    if "paypal_me" in body:
        data["paypal_me"] = clean_paypal_me(body.get("paypal_me") or "")
    if "paypal_enabled" in body:
        data["paypal_enabled"] = bool(body.get("paypal_enabled"))
    if "stripe_enabled" in body:
        data["stripe_enabled"] = bool(body.get("stripe_enabled"))
    wallets = body.get("wallets")
    if isinstance(wallets, dict):
        for chain, src in wallets.items():
            if not isinstance(src, dict):
                continue
            key = _chain(chain)
            current = data["wallets"].get(key) or _blank_wallet()
            address = str(src.get("address") if "address" in src else current.get("address") or "").strip()
            if address:
                address = validate_wallet(key, address)
            enabled = bool(src.get("enabled")) if "enabled" in src else bool(current.get("enabled"))
            via = str(src.get("connected_via") if "connected_via" in src else current.get("connected_via") or "")
            if address and not via:
                via = "manual"
            data["wallets"][key] = {"address": address, "enabled": bool(enabled and address), "connected_via": via[:32]}
            if key == "sol":
                _write_seller_sol(user["id"], address)
    data = _clear_preferred_if_gone(user["id"], data)
    if data.get("show_receive_button") and not available_methods(user["id"], data):
        # Keep the toggle intent, but public payload stays hidden until a method exists.
        pass
    saved = _save(user["id"], data)
    return owner_payload(user, saved)


def save_wallet(user: dict[str, Any], chain: str, address: str, *, enabled: bool = True, connected_via: str = "manual") -> dict[str, Any]:
    key = _chain(chain)
    clean = validate_wallet(key, address) if address else ""
    data = _load(user["id"])
    data["wallets"][key] = {
        "address": clean,
        "enabled": bool(enabled and clean),
        "connected_via": (connected_via or "manual")[:32] if clean else "",
    }
    if key == "sol":
        _write_seller_sol(user["id"], clean)
    data = _clear_preferred_if_gone(user["id"], data)
    saved = _save(user["id"], data)
    return owner_payload(user, saved)


def disconnect_wallet(user: dict[str, Any], chain: str) -> dict[str, Any]:
    key = _chain(chain)
    data = _load(user["id"])
    data["wallets"][key] = _blank_wallet()
    if key == "sol":
        _write_seller_sol(user["id"], "")
        try:
            seller_pay.disconnect_payout_wallet(user, "phantom")
        except Exception:
            logger.warning("Could not clear seller phantom payout", exc_info=True)
    data = _clear_preferred_if_gone(user["id"], data)
    saved = _save(user["id"], data)
    return owner_payload(user, saved)


def disconnect_stripe(user: dict[str, Any]) -> dict[str, Any]:
    seller_pay.disconnect_stripe(user)
    data = _load(user["id"])
    data["stripe_enabled"] = False
    data = _clear_preferred_if_gone(user["id"], data)
    saved = _save(user["id"], data)
    return owner_payload(user, saved)


def disconnect_paypal(user: dict[str, Any]) -> dict[str, Any]:
    seller_pay.disconnect_paypal(user)
    data = _load(user["id"])
    data["paypal_oauth"] = {}
    data["paypal_enabled"] = bool(data.get("paypal_me"))
    data = _clear_preferred_if_gone(user["id"], data)
    saved = _save(user["id"], data)
    return owner_payload(user, saved)


def paypal_authorize_url(user: dict[str, Any], *, next_path: str = "/") -> str:
    if not paypal_configured():
        raise RuntimeError("PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.")
    dest = next_path if next_path in ALLOWED_NEXT else "/"
    state = create_oauth_state(user["id"], redirect_path=dest)
    web, _api = _paypal_hosts()
    params = {
        "client_id": settings.paypal_client_id.strip(),
        "response_type": "code",
        "scope": "openid profile email",
        "redirect_uri": paypal_redirect_uri(),
        "state": state,
    }
    return f"{web}/signin/authorize?{urlencode(params)}"


def finish_paypal_oauth(code: str, state: str) -> dict[str, Any]:
    rec = consume_oauth_state_record(state)
    if not rec or not rec.get("user_id"):
        raise ValueError("PayPal sign-in expired. Try connecting again.")
    if not paypal_configured():
        raise RuntimeError("PayPal is not configured.")
    _web, api = _paypal_hosts()
    token_resp = httpx.post(
        f"{api}/v1/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": paypal_redirect_uri(),
        },
        auth=(settings.paypal_client_id.strip(), settings.paypal_client_secret.strip()),
        headers={"Accept": "application/json"},
        timeout=20,
    )
    token_resp.raise_for_status()
    token = token_resp.json()
    access = str(token.get("access_token") or "")
    if not access:
        raise RuntimeError("PayPal did not return an access token.")
    info_resp = httpx.get(
        f"{api}/v1/identity/openidconnect/userinfo",
        params={"schema": "openid"},
        headers={"Authorization": f"Bearer {access}", "Accept": "application/json"},
        timeout=15,
    )
    info_resp.raise_for_status()
    info = info_resp.json() if isinstance(info_resp.json(), dict) else {}
    payer_id = str(info.get("payer_id") or info.get("user_id") or info.get("sub") or "").strip()
    email = str(info.get("email") or "").strip().lower()
    name = str(info.get("name") or "").strip()
    if not payer_id:
        raise RuntimeError("PayPal did not return an account id.")
    user_id = str(rec["user_id"])
    data = _load(user_id)
    data["paypal_oauth"] = {
        "payer_id": payer_id[:64],
        "email": email[:180],
        "name": name[:120],
        "connected_at": _now(),
    }
    data["paypal_enabled"] = True
    if not data.get("preferred"):
        data["preferred"] = "paypal"
    _save(user_id, data)
    if email:
        try:
            seller_pay.set_paypal_email({"id": user_id}, email)
        except Exception:
            logger.warning("Could not sync PayPal email to seller account", exc_info=True)
    next_path = str(rec.get("redirect_uri") or "/")
    if next_path not in ALLOWED_NEXT:
        next_path = "/"
    return {"user_id": user_id, "payer_id": payer_id, "email": email, "next": next_path}


def owner_payload(user: dict[str, Any], data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = data or _load(user["id"])
    seller = seller_pay.seller_status(user)
    stripe_id = str(seller.get("stripe_account_id") or "").strip()
    oauth = data.get("paypal_oauth") or {}
    wallets = {}
    for chain in WALLET_CHAINS:
        w = (data.get("wallets") or {}).get(chain) or _blank_wallet()
        wallets[chain] = {
            "address": w.get("address") or "",
            "enabled": bool(w.get("enabled") and w.get("address")),
            "connected_via": w.get("connected_via") or "",
            "connected": bool(w.get("address")),
        }
    methods = available_methods(user["id"], data)
    return {
        "show_receive_button": bool(data.get("show_receive_button")),
        "preferred": data.get("preferred") or (methods[0] if methods else ""),
        "x_handle": data.get("x_handle") or "",
        "x_enabled": bool(data.get("x_enabled")),
        "paypal_me": data.get("paypal_me") or "",
        "paypal_enabled": bool(data.get("paypal_enabled")),
        "stripe_enabled": bool(data.get("stripe_enabled")),
        "stripe_connected": bool(stripe_id),
        "stripe_ready": bool(seller.get("stripe_ready")),
        "stripe_account_id": stripe_id,
        "paypal_oauth_configured": paypal_configured(),
        "paypal_connected": paypal_oauth_connected(data),
        "paypal_email": str(oauth.get("email") or seller.get("paypal_email") or ""),
        "paypal_payer_id": str(oauth.get("payer_id") or ""),
        "paypal_name": str(oauth.get("name") or ""),
        "wallets": wallets,
        "available_methods": methods,
        "can_show_button": bool(data.get("show_receive_button") and methods),
        "stripe_configured": seller_pay.configured(),
        "authorized_apps": authorized_app_records(user, data, seller),
    }


def authorized_app_records(user: dict[str, Any], data: dict[str, Any] | None = None, seller: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = data or _load(user["id"])
    seller = seller or seller_pay.seller_status(user)
    stripe_id = str(seller.get("stripe_account_id") or "").strip()
    oauth = data.get("paypal_oauth") or {}
    rows = [
        {
            "key": "stripe",
            "label": "Stripe",
            "connected": bool(stripe_id),
            "detail": (
                "Bank payouts connected"
                if seller.get("stripe_ready")
                else "Finish Express onboarding"
                if stripe_id
                else "Connect Express to accept cards"
            ),
            "action": "unlink-stripe" if stripe_id else "connect-stripe",
            "cta": "Unlink" if seller.get("stripe_ready") else ("Finish setup" if stripe_id else "Connect"),
        },
        {
            "key": "paypal",
            "label": "PayPal",
            "connected": paypal_oauth_connected(data),
            "detail": (
                oauth.get("email") or "PayPal account linked"
                if paypal_oauth_connected(data)
                else "Needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET"
                if not paypal_configured()
                else "Login with PayPal to accept payments"
            ),
            "action": "unlink-paypal" if paypal_oauth_connected(data) else "connect-paypal-oauth",
            "cta": "Unlink" if paypal_oauth_connected(data) else ("Connect" if paypal_configured() else "Setup needed"),
            "disabled": (not paypal_oauth_connected(data)) and (not paypal_configured()),
        },
    ]
    labels = {"eth": ("Ethereum", "MetaMask or 0x address"), "sol": ("Phantom / Solana", "Solana wallet"), "btc": ("Bitcoin", "BTC address")}
    for chain in WALLET_CHAINS:
        w = (data.get("wallets") or {}).get(chain) or {}
        addr = str(w.get("address") or "")
        short = f"{addr[:6]}…{addr[-4:]}" if len(addr) > 14 else addr
        label, idle = labels[chain]
        connected = bool(addr)
        rows.append(
            {
                "key": f"wallet-{chain}",
                "label": label,
                "connected": connected,
                "detail": f"{short} · {w.get('connected_via') or 'saved'}" if connected else idle,
                "action": f"unlink-wallet-{chain}" if connected else f"connect-wallet-{chain}",
                "cta": "Unlink" if connected else "Connect",
            }
        )
    return rows


def public_payload(user_id: str, *, handle: str = "") -> dict[str, Any]:
    data = _load(user_id)
    methods = available_methods(user_id, data)
    show = bool(data.get("show_receive_button") and methods)
    preferred = data.get("preferred") if data.get("preferred") in methods else (methods[0] if methods else "")
    public_methods = []
    for kind in methods:
        public_methods.append(_public_action(user_id, kind, data, handle=handle))
    action = next((m for m in public_methods if m.get("kind") == preferred), public_methods[0] if public_methods else None)
    return {
        "show_button": show,
        "preferred": preferred,
        "button_label": "Send money" if show else "",
        "action": action,
        "methods": public_methods if show else [],
    }


def _public_action(user_id: str, kind: str, data: dict[str, Any], *, handle: str = "") -> dict[str, Any]:
    if kind == "stripe":
        return {
            "kind": "stripe",
            "label": "Card · Stripe",
            "mode": "checkout",
            "url": "",
        }
    if kind == "paypal":
        me = data.get("paypal_me") or ""
        email = str((data.get("paypal_oauth") or {}).get("email") or "")
        url = f"https://www.paypal.me/{me}" if me else "https://www.paypal.com/myaccount/transfer/homepage"
        return {
            "kind": "paypal",
            "label": "PayPal",
            "mode": "link",
            "url": url,
            "paypal_me": me,
            "email": email,
        }
    if kind == "x_money":
        xh = data.get("x_handle") or ""
        return {
            "kind": "x_money",
            "label": f"X · @{xh}" if xh else "X Money",
            "mode": "link",
            "url": f"https://x.com/{xh}" if xh else "https://x.com",
            "handle": xh,
        }
    wallet = (data.get("wallets") or {}).get(kind) or {}
    names = {"eth": "Ethereum", "sol": "Solana", "btc": "Bitcoin"}
    addr = wallet.get("address") or ""
    return {
        "kind": kind,
        "label": names.get(kind, kind),
        "mode": "crypto",
        "address": addr,
        "network": kind,
        "url": "",
    }


def create_receive_checkout(
    seller_user_id: str,
    *,
    amount_cents: int,
    success_url: str,
    cancel_url: str,
    note: str = "",
    buyer_email: str = "",
) -> dict[str, Any]:
    data = _load(seller_user_id)
    if not method_ready(seller_user_id, "stripe", data):
        raise ValueError("This person has not enabled Stripe for receive money.")
    amount = max(MIN_TIP_CENTS, min(MAX_TIP_CENTS, int(amount_cents or 0)))
    account = seller_pay.get_seller_account(seller_user_id) or {}
    destination = str(account.get("stripe_account_id") or "").strip()
    if not destination:
        raise ValueError("Stripe is not connected.")
    stripe = seller_pay._stripe()
    if not stripe:
        return {
            "demo": True,
            "url": success_url,
            "message": "Stripe keys not configured — demo receive checkout.",
        }
    metadata = {
        "kind": "receive_money",
        "seller_user_id": seller_user_id,
        "note": str(note or "")[:120],
        "idempotency": secrets.token_hex(8),
    }
    params: dict[str, Any] = {
        "mode": "payment",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "line_items": [
            {
                "quantity": 1,
                "price_data": {
                    "currency": "usd",
                    "unit_amount": amount,
                    "product_data": {
                        "name": "Send money",
                        "description": (note or "Payment via Render Studio")[:400],
                    },
                },
            }
        ],
        "payment_method_types": ["card", "link"],
        "metadata": metadata,
        "payment_intent_data": {"metadata": metadata},
    }
    if buyer_email:
        params["customer_email"] = buyer_email
    if destination and not destination.startswith("acct_demo_"):
        params["payment_intent_data"] = {
            **params["payment_intent_data"],
            "transfer_data": {"destination": destination},
        }
    session = stripe.checkout.Session.create(**params)
    return {"url": session["url"], "session_id": session["id"], "amount_cents": amount}


def public_config() -> dict[str, Any]:
    return {
        "stripe_configured": seller_pay.configured(),
        "paypal_configured": paypal_configured(),
        "paypal_mode": paypal_mode(),
        "min_tip_cents": MIN_TIP_CENTS,
        "supported_wallets": list(WALLET_CHAINS),
    }
