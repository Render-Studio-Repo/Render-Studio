import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import BackgroundTasks, HTTPException

from backend import main
from backend.services import prompt_history_service
from backend.services.ai_service import AIService
from backend.services.drawing_context import selected_geometry_context, sanitize_drawing_metadata
from backend.services.prompt_references import has_layout_sketch
from backend.services.cad_harness import format_context_packet


def canvas_image():
    return {"id": "drawing", "name": "Headset mount.png", "role": "canvas", "media_type": "image/png",
            "data_url": "data:image/png;base64,aGVsbG8=", "source_filename": "references/Canvas/Mount/canvas.json",
            "drawing_metadata": {"kind": "canvas", "title": "Mount", "width": 1200, "height": 800,
                                 "elements": [{"id": "top", "type": "text", "text": "Top View"},
                                              {"id": "arrow", "type": "arrow", "end": {"x": 614, "y": 445}}]}}


def test_drawing_survives_save_reuse_and_vision_cleaning(tmp_path):
    saved = prompt_history_service.persist_prompt_images(tmp_path, "prompt1", [canvas_image()], project_id="p")
    assert saved[0]["drawing_metadata"]["elements"][0]["text"] == "Top View"
    assert "data_url" not in saved[0]
    restored = prompt_history_service.hydrate_prompt_images(tmp_path, saved, prompt_id="prompt1", project_id="p")
    model = main.PromptImage.model_validate(restored[0])
    clean = AIService._clean_images([model.model_dump()])
    assert has_layout_sketch(clean)
    assert clean[0]["drawing_metadata"] == saved[0]["drawing_metadata"]
    content = AIService._openai_user_content(object(), "extend mount", clean)
    text = " ".join(p.get("text", "") for p in content)
    assert "Top View" in text and "614" in text and "headset" in text


def test_improve_receives_canvas_and_all_selected_geometry(monkeypatch, tmp_path):
    ai = Mock()
    ai._call_model.return_value = ('{"improved_prompt":"Extend the indicated mount in @face-1 and @face-2."}', {})
    monkeypatch.setattr(main, "_get_ai_for_user", lambda *a, **kw: ai)
    monkeypatch.setattr(main, "_require_project_read", lambda *a: tmp_path)
    refs = [{"id": "face1", "type": "face", "token": "@face-1", "filename": "mount.glb", "face_index": 12, "normal": [0, 1, 0]},
            {"id": "face2", "type": "face", "token": "@face-2", "face_indices": [25, 26], "filename": "mount.glb"},
            {"id": "edge", "type": "edge", "endpoints": [[0, 0, 0], [20, 0, 0]], "filename": "mount.glb"},
            {"id": "model", "type": "component", "filename": "mount.glb"}]
    body = main.ImprovePromptRequest(prompt="Extend the top-view box for the headset", mode="v2", target_mode="edit",
                                     base_filename="mount.glb", project_id="p", references=refs, images=[canvas_image()], use_context_lab=False)
    result = main.improve_cad_prompt(body, SimpleNamespace(state=SimpleNamespace()), {"id": "u"})
    assert "Extend" in result["improved_prompt"]
    args, kwargs = ai._call_model.call_args
    for detail in ("Top View", "@face-1", "@face-2", '"face_indices": [25, 26]', '"endpoints"', "mount.glb", "preserv"):
        assert detail.lower() in args[1].lower()
    assert kwargs["images"][0]["role"] == "canvas"


def test_renamed_canvas_never_runs_image_to_dxf(monkeypatch):
    ai = Mock()
    body = main.PromptRequest(prompt="extend mount", mode="v2", images=[canvas_image()], convert_images_to_drawing=True)
    assert main._with_image_generated_dxf_reference(body, ai, None) is body
    ai.generate_drawing_package_from_images.assert_not_called()


def test_empty_edit_stops_before_ai(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "_require_project_write", lambda *a: tmp_path)
    ai = Mock(side_effect=AssertionError("No AI call allowed"))
    monkeypatch.setattr(main, "_get_ai_for_prompt", ai)
    with pytest.raises(HTTPException) as err:
        main.prompt_cad("p", main.PromptRequest(prompt="extend mount", target_mode="edit"),
                        SimpleNamespace(state=SimpleNamespace()), BackgroundTasks(), {"id": "u"})
    assert err.value.status_code == 422
    ai.assert_not_called()


