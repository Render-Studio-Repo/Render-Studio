import unittest
from unittest.mock import AsyncMock, patch
from backend.routers.dimos_teleop import dimos_quest_pipe


class DimosRouteTargetTest(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_invalid_target_never_routes_to_default(self):
        socket = AsyncMock()
        socket.headers = {'host': 'localhost'}
        with patch('backend.routers.dimos_teleop.connect_and_relay', new_callable=AsyncMock) as relay:
            await dimos_quest_pipe(socket, upstream='wss://example.com:8443/ws')
            relay.assert_not_awaited()
            socket.close.assert_awaited_once()

    async def test_selected_pi_target_is_preserved(self):
        socket = AsyncMock()
        socket.headers = {'host': 'localhost'}
        with patch('backend.routers.dimos_teleop.connect_and_relay', new_callable=AsyncMock) as relay:
            await dimos_quest_pipe(socket, upstream='wss://192.168.1.77:8443/ws')
            relay.assert_awaited_once_with(socket, 'wss://192.168.1.77:8443/ws')
