"""Execute Python CLI tools bundled with agent skills (text-to-cad)."""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Optional, Union

from backend.services.skills_service import get_skill_dir

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]

# Skill id → script subfolder names under scripts/
KNOWN_TOOLS = ("step", "gen", "export", "artifact", "inspect", "snapshot", "dxf", "urdf", "srdf", "sdf")

# Common fatal signals for surfacing native CAD-kernel crashes in tool output.
_SIGNAL_NAMES = {
    4: "SIGILL",
    6: "SIGABRT",
    8: "SIGFPE",
    11: "SIGSEGV (segmentation fault)",
    9: "SIGKILL",
    15: "SIGTERM",
}

_ACTIVE_LOCK = threading.Lock()
# cwd -> list of (Popen, process group id)
_ACTIVE_PROCS: dict[str, list[tuple[subprocess.Popen, int]]] = {}


def _looks_like_studio_site_packages(path: str) -> bool:
    lower = path.replace("\\", "/").lower()
    if "site-packages" in lower:
        return True
    if "python3.9" in lower:
        return True
    return False


@lru_cache(maxsize=8)
def _python_major_minor(executable: str) -> tuple[int, int] | None:
    try:
        out = subprocess.check_output(
            [executable, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
            timeout=8,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        major, minor = out.strip().split(".", 1)
        return int(major), int(minor.split(".", 1)[0])
    except Exception:
        return None


def cad_python_bin() -> Path | None:
    """Directory that should be first on PATH so ``python scripts/step`` is 3.12+."""
    exe = Path(resolve_cad_python())
    bin_dir = exe.parent
    if (bin_dir / "python").exists() or (bin_dir / "python.exe").exists():
        return bin_dir
    return None


def _inject_cad_node(env: dict[str, str]) -> None:
    """cadgen 0.5 mesh doors need Node >=20. Launchd PATH often has none."""
    existing = (env.get("CADGEN_NODE") or "").strip()
    if existing and Path(existing).is_file():
        node = existing
    else:
        try:
            from backend.services.mesh_service import _find_node

            node = _find_node()
        except Exception:
            return
    env["CADGEN_NODE"] = node
    env.setdefault("RENDER3D_NODE", node)
    node_bin = str(Path(node).parent)
    env["PATH"] = f"{node_bin}{os.pathsep}{env.get('PATH', '')}"


def resolve_cad_python() -> str:
    """Interpreter for Jake cadpy (requires Python 3.12, not the studio 3.9 process).

    Prefer ``CAD_PYTHON`` / ``RENDER3D_CAD_PYTHON``, then ``.venv-cad``, then the
    MAC 3.12 env, then the current process if it is already 3.12+.
    Do not resolve venv python symlinks — uv points them at the base CPython
    and that drops the venv site-packages (build123d).
    """
    env = (os.environ.get("CAD_PYTHON") or os.environ.get("RENDER3D_CAD_PYTHON") or "").strip()
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env).expanduser())
    candidates.extend(
        [
            REPO_ROOT / ".venv-cad" / "bin" / "python",
            REPO_ROOT / ".venv-mac" / "bin" / "python",
            REPO_ROOT / ".venv-cad" / "Scripts" / "python.exe",
            REPO_ROOT / ".venv-mac" / "Scripts" / "python.exe",
        ]
    )
    for path in candidates:
        if path.is_file() or path.is_symlink():
            exe = str(path)
            ver = _python_major_minor(exe)
            if ver and ver >= (3, 12):
                return exe
    if sys.version_info >= (3, 12):
        return sys.executable
    logger.warning(
        "CAD skill needs Python 3.12+; studio process is %s and no .venv-mac/.venv-cad was found.",
        sys.version.split()[0],
    )
    return sys.executable


