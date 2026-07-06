"""Execute Python CLI tools bundled with agent skills (text-to-cad)."""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from backend.services.skills_service import get_skill_dir

logger = logging.getLogger(__name__)

# Skill id → script subfolder names under scripts/
KNOWN_TOOLS = ("step", "inspect", "snapshot", "dxf", "urdf", "srdf", "sdf")

# Common fatal signals for surfacing native CAD-kernel crashes in tool output.
_SIGNAL_NAMES = {
    4: "SIGILL",
    6: "SIGABRT",
    8: "SIGFPE",
    11: "SIGSEGV (segmentation fault)",
    9: "SIGKILL",
}


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


def _pythonpath_for_skill(skill_dir: Path) -> str:
    parts: list[str] = []
    packages = skill_dir / "scripts" / "packages"
    if packages.is_dir():
        for pkg in sorted(packages.iterdir()):
            src = pkg / "src"
            if src.is_dir():
                parts.append(str(src))
    for tool in KNOWN_TOOLS:
        tool_dir = skill_dir / "scripts" / tool
        if tool_dir.is_dir():
            parts.append(str(tool_dir))
    existing = os.environ.get("PYTHONPATH", "")
    if existing:
        parts.append(existing)
    return os.pathsep.join(parts)


def run_skill_tool(
    skill_id: str,
    tool: str,
    args: list[str] | None = None,
    *,
    cwd: Path | str | None = None,
    timeout_sec: float = 120.0,
) -> dict[str, Any]:
    """Run ``python scripts/<tool>`` with cwd set to the artifact workspace.

    text-to-cad CLIs resolve STEP/CAD paths relative to ``cwd``. The skill scripts
    themselves live under ``backend/skills/<skill_id>/scripts/``.
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

    script = skill_dir / "scripts" / tool
    if script.is_dir():
        cmd = [sys.executable, str(script / "__main__.py"), *(args or [])]
    elif script.is_file():
        cmd = [sys.executable, str(script), *(args or [])]
    elif (skill_dir / "scripts" / f"{tool}.py").is_file():
        cmd = [sys.executable, str(skill_dir / "scripts" / f"{tool}.py"), *(args or [])]
    else:
        raise FileNotFoundError(f"Tool '{tool}' not found for skill '{skill_id}'")

    run_cwd = Path(cwd or os.getcwd()).resolve()
    env = os.environ.copy()
    env["PYTHONPATH"] = _pythonpath_for_skill(skill_dir)

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(run_cwd),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        stderr = proc.stderr
        # A negative return code means the child was killed by a signal.
        # Native crashes in the OCCT/build123d kernel (e.g. a fillet/chamfer or
        # boolean on fragile geometry) raise SIGSEGV/SIGABRT and print nothing
        # useful to stderr, so surface a diagnostic the repair loop can act on.
        if proc.returncode is not None and proc.returncode < 0:
            signal_num = -proc.returncode
            signal_name = _SIGNAL_NAMES.get(signal_num, f"signal {signal_num}")
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
            "stdout": proc.stdout,
            "stderr": stderr,
            "command": cmd,
            "skill_dir": str(skill_dir),
            "cwd": str(run_cwd),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": exc.stdout or "",
            "stderr": (exc.stderr or "") + f"\nTimed out after {timeout_sec}s",
            "command": cmd,
            "skill_dir": str(skill_dir),
            "cwd": str(run_cwd),
        }
    except Exception as exc:
        logger.warning("skill tool failed: %s", exc)
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": str(exc),
            "command": cmd,
            "skill_dir": str(skill_dir),
            "cwd": str(run_cwd),
        }


def _validate_step_basic(step_path: Path) -> dict[str, Any]:
    """Validate a Render3D-exported STEP with OCP when text-to-cad topology is unavailable."""
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
    """Prepare topology when possible, else validate STEP with OCP."""
    step_path = step_path.resolve()
    if not step_path.is_file():
        return {"ok": False, "stderr": f"STEP not found: {step_path}"}

    project_cwd = step_path.parent
    step_name = step_path.name
    entry = f"STEP/{step_name}"
    topology_glb = project_cwd / f".{step_name}.glb"

    prep = run_skill_tool(
        "cad",
        "step",
        [step_name, "--kind", "part", "--force"],
        cwd=project_cwd,
        timeout_sec=min(timeout_sec, 90.0),
    )

    if prep.get("ok") and topology_glb.is_file():
        out = run_skill_tool(
            "cad",
            "inspect",
            ["refs", entry, "--facts"],
            cwd=project_cwd,
            timeout_sec=timeout_sec,
        )
        out["prep"] = prep
        out["mode"] = "text-to-cad-inspect"
        return out

    basic = _validate_step_basic(step_path)
    basic["prep"] = prep
    basic["mode"] = "render3d-ocp"
    if not prep.get("ok"):
        basic["prep_note"] = "text-to-cad topology prep skipped or unavailable for Render3D STEP exports"
    return basic
