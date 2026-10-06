"""Receive-money connect, settings, public pay payload, and PayPal OAuth."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from backend.auth import get_current_user, get_current_user_optional
from backend.config import settings
from backend.services import profile_service, receive_payments_service

router = APIRouter()


def _origin(request: Request) -> str:
    return str(getattr(settings, "public_base_url", None) or str(request.base_url).rstrip("/")).rstrip("/")


class ReceivePatch(BaseModel):
    show_receive_button: bool | None = None
    preferred: str | None = None
    x_handle: str | None = None
    x_enabled: bool | None = None
    paypal_me: str | None = None
    paypal_enabled: bool | None = None
    stripe_enabled: bool | None = None
    wallets: dict[str, Any] | None = None


class WalletBody(BaseModel):
    chain: str = Field(..., max_length=20)
    address: str = Field(default="", max_length=120)
    enabled: bool = True
    connected_via: str = Field(default="manual", max_length=32)


class CheckoutBody(BaseModel):
    handle: str = Field(default="", max_length=48)
    user_id: str = Field(default="", max_length=64)
    amount_cents: int = Field(default=500, ge=100, le=1_000_000)
    note: str = Field(default="", max_length=120)
    success_url: str = Field(default="", max_length=500)
    cancel_url: str = Field(default="", max_length=500)


@router.get("/api/receive-payments/config")
def receive_config():
    return receive_payments_service.public_config()


@router.get("/api/receive-payments/me")
def receive_me(user: dict[str, Any] = Depends(get_current_user)):
    return receive_payments_service.owner_payload(user)


@router.patch("/api/receive-payments/me")
def receive_patch(body: ReceivePatch, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return receive_payments_service.patch_settings(user, body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/receive-payments/wallets")
def receive_save_wallet(body: WalletBody, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return receive_payments_service.save_wallet(
            user,
            body.chain,
            body.address,
            enabled=body.enabled,
            connected_via=body.connected_via,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.delete("/api/receive-payments/wallets/{chain}")
def receive_disconnect_wallet(chain: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return receive_payments_service.disconnect_wallet(user, chain)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.delete("/api/receive-payments/stripe")
def receive_disconnect_stripe(user: dict[str, Any] = Depends(get_current_user)):
    return receive_payments_service.disconnect_stripe(user)


@router.delete("/api/receive-payments/paypal")
def receive_disconnect_paypal(user: dict[str, Any] = Depends(get_current_user)):
    return receive_payments_service.disconnect_paypal(user)


@router.get("/api/receive-payments/paypal/connect")
def receive_paypal_connect(
    request: Request,
    next: str = Query(default="/"),
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        url = receive_payments_service.paypal_authorize_url(user, next_path=next)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"url": url, "configured": True}


@router.get("/oauth/paypal/callback")
def receive_paypal_callback(
    request: Request,
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
):
    base = _origin(request)
    if error:
        return RedirectResponse(f"{base}/?receive_paypal=error&detail={quote(error)[:80]}")
    if not code or not state:
        return RedirectResponse(f"{base}/?receive_paypal=error")
    try:
        result = receive_payments_service.finish_paypal_oauth(code, state)
    except Exception as exc:
        return RedirectResponse(f"{base}/?receive_paypal=error&detail={quote(str(exc))[:120]}")
    dest = result.get("next") or "/"
    sep = "&" if "?" in dest else "?"
    if "receive_paypal=" not in dest:
        dest = f"{dest}{sep}receive_paypal=connected"
    if dest.startswith("http"):
        return RedirectResponse(dest)
    return RedirectResponse(f"{base}{dest}")


@router.get("/api/receive-payments/public/{handle}")
def receive_public(handle: str):
    user = profile_service.get_user_row(handle=handle)
    if not user:
        raise HTTPException(404, "Profile not found")
    return receive_payments_service.public_payload(user["id"], handle=user.get("handle") or handle)


@router.post("/api/receive-payments/checkout")
def receive_checkout(
    body: CheckoutBody,
    request: Request,
    viewer: dict[str, Any] | None = Depends(get_current_user_optional),
):
    owner = None
    if body.user_id:
        owner = profile_service.get_user_row(user_id=body.user_id)
    elif body.handle:
        owner = profile_service.get_user_row(handle=body.handle)
    if not owner:
        raise HTTPException(404, "Profile not found")
    here = _origin(request)
    success = body.success_url or f"{here}/u/{owner.get('handle') or ''}?paid=1"
    cancel = body.cancel_url or f"{here}/u/{owner.get('handle') or ''}?paid=cancel"
    try:
        return receive_payments_service.create_receive_checkout(
            owner["id"],
            amount_cents=body.amount_cents,
            success_url=success,
            cancel_url=cancel,
            note=body.note,
            buyer_email=str((viewer or {}).get("email") or ""),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