@lru_cache(maxsize=4)
def _cad_runtime_provenance(executable: str) -> tuple[tuple[str, str], ...]:
    probe = r'''import importlib.metadata as metadata
import json
import sys

def package_version(name):
    try:
        return metadata.version(name)
    except Exception:
        return "unavailable"

occt_version = "unavailable"
try:
    import OCP
    occt_version = str(getattr(OCP, "__version__", "unavailable"))
except Exception:
    pass

print(json.dumps({
    "python_executable": sys.executable,
    "python_version": sys.version.split()[0],
    "build123d_version": package_version("build123d"),
    "ocp_version": package_version("cadquery-ocp"),
    "occt_version": occt_version,
    "cadgen_version": package_version("cadgen"),
}))'''
    try:
        output = subprocess.check_output(
            [executable, "-I", "-c", probe],
            timeout=15,
            text=True,
            stderr=subprocess.STDOUT,
        )
        import json

        payload = json.loads(output.strip())
        if not isinstance(payload, dict):
            raise ValueError("CAD runtime probe returned a non-object")
        return tuple(sorted((str(key), str(value)) for key, value in payload.items()))
    except Exception as exc:
        return (
            ("python_executable", executable),
            ("probe_error", str(exc)[:400]),
        )


def cad_runtime_provenance() -> dict[str, str]:
    """Measure the packages used by the resolved CAD skill subprocess."""
    executable = resolve_cad_python()
    return dict(_cad_runtime_provenance(executable))


def ensure_project_cad_scripts(project_path: Path, skill_id: str = "cad") -> Path | None:
    """Give the project cwd a ``scripts/`` symlink like earthtojake/text-to-cad.

    Upstream CAD skill commands are ``python scripts/step`` from the artifact
    directory. Jake / Codex / MAC-adjacent authoring must use that same layout
    so harnesses hit ``backend/skills/cad`` — not a divergent copy.
    """
    skill_dir = get_skill_dir(skill_id)
    if not skill_dir:
        fallback = Path(__file__).resolve().parent.parent / "skills" / skill_id
        if fallback.is_dir() and (fallback / "scripts").is_dir():
            skill_dir = fallback
        else:
            return None
    scripts_dir = skill_dir / "scripts"
    if not scripts_dir.is_dir():
        return None
    project_path = Path(project_path)
    project_path.mkdir(parents=True, exist_ok=True)
    scripts_link = project_path / "scripts"
    target = scripts_dir.resolve()
    if scripts_link.is_symlink():
        try:
            if scripts_link.resolve() == target:
                return scripts_link
        except Exception:
            pass
        try:
            scripts_link.unlink()
        except Exception:
            return scripts_link
    elif scripts_link.exists():
        return scripts_link
    try:
        scripts_link.symlink_to(target, target_is_directory=True)
    except Exception as exc:
        logger.debug("Could not link project scripts/ to CAD skill: %s", exc)
        return None
    return scripts_link


def list_skill_tools(skill_id: str) -> list[str]:
    skill_dir = get_skill_dir(skill_id)
    if not skill_dir:
        return []
    scripts = skill_dir / "scripts"
    if not scripts.is_dir():
        return []
    out: list[str] = []
    for name in KNOWN_TOOLS:
        tool_path = scripts / name
        if tool_path.is_dir() or (tool_path.is_file() and os.access(tool_path, os.X_OK)):
            out.append(name)
        elif (scripts / f"{name}.py").is_file():
            out.append(name)
    for path in sorted(scripts.iterdir()):
        if path.suffix == ".py" and path.is_file() and path.stem not in out:
            out.append(path.stem)
    return sorted(set(out))


def _runnable_tool_script(path: Path) -> Path | None:
    """Pick the Python entry for a skill CLI directory or file."""
    if path.is_dir():
        main_py = path / "__main__.py"
        if main_py.is_file():
            return main_py
        generate_py = path / "generate.py"
        if generate_py.is_file():
            return generate_py
        return None
    if path.is_file():
        return path
    return None


