"""OpenAI integration for CAD prompting."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from openai import OpenAI

from backend.config import settings
from backend.services.trace_log import add as trace_add

logger = logging.getLogger(__name__)

RESPONSES_ONLY_MODELS = {"gpt-5.5-pro", "gpt-5.5-pro-2026-04-23"}
PRO_MODELS = RESPONSES_ONLY_MODELS | {settings.openai_model_quality}

DESIGN_SYSTEM_PROMPT = """You are Render3D's design engine. You convert a natural-language request into an
EXACT, simulation-ready parametric model. Think like a mechanical engineer: compute real
dimensions and ratios; never approximate. Reply with ONE JSON object, no prose.

UNITS: millimetres everywhere. Frame: Z is up.

Two modes (often combined):
  - generative  : design a working mechanism from first principles (gears, escapements...).
  - replication : reproduce real hardware to spec (use the spec library; do not guess sizes).

Prefer GENERATORS (deterministic, guaranteed-correct) when they fit the request:
  generator = {{"kind":"enclosure","spec":"<spec_key>","options":{{...}}}}
      -> a dimensionally-exact two-piece case for a known board.
  generator = {{"kind":"gear_train","teeth":[z1,z2,...],"module":<mm>,"thickness":<mm>,
               "bore":<mm>,"material":"<mat>","drive_torque_nm":<n>}}
      -> a meshing involute spur-gear train with correct centre distances + joints.

Otherwise emit a "program" (a Feature Program) directly:
  program = {{
    "name": "...", "description": "...",
    "parts": [ {{"id":"part1","material":"pla","color":"#aabbcc",
                 "features":[ <feature>, ... ]}} ],
    "joints": [ {{"id":"j1","type":"revolute","parent":"world","child":"part1",
                  "anchor":[x,y,z],"axis":[0,0,1],"limits":[lo,hi]}} ]
  }}

FEATURE ops (each may set combine: "new"|"add"|"cut"|"intersect", at:[x,y,z], rotation:[rx,ry,rz] deg):
  box{{size:[x,y,z]}} | cylinder{{radius|diameter,height}} | cone{{bottom_radius,top_radius,height}} |
  sphere{{radius}} | torus{{major_radius,minor_radius}} |
  extrude{{profile:[[x,y],...],height}} | revolve{{profile:[[r,z],...],angle}} |
  loft{{sections:[{{z,radius|width,height|profile}}]}} |
  hole{{diameter,through:true|false,depth}} (cut) |
  fillet{{radius,edges:"all"|"vertical"|"top"|"bottom"}} |
  chamfer{{length,edges:...}} | shell{{thickness,openings:"top"}} |
  pattern{{arrange:"linear"|"polar",count,spacing:[dx,dy,dz]|angle,radius,of:{{<feature>}}}}
Engineered ops:
  spur_gear{{module,teeth,thickness,bore,pressure_angle}} |
  escape_wheel{{teeth,tip_radius,thickness,bore}} |
  enclosure_for_spec{{spec,piece:"base"|"lid"}} | board_blank{{spec,include_components}}

JOINTS make it simulation-ready: revolute/continuous (axis), prismatic, fixed. Put a joint at
every moving interface. Add drive_torque_nm on a powered joint.

AVAILABLE SPECS (use exact keys for replication): {specs}
MATERIALS: {materials}

Return JSON:
{{"intent":"generative|replication|hybrid","message":"<one sentence>",
  "specs_used":[...],"filename":"<name>","generator":<obj or null>,"program":<obj or null>}}
Exactly one of generator/program must be non-null."""

SYSTEM_PROMPT = """CAD assistant. Reply ONLY with JSON:
{"message":"…","actions":[{"op":"…","id":"a","result":true}],"filename":"part.glb"}

Ops:
- Primitives: box(extents), cylinder(radius,height), sphere(radius)
- vase(height, outer_radius, wall, taper) — ONE revolved hollow plant vase. Never stack two cylinders or boolean a vase from parts.
- boolean(a,b,operation), use_base (required when editing an uploaded file)
- hole_at_point(at_refs, diameter_mm, through) — one through-hole at the center between refs (e.g. ["face-1","face-2"]); set holes_per_ref:true for separate holes at each ref
- paint_faces(color, at_refs | face_indices | face_index_from+face_index_to) — per-face color on current mesh
- set_material(color) — solid color for entire mesh

Colors: "white", "black", "#ffffff", or [r,g,b] 0–1.

