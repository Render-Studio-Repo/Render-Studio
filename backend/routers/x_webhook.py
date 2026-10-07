"""Public X Account Activity webhook routes (no session cookie)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.services import x_webhook_service as xwh

router = APIRouter()


async def x_webhook_get(request: Request):
    try:
        payload = xwh.handle_crc(None, request.scope.get("query_string"))
    except xwh.WebhookConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return JSONResponse(payload, media_type="application/json")


async def x_webhook_post(request: Request):
    body = await request.body()
    sig = request.headers.get(xwh.SIGNATURE_HEADER)
    try:
        return xwh.handle_post(body, sig)
    except xwh.WebhookConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except xwh.WebhookSignatureError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _register_paths() -> None:
    seen: set[str] = set()
    paths = list(xwh.webhook_paths())
    custom = str(getattr(settings, "x_webhook_path", None) or "").strip()
    if custom:
        if not custom.startswith("/"):
            custom = "/" + custom
        paths.append(custom)
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        router.add_api_route(path, x_webhook_get, methods=["GET", "HEAD"], include_in_schema=True)
        router.add_api_route(path, x_webhook_post, methods=["POST"], include_in_schema=True)


_register_paths()
