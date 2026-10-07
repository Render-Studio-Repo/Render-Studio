"""VibeCAD-style tool-calling agent for Render Studio generation.

Ports the Mac app agent pattern (inspect → design review → create/edit → repair)
onto Render Studio's BYOK LLM + FreeCADCmd / build123d workers.

Jake Mode 2.0 (``mode=v2``) is untouched.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable, Optional

from backend.services.ai_service import AIService, cad_authoring_max_tokens
from backend.services.prompt_language import with_multilingual_prompt_rule
from backend.services.parts_sourcing_policy import UNRESOLVED_PURCHASED_INTERFACE_RULES
from backend.services.trace_log import add as trace_add

ProgressCb = Optional[Callable[[dict[str, Any]], None]]
CancelCb = Optional[Callable[[], bool]]
UsageCb = Optional[Callable[[list[dict[str, Any]]], None]]

# Adapted from upstream VibeCADProvider.VIBECAD_SYSTEM_INSTRUCTIONS + build123d TOOL_SPEC.
AGENT_SYSTEM = with_multilingual_prompt_rule("""You are VibeCAD, a principal mechanical design engineer operating Render Studio's
CAD engines through the supplied tools. The current user message is the authority.
A simple solid that only resembles the request is a failure.

You do NOT write free-form CAD source as your final answer. You call tools by
returning a single JSON object each turn:

{"tool":"<name>","args":{...}}

Available tools:
1) conversation.review_design
   args: {customer_intent: str, design_draft: str}
   Call once before the first CAD write for a substantial NEW design.
   If the verdict is revise, you may call it one more time with an updated draft,
   then create_model. Do not loop on review.

2) core.inspect
   args: {scope: "document"|"selection"|"object"|"domain"|"program"|"api"|"image",
          target?: str, path?: str, attach?: bool}
   Read live facts. Start with document or program. Never guess.

3) build123d.inspect_model
   args: {}
   Read the current model's source, parameters, expected_outputs, and worker
   geometry facts (volume, bounds, vertex/face counts per named solid).

4) build123d.set_parameters
   args: {parameters: object}
   Replace driving dimensions and rebuild the current source.

5) core.capture_view_screenshot
   args: {camera?: "iso"|"top"|"front"}
   Capture the published viewport GLB (iso/top/front). Use after a successful create.

6) freecad.create_model
   args: {model_name, source, parameters, expected_outputs, input_objects?}
   FreeCADCmd Part/PartDesign macro (mm). Staged catalog STEPs arrive as `inputs[alias]`
   (Part objects, already unit-corrected to millimetres). Mate with Placement, then
   put printed solids AND placed hardware in `result` so one STEP/GLB is the assembly.

7) build123d.create_model
   args: {model_name, source, parameters, expected_outputs, input_objects?}
   `source` is complete build123d Python (mm) receiving params/inputs and assigning
   result: dict[str, Shape] with keys matching expected_outputs.

8) build123d.edit_source / freecad.edit_source
   args: {source, parameters?, expected_outputs?, reason}

9) finish
   args: {summary: str}
   Call only after a successful create/edit that passed inspect + viewport capture.

10) mcmaster.fetch_part
   args: {part_number: str}
   Download a McMaster-Carr STEP onto the studio server when a listed PN is missing.
   Do not ask the user to save CAD to Downloads.

11) catalog.search
   args: {query: str, fallback?: bool}
   After official manufacturer STEP lookup fails, search Parts Catalog SECOND.
   Returns source IDs, STEP URLs and available documentation; fallback searches
   other sources only after the catalog has no match.

12) catalog.import
   args: {query: str, source_id: str}
   Import a catalog.search candidate's STEP into this project. Use the returned
   filename in input_objects, inspect units/dimensions, then place the complete
   component in the assembly. Preserve its source in parts_list. Never guess IDs.

Rules:
- For new substantial designs: write the proposal in review_design first.
- Design review is a short brief, not the job: at most two review_design calls,
  then create_model. Fold findings into the source. The host will not reject
  create_model after those two reviews — construction is required.
- After a successful create, the host inspects worker named-solid facts and captures
  the viewport. If the tool result includes a repair_note, call edit_source and rebuild.
  Do not call Jake cadgen inspect/snapshot.
- Resolve ordinary engineering choices with defensible defaults.
- A failed tool is a stop condition — diagnose and repair the smallest cause.
- Prefer build123d.create_model for hoppers, funnels, vessels, bins, and new solids
  (revolve or loft one silhouette). Use freecad.create_model for PartDesign/sketcher
  or when mating catalog STEP hardware in a FreeCAD document.
- Inspect project_files (STEP/GLB) before creating. Keep existing designed parts in place —
  do not re-import or rescale them into a new compound. Author only the new solid; the host
  FreeCAD kernel places it beside live parts or merges it into the live assembly STEP.
  Catalog hardware still uses input_objects (`hw_*` aliases) mated in millimetres into THIS
  new part — do not leave unsized fasteners stacked at the origin. To move a file without
  rewriting it, write r3d_placements.json:
  {"moves":[{"filename":"part.step","translation":[x,y,z],"rotation_deg":[rx,ry,rz],"scale":1}]}
- Honor the CAD brief McMaster parts list. Mate existing STEPs (hw_* aliases); do not
  reprint screws. Skip mcmaster.fetch_part when `{pn}.glb` or `{pn}.step` is already
  on disk. After importing catalog parts, write r3d_mcmaster_used.json.
- Mechanisms (hinge, lid, arm, gripper, slider, robot): return a `joints` array in the
  authoring JSON and/or write <model_stem>.joints.json beside the STEP. Types: fixed, revolute, slider, cylindrical, ball, distance, parallel, perpendicular, angle, rack_pinion, screw, gears, belt.
  parent/child must match `result` keys. The host embeds portable joint metadata in STEP; the Fusion import script creates native joints.
