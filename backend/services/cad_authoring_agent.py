"""Jake-style CAD authoring agent helpers for Render3D CAD 2.0.

Upstream text-to-cad is a Codex/Claude agent that reads ``skills/cad/SKILL.md``
and runs ``scripts/step`` → ``inspect`` → ``snapshot`` → repair across turns.
Render3D cannot embed Codex CLI inside the product shell, so this module
implements the same skill contract as an in-process authoring agent:

1. Write/edit ``gen_step()`` source (LLM)
2. Run skill CLIs from the project cwd
3. Classify failures with repair-loop semantics
4. Mandatory multi-view snapshot review (fail closed)
5. Feed concrete repair notes back into the next source edit
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def needs_multi_view_packet(prompt: str, source: str, inspect_summary: dict[str, Any] | None = None) -> bool:
    """Jake snapshot-review.md packet-sizing triggers."""
    text = f"{prompt}\n{source}".lower()
    triggers = (
        "assembly",
        "gear",
        "planet",
        "ring",
        "stair",
        "baluster",
        "handrail",
        "hole",
        "bore",
        "cavity",
        "shell",
        "rib",
        "blade",
        "pattern",
        "compound",
        "carrier",
        "pin",
    )
    if any(token in text for token in triggers):
        return True
    if inspect_summary:
        solids = inspect_summary.get("solidCount") or inspect_summary.get("solids") or 0
        try:
            if int(solids) > 1:
                return True
        except Exception:
            pass
    return "Compound(" in source or "children=" in source


def build_snapshot_job(
    *,
    step_name: str,
    base: str,
    multi_view: bool,
) -> dict[str, Any]:
    """Jake diagnostic packet (iso + opposite + top + front) or single iso."""
    if multi_view:
        outputs = [
            {"path": f"{base}_snapshot_iso.png", "camera": "iso"},
            {"path": f"{base}_snapshot_iso_opposite.png", "camera": {"direction": [-1, 1, -0.8]}},
            {"path": f"{base}_snapshot_top.png", "camera": "top"},
            {"path": f"{base}_snapshot_front.png", "camera": "front"},
        ]
        # Jake snapshot-review.md small packet uses diagnostic, not assembly.
        size_profile = "diagnostic"
    else:
        outputs = [{"path": f"{base}_snapshot.png", "camera": "iso"}]
        size_profile = "diagnostic"
    return {
        "input": step_name,
        "mode": "view",
        "outputs": outputs,
        "render": {
            "viewLabels": True,
            "padding": 0.12,
            "sizeProfile": size_profile,
        },
    }


def classify_cli_failure(stderr_or_note: str) -> dict[str, str]:
    """Map CLI/output text to Jake repair-loop.md failure classes."""
    text = (stderr_or_note or "").strip()
    lower = text.lower()
    if not text:
        return {
            "class": "unknown",
            "guidance": "Reread repair-loop.md. Make the smallest source edit, then rerun the failed command.",
        }
    if any(tok in lower for tok in ("nameerror", "undefined", "not defined", "importerror", "syntaxerror")):
        return {
            "class": "source_import_or_syntax",
            "guidance": (
                "Source import/syntax failure (Jake repair-loop). Fix imports/syntax, ensure gen_step() exists, "
                "and define every helper gen_step() calls in this same file. Prefer inlining geometry over stubs. "
                "Edit the existing source; do not restart from an unrelated model."
            ),
        }
    if (
        "typeerror" in lower
        and any(
            tok in lower
            for tok in (
                "locations",
                "not iterable",
                "after * must be an iterable",
                "'float' object is not iterable",
                "float' object is not iterable",
                "_positions",
            )
        )
    ) or (
        "float" in lower and "not iterable" in lower
    ):
        return {
            "class": "locations_or_positions_type",
            "guidance": (
                "Locations/positions type failure. Any name used with Locations(*name) or "
                "`for x, y in name` MUST be a list/tuple of coordinates, never a float. "
                "Example: rod_hole_positions = [(-30.0, -10.0), (-10.0, -10.0), (10.0, -10.0), (30.0, -10.0), "
                "(-30.0, 10.0), (-10.0, 10.0), (10.0, 10.0), (30.0, 10.0)]. "
                "Prefer GridLocations(nx, ny, pitch_x, pitch_y) for regular hole grids. "
                "Delete any `*_positions = 10.0` style assignments and replace with a real list."
            ),
        }
    if any(tok in lower for tok in ("fillet", "chamfer")):
        return {
            "class": "fillet_or_chamfer",
            "guidance": (
                "Fillet/chamfer failure. Reduce radius/length, narrow edge selection, or remove the failing "
                "fillet/chamfer and rebuild incrementally."
            ),
        }
    if any(tok in lower for tok in ("boolean", "cut fail", "fuse", "common", "bopalgo", "segfault", "signal")):
        return {
            "class": "boolean_or_kernel",
            "guidance": (
                "Boolean/kernel failure. Simplify the failing boolean, ensure tools fully intersect targets, "
                "avoid zero-thickness sheets, and rebuild the failing feature incrementally."
            ),
        }
    if "snapshot" in lower:
        return {
            "class": "snapshot",
            "guidance": (
                "Snapshot failure. Ensure STEP exists and is valid, then rerun scripts/snapshot. "
                "Do not skip visual review when geometry was created."
            ),
        }
    if any(tok in lower for tok in ("open wire", "not closed", "zero thickness", "null shape", "empty")):
        return {
            "class": "invalid_or_missing_geometry",
            "guidance": (
                "Invalid/missing geometry. Close sketches intended as faces, keep dimensions positive, "
                "and ensure subtractive tools pass through when through-cuts are intended."
            ),
        }
    return {
        "class": "cli_failure",
        "guidance": (
            "CLI failure. Read the error tail, make the smallest responsible source change, "
            "rerun the failed command, then rerun dependent inspect/snapshot checks."
        ),
    }


def format_agent_repair_note(*, stage: str, detail: str, attempt: int, max_attempts: int) -> str:
    """Build a repair note the source-editing model can act on like Codex."""
    classified = classify_cli_failure(detail)
    return (
        f"[Jake authoring agent turn {attempt + 1}/{max_attempts}] stage={stage} "
        f"failure_class={classified['class']}\n"
        f"{classified['guidance']}\n\n"
        f"Command/review output:\n{detail.strip()[:3500]}\n\n"
        "Edit the existing gen_step() source in place. Preserve working geometry. "
        "Return one complete runnable Python file."
    )


def format_surgical_edit_note(*, user_prompt: str, source_name: str) -> str:
    """Jake-style revise/edit contract: smallest source change, not a rewrite."""
    return (
        "\n\nJAKE EDIT / REVISE MODE (source modification, not new part):\n"
        f"- You are modifying the existing generator `{source_name}`.\n"
        "- Keep the same filename lineage, part role, orientation, and units (mm).\n"
        "- Make the SMALLEST responsible source change that satisfies this request:\n"
        f"  {user_prompt.strip()}\n"
        "- Prefer editing named parameters, feature blocks, or one helper — do not rewrite the whole model.\n"
        "- Preserve working geometry, labels, and mates unless the prompt asks to change them.\n"
        "- After editing, the next scripts/step → inspect → snapshot packet must visibly reflect the change.\n"
        "- Never invent bare floats for list constants (wrong: rod_hole_positions = 10.0).\n"
        "- Return one complete runnable Python file with gen_step().\n"
    )


def jake_required_workflow_summary() -> str:
    """Short mirror of upstream text-to-cad Required workflow for traces/prompts."""
    return (
        "Jake workflow: classify → CAD brief → edit gen_step source → scripts/step "
        "→ scripts/inspect (facts/planes/positioning) → scripts/snapshot (mandatory) "
        "→ visual review (fail-closed) → repair-loop smallest edit → rerun."
    )


def collect_snapshot_pngs(project_path: Path, base: str) -> list[str]:
    """Return newest packet PNGs for this base (multi-view preferred)."""
    preferred = [
        f"{base}_snapshot_iso.png",
        f"{base}_snapshot_iso_opposite.png",
        f"{base}_snapshot_top.png",
        f"{base}_snapshot_front.png",
        f"{base}_snapshot.png",
    ]
    found: list[str] = []
    for name in preferred:
        # scripts/snapshot may append UTC timestamps before the extension.
        stem = Path(name).stem
        matches = sorted(project_path.glob(f"{stem}*.png"), key=lambda p: p.stat().st_mtime)
        if matches:
            found.append(matches[-1].name)
        elif (project_path / name).is_file():
            found.append(name)
    if found:
        # de-dupe preserving order
        seen: set[str] = set()
        ordered: list[str] = []
        for name in found:
            if name not in seen:
                seen.add(name)
                ordered.append(name)
        return ordered
    # Fallback: any recent snapshot for this base
    any_shots = sorted(project_path.glob(f"{base}_snapshot*.png"), key=lambda p: p.stat().st_mtime)
    return [p.name for p in any_shots[-4:]]


def write_snapshot_job_file(project_path: Path, job: dict[str, Any], base: str) -> Path:
    path = project_path / f".{base}.snapshot-job.json"
    path.write_text(json.dumps(job, indent=2) + "\n", encoding="utf-8")
    return path


def extract_dimension_hints(prompt: str, cad_brief: str) -> list[str]:
    """Pull simple mm dimensions for optional inspect follow-ups after visual fails."""
    text = f"{prompt}\n{cad_brief}"
    hints: list[str] = []
    for match in re.finditer(r"(\d+(?:\.\d+)?)\s*mm", text, flags=re.I):
        hints.append(match.group(0))
        if len(hints) >= 8:
            break
    return hints
