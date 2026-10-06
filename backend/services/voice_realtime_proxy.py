"""Authenticated Realtime relay with safe, actionable setup failures.

The caller must authenticate the Studio user and resolve their permitted key
before calling serve_realtime_proxy. Provider keys and arbitrary error bodies
must never be returned to the browser or written to logs.
"""
from __future__ import annotations

import asyncio
import logging
import ssl

from starlette.websockets import WebSocketDisconnect

logger = logging.getLogger(__name__)


class RealtimeProviderError(RuntimeError):
    def __init__(self, code=None, param=None):
        # Keep only known categories; providers may echo request contents.
        allowed = {"invalid_api_key", "model_not_found", "insufficient_quota",
                   "rate_limit_exceeded", "invalid_request_error", "unknown_parameter",
                   "invalid_value", "unsupported_value", "missing_required_parameter"}
        self.provider_code = code if isinstance(code, str) and code in allowed else "session_configuration_error"
        self.parameter = param if isinstance(param, str) and param.startswith("session.") and len(param) < 100 and all(c.isalnum() or c in "._[]" for c in param) else ""
        super().__init__(self.provider_code)


def realtime_failure(error):
    """Return a fixed public message; never relay raw exception/provider text."""
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None) or getattr(error, "status_code", None)
    code = getattr(error, "provider_code", "")
    if status == 401 or code == "invalid_api_key":
        return "provider_auth", "OpenAI rejected the saved API key. Check the OpenAI key in Studio settings, then tap Talk again."
    if status == 403:
        return "provider_access", "OpenAI denied access to this voice model. Check the saved key's project permissions and model access."
    if status == 404 or code == "model_not_found":
        return "provider_model", "The selected voice model is unavailable for this key. Choose another Realtime model in agent settings."
    if status == 429 or code in {"insufficient_quota", "rate_limit_exceeded"}:
        return "provider_limit", "OpenAI voice quota or rate limit was reached. Check the key's API usage and billing, then retry."
    if isinstance(error, ssl.SSLError):
        return "provider_tls", "The Studio server could not verify the voice provider's secure connection. Ask the server administrator to check TLS certificates."
    if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        return "provider_timeout", "The voice provider did not finish connecting in time. Tap Talk to retry."
    reason = str(getattr(getattr(error, "rcvd", None), "reason", ""))
    if "beta_api_shape_disabled" in reason:
        return "provider_retired_protocol", "The server used a retired voice protocol. Reload Studio after the server update, then tap Talk again."
    if isinstance(error, RealtimeProviderError):
        suffix = f" ({error.parameter})" if error.parameter else ""
        return "provider_configuration", f"OpenAI rejected the voice session configuration{suffix}. Reload Studio after the server update, then retry."
    return "provider_connection", "The Studio server could not connect to OpenAI voice. Tap Talk to retry; if it continues, check server connectivity and the saved key."


async def serve_realtime_proxy(websocket, model, api_key, instructions):
    from . import voice_mold_service as voice

    # Authenticate first in the route, then accept before upstream setup so a
    # provider failure becomes a visible error instead of an opaque HTTP 403.
    await websocket.accept()
    upstream = None
    stage = "connect"
    try:
        upstream = await voice.open_openai_realtime_ws(model, api_key)
        stage = "configure"
        await voice.bootstrap_openai_realtime_session(upstream, model, instructions)
        stage = "relay"
        await voice.relay_realtime_sockets(websocket, upstream)
    except WebSocketDisconnect:
        pass
    except Exception as error:
        code, message = realtime_failure(error)
        logger.warning("Realtime %s failed: %s (%s)", stage, code, type(error).__name__)
        try:
            await websocket.send_json({"type": "error", "error": {"code": code, "message": message}})
        except Exception:
            pass  # Client may have left VR while upstream setup was pending.
    finally:
        if upstream is not None:
            try:
                await upstream.close()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass
