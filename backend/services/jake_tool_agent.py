"""Jake-style tool-using CAD authoring agent.

Mirrors upstream text-to-cad (Codex / Claude Code) inside Render3D:

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
from typing import Any, Callable

from backend.services.ai_cost import estimate_cost_usd, usage_from_anthropic_response, usage_from_openai_response
from backend.services.ai_service import AIService, uses_openai_responses_api
from backend.services.cad_authoring_agent import (
    build_snapshot_job,
    classify_cli_failure,
    collect_snapshot_pngs,
    needs_multi_view_packet,
    write_snapshot_job_file,
)
from backend.services.trace_log import add as trace_add

ProgressCb = Callable[[dict[str, Any]], None] | None
CancelCb = Callable[[], bool] | None
UsageCb = Callable[[list[dict[str, Any]]], None] | None

AGENT_TOOLS = [
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


def _anthropic_tools() -> list[dict[str, Any]]:
    out = []
    for tool in AGENT_TOOLS:
        fn = tool["function"]
        out.append(
            {
                "name": fn["name"],
                "description": fn["description"],
                "input_schema": fn["parameters"],
            }
        )
    return out


def _responses_tools() -> list[dict[str, Any]]:
    out = []
    for tool in AGENT_TOOLS:
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
    """Only allow bare filenames inside the project directory."""
    name = Path(str(rel or "").strip()).name
    if not name or name in {".", ".."}:
        raise ValueError(f"Invalid path: {rel}")
    return (project_path / name).resolve()


def _tail(text: str, n: int = 3500) -> str:
    text = text or ""
    return text if len(text) <= n else text[-n:]


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
        max_turns: int = 28,
        cancel_check: CancelCb = None,
        progress_callback: ProgressCb = None,
        usage_callback: UsageCb = None,
        model_electronics: bool = True,
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
        self.cancel_check = cancel_check
        self.progress_callback = progress_callback
        self.usage_callback = usage_callback
        self.model_electronics = bool(model_electronics)
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
            text = (skill_dir / "SKILL.md").read_text(encoding="utf-8", errors="ignore")
            marker = "<!-- render3d-studio -->"
            if marker in text:
                text = text.split(marker, 1)[0]
            return text[:12000]
        except Exception:
            return ""

    def _system_prompt(self) -> str:
        mode = "EDIT/REVISE an existing generator" if self.is_edit else "CREATE a new part"
        electronics_rule = ""
        if self.model_electronics:
            electronics_rule = (
                "- When the prompt mentions motors/servos/ESC/battery/wiring/electronics: model visible "
                "labeled electronics solids and wire runs — not empty pockets alone.\n"
            )
        return (
            "You are a Jake-style CAD authoring agent (earthtojake/text-to-cad skill contract).\n"
            f"Task mode: {mode}.\n"
            "Work ONLY via tools. Do not return markdown code fences as your final answer — write files with tools.\n"
            "Required workflow:\n"
            "1) Read/create the build123d Python generator with gen_step() (assembled layout)\n"
            "2) For multi-part assemblies also define gen_exploded() (spaced BOM/layout)\n"
            "3) run_step on that generator (auto-exports assembled + {stem}_exploded sidecars)\n"
            "4) On failure: classify, str_replace the smallest fix, rerun_step\n"
            "5) run_inspect on the STEP\n"
            "6) run_snapshot (mandatory)\n"
            "7) finish with source/step/glb names when gates pass\n"
            "Rules:\n"
            "- Millimeters. gen_step() returns the assembled STEP-ready shape/compound; no file writes inside gen_step().\n"
            "- Prefer str_replace over write_file for repairs.\n"
            "- Never assign bare floats to *_positions / list constants "
            "(wrong: rod_hole_positions = 10.0). Use lists of (x,y) or GridLocations.\n"
            "- Keep labels and working geometry on edits.\n"
            f"{electronics_rule}"
            f"Target files: source={self.source_name}, step={self.step_name}, glb={self.glb_name}.\n\n"
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
        return "\n".join(parts)

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
            if name == "list_files":
                pattern = str(args.get("glob") or "*")
                files = sorted(self.project_path.glob(pattern))[:80]
                return json.dumps({"files": [p.name for p in files if p.is_file()]})
            if name == "read_file":
                path = _safe_rel(self.project_path, str(args.get("path") or ""))
                if not path.is_file():
                    return json.dumps({"error": f"missing file {path.name}"})
                text = path.read_text(encoding="utf-8", errors="ignore")
                max_chars = int(args.get("max_chars") or 20000)
                return json.dumps({"path": path.name, "content": text[:max_chars]})
            if name == "write_file":
                path = _safe_rel(self.project_path, str(args.get("path") or ""))
                content = str(args.get("content") or "")
                if path.suffix.lower() == ".py":
                    self._emit("ai_source", f"Writing {path.name}…", 22)
                path.write_text(content.rstrip() + "\n", encoding="utf-8")
                return json.dumps({"ok": True, "path": path.name, "bytes": path.stat().st_size})
            if name == "str_replace":
                path = _safe_rel(self.project_path, str(args.get("path") or ""))
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
                return self._run_step(str(args.get("source") or self.source_name))
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
        step = f"{stem}.step"
        glb = f"{stem}.glb"
        stl = f"{stem}.stl"
        three = f"{stem}.3mf"
        self.source_name, self.step_name, self.glb_name = source_path.name, step, glb
        self._emit("step", f"Running scripts/step on {source_path.name}…", 40)
        out = skill_runner.run_skill_tool(
            "cad",
            "step",
            [source_path.name, "-o", step, "--glb", glb, "--stl", stl, "--3mf", three, "--force"],
            cwd=self.project_path,
            timeout_sec=240.0,
            cancel_check=self.cancel_check,
        )
        ok = bool(out.get("ok"))
        self.last_step_ok = ok
        if ok:
            self.last_inspect_ok = False
            self.last_snapshot_ok = False
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
        self._emit("inspect", f"Inspecting {step_path.name}…", 78)
        out = skill_runner.run_skill_tool(
            "cad",
            "inspect",
            ["refs", step_path.name, "--facts", "--planes", "--positioning"],
            cwd=self.project_path,
            timeout_sec=90.0,
            cancel_check=self.cancel_check,
        )
        ok = bool(out.get("ok"))
        self.last_inspect_ok = ok
        detail = _tail((out.get("stdout") or "") + "\n" + (out.get("stderr") or ""))
        return json.dumps({"ok": ok, "step": step_path.name, "output_tail": detail})

    def _run_snapshot(self, step: str, base: str) -> str:
        from backend.services import skill_runner

        step_path = _safe_rel(self.project_path, step)
        if not step_path.is_file():
            return json.dumps({"error": f"step missing: {step}"})
        safe_base = re.sub(r"[^a-zA-Z0-9_-]+", "_", base).strip("_") or step_path.stem
        source = ""
        src_path = self.project_path / self.source_name
        if src_path.is_file():
            source = src_path.read_text(encoding="utf-8", errors="ignore")
        self._emit("snapshot", f"Rendering snapshot packet for {step_path.name}…", 90)
        multi = needs_multi_view_packet(self.prompt, source, None)
        job = build_snapshot_job(step_name=step_path.name, base=safe_base, multi_view=multi)
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
            simple = build_snapshot_job(step_name=step_path.name, base=safe_base, multi_view=False)
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
        return json.dumps({"ok": ok, "files": files, "output_tail": detail})

    def run(self) -> dict[str, Any]:
        self._emit("brief", "Jake tool agent starting authoring loop…", 12)
        if self.ai.provider == "anthropic":
            return self._run_anthropic()
        return self._run_openai()

    def _run_openai(self) -> dict[str, Any]:
        model = self.ai.model
        # GPT-5.5 / GPT-5.6 Sol must use Responses tools — chat.completions under-drives
        # the CAD skill loop and is a common cause of weak Sol geometry.
        if uses_openai_responses_api(model):
            return self._run_openai_responses()
        return self._run_openai_chat()

    def _run_openai_chat(self) -> dict[str, Any]:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._system_prompt()},
            {"role": "user", "content": self._user_kickoff()},
        ]
        for turn in range(self.max_turns):
            self._raise_if_canceled()
            self._emit("ai_source", f"Agent turn {turn + 1}/{self.max_turns}…", min(70, 16 + turn * 2))
            t0 = time.perf_counter()
            completion = self.ai.client.chat.completions.create(
                model=self.ai.model,
                messages=messages,
                tools=AGENT_TOOLS,
                tool_choice="auto",
                max_completion_tokens=8192,
            )
            usage = usage_from_openai_response(completion)
            trace = {
                "provider": "openai",
                "api": "chat.completions.tools",
                "model": self.ai.model,
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                "turn": turn + 1,
            }
            if usage:
                trace["usage"] = usage
                trace["cost_usd"] = estimate_cost_usd(self.ai.model, usage, provider="openai")
            self._append_ai_trace(trace)
            msg = completion.choices[0].message
            tool_calls = msg.tool_calls or []
            if not tool_calls:
                # Nudge the model to use tools rather than prose.
                messages.append({"role": "assistant", "content": msg.content or ""})
                messages.append(
                    {
                        "role": "user",
                        "content": "Continue using tools only. If validation already passed, call finish.",
                    }
                )
                continue
            messages.append(
                {
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"},
                        }
                        for tc in tool_calls
                    ],
                }
            )
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
        raise RuntimeError(
            f"Jake tool agent exhausted {self.max_turns} turns without finish(). "
            "Last gates: "
            f"step={self.last_step_ok} inspect={self.last_inspect_ok} snapshot={self.last_snapshot_ok}"
        )

    def _run_openai_responses(self) -> dict[str, Any]:
        """OpenAI Responses API tool loop (GPT-5.5 / GPT-5.6 Sol and peers)."""
        input_items: list[dict[str, Any]] = [
            {"role": "system", "content": self._system_prompt()},
            {"role": "user", "content": self._user_kickoff()},
        ]
        reasoning = None
        try:
            reasoning = self.ai._reasoning_param()
        except Exception:
            reasoning = None
        for turn in range(self.max_turns):
            self._raise_if_canceled()
            self._emit("ai_source", f"Agent turn {turn + 1}/{self.max_turns}…", min(70, 16 + turn * 2))
            t0 = time.perf_counter()
            create_kwargs: dict[str, Any] = {
                "model": self.ai.model,
                "input": input_items,
                "tools": _responses_tools(),
                "max_output_tokens": 8192,
            }
            if reasoning:
                create_kwargs.update(reasoning)
            response = self.ai.client.responses.create(**create_kwargs)
            usage = usage_from_openai_response(response)
            trace = {
                "provider": "openai",
                "api": "responses.tools",
                "model": self.ai.model,
                "elapsed_ms": int((time.perf_counter() - t0) * 1000),
                "turn": turn + 1,
            }
            if usage:
                trace["usage"] = usage
                trace["cost_usd"] = estimate_cost_usd(self.ai.model, usage, provider="openai")
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
        raise RuntimeError(
            f"Jake tool agent exhausted {self.max_turns} turns without finish(). "
            f"step={self.last_step_ok} inspect={self.last_inspect_ok} snapshot={self.last_snapshot_ok}"
        )

    def _run_anthropic(self) -> dict[str, Any]:
        import httpx

        messages: list[dict[str, Any]] = [{"role": "user", "content": self._user_kickoff()}]
        system = self._system_prompt()
        for turn in range(self.max_turns):
            self._raise_if_canceled()
            self._emit("ai_source", f"Agent turn {turn + 1}/{self.max_turns}…", min(70, 16 + turn * 2))
            t0 = time.perf_counter()
            payload = {
                "model": self.ai.model,
                "max_tokens": 8192,
                "system": system,
                "tools": _anthropic_tools(),
                "messages": messages,
            }
            response = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.ai.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=payload,
                timeout=None,
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
        raise RuntimeError(
            f"Jake tool agent exhausted {self.max_turns} turns without finish(). "
            f"step={self.last_step_ok} inspect={self.last_inspect_ok} snapshot={self.last_snapshot_ok}"
        )

    def _success_payload(self) -> dict[str, Any]:
        assert self.finished is not None
        return {
            "ok": True,
            "source": self.finished["source"],
            "step": self.finished["step"],
            "glb": self.finished["glb"],
            "summary": self.finished.get("summary") or "",
            "ai_traces": self.ai_traces,
            "runtime": "jake_tool_agent",
        }


def run_jake_tool_agent(**kwargs: Any) -> dict[str, Any]:
    return JakeToolAgent(**kwargs).run()