When user picks @face-N refs or context lists face_index, use paint_faces with at_refs or face_index_from/to.
Example edit existing GLB: [{"op":"use_base","id":"b"},{"op":"paint_faces","id":"p","face_index_from":8,"face_index_to":14,"color":"white","result":true}]

Meters. Max 8 ops. Exactly one action with result:true."""


class AIService:
    def __init__(self, model: str | None = None) -> None:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.")
        self.client = OpenAI(api_key=settings.openai_api_key, timeout=90.0)
        self.model = model or settings.openai_model

    def generate_cad_plan(
        self,
        user_prompt: str,
        project_context: dict[str, Any] | None = None,
        trace_id: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        context_text = ""
        if project_context:
            context_text = f"\nContext: {json.dumps(project_context, separators=(',', ':'))}"

        raw, call_trace = self._call_model(SYSTEM_PROMPT, f"{user_prompt}{context_text}", trace_id=trace_id)
        try:
            plan = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {raw[:500]}") from exc
        call_trace["parsed_ok"] = True
        call_trace["action_count"] = len(plan.get("actions", []))
        return plan, call_trace

    def generate_design(
        self,
        user_prompt: str,
        project_context: dict[str, Any] | None = None,
        trace_id: str | None = None,
        repair_note: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Generate a Feature Program (or generator directive) for a request.

        ``repair_note`` carries build/DFM errors from a previous attempt so the
        model can self-correct.
        """
        from backend.physics.materials import list_materials
        from backend.specs.registry import available_specs

        system = DESIGN_SYSTEM_PROMPT.format(
            specs=", ".join(available_specs()) or "(none)",
            materials=", ".join(list_materials()),
        )
        parts = [user_prompt]
        if project_context:
            parts.append(f"\nContext: {json.dumps(project_context, separators=(',', ':'))}")
        if repair_note:
            parts.append(
                "\nThe previous attempt FAILED. Fix it and return a corrected JSON object.\n"
                f"Error/feedback:\n{repair_note}"
            )
        raw, call_trace = self._call_model(system, "".join(parts), trace_id=trace_id)
        try:
            design = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {raw[:500]}") from exc
        call_trace["parsed_ok"] = True
        call_trace["intent"] = design.get("intent")
        return design, call_trace

    def _reasoning_param(self) -> dict[str, Any] | None:
        model = self.model
        if model in PRO_MODELS or model.startswith("gpt-5.5-pro"):
            return None
        effort = settings.openai_reasoning_effort
        if effort and effort != "none":
            return {"reasoning": {"effort": effort}}
        return {"reasoning": {"effort": "low"}}

    def _call_model(self, system_prompt: str, user_content: str, trace_id: str | None = None) -> tuple[str, dict[str, Any]]:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

        model = self.model
        use_responses = model in RESPONSES_ONLY_MODELS or model.startswith("gpt-5.5-pro") or model.startswith("gpt-5.5")
        t0 = time.perf_counter()
        trace: dict[str, Any] = {
            "model": model,
            "api": "responses",
            "prompt_preview": user_content[:200],
            "reasoning": settings.openai_reasoning_effort,
        }
        extra = self._reasoning_param() or {}

        try:
            trace_add("info", f"OpenAI Responses → {model}", trace_id=trace_id, data=trace)
            response = self.client.responses.create(
                model=model,
                input=messages,
                text={"format": {"type": "json_object"}},
                **extra,
            )
            text = response.output_text or ""
            trace["duration_ms"] = (time.perf_counter() - t0) * 1000
            trace["raw_preview"] = text[:4000]
            trace_add("info", f"OpenAI OK ({trace['duration_ms']:.0f}ms)", trace_id=trace_id, data=trace)
            if text:
                return text, trace
            raise RuntimeError("Empty response from OpenAI")
        except Exception as exc:
            trace["duration_ms"] = (time.perf_counter() - t0) * 1000
            trace["error"] = str(exc)
            trace_add("error", f"OpenAI failed: {exc}", trace_id=trace_id, data=trace)
            if model in RESPONSES_ONLY_MODELS or model.startswith("gpt-5.5-pro"):
                raise RuntimeError(f"OpenAI error ({model}): {exc}") from exc
            try:
                completion = self.client.chat.completions.create(
                    model=model,
                    messages=messages,
                    response_format={"type": "json_object"},
                )
                text = completion.choices[0].message.content or "{}"
                trace["api"] = "chat.completions"
                trace["duration_ms"] = (time.perf_counter() - t0) * 1000
                trace["raw_preview"] = text[:4000]
                return text, trace
            except Exception as exc2:
                raise RuntimeError(f"OpenAI API error: {exc2}") from exc2
