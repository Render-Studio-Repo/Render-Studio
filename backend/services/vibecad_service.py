"""VibeCAD mode: gutted build123d authoring from 10-X-eng/vibecad → Render Studio.

Mirrors how Jake Mode 2.0 was wired: keep the product shell (prompt jobs, viewport,
BYOK LLM), vendor their isolated build123d worker + authoring contract, and publish
STEP → GLB into the existing Three.js viewer.

Mode ``v2`` (Jake) is untouched — this path only runs when ``mode=vibecad``.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

from backend.services.ai_service import AIService
from backend.services.trace_log import add as trace_add

ProgressCb = Callable[[dict[str, Any]], None] | None
CancelCb = Callable[[], bool] | None
UsageCb = Callable[[list[dict[str, Any]]], None] | None

WORKER = (
    Path(__file__).resolve().parent.parent
    / "skills"
    / "vibecad"
    / "scripts"
    / "build123d_worker.py"
)

VIBECAD_SYSTEM = """You are VibeCAD, a principal mechanical design engineer authoring parametric CAD
for Render Studio through an isolated build123d 0.11 sidecar (gutted from 10-X-eng/vibecad).

The current user message is the authority. A simple solid that only resembles the request is a failure.

Write complete build123d Python source that:
- Uses millimetres
- Receives driving dimensions as the `params` dict and optional STEP imports as `inputs`
- Assigns a non-empty ordered dict[str, Shape] to `result`
- Keys of `result` must exactly match `expected_outputs` (same order)
- Each value is a valid single-solid build123d Shape (one independently editable component)
- Makes alignment and placement explicit; assert critical datums / dimensions when useful
- Does NOT import exporters, write files, or call network/IO

Output JSON only:
{
  "model_name": "HumanReadableName",
  "source": "<complete python source assigning result>",
  "parameters": {"key": number_or_string, ...},
  "expected_outputs": ["PartA", "PartB"]
}

For a new substantial design, prefer one coherent component or a small set of named solids
(not dozens of crumbs). Prefer defensible engineering defaults over asking questions.
"""

VIBECAD_REPAIR_SYSTEM = """You are repairing a VibeCAD build123d program for Render Studio.

Return JSON only with the same schema as creation:
{"model_name","source","parameters","expected_outputs"}

