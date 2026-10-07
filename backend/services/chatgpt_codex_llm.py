"""One-shot Codex CLI completion for ChatGPT-subscription CAD (no API key).

Used when VibeCAD / Mesh / image→DXF need an LLM and the user is signed in with ChatGPT
device-auth (per-user CODEX_HOME). Jake 2.0 already shells to the CAD plugin;
this helper is the generic Codex `codex exec` path those engines share (including
GPT-6 Astra / Astra Pro).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from backend.services.cad_harness import write_prompt_images
from backend.services.codex_agent import (
    CodexUnavailable,
    DEFAULT_TIMEOUT_SEC,
    _event_activity,
    _kill_proc,
    _venv_bin,
    codex_cli_failure_message,
    looks_like_codex_jsonl,
    resolve_codex_bin,
    usage_from_codex_events,
)
from backend.services.trace_log import add as trace_add

UsageCb = Optional[Callable[[dict[str, int]], None]]
CancelCb = Optional[Callable[[], bool]]
ProgressCb = Optional[Callable[[dict[str, Any]], None]]
ReadyCb = Optional[Callable[[], bool]]


def trace_for_codex_usage(
    model: str | None,
    usage: dict[str, int] | None,
    *,
    trace_id: str | None = None,
    elapsed_ms: int | None = None,
    images: int = 0,
) -> dict[str, Any]:
    """Build an AI trace so the loading overlay can show subscription cost."""
    from backend.services.ai_cost import estimate_cost_usd

    model_id = str(model or "").strip() or "chatgpt"
    cost = (
        estimate_cost_usd(
            model_id,
            usage,
            provider="openai",
            apply_long_context=False,
        )
        if usage
        else None
    )
    trace: dict[str, Any] = {
        "stage": "codex_llm",
        "model": model_id,
        "provider": "openai",
        "billing_source": "chatgpt_subscription",
        "trace_id": trace_id,
        "images": images,
    }
    if elapsed_ms is not None:
        trace["elapsed_ms"] = elapsed_ms
    if usage:
        trace["usage"] = usage
    if cost is not None:
        trace["cost_usd"] = cost
    return trace


def _stage_skill_pack(work: Path, skill_id: str) -> None:
    """Copy a skill pack into the Codex temp cwd so SKILL.md opens succeed.

    Codex runs with workspace-write in a throwaway directory. Opening the
    studio-absolute ``backend/skills/<id>/SKILL.md`` from that sandbox is
    ENOENT even when the file exists on disk.
    """
    try:
        from backend.services.skills_service import bundled_skill_markdown, get_skill_dir
    except Exception:
        return
    skill_dir = None
    try:
        skill_dir = get_skill_dir(skill_id)
    except Exception:
        skill_dir = None
    dest = work / "backend" / "skills" / skill_id
    try:
        dest.mkdir(parents=True, exist_ok=True)
        skill_md = dest / "SKILL.md"
        wrote_md = False
        src_md = (skill_dir / "SKILL.md") if skill_dir else None
        if src_md is not None and src_md.is_file():
            try:
                skill_md.write_bytes(src_md.read_bytes())
                wrote_md = True
            except OSError:
                wrote_md = False
        if not wrote_md:
            body = bundled_skill_markdown(skill_id)
            if body:
                skill_md.write_text(body, encoding="utf-8")
        if skill_dir:
            readme = skill_dir / "README.md"
            if readme.is_file():
                (dest / "README.md").write_bytes(readme.read_bytes())
            refs = skill_dir / "references"
            if refs.is_dir():
                dest_refs = dest / "references"
                dest_refs.mkdir(exist_ok=True)
                for path in refs.glob("*.md"):
                    (dest_refs / path.name).write_bytes(path.read_bytes())
    except OSError:
        return


def _run_codex_exec(
    *,
    launch: Any,
    work: Path,
    prompt: str,
    trace_id: str | None = None,
    timeout_sec: float | None = None,
    usage_callback: UsageCb = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    require_text: bool = True,
    image_count: int = 0,
    log_label: str = "Codex LLM complete",
    ready_check: ReadyCb = None,
    pipeline: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """Run one ``codex exec`` in ``work`` and return (assistant_text, call_trace)."""
    from backend.services.codex_agent import CodexUnavailable

    home = getattr(launch, "home", None)
    if not home:
        raise CodexUnavailable(
            "Sign in with ChatGPT under Subscriptions so CAD can use Codex, "
            "or add an OpenAI API key."
        )
    codex = resolve_codex_bin()
    if not codex:
        raise CodexUnavailable("Codex CLI not found. Install Codex or set CODEX_BIN.")

    work = Path(work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    from backend.services.codex_launch_env import codex_launch_env

    env = codex_launch_env(dict(getattr(launch, "env", None) or {}))
    venv_bin = _venv_bin()
    if venv_bin:
        env["PATH"] = f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"
        env["VIRTUAL_ENV"] = str(venv_bin.parent)
    env["CODEX_HOME"] = str(home)
    env["TERM"] = env.get("TERM") or "dumb"
    if getattr(launch, "pop_openai_key", True):
        env.pop("OPENAI_API_KEY", None)
    env["INIT_CWD"] = str(work)
    env["PWD"] = str(work)

    last_message = work / "codex_last_message.txt"
    if last_message.exists():
        try:
            last_message.unlink()
        except OSError:
            pass
    cmd = [
        str(codex),
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-C",
        str(work),
        "-s",
        "workspace-write",
        "--dangerously-bypass-approvals-and-sandbox",
        "--ephemeral",
        "-o",
        str(last_message),
        "-",
    ]
    extra = list(getattr(launch, "extra_cli", None) or [])
    if extra:
        cmd[-1:-1] = extra
    cli_model = getattr(launch, "cli_model", None)
    model = cli_model
    if cli_model:
        cmd.insert(-1, "-m")
        cmd.insert(-1, str(cli_model))

    timeout = float(timeout_sec or DEFAULT_TIMEOUT_SEC)
    started = time.time()
    trace_add(
        "info",
        f"{log_label} model={cli_model or 'chatgpt-default'} images={int(image_count)}",
        trace_id=trace_id,
    )
    proc = subprocess.Popen(
        cmd,
        cwd=str(work),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None
    try:
        proc.stdin.write(prompt)
        proc.stdin.close()
    except Exception:
        pass

    stderr_chunks: list[str] = []
    stop_reader = threading.Event()

    def _read_stderr() -> None:
        assert proc.stderr is not None
        try:
            for line in proc.stderr:
                stderr_chunks.append(line)
                if stop_reader.is_set():
                    break
        except Exception:
            return

    err_thread = threading.Thread(target=_read_stderr, name="codex-llm-stderr", daemon=True)
    err_thread.start()

    ready_hit = threading.Event()
    stop_watch = threading.Event()

    def _watch_ready() -> None:
        if not ready_check:
            return
        while not stop_watch.is_set():
            if proc.poll() is not None:
                return
            try:
                if ready_check():
                    ready_hit.set()
                    _kill_proc(proc)
                    return
            except Exception:
                pass
            stop_watch.wait(0.4)

    watch_thread: threading.Thread | None = None
    if ready_check:
        watch_thread = threading.Thread(
            target=_watch_ready, name="codex-ready-watch", daemon=True
        )
        watch_thread.start()

    events: list[dict[str, Any]] = []
    last_usage_sig: tuple[int, int, int] | None = None

    def _push_usage() -> None:
        nonlocal last_usage_sig
        if not usage_callback:
            return
        usage = usage_from_codex_events(events)
        if not usage:
            return
        sig = (
            int(usage.get("input_tokens") or 0),
            int(usage.get("output_tokens") or 0),
            int(usage.get("total_tokens") or 0),
        )
        if sig == last_usage_sig:
            return
        last_usage_sig = sig
        try:
            usage_callback(usage)
        except Exception:
            pass

    deadline = time.monotonic() + timeout
    try:
        while True:
            if cancel_check and cancel_check():
                _kill_proc(proc)
                raise RuntimeError("Generation canceled.")
            if time.monotonic() > deadline:
                _kill_proc(proc)
                raise RuntimeError("Codex exec timed out.")
            if proc.poll() is not None:
                rest = proc.stdout.read() or ""
                for line in rest.splitlines():
                    raw = line.strip()
                    if not raw.startswith("{"):
                        continue
                    try:
                        event = json.loads(raw)
                    except Exception:
                        continue
                    if isinstance(event, dict):
                        events.append(event)
                        _emit_codex_activity(
                            event,
                            progress_callback=progress_callback,
                            pipeline=pipeline,
                        )
                _push_usage()
                break
            line = proc.stdout.readline()
            if not line:
                time.sleep(0.05)
                continue
            raw = line.strip()
            if not raw.startswith("{"):
                continue
            try:
                event = json.loads(raw)
            except Exception:
                continue
            if isinstance(event, dict):
                events.append(event)
                _emit_codex_activity(
                    event,
                    progress_callback=progress_callback,
                    pipeline=pipeline,
                )
                _push_usage()
    finally:
        stop_watch.set()
        stop_reader.set()
        try:
            proc.wait(timeout=2)
        except Exception:
            _kill_proc(proc)
        err_thread.join(timeout=1.0)
        if watch_thread is not None:
            watch_thread.join(timeout=1.0)

    text = ""
    if last_message.is_file():
        try:
            text = last_message.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            text = ""
    if looks_like_codex_jsonl(text):
        text = ""
    if not text:
        for event in reversed(events):
            item = event.get("item") if isinstance(event.get("item"), dict) else {}
            if str(event.get("type") or "") == "item.completed" and str(item.get("type") or "") == "agent_message":
                text = str(item.get("text") or "").strip()
                if text:
                    break
    if ready_hit.is_set() and not text:
        text = "VibeCAD source complete. Host worker will compile."
    fail = None if ready_hit.is_set() else codex_cli_failure_message(
        text=text,
        events=events,
        stderr="".join(stderr_chunks),
        auth_label=getattr(launch, "auth_label", None),
    )
    if fail:
        raise RuntimeError(fail)
    if not ready_hit.is_set() and proc.returncode not in (0, None) and not text:
        err = ("".join(stderr_chunks) or "Codex exec failed").strip()
        raise RuntimeError(err[:2000] or "Codex exec failed")
    if require_text and not text and not ready_hit.is_set():
        raise RuntimeError("Codex returned an empty response.")
    elapsed_ms = int((time.time() - started) * 1000)
    usage = usage_from_codex_events(events)
    trace = trace_for_codex_usage(
        cli_model or model,
        usage,
        trace_id=trace_id,
        elapsed_ms=elapsed_ms,
        images=int(image_count),
    )
    return text, trace


def _emit_codex_activity(
    event: dict[str, Any],
    *,
    progress_callback: ProgressCb = None,
    pipeline: str | None = None,
) -> None:
    stage, text, is_thinking = _event_activity(event)
    if text and is_thinking:
        try:
            from backend.services.ai_service import emit_generation_thinking

            emit_generation_thinking(text, stage=stage or "ai_source")
        except Exception:
            pass
    if not (text and progress_callback):
        return
    payload: dict[str, Any] = {
        "stage": stage or "authoring",
        "label": text[:400],
        "thinking": text[:4000],
    }
    pipe = str(pipeline or "").strip().lower()
    if pipe:
        payload["pipeline"] = pipe
    if is_thinking:
        payload["thinking_append"] = text[:2000]
    try:
        progress_callback(payload)
    except Exception:
        pass


def complete(
    *,
    user_id: str,
    system_prompt: str,
    user_content: str,
    images: list[dict[str, Any]] | None = None,
    json_response: bool = False,
    trace_id: str | None = None,
    timeout_sec: float | None = None,
    model: str | None = None,
    usage_callback: UsageCb = None,
    cancel_check: CancelCb = None,
    lightweight: bool = False,
    reasoning_effort: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """Run ``codex exec`` in a throwaway cwd and return (assistant_text, call_trace)."""
    from types import SimpleNamespace

    from backend.services.cad_host_runtime import resolve_codex_launch

    work = Path(tempfile.mkdtemp(prefix="r3d-codex-llm-"))
    launch = resolve_codex_launch(
        SimpleNamespace(
            billing_source="chatgpt_subscription",
            billing_user_id=user_id,
            model=model,
            provider="openai",
            api_key="",
            reasoning_effort=reasoning_effort,
        ),
        user_id=user_id,
        project_path=work,
    )
    if not lightweight:
        _stage_skill_pack(work, "vibecad")
        _stage_skill_pack(work, "img2threejs")
    else:
        launch.extra_cli = [*launch.extra_cli, "-c", 'model_reasoning_effort="low"']
    written = write_prompt_images(work, images)
    image_note = ""
    if written:
        from backend.services.prompt_references import image_caption

        names = [item.get("name") or item.get("path") or "image" for item in written]
        captions = "\n".join(f"- {image_caption(str(n))}" for n in names)
        image_note = (
            f"\n\nAttached reference images are in this workspace under ref_images/ ({', '.join(names)}).\n"
            f"{captions}\n"
            "Open each file and apply that role. Read them TOGETHER with the prompt — "
            "a canvas sketch explains layout; a photo of extrusion/hardware is usually a mate target."
        )
    json_note = "\n\nReturn JSON only. No markdown fences." if json_response else ""
    skill_note = (
        "\n\nSkill files for this run are already in this workspace under backend/skills/. "
        "Do not open studio-absolute paths such as /Users/.../backend/skills/.../SKILL.md."
    )
    if lightweight:
        skill_note = "\nThe supplied JSON contains all available geometry. Return only the bounded edit plan. Do not inspect files, run commands or use tools."
    prompt = (
        f"{str(system_prompt or '').strip()}\n\n"
        f"{str(user_content or '').strip()}"
        f"{image_note}{skill_note}{json_note}\n"
    )
    try:
        return _run_codex_exec(
            launch=launch,
            work=work,
            prompt=prompt,
            trace_id=trace_id,
            timeout_sec=timeout_sec,
            usage_callback=usage_callback,
            cancel_check=cancel_check,
            require_text=True,
            image_count=len(written),
            log_label="Codex LLM complete",
        )
    finally:
        if lightweight:
            shutil.rmtree(work, ignore_errors=True)


def exec_in_workspace(
    *,
    project_path: Path,
    prompt: str,
    images: list[dict[str, Any]] | None = None,
    trace_id: str | None = None,
    timeout_sec: float | None = None,
    usage_callback: UsageCb = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    ai: Any = None,
    user_id: str | None = None,
    model: str | None = None,
    ready_check: ReadyCb = None,
    pipeline: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """One Codex / Cursor / Claude agent session in the project workspace."""
    from types import SimpleNamespace

    from backend.services.cad_host_runtime import resolve_codex_launch

    work = Path(project_path).resolve()
    work.mkdir(parents=True, exist_ok=True)
    stub = ai or SimpleNamespace(
        billing_source="chatgpt_subscription",
        billing_user_id=user_id,
        model=model,
        provider="openai",
        api_key="",
    )
    billing = str(getattr(stub, "billing_source", "") or "")
    if billing in {"cursor_subscription", "claude_subscription"}:
        from backend.services.cli_subscription_ai import cli_host_id
        from backend.services.cli_subscription_llm import exec_in_workspace as cli_exec

        return cli_exec(
            host=cli_host_id(stub),
            project_path=work,
            prompt=prompt,
            images=images,
            trace_id=trace_id,
            timeout_sec=timeout_sec,
            usage_callback=usage_callback,
            cancel_check=cancel_check,
            progress_callback=progress_callback,
            user_id=str(getattr(stub, "billing_user_id", None) or user_id or ""),
            model=str(getattr(stub, "model", None) or model or ""),
            ready_check=ready_check,
        )
    launch = resolve_codex_launch(stub, user_id=user_id, project_path=work)
    _stage_skill_pack(work, "vibecad")
    _stage_skill_pack(work, "img2threejs")
    written = write_prompt_images(work, images)
    image_note = ""
    if written:
        from backend.services.prompt_references import image_caption

        names = [item.get("name") or item.get("path") or "image" for item in written]
        captions = "\n".join(f"- {image_caption(str(n))}" for n in names)
        image_note = (
            f"\n\nAttached reference images are in this workspace under ref_images/ ({', '.join(names)}).\n"
            f"{captions}\n"
            "Open each file and apply that role. Read them TOGETHER with the prompt — "
            "a canvas sketch explains layout; a photo of extrusion/hardware is usually a mate target."
        )
    skill_note = (
        "\n\nSkill files for this run are already in this workspace under backend/skills/. "
        "Read VIBECAD.md / img2threejs SKILL.md when those files are present. "
        "Do not open studio-absolute skill paths."
    )
    return _run_codex_exec(
        launch=launch,
        work=work,
        prompt=f"{str(prompt or '').strip()}{image_note}{skill_note}\n",
        trace_id=trace_id,
        timeout_sec=timeout_sec,
        usage_callback=usage_callback,
        cancel_check=cancel_check,
        progress_callback=progress_callback,
        require_text=False,
        image_count=len(written),
        log_label="Codex workspace exec",
        ready_check=ready_check,
        pipeline=pipeline,
    )
