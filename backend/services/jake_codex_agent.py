"""Run Jake's real Codex CAD agent (earthtojake/text-to-cad) for Render3D.

Upstream text-to-cad is a Codex / Claude Code skill plugin — not an in-process
chat rewrite loop. This module shells out to the Codex CLI with the installed
``cad@text-to-cad`` plugin, in the project workspace, so the agent owns:

  edit gen_step() source → python scripts/step → inspect → snapshot → repair

Render3D keeps the product shell (viewer, progress UI, Fusion, etc.).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from backend.services.trace_log import add as trace_add

ProgressCb = Callable[[dict[str, Any]], None] | None
CancelCb = Callable[[], bool] | None

ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_TIMEOUT_SEC = 20 * 60


class JakeCodexUnavailable(RuntimeError):
    """Codex CLI or CAD plugin is not available on this host."""


class JakeCodexFailed(RuntimeError):
    """Codex ran but did not produce a valid STEP/GLB for the project."""


def resolve_codex_bin() -> Path | None:
    env = (os.environ.get("CODEX_BIN") or os.environ.get("RENDER3D_CODEX_BIN") or "").strip()
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env).expanduser())
    which = shutil.which("codex")
    if which:
        candidates.append(Path(which))
    candidates.append(Path.home() / ".local" / "bin" / "codex")
    # Cursor ChatGPT extension ships a Linux Codex binary.
    ext_root = Path.home() / ".cursor-server" / "extensions"
    if ext_root.is_dir():
        for path in sorted(ext_root.glob("openai.chatgpt-*/bin/linux-x86_64/codex"), reverse=True):
            candidates.append(path)
    seen: set[str] = set()
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        if path.is_file() and os.access(path, os.X_OK):
            return path.resolve()
    return None


def codex_available() -> bool:
    return resolve_codex_bin() is not None


def _cad_skill_dir() -> Path:
    from backend.services.skills_service import get_skill_dir

    skill_dir = get_skill_dir("cad")
    if skill_dir and (skill_dir / "scripts").is_dir():
        return Path(skill_dir).resolve()
    fallback = ROOT_DIR / "backend" / "skills" / "cad"
    if (fallback / "scripts").is_dir():
        return fallback.resolve()
    plugin = Path.home() / ".codex" / "plugins" / "cache" / "text-to-cad" / "cad"
    if plugin.is_dir():
        versions = sorted(plugin.iterdir(), reverse=True)
        for ver in versions:
            candidate = ver / "skills" / "cad"
            if (candidate / "scripts").is_dir():
                return candidate.resolve()
    raise JakeCodexUnavailable("CAD skill scripts not found (backend/skills/cad or cad@text-to-cad plugin).")


def _pythonpath_for_skill(skill_dir: Path) -> str:
    from backend.services.skill_runner import _pythonpath_for_skill as _pp

    return _pp(skill_dir)


def _venv_bin() -> Path | None:
    for candidate in (
        ROOT_DIR / ".venv" / "bin",
        Path.home() / ".venv" / "bin",
    ):
        if (candidate / "python").is_file():
            return candidate.resolve()
    return None


def _ensure_project_scripts(project_path: Path, skill_dir: Path) -> Path:
    """Jake workflow expects ``python scripts/step`` from the artifact cwd."""
    scripts_link = project_path / "scripts"
    target = (skill_dir / "scripts").resolve()
    if scripts_link.is_symlink():
        try:
            if scripts_link.resolve() == target:
                return scripts_link
        except Exception:
            pass
        scripts_link.unlink()
    elif scripts_link.exists():
        # Do not clobber a real project scripts directory.
        return scripts_link
    scripts_link.symlink_to(target, target_is_directory=True)
    return scripts_link


def _ensure_project_agents_md(project_path: Path) -> None:
    path = project_path / "AGENTS.md"
    if path.is_file():
        return
    path.write_text(
        "# Render3D / Jake CAD workspace\n\n"
        "Use the installed `$cad` skill (earthtojake/text-to-cad).\n"
        "Work in this directory. Run CAD tools as:\n\n"
        "```bash\n"
        "python scripts/step <generator.py> --glb <name>.glb --stl <name>.stl --3mf <name>.3mf\n"
        "python scripts/inspect refs <name>.step --facts --planes --positioning\n"
        "python scripts/snapshot --input <name>.step --output <name>_snapshot.png --camera iso --view-labels --size-profile diagnostic\n"
        "```\n\n"
        "STEP is primary. Prefer surgical edits over rewrites. Skip `$cad-viewer` "
        "handoff — Render3D owns the viewer.\n",
        encoding="utf-8",
    )


def _trust_project_in_codex_config(project_path: Path) -> None:
    cfg = Path.home() / ".codex" / "config.toml"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    key = f'[projects."{project_path.resolve()}"]'
    existing = cfg.read_text(encoding="utf-8") if cfg.is_file() else ""
    if key in existing:
        return
    block = f'\n\n{key}\ntrust_level = "trusted"\n'
    cfg.write_text(existing.rstrip() + block, encoding="utf-8")


def _build_prompt(
    *,
    prompt: str,
    cad_brief: str,
    source_name: str,
    step_name: str,
    glb_name: str,
    stl_name: str,
    three_mf_name: str,
    is_edit: bool,
    previous_source: str | None,
) -> str:
    mode = "EDIT/REVISE the existing generator" if is_edit else "CREATE a new part"
    prev = ""
    if previous_source and is_edit:
        prev = (
            f"\nExisting generator `{source_name}` is already in this workspace "
            "(or will be written before you start). Make the smallest surgical change.\n"
        )
    return f"""Use the $cad skill (earthtojake/text-to-cad). You are the CAD authoring agent for this project.