Fix the smallest exact cause of the worker failure. Keep working geometry.
Do not invent exporter calls or filesystem writes. Millimetres. result dict keys must
exactly match expected_outputs in order; each value one solid Shape.
"""


def _progress(cb: ProgressCb, stage: str, pct: int, label: str) -> None:
    if cb:
        cb(
            {
                "stage": stage,
                "pct": pct,
                "label": label,
                "thinking": label,
                "activity": [{"text": label, "stage": stage}],
            }
        )


def _slug(value: str, fallback: str = "part") -> str:
    slug = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip()).strip("_")
    return slug[:48] or fallback


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
        raise ValueError("model did not return a JSON object")
    return data


def _site_packages() -> Path:
    import build123d

    return Path(build123d.__file__).resolve().parents[1]


def _build123d_version() -> str:
    import build123d

    return str(getattr(build123d, "__version__", "") or "0.11.0")


def _run_worker(
    *,
    project_path: Path,
    stem: str,
    source: str,
    parameters: dict[str, Any],
    expected_outputs: list[str],
    cancel_check: CancelCb = None,
    timeout_sec: float = 240.0,
) -> dict[str, Any]:
    if not WORKER.is_file():
        raise RuntimeError(f"VibeCAD worker missing: {WORKER}")
    work = project_path / ".vibecad_work" / stem
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    out_dir = work / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    req_path = work / "request.json"
    res_path = work / "result.json"
    req_path.write_text(
        json.dumps(
            {
                "build123d_version": _build123d_version(),
                "source": source,
                "parameters": parameters or {},
                "inputs": {},
                "expected_outputs": expected_outputs,
                "output_directory": str(out_dir),
                "memory_limit_bytes": 0,
                "cpu_limit_seconds": 0,
                "output_limit_bytes": 0,
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )
    cmd = [
        sys.executable,
        "-I",
        "-S",
        str(WORKER),
        str(req_path),
        str(res_path),
        str(_site_packages()),
    ]
    started = time.monotonic()
    proc = subprocess.Popen(
        cmd,
        cwd=str(work),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        while True:
            if cancel_check and cancel_check():
                proc.kill()
                raise RuntimeError("Generation canceled.")
            if proc.poll() is not None:
                break
            if time.monotonic() - started > timeout_sec:
                proc.kill()
                raise RuntimeError("VibeCAD build123d worker timed out")
            time.sleep(0.15)
        stdout, stderr = proc.communicate(timeout=5)
    except RuntimeError:
        raise
    except Exception:
        proc.kill()
        raise

    payload: dict[str, Any] = {}
    if res_path.is_file():
        try:
            payload = json.loads(res_path.read_text(encoding="utf-8"))
        except Exception as exc:
            payload = {"ok": False, "error": f"could not parse worker result: {exc}"}
    if not payload:
        payload = {
            "ok": False,
            "error": f"worker exited {proc.returncode}",
            "stdout": (stdout or "")[-2000:],
            "stderr": (stderr or "")[-2000:],
        }
    payload["_work_dir"] = str(work)
    return payload


def _publish_outputs(
    project_path: Path,
    stem: str,
    worker_result: dict[str, Any],
) -> dict[str, Any]:
    from backend.services import cad_service

    outputs = worker_result.get("outputs") or []
    if not outputs:
        raise RuntimeError("VibeCAD worker produced no STEP outputs")

    part_steps: list[str] = []
    part_glbs: list[str] = []
    primary_step = project_path / f"{stem}.step"
    primary_glb = project_path / f"{stem}.glb"
    source_name = f"{stem}.vibecad.py"

    # Prefer a multi-solid compound when several named outputs exist.
    shapes_for_compound = []
    try:
        from build123d import Compound, import_step

        for index, item in enumerate(outputs):
            key = _slug(str(item.get("key") or f"part{index+1}"))
            src = Path(str(item.get("step_path") or ""))
            if not src.is_file():
                continue
            part_step_name = f"{stem}__part_{index+1:02d}_{key}.step"
            part_step = project_path / part_step_name
            shutil.copy2(src, part_step)
            part_steps.append(part_step_name)
            shapes_for_compound.append(import_step(str(part_step)))
            part_glb_name = f"{stem}__part_{index+1:02d}_{key}.glb"
            try:
                cad_service.tessellate_step_to_glb(part_step, project_path / part_glb_name)
                part_glbs.append(part_glb_name)
            except Exception:
                pass
        if len(shapes_for_compound) == 1:
            shutil.copy2(project_path / part_steps[0], primary_step)
        elif shapes_for_compound:
            compound = Compound(children=shapes_for_compound)
            # Reuse worker exporter path via temporary single-output worker is heavy;
            # write STEP with OCP like the worker.
            from OCP.IFSelect import IFSelect_RetDone
            from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer

            writer = STEPControl_Writer()
            status = writer.Transfer(compound.wrapped, STEPControl_AsIs)
            if status != IFSelect_RetDone:
                raise RuntimeError(f"compound STEP transfer failed: {status}")
            status = writer.Write(str(primary_step))
            if status != IFSelect_RetDone:
                raise RuntimeError(f"compound STEP write failed: {status}")
        else:
            raise RuntimeError("no valid STEP outputs to publish")
    except Exception:
        # Fallback: first part becomes primary.
        if not part_steps:
            raise
        shutil.copy2(project_path / part_steps[0], primary_step)

    cad_service.tessellate_step_to_glb(primary_step, primary_glb)
    return {
        "source": source_name,
        "step": primary_step.name,
        "glb": primary_glb.name,
        "parts_step": part_steps,
        "parts_glb": part_glbs,
    }


def run_vibecad(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: AIService,
    *,
    trace_id: str | None = None,
    images: list[dict[str, Any]] | None = None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
    max_repairs: int = 8,
) -> dict[str, Any]:
    """Author VibeCAD build123d source, run isolated worker, publish STEP/GLB."""
    project_path = Path(project_path)
    project_path.mkdir(parents=True, exist_ok=True)
    ctx = context or {}
    is_edit = bool(previous_source) or bool(ctx.get("target_mode") == "edit")
    base = Path(previous_source_name).stem if previous_source_name else ""
    if not base:
        from backend.services.project_store import title_from_prompt

        title = title_from_prompt(prompt) or "VibeCAD Model"
        base = _slug(title, "vibecad_model")
    # Avoid clobbering Jake `.py` generators — VibeCAD sources use `.vibecad.py`.
    if base.endswith(".vibecad"):
        stem = base[: -len(".vibecad")] or "vibecad_model"
    else:
        stem = base
    source_name = f"{stem}.vibecad.py"
    source_path = project_path / source_name

    ai_traces: list[dict[str, Any]] = []

    def _sync_usage() -> None:
        if usage_callback and ai_traces:
            usage_callback(list(ai_traces))

    def _canceled() -> bool:
        return bool(cancel_check and cancel_check())

    budget = max(1, int(max_repairs))
    last_error = ""
    program: dict[str, Any] | None = None
    published: dict[str, Any] | None = None
    attempts = 0

    _progress(progress_callback, "analyze", 8, "VibeCAD · analyzing prompt…")
    edit_line = (
        f"EDIT the existing VibeCAD model `{source_name}` — revise in place.\n"
        if is_edit
        else "NEW model — create a fresh parametric build123d program.\n"
    )
    user_brief = (
        f"{edit_line}"
        f"User request:\n{prompt.strip()}\n"
    )
    if previous_source and previous_source.strip():
        user_brief += (
            "\nExisting source to revise:\n"
            f"```python\n{previous_source[:14000]}\n```\n"
        )

    for attempt in range(budget):
        if _canceled():
            if published and (project_path / published["glb"]).is_file():
                break
            raise RuntimeError("Generation canceled.")

        attempts = attempt + 1
        _progress(
            progress_callback,
            "generate",
            min(55, 12 + attempt * 7),
            f"VibeCAD · authoring build123d (try {attempts}/{budget})…",
        )

        repair = ""
        if last_error:
            repair = f"\n\nPrevious worker/authoring failure — fix and return full JSON:\n{last_error[:4000]}\n"
            system = VIBECAD_REPAIR_SYSTEM
        else:
            system = VIBECAD_SYSTEM

        try:
            text, trace = ai._call_model(
                system,
                user_brief + repair,
                trace_id=trace_id,
                images=images if attempt == 0 else None,
                max_tokens=12000,
                json_response=True,
                allow_truncated=False,
            )
            if isinstance(trace, dict):
                ai_traces.append(trace)
                _sync_usage()
            program = _strip_json(text)
        except Exception as exc:
            last_error = str(exc)
            trace_add("error", f"[VibeCAD] authoring failed: {exc}", trace_id=trace_id)
            continue

        source = str(program.get("source") or "").strip()
        parameters = program.get("parameters") if isinstance(program.get("parameters"), dict) else {}
        expected = [str(x) for x in (program.get("expected_outputs") or []) if str(x).strip()]
        model_name = str(program.get("model_name") or stem)
        if not source or "result" not in source:
            last_error = "Authoring JSON missing build123d source that assigns `result`."
            continue
        if not expected:
            # Infer keys from a simple result = {...} literal when possible.
            expected = ["Part"]
            program["expected_outputs"] = expected

        source_path.write_text(source.rstrip() + "\n", encoding="utf-8")
        meta_path = project_path / f"{stem}.vibecad.json"
        meta_path.write_text(
            json.dumps(
                {
                    "model_name": model_name,
                    "parameters": parameters,
                    "expected_outputs": expected,
                    "runtime": "vibecad-build123d",
                    "source": source_name,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        _progress(progress_callback, "step", min(78, 50 + attempt * 4), "VibeCAD · running build123d worker…")
        try:
            worker_result = _run_worker(
                project_path=project_path,
                stem=stem,
                source=source,
                parameters=parameters,
                expected_outputs=expected,
                cancel_check=cancel_check,
            )
        except RuntimeError as exc:
            if "canceled" in str(exc).lower():
                raise
            last_error = str(exc)
            continue

        if not worker_result.get("ok"):
            last_error = (
                str(worker_result.get("error") or "build123d worker failed")
                + "\n"
                + str(worker_result.get("traceback") or "")[:2500]
            )
            trace_add(
                "warning",
                f"[VibeCAD] worker failed (try {attempts}): {last_error[:400]}",
                trace_id=trace_id,
            )
            continue

        _progress(progress_callback, "export", 88, "VibeCAD · publishing STEP/GLB to viewport…")
        try:
            published = _publish_outputs(project_path, stem, worker_result)
            break
        except Exception as exc:
            last_error = f"publish failed: {exc}"
            trace_add("warning", f"[VibeCAD] publish failed: {exc}", trace_id=trace_id)
            published = None
            continue

    if not published or not (project_path / published["glb"]).is_file():
        raise RuntimeError(last_error or "VibeCAD generation failed")

    from backend.services.project_store import apply_prompt_project_name, title_from_prompt

    display_name = str((program or {}).get("model_name") or title_from_prompt(prompt) or stem)
    apply_prompt_project_name(project_path, prompt, fallback=display_name)

    _progress(progress_callback, "done", 100, "VibeCAD model ready")
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
        "message": f"{'Updated' if is_edit else 'Built'} {display_name} with the VibeCAD build123d engine.",
        "specs_used": [{"source": "vibecad", "script": published["source"]}],
        "result": {
            "program": {
                "name": display_name,
                "source": "vibecad",
                "source_file": published["source"],
                "entrypoint": "result",
            },
            "primary": published["glb"],
            "basename": stem,
            "files": files,
            "parts": [
                {"name": Path(name).stem, "filename": name}
                for name in (published.get("parts_glb") or [])
            ],
            "text_to_cad": {
                "runtime": "vibecad_build123d",
                "authoring_agent": True,
                "worker": "skills/vibecad/scripts/build123d_worker.py",
            },
        },
        "attempts": max(1, attempts),
        "ai_trace": ai_traces,
        "dfm_warnings": [],
        "primary": published["glb"],
        "filename": published["glb"],
    }
