"""Personal grant routes bind mutations to the authenticated owner and Claude."""
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.auth import get_current_user
from backend.routers import subscription_people as routes


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "owner"}
    with TestClient(app) as client, patch.object(routes, "_notify"):
        yield client


def test_claude_people_cannot_override_authenticated_owner(client):
    with patch.object(routes.shares, "add_personal_person", return_value={"status": "added", "person": {"user_id": "friend"}}) as add, patch.object(routes.shares, "list_personal_people", return_value=[]):
        response = client.post("/api/ai-subscriptions/claude/people", json={"owner_user_id": "victim", "provider": "openai", "user_id": "friend", "daily_limit_usd": 5})
    assert response.status_code == 200
    assert add.call_args.args == ("owner", "claude")
    assert add.call_args.kwargs["user_id"] == "friend"
    assert add.call_args.kwargs["daily_limit_usd"] == 5


def test_update_and_delete_keep_owner_and_provider_scope(client):
    with patch.object(routes.shares, "set_personal_person_access", return_value=[]) as update:
        response = client.put("/api/ai-subscriptions/claude/people/friend", json={"granted": False})
        assert response.status_code == 200
        assert update.call_args.args == ("owner", "claude", "friend")
        assert update.call_args.kwargs["granted"] is False
    with patch.object(routes.shares, "remove_personal_person", return_value={"removed": True}) as remove, patch.object(routes.shares, "list_personal_people", return_value=[]):
        response = client.delete("/api/ai-subscriptions/claude/people/friend")
        assert response.status_code == 200
        assert remove.call_args.args == ("owner", "claude", "friend")


@pytest.mark.parametrize("limit", [-1, "NaN", "Infinity", "bad"])
def test_invalid_limits_do_not_create_grant(client, limit):
    with patch.object(routes.shares, "add_personal_person") as add:
        assert client.post("/api/ai-subscriptions/claude/people", json={"daily_limit_usd": limit}).status_code == 400
        add.assert_not_called()


def test_unauthenticated_request_cannot_list_or_mutate():
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        for method in (client.get, client.post):
            assert method("/api/ai-subscriptions/claude/people").status_code == 401


def test_generation_uses_grant_owner_and_refuses_exhausted_cap():
    import ast
    import __future__
    from pathlib import Path
    from typing import Any
    from fastapi import HTTPException
    from backend.services import cli_subscription_ai

    tree = ast.parse(Path("backend/main.py").read_text())
    fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_cli_subscription_ai")
    scope = {"Any": Any, "HTTPException": HTTPException,
             "_cli_subscription_owner": lambda *args: {"owner_user_id": "grant-owner", "kind": "personal"}}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "backend/main.py", "exec", flags=__future__.annotations.compiler_flag), scope)
    with patch.object(cli_subscription_ai, "ClaudeSubscriptionAI") as model:
        scope["_cli_subscription_ai"]({"id": "recipient"}, "claude", "fixture-model")
        model.assert_called_once_with(user_id="grant-owner", model="fixture-model")
        model.reset_mock()
        scope["_cli_subscription_owner"] = lambda *args: {"owner_user_id": None, "kind": "daily_limit"}
        with pytest.raises(HTTPException) as error:
            scope["_cli_subscription_ai"]({"id": "recipient"}, "claude", "fixture-model")
        assert error.value.status_code == 402
        model.assert_not_called()


def test_personal_share_route_lifecycle_uses_real_grant_service():
    from backend.tests.test_personal_subscription_share import PersonalSubscriptionShareTests
    from backend.services import subscription_share_service

    case = PersonalSubscriptionShareTests()
    case.setUp()
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": "owner"}
    try:
        with TestClient(app) as client, patch.object(routes, "_notify"):
            created = client.post("/api/ai-subscriptions/claude/people", json={"user_id": "recipient", "confirm_new_collaborator": True, "daily_limit_usd": 5})
            assert created.status_code == 200
            assert created.json()["people"][0]["user_id"] == "recipient"
            assert subscription_share_service.resolve_owner("recipient", "claude", spent_today_usd=0)["owner_user_id"] == "owner"
            received = subscription_share_service.listing_for_user("recipient", "claude")["personal_received"]
            assert received[0]["granted"] is True
            assert received[0]["owner_signed_in"] is True
            assert client.put("/api/ai-subscriptions/claude/people/recipient", json={"granted": False}).status_code == 200
            assert subscription_share_service.resolve_owner("recipient", "claude", spent_today_usd=0)["owner_user_id"] is None
            assert client.delete("/api/ai-subscriptions/claude/people/recipient").status_code == 200
            assert client.get("/api/ai-subscriptions/claude/people").json()["people"] == []
    finally:
        case.doCleanups()