- Return top-level parts_list with one row per unique sourced product purchase URL and the total required quantity. Keep datasheets in docs; never reuse a reference robot URL for its subparts or list every modeled terminal/washer as another purchase. Keep fabricated bodies in the assembly inventory, and unsourced requirements in follow-up questions; all requested geometry still belongs in the assembly.
- Never claim verification you did not perform.
- Millimetres everywhere.
- Never reference studio internals (`WORKER`, `_run_worker`, uvicorn). The worker
  already executes your `source`; just assign `result`.

Photos and drawings:
- Read attached files WITH the prompt. canvas-sketch / line drawings explain spatial intent
  (arrows, hanging off, beside, offset). They are not photos of the finished part.
- Photos of extrusion, rail, frame, or hardware are mate TARGETS. Connect as the prompt +
  canvas show (often cantilevered / off the side). Do not sit the motor on top of the extrusion
  unless the prompt and sketch say on-top.
- Product photos of the thing to make: match silhouette, proportions, hole patterns of THAT object.
- When DXF / drawing context lists a filename, that file is on disk in the worker cwd.
  Author the part from the drawing directly; do not replace a dimensioned drawing with a
  random catalog look-alike. Required assembly hardware is separate: import fetched McMaster
  STEPs from the CAD brief / parts list.
  Set a module-level `dxf_filename = "vision-reference.dxf"` (or the listed readable name).
  build123d: `from build123d import import_dxf` then reconstruct 3D from layers/polylines
  (outer profiles, holes, pockets). A whole-file import_dxf()+make_face()+extrude() is only
  for an explicit flat plate. `import ezdxf` / `from pathlib import Path` are allowed.
  FreeCAD: importDXF.insert(dxf_filename, doc.Name) then convert wires to solids.
- Do not invent a box that only resembles the photo or drawing.

Hopper / vessel / thin-shell (required):
- Model hoppers, funnels, bins, and tanks as one outer silhouette, then revolve or loft
  (`Pos(0,0,z)*Circle(r)` stations). Do NOT fuse centered Cylinder/Cone with .translate((0,0,z))
  — that drops the cone wall and leaves seam ribs.
- Every Cylinder/Cone/Box stacked on Z must use align=(Align.CENTER, Align.CENTER, Align.MIN).
- If inputs["selected_object"] (or another STEP alias) is provided, that value is
  already a Shape. Edit it. Do not import_step() it again or replace a linked hopper
  with a new primitive. `from build123d import *` does not define Shape; the worker does.
