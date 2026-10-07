"""VibeCAD host: Codex for ChatGPT/OpenAI, Anthropic HTTP for Claude keys.

Desktop VibeCAD's ChatGPT provider is Codex app-server; Render generate is
headless ``codex exec``. Claude in VibeCAD is an Anthropic API key — Render
uses the same split (one-shot HTTP into the build123d sidecar).
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from backend.services.cad_host_runtime import choose_vibecad_runtime
from backend.services.chatgpt_subscription_ai import codex_model_short_name
from backend.services.trace_log import add as trace_add
from backend.services.vibecad_gates import run_post_publish_visual_gate
from backend.services.cad_assembly_contract import CAD_ASSEMBLY_SCOPE_RULES, VIBECAD_RESULT_RULES, validate_assembly_manifest
from backend.services.vibecad_service import (
    CancelCb,
    ProgressCb,
    UsageCb,
    _auto_input_objects,
    _coerce_authoring_program,
    _context_brief,
    _is_passthrough_hardware_source,
    _lint_vibecad_source,
    _missing_required_project_references,
    _progress,
    _publish_outputs,
    _resolve_worker_inputs,
    _run_worker,
    _slug,
    _source_assigns_result,
    _source_has_helical_thread_sweep,
    _vibecad_codex_hard_fail,
    _worker_timeout_sec,
    _with_vibecad_skills,
    HELICAL_THREAD_SWEEP_HINT,
)

__all__ = [
    "choose_vibecad_runtime",
    "run_vibecad_codex_host",
    "workspace_source_ready",
    "write_compile_handoff",
    "clear_compile_handoff",
    "HANDOFF_NAME",
]

HANDOFF_NAME = ".vibecad_handoff.json"


def _expected_from_source(source: str) -> list[str]:
    keys: list[str] = []
    match = re.search(r"(?ms)^\s*result\s*=\s*\{(.*?)^\s*\}", str(source or ""))
    blob = match.group(1) if match else ""
    for key in re.findall(r"""['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*:""", blob):
        if key not in keys:
            keys.append(key)
    return keys


def _handoff_path(project_path: Path) -> Path:
    return Path(project_path) / HANDOFF_NAME


def write_compile_handoff(project_path: Path, *, source_name: str, stem: str) -> None:
    _handoff_path(project_path).write_text(
        json.dumps({"source": source_name, "stem": stem, "reason": "source_complete"}) + "\n",
        encoding="utf-8",
    )


def clear_compile_handoff(project_path: Path) -> None:
    path = _handoff_path(project_path)
    if path.is_file():
        try:
            path.unlink()
        except OSError:
            pass


def read_compile_handoff(project_path: Path) -> dict[str, Any] | None:
    path = _handoff_path(project_path)
    if not path.is_file():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return loaded if isinstance(loaded, dict) else None


def _vibecad_meta_path(project_path: Path, source_name: str, stem: str) -> Path:
    source_path = Path(project_path) / source_name
    nested = source_path.with_name(f"{stem}.vibecad.json")
    root = Path(project_path) / f"{stem}.vibecad.json"
    if nested.is_file() or source_path.parent != Path(project_path):
        return nested
    return root


def _authoring_block_reason(meta: dict[str, Any]) -> str | None:
    """Return the author-declared terminal validation failure, if any."""
    status = str(meta.get("status") or "").strip().lower()
    publication = meta.get("publication") if isinstance(meta.get("publication"), dict) else {}
    blocked = status.startswith("blocked") or publication.get("allowed") is False
    if not blocked:
        return None
    reason = str(publication.get("reason") or meta.get("error") or status or "Authoring blocked publication").strip()
    return reason[:1000]


def workspace_source_ready(
    project_path: Path,
    *,
    source_name: str,
    stem: str,
    min_stable_sec: float = 8.0,
    not_before: float | None = None,
) -> bool:
    """True when deliverable source is complete and not still being rewritten."""
    source_path = Path(project_path) / source_name
    meta_path = _vibecad_meta_path(project_path, source_name, stem)
    if not source_path.is_file():
        return False
    try:
        source = source_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    if not _source_assigns_result(source):
        return False
    if _lint_vibecad_source(source, compile_gate=False):
        return False
    now = time.time()
    src_mtime = source_path.stat().st_mtime
    if now - src_mtime < float(min_stable_sec):
        return False
    if not_before is not None and src_mtime < (float(not_before) - 1.0):
        return False
    if meta_path.is_file() and now - meta_path.stat().st_mtime < float(min_stable_sec):
        return False
    return True


def _worker_error_needs_reauthor(message: str, source: str = "") -> bool:
    blob = str(message or "").lower()
    if "canceled" in blob or "cancelled" in blob:
        return False
    helix = _source_has_helical_thread_sweep(source)
    if "timed out" in blob:
        return helix
    if "exited -11" in blob or "sigsegv" in blob or "segmentation" in blob:
        return True
    needles = (
        "brep_api: command not done",
        "standard_failure",
        "standard_constructionerror",
        "std fail",
        "brepfill",
        "brepoffsetapi",
        "syntaxerror",
        "nameerror",
        "importerror",
        "import is not allowed in build123d source",
        "attributeerror",
        "typeerror",
        "valueerror",
        "assertionerror",
        "must assign",
        "result keys must exactly match",
        "not a build123d shape",
        "exactly one solid",
        "not a valid shape",
        "step round-trip validation failed",
        "source is empty",
        "must author the requested part",
        "passthrough",
        "vibecad source must assign",
        "do not sweep helix",
    )
    return any(n in blob for n in needles)


def _annotate_worker_failure(message: str, source: str = "") -> str:
    text = str(message or "").strip()
    blob = text.lower()
    if "import is not allowed in build123d source: cadgen" in blob:
        text += (
            "\nVibeCAD supplies srgb(hex) directly in the source namespace. "
            "Remove the cadgen import and use srgb(hex) on each leaf solid; "
            "cadgen belongs to the separate Jake engine. Preserve the geometry."
        )
    if "nameerror" in blob and "globals" in blob:
        text += (
            "\nVibeCAD supplies params and inputs directly. Use params instead of "
            "globals().get('params', {}); namespace introspection is not available."
        )
    if any(marker in blob for marker in ("brep_api: command not done", "standard_failure", "standard_constructionerror")):
        text += (
            "\nCAD kernel construction failed: repair the operation at the source traceback line, "
            "not the worker or export format. Re-running identical geometry cannot fix it. "
            "For offset/inset on a scalloped or tightly curved spline, the inward offset can "
            "self-intersect or collapse. Build the cavity, rim and mating lip from a separate "
            "valid smooth inner profile; keep decorative flutes on the exterior. Validate "
            "closed planar wires and resulting faces before loft/extrude. Preserve minimum "
            "wall thickness, mating clearances, dimensions and every required output body; "
            "do not suppress the exception, return the original face, or omit the failed feature."
        )
    if "step round-trip validation failed" in blob:
        text += (
            "\nThe exported STEP lost solid topology. Repair the named component in source, "
            "preserving its features and dimensions. For an extruded spline-offset profile, "
            "convert the offset face to ordinary B-splines before extruding/lofting "
            "(face.to_splines(tolerance=0.001), in mm); OCC offset surfaces can otherwise "
            "reopen as shells. Keep that approximation smaller than fit clearances. "
            "Do not skip validation or discard the component."
        )
    if not (
        _source_has_helical_thread_sweep(source)
        or "exited -11" in blob
        or "sigsegv" in blob
    ):
        return text
    if HELICAL_THREAD_SWEEP_HINT.lower() not in blob:
        return f"{text}\n{HELICAL_THREAD_SWEEP_HINT}"
    return text


def _write_workspace_docs(project_path: Path, source_name: str, stem: str) -> None:
    body = (
        "# VibeCAD workspace\n\n"
        "You are Codex, the VibeCAD host for Render Studio (same role as desktop "
        "VibeCAD Codex app-server).\n\n"
        f"Write `{source_name}` — complete build123d Python that assigns "
        "`result = { ... }` of named solids (mm, Z-up).\n"
        f"Also write `{Path(source_name).with_name(stem + '.vibecad.json').as_posix()}` with "
        "`model_name`, `parameters`, `expected_outputs`, `input_objects`.\n\n"
        "Read `backend/skills/vibecad/SKILL.md`.\n"
        "Do **not** emit JSON tool calls (`conversation.review_design`, "
        "`build123d.create_model`). Do **not** use Jake cadgen / `scripts/step`.\n"
        "Do **not** compile STEP/GLB yourself — the host worker runs after you stop.\n"
        + CAD_ASSEMBLY_SCOPE_RULES + "\n" + VIBECAD_RESULT_RULES + "\n"
        "Place catalog hardware via `inputs[hw_*]` and include its placed solids in result.\n"
        "Threads: do **not** `Helix`+`sweep` long trapezoidal ridges (timeout / crash). "
        "Printed screws = cylinder at major Ø + chamfers; nuts = hole at minor Ø; "
        "cosmetic grooves only (≤2 turns).\n"
        "Do **not** fuse a `Torus` onto a hollow cup (SIGSEGV). Use a short ring "
        "(outer cylinder minus inner) or a fillet for rims.\n"
        "When the Python source assigns `result = { ... }` and the JSON manifest "
        "is written, **stop immediately**. Do not inspect STEP, do not keep "
        "rewriting with shell one-liners, do not start a second authoring pass.\n"
    )
    (project_path / "VIBECAD.md").write_text(body, encoding="utf-8")
    agents = project_path / "AGENTS.md"
    if not agents.is_file():
        agents.write_text(
            "This is a Render Studio VibeCAD project. Follow VIBECAD.md.\n",
            encoding="utf-8",
        )


def _host_prompt(
    *,
    prompt: str,
    source_name: str,
    stem: str,
    is_edit: bool,
    ctx: dict[str, Any],
    project_path: Path,
    previous_source: str | None,
    skills: list[str] | None,
    last_error: str = "",
) -> str:
    edit_line = (
        f"EDIT `{source_name}` in place.\n"
        if is_edit
        else (f"REPAIR the saved `{source_name}` in place; preserve the requested design.\n" if last_error
              else f"NEW model — write `{source_name}` from scratch.\n")
    )
    packet = _context_brief(ctx, project_path, prompt=prompt)
    auto_inputs = _auto_input_objects(project_path, ctx, {}, prompt=prompt)
    parts: list[str] = [
        "You are Codex hosting VibeCAD for Render Studio.",
        "One session. Author the CAD source, then stop. Do not loop on design review.",
        "Deliverable is source only: write the two files, then stop. The host compiles.",
        CAD_ASSEMBLY_SCOPE_RULES,
        VIBECAD_RESULT_RULES,
        HELICAL_THREAD_SWEEP_HINT,
        edit_line.strip(),
        f"User request:\n{prompt.strip()}",
    ]
    if packet:
        parts.append(packet)
    if auto_inputs:
        parts.append(
            "Staged STEP inputs (use these aliases in input_objects / `inputs`):\n"
            + "\n".join(f"- {k}: {v}" for k, v in auto_inputs.items())
        )
        project_refs = [key for key in auto_inputs if key.startswith("project_ref_")]
        if project_refs:
            parts.append(
                "Verified project references are mandatory source geometry. Use "
                + ", ".join(f"inputs['{key}']" for key in project_refs)
                + " in the assembled result; do not redraw those products from primitives."
            )
        if is_edit and auto_inputs.get("selected_object"):
            parts.append("EDIT: revise inputs['selected_object'] in place.")
            parts.append(
                "Apply the user's requested dimensional/geometry change. "
                "Do not republish the previous parameters unchanged."
            )
        else:
            parts.append(
                "NEW model: mate hardware/sibling STEPs; author the requested solids. "
                "Do not only relabel inputs['selected_object'] or hw_*."
            )
    if previous_source and previous_source.strip():
        parts.append(
            f"Existing source to revise:\n```python\n{previous_source[:14000]}\n```"
        )
    if last_error:
        parts.append(f"Previous worker/authoring failure — fix `{source_name}`:\n{last_error[:4000]}")
    parts.append(
        f"Deliverables: `{source_name}` and `{Path(source_name).with_name(stem + '.vibecad.json').as_posix()}`. "
        "After both files are complete, stop — do not keep editing."
    )
    return _with_vibecad_skills("\n\n".join(parts), skills)


def _program_from_workspace(
    project_path: Path,
    *,
    stem: str,
    source_name: str,
    last_message: str,
) -> dict[str, Any]:
    source_path = project_path / source_name
    meta_path = _vibecad_meta_path(project_path, source_name, stem)
    source = ""
    if source_path.is_file():
        source = source_path.read_text(encoding="utf-8", errors="replace")
    meta: dict[str, Any] = {}
    if meta_path.is_file():
        try:
            loaded = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                meta = loaded
        except Exception:
            meta = {}
    if source and _source_assigns_result(source):
        validate_assembly_manifest(meta)
        expected = meta.get("expected_outputs") if isinstance(meta.get("expected_outputs"), list) else []
        expected = [str(x) for x in expected if str(x).strip()] or _expected_from_source(source)
        parameters = meta.get("parameters") if isinstance(meta.get("parameters"), dict) else {}
        input_objects = meta.get("input_objects") if isinstance(meta.get("input_objects"), dict) else {}
        return {
            "model_name": str(meta.get("model_name") or stem),
            "source": source,
            "parameters": parameters,
            "expected_outputs": expected or ["Part"],
            "input_objects": input_objects,
            "joints": meta.get("joints"),
            "parts_list": meta.get("parts_list"),
            "blocked_reason": _authoring_block_reason(meta),
        }
    return _coerce_authoring_program(last_message)


def _run_vibecad_codex_host_unchecked(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: Any,
    *,
    trace_id: str | None = None,
    images: list[dict[str, Any]] | None = None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
    max_repairs: int = 8,
    skills: list[str] | None = None,
) -> dict[str, Any]:
    """One Codex session writes VibeCAD source; the sidecar publishes STEP/GLB."""
    from backend.services.chatgpt_codex_llm import exec_in_workspace, trace_for_codex_usage
    from backend.services.engine_layout import artifacts_for, model_stem
    from backend.services.project_store import apply_prompt_project_name, title_from_prompt

    project_path = Path(project_path)
    project_path.mkdir(parents=True, exist_ok=True)
    ctx = context or {}
    is_edit = bool(previous_source) or bool(ctx.get("target_mode") == "edit")
    hint = str(ctx.get("base_filename") or previous_source_name or "").strip()
    base = model_stem(hint)
    if not base:
        title = title_from_prompt(prompt) or "VibeCAD Model"
        base = _slug(title, "vibecad_model")
    arts = artifacts_for(
        project_path,
        "vibecad",
        base,
        previous_source_name=previous_source_name,
        base_filename=str(ctx.get("base_filename") or "") or None,
    )
    arts.directory.mkdir(parents=True, exist_ok=True)
    stem = arts.stem
    source_name = arts.source_name
    source_path = arts.source_path
    if previous_source and previous_source.strip():
        source_path.write_text(previous_source.rstrip() + "\n", encoding="utf-8")
    _write_workspace_docs(project_path, source_name, stem)

    user_id = str(getattr(ai, "billing_user_id", "") or ctx.get("user_id") or "").strip()
    vibe_model = codex_model_short_name(getattr(ai, "model", None))

    ai_traces: list[dict[str, Any]] = []

    def _sync_usage() -> None:
        if usage_callback and ai_traces:
            usage_callback(list(ai_traces))

    def _on_codex_trace(trace: dict[str, Any]) -> None:
        if not isinstance(trace, dict):
            return
        last = ai_traces[-1] if ai_traces else None
        if (
            isinstance(last, dict)
            and last.get("stage") == "codex_llm"
            and last.get("elapsed_ms") is None
        ):
            ai_traces[-1] = trace
        else:
            ai_traces.append(trace)
        _sync_usage()

    if hasattr(ai, "set_usage_callback"):
        try:
            ai.set_usage_callback(_on_codex_trace)
        except Exception:
            pass

    # Worker failures can be sequential: a repaired source may expose the next
    # invalid component only when it compiles. Honor the configured repair budget.
    # Worker timeouts still retry the sidecar without spending an authoring turn.
    budget = max(1, min(int(max_repairs), 8))
    last_error = ""
    program: dict[str, Any] | None = None
    published: dict[str, Any] | None = None
    visual_gate: dict[str, Any] | None = None
    attempts = 0
    last_message = ""
    session_started = time.time()
    handoff = read_compile_handoff(project_path)
    skip_codex = bool(
        handoff
        and str(handoff.get("source") or "") == source_name
        and workspace_source_ready(
            project_path,
            source_name=source_name,
            stem=stem,
            min_stable_sec=0.0,
        )
    )

    def _on_codex_usage(usage: dict[str, int]) -> None:
        _on_codex_trace(trace_for_codex_usage(getattr(ai, "model", None), usage, trace_id=trace_id))

    def _ready() -> bool:
        return workspace_source_ready(
            project_path,
            source_name=source_name,
            stem=stem,
            min_stable_sec=8.0,
            not_before=session_started,
        )

    for attempt in range(budget):
        if cancel_check and cancel_check():
            raise RuntimeError("Generation canceled.")
        attempts = attempt + 1
        if skip_codex and attempt == 0:
            _progress(
                progress_callback,
                "step",
                58,
                "VibeCAD · compiling authored source…",
            )
            last_message = "VibeCAD source complete. Host worker will compile."
        else:
            skip_codex = False
            session_started = time.time()
            _progress(
                progress_callback,
                "authoring",
                min(55, 18 + attempt * 6),
                f"VibeCAD · {vibe_model} session {attempts}/{budget}…",
            )
            host_prompt = _host_prompt(
                prompt=prompt,
                source_name=source_name,
                stem=stem,
                is_edit=is_edit,
                ctx=ctx,
                project_path=project_path,
                previous_source=previous_source,
                skills=skills,
                last_error=last_error,
            )
            try:
                last_message, trace = exec_in_workspace(
                    project_path=project_path,
                    prompt=host_prompt,
                    images=images if attempt == 0 else None,
                    trace_id=trace_id,
                    ai=ai,
                    user_id=user_id,
                    usage_callback=_on_codex_usage,
                    cancel_check=cancel_check,
                    progress_callback=progress_callback,
                    ready_check=_ready,
                    pipeline="vibecad",
                )
                if isinstance(trace, dict):
                    _on_codex_trace(trace)
            except Exception as exc:
                last_error = str(exc)
                trace_add("error", f"[VibeCAD] Codex host failed: {exc}", trace_id=trace_id)
                if _vibecad_codex_hard_fail(last_error):
                    raise RuntimeError(last_error) from exc
                if not workspace_source_ready(
                    project_path,
                    source_name=source_name,
                    stem=stem,
                    min_stable_sec=0.0,
                ):
                    continue
                last_message = last_message or "VibeCAD source complete. Host worker will compile."

        try:
            program = _program_from_workspace(
                project_path,
                stem=stem,
                source_name=source_name,
                last_message=last_message,
            )
        except Exception as exc:
            last_error = str(exc)
            continue

        blocked_reason = str(program.get("blocked_reason") or "").strip()
        if blocked_reason:
            clear_compile_handoff(project_path)
            raise RuntimeError(blocked_reason)

        source = str(program.get("source") or "").strip()
        parameters = program.get("parameters") if isinstance(program.get("parameters"), dict) else {}
        expected = [str(x) for x in (program.get("expected_outputs") or []) if str(x).strip()]
        input_objects = program.get("input_objects") if isinstance(program.get("input_objects"), dict) else {}
        input_objects = _auto_input_objects(project_path, ctx, input_objects, prompt=prompt)
        model_name = str(program.get("model_name") or stem)
        lint = _lint_vibecad_source(source)
        if lint:
            last_error = lint
            continue
        missing_project_refs = _missing_required_project_references(source, input_objects)
        if missing_project_refs:
            last_error = (
                "Verified project STEP reference(s) were staged but ignored: "
                + ", ".join(missing_project_refs)
                + ". Use their inputs aliases in the assembled result instead of "
                "creating a primitive stand-in."
            )
            continue
        if not is_edit and _is_passthrough_hardware_source(source):
            last_error = (
                "NEW model must author the requested part, not wrap a staged hardware STEP."
            )
            continue
        if not expected:
            expected = _expected_from_source(source) or ["Part"]
            program["expected_outputs"] = expected

        worker_inputs = _resolve_worker_inputs(project_path, input_objects)
        source_path.write_text(source.rstrip() + "\n", encoding="utf-8")
        meta_path = project_path / f"{stem}.vibecad.json"
        meta_path.write_text(
            json.dumps(
                {
                    "model_name": model_name,
                    "parameters": parameters,
                    "expected_outputs": expected,
                    "input_objects": input_objects,
                    "runtime": "vibecad-codex-host",
                    "source": source_name,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        write_compile_handoff(project_path, source_name=source_name, stem=stem)
        worker_limit = _worker_timeout_sec(expected, source=source)
        compiled = False
        for worker_try in range(2):
            _progress(
                progress_callback,
                "step",
                min(78, 50 + attempt * 4 + worker_try),
                "VibeCAD · running build123d worker…",
            )
            try:
                worker_result = _run_worker(
                    project_path=project_path,
                    stem=stem,
                    source=source,
                    parameters=parameters,
                    expected_outputs=expected,
                    inputs=worker_inputs,
                    cancel_check=cancel_check,
                    timeout_sec=worker_limit,
                )
            except RuntimeError as exc:
                if "canceled" in str(exc).lower():
                    raise
                last_error = _annotate_worker_failure(str(exc), source)
                if worker_try == 0 and not _worker_error_needs_reauthor(last_error, source):
                    continue
                break
            worker_result = worker_result or {}
            if not worker_result.get("ok"):
                last_error = _annotate_worker_failure(
                    str(worker_result.get("error") or "build123d worker failed")
                    + "\n"
                    + str(worker_result.get("traceback") or "")[:2500],
                    source,
                )
                trace_add(
                    "warning",
                    f"[VibeCAD] worker failed (Codex host try {attempts}): {last_error[:400]}",
                    trace_id=trace_id,
                )
                if worker_try == 0 and not _worker_error_needs_reauthor(last_error, source):
                    continue
                break

            _progress(progress_callback, "export", 88, "VibeCAD · publishing STEP/GLB to viewport…")
            try:
                published = _publish_outputs(
                    project_path,
                    stem,
                    worker_result,
                    progress_callback,
                    previous_source_name=previous_source_name,
                    base_filename=str(ctx.get("base_filename") or "") or None,
                )
            except Exception as exc:
                last_error = f"publish failed: {exc}"
                published = None
                break
            compiled = True
            break
        if compiled:
            visual_gate = run_post_publish_visual_gate(
                ai=ai,
                project_path=project_path,
                prompt=prompt,
                source=source,
                published=published,
                worker_result=worker_result,
                progress_callback=progress_callback,
                trace_id=trace_id,
                cancel_check=cancel_check,
            )
            if isinstance(visual_gate.get("ai_trace"), dict):
                _on_codex_trace(visual_gate["ai_trace"])
            if visual_gate.get("ok") is True:
                break
            last_error = str(visual_gate.get("repair_note") or visual_gate.get("error") or "Visual review failed")
            published = None
            clear_compile_handoff(project_path)
            continue
        clear_compile_handoff(project_path)
        if not _worker_error_needs_reauthor(last_error, source if program else ""):
            break

    if not published or not (project_path / published["glb"]).is_file():
        clear_compile_handoff(project_path)
        raise RuntimeError(last_error or "VibeCAD Codex host generation failed")
    clear_compile_handoff(project_path)

    display_name = str((program or {}).get("model_name") or title_from_prompt(prompt) or stem)
    apply_prompt_project_name(project_path, prompt, fallback=display_name)
    try:
        from backend.services.cad_harness import finalize_harness_run

        finalize_harness_run(
            project_path,
            published_step=published.get("step"),
            is_edit=is_edit,
            joints=(program or {}).get("joints"),
            parts_list=(program or {}).get("parts_list"),
        )
    except Exception:
        pass

    _progress(progress_callback, "done", 100, f"VibeCAD ({vibe_model}) model ready")
    files: dict[str, Any] = {
        "source": published["source"],
        "step": published["step"],
        "glb": published["glb"],
        "vibecad_meta": f"{stem}.vibecad.json",
    }
    if published.get("parts_glb"):
        files["parts"] = published["parts_glb"]
    return {
        "intent": "generative",
        "message": (
            f"{'Updated' if is_edit else 'Built'} {display_name} with VibeCAD "
            f"via {vibe_model}."
        ),
        "specs_used": [{"source": "vibecad", "script": published["source"], "engine": "codex_host"}],
        "result": {
            "program": {
                "name": display_name,
                "source": "vibecad",
                "source_file": published["source"],
                "entrypoint": "result",
                "engine": "codex_host",
            },
            "primary": published["glb"],
            "basename": stem,
            "files": files,
            "parts": [
                {"name": Path(name).stem, "filename": name}
                for name in (published.get("parts_glb") or [])
            ],
            "text_to_cad": {
                "runtime": "vibecad_codex_host",
                "authoring_agent": False,
                "codex_host": True,
                "worker": "skills/vibecad/scripts/build123d_worker.py",
                "runtime_provenance": worker_result.get("runtime_provenance", {}),
                "publication_runtime_provenance": published.get("publication_runtime_provenance", {}),
                "visual_gate": visual_gate,
            },
        },
        "attempts": max(1, attempts),
        "ai_trace": ai_traces,
        "dfm_warnings": [],
        "primary": published["glb"],
        "filename": published["glb"],
    }


def run_vibecad_codex_host(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: Any,
    **kwargs: Any,
) -> dict[str, Any]:
    """Run Codex authoring without leaving failed candidates as canonical source."""
    from backend.services.engine_layout import artifacts_for, model_stem

    project_path = Path(project_path)
    ctx = context or {}
    previous_source_name = kwargs.get("previous_source_name")
    hint = str(ctx.get("base_filename") or previous_source_name or "").strip()
    base = model_stem(hint)
    if not base:
        from backend.services.project_store import title_from_prompt

        base = _slug(title_from_prompt(prompt) or "VibeCAD Model", "vibecad_model")
    arts = artifacts_for(
        project_path,
        "vibecad",
        base,
        previous_source_name=previous_source_name,
        base_filename=str(ctx.get("base_filename") or "") or None,
    )
    from backend.services.vibecad_artifact_transaction import preserve_accepted_artifacts

    with preserve_accepted_artifacts(project_path, arts.directory, arts.stem):
        return _run_vibecad_codex_host_unchecked(
            prompt,
            project_path,
            context,
            ai,
            **kwargs,
        )
