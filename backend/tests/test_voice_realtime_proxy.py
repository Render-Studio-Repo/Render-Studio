"""Realtime GA handshake, private setup failures, and actual route auth guards."""
from __future__ import annotations

import ast
import asyncio
import json
import ssl
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from backend.services import voice_mold_service as voice
from backend.services.voice_realtime_proxy import (
    RealtimeProviderError, realtime_failure, serve_realtime_proxy,
)


def socket():
    return SimpleNamespace(accept=AsyncMock(), close=AsyncMock(), send_json=AsyncMock())


class RealtimeHandshakeTests(unittest.IsolatedAsyncioTestCase):
    async def test_websocket_uses_ga_without_beta_header(self):
        with patch("websockets.connect", new_callable=AsyncMock) as connect:
            await voice.open_openai_realtime_ws("gpt-realtime", "sk-test-private")
        args, kwargs = connect.call_args
        self.assertIn("model=gpt-realtime", args[0])
        self.assertEqual(dict(kwargs["additional_headers"]), {"Authorization": "Bearer sk-test-private"})
        self.assertEqual(kwargs["subprotocols"], ["realtime"])

    async def test_bootstrap_waits_for_update_not_creation_or_other_events(self):
        upstream = SimpleNamespace(send=AsyncMock(), recv=AsyncMock(side_effect=[
            json.dumps({"type": "session.created"}), b"ignored",
            json.dumps({"type": "rate_limits.updated"}),
            json.dumps({"type": "session.updated"}),
        ]))
        await voice.bootstrap_openai_realtime_session(upstream, "gpt-realtime", "Test")
        self.assertEqual(upstream.recv.await_count, 4)
        payload = json.loads(upstream.send.call_args.args[0])
        self.assertEqual(payload["type"], "session.update")
        self.assertEqual(payload["session"]["type"], "realtime")
        self.assertIn("audio", payload["session"])

    async def test_provider_error_does_not_echo_provider_message_or_untrusted_code(self):
        upstream = SimpleNamespace(recv=AsyncMock(return_value=json.dumps({
            "type": "error", "error": {"code": "sk-secret", "message": "private transcript sk-secret", "param": "sk-secret"},
        })))
        with self.assertRaises(RealtimeProviderError) as raised:
            await voice.wait_realtime_session_ready(upstream)
        self.assertEqual(str(raised.exception), "session_configuration_error")
        self.assertNotIn("secret", realtime_failure(raised.exception)[1])

    async def test_session_created_without_update_times_out(self):
        async def recv():
            await asyncio.sleep(0.1)
            return json.dumps({"type": "session.created"})
        with self.assertRaises(asyncio.TimeoutError):
            await voice.wait_realtime_session_ready(SimpleNamespace(recv=recv), timeout=0.01)

    async def test_client_secret_uses_only_ga_endpoint_without_beta(self):
        response = SimpleNamespace(status_code=200, content=b"json", json=lambda: {"value": "ek-test"})
        client = SimpleNamespace(post=AsyncMock(return_value=response))
        manager = AsyncMock()
        manager.__aenter__.return_value = client
        with patch("httpx.AsyncClient", return_value=manager):
            result = await voice.mint_realtime_client_secret("sk-test", model="gpt-realtime", instructions="Test")
        self.assertEqual(result["client_secret"], "ek-test")
        self.assertEqual(client.post.call_args.args[0], voice.CLIENT_SECRETS_URL)
        self.assertNotIn("OpenAI-Beta", client.post.call_args.kwargs["headers"])
        self.assertEqual(client.post.await_count, 1)

    async def test_client_secret_failure_does_not_retry_retired_sessions_endpoint(self):
        client = SimpleNamespace(post=AsyncMock(return_value=SimpleNamespace(status_code=400, text="invalid configuration")))
        manager = AsyncMock()
        manager.__aenter__.return_value = client
        with patch("httpx.AsyncClient", return_value=manager):
            with self.assertRaises(RuntimeError):
                await voice.mint_realtime_client_secret("sk-test", model="gpt-realtime", instructions="Test")
        self.assertEqual(client.post.await_count, 1)


class RealtimeProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_authenticated_proxy_accepts_then_connects_configures_and_relays(self):
        events = []
        client = socket()
        client.accept.side_effect = lambda: events.append("accept")
        upstream = SimpleNamespace(close=AsyncMock())
        async def connect(*args):
            events.append("connect")
            return upstream
        async def bootstrap(*args):
            events.append("bootstrap")
        async def relay(*args):
            events.append("relay")
        with patch.object(voice, "open_openai_realtime_ws", side_effect=connect), patch.object(voice, "bootstrap_openai_realtime_session", side_effect=bootstrap), patch.object(voice, "relay_realtime_sockets", side_effect=relay):
            await serve_realtime_proxy(client, "gpt-realtime", "sk-private", "Test")
        self.assertEqual(events, ["accept", "connect", "bootstrap", "relay"])
        upstream.close.assert_awaited_once()
        client.close.assert_awaited_once()
        client.send_json.assert_not_awaited()

    async def test_configuration_failure_is_actionable_without_exposing_secrets(self):
        client, upstream = socket(), SimpleNamespace(close=AsyncMock())
        with patch.object(voice, "open_openai_realtime_ws", new_callable=AsyncMock, return_value=upstream), patch.object(voice, "bootstrap_openai_realtime_session", side_effect=RealtimeProviderError("unknown_parameter", "session.audio.input.invalid")), patch.object(voice, "relay_realtime_sockets", new_callable=AsyncMock) as relay, self.assertLogs("backend.services.voice_realtime_proxy", "WARNING") as logs:
            await serve_realtime_proxy(client, "gpt-realtime", "sk-private", "private transcript")
        payload = client.send_json.call_args.args[0]
        self.assertEqual(payload["error"]["code"], "provider_configuration")
        self.assertIn("session.audio.input.invalid", payload["error"]["message"])
        self.assertNotIn("sk-private", str(payload) + str(logs.output))
        self.assertNotIn("private transcript", str(payload) + str(logs.output))
        relay.assert_not_awaited()
        upstream.close.assert_awaited_once()

    async def test_connection_failure_is_sent_after_accept(self):
        client = socket()
        with patch.object(voice, "open_openai_realtime_ws", side_effect=RuntimeError("sk-private host error")), self.assertLogs("backend.services.voice_realtime_proxy", "WARNING") as logs:
            await serve_realtime_proxy(client, "gpt-realtime", "sk-private", "Test")
        client.accept.assert_awaited_once()
        self.assertEqual(client.send_json.call_args.args[0]["error"]["code"], "provider_connection")
        self.assertNotIn("sk-private", str(client.send_json.call_args) + str(logs.output))
        client.close.assert_awaited_once()

    def test_known_failure_categories_are_sanitized(self):
        for status, expected in [(401, "provider_auth"), (403, "provider_access"), (404, "provider_model"), (429, "provider_limit")]:
            error = RuntimeError("never return sk-private")
            error.response = SimpleNamespace(status_code=status)
            code, text = realtime_failure(error)
            self.assertEqual(code, expected)
            self.assertNotIn("sk-private", text)
        self.assertEqual(realtime_failure(ssl.SSLError("secret"))[0], "provider_tls")
        self.assertEqual(realtime_failure(asyncio.TimeoutError())[0], "provider_timeout")
        error = RuntimeError("private")
        error.rcvd = SimpleNamespace(reason="invalid_request_error.beta_api_shape_disabled")
        self.assertEqual(realtime_failure(error)[0], "provider_retired_protocol")


class RealtimeActualRouteTests(unittest.IsolatedAsyncioTestCase):
    """Compile the actual route, excluding unrelated server startup imports."""
    def setUp(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / "main.py").read_text())
        route = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "voice_mold_ws")
        route.decorator_list = []
        module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), route], type_ignores=[])
        self.decode, self.user = Mock(return_value="user-id"), Mock(return_value={"id": "user-id"})
        namespace = {"Query": lambda value: value, "decode_token": self.decode, "get_user_by_id": self.user}
        exec(compile(ast.fix_missing_locations(module), "actual-voice-route", "exec"), namespace)
        self.route = namespace["voice_mold_ws"]

    async def test_auth_rejections_never_accept_or_open_provider(self):
        cases = [(None, {"id": "u"}, "gpt-realtime", "key", 4401),
                 ("u", None, "gpt-realtime", "key", 4403),
                 ("u", {"id": "u"}, "unknown-model", "key", 4400),
                 ("u", {"id": "u"}, "gpt-6-astra", "key", 4400),
                 ("u", {"id": "u"}, "gpt-realtime", None, 4401)]
        for user_id, user, model, key, code in cases:
            client = socket()
            self.decode.return_value, self.user.return_value = user_id, user
            with patch.object(voice, "resolve_openai_api_key", return_value=key), patch("backend.services.voice_realtime_proxy.serve_realtime_proxy", new_callable=AsyncMock) as serve:
                await self.route(client, "signed-token", model, "project")
            client.accept.assert_not_awaited()
            client.close.assert_awaited_once_with(code=code)
            serve.assert_not_awaited()

    async def test_valid_route_passes_permitted_key_to_safe_proxy(self):
        client = socket()
        with patch.object(voice, "resolve_openai_api_key", return_value="sk-permitted") as resolve, patch("backend.services.voice_realtime_proxy.serve_realtime_proxy", new_callable=AsyncMock) as serve:
            await self.route(client, "signed-token", "gpt-realtime", "project")
        resolve.assert_called_once_with({"id": "user-id"}, project_id="project")
        self.assertEqual(serve.call_args.args[:3], (client, "gpt-realtime", "sk-permitted"))


if __name__ == "__main__":
    unittest.main()
