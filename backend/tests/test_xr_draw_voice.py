"""Spatial Draw provider contracts are inert and use isolated fake AI calls."""
import json
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.services.xr_draw_voice import normalize_draw_command
from backend.services.voice_mold_service import astra_turn_system_prompt, parse_astra_turn_json
from backend.services.xr_agent_discussion import create_xr_agent_discussion_router


def test_commands_exclude_generation_code_and_non_scalar_fields():
    for action in ("generate", "apply_micro_edit", "delete_project", "eval", [], {}, None):
        assert normalize_draw_command({"action": action}) is None
    command = normalize_draw_command({"action": "add_note", "regionId": "r1", "text": "Planning", "eval": "bad", "token": "secret", "nodeId": {"id": "wrong"}})
    assert command == {"action": "add_note", "regionId": "r1", "text": "Planning"}
    assert len(normalize_draw_command({"action": "add_note", "text": "x" * 7000})["text"]) == 6000


def test_buffered_voice_prompt_preserves_original_clarification_and_parses_annotation_without_edit():
    context = {"agent_review": True, "spatialBoard": {"active": True, "selectedRegionId": "other", "pendingClarification": {"id": "q1", "regionId": "original"}}}
    prompt = astra_turn_system_prompt(context)
    assert "Never invent printer dimensions" in prompt
    assert "original" in prompt
    assert '"board_command"' in prompt
    result = parse_astra_turn_json(json.dumps({"speak": "Noted.", "board_command": {"action": "answer_clarification", "clarificationId": "q1", "printerModel": "P1S"}, "edit": {"instruction": "cut now", "apply_now": True}, "request_review": True}))
    assert result["board_command"]["clarificationId"] == "q1"
    assert result["edit"] is None
    assert result["request_review"] is False


def test_selected_model_cannot_queue_cad_edits_from_draw_planning():
    calls = []
    class FakeAI:
        model = "selected-model"
        def chat_json(self, system, content, **kwargs):
            calls.append((system, content))
            return {"answer": "I added a planning note.", "boardCommand": {"action": "add_note", "regionId": "r1", "text": "Split plan"}, "proposals": [{"prompt": "Execute split"}], "requestReview": True}, {}
    app = FastAPI()
    app.include_router(create_xr_agent_discussion_router(lambda: {"id": "test"}, lambda *args: FakeAI(), lambda *args: None, lambda *args: None))
    response = TestClient(app).post('/api/xr-agent/discuss', json={"question": "Add split note", "project_id": "test", "context": {"spatialBoard": {"active": True, "selectedRegionId": "r1"}}})
    assert response.status_code == 200
    result = response.json()
    assert result["proposals"] == []
    assert result["requestReview"] is False
    assert result["boardCommand"]["regionId"] == "r1"
    assert "never execute CAD" in calls[0][0]
