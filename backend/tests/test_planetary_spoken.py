from backend.engineering.gears import (
    _factor_planetary_ratio,
    planetary_reduction_program,
    planetary_stage_teeth,
)
from backend.services.design_service import (
    _looks_like_planetary_gear_assembly,
    _planetary_ratio_from_prompt,
)
from backend.services.spoken_prompt import collapse_repeated_spoken_prompt


def test_collapse_spoken_prompt_triple_header():
    raw = (
        "make a  plantry gear  with 1:20 ratio\n\n"
        "Spoken / transcribed prompt:\n"
        "make a  plantry gear  with 1:20 ratio\n\n"
        "Spoken / transcribed prompt:\n"
        "make a  plantry gear  with 1:20 ratio"
    )
    out = collapse_repeated_spoken_prompt(raw)
    assert out.lower().count("plantry") == 1
    assert "spoken / transcribed" not in out.lower()
    assert "1:20" in out


def test_plantry_typo_and_ratio():
    prompt = "make a plantry gear with 1:20 ratio"
    assert _looks_like_planetary_gear_assembly(prompt)
    assert _planetary_ratio_from_prompt(prompt) == 20.0
    assert _planetary_ratio_from_prompt("20:1 planetary gearbox") == 20.0


def test_planetary_20_is_two_stage_five_times_four():
    assert _factor_planetary_ratio(20) == [5, 4]
    zs, zp, zr = planetary_stage_teeth(5)
    assert zr == zs + 2 * zp
    assert abs(1 + zr / zs - 5) < 1e-9
    program = planetary_reduction_program(ratio=20)
    assert abs(float(program.meta["overall_ratio"]) - 20.0) < 1e-6
    assert len(program.meta["stages"]) == 2
    assert any(p.id == "s1_sun" for p in program.parts)
    assert any(p.id == "s2_ring" for p in program.parts)