def test_canvas_or_document_cannot_become_edit_base():
    body = main.PromptRequest(prompt="extend", target_mode="edit", references=[
        {"id": "canvas", "type": "document", "filename": "canvas.json"},
        {"id": "fixture", "type": "component", "filename": "fixture.step", "mate_target": True},
        {"id": "face", "type": "face", "filename": "mount.glb"}])
    assert main._reference_base_filename(body) == "mount.glb"


def test_harness_receives_full_geometry_packet(tmp_path):
    selection = selected_geometry_context("mount.glb", [{"id": "edge", "type": "edge", "token": "@edge", "endpoints": [[0, 0, 0], [20, 0, 0]]}])
    text = format_context_packet({"selected_geometry_context": selection, "image_refs": [canvas_image()], "model_electronics": False}, tmp_path)
    assert '"endpoints"' in text and "@edge" in text and "Top View" in text


def test_all_eight_reference_images_reach_vision():
    images = [{**canvas_image(), "id": str(i), "name": f"canvas-sketch-{i}.png"} for i in range(8)]
    request = main.ImprovePromptRequest(prompt="Use all views", images=images)
    assert len(AIService._clean_images([img.model_dump() for img in request.images])) == 8


def test_numbered_links_and_board_description_survive_metadata_sanitize():
    meta = sanitize_drawing_metadata({
        "kind": "canvas",
        "description": "Left is assembled, right is exploded hardware.",
        "elements": [{
            "id": "l1", "type": "link", "linkNumber": 1, "fromId": "a", "toId": "b",
            "relation": "exploded view of the same bracket",
        }],
        "links": [{"id": "l1", "type": "link", "linkNumber": 1, "relation": "exploded view of the same bracket"}],
    })
    assert meta["description"].startswith("Left is assembled")
    assert meta["elements"][0]["linkNumber"] == 1
    assert meta["elements"][0]["relation"] == "exploded view of the same bracket"
    assert meta["links"][0]["relation"].startswith("exploded")
    guidance = selected_geometry_context("mount.glb", [])
    assert "Numbered dotted links" in guidance
    assert "LOGIC CHECK" in guidance


def test_canvas_extension_is_not_forced_into_central_span_lengthening():
    guidance = main._reference_edit_guidance("Extend the top-view box", [{"type": "face"}], [canvas_image()])
    assert "support/shelf" in guidance
    assert "insert extension in the central span" not in guidance


def test_canvas_edit_keeps_selected_model_measurements(monkeypatch, tmp_path):
    monkeypatch.setattr(main.cad_service, "list_project_files", lambda _: [])
    monkeypatch.setattr(main, "_component_specs", lambda *a: [{"stem": "mount", "size_mm": [100, 40, 60]}])
    monkeypatch.setattr(main, "_build_cad_reference_entries", lambda *a: [])
    monkeypatch.setattr(main, "_hydrate_prompt_url_documents", lambda prompt, refs: refs)
    body = main.PromptRequest(prompt="Look at my canvas and extend the mount", base_filename="mount.glb", target_mode="edit",
        images=[canvas_image()], references=[{"id": "model", "type": "component", "filename": "mount.glb"}], use_mcmaster_parts=False)
    context = main._slim_context("p", tmp_path, body)
    assert context["referenced_components"][0]["filename"] == "mount.glb"
    assert context["component_specs"][0]["size_mm"] == [100, 40, 60]


def test_faces_of_interest_survive_metadata_sanitize():
    meta = sanitize_drawing_metadata({
        "kind": "canvas",
        "interests": [{
            "id": "face1", "type": "face-mark", "interestKind": "face", "interestNumber": 1,
            "viewName": "Top", "action": "extrude", "direction": "up",
            "interestPrompt": "go out 45 mm and curve to fit a Meta Quest headset",
        }],
        "elements": [{
            "id": "face1", "type": "face-mark", "interestKind": "face", "interestNumber": 1,
            "viewName": "Top", "action": "extrude", "direction": "up",
            "interestPrompt": "go out 45 mm and curve to fit a Meta Quest headset",
        }],
    })
    assert meta["interests"][0]["interestKind"] == "face"
    assert meta["elements"][0]["interestPrompt"].startswith("go out 45 mm")
    assert meta["elements"][0]["direction"] == "up"
    guidance = selected_geometry_context("mount.glb", [])
    assert "faces/edges/views of interest" in guidance
    assert "FACES / EDGES / VIEWS / SPLITS of interest" in main.IMPROVE_CAD_CANVAS_REWRITE_RULES
