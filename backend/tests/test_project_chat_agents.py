"""Group chat can seat people and named agents."""

from pathlib import Path

from backend.services.project_chat_service import CHAT_AGENT_IDS, create_thread, mention_candidates


def test_mention_candidates_include_astra_and_grok(tmp_path: Path):
    rows = mention_candidates([])
    ids = {r["id"] for r in rows if r.get("type") == "agent"}
    assert "cad-bot" in ids
    assert "astra" in ids
    assert "grok-bot" in ids
    assert "render-agent" in ids
    assert "astra" in CHAT_AGENT_IDS


def test_create_thread_invites_agent(tmp_path: Path):
    user = {"id": "u1", "display_name": "Sam"}
    thread = create_thread(
        tmp_path,
        title="Clamp repair",
        user=user,
        kind="group",
        invite_agent_ids=["astra", "cursor-engineer"],
    )
    ids = {str(m.get("id")) for m in thread.get("members") or []}
    assert "astra" in ids
    assert "cursor-engineer" in ids
    assert any(m.get("is_agent") for m in thread["members"] if m.get("id") == "astra")
