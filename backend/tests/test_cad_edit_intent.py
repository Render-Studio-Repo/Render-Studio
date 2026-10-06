import json

from backend import main
from backend.services.cad_edit_intent import recent_design_context, resolve_selected_edit_intent
from backend.services.cad_harness import format_context_packet


def test_selected_edit_intent_distinguishes_edit_new_and_ambiguity():
    assert resolve_selected_edit_intent("Make this selected bracket 20 mm wider").kind == "edit"
    assert resolve_selected_edit_intent("Drill two holes in it").kind == "edit"
    assert resolve_selected_edit_intent(
        "Create a very simple two-piece holder based on the selected cradle mount. "
        "Replace the complicated multi-part design with a clamp body and broad curved cradle."
    ).kind == "edit"
    assert resolve_selected_edit_intent("Create a separate mounting bracket for it").kind == "new"
    assert resolve_selected_edit_intent("Create a new mounting bracket for it").kind == "new"
    assert resolve_selected_edit_intent("Create a mounting bracket with four holes").kind == "clarify"
    assert resolve_selected_edit_intent("A mounting bracket with four holes").kind == "clarify"
    assert resolve_selected_edit_intent("Change this part and create another one").kind == "clarify"


def test_leading_explicit_new_design_wins_over_existing_concept_comparisons():
    prompt = (
        "Create a NEW compact VibeCAD prototype of the rotating base for the complete OpenArm 2.0 two-arm frame. "
        "Simplify the existing project concept into a low-profile, bench-bolted turntable. "
        "Eliminate the tall stand, retain the NEMA 34 belt-drive concept, and inspect existing project STEP "
        "geometry as design context, not verified mating geometry."
    )
    decision = resolve_selected_edit_intent(prompt)
    assert decision.kind == "new"
    assert decision.reason == "request opens with an explicit new-object instruction"


def test_bounded_engine_preamble_keeps_explicit_new_openarm_request_new():
    prompt = (
        "Using Jake, create a NEW simplified rotating-base assembly based on "
        "vibecad/OpenArm_2_0_Official_On_Rotating_Base.glb and its companion STEP. "
        "Preserve the complete OpenArm 2.0 assembly. Replace the bulky enclosure with a compact rotating plate."
    )
    assert resolve_selected_edit_intent(prompt).kind == "new"
    assert resolve_selected_edit_intent(
        "Using an excessively long and invalid engine name that is deliberately over forty characters, "
        "create a NEW bracket and change this selected model"
    ).kind == "clarify"


def test_selected_component_existing_base_corrects_stale_new_mode(tmp_path):
    filename = "vibecad/robot.glb"
    body = main.PromptRequest(
        prompt="Revise the existing selected model by adding only the named rig",
        base_filename=filename,
        target_mode="new",
        references=[main.GeoReference(
            id="selection-current:p1",
            type="component",
            token="@selected",
            filename=filename,
        )],
    )
    resolved = main._with_reference_edit_base(tmp_path, body, "trace")
    assert resolved.target_mode == "edit"


def test_selected_component_explicit_new_object_remains_new(tmp_path):
    filename = "vibecad/robot.glb"
    body = main.PromptRequest(
        prompt="Create a new separate mounting bracket for the selected model",
        base_filename=filename,
        target_mode="new",
        references=[main.GeoReference(
            id="selection-current:p1",
            type="component",
            token="@selected-object",
            filename=filename,
        )],
    )
    resolved = main._with_reference_edit_base(tmp_path, body, "trace")
    assert resolved.target_mode == "new"


def test_recent_context_is_bounded_to_selected_model_and_reaches_shared_packet(tmp_path):
    entries = [
        {"id": "current", "kind": "cad", "status": "running", "prompt": "current", "base_filename": "arm.step"},
        {"id": "p3", "kind": "cad", "success": True, "prompt": "Add two mounting holes", "base_filename": "arm.step", "filename": "arm.glb", "target_mode": "edit"},
        {"id": "p2", "kind": "cad", "success": True, "prompt": "Build a table", "base_filename": "table.step", "filename": "table.glb", "target_mode": "new"},
        {"id": "p1", "kind": "cad", "success": True, "prompt": "Make this arm longer", "base_filename": "arm.step", "filename": "arm.glb", "target_mode": "edit"},
    ]
    (tmp_path / "prompt_history.json").write_text(json.dumps({"entries": entries}))
    context = recent_design_context(tmp_path, base_filename="arm.step", current_prompt_id="current")
    assert [row["prompt"] for row in context] == ["Make this arm longer", "Add two mounting holes"]
    packet = format_context_packet({"recent_design_context": context}, tmp_path)
    assert "Recent relevant CAD requests" in packet
    assert "Make this arm longer" in packet
    assert "Build a table" not in packet