def _skill_tool_command(
    skill_dir: Path,
    tool: str,
    python: str,
    args: Optional[list[str]] = None,
) -> list[str]:
    extra = list(args or [])
    scripts = skill_dir / "scripts"
    candidates = [
        scripts / tool,
        scripts / f"{tool}.py",
    ]
    # Project ``scripts/`` is the CAD pack. Keep robot CLIs reachable from there too.
    if tool in {"urdf", "srdf", "sdf"}:
        cad_scripts = skill_dir.parent / "cad" / "scripts"
        candidates.extend(
            [
                cad_scripts / tool,
                cad_scripts / f"{tool}.py",
            ]
        )
    for candidate in candidates:
        script = _runnable_tool_script(candidate)
        if script is not None:
            return [python, str(script), *extra]
    raise FileNotFoundError(f"Tool '{tool}' not found for skill '{skill_dir.name}'")


def _pythonpath_for_skill(skill_dir: Path, *, inherit_parent: bool = False) -> str:
    parts: list[str] = []
    seen: set[str] = set()

    def add(path: Path) -> None:
        key = str(path)
        if path.is_dir() and key not in seen:
            seen.add(key)
            parts.append(key)

    def add_skill_packages(root: Path) -> None:
        packages = root / "scripts" / "packages"
        if not packages.is_dir():
            return
        for pkg in sorted(packages.iterdir()):
            # Jake 0.5 cadgen is pip-installed in .venv-mac. A leftover 0.4
            # tree here would shadow it and break @step / cadgen CLI.
            if pkg.name in {"cadgen", "cadpy"}:
                continue
            add(pkg / "src")

    add_skill_packages(skill_dir)
    skills_root = skill_dir.parent
    if skills_root.is_dir():
        for sibling in sorted(skills_root.iterdir()):
            if sibling == skill_dir:
                continue
            add_skill_packages(sibling)
    add(skill_dir / "scripts")
    for tool in KNOWN_TOOLS:
        tool_dir = skill_dir / "scripts" / tool
        add(tool_dir)
    if inherit_parent:
        existing = os.environ.get("PYTHONPATH", "")
        for part in existing.split(os.pathsep):
            if part and not _looks_like_studio_site_packages(part):
                parts.append(part)
    return os.pathsep.join(parts)


def _cwd_key(cwd: Union[Path, str]) -> str:
    return str(Path(cwd).resolve())


def _register_proc(cwd: Union[Path, str], proc: subprocess.Popen, pgid: int) -> None:
    key = _cwd_key(cwd)
    with _ACTIVE_LOCK:
        _ACTIVE_PROCS.setdefault(key, []).append((proc, pgid))


def _unregister_proc(cwd: Union[Path, str], proc: subprocess.Popen) -> None:
    key = _cwd_key(cwd)
    with _ACTIVE_LOCK:
        entries = _ACTIVE_PROCS.get(key) or []
        _ACTIVE_PROCS[key] = [(p, g) for p, g in entries if p is not proc]
        if not _ACTIVE_PROCS[key]:
            _ACTIVE_PROCS.pop(key, None)


def _kill_process_group(pgid: int, proc: Optional[subprocess.Popen] = None) -> bool:
    """Terminate a skill-tool process group. Returns True if a signal was sent."""
    sent = False
    if pgid > 0:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(pgid, sig)
                sent = True
            except ProcessLookupError:
                break
            except PermissionError:
                break
            if sig == signal.SIGTERM:
                time.sleep(0.15)
    if proc is not None and proc.poll() is None:
        try:
            proc.kill()
            sent = True
        except Exception:
            pass
    if proc is not None:
        try:
            proc.wait(timeout=2.0)
        except Exception:
            pass
    return sent


def kill_active_for_cwd(cwd: Union[Path, str], *, reason: str = "canceled") -> int:
    """Kill all in-flight skill-tool subprocesses for a project/workdir."""
    key = _cwd_key(cwd)
    with _ACTIVE_LOCK:
        entries = list(_ACTIVE_PROCS.get(key) or [])
        _ACTIVE_PROCS.pop(key, None)
    killed = 0
    for proc, pgid in entries:
        if _kill_process_group(pgid, proc):
            killed += 1
            logger.info("Killed skill tool pid=%s pgid=%s cwd=%s (%s)", getattr(proc, "pid", None), pgid, key, reason)
    return killed