- Assign realistic material finishes per named part; infer plausible material from function when unspecified. Preserve explicit user/reference colours, authored neutral metals, white paint, textures and transparency. Use srgb("#hex") on leaf solids (aluminum #c0c6cc, steel #8a939d, rubber #303438, brass #c4a574, POM #d9d3c7). Identical parts/materials share a finish. Unknown parts use neutral aluminum; never random, index, or rainbow palettes. Assembled and exploded outputs must share the same material assignments and stable part labels; only transforms change.
""")
AGENT_SYSTEM += "\n\n" + UNRESOLVED_PURCHASED_INTERFACE_RULES

REVIEW_SYSTEM = """You are VibeCAD's independent principal mechanical design reviewer.

Review the supplied customer intent and design draft before CAD construction.
Return JSON only:
{
  "verdict": "ready"|"revise",
  "summary": "...",
  "strengths": ["..."],
  "findings": [
    {
      "severity": "blocking"|"major"|"minor",
      "category": "requirements"|"architecture"|"geometry"|"interfaces"|"mechanisms"|"loads"|"materials"|"manufacturing"|"tolerances"|"assembly"|"safety"|"verification",
      "issue": "...",
      "consequence": "...",
      "required_change": "..."
    }
  ]
}

Mark blocking when construction should not start. Use revise when any blocking or
major finding remains. Be concise and actionable. Do not author geometry.

Blocking geometry (always flag):
- Hopper/funnel/vessel built by stacking Cylinder/Cone without Align.MIN, or Cone.translate
  treating z as the base. Require a revolved/lofted silhouette instead.
- Edit of a selected STEP that ignores inputs["selected_object"] and rebuilds a primitive.
"""


def _progress(cb: ProgressCb, stage: str, pct: int, label: str) -> None:
    if cb:
        cb(
            {
                "stage": stage,
                "pct": pct,
                "label": label,
                "thinking": label,
                "pipeline": "vibecad",
                "activity": [{"text": label, "stage": stage}],
            }
        )


def _strip_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start : end + 1]
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("expected JSON object")
    return data


def _parse_tool_call(text: str) -> tuple[str, dict[str, Any]]:
    data = _strip_json(text)
    # Accept several shapes the model might emit
    if "tool" in data:
        return str(data["tool"]), dict(data.get("args") or data.get("arguments") or {})
    if "name" in data and ("arguments" in data or "args" in data):
        return str(data["name"]), dict(data.get("arguments") or data.get("args") or {})
    # Legacy one-shot create payload → treat as create_model
    if "source" in data and "expected_outputs" in data:
        return "auto.create_model", data
    raise ValueError("response is not a tool call JSON")


class VibeCADAgent:
    """Multi-turn tool agent for VibeCAD generation."""

    def __init__(
        self,
        *,
        project_path: Path,
        prompt: str,
        context: dict[str, Any],
        ai: AIService,
        trace_id: Optional[str] = None,
        images: Optional[list[dict[str, Any]]] = None,
        previous_source: Optional[str] = None,
        previous_source_name: Optional[str] = None,
        cancel_check: CancelCb = None,
        progress_callback: ProgressCb = None,
        usage_callback: UsageCb = None,
        max_turns: int = 200,
        prefer_freecad: bool = False,
        skills: list[str] | None = None,
    ) -> None:
        self.project_path = Path(project_path)
        self.prompt = prompt
        self.context = context or {}
        self.ai = ai
        self.trace_id = trace_id
        self.images = images
        self.previous_source = previous_source
        self.previous_source_name = previous_source_name
        self.cancel_check = cancel_check
        self.progress_callback = progress_callback
        self.usage_callback = usage_callback
        self.max_turns = max(1, int(max_turns))
        self.prefer_freecad = prefer_freecad
        self.skills = [str(s).strip().lower() for s in (skills or []) if str(s).strip()]
        if "vibecad" not in self.skills:
            self.skills.insert(0, "vibecad")
        try:
            from backend.services.skills_service import get_skill_dir

            get_skill_dir("vibecad")
        except Exception:
            pass
        self.ai_traces: list[dict[str, Any]] = []
        self.messages: list[str] = []
        self.state: dict[str, Any] = {
            "reviewed": False,
            "review_passes": 0,
            "review_exhausted": False,
            "engine": None,
            "model_name": None,
            "source": previous_source,
            "parameters": {},
            "expected_outputs": [],
            "input_objects": {},
            "last_error": None,
            "published": None,
            "last_artifacts": None,
            "worker_result": None,
        }
        try:
            cap = float((context or {}).get("budget_usd")) if (context or {}).get("budget_usd") is not None else None
        except (TypeError, ValueError):
            cap = None
        self.budget_usd = cap if cap is not None and cap > 0 else None

    def _spent_usd(self) -> float:
        total = 0.0
        for row in self.ai_traces:
            try:
                total += float(row.get("cost_usd") or 0)
            except (TypeError, ValueError):
                continue
        return total

    def _budget_reached(self) -> bool:
        if self.budget_usd is None:
            return False
        return self._spent_usd() >= self.budget_usd

    def _sync_usage(self) -> None:
        if self.usage_callback and self.ai_traces:
            self.usage_callback(list(self.ai_traces))

    def _canceled(self) -> bool:
        return bool(self.cancel_check and self.cancel_check())

    def _system_prompt(self) -> str:
        from backend.services.skills_service import build_skills_prompt

        block = build_skills_prompt(self.skills, compact=True, dialect="vibecad")
        text = AGENT_SYSTEM if not block else f"{AGENT_SYSTEM}\n\n{block}"
        if self.prefer_freecad:
            text += (
                "\n\nFreeCADCmd is available on this host (Mac VibeCAD engine). "
                "Prefer freecad.create_model for new documents and catalog STEP mating. "
                "Use build123d.create_model when the design is a build123d revolve/loft/hopper."
            )
        return text

    def _call(self, system: str, user: str, *, json_response: bool = True) -> dict[str, Any]:
        text, trace = self.ai._call_model(
            system,
            user,
            trace_id=self.trace_id,
            images=self.images,
            max_tokens=cad_authoring_max_tokens(self.ai.model),
            json_response=json_response,
            allow_truncated=False,
        )
        if isinstance(trace, dict):
            self.ai_traces.append(trace)
            self._sync_usage()
        return _strip_json(text) if json_response else {"text": text}

    def _inspect(self, scope: str = "document", *, target: str = "", attach: bool = False) -> dict[str, Any]:
        from backend.services.freecad_engine import freecad_status
        from backend.services.vibecad_gates import inspect_worker_model

        status = freecad_status()
        files = []
        dxf_files = []
        scan = [self.project_path]
        lib = self.project_path / "mcmaster_library"
        if lib.is_dir():
            scan.append(lib)
        for folder in scan:
            for p in sorted(folder.iterdir())[:80]:
                suffix = p.suffix.lower()
                if suffix in {".step", ".stp", ".glb", ".stl", ".py", ".json"}:
                    try:
                        rel = str(p.relative_to(self.project_path))
                    except ValueError:
                        rel = p.name
                    files.append(rel)
                elif suffix == ".dxf" and not p.name.endswith(".ezdxf.dxf"):
                    dxf_files.append(p.name)
        image_names = [
            str(img.get("name") or img.get("id") or "image")
            for img in (self.images or [])[:8]
            if isinstance(img, dict)
        ]
        worker = inspect_worker_model(self.state.get("worker_result"))
        current = {
            "model_name": self.state.get("model_name"),
            "engine": self.state.get("engine"),
            "has_source": bool(self.state.get("source")),
            "parameters": self.state.get("parameters") or {},
            "expected_outputs": self.state.get("expected_outputs") or [],
            "last_error": self.state.get("last_error"),
            "published": self.state.get("published"),
        }
        if scope == "program":
            return {
                "scope": "program",
                "source": (self.state.get("source") or "")[:12000],
                "parameters": self.state.get("parameters") or {},
                "expected_outputs": self.state.get("expected_outputs") or [],
                "input_objects": self.state.get("input_objects") or {},
            }
        if scope == "object":
            return {"scope": "object", "target": target, "inspect_model": worker, "current": current}
        if scope == "domain":
            return {"scope": "domain", "freecad": status, "engine": self.state.get("engine") or "build123d"}
        if scope == "api":
            return {
                "scope": "api",
                "tools": [
                    "core.inspect",
                    "build123d.inspect_model",
                    "build123d.create_model",
                    "build123d.edit_source",
                    "build123d.set_parameters",
                    "core.capture_view_screenshot",
                    "conversation.review_design",
                    "finish",
                ],
            }
        if scope == "image":
            out = {"scope": "image", "attached_images": image_names, "target": target}
            if attach:
                out["attached"] = True
            return out
        if scope == "selection":
            selected = (self.context or {}).get("base_filename") or (self.context or {}).get("selected")
            return {"scope": "selection", "selected": selected, "input_objects": self.state.get("input_objects")}
        return {
            "scope": "document",
            "freecad": status,
            "prefer_freecad": self.prefer_freecad and status.get("available"),
            "project_files": files,
            "dxf_files": dxf_files,
            "attached_images": image_names,
            "has_previous_source": bool(self.previous_source),
            "previous_source_name": self.previous_source_name,
            "current_model": current,
            "inspect_model": worker,
        }

    def _review(self, customer_intent: str, design_draft: str) -> dict[str, Any]:
        from backend.services.vibecad_gates import (
            MAX_DESIGN_REVIEW_PASSES,
            review_construct_unlocked,
            review_has_blocking,
        )

        if review_construct_unlocked(self.state) and isinstance(self.state.get("review"), dict):
            cached = dict(self.state["review"])
            cached["construct_anyway"] = True
            cached["summary"] = (
                str(cached.get("summary") or "")
                + " Review budget spent — call create_model now."
            ).strip()
            return cached

        _progress(self.progress_callback, "brief", 26, "VibeCAD · independent design review…")
        user = (
            f"Customer intent:\n{customer_intent.strip()}\n\n"
            f"Design draft:\n{design_draft.strip()}\n"
        )
        try:
            from backend.services.skills_service import build_skills_prompt

            review_system = REVIEW_SYSTEM
            block = build_skills_prompt(self.skills, compact=True, dialect="vibecad")
            if block:
                review_system = f"{REVIEW_SYSTEM}\n\n{block}"
            result = self._call(review_system, user, json_response=True)
        except Exception as exc:
            result = {
                "verdict": "revise",
                "summary": f"Design review failed ({exc}). Proceed to create_model with a conservative draft.",
                "strengths": [],
                "findings": [
                    {
                        "severity": "major",
                        "category": "verification",
                        "issue": f"Independent design review could not complete: {exc}",
                        "consequence": "Fold a conservative interpretation into CAD source.",
                        "required_change": "Call create_model with a complete source now.",
                    }
                ],
            }
        if not isinstance(result, dict):
            result = {"verdict": "revise", "summary": "Reviewer returned no JSON.", "findings": []}
        passes = int(self.state.get("review_passes") or 0) + 1
        self.state["review_passes"] = passes
        self.state["reviewed"] = True
        self.state["review"] = result
        if passes >= MAX_DESIGN_REVIEW_PASSES:
            self.state["review_exhausted"] = True
        # A revise verdict is not a CAD tool failure — do not send the agent
        # into edit_source repair before any source exists.
        if str(self.state.get("last_error") or "").startswith("Design review blocked"):
            self.state["last_error"] = None
        if review_has_blocking(result) and not self.state.get("review_exhausted"):
            result = dict(result)
            result["next"] = "revise_draft_once_then_create_model"
        else:
            result = dict(result)
            result["next"] = "create_model"
            result["construct_anyway"] = bool(self.state.get("review_exhausted") and review_has_blocking(result))
        return result

    def _gate_published(self, published: dict[str, Any], source: str) -> dict[str, Any]:
        """Worker inspect + viewport capture review (VibeCAD kernel, not Jake cadgen)."""
        from backend.services.vibecad_gates import run_post_publish_visual_gate
        from backend.services.assembly_motion import motion_authoring_error
        from backend.services.cad_harness import load_harness_joints
        stem = str(Path(published['step']).with_suffix(''))
        rows = self.state.get('joints')
        if rows is None: rows = load_harness_joints(self.project_path, stem=stem)
        error = motion_authoring_error(self.prompt, rows)
        if error:
            self.state['last_error'] = error
            self.state['published'] = None
            return {'ok': False, 'error': error, 'gate': 'motion_joints'}

        gate = run_post_publish_visual_gate(
            ai=self.ai,
            project_path=self.project_path,
            prompt=self.prompt,
            source=source,
            published=published,
            worker_result=self.state.get("worker_result") or published.get("worker_result"),
            progress_callback=self.progress_callback,
            trace_id=self.trace_id,
            cancel_check=self.cancel_check,
        )
        if gate.get("ai_trace") and isinstance(gate["ai_trace"], dict):
            self.ai_traces.append(gate["ai_trace"])
            self._sync_usage()
        if gate.get("ok") and not gate.get("skipped"):
            self.state["visual_gate"] = gate
            self.state["last_artifacts"] = published
            self.state["published"] = published
            return {"ok": True, "published": published, "visual_gate": gate}
        self.state["last_artifacts"] = published
        self.state["published"] = None
        self.state["last_error"] = str(
            gate.get("repair_note") or gate.get("error") or gate.get("reason") or "Visual gate rejected model"
        )
        self.state["visual_gate"] = gate
        return {
            "ok": False,
            "error": self.state["last_error"],
            "gate": gate.get("gate"),
            "repair_note": gate.get("repair_note"),
        }

    def _publish_step(self, stem: str, step_path: Path, source_name: str, meta: dict[str, Any]) -> dict[str, Any]:
        from backend.services import cad_service
        from backend.services.engine_layout import artifacts_for, project_rel

        arts = artifacts_for(
            self.project_path,
            "vibecad",
            stem,
            previous_source_name=self.previous_source_name,
            base_filename=str(self.context.get("base_filename") or "") or None,
        )
        arts.directory.mkdir(parents=True, exist_ok=True)
        glb_path = arts.glb_path
        compound_step = arts.step_path
        shutil_copy = __import__("shutil").copy2
        shutil_copy(step_path, compound_step)
        # Tessellate for the Three.js viewport
        try:
            cad_service.tessellate_step_to_glb(compound_step, glb_path)
        except Exception:
            # Fallback: trimesh direct load
            import trimesh

            scene = trimesh.load(str(compound_step), force="scene")
            if isinstance(scene, trimesh.Scene):
                mesh = trimesh.util.concatenate(tuple(scene.geometry.values()))
            else:
                mesh = scene
            mesh.export(str(glb_path))
        from backend.services.live_preview import emit_live_preview

        emit_live_preview(
            self.progress_callback,
            glb_path,
            label="VibeCAD · drawing in viewport…",
            stage="export",
            pct=80,
        )
        try:
            cad_service.polish_generated_cad_glb(glb_path, seed=stem, step_path=compound_step)
        except Exception:
            pass
        meta_path = arts.directory / f"{stem}.vibecad.json"
        meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        return {
            "source": source_name or arts.source_name,
            "step": project_rel(self.project_path, compound_step),
            "glb": project_rel(self.project_path, glb_path),
            "parts_glb": [],
        }

    def _run_freecad_create(self, args: dict[str, Any]) -> dict[str, Any]:
        from backend.services.freecad_engine import run_freecad_macro
        from backend.services.project_store import title_from_prompt
        from backend.services.vibecad_gates import assert_review_allows_create

        blocked = assert_review_allows_create(self.state, is_edit=bool(self.previous_source))
        if blocked:
            self.state["last_error"] = str(blocked.get("error") or "Design review gate")
            return blocked

        model_name = str(args.get("model_name") or title_from_prompt(self.prompt) or "VibeCAD Model")
        source = str(args.get("source") or "").strip()
        parameters = args.get("parameters") if isinstance(args.get("parameters"), dict) else {}
        expected = [str(x) for x in (args.get("expected_outputs") or []) if str(x).strip()]
        if not source:
            return {"ok": False, "error": "freecad.create_model requires source"}
        hopperish = bool(re.search(r"\b(hopper|funnel|vessel|bin|tank|gore|silo)\b", self.prompt, re.I))
        stacked_fc = bool(re.search(r"make(Cone|Cylinder)\s*\(", source))
        revolved_fc = bool(re.search(r"\b(revolve|makeRevolution|loft)\s*\(", source, re.I))
        if hopperish and stacked_fc and not revolved_fc:
            err = (
                "Hopper/funnel/vessel must use build123d.create_model with a revolved or lofted "
                "silhouette. FreeCAD makeCone/makeCylinder stacking drops the wall. "
                "Call build123d.create_model instead."
            )
            self.state["last_error"] = err
            return {"ok": False, "error": err, "engine": "freecad"}
        if not expected:
            expected = ["Part"]
        from backend.services import vibecad_service as vs

        input_objects = args.get("input_objects") if isinstance(args.get("input_objects"), dict) else {}
        input_objects = vs._auto_input_objects(
            self.project_path, self.context, input_objects, prompt=self.prompt
        )
        missing_project_refs = vs._missing_required_project_references(source, input_objects)
        if missing_project_refs:
            err = (
                "Verified project STEP reference(s) were staged but ignored: "
                + ", ".join(missing_project_refs)
                + ". Use their inputs aliases in the assembled result instead of "
                "creating a primitive stand-in."
            )
            self.state["last_error"] = err
            return {"ok": False, "error": err, "engine": "freecad"}
        from backend.services.engine_layout import artifacts_for, model_stem as _layout_stem

        if self.previous_source_name:
            stem = _layout_stem(self.previous_source_name) or "vibecad_model"
        else:
            stem = re.sub(r"[^a-zA-Z0-9_]+", "_", model_name).strip("_")[:48] or "vibecad_model"
            stem = _layout_stem(stem) or stem
        arts = artifacts_for(
            self.project_path,
            "vibecad",
            stem,
            previous_source_name=self.previous_source_name or f"{stem}.freecad.py",
            base_filename=str(self.context.get("base_filename") or "") or None,
        )
        from backend.services.vibecad_artifact_transaction import candidate_artifact_transaction

        with candidate_artifact_transaction(self.project_path, arts.directory, stem) as candidate:
            worker_inputs = vs._resolve_worker_inputs(self.project_path, input_objects)
            _progress(self.progress_callback, "step", 55, "VibeCAD · FreeCAD engine building…")
            result = run_freecad_macro(
                project_path=self.project_path,
                stem=stem,
                source=source,
                parameters=parameters,
                expected_outputs=expected,
                inputs=worker_inputs,
                cancel_check=self.cancel_check,
            ) or {}
            if not result.get("ok"):
                self.state["last_error"] = str(result.get("error") or "FreeCAD failed") + "\n" + str(
                    result.get("traceback") or ""
                )[:2500]
                return {"ok": False, "error": self.state["last_error"], "engine": "freecad"}

            arts.directory.mkdir(parents=True, exist_ok=True)
            source_name = (
                arts.source_name
                if arts.source_name.endswith(".freecad.py")
                else f"{arts.folder + '/' if arts.folder else ''}{stem}.freecad.py"
            )
            source_path = self.project_path / source_name
            source_path.parent.mkdir(parents=True, exist_ok=True)
            source_path.write_text(source.rstrip() + "\n", encoding="utf-8")
            self.state.update(
                {
                    "engine": "freecad",
                    "model_name": model_name,
                    "source": source,
                    "parameters": parameters,
                    "expected_outputs": expected,
                    "last_error": None,
                    "worker_result": result,
                    "joints": args.get("joints") if isinstance(args.get("joints"), list) else None,
                    "parts_list": args.get("parts_list"),
                }
            )
            step_path = Path(result["step_path"])
            published = self._publish_step(
                stem,
                step_path,
                source_name,
                {
                    "model_name": model_name,
                    "parameters": parameters,
                    "expected_outputs": expected,
                    "runtime": "vibecad-freecad",
                    "source": source_name,
                    "engine": "freecad",
                    "joints": args.get("joints") if isinstance(args.get("joints"), list) else None,
                    "parts_list": args.get("parts_list"),
                },
            )
            gated = self._gate_published(published, source)
            if not gated.get("ok"):
                return {**gated, "engine": "freecad"}
            candidate.accept()
            self.state["published"] = published
            self.state["last_artifacts"] = published
            return {
                "ok": True,
                "engine": "freecad",
                "published": published,
                "parts": result.get("parts"),
            }

    def _run_build123d_create(self, args: dict[str, Any]) -> dict[str, Any]:
        # Reuse the existing vibecad_service worker + publish helpers
        from backend.services import vibecad_service as vs
        from backend.services.project_store import title_from_prompt
        from backend.services.vibecad_gates import assert_review_allows_create

        blocked = assert_review_allows_create(self.state, is_edit=bool(self.previous_source))
        if blocked:
            self.state["last_error"] = str(blocked.get("error") or "Design review gate")
            return blocked

        model_name = str(args.get("model_name") or title_from_prompt(self.prompt) or "VibeCAD Model")
        source = str(args.get("source") or "").strip()
        parameters = args.get("parameters") if isinstance(args.get("parameters"), dict) else {}
        expected = [str(x) for x in (args.get("expected_outputs") or []) if str(x).strip()]
        input_objects = args.get("input_objects") if isinstance(args.get("input_objects"), dict) else {}
        input_objects = vs._auto_input_objects(
            self.project_path, self.context, input_objects, prompt=self.prompt
        )
        if not source or "result" not in source:
            return {"ok": False, "error": "build123d source must assign `result`"}
        lint = vs._lint_vibecad_source(source)
        if lint:
            self.state["last_error"] = lint
            return {"ok": False, "error": lint, "engine": "build123d"}
        missing_project_refs = vs._missing_required_project_references(source, input_objects)
        if missing_project_refs:
            err = (
                "Verified project STEP reference(s) were staged but ignored: "
                + ", ".join(missing_project_refs)
                + ". Use their inputs aliases in the assembled result instead of "
                "creating a primitive stand-in."
            )
            self.state["last_error"] = err
            return {"ok": False, "error": err, "engine": "build123d"}
        is_edit = bool(self.previous_source) or str(self.context.get("target_mode") or "").lower() == "edit"
        if is_edit and input_objects.get("selected_object") and "inputs[" not in source and "inputs.get" not in source:
            err = (
                "Selected STEP is staged as inputs['selected_object'] "
                f"({input_objects.get('selected_object')}). Use that Shape and edit it — "
                "do not rebuild a primitive stand-in."
            )
            self.state["last_error"] = err
            return {"ok": False, "error": err, "engine": "build123d"}
        if not expected:
            expected = ["Part"]
        from backend.services.engine_layout import artifacts_for, model_stem as _layout_stem

        if self.previous_source_name:
            stem = _layout_stem(self.previous_source_name) or "vibecad_model"
        else:
            stem = re.sub(r"[^a-zA-Z0-9_]+", "_", model_name).strip("_")[:48] or "vibecad_model"
            stem = _layout_stem(stem) or stem
        arts = artifacts_for(
            self.project_path,
            "vibecad",
            stem,
            previous_source_name=self.previous_source_name,
            base_filename=str(self.context.get("base_filename") or "") or None,
        )
        from backend.services.vibecad_artifact_transaction import candidate_artifact_transaction

        with candidate_artifact_transaction(self.project_path, arts.directory, stem) as candidate:
            arts.directory.mkdir(parents=True, exist_ok=True)
            source_name = arts.source_name
            arts.source_path.write_text(source.rstrip() + "\n", encoding="utf-8")
            worker_inputs = vs._resolve_worker_inputs(self.project_path, input_objects)
            _progress(self.progress_callback, "step", 55, "VibeCAD · build123d worker…")
            worker_result = vs._run_worker(
                project_path=self.project_path,
                stem=stem,
                source=source,
                parameters=parameters,
                expected_outputs=expected,
                inputs=worker_inputs,
                cancel_check=self.cancel_check,
            ) or {}
            if not worker_result.get("ok"):
                err = str(worker_result.get("error") or "build123d worker failed")
                err += "\n" + str(worker_result.get("traceback") or "")[:2500]
                self.state["last_error"] = err
                return {
                    "ok": False,
                    "error": err,
                    "engine": "build123d",
                    "evidence": worker_result.get("exception_evidence"),
                }

            published = vs._publish_outputs(
                self.project_path,
                stem,
                worker_result,
                self.progress_callback,
                previous_source_name=self.previous_source_name,
                base_filename=str(self.context.get("base_filename") or "") or None,
            )
            published["worker_result"] = worker_result
            self.state.update(
                {
                    "engine": "build123d",
                    "model_name": model_name,
                    "source": source,
                    "parameters": parameters,
                    "expected_outputs": expected,
                    "input_objects": input_objects,
                    "last_error": None,
                    "worker_result": worker_result,
                    "joints": args.get("joints") if isinstance(args.get("joints"), list) else None,
                    "parts_list": args.get("parts_list"),
                }
            )
            gated = self._gate_published(published, source)
            if not gated.get("ok"):
                return {**gated, "engine": "build123d"}
            candidate.accept()
            self.state["published"] = published
            self.state["last_artifacts"] = published
            return {"ok": True, "engine": "build123d", "published": published}

    def _dispatch(self, tool: str, args: dict[str, Any]) -> dict[str, Any]:
        tool = str(tool or "").strip()
        if tool == "core.inspect":
            return {
                "ok": True,
                "result": self._inspect(
                    str(args.get("scope") or "document"),
                    target=str(args.get("target") or ""),
                    attach=bool(args.get("attach")),
                ),
            }
        if tool == "build123d.inspect_model":
            from backend.services.vibecad_gates import inspect_worker_model

            return {
                "ok": True,
                "result": {
                    "model_name": self.state.get("model_name"),
                    "source": self.state.get("source") or "",
                    "parameters": self.state.get("parameters") or {},
                    "expected_outputs": self.state.get("expected_outputs") or [],
                    "input_objects": self.state.get("input_objects") or {},
                    "worker": inspect_worker_model(self.state.get("worker_result")),
                    "published": self.state.get("published"),
                },
            }
        if tool == "build123d.set_parameters":
            params = args.get("parameters") if isinstance(args.get("parameters"), dict) else None
            if not params:
                return {"ok": False, "error": "set_parameters requires a parameters object"}
            if not self.state.get("source"):
                return {"ok": False, "error": "set_parameters needs an existing model source"}
            merged = dict(self.state.get("parameters") or {})
            merged.update(params)
            return self._run_build123d_create(
                {
                    "model_name": self.state.get("model_name") or "VibeCAD Model",
                    "source": self.state.get("source"),
                    "parameters": merged,
                    "expected_outputs": self.state.get("expected_outputs") or ["Part"],
                    "input_objects": self.state.get("input_objects") or {},
                }
            )
        if tool == "core.capture_view_screenshot":
            from backend.services.vibecad_gates import capture_viewport_views

            published = self.state.get("published") or self.state.get("last_artifacts") or {}
            glb = str(published.get("glb") or "")
            if not glb:
                return {"ok": False, "error": "capture_view_screenshot needs a published GLB"}
            return {"ok": True, "result": capture_viewport_views(self.project_path, glb, Path(glb).stem)}
        if tool == "conversation.review_design":
            return {
                "ok": True,
                "result": self._review(
                    str(args.get("customer_intent") or self.prompt),
                    str(args.get("design_draft") or ""),
                ),
            }
        if tool in {"freecad.create_model", "freecad.edit_source"}:
            return self._run_freecad_create(args)
        if tool in {"build123d.create_model", "build123d.edit_source", "auto.create_model"}:
            # Prefer FreeCAD when available and this is a fresh create
            from backend.services.freecad_engine import freecad_available

            if (
                tool == "auto.create_model"
                and self.prefer_freecad
                and freecad_available()
                and "FreeCAD" not in str(args.get("source") or "")
                and "build123d" not in str(args.get("source") or "")
            ):
                # Legacy payload — try build123d path (source is build123d dialect)
                return self._run_build123d_create(args)
            if tool.startswith("freecad"):
                return self._run_freecad_create(args)
            return self._run_build123d_create(args)
        if tool == "finish":
            if not self.state.get("published"):
                return {"ok": False, "error": "Cannot finish — no successful model yet"}
            return {"ok": True, "finished": True, "summary": args.get("summary")}
        if tool in {"catalog.search", "catalog.import"}:
            from backend.services import parts_sourcing
            try:
                result = (parts_sourcing.search(args.get("query"), fallback=bool(args.get("fallback")))
                          if tool == "catalog.search" else parts_sourcing.import_for_agent(
                              self.project_path, args.get("query"), args.get("source_id")))
                return {"ok": True, "result": result}
            except Exception as exc:
                return {"ok": False, "error": f"Catalog source failed: {exc}"}
        if tool in {"mcmaster.fetch_part", "fetch_mcmaster_part"}:
            pn = str(args.get("part_number") or args.get("pn") or "").strip()
            if not pn:
                return {"ok": False, "error": "part_number required"}
            try:
                from backend.services.mcmaster_fetch_service import fetch_part_for_agent

                result = fetch_part_for_agent(
                    self.project_path,
                    pn,
                    progress_callback=self.progress_callback,
                    emit_preview=False,
                )
                label = (
                    f"McMaster · {pn} already on server"
                    if result.get("cached")
                    else f"McMaster · {pn} on the server"
                )
                _progress(self.progress_callback, "brief", 22, label)
                return {"ok": True, "result": result}
            except Exception as exc:
                return {"ok": False, "error": f"McMaster fetch failed: {exc}"}
        return {"ok": False, "error": f"Unknown tool: {tool}"}

    def run(self) -> dict[str, Any]:
        from backend.services.freecad_engine import freecad_available
        from backend.services import vibecad_service as vs

        _progress(self.progress_callback, "analyze", 8, "VibeCAD · agent starting…")
        hopperish = bool(
            re.search(r"\b(hopper|funnel|vessel|bin|tank|gore|cone|silo)\b", self.prompt, re.I)
        )
        if hopperish:
            engine_hint = (
                "Use build123d.create_model. Hopper/funnel/vessel MUST be one revolved or "
                "lofted silhouette (Pos(0,0,z)*Circle / Polyline+revolve), not stacked "
                "centered Cylinder/Cone. The vibecad skill recipe is required."
            )
        elif freecad_available():
            engine_hint = (
                "FreeCADCmd available. For mechanical assemblies with McMaster hardware, "
                "freecad.create_model can Import.insert staged inputs[hw_*] (mm) and set "
                "Placement. Prefer build123d.create_model for revolved/lofted solids."
            )
        else:
            engine_hint = "FreeCAD not available — use build123d.create_model."
        context_packet = vs._context_brief(self.context, self.project_path, prompt=self.prompt)
        user_brief = (
            f"{'EDIT existing model' if self.previous_source else 'NEW model'}\n"
            f"User request:\n{self.prompt.strip()}\n\n"
            f"Engine hint: {engine_hint}\n"
        )
        if context_packet:
            user_brief += f"\n{context_packet}\n"
        auto_inputs = vs._auto_input_objects(
            self.project_path, self.context, {}, prompt=self.prompt
        )
        if auto_inputs:
            user_brief += (
                "\nStaged STEP inputs (use these aliases in input_objects and "
                "import_step(inputs[alias])):\n"
                + "\n".join(f"- {k}: {v}" for k, v in auto_inputs.items())
                + "\n"
            )
            project_refs = [key for key in auto_inputs if key.startswith("project_ref_")]
            if project_refs:
                user_brief += (
                    "Verified project references are mandatory source geometry. Use "
                    + ", ".join(f"inputs['{key}']" for key in project_refs)
                    + " in the assembled result; do not redraw those products from primitives.\n"
                )
        if self.previous_source:
            user_brief += f"\nExisting source:\n```python\n{self.previous_source[:12000]}\n```\n"
        user_brief += (
            "\nFirst call core.inspect, then conversation.review_design once for new substantial "
            "designs, then create_model. Return tool JSON only."
        )

        history = user_brief
        for turn in range(self.max_turns):
            if self._canceled():
                if self.state.get("published"):
                    break
                raise RuntimeError("Generation canceled.")
            if turn > 0 and self._budget_reached():
                spent = self._spent_usd()
                if self.state.get("published"):
                    _progress(
                        self.progress_callback,
                        "authoring",
                        90,
                        f"Spend cap ${self.budget_usd:g} reached (${spent:.2f}) — keeping gated model.",
                    )
                    break
                raise RuntimeError(
                    f"Spend cap reached (${spent:.2f} of ${self.budget_usd:g}) before a gated VibeCAD model existed."
                )

            from backend.services.generation_service import authoring_loop_pct

            _progress(
                self.progress_callback,
                "generate",
                authoring_loop_pct(turn, self.max_turns),
                f"VibeCAD · agent turn {turn + 1}/{self.max_turns}…",
            )
            repair = ""
            if self.state.get("last_error"):
                repair = (
                    f"\n\nPrevious tool failure — repair with edit_source or a fixed create_model:\n"
                    f"{str(self.state['last_error'])[:3500]}\n"
                )
            try:
                text, trace = self.ai._call_model(
                    self._system_prompt(),
                    history + repair + "\nReturn the next tool call JSON only.",
                    trace_id=self.trace_id,
                    images=self.images,
                    max_tokens=cad_authoring_max_tokens(self.ai.model),
                    json_response=True,
                    allow_truncated=False,
                )
                if isinstance(trace, dict):
                    self.ai_traces.append(trace)
                    self._sync_usage()
                tool, args = _parse_tool_call(text)
            except Exception as exc:
                self.state["last_error"] = f"agent parse/call failed: {exc}"
                history += f"\n\nAssistant error: {exc}\nCall a valid tool JSON."
                continue

            trace_add(
                "info",
                f"[VibeCAD agent] tool={tool}",
                trace_id=self.trace_id,
                data={"tool": tool, "arg_keys": list(args.keys())},
            )
            result = self._dispatch(tool, args)
            if not isinstance(result, dict):
                result = {"ok": False, "error": f"Tool {tool} returned no result"}
            history += (
                f"\n\nAssistant called {tool} with args keys {list((args or {}).keys())}."
                f"\nTool result:\n{json.dumps(result, ensure_ascii=True)[:6000]}\n"
            )
            if tool == "conversation.review_design":
                from backend.services.vibecad_gates import review_construct_unlocked, review_has_blocking

                verdict = ""
                review = result.get("result") if isinstance(result.get("result"), dict) else {}
                if isinstance(review, dict):
                    verdict = str(review.get("verdict") or "")
                if review_construct_unlocked(self.state) or (
                    isinstance(review, dict) and review.get("next") == "create_model"
                ):
                    history += (
                        "\nDesign review finished"
                        + (f" (verdict={verdict})" if verdict else "")
                        + ". Call freecad.create_model or build123d.create_model with full source now. "
                        "Do not call conversation.review_design again.\n"
                    )
                elif review_has_blocking(review if isinstance(review, dict) else None):
                    history += (
                        "\nDesign review asked for a tighter draft"
                        + (f" (verdict={verdict})" if verdict else "")
                        + ". Update the proposal once, then create_model "
                        "(one more review_design is optional, not required).\n"
                    )
                else:
                    history += (
                        "\nDesign review ready"
                        + (f" (verdict={verdict})" if verdict else "")
                        + ". Call freecad.create_model or build123d.create_model with full source.\n"
                    )
            if result.get("finished") or (result.get("ok") and result.get("published") and tool == "finish"):
                break
            if result.get("ok") and result.get("published") and tool != "finish":
                # Nudge to finish after successful create
                history += "\nModel built successfully. Call finish next.\n"
                continue

        published = self.state.get("published")
        if not published:
            raise RuntimeError(
                self.state.get("last_error")
                or "VibeCAD agent failed — no model passed inspect + viewport capture."
            )

        try:
            from backend.services.cad_harness import finalize_harness_run

            published = self.state.get("published") or {}
            finalize_harness_run(
                self.project_path,
                published_step=published.get("step"),
                joints=self.state.get("joints"),
                parts_list=self.state.get("parts_list"),
            )
        except Exception:
            pass

        return {
            "published": published,
            "model_name": self.state.get("model_name") or "VibeCAD Model",
            "engine": self.state.get("engine") or "build123d",
            "ai_traces": self.ai_traces,
            "attempts": min(self.max_turns, max(1, len(self.ai_traces))),
            "review": self.state.get("review"),
        }
