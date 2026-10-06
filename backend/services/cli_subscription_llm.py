"""One-shot Cursor Agent / Claude Code completion for subscription CAD."""

from __future__ import annotations

import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from backend.services.cad_harness import write_prompt_images
from backend.services.cli_binaries import resolve_claude_bin, resolve_cursor_agent_bin
from backend.services.codex_agent import DEFAULT_TIMEOUT_SEC, _kill_proc, _venv_bin
from backend.services.trace_log import add as trace_add

UsageCb = Optional[Callable[[dict[str, int]], None]]
CancelCb = Optional[Callable[[], bool]]
ProgressCb = Optional[Callable[[dict[str, Any]], None]]
ReadyCb = Optional[Callable[[], bool]]


class CliUnavailable(RuntimeError):
    """Cursor Agent or Claude Code is missing or not signed in."""


def _stage_skill_pack(work: Path, skill_id: str) -> None:
    from backend.services.chatgpt_codex_llm import _stage_skill_pack as _stage

    _stage(work, skill_id)


def _host_env(host: str, user_id: str) -> dict[str, str]:
    if host == "cursor":
        env = os.environ.copy()
    else:
        from backend.services.claude_cli_auth import _claude_env, user_claude_home

        env = _claude_env(user_claude_home(user_id), user_id=user_id)
    env["TERM"] = env.get("TERM") or "dumb"
    env["CI"] = "1"
    extra = [
        str(Path.home() / ".local" / "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    path = env.get("PATH") or ""
    env["PATH"] = os.pathsep.join([*extra, path] if path else extra)
    venv_bin = _venv_bin()
    if venv_bin:
        env["PATH"] = f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"
        env["VIRTUAL_ENV"] = str(venv_bin.parent)
    env.pop("ANTHROPIC_API_KEY", None)
    env.pop("OPENAI_API_KEY", None)
    env.pop("CURSOR_API_KEY", None)
    if host == "cursor":
        from backend.services.cursor_cli_auth import user_cursor_home

        home = user_cursor_home(user_id)
        env["HOME"] = str(home)
        env["AGENT_CLI_CREDENTIAL_STORE"] = "file"
        env["CURSOR_CONFIG_DIR"] = str(home / ".cursor")
        env["NO_OPEN_BROWSER"] = "1"
        env.pop("BROWSER", None)
    return env


def _command(host: str, *, work: Path, model: str | None) -> list[str]:
    if host == "cursor":
        binary = resolve_cursor_agent_bin()
        if not binary:
            raise CliUnavailable("Cursor Agent CLI not found. Install the Cursor CLI (`agent`).")
        cmd = [str(binary), "-p", "--force", "--trust", "--output-format", "text"]
        if model and str(model).strip().lower() not in {"", "auto", "default"}:
            cmd.extend(["--model", str(model).strip()])
        cmd.append("--workspace")
        cmd.append(str(work))
        return cmd
    binary = resolve_claude_bin()
    if not binary:
        raise CliUnavailable("Claude Code CLI not found. Install Claude Code (`claude`).")
    cmd = [str(binary), "-p", "--output-format", "text", "--dangerously-skip-permissions"]
    if model and str(model).strip():
        cmd.extend(["--model", str(model).strip()])
    return cmd


def _require_signed_in(host: str, user_id: str) -> None:
    if host == "cursor":
        from backend.services.cursor_cli_auth import read_cursor_auth

        if not read_cursor_auth(user_id).get("signed_in"):
            raise CliUnavailable("Sign in with Cursor under Subscriptions so CAD can use your Cursor plan.")
        return
    from backend.services.claude_cli_auth import read_claude_auth

    if not read_claude_auth(user_id).get("signed_in"):
        raise CliUnavailable("Sign in with Claude under Subscriptions so CAD can use your Claude plan.")


def _run(
    *,
    host: str,
    user_id: str,
    work: Path,
    prompt: str,
    model: str | None = None,
    trace_id: str | None = None,
    timeout_sec: float | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    ready_check: ReadyCb = None,
    log_label: str = "CLI LLM complete",
) -> tuple[str, dict[str, Any]]:
    uid = str(user_id or "").strip()
    if not uid:
        raise CliUnavailable("Sign in under Subscriptions first.")
    _require_signed_in(host, uid)
    work = Path(work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    cmd = _command(host, work=work, model=model)
    env = _host_env(host, uid)
    env["INIT_CWD"] = str(work)
    env["PWD"] = str(work)
    timeout = float(timeout_sec or DEFAULT_TIMEOUT_SEC)
    started = time.time()
    trace_add("info", f"{log_label} host={host} model={model or 'default'}", trace_id=trace_id)
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
    try:
        proc.stdin.write(prompt)
        proc.stdin.close()
    except Exception:
        pass

    stop_watch = threading.Event()
    ready_hit = threading.Event()

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

    watch: threading.Thread | None = None
    if ready_check:
        watch = threading.Thread(target=_watch_ready, name="cli-ready-watch", daemon=True)
        watch.start()

    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []

    def _read_err() -> None:
        assert proc.stderr is not None
        try:
            for line in proc.stderr:
                stderr_chunks.append(line)
                if progress_callback and line.strip():
                    try:
                        progress_callback(
                            {
                                "stage": "authoring",
                                "label": line.strip()[:400],
                                "thinking": line[:4000],
                            }
                        )
                    except Exception:
                        pass
        except Exception:
            return

    err_thread = threading.Thread(target=_read_err, name="cli-llm-stderr", daemon=True)
    err_thread.start()

    deadline = time.time() + timeout
    try:
        while True:
            if cancel_check and cancel_check():
                _kill_proc(proc)
                raise RuntimeError("Generation canceled.")
            if time.time() > deadline:
                _kill_proc(proc)
                raise RuntimeError(f"{host} timed out.")
            if proc.poll() is not None:
                break
            if proc.stdout is not None:
                piece = proc.stdout.read(256)
                if piece:
                    stdout_chunks.append(piece)
                elif proc.poll() is not None:
                    break
                else:
                    time.sleep(0.05)
            else:
                time.sleep(0.05)
    finally:
        stop_watch.set()
        if watch:
            watch.join(timeout=1)
        err_thread.join(timeout=1)

    leftover = ""
    if proc.stdout is not None:
        try:
            leftover = proc.stdout.read() or ""
        except Exception:
            leftover = ""
    text = ("".join(stdout_chunks) + leftover).strip()
    err = "".join(stderr_chunks).strip()
    elapsed_ms = int((time.time() - started) * 1000)
    if not text and ready_hit.is_set():
        text = "CAD source written."
    if not text and proc.returncode not in (0, None) and not ready_hit.is_set():
        raise RuntimeError(err or f"{host} failed (exit {proc.returncode}).")
    if not text:
        text = err
    trace: dict[str, Any] = {
        "stage": "cli_llm",
        "model": model or host,
        "provider": "cursor" if host == "cursor" else "anthropic",
        "billing_source": f"{host}_subscription",
        "trace_id": trace_id,
        "elapsed_ms": elapsed_ms,
    }
    return text, trace


def complete(
    *,
    host: str,
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
) -> tuple[str, dict[str, Any]]:
    _ = usage_callback
    work = Path(tempfile.mkdtemp(prefix=f"r3d-{host}-llm-"))
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
        )
    json_note = "\n\nReturn JSON only. No markdown fences." if json_response else ""
    prompt = (
        f"{str(system_prompt or '').strip()}\n\n"
        f"{str(user_content or '').strip()}"
        f"{image_note}{json_note}\n"
    )
    return _run(
        host=host,
        user_id=user_id,
        work=work,
        prompt=prompt,
        model=model,
        trace_id=trace_id,
        timeout_sec=timeout_sec,
        cancel_check=cancel_check,
        log_label=f"{host} LLM complete",
    )


def exec_in_workspace(
    *,
    host: str,
    project_path: Path,
    prompt: str,
    images: list[dict[str, Any]] | None = None,
    trace_id: str | None = None,
    timeout_sec: float | None = None,
    usage_callback: UsageCb = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    user_id: str | None = None,
    model: str | None = None,
    ready_check: ReadyCb = None,
) -> tuple[str, dict[str, Any]]:
    _ = usage_callback
    work = Path(project_path).resolve()
    work.mkdir(parents=True, exist_ok=True)
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
        )
    return _run(
        host=host,
        user_id=str(user_id or ""),
        work=work,
        prompt=f"{str(prompt or '').strip()}{image_note}\n",
        model=model,
        trace_id=trace_id,
        timeout_sec=timeout_sec,
        cancel_check=cancel_check,
        progress_callback=progress_callback,
        ready_check=ready_check,
        log_label=f"{host} workspace exec",
    )