def kill_active_for_project(project_path: Union[Path, str], *, reason: str = "canceled") -> int:
    return kill_active_for_cwd(project_path, reason=reason)


def run_skill_tool(
    skill_id: str,
    tool: str,
    args: Optional[list[str]] = None,
    *,
    cwd: Optional[Union[Path, str]] = None,
    timeout_sec: float = 120.0,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> dict[str, Any]:
    """Run ``python scripts/<tool>`` with cwd set to the artifact workspace.

    text-to-cad CLIs resolve STEP/CAD paths relative to ``cwd``. The skill scripts
    themselves live under ``backend/skills/<skill_id>/scripts/``.

    When ``cancel_check`` returns True (or the project is marked canceled), the
    child process group is killed immediately so Stop Generating does not wait
    for scripts/step to finish.
    """
    skill_dir = get_skill_dir(skill_id)
    if not skill_dir:
        # During code sync/restart windows skill metadata can briefly be missed.
        # Fall back to the conventional on-disk location before failing.
        fallback = Path(__file__).resolve().parent.parent / "skills" / skill_id
        if fallback.is_dir() and (fallback / "scripts").is_dir():
            skill_dir = fallback
        else:
            raise FileNotFoundError(f"Skill '{skill_id}' not found")

    python = resolve_cad_python()
    if python != sys.executable:
        logger.info("CAD skill %s/%s using %s (studio is %s)", skill_id, tool, python, sys.executable)
    cmd = _skill_tool_command(skill_dir, tool, python, args)

    run_cwd = Path(cwd or os.getcwd()).resolve()
    env = os.environ.copy()
    env["PYTHONPATH"] = _pythonpath_for_skill(skill_dir)
    env.pop("PYTHONHOME", None)
    cad_bin = cad_python_bin()
    if cad_bin:
        env["PATH"] = f"{cad_bin}{os.pathsep}{env.get('PATH', '')}"
        env["VIRTUAL_ENV"] = str(cad_bin.parent)
        env["VIRTUAL_ENV_PROMPT"] = cad_bin.parent.name
    env["CADGEN_DAEMON"] = os.environ.get("CADGEN_DAEMON") or "0"
    _inject_cad_node(env)

    def _is_canceled() -> bool:
        if cancel_check and cancel_check():
            return True
        try:
            from backend.services import generation_service

            return bool(generation_service.is_canceled(run_cwd))
        except Exception:
            return False

    if _is_canceled():
        return {
            "ok": False,
            "exit_code": -15,
            "stdout": "",
            "stderr": "Generation canceled before scripts/%s started." % tool,
            "command": cmd,
            "skill_dir": str(skill_dir),
            "cwd": str(run_cwd),
            "canceled": True,
        }

    proc: Optional[subprocess.Popen] = None
    pgid = -1
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(run_cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,  # own process group → killpg on cancel
        )
        try:
            pgid = os.getpgid(proc.pid)
        except Exception:
            pgid = proc.pid
        _register_proc(run_cwd, proc, pgid)

        deadline = time.monotonic() + max(float(timeout_sec), 1.0)
        while True:
            if _is_canceled():
                _kill_process_group(pgid, proc)
                stdout, stderr = ("", "")
                try:
                    out_b, err_b = proc.communicate(timeout=1.0)
                    stdout, stderr = out_b or "", err_b or ""
                except Exception:
                    pass
                return {
                    "ok": False,
                    "exit_code": -15,
                    "stdout": stdout,
                    "stderr": (stderr or "") + f"\nCanceled: scripts/{tool} was killed.",
                    "command": cmd,
                    "skill_dir": str(skill_dir),
                    "cwd": str(run_cwd),
                    "canceled": True,
                }
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _kill_process_group(pgid, proc)
                stdout, stderr = ("", "")
                try:
                    out_b, err_b = proc.communicate(timeout=1.0)
                    stdout, stderr = out_b or "", err_b or ""
                except Exception:
                    pass
                return {
                    "ok": False,
                    "exit_code": -1,
                    "stdout": stdout,
                    "stderr": (stderr or "") + f"\nTimed out after {timeout_sec}s",
                    "command": cmd,
                    "skill_dir": str(skill_dir),
                    "cwd": str(run_cwd),
                }
            try:
                stdout, stderr = proc.communicate(timeout=min(0.5, remaining))
                break
            except subprocess.TimeoutExpired:
                continue

        # A negative return code means the child was killed by a signal.
        if proc.returncode is not None and proc.returncode < 0:
            signal_num = -proc.returncode
            signal_name = _SIGNAL_NAMES.get(signal_num, f"signal {signal_num}")
            if signal_num in {9, 15} and _is_canceled():
                crash_hint = f"\nCanceled: scripts/{tool} was killed by {signal_name}."
            else:
                crash_hint = (
                    f"\n[kernel crash] scripts/{tool} was killed by {signal_name} "
                    f"(exit {proc.returncode}). This is a native CAD-kernel crash, not a "
                    "Python exception, so it cannot be caught with try/except. It is "
                    "usually caused by fillet/chamfer on degenerate or self-intersecting "
                    "edges, a boolean on non-manifold solids, or a loft/sweep with a "
                    "bad profile. Remove or shrink the offending operation and tighten "
                    "the edge/face selection."
                )
            stderr = (stderr or "") + crash_hint
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "command": cmd,
            "skill_dir": str(skill_dir),
            "cwd": str(run_cwd),
            "canceled": bool(proc.returncode is not None and proc.returncode < 0 and _is_canceled()),
        }
    except Exception as exc:
        logger.warning("skill tool failed: %s", exc)
        if proc is not None:
            _kill_process_group(pgid, proc)
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": str(exc),
            "command": cmd,
            "skill_dir": str(skill_dir),
            "cwd": str(run_cwd),
        }
    finally:
        if proc is not None:
            _unregister_proc(run_cwd, proc)


