"""MAC (Multi-Agent-CAD) Mode 2.0 harness.

Vendors Pan-Chera/Multi-Agent-CAD and runs its headless ``web_runner`` so
Mode 2.0 prompts publish STEP/GLB into the existing viewport — same shell as
Jake / VibeCAD, distinct pipeline.

Mode ``v2`` (Jake) and ``vibecad`` are untouched — this path only runs when
``mode=mac`` (aliases: multi_agent_cad, multi-agent-cad, macad).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional

from backend.services.ai_service import AIService
from backend.services.cad_harness import enrich_user_request, stage_project_drawings, write_prompt_images
from backend.services.trace_log import add as trace_add

ProgressCb = Optional[Callable[[dict[str, Any]], None]]
CancelCb = Optional[Callable[[], bool]]
UsageCb = Optional[Callable[[list[dict[str, Any]]], None]]

REPO_ROOT = Path(__file__).resolve().parents[2]
VENDOR_MAC = REPO_ROOT / "vendor" / "multi-agent-cad"
MAC_GITHUB = "https://github.com/Pan-Chera/Multi-Agent-CAD.git"


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


def _mac_python() -> str:
    """Python 3.11+ for LangGraph. Prefer ``.venv-mac``, then ``MAC_PYTHON``.

    The studio process often still runs 3.9. MAC's GraphState uses ``X | None``
    unions that crash ``typing.get_type_hints`` on 3.9, so we must not use
    ``sys.executable`` unless it is already 3.11+.
    """
    env = (os.environ.get("MAC_PYTHON") or "").strip()
    candidates = []
    if env:
        candidates.append(Path(env).expanduser())
    candidates.append(REPO_ROOT / ".venv-mac" / "bin" / "python")
    candidates.append(REPO_ROOT / ".venv-mac" / "Scripts" / "python.exe")
    for path in candidates:
        if path.is_file() or path.is_symlink():
            # Do not Path.resolve() — .venv-mac/bin/python is a symlink to the
            # uv base interpreter; following it drops the venv site-packages.
            return str(path)
    if sys.version_info >= (3, 11):
        return sys.executable
    raise RuntimeError(
        "MAC needs Python 3.11+ (LangGraph). The studio process is "
        f"{sys.version.split()[0]}. Create the dedicated env: "
        "uv venv --python 3.12 .venv-mac && uv pip install --python .venv-mac/bin/python "
        "'langgraph>=0.2,<0.3' build123d openai pydantic trimesh && "
        "uv pip install --python .venv-mac/bin/python -e vendor/multi-agent-cad --no-deps"
    )


def ensure_mac_vendor() -> Path:
    """Return the Multi-Agent-CAD checkout; shallow-clone if missing."""
    marker = VENDOR_MAC / "multi_agent_cad" / "web_runner.py"
    if marker.is_file():
        return VENDOR_MAC
    VENDOR_MAC.parent.mkdir(parents=True, exist_ok=True)
    if VENDOR_MAC.exists() and not marker.is_file():
        shutil.rmtree(VENDOR_MAC, ignore_errors=True)
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", MAC_GITHUB, str(VENDOR_MAC)],
            check=True,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except Exception as exc:
        raise RuntimeError(
            "Multi-Agent-CAD vendor missing and clone failed. "
            f"Clone manually: git clone {MAC_GITHUB} {VENDOR_MAC} ({exc})"
        ) from exc
    if not marker.is_file():
        raise RuntimeError(f"Multi-Agent-CAD clone incomplete: {VENDOR_MAC}")
    return VENDOR_MAC


def _openai_compat_base(ai: AIService) -> str:
    base = getattr(ai, "base_url", None) or None
    if base:
        return str(base).rstrip("/")
    # Known OpenAI-compatible providers
    mapping = {
        "openai": "https://api.openai.com/v1",
        "xai": "https://api.x.ai/v1",
        "kimi": "https://api.moonshot.ai/v1",
        "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
        "qwen": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "local": "http://127.0.0.1:11434/v1",
        "ollama": "http://127.0.0.1:11434/v1",
    }
    return mapping.get(ai.provider, "https://api.openai.com/v1")


def _mac_loop_cap(context: dict[str, Any] | None, fallback: int = 4) -> int:
    try:
        turns = (context or {}).get("max_turns")
        if turns is not None:
            return max(1, int(turns))
    except (TypeError, ValueError):
        pass
    try:
        return max(1, int(fallback))
    except (TypeError, ValueError):
        return 4


def _mac_config_for_ai(ai: AIService, prompt: str, *, max_retries: int = 4) -> dict[str, Any]:
    """Build MAC config.json overrides from the user's active AI key."""
    model = str(ai.model or "gpt-4o").strip() or "gpt-4o"
    base = _openai_compat_base(ai)
    # Clear Qwen-only thinking toggles for non-DashScope endpoints.
    kwargs: dict[str, Any] = {}
    if "dashscope" in base or "aliyun" in base or "aliyuncs" in base or model.lower().startswith("qwen"):
        kwargs = {"extra_body": {"enable_thinking": False}}
    elif "kimi-k3" in model.lower() or (model.lower().startswith("kimi") and model.lower().endswith("k3")):
        # K3 rejects temperature and K2 `thinking`; effort=max blanks CAD output.
        kwargs = {"reasoning_effort": "high", "max_completion_tokens": 32768}
    aider_model = model if "/" in model else f"openai/{model}"
    return {
        "DS_BASE_URL": base,
        "USER_REQUEST": prompt,
        "WORKFLOW_ID": "original",
        "SPEC_PLANNER_MODEL": model,
        "ARCHITECT_MODEL": model,
        "CODER_MODEL": model,
        "REPAIR_MODEL": model,
        "AIDER_MODEL": aider_model,
        "SPEC_PLANNER_KWARGS": kwargs,
        "ARCHITECT_KWARGS": kwargs,
        "CODER_KWARGS": kwargs,
        "REPAIR_KWARGS": kwargs,
        "API_KEY_ENV_VAR": "OPENAI_API_KEY",
        "API_BASE_ENV_VAR": "OPENAI_API_BASE",
        # Headless: auto-iterate checkpoints quickly.
        "CHECKPOINT_INPUT_TIMEOUT": 1,
        "MAX_RETRIES": max(1, int(max_retries)),
        "MAX_EXEC_RETRIES": 2,
    }


