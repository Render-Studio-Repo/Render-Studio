from backend.services import render_agent_control_index as controls


def test_robotics_controls_are_compact_and_searchable():
    hits = controls.search("How do I immediately kill teleop and an emote?")
    assert hits[0]["key"] == "robotics.kill"
    assert "only immediate physical assistant action" in hits[0]["action"]


def test_control_context_only_loads_for_relevant_questions():
    assert controls.context_block("How do I fillet this bracket?") == ""
    block = controls.context_block("Where is the robot camera button?")
    assert "robotics.open_cameras" in block
    assert len(block) < 5000