def _validate_step_basic(step_path: Path) -> dict[str, Any]:
    """Validate a Render Studio-exported STEP with OCP when text-to-cad topology is unavailable."""
    try:
        from OCP.BRepGProp import BRepGProp
        from OCP.GProp import GProp_GProps
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.STEPControl import STEPControl_Reader

        reader = STEPControl_Reader()
        status = reader.ReadFile(str(step_path))
        if status != IFSelect_RetDone:
            return {"ok": False, "stderr": "STEP read failed (OCP)"}
        reader.TransferRoots()
        shape = reader.OneShape()
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, props)
        volume = float(props.Mass())
        if volume <= 0:
            return {"ok": False, "stderr": "STEP has no positive solid volume"}
        return {
            "ok": True,
            "exit_code": 0,
            "stdout": f'{{"ok": true, "mode": "render3d-ocp", "volume_mm3": {volume:.4f}}}',
            "stderr": "",
            "mode": "render3d-ocp",
        }
    except Exception as exc:
        return {"ok": False, "stderr": str(exc)}


def inspect_step_facts(step_path: Path, *, timeout_sec: float = 60.0) -> dict[str, Any]:
    """Inspect a STEP document with cadgen, else validate with OCP."""
    step_path = step_path.resolve()
    if not step_path.is_file():
        return {"ok": False, "stderr": f"STEP not found: {step_path}"}

    project_cwd = step_path.parent
    step_name = step_path.name
    out = run_skill_tool(
        "cad",
        "inspect",
        ["refs", step_name, "--facts"],
        cwd=project_cwd,
        timeout_sec=timeout_sec,
    )
    if out.get("ok"):
        out["mode"] = "text-to-cad-inspect"
        return out

    basic = _validate_step_basic(step_path)
    basic["inspect"] = out
    basic["mode"] = "render3d-ocp"
    basic["prep_note"] = "cadgen scene inspection unavailable; used OCP volume check"
    return basic
