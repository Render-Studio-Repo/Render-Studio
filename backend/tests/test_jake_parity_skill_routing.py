from backend.services.skills_service import resolve_prompt_skills


def test_printability_request_routes_dfam_skill():
    resolved = resolve_prompt_skills(None, prompt="Check wall thickness, overhangs, and printability")
    assert "dfam-check" in resolved


def test_shop_drawing_request_routes_engineering_drawing_skill():
    resolved = resolve_prompt_skills(None, prompt="Make a dimensioned engineering drawing with a title block")
    assert "engineering-drawing" in resolved