Task mode: {mode}.
User request:
{prompt.strip()}

CAD brief:
{cad_brief.strip()}
{prev}
Required workflow (do not skip):
1. Author/edit build123d Python with `gen_step()` as `{source_name}`.
2. Run from this workspace: `python scripts/step {source_name} --glb {glb_name} --stl {stl_name} --3mf {three_mf_name}`
3. On failure: classify, fix the smallest responsible source section, rerun step.
4. Validate: `python scripts/inspect refs {step_name} --facts --planes --positioning`
5. Mandatory snapshot with the installed CLI shape (NOT a bare STEP arg):
   `python scripts/snapshot --input {step_name} --output {Path(step_name).stem}_snapshot.png --camera iso --view-labels --size-profile diagnostic`
   If snapshot deps fail after a valid STEP/GLB exists, finish anyway and report the files — Render3D owns visual review.
6. Repair until scripts/step succeeds and inspect is acceptable. Do not loop forever on snapshot tooling.

Rules:
- Millimeters. `gen_step()` returns the STEP-ready shape; do not write files inside gen_step().
- Prefer surgical edits over full-file rewrites.
- Never assign bare floats to list-like `*_positions` constants (wrong: `rod_hole_positions = 10.0`).
- Target basenames: source={source_name}, step={step_name}, glb={glb_name}.
- Skip `$cad-viewer` handoff — Render3D owns the product viewer. Report final file names when done.
- Do not ask clarifying questions; proceed with explicit assumptions.
"""


def _stage_from_text(text: str) -> str:
    lower = (text or "").lower()
    if "scripts/snapshot" in lower or "snapshot" in lower:
        return "snapshot"
    if "scripts/inspect" in lower or "inspect refs" in lower:
        return "inspect"
    if "scripts/step" in lower or "gen_step" in lower:
        return "step"
    if "brief" in lower:
        return "brief"
    if "repair" in lower or "fix" in lower or "str_replace" in lower or "edit" in lower:
        return "repair"
    return "authoring"


def _event_activity(event: dict[str, Any]) -> tuple[str | None, str | None]:
    """Return (stage, activity_text) from a Codex JSONL event."""
    etype = str(event.get("type") or "")
    item = event.get("item") if isinstance(event.get("item"), dict) else {}
    item_type = str(item.get("type") or "")

    if etype == "item.completed" and item_type == "agent_message":
        text = str(item.get("text") or "").strip()
        if text:
            return _stage_from_text(text), text[:280]
    if etype == "item.completed" and item_type in {"command_execution", "bash", "shell_call", "tool_call"}:
        cmd = (
            item.get("command")
            or item.get("cmd")
            or item.get("input")
            or item.get("text")
            or ""
        )
        cmd_s = str(cmd).strip()
        if cmd_s:
            return _stage_from_text(cmd_s), f"$ {cmd_s[:240]}"
    if etype == "item.started" and item:
        summary = str(item.get("command") or item.get("text") or item.get("type") or "").strip()
        if summary:
            return _stage_from_text(summary), summary[:240]
    if etype in {"turn.started", "thread.started"}:
        return "authoring", "Codex CAD agent started"
    if etype == "turn.completed":
        return "authoring", "Codex turn completed"
    if etype == "error":
        msg = str(event.get("message") or event.get("error") or "Codex error")
        return "authoring", msg[:280]
    return None, None


def _pick_artifacts(project_path: Path, preferred_base: str) -> dict[str, str]:
    """Find the best source/step/glb trio after Codex finishes."""
    preferred_base = re.sub(r"[^a-zA-Z0-9_-]+", "_", preferred_base).strip("_") or "model"
    candidates: list[tuple[float, str, Path, Path, Path]] = []

    for py in project_path.glob("*.py"):
        if py.name.startswith(".") or py.name == "AGENTS.md":
            continue
        try:
            text = py.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if "def gen_step" not in text:
            continue
        stem = py.stem
        step = project_path / f"{stem}.step"
        glb = project_path / f"{stem}.glb"
        jake_glb = project_path / f".{stem}.step.glb"
        if not glb.is_file() and jake_glb.is_file():
            try:
                shutil.copy2(jake_glb, glb)
            except Exception:
                glb = jake_glb
        if not step.is_file():
            continue
        score = step.stat().st_mtime
        if stem == preferred_base:
            score += 1e12
        if glb.is_file():
            score += 1e6
        candidates.append((score, stem, py, step, glb if glb.is_file() else step))

    if not candidates:
        # Fall back to preferred names if present.
        py = project_path / f"{preferred_base}.py"
        step = project_path / f"{preferred_base}.step"
        glb = project_path / f"{preferred_base}.glb"
        if py.is_file() and step.is_file():
            return {
                "source": py.name,
                "step": step.name,
                "glb": glb.name if glb.is_file() else step.name,
                "base": preferred_base,
            }
        raise JakeCodexFailed("Codex finished without a gen_step() Python + STEP pair.")

    candidates.sort(key=lambda row: row[0], reverse=True)
    _, stem, py, step, glb = candidates[0]
    out_glb = project_path / f"{stem}.glb"
    if not out_glb.is_file() and glb.is_file() and glb.suffix == ".glb":
        out_glb = glb
    return {
        "source": py.name,
        "step": step.name,
        "glb": out_glb.name if out_glb.is_file() else f"{stem}.glb",
        "base": stem,
    }


def run_jake_codex_agent(
    *,
    project_path: Path,
    prompt: str,
    cad_brief: str,
    source_name: str,
    step_name: str,
    glb_name: str,
    stl_name: str | None = None,
    three_mf_name: str | None = None,
    previous_source: str | None = None,
    is_edit: bool = False,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    trace_id: str | None = None,
    timeout_sec: float | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Run Codex non-interactively with Jake's CAD plugin in ``project_path``."""
    codex = resolve_codex_bin()
    if not codex:
        raise JakeCodexUnavailable(
            "Codex CLI not found. Install Codex or set CODEX_BIN to the binary path."
        )

    project_path = Path(project_path).resolve()
    project_path.mkdir(parents=True, exist_ok=True)
    skill_dir = _cad_skill_dir()
    _ensure_project_scripts(project_path, skill_dir)
    _ensure_project_agents_md(project_path)
    _trust_project_in_codex_config(project_path)

    base = Path(source_name).stem
    stl_name = stl_name or f"{base}.stl"
    three_mf_name = three_mf_name or f"{base}.3mf"

    if previous_source and is_edit:
        src_path = project_path / source_name
        if not src_path.is_file():
            src_path.write_text(previous_source.rstrip() + "\n", encoding="utf-8")

    agent_prompt = _build_prompt(
        prompt=prompt,
        cad_brief=cad_brief,
        source_name=source_name,
        step_name=step_name,
        glb_name=glb_name,
        stl_name=stl_name,
        three_mf_name=three_mf_name,
        is_edit=is_edit,
        previous_source=previous_source,
    )

    env = os.environ.copy()
    env["PYTHONPATH"] = _pythonpath_for_skill(skill_dir)
    venv_bin = _venv_bin()
    if venv_bin:
        env["PATH"] = f"{venv_bin}{os.pathsep}{env.get('PATH', '')}"
        env["VIRTUAL_ENV"] = str(venv_bin.parent)
    # Help skill scripts resolve project-relative paths the Jake way.
    env["INIT_CWD"] = str(project_path)
    env["PWD"] = str(project_path)

    cmd = [
        str(codex),
        "exec",
        "--json",
        "--skip-git-repo-check",
        "-C",
        str(project_path),
        "-s",
        "workspace-write",
        "--dangerously-bypass-approvals-and-sandbox",
        "--ephemeral",
    ]
    if model:
        cmd.extend(["-m", str(model)])
    cmd.append("-")  # read prompt from stdin

    timeout = float(timeout_sec or os.environ.get("JAKE_CODEX_TIMEOUT_SEC") or DEFAULT_TIMEOUT_SEC)

    def _emit(stage: str, label: str, pct: int | None = None) -> None:
        if not progress_callback:
            return
        payload: dict[str, Any] = {
            "stage": stage,
            "label": label,
            "activity": [{"text": label, "stage": stage}],
        }
        if pct is not None:
            payload["pct"] = pct
        progress_callback(payload)

    _emit("authoring", "Starting Jake Codex CAD agent…", 18)
    trace_add(
        "info",
        f"[2.0/text-to-cad] Jake Codex agent: {codex} in {project_path}",
        trace_id=trace_id,
    )

    last_message_path = project_path / ".codex_last_message.txt"
    if last_message_path.exists():
        try:
            last_message_path.unlink()
        except Exception:
            pass
    cmd_with_out = list(cmd)
    # Insert output-last-message before the final "-" stdin marker.
    cmd_with_out[-1:-1] = ["-o", str(last_message_path)]

    proc = subprocess.Popen(
        cmd_with_out,
        cwd=str(project_path),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None

    # Feed prompt and close stdin so Codex does not hang on "Reading additional input".
    try:
        proc.stdin.write(agent_prompt)
        proc.stdin.close()
    except Exception:
        pass

    events: list[dict[str, Any]] = []
    activity_n = 0
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

    err_thread = threading.Thread(target=_read_stderr, name="codex-stderr", daemon=True)
    err_thread.start()

    deadline = time.monotonic() + timeout
    artifacts_ready_since: float | None = None
    try:
        while True:
            if cancel_check and cancel_check():
                _kill_proc(proc)
                raise RuntimeError("Generation canceled.")
            if time.monotonic() > deadline:
                _kill_proc(proc)
                # Prefer returning a renderable model over hard-failing after timeout.
                try:
                    early = _pick_artifacts(project_path, base)
                    if (project_path / early["glb"]).is_file() and (project_path / early["step"]).is_file():
                        events.append({"type": "render3d.early_accept", "reason": "timeout_with_artifacts"})
                        break
                except Exception:
                    pass
                raise JakeCodexFailed(f"Codex CAD agent timed out after {int(timeout)}s.")

            # If STEP+GLB already exist, don't let snapshot tooling hang the viewer.
            try:
                early = _pick_artifacts(project_path, base)
                glb_ok = (project_path / early["glb"]).is_file()
                step_ok = (project_path / early["step"]).is_file()
                if glb_ok and step_ok:
                    now = time.monotonic()
                    if artifacts_ready_since is None:
                        artifacts_ready_since = now
                        _emit("finalize", f"Model ready ({early['glb']}); waiting briefly for Codex to finish…", 82)
                    elif now - artifacts_ready_since >= 45.0:
                        _emit("finalize", f"Accepting {early['source']} / {early['step']} (snapshot optional)", 86)
                        _kill_proc(proc)
                        events.append({"type": "render3d.early_accept", "reason": "artifacts_ready"})
                        break
            except Exception:
                pass

            activity_holder = {"n": activity_n}
            if proc.poll() is not None:
                # Drain remaining stdout.
                rest = proc.stdout.read() or ""
                for line in rest.splitlines():
                    _handle_json_line(
                        line,
                        events=events,
                        emit=_emit,
                        activity_n_holder=activity_holder,
                    )
                activity_n = activity_holder["n"]
                break
            line = proc.stdout.readline()
            if not line:
                time.sleep(0.05)
                continue
            activity_n = _handle_json_line(
                line,
                events=events,
                emit=_emit,
                activity_n_holder=activity_holder,
            )
    finally:
        stop_reader.set()
        try:
            proc.wait(timeout=2)
        except Exception:
            _kill_proc(proc)
        err_thread.join(timeout=1.0)

    exit_code = proc.returncode if proc.returncode is not None else -1
    last_message = ""
    if last_message_path.is_file():
        try:
            last_message = last_message_path.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            last_message = ""

    artifacts = None
    artifact_error = None
    try:
        artifacts = _pick_artifacts(project_path, base)
    except Exception as exc:
        artifact_error = str(exc)

    if artifacts is None:
        detail = artifact_error or "no STEP artifacts"
        stderr_tail = "".join(stderr_chunks)[-2000:]
        raise JakeCodexFailed(
            f"Codex CAD agent exit={exit_code}: {detail}. "
            f"last_message={last_message[:500]!r} stderr={stderr_tail[:800]!r}"
        )

    # Ensure shell GLB basename exists when Jake only wrote the hidden sidecar.
    glb_path = project_path / artifacts["glb"]
    jake_hidden = project_path / f".{artifacts['base']}.step.glb"
    if not glb_path.is_file() and jake_hidden.is_file():
        shutil.copy2(jake_hidden, project_path / f"{artifacts['base']}.glb")
        artifacts["glb"] = f"{artifacts['base']}.glb"

    _emit("finalize", f"Codex finished: {artifacts['source']} → {artifacts['step']}", 88)
    trace_add(
        "info",
        f"[2.0/text-to-cad] Jake Codex produced {artifacts['source']} / {artifacts['step']}",
        trace_id=trace_id,
    )

    return {
        "ok": True,
        "runtime": "jake_codex",
        "source": artifacts["source"],
        "step": artifacts["step"],
        "glb": artifacts["glb"],
        "base": artifacts["base"],
        "summary": last_message or "Codex CAD agent completed.",
        "exit_code": exit_code,
        "events": events[-80:],
        "codex_bin": str(codex),
        "skill_dir": str(skill_dir),
    }


def _handle_json_line(
    line: str,
    *,
    events: list[dict[str, Any]],
    emit: Callable[[str, str, int | None], None],
    activity_n_holder: dict[str, int],
) -> int:
    raw = (line or "").strip()
    if not raw:
        return activity_n_holder.get("n", 0)
    try:
        event = json.loads(raw)
    except Exception:
        return activity_n_holder.get("n", 0)
    if not isinstance(event, dict):
        return activity_n_holder.get("n", 0)
    events.append(event)
    stage, text = _event_activity(event)
    if text:
        n = int(activity_n_holder.get("n", 0)) + 1
        activity_n_holder["n"] = n
        pct = min(85, 20 + n * 2)
        emit(stage or "authoring", text, pct)
        return n
    return activity_n_holder.get("n", 0)


def _kill_proc(proc: subprocess.Popen) -> None:
    try:
        pgid = os.getpgid(proc.pid)
    except Exception:
        pgid = -1
    if pgid > 0:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(pgid, sig)
            except Exception:
                break
            time.sleep(0.1)
    try:
        if proc.poll() is None:
            proc.kill()
    except Exception:
        pass


def run_jake_codex_agent_safe(**kwargs: Any) -> dict[str, Any]:
    """Same as ``run_jake_codex_agent`` — kept for symmetry with tool agent."""
    return run_jake_codex_agent(**kwargs)