def _publish_step(
    project_path: Path,
    stem: str,
    step_src: Path,
    py_src: Path | None,
    progress_callback: ProgressCb = None,
) -> dict[str, Any]:
    from backend.services import cad_service
    from backend.services.live_preview import emit_live_preview

    primary_step = project_path / f"{stem}.step"
    primary_glb = project_path / f"{stem}.glb"
    source_name = f"{stem}.mac.py"
    shutil.copy2(step_src, primary_step)
    if py_src and py_src.is_file():
        shutil.copy2(py_src, project_path / source_name)
    else:
        (project_path / source_name).write_text(
            "# Generated by Multi-Agent-CAD (MAC)\n",
            encoding="utf-8",
        )
    cad_service.tessellate_step_to_glb(primary_step, primary_glb)
    emit_live_preview(
        progress_callback,
        primary_glb,
        label="MAC · drawing in viewport…",
        stage="export",
        pct=92,
    )
    meta = {
        "runtime": "multi-agent-cad",
        "source": source_name,
        "upstream": "https://github.com/Pan-Chera/Multi-Agent-CAD",
    }
    (project_path / f"{stem}.mac.json").write_text(
        json.dumps(meta, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "source": source_name,
        "step": primary_step.name,
        "glb": primary_glb.name,
        "parts_step": [primary_step.name],
        "parts_glb": [primary_glb.name] if primary_glb.is_file() else [],
    }


def _stage_mac_docs(project_path: Path) -> None:
    src = VENDOR_MAC / "multi_agent_cad" / "build123d_reference.md"
    dest = project_path / "MAC_BUILD123D.md"
    if src.is_file() and not dest.is_file():
        try:
            shutil.copy2(src, dest)
        except OSError:
            pass
    agents = project_path / "AGENTS.md"
    if not agents.is_file():
        agents.write_text(
            "This is a Render Studio Multi-Agent-CAD (MAC) project.\n"
            "Codex is the host. Use cadpy / `python scripts/step`, inspect, snapshot.\n"
            "Follow MAC_BUILD123D.md (Align.MIN for stacked primitives).\n"
            "Write a gen_step() generator. Do not call OpenAI HTTP or LangGraph.\n",
            encoding="utf-8",
        )


def _run_mac_codex_host(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: AIService,
    *,
    trace_id: str | None = None,
    images: list[Any] | None = None,
    previous_source: str | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
) -> dict[str, Any]:
    from backend.services.cad_harness import enrich_user_request, stage_project_drawings, write_prompt_images
    from backend.services.codex_agent import run_codex_agent
    from backend.services.project_store import apply_prompt_project_name, title_from_prompt

    project_path = Path(project_path)
    project_path.mkdir(parents=True, exist_ok=True)
    ctx = context or {}
    display = title_from_prompt(prompt) or _slug(project_path.name, "mac_part")
    stem = _slug(display, "mac_part")
    source_name = f"{stem}.py"
    if previous_source and previous_source.strip():
        (project_path / source_name).write_text(previous_source.rstrip() + "\n", encoding="utf-8")
    try:
        ensure_mac_vendor()
    except Exception:
        pass
    _stage_mac_docs(project_path)
    stage_project_drawings(project_path, project_path)
    write_prompt_images(project_path, images)
    brief = enrich_user_request(
        prompt,
        ctx,
        project_path,
        images=images,
        previous_source=previous_source,
    )
    cad_brief = (
        "Multi-Agent-CAD (MAC) mode. Codex is the host tool loop; MAC provides "
        "cadpy / scripts/step / inspect / snapshot and MAC_BUILD123D.md.\n"
        "Do not start LangGraph or call OpenAI HTTP.\n\n"
        f"{brief}"
    )
    _progress(progress_callback, "authoring", 18, "MAC · Codex host session…")
    traces: list[dict[str, Any]] = []

    def on_usage(usage: dict[str, int]) -> None:
        from backend.services.chatgpt_codex_llm import trace_for_codex_usage

        traces.append(
            trace_for_codex_usage(getattr(ai, "model", None), usage, trace_id=trace_id)
        )
        if usage_callback:
            try:
                usage_callback(list(traces))
            except Exception:
                pass

    result = run_codex_agent(
        project_path=project_path,
        prompt=prompt,
        cad_brief=cad_brief,
        source_name=source_name,
        step_name=f"{stem}.step",
        glb_name=f"{stem}.glb",
        previous_source=previous_source,
        is_edit=bool(previous_source),
        cancel_check=cancel_check,
        progress_callback=progress_callback,
        usage_callback=on_usage,
        trace_id=trace_id,
        model=str(getattr(ai, "model", None) or "").strip() or None,
        user_id=str(ctx.get("user_id") or getattr(ai, "billing_user_id", "") or "") or None,
        ai=ai,
    )
    step_path = project_path / result["step"]
    py_path = project_path / result["source"]
    published = _publish_step(project_path, stem, step_path, py_path, progress_callback)
    apply_prompt_project_name(project_path, prompt, fallback=display)
    try:
        from backend.services.cad_harness import finalize_harness_run

        finalize_harness_run(project_path)
    except Exception:
        pass
    _progress(progress_callback, "done", 100, "MAC (Codex) model ready")
    return {
        "ok": True,
        "mode": "mac",
        "pipeline": "multi_agent_cad",
        "source": published["source"],
        "step": published["step"],
        "glb": published["glb"],
        "model_name": display,
        "mac": {
            "error_type": "",
            "tokens": (result.get("usage") or {}).get("total_tokens"),
            "api_calls": 1,
            "upstream": MAC_GITHUB,
            "runtime": "codex_host",
        },
        "ai_traces": traces,
        "primary": published["glb"],
        "filename": published["glb"],
        "intent": "generative",
        "result": {
            "primary": published["glb"],
            "files": {
                "source": published["source"],
                "step": published["step"],
                "glb": published["glb"],
            },
            "text_to_cad": {"runtime": "codex_host", "codex_host": True},
        },
    }


def run_mac(
    prompt: str,
    project_path: Path,
    context: dict[str, Any] | None,
    ai: AIService,
    *,
    trace_id: str | None = None,
    images: list[Any] | None = None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,  # noqa: ARG001
    max_repairs: int = 4,
) -> dict[str, Any]:
    """Run Multi-Agent-CAD and publish STEP/GLB into ``project_path``."""
    from backend.services.cad_host_runtime import choose_mac_runtime

    ctx = context or {}
    if choose_mac_runtime(ctx, ai) == "codex_host":
        return _run_mac_codex_host(
            prompt,
            project_path,
            ctx,
            ai,
            trace_id=trace_id,
            images=images,
            previous_source=previous_source,
            cancel_check=cancel_check,
            progress_callback=progress_callback,
            usage_callback=usage_callback,
        )
    del previous_source_name
    vendor = ensure_mac_vendor()
    stem = _slug(Path(project_path).name, "mac_part")
    # Prefer a short stem from prompt title when project folder is opaque.
    from backend.services.project_store import apply_prompt_project_name, title_from_prompt

    display = title_from_prompt(prompt) or stem
    stem = _slug(display, stem)

    work = project_path / ".mac_work" / stem
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    stage_project_drawings(project_path, work)
    ref_images = write_prompt_images(work, images)

    cfg = _mac_config_for_ai(
        ai,
        enrich_user_request(
            prompt,
            ctx,
            project_path,
            images=images,
            previous_source=previous_source,
        ),
        max_retries=_mac_loop_cap(ctx, max_repairs),
    )
    if ref_images:
        cfg["REFERENCE_IMAGES"] = ref_images

    config_path = work / "config.json"
    config_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    api_key = str(getattr(ai, "api_key", "") or "").strip() or "local-no-key-required"
    base = str(cfg["DS_BASE_URL"])
    mac_py = _mac_python()
    mac_venv = REPO_ROOT / ".venv-mac"
    env = {
        **os.environ,
        "MAC_CONFIG_FILE": str(config_path),
        "DASHSCOPE_API_KEY": api_key,
        "OPENAI_API_KEY": api_key,
        "OPENAI_API_BASE": base,
        "PYTHONUNBUFFERED": "1",
        "PYTHONPATH": str(vendor) + os.pathsep + os.environ.get("PYTHONPATH", ""),
    }
    if mac_venv.is_dir() and str(mac_venv) in mac_py.replace("\\", "/"):
        env["VIRTUAL_ENV"] = str(mac_venv)
        env["PATH"] = str(mac_venv / "bin") + os.pathsep + env.get("PATH", "")

    cmd = [
        mac_py,
        "-m",
        "multi_agent_cad.web_runner",
        "--config",
        str(config_path),
        "--out",
        str(work),
        "--workflow",
        "original",
    ]

    _progress(progress_callback, "analyze", 8, "MAC · Spec Planner…")
    trace_add(
        "info",
        f"[MAC] starting Multi-Agent-CAD web_runner python={mac_py} model={cfg.get('CODER_MODEL')}",
        trace_id=trace_id,
    )

    proc = subprocess.Popen(
        cmd,
        cwd=str(work),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    result: dict[str, Any] | None = None
    last_error: dict[str, Any] | None = None
    log_tail: list[str] = []
    stage_pct = {
        "planner": 18,
        "architect": 36,
        "coder": 55,
        "autonomous_skill_loop": 78,
    }
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            if cancel_check and cancel_check():
                proc.terminate()
                try:
                    proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill()
                raise RuntimeError("Generation canceled.")
            line = (raw or "").rstrip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                if len(log_tail) < 48:
                    log_tail.append(line[:500])
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("error"):
                last_error = msg
                trace_add("warning", f"[MAC] {msg.get('error')}", trace_id=trace_id)
            stage = str(msg.get("stage") or "")
            if stage in stage_pct:
                label = {
                    "planner": "MAC · Spec Planner…",
                    "architect": "MAC · Geometric Architect…",
                    "coder": "MAC · Python Coder…",
                    "autonomous_skill_loop": "MAC · QA / Aider repair…",
                }.get(stage, f"MAC · {stage}")
                _progress(progress_callback, stage, stage_pct[stage], label)
            if msg.get("done"):
                result = msg
                break
        proc.wait(timeout=10)
    except RuntimeError:
        raise
    except Exception as exc:
        try:
            proc.kill()
        except Exception:
            pass
        # Fall through and harvest whatever is already on disk.
        result = result or {"error": str(exc)}

    if result is None:
        crash = (last_error or {}).get("error") or (last_error or {}).get("traceback")
        tail = "\n".join(log_tail[-12:])
        detail = crash or tail or f"rc={getattr(proc, 'returncode', None)}"
        result = {
            "error": f"MAC runner exited without artifacts ({detail})",
            "error_type": (last_error or {}).get("error_type"),
            "traceback": (last_error or {}).get("traceback"),
        }

    err_type = str(result.get("error_type") or "").upper()
    step_path = Path(str(result.get("step") or ""))
    if not step_path.is_file():
        steps = sorted(
            [p for p in work.rglob("*.step") if p.is_file()],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if steps:
            step_path = steps[0]
    if not step_path.is_file():
        detail = err_type or result.get("error") or "no STEP produced"
        raise RuntimeError(f"MAC did not produce a STEP model ({detail})")

    py_path = Path(str(result.get("py") or ""))
    if not py_path.is_file():
        pys = sorted(
            [p for p in work.rglob("*.py") if p.is_file()],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        py_path = pys[0] if pys else None

    _progress(progress_callback, "export", 90, "MAC · publishing closest STEP/GLB…")
    published = _publish_step(
        project_path, stem, step_path, py_path if isinstance(py_path, Path) else None, progress_callback
    )
    apply_prompt_project_name(project_path, prompt, fallback=display)
    try:
        from backend.services.cad_harness import finalize_harness_run

        finalize_harness_run(project_path)
    except Exception:
        pass
    _progress(progress_callback, "done", 100, "MAC model ready")

    tokens = result.get("tokens")
    api_calls = result.get("api_calls")
    trace_add(
        "info",
        f"[MAC] published {published.get('glb')} (tokens={tokens}, calls={api_calls}, err={err_type})",
        trace_id=trace_id,
    )

    return {
        "ok": True,
        "mode": "mac",
        "pipeline": "multi_agent_cad",
        "source": published["source"],
        "step": published["step"],
        "glb": published["glb"],
        "model_name": display,
        "mac": {
            "error_type": err_type,
            "tokens": tokens,
            "api_calls": api_calls,
            "upstream": MAC_GITHUB,
        },
        "ai_traces": [],
        "elapsed_ms": int(time.time() * 1000),
    }
