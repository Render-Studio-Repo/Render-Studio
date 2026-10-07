"""Jake-style tool-using CAD authoring agent.

Mirrors upstream text-to-cad (Codex / Claude Code) inside Render Studio:

1. Agent edits ``gen_step()`` source with surgical tools (not full-file regen only)
2. Agent runs ``scripts/step``, ``inspect``, ``snapshot`` itself
3. Agent reads CLI output / snapshot paths and repairs in the same session
4. Continuous multi-turn tool loop until gates pass or budget is exhausted

This is intentionally an in-process tool agent using the project's configured
OpenAI/Anthropic key — same skill contract as Jake, without embedding Codex CLI.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Callable, Optional

from backend.services.ai_cost import estimate_cost_usd, usage_from_anthropic_response, usage_from_openai_response
from backend.services.ai_service import AIService, model_hard_timeout_seconds, uses_openai_responses_api
from backend.services.cad_authoring_agent import (
    build_snapshot_job,
    classify_cli_failure,
    collect_snapshot_pngs,
    needs_multi_view_packet,
    write_snapshot_job_file,
)
from backend.services.prompt_language import with_multilingual_prompt_rule
from backend.services.trace_log import add as trace_add
from backend.services.generation_service import authoring_loop_pct

ProgressCb = Optional[Callable[[dict[str, Any]], None]]
CancelCb = Optional[Callable[[], bool]]
UsageCb = Optional[Callable[[list[dict[str, Any]]], None]]

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_parts_catalog",
            "description": "Search Render Studio Parts Catalog SECOND after official manufacturer STEP lookup fails. Returns real source IDs, STEP URLs, specs and documentation. Read-only, cached and bounded.",
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string"}, "fallback": {"type": "boolean"}
            }, "required": ["query"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "import_catalog_part",
            "description": "During Generate import a STEP by source ID returned by search_parts_catalog. Saves source/docs to the part profile and sourced purchase list; inspect and place returned filename in the assembly.",
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string"}, "source_id": {"type": "string"}
            }, "required": ["query", "source_id"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files in the project workspace (CAD sources, DXF, STEP, snapshots).",
            "parameters": {
                "type": "object",
                "properties": {
                    "glob": {"type": "string", "description": "Optional glob like *.py or *.dxf"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text project file (Python source, brief, DXF text, inspect notes).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Project-relative filename"},
                    "max_chars": {"type": "integer", "description": "Optional max characters"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_mcmaster_part",
            "description": (
                "Download a McMaster-Carr STEP file onto the studio server (not the user's computer) "
                "via a headless crawler. Use only when that catalog PN is not already on disk as "
                ".glb or .step (project root or mcmaster_library/). If the file exists, inspect it "
                "instead of fetching. Returns the STEP filename, viewer GLB, and buy URL."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "part_number": {
                        "type": "string",
                        "description": "McMaster catalog number such as 91251A194",
                    },
                },
                "required": ["part_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write/overwrite a project text file. Prefer str_replace for small repairs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "str_replace",
            "description": "Surgical edit: replace an exact substring once in a project file (Jake smallest change).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "old_str": {"type": "string"},
                    "new_str": {"type": "string"},
                },
                "required": ["path", "old_str", "new_str"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_step",
            "description": "Run CAD scripts/step on the Python generator to produce STEP/GLB/STL/3MF.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {"type": "string", "description": "Generator .py filename"},
                },
                "required": ["source"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_inspect",
            "description": "Run scripts/inspect refs --facts --planes --positioning on a STEP file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "step": {"type": "string", "description": "STEP filename"},
                },
                "required": ["step"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_snapshot",
            "description": "Run mandatory scripts/snapshot multi-view packet for visual review.",
            "parameters": {
                "type": "object",
                "properties": {
                    "step": {"type": "string"},
                    "base": {"type": "string", "description": "Basename for snapshot outputs"},
                },
                "required": ["step", "base"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "Declare success after step+inspect+snapshot passed. Provide artifact filenames.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "step": {"type": "string"},
                    "glb": {"type": "string"},
                    "summary": {"type": "string"},
                },
                "required": ["source", "step", "glb"],
            },
        },
    },
]


def _tools_for_prompt(prompt: str = "", *, use_mcmaster_parts: bool = True) -> list[dict[str, Any]]:
    from backend.services.cad_harness import catalog_hardware_allowed

    if catalog_hardware_allowed(prompt, use_mcmaster_parts=use_mcmaster_parts):
        return AGENT_TOOLS
    return [t for t in AGENT_TOOLS if t.get("function", {}).get("name") != "fetch_mcmaster_part"]


def _anthropic_tools(prompt: str = "", *, use_mcmaster_parts: bool = True) -> list[dict[str, Any]]:
    out = []
    for tool in _tools_for_prompt(prompt, use_mcmaster_parts=use_mcmaster_parts):
        fn = tool["function"]
        out.append(
            {
                "name": fn["name"],
                "description": fn["description"],
                "input_schema": fn["parameters"],
            }
        )
    return out


def _responses_tools(prompt: str = "", *, use_mcmaster_parts: bool = True) -> list[dict[str, Any]]:
    out = []
    for tool in _tools_for_prompt(prompt, use_mcmaster_parts=use_mcmaster_parts):
        fn = tool["function"]
        out.append(
            {
                "type": "function",
                "name": fn["name"],
                "description": fn["description"],
                "parameters": fn["parameters"],
            }
        )
    return out


def _safe_rel(project_path: Path, rel: str) -> Path:
    """Allow a basename or jake/vibecad/mesh (and library) relative path."""
    from backend.services.render_agent_guard import scoped_tool_path

    return scoped_tool_path(project_path, rel)


def _tail(text: str, n: int = 3500) -> str:
    text = text or ""
    return text if len(text) <= n else text[-n:]


def _looks_like_toy_py(source: str) -> bool:
    text = source or ""
    if len(text) < 250:
        return True
    if len(text) < 500 and re.search(r"Box\(\s*1\s*,\s*1\s*,\s*1\s*\)", text):
        return True
    return False


def _progress(cb: ProgressCb, **kwargs: Any) -> None:
    if cb:
        cb(kwargs)


class JakeToolAgent:
    def __init__(
        self,
        *,
        ai: AIService,
        project_path: Path,
        prompt: str,
        cad_brief: str,
        source_name: str,
        step_name: str,
        glb_name: str,
        stl_name: str,
        three_mf_name: str,
        previous_source: str | None = None,
        is_edit: bool = False,
        max_turns: int = 200,
        budget_usd: float | None = None,
        cancel_check: CancelCb = None,
        progress_callback: ProgressCb = None,
        usage_callback: UsageCb = None,
        model_electronics: bool = True,
        use_mcmaster_parts: bool = True,
        trace_id: str | None = None,
    ) -> None:
        self.ai = ai
        self.project_path = project_path.resolve()
        self.prompt = prompt
        self.cad_brief = cad_brief
        self.source_name = source_name
        self.step_name = step_name
        self.glb_name = glb_name
        self.stl_name = stl_name
        self.three_mf_name = three_mf_name
        self.previous_source = previous_source
        self.is_edit = is_edit
        self.max_turns = max_turns
        try:
            cap = float(budget_usd) if budget_usd is not None else None
        except (TypeError, ValueError):
            cap = None
        self.budget_usd = cap if cap is not None and cap > 0 else None
        self.cancel_check = cancel_check
        self.progress_callback = progress_callback
        self.usage_callback = usage_callback
        self.model_electronics = bool(model_electronics)
        self.use_mcmaster_parts = bool(use_mcmaster_parts)
        self.trace_id = trace_id
        self.finished: dict[str, Any] | None = None
        self.last_step_ok = False
        self.last_inspect_ok = False
        self.last_snapshot_ok = False
        self.ai_traces: list[dict[str, Any]] = []
        self._skill_md = self._load_skill_excerpt()

    def _raise_if_canceled(self) -> None:
        if self.cancel_check and self.cancel_check():
            raise RuntimeError("Generation canceled.")
        self.ai._raise_if_canceled()

    def _load_skill_excerpt(self) -> str:
        try:
            from backend.services.skills_service import get_skill_dir

            skill_dir = get_skill_dir("cad")
            if not skill_dir:
                return ""
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.is_file():
                return ""
            text = skill_md.read_text(encoding="utf-8", errors="ignore")
            marker = "<!-- render3d-studio -->"
            if marker in text:
                text = text.split(marker, 1)[0]
            return text[:12000]
        except Exception:
            return ""

    def _system_prompt(self) -> str:
        from backend.services.parts_sourcing_policy import PARTS_SOURCING_RULES, UNRESOLVED_PURCHASED_INTERFACE_RULES
        mode = "EDIT/REVISE an existing generator" if self.is_edit else "CREATE a new part"
        electronics_rule = ""
        if self.model_electronics:
            electronics_rule = (
                "- When the prompt mentions motors/servos/ESC/battery/wiring/electronics: model visible "
                "labeled electronics solids and wire runs — not empty pockets alone.\n"
            )
        return with_multilingual_prompt_rule(
            "You are a Jake-style CAD authoring agent (earthtojake/text-to-cad skill contract).\n"
            f"Task mode: {mode}.\n"
            "Work ONLY via tools. Do not return markdown code fences as your final answer — write files with tools.\n"
            "Required workflow:\n"
            "1) Read/create a cadgen `@step` model (or legacy gen_step()) for the assembled layout\n"
            "2) For multi-part assemblies also define gen_exploded() (spaced BOM/layout)\n"
            "3) run_step on that generator (auto-exports assembled + {stem}_exploded sidecars)\n"
            "4) On failure: classify, str_replace the smallest fix, rerun_step\n"
            "5) run_inspect on the STEP\n"
            "6) run_snapshot (mandatory)\n"
            "7) finish with source/step/glb names when gates pass\n"
            "Rules:\n"
            "- Stay inside this project directory. Never read or write .env, Sam's Notes, credentials, keys, or paths outside the project.\n"
            "- Millimeters. gen_step() returns the assembled STEP-ready shape/compound; no file writes inside gen_step().\n"
            "- Prefer str_replace over write_file for repairs.\n"
            "- Never assign bare floats to *_positions / list constants "
            "(wrong: rod_hole_positions = 10.0). Use lists of (x,y) or GridLocations.\n"
            "- Keep labels and working geometry on edits.\n"
            "- Colour every leaf with realistic shop materials from the prompt "
            "(aluminum #c0c6cc, steel #8a939d, black oxide #3a3f44, brass #c4a574, "
            "POM #d9d3c7, rubber #4a5560, fasteners #c6d0da) via cadgen.srgb. "
            "Imported STEP/GLB/IGES and Target Edit of selected CAD that look white or mid-grey "
            "are uncolored tessellation — still colour every leaf; never leave glTF/OCC default white. "
            "Preserve user/reference finishes including neutral metals and white paint. Infer plausible materials when unspecified; keep identical material assignments in assembled and exploded exports. Do not cycle pastel WORKBENCH_FILL_COLORS unless the user asked for workbench fills.\n"
            "- Inspect sibling STEP/GLB files already on disk. "
            "Do not re-import or rescale existing designed parts into a new compound. "
            "Author only the new solid; the host FreeCAD kernel places it beside live parts. "
            + (
                "McMaster-Carr catalog hardware is OFF. Do not fetch or import McMaster parts. "
                "Do not call fetch_mcmaster_part.\n"
                if not self.use_mcmaster_parts
                else (
                    "If this prompt forbids screws / asks for an all-printed kit, do not fetch or import McMaster parts. "
                    "Otherwise place catalog hardware with moved(Location(...)) in millimetres into THIS new part "
                    "so fasteners are not stacked at the origin. "
                    "Rearrange via r3d_placements.json. Fetch missing McMaster PNs with fetch_mcmaster_part "
                    "only when fasteners are required, and list what you imported in r3d_mcmaster_used.json.\n"
                )
            )
            + "Mechanisms: author named solids per moving body plus joints (fixed/revolute/slider/"
            "cylindrical/ball) in the Feature Program / <model_stem>.joints.json with exact exported component names and world-frame pivots in mm; the host preserves joint metadata for native CAD adapters.\n"
            f"{electronics_rule}"
            f"Target files: source={self.source_name}, step={self.step_name}, glb={self.glb_name}.\n\n"
            f"{PARTS_SOURCING_RULES}\n\n"
            f"{UNRESOLVED_PURCHASED_INTERFACE_RULES}\n\n"
            f"CAD skill excerpt:\n{self._skill_md}"
        )

    def _user_kickoff(self) -> str:
        parts = [
            f"User prompt:\n{self.prompt.strip()}",
            f"\nCAD brief:\n{self.cad_brief.strip()}",
            f"\nWrite generator as `{self.source_name}` unless editing an existing file with another name.",
        ]
        if self.previous_source:
            path = self.project_path / self.source_name
            if not path.is_file():
                path.write_text(self.previous_source.rstrip() + "\n", encoding="utf-8")
            parts.append(
                f"\nExisting source is already at `{self.source_name}`. "
                "Make the smallest responsible edit for the user request, then validate with tools."
            )
        else:
            parts.append("\nNo existing generator yet — create it with write_file, then validate with tools.")
        dxfs = sorted(self.project_path.glob("*.dxf"))
        if dxfs:
            parts.append("\nDXF files present: " + ", ".join(p.name for p in dxfs[:12]))
        try:
            from backend.services.cad_harness import sibling_parts_block

            extra = sibling_parts_block(
                self.project_path,
                prompt=self.prompt,
                context={"use_mcmaster_parts": self.use_mcmaster_parts},
            )
            if extra:
                parts.append("\n" + extra)
        except Exception:
            pass
        return "\n".join(parts)

    def _spent_usd(self) -> float:
        total = 0.0
        for row in self.ai_traces:
            try:
                total += float(row.get("cost_usd") or 0)
            except (TypeError, ValueError):
                continue
        return total

    def _newest(self, pattern: str) -> Path | None:
        files = [p for p in self.project_path.glob(pattern) if p.is_file()]
        if not files:
            return None
        return max(files, key=lambda p: p.stat().st_mtime)

    def _ensure_glb_from_step(self, step: Path, glb: Path) -> bool:
        if glb.is_file() and glb.stat().st_size > 0:
            return True
        try:
            from backend.services import cad_service

            cad_service.tessellate_step_to_glb(step, glb)
        except Exception:
            try:
                import trimesh

                scene = trimesh.load(str(step), force="scene")
                mesh = (
                    trimesh.util.concatenate(tuple(scene.geometry.values()))
                    if isinstance(scene, trimesh.Scene)
                    else scene
                )
                mesh.export(str(glb))
            except Exception:
                return glb.is_file() and glb.stat().st_size > 0
        return glb.is_file() and glb.stat().st_size > 0

    def _stop_if_budget_hit(self, turn: int) -> dict[str, Any] | None:
        """Before spending another turn, publish the closest model if the dollar cap is reached."""
        if turn <= 0 or self.budget_usd is None:
            return None
        spent = self._spent_usd()
        if spent < self.budget_usd:
            return None
        self._emit(
            "authoring",
            f"Spend cap ${self.budget_usd:g} reached (${spent:.2f}) — publishing closest model…",
            90,
        )
        published = self._publish_closest_model(
            reason=f"Published at spend cap (${spent:.2f} / ${self.budget_usd:g})"
        )
        if published is not None:
            return published
        raise RuntimeError(
            f"Spend cap reached (${spent:.2f} of ${self.budget_usd:g}) before a publishable STEP/GLB existed."
        )

    def _publish_if_step_ready(self, *, reason: str) -> dict[str, Any] | None:
        return self._publish_closest_model(reason=reason)

    def _publish_closest_model(self, *, reason: str) -> dict[str, Any] | None:
        """Publish only a model that already passed step + inspect + snapshot."""
        source = self.project_path / self.source_name
        try:
            from backend.services.design_service import _best_leftover_cad_source

            leftover_name, leftover_text = _best_leftover_cad_source(
                self.project_path,
                preferred_name=self.source_name,
                extra_source=source.read_text(encoding="utf-8", errors="ignore") if source.is_file() else None,
            )
            if leftover_text and leftover_name:
                from backend.services.engine_layout import project_rel

                dest = self.project_path / (leftover_name if leftover_name.endswith(".py") else self.source_name)
                dest.parent.mkdir(parents=True, exist_ok=True)
                if project_rel(self.project_path, dest) != self.source_name:
                    self.source_name = project_rel(self.project_path, dest)
                    source = dest
                if (not source.is_file()) or source.read_text(encoding="utf-8", errors="ignore") != leftover_text:
                    source.write_text(leftover_text.rstrip() + "\n", encoding="utf-8")
                    self.source_name = project_rel(self.project_path, source)
        except Exception:
            pass
        if source.is_file() and not self.last_step_ok:
            try:
                self._run_step(self.source_name)
            except Exception:
                pass
        step = self.project_path / self.step_name
        if step.is_file() and not self.last_inspect_ok:
            try:
                self._run_inspect(self.step_name)
            except Exception:
                pass
        if step.is_file() and not self.last_snapshot_ok:
            try:
                self._run_snapshot(self.step_name, Path(self.step_name).stem)
            except Exception:
                pass
        if not (self.last_step_ok and self.last_inspect_ok and self.last_snapshot_ok):
            return None
        glb = self.project_path / self.glb_name
        if not glb.is_file() or glb.stat().st_size < 512:
            self._ensure_glb_from_step(step, glb)
        if not (step.is_file() and glb.is_file() and source.is_file()):
            return None
        self.finished = {
            "source": self.source_name,
            "step": step.name,
            "glb": glb.name,
            "summary": reason,
        }
        self.step_name = step.name
        self.glb_name = glb.name
        self._emit("finalize", reason, 96)
        return self._success_payload()

    def _append_ai_trace(self, trace: dict[str, Any]) -> None:
        self.ai_traces.append(trace)
        if self.usage_callback:
            self.usage_callback(list(self.ai_traces))

    def _emit(self, stage: str, label: str, pct: int) -> None:
        _progress(
            self.progress_callback,
            stage=stage,
            pct=pct,
            label=label,
            thinking=label,
            activity=[{"text": label, "stage": stage}],
        )
        trace_add("info", f"[jake-tool-agent] {label}", trace_id=self.trace_id)

    def _exec_tool(self, name: str, args: dict[str, Any]) -> str:
        self._raise_if_canceled()
        try:
            if name in {"search_parts_catalog", "import_catalog_part"}:
                from backend.services import parts_sourcing
                result = (parts_sourcing.search(args.get("query"), fallback=bool(args.get("fallback")))
                          if name == "search_parts_catalog" else parts_sourcing.import_for_agent(
                              self.project_path, args.get("query"), args.get("source_id")))
                return json.dumps(result)
            if name == "list_files":
                from backend.services.engine_layout import ENGINE_FOLDERS
                from backend.services.render_agent_guard import is_forbidden_path, path_is_under

                pattern = str(args.get("glob") or "*")
                if ".." in pattern.replace("\\", "/").split("/"):
                    return json.dumps({"error": "blocked: path is outside the active project", "files": []})
                files = list(self.project_path.glob(pattern))
                if "/" not in pattern:
                    for folder in ENGINE_FOLDERS:
                        sub = self.project_path / folder
                        if sub.is_dir():
                            files.extend(sub.glob(pattern))
                lib = self.project_path / "mcmaster_library"
                if lib.is_dir():
                    files.extend(lib.glob(pattern if "/" not in pattern else Path(pattern).name))
                    files.extend(lib.glob("*"))
                names: list[str] = []
                seen: set[str] = set()
                for path in sorted(files):
                    if not path.is_file():
                        continue
                    try:
                        resolved = path.resolve()
                        if not path_is_under(self.project_path, resolved):
                            continue
                        if is_forbidden_path(resolved, project_path=self.project_path):
                            continue
                        rel = str(resolved.relative_to(self.project_path.resolve()))
                    except ValueError:
                        continue
                    if rel in seen:
                        continue
                    seen.add(rel)
                    names.append(rel)
                    if len(names) >= 80:
                        break
                return json.dumps({"files": names})
            if name == "fetch_mcmaster_part":
                from backend.services.cad_harness import catalog_hardware_allowed

                if not catalog_hardware_allowed(
                    self.prompt, use_mcmaster_parts=self.use_mcmaster_parts
                ):
                    return json.dumps(
                        {
                            "error": "McMaster fetch skipped (Parts toggle off or print-only prompt)",
                            "skipped": True,
                        }
                    )
                pn = str(args.get("part_number") or "").strip()
                if not pn:
                    return json.dumps({"error": "part_number required"})
                from backend.services.mcmaster_fetch_service import fetch_part_for_agent

                result = fetch_part_for_agent(
                    self.project_path,
                    pn,
                    progress_callback=self.progress_callback,
                    emit_preview=False,
                )
                if result.get("cached"):
                    self._emit("brief", f"McMaster · {pn} already on server", 22)
                else:
                    self._emit("brief", f"McMaster · {pn} on the server", 22)
                return json.dumps(result)
            if name == "read_file":
                from backend.services.render_agent_guard import blocked_tool_result, redact_secrets

                try:
                    path = _safe_rel(self.project_path, str(args.get("path") or ""))
                except ValueError as exc:
                    return blocked_tool_result(str(exc))
                if not path.is_file():
                    return json.dumps({"error": f"missing file {path.name}"})
                text = redact_secrets(path.read_text(encoding="utf-8", errors="ignore"))
                max_chars = int(args.get("max_chars") or 20000)
                return json.dumps({"path": path.name, "content": text[:max_chars]})
            if name == "write_file":
                from backend.services.engine_layout import project_rel
                from backend.services.render_agent_guard import blocked_tool_result

                try:
                    path = _safe_rel(self.project_path, str(args.get("path") or ""))
                except ValueError as exc:
                    return blocked_tool_result(str(exc))
                content = str(args.get("content") or "")
                if path.suffix.lower() == ".py":
                    # Repo contract: one generator basename. Don't fork a.py / random stems.
                    if "def gen_step" in content and not _looks_like_toy_py(content):
                        target = _safe_rel(self.project_path, self.source_name)
                        if project_rel(self.project_path, path) != project_rel(self.project_path, target):
                            self._emit(
                                "ai_source",
                                f"Redirecting {path.name} → {self.source_name} (CAD skill generator)",
                                22,
                            )
                            path = target
                    self._emit("ai_source", f"Writing {path.name}…", 22)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content.rstrip() + "\n", encoding="utf-8")
                if path.suffix.lower() == ".py" and path.name == Path(self.source_name).name:
                    self.source_name = project_rel(self.project_path, path)
                return json.dumps({"ok": True, "path": project_rel(self.project_path, path), "bytes": path.stat().st_size})
            if name == "str_replace":
                from backend.services.render_agent_guard import blocked_tool_result

                try:
                    path = _safe_rel(self.project_path, str(args.get("path") or ""))
                except ValueError as exc:
                    return blocked_tool_result(str(exc))
                old = str(args.get("old_str") or "")
                new = str(args.get("new_str") or "")
                if not path.is_file():
                    return json.dumps({"error": f"missing file {path.name}"})
                text = path.read_text(encoding="utf-8", errors="ignore")
                if old not in text:
                    return json.dumps({"error": "old_str not found — read_file and retry with exact text"})
                if text.count(old) != 1:
                    return json.dumps({"error": f"old_str matched {text.count(old)} times; make it unique"})
                path.write_text(text.replace(old, new, 1), encoding="utf-8")
                self._emit("ai_source", f"Surgical edit in {path.name}", 24)
                return json.dumps({"ok": True, "path": path.name})
            if name == "run_step":
                requested = str(args.get("source") or self.source_name)
                if Path(requested).name != Path(self.source_name).name:
                    try:
                        requested_path = _safe_rel(self.project_path, requested)
                    except ValueError:
                        requested_path = self.project_path / Path(requested).name
                    if (not requested_path.is_file()) or _looks_like_toy_py(
                        requested_path.read_text(encoding="utf-8", errors="ignore")
                        if requested_path.is_file()
                        else ""
                    ):
                        requested = self.source_name
                return self._run_step(requested)
            if name == "run_inspect":
                return self._run_inspect(str(args.get("step") or self.step_name))
            if name == "run_snapshot":
                return self._run_snapshot(
                    str(args.get("step") or self.step_name),
                    str(args.get("base") or Path(self.step_name).stem),
                )
            if name == "finish":
                source = str(args.get("source") or self.source_name)
                step = str(args.get("step") or self.step_name)
                glb = str(args.get("glb") or self.glb_name)
                if not (self.project_path / source).is_file():
                    return json.dumps({"error": f"source missing: {source}"})
                if not (self.project_path / step).is_file():
                    return json.dumps({"error": f"step missing: {step} — run_step first"})
                if not (self.project_path / glb).is_file():
                    return json.dumps({"error": f"glb missing: {glb} — run_step with --glb"})
                if not self.last_step_ok:
                    return json.dumps({"error": "run_step has not succeeded yet in this session"})
                if not self.last_inspect_ok:
                    return json.dumps({"error": "run_inspect has not succeeded yet — inspect is mandatory"})
                if not self.last_snapshot_ok:
                    return json.dumps({"error": "run_snapshot has not succeeded yet — snapshot is mandatory"})
                self.finished = {
                    "source": source,
                    "step": step,
                    "glb": glb,
                    "summary": str(args.get("summary") or "Authoring complete"),
                }
                self._emit("finalize", "Authoring agent finished validation gates", 96)
                return json.dumps({"ok": True, "finished": True, **self.finished})
            return json.dumps({"error": f"unknown tool {name}"})
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    def _run_step(self, source: str) -> str:
        from backend.services import skill_runner
        from backend.services.design_service import (
            _apply_jake_deterministic_repairs,
            _ensure_gen_exploded_in_source,
            _collect_exploded_sidecar_files,
        )

        source_path = _safe_rel(self.project_path, source)
        if not source_path.is_file():
            return json.dumps({"error": f"source missing: {source}"})
        # Deterministic Jake pre-step type fixes (positions floats, etc.)
        raw = source_path.read_text(encoding="utf-8", errors="ignore")
        fixed = _apply_jake_deterministic_repairs(raw, prompt=self.prompt)
        fixed = _ensure_gen_exploded_in_source(fixed)
        if fixed != raw:
            source_path.write_text(fixed.rstrip() + "\n", encoding="utf-8")
        stem = source_path.stem
        out_dir = source_path.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        from backend.services.engine_layout import project_rel

        step_path = out_dir / f"{stem}.step"
        glb_path = out_dir / f"{stem}.glb"
        rel_source = project_rel(self.project_path, source_path)
        step = project_rel(self.project_path, step_path)
        glb = project_rel(self.project_path, glb_path)
        self.source_name, self.step_name, self.glb_name = rel_source, step, glb
        self._emit("step", f"Running scripts/step on {rel_source}…", 40)
        out = skill_runner.run_skill_tool(
            "cad",
            "step",
            [rel_source, "-o", step, "--glb", glb, "--force"],
            cwd=self.project_path,
            timeout_sec=240.0,
            cancel_check=self.cancel_check,
        )
        ok = bool(out.get("ok"))
        self.last_step_ok = ok
        if ok:
            self.last_inspect_ok = False
            self.last_snapshot_ok = False
            glb_path = self.project_path / glb
            if (not glb_path.is_file() or glb_path.stat().st_size < 80) and (self.project_path / step).is_file():
                self._ensure_glb_from_step(self.project_path / step, glb_path)
            from backend.services.live_preview import emit_live_preview

            emit_live_preview(
                self.progress_callback,
                glb_path,
                label="CAD · drawing in viewport…",
                stage="step",
                pct=52,
            )
        detail = _tail((out.get("stderr") or "") + "\n" + (out.get("stdout") or ""))
        classified = classify_cli_failure(detail)
        exploded = _collect_exploded_sidecar_files(self.project_path, stem) if ok else {}
        return json.dumps(
            {
                "ok": ok,
                "exit_code": out.get("exit_code"),
                "source": source_path.name,
                "step": step if (self.project_path / step).is_file() else None,
                "glb": glb if (self.project_path / glb).is_file() else None,
                "exploded": exploded or None,
                "failure_class": classified.get("class"),
                "guidance": classified.get("guidance") if not ok else None,
                "output_tail": detail,
            }
        )

    def _run_inspect(self, step: str) -> str:
        from backend.services import skill_runner

        step_path = _safe_rel(self.project_path, step)
        if not step_path.is_file():
            return json.dumps({"error": f"step missing: {step}"})
        from backend.services.engine_layout import project_rel

        rel_step = project_rel(self.project_path, step_path)
        self._emit("inspect", f"Inspecting {rel_step}…", 78)
        out = skill_runner.run_skill_tool(
            "cad",
            "inspect",
            ["refs", rel_step, "--facts", "--planes", "--positioning"],
            cwd=self.project_path,
            timeout_sec=90.0,
            cancel_check=self.cancel_check,
        )
        ok = bool(out.get("ok"))
        self.last_inspect_ok = ok
        detail = _tail((out.get("stdout") or "") + "\n" + (out.get("stderr") or ""))
        return json.dumps({"ok": ok, "step": rel_step, "output_tail": detail})

    def _run_snapshot(self, step: str, base: str) -> str:
        from backend.services import skill_runner

        step_path = _safe_rel(self.project_path, step)
        if not step_path.is_file():
            return json.dumps({"error": f"step missing: {step}"})
        from backend.services.engine_layout import project_rel

        rel_step = project_rel(self.project_path, step_path)
        safe_base = re.sub(r"[^a-zA-Z0-9_-]+", "_", base).strip("_") or step_path.stem
        source = ""
        src_path = self.project_path / self.source_name
        if src_path.is_file():
            source = src_path.read_text(encoding="utf-8", errors="ignore")
        self._emit("snapshot", f"Rendering snapshot packet for {rel_step}…", 90)
        multi = needs_multi_view_packet(self.prompt, source, None)
        job = build_snapshot_job(step_name=rel_step, base=safe_base, multi_view=multi)
        job_path = write_snapshot_job_file(self.project_path, job, safe_base)
        out = skill_runner.run_skill_tool(
            "cad",
            "snapshot",
            ["--job", job_path.name],
            cwd=self.project_path,
            timeout_sec=120.0,
            cancel_check=self.cancel_check,
        )
        files = collect_snapshot_pngs(self.project_path, safe_base)
        ok = bool(out.get("ok")) and bool(files)
        if not ok and multi:
            simple = build_snapshot_job(step_name=rel_step, base=safe_base, multi_view=False)
            simple_path = write_snapshot_job_file(self.project_path, simple, f"{safe_base}_iso")
            out = skill_runner.run_skill_tool(
                "cad",
                "snapshot",
                ["--job", simple_path.name],
                cwd=self.project_path,
                timeout_sec=90.0,
                cancel_check=self.cancel_check,
            )
            files = collect_snapshot_pngs(self.project_path, safe_base)
            ok = bool(out.get("ok")) and bool(files)
        self.last_snapshot_ok = ok
        detail = _tail((out.get("stderr") or "") + "\n" + (out.get("stdout") or ""))
        if ok and self.last_step_ok and self.last_inspect_ok and not self.finished:
            self.finished = {
                "source": self.source_name,
                "step": self.step_name,
                "glb": self.glb_name,
                "summary": "Authoring complete (step + inspect + snapshot)",
            }
            self._emit("finalize", "CAD skill gates passed — finishing without waiting for finish()", 96)
        return json.dumps({"ok": ok, "files": files, "output_tail": detail, "finished": bool(self.finished)})

    def run(self) -> dict[str, Any]:
        self._emit("brief", "Text to Cad · starting authoring loop…", 12)
        try:
            from backend.services.skill_runner import ensure_project_cad_scripts

            ensure_project_cad_scripts(self.project_path)
        except Exception:
            pass
        if self.ai.provider == "anthropic":
            return self._run_anthropic()
        return self._run_openai()

    def _run_openai(self) -> dict[str, Any]:
        model = self.ai.model
        # Kimi is chat-completions only. OpenAI GPT-5.5/5.6 Sol 404 on chat.completions.
        chat_only = getattr(
            self.ai,
            "CHAT_COMPLETIONS_ONLY_PROVIDERS",
            frozenset({"kimi", "gemini", "qwen", "local"}),
        )
        if self.ai.provider in chat_only:
            return self._run_openai_chat()
        if self.ai.provider in {"openai", "xai"} or uses_openai_responses_api(model):
            return self._run_openai_responses()
        try:
            return self._run_openai_chat()
        except Exception as exc:
            msg = str(exc).lower()
            if "v1/responses" in msg or "not supported in the v1/chat/completions" in msg:
                return self._run_openai_responses()
            raise

    def _run_openai_chat(self) -> dict[str, Any]:
        import concurrent.futures as _cf

        from backend.services.ai_service import (
            cad_authoring_max_tokens,
            kimi_chat_create_kwargs,
            openai_compat_assistant_history_message,
        )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._system_prompt()},
            {"role": "user", "content": self._user_kickoff()},
        ]
        max_tokens = cad_authoring_max_tokens(self.ai.model)
        is_kimi = self.ai.provider == "kimi"
        is_qwen = self.ai.provider == "qwen"
        for turn in range(self.max_turns):
            self._raise_if_canceled()
            capped = self._stop_if_budget_hit(turn)
            if capped is not None:
                return capped
            self._emit(
                "ai_source",
                f"Text to Cad · agent turn {turn + 1}/{self.max_turns}…",
                authoring_loop_pct(turn, self.max_turns, lo=22, hi=70),
            )
            t0 = time.perf_counter()
            create_kwargs: dict[str, Any] = {
                "model": self.ai.model,
                "messages": messages,
                "tools": _tools_for_prompt(
                    self.prompt, use_mcmaster_parts=self.use_mcmaster_parts
                ),
                "tool_choice": "auto",
            }
            if is_kimi:
                create_kwargs.pop("tool_choice", None)
                create_kwargs.update(
                    kimi_chat_create_kwargs(self.ai.model, max_tokens=max_tokens, tools=True)
                )
            else:
                create_kwargs["max_completion_tokens"] = max_tokens
            if is_qwen:
                extra = dict(create_kwargs.get("extra_body") or {})
                extra.setdefault("enable_thinking", False)
                create_kwargs["extra_body"] = extra
            with _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="jake-oai-chat") as pool:
                fut = pool.submit(
                    self.ai.client.chat.completions.create,
                    **create_kwargs,
                )
                try:
                    completion = self.ai._wait_future(fut)
                except Exception as exc:
                    usage = getattr(exc, "usage", None) or {}
                    if not usage and getattr(exc, "openai_response", None) is not None:
                        usage = usage_from_openai_response(getattr(exc, "openai_response"))
                    trace = {
                        "provider": self.ai.provider if self.ai.provider in {"openai", "xai", "kimi", "gemini", "qwen"} else "openai",
                        "api": "chat.completions.tools",
                        "model": self.ai.model,
                        "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                        "turn": turn + 1,
                        "error": str(exc),
                    }
                    if usage:
                        trace["usage"] = usage
                        trace["cost_usd"] = estimate_cost_usd(
                            self.ai.model,
                            usage,
                            provider=trace["provider"],
                        )
                    self._append_ai_trace(trace)
                    raise
            usage = usage_from_openai_response(completion)
            trace = {
                "provider": self.ai.provider if self.ai.provider in {"openai", "xai", "kimi", "gemini", "qwen"} else "openai",
                "api": "chat.completions.tools",
                "model": self.ai.model,
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                "turn": turn + 1,
            }
            if usage:
                trace["usage"] = usage
                trace["cost_usd"] = estimate_cost_usd(
                    self.ai.model,
                    usage,
                    provider=trace["provider"],
                )
            self._append_ai_trace(trace)
            msg = completion.choices[0].message
            tool_calls = msg.tool_calls or []
            # K3 requires reasoning_content on the next turn; do not rebuild a stripped message.
            assistant_msg = openai_compat_assistant_history_message(msg)
            if not tool_calls:
                # Nudge the model to use tools rather than prose.
                messages.append(assistant_msg)
                messages.append(
                    {
                        "role": "user",
                        "content": "Continue using tools only. If validation already passed, call finish.",
                    }
                )
                continue
            messages.append(assistant_msg)
            for tc in tool_calls:
                args = {}
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = self._exec_tool(tc.function.name, args if isinstance(args, dict) else {})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
                if self.finished:
                    return self._success_payload()
        published = self._publish_closest_model(
            reason=f"Published at loop cap ({self.max_turns} turns)."
        )
        if published is not None:
            return published
        raise RuntimeError(
            f"Authoring agent exhausted {self.max_turns} turns without a STEP/GLB to publish. "
            f"step={self.last_step_ok} inspect={self.last_inspect_ok} snapshot={self.last_snapshot_ok}"
        )

    def _run_openai_responses(self) -> dict[str, Any]:
        """OpenAI Responses API tool loop (GPT-5.5 / GPT-5.6 Sol and peers)."""
        import concurrent.futures as _cf

        from backend.services.ai_service import cad_authoring_max_tokens

        input_items: list[dict[str, Any]] = [
            {"role": "system", "content": self._system_prompt()},
            {"role": "user", "content": self._user_kickoff()},
        ]
        reasoning = None
        try:
            reasoning = self.ai._reasoning_param()
        except Exception:
            reasoning = None
        max_tokens = cad_authoring_max_tokens(self.ai.model)
        for turn in range(self.max_turns):
            self._raise_if_canceled()
            capped = self._stop_if_budget_hit(turn)
            if capped is not None:
                return capped
            self._emit(
                "ai_source",
                f"Text to Cad · agent turn {turn + 1}/{self.max_turns}…",
                authoring_loop_pct(turn, self.max_turns, lo=22, hi=70),
            )
            t0 = time.perf_counter()
            create_kwargs: dict[str, Any] = {
                "model": self.ai.model,
                "input": input_items,
                "tools": _responses_tools(
                    self.prompt, use_mcmaster_parts=self.use_mcmaster_parts
                ),
                "max_output_tokens": max_tokens,
            }
            if reasoning:
                create_kwargs.update(reasoning)
            with _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="jake-oai-resp") as pool:
                fut = pool.submit(self.ai.client.responses.create, **create_kwargs)
                try:
                    response = self.ai._wait_future(fut)
                except Exception as exc:
                    usage = getattr(exc, "usage", None) or {}
                    if not usage and getattr(exc, "openai_response", None) is not None:
                        usage = usage_from_openai_response(getattr(exc, "openai_response"))
                    trace = {
                        "provider": self.ai.provider if self.ai.provider in {"openai", "xai", "kimi", "gemini", "qwen"} else "openai",
                        "api": "responses.tools",
                        "model": self.ai.model,
                        "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                        "turn": turn + 1,
                        "error": str(exc),
                    }
                    if usage:
                        trace["usage"] = usage
                        trace["cost_usd"] = estimate_cost_usd(
                            self.ai.model,
                            usage,
                            provider=trace["provider"],
                        )
                    self._append_ai_trace(trace)
                    raise
            usage = usage_from_openai_response(response)
            trace = {
                "provider": self.ai.provider if self.ai.provider in {"openai", "xai", "kimi", "gemini", "qwen"} else "openai",
                "api": "responses.tools",
                "model": self.ai.model,
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                "turn": turn + 1,
            }
            if usage:
                trace["usage"] = usage
                trace["cost_usd"] = estimate_cost_usd(
                    self.ai.model,
                    usage,
                    provider=trace["provider"],
                )
            self._append_ai_trace(trace)
            output = list(getattr(response, "output", None) or [])
            if not output:
                input_items.append(
                    {"role": "user", "content": "Continue with tools. Call finish when step+inspect+snapshot passed."}
                )
                continue
            # Append model output as-is for conversation continuity.
            input_items.extend(output)
            function_calls = [item for item in output if getattr(item, "type", None) == "function_call"]
            if not function_calls:
                input_items.append(
                    {"role": "user", "content": "Use tools only (write_file/str_replace/run_step/…). Then finish."}
                )
                continue
            for fc in function_calls:
                name = getattr(fc, "name", "") or ""
                call_id = getattr(fc, "call_id", None) or getattr(fc, "id", "")
                raw_args = getattr(fc, "arguments", None) or "{}"
                try:
                    args = json.loads(raw_args)
                except json.JSONDecodeError:
                    args = {}
                result = self._exec_tool(name, args if isinstance(args, dict) else {})
                input_items.append(
                    {
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": result,
                    }
                )
                if self.finished:
                    return self._success_payload()
        published = self._publish_closest_model(
            reason=f"Published at loop cap ({self.max_turns} turns)."
        )
        if published is not None:
            return published
        raise RuntimeError(
            f"Authoring agent exhausted {self.max_turns} turns without a STEP/GLB to publish. "
            f"step={self.last_step_ok} inspect={self.last_inspect_ok} snapshot={self.last_snapshot_ok}"
        )

    def _run_anthropic(self) -> dict[str, Any]:
        import httpx

        messages: list[dict[str, Any]] = [{"role": "user", "content": self._user_kickoff()}]
        system = self._system_prompt()
        for turn in range(self.max_turns):
            self._raise_if_canceled()
            capped = self._stop_if_budget_hit(turn)
            if capped is not None:
                return capped
            self._emit(
                "ai_source",
                f"Text to Cad · agent turn {turn + 1}/{self.max_turns}…",
                authoring_loop_pct(turn, self.max_turns, lo=22, hi=70),
            )
            t0 = time.perf_counter()
            payload = {
                "model": self.ai.model,
                "max_tokens": 32768 if any(
                    token in str(self.ai.model or "").lower()
                    for token in ("opus", "fable", "mythos")
                ) else 8192,
                "system": system,
                "tools": _anthropic_tools(
                    self.prompt, use_mcmaster_parts=self.use_mcmaster_parts
                ),
                "messages": messages,
            }
            # Fable/Mythos always think; medium effort keeps tool-loop costs closer to tracked usage.
            model_l = str(self.ai.model or "").lower()
            if any(token in model_l for token in ("fable", "mythos")):
                payload["output_config"] = {"effort": "medium"}
            response = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.ai.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=payload,
                timeout=model_hard_timeout_seconds(self.ai.model),
            )
            response.raise_for_status()
            data = response.json()
            usage = usage_from_anthropic_response(data)
            trace = {
                "provider": "anthropic",
                "api": "messages.tools",
                "model": self.ai.model,
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                "turn": turn + 1,
            }
            if usage:
                trace["usage"] = usage
                trace["cost_usd"] = estimate_cost_usd(self.ai.model, usage, provider="anthropic")
            self._append_ai_trace(trace)
            content = data.get("content") or []
            messages.append({"role": "assistant", "content": content})
            tool_uses = [block for block in content if block.get("type") == "tool_use"]
            if not tool_uses:
                messages.append(
                    {
                        "role": "user",
                        "content": "Continue using tools only. Call finish when validation passed.",
                    }
                )
                continue
            tool_results = []
            for block in tool_uses:
                result = self._exec_tool(block.get("name") or "", block.get("input") or {})
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.get("id"),
                        "content": result,
                    }
                )
                if self.finished:
                    return self._success_payload()
            messages.append({"role": "user", "content": tool_results})
        published = self._publish_closest_model(
            reason=f"Published at loop cap ({self.max_turns} turns)."
        )
        if published is not None:
            return published
        raise RuntimeError(
            f"Authoring agent exhausted {self.max_turns} turns without a STEP/GLB to publish. "
            f"step={self.last_step_ok} inspect={self.last_inspect_ok} snapshot={self.last_snapshot_ok}"
        )

    def _success_payload(self) -> dict[str, Any]:
        assert self.finished is not None
        extra: dict[str, Any] = {}
        try:
            from backend.services.cad_harness import finalize_harness_run

            extra = finalize_harness_run(
                self.project_path,
                published_step=self.finished.get("step"),
                is_edit=bool(self.is_edit),
            ) or {}
        except Exception:
            extra = {}
        return {
            "ok": True,
            "source": self.finished["source"],
            "step": self.finished["step"],
            "glb": self.finished["glb"],
            "summary": self.finished.get("summary") or "",
            "ai_traces": self.ai_traces,
            "runtime": "jake_tool_agent",
            **extra,
        }


def run_jake_tool_agent(**kwargs: Any) -> dict[str, Any]:
    agent = JakeToolAgent(**kwargs)
    try:
        return agent.run()
    except Exception as exc:
        setattr(exc, "ai_traces", list(agent.ai_traces))
        raise
