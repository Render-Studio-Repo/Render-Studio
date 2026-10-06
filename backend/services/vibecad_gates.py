"""Fail-closed VibeCAD gates: design review, worker inspect, viewport capture.

Uses the VibeCAD kernel (build123d worker facts + Playwright viewport PNGs).
Does not call Jake cadgen inspect/snapshot.
"""

from __future__ import annotations

import json
import logging
import hashlib
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

ProgressCb = Optional[Callable[[dict[str, Any]], None]]
# Upstream VibeCAD reviews a constructed draft in a human Accept/Reject dock.
# Render Studio has no mid-generate dock, so the LLM reviewer may run twice,
# then construction must proceed. Infinite review↔revise is not VibeCAD.
MAX_DESIGN_REVIEW_PASSES = 2
CAPTURE_SCRIPT = (
    Path(__file__).resolve().parents[1] / "skills" / "vibecad" / "scripts" / "capture_views.py"
)


def _resolve_viewport_capture_python() -> str:
    """Use a runtime that actually has Playwright, independent of the CAD kernel."""
    from backend.services.skill_runner import resolve_cad_python

    candidates = tuple(dict.fromkeys((sys.executable, resolve_cad_python())))
    errors: list[str] = []
    for executable in candidates:
        try:
            probe = subprocess.run(
                [executable, "-c", "from playwright.sync_api import sync_playwright"],
                capture_output=True,
                text=True,
                timeout=15,
            )
        except Exception as exc:
            errors.append(f"{executable}: {exc}")
            continue
        if probe.returncode == 0:
            return executable
        errors.append(f"{executable}: {(probe.stderr or probe.stdout).strip()[:240]}")
    raise RuntimeError("Viewport capture runtime has no Playwright installation. " + " | ".join(errors))


def review_has_blocking(review: dict[str, Any] | None) -> bool:
    if not isinstance(review, dict):
        return False
    verdict = str(review.get("verdict") or "").strip().lower()
    if verdict == "revise":
        return True
    findings = review.get("findings") if isinstance(review.get("findings"), list) else []
    for item in findings:
        if not isinstance(item, dict):
            continue
        sev = str(item.get("severity") or "").strip().lower()
        if sev in {"blocking", "blocker", "critical", "major"}:
            return True
    return False


def format_blocking_review(review: dict[str, Any]) -> str:
    lines = [
        "Design review findings to fold into CAD source.",
        f"Verdict: {review.get('verdict') or 'revise'}.",
        str(review.get("summary") or "").strip(),
    ]
    findings = review.get("findings") if isinstance(review.get("findings"), list) else []
    for item in findings:
        if not isinstance(item, dict):
            continue
        sev = str(item.get("severity") or "issue")
        issue = str(item.get("issue") or "").strip()
        change = str(item.get("required_change") or "").strip()
        if issue:
            lines.append(f"- [{sev}] {issue}")
        if change:
            lines.append(f"  required_change: {change}")
    lines.append(
        "Fold required_change items into the CAD source, then call create_model. "
        "Do not spend the session re-running conversation.review_design."
    )
    return "\n".join(x for x in lines if x).strip()


def _review_pass_count(state: dict[str, Any] | None) -> int:
    try:
        return max(0, int((state or {}).get("review_passes") or 0))
    except (TypeError, ValueError):
        return 0


def review_construct_unlocked(state: dict[str, Any] | None) -> bool:
    """True when the host must let create_model run (review budget spent)."""
    return _review_pass_count(state) >= MAX_DESIGN_REVIEW_PASSES or bool(
        (state or {}).get("review_exhausted")
    )


def assert_review_allows_create(state: dict[str, Any], *, is_edit: bool) -> dict[str, Any] | None:
    """Return an error payload when create must be blocked, else None.

    New designs need one ``review_design`` call. After that, construct — upstream
    VibeCAD builds a draft and reviews it in a human dock, it does not LLM-veto
    create_model until 200 turns.
    """
    if is_edit and not state.get("reviewed"):
        return None
    if not state.get("reviewed"):
        return {
            "ok": False,
            "error": (
                "Call conversation.review_design once before create_model "
                "for new substantial designs."
            ),
            "gate": "design_review_required",
        }
    return None


def inspect_worker_model(worker_result: dict[str, Any] | None) -> dict[str, Any]:
    """build123d.inspect_model equivalent: named-solid facts from the sidecar worker."""
    payload = worker_result if isinstance(worker_result, dict) else {}
    outputs = payload.get("outputs") if isinstance(payload.get("outputs"), list) else []
    if not outputs and payload.get("ok") and (payload.get("step_path") or payload.get("parts")):
        parts = payload.get("parts") if isinstance(payload.get("parts"), list) else ["Part"]
        return {
            "ok": True,
            "engine": "freecad",
            "tool": "build123d.inspect_model",
            "output_count": len(parts) or 1,
            "solids": [
                {"key": str(name), "valid": True, "solid_count": 1, "vertex_count": None, "face_count": None}
                for name in (parts or ["Part"])
            ],
            "error": None,
        }
    solids: list[dict[str, Any]] = []
    for item in outputs:
        if not isinstance(item, dict):
            continue
        shape = item.get("shape") if isinstance(item.get("shape"), dict) else {}
        solids.append(
            {
                "key": item.get("key"),
                "valid": shape.get("valid"),
                "solid_count": shape.get("solid_count"),
                "expected_solid_count": len(item.get("source_keys") or []) or 1,
                "face_count": shape.get("face_count"),
                "edge_count": shape.get("edge_count"),
                "vertex_count": shape.get("vertex_count"),
                "volume_mm3": shape.get("volume_mm3"),
                "bounds_mm": shape.get("bounds_mm"),
            }
        )
    ok = bool(payload.get("ok")) and bool(solids) and all(
        s.get("valid") is True and int(s.get("solid_count") or 0) == s["expected_solid_count"] for s in solids
    )
    return {
        "ok": ok,
        "engine": "build123d",
        "tool": "build123d.inspect_model",
        "output_count": len(solids),
        "solids": solids,
        "error": None if ok else str(payload.get("error") or "worker produced no valid named solids"),
    }


def placeholder_repair_note(inspect_payload: dict[str, Any], prompt: str) -> str | None:
    """Require solids; image review judges whether their geometry fits the brief."""
    solids = inspect_payload.get("solids") if isinstance(inspect_payload.get("solids"), list) else []
    if not solids:
        return "build123d.inspect_model: no named solids. The worker must assign result keys."
    return None


def _png_payload(project_path: Path, snapshot_info: dict[str, Any] | None) -> list[dict[str, Any]]:
    import base64

    images: list[dict[str, Any]] = []
    names = list((snapshot_info or {}).get("files") or [])
    if isinstance((snapshot_info or {}).get("files"), dict):
        names = list((snapshot_info or {}).get("files").values())
    if (snapshot_info or {}).get("file"):
        names.append(str(snapshot_info["file"]))
    seen: set[str] = set()
    for name in names:
        raw = str(name or "").strip()
        if not raw or raw in seen:
            continue
        seen.add(raw)
        path = Path(raw)
        if not path.is_absolute():
            path = project_path / path
        if not path.is_file() or path.suffix.lower() != ".png":
            continue
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        images.append(
            {
                "id": f"vibecad-snapshot-{len(images)}",
                "name": path.name,
                "media_type": "image/png",
                "data_url": f"data:image/png;base64,{data}",
            }
        )
    return images


def capture_viewport_views(
    project_path: Path,
    glb_name: str,
    stem: str,
) -> dict[str, Any]:
    """core.capture_view_screenshot equivalent: iso/top/front of the published GLB."""
    glb = project_path / glb_name
    if not glb.is_file():
        return {"ok": False, "error": f"viewport capture: missing {glb_name}"}
    if not CAPTURE_SCRIPT.is_file():
        return {"ok": False, "error": f"viewport capture script missing: {CAPTURE_SCRIPT}"}
    proc = subprocess.run(
        [
            _resolve_viewport_capture_python(),
            str(CAPTURE_SCRIPT),
            "--glb",
            str(glb),
            "--out-dir",
            str(project_path),
            "--stem",
            stem,
            "--json",
        ],
        cwd=str(project_path),
        capture_output=True,
        text=True,
        timeout=90,
    )
    payload: dict[str, Any] = {}
    raw = (proc.stdout or "").strip()
    if raw:
        try:
            parsed = json.loads(raw[raw.find("{") : raw.rfind("}") + 1] if "{" in raw else raw)
            if isinstance(parsed, dict):
                payload = parsed
        except Exception:
            payload = {}
    if proc.returncode != 0 or not payload.get("ok"):
        err = (proc.stderr or proc.stdout or payload.get("error") or "viewport capture failed")[:1200]
        return {"ok": False, "error": err, "stdout": proc.stdout, "stderr": proc.stderr}
    return payload


def run_post_publish_visual_gate(
    *,
    ai: Any,
    project_path: Path,
    prompt: str,
    source: str,
    published: dict[str, Any],
    worker_result: dict[str, Any] | None = None,
    progress_callback: ProgressCb = None,
    trace_id: str | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Worker inspect (named solids) then viewport capture review. Fail-closed."""
    if cancel_check and cancel_check():
        return {"ok": False, "error": "Generation canceled.", "gate": "inspect"}

    glb_name = str(published.get("glb") or "")
    if not glb_name or not (project_path / glb_name).is_file():
        return {"ok": False, "error": "Visual gate: published GLB missing", "gate": "snapshot"}
    reviewed_glb_sha256 = hashlib.sha256((project_path / glb_name).read_bytes()).hexdigest()

    if progress_callback:
        progress_callback(
            {"stage": "inspect", "pct": 84, "label": "VibeCAD · inspect named solids (worker facts)…"}
        )
    inspect_out = inspect_worker_model(worker_result or published.get("worker_result"))
    if not inspect_out.get("ok"):
        return {
            "ok": False,
            "error": f"build123d.inspect_model failed:\n{inspect_out.get('error')}",
            "gate": "inspect",
            "repair_note": inspect_out.get("error"),
            "inspect": inspect_out,
        }
    quality_note = placeholder_repair_note(inspect_out, prompt)
    if quality_note:
        return {
            "ok": False,
            "error": quality_note,
            "gate": "inspect",
            "repair_note": quality_note,
            "inspect": inspect_out,
        }

    from backend.services.cad_preview_parity import StepPreviewFacts, measure_preview_parity

    try:
        bounds = [solid.get("bounds_mm") for solid in inspect_out["solids"]]
        if bounds and all(isinstance(item, dict) and item.get("min") and item.get("max") for item in bounds):
            minimum = [min(item["min"][axis] for item in bounds) for axis in range(3)]
            maximum = [max(item["max"][axis] for item in bounds) for axis in range(3)]
            evidence_source = "worker_geometry_bounds"
        else:
            from backend.services.cad_service import import_step_mesh

            step_name = str(published.get("step") or "")
            if not step_name:
                raise ValueError("No STEP artifact available for preview bounds")
            mesh = import_step_mesh(project_path / step_name)
            minimum, maximum = mesh.bounds.tolist()
            evidence_source = "step_tessellation_fallback"
        parity = asdict(measure_preview_parity(
            project_path / glb_name,
            StepPreviewFacts(tuple(minimum + maximum), occurrence_count=published.get("preview_occurrence_count")),
        ))
        parity["evidence_source"] = evidence_source
    except Exception as exc:
        parity = {"ok": False, "issues": [str(exc)]}
    if not parity["ok"]:
        note = "STEP-to-GLB parity failed: " + "; ".join(parity["issues"])
        return {"ok": False, "error": note, "repair_note": note, "gate": "preview_parity", "parity": parity, "inspect": inspect_out}

    if progress_callback:
        progress_callback(
            {"stage": "snapshot", "pct": 88, "label": "VibeCAD · viewport capture (iso/top/front)…"}
        )
    stem = Path(glb_name).stem
    try:
        snapshot_info = capture_viewport_views(project_path, glb_name, stem)
    except Exception as exc:
        logger.warning("VibeCAD viewport capture failed: %s", exc)
        snapshot_info = {"ok": False, "error": str(exc)}
    if not snapshot_info.get("ok"):
        return {
            "ok": False,
            "error": (
                "Visual gate: viewport capture failed after publish. "
                + str(snapshot_info.get("error") or "")[:800]
            ),
            "gate": "snapshot",
            "inspect": inspect_out,
        }

    images = _png_payload(project_path, snapshot_info)
    if not images:
        return {
            "ok": False,
            "error": "Visual gate: capture wrote no loadable PNG views.",
            "gate": "snapshot",
            "inspect": inspect_out,
        }

    if progress_callback:
        progress_callback(
            {"stage": "snapshot_review", "pct": 92, "label": "VibeCAD · visual review (fail-closed)…"}
        )
    system = """You are VibeCAD's independent visual reviewer (core.capture_view_screenshot).
Return ONLY JSON: {"pass": boolean, "repair_note": string, "issues": [string]}.
Pass only if the viewport images match the mechanical request and its requested functional features.
Simple boxes, plates, rings, or cylinders are valid when requested. Fail primitive stand-ins for more complex requested geometry, missing requested holes/ports/walls, or a shape that only resembles the brief.
repair_note must be concrete build123d source edits (result dict of named solids)."""
    user = (
        f"User prompt:\n{prompt}\n\n"
        f"Worker inspect:\n{json.dumps(inspect_out, separators=(',', ':'))[:4000]}\n\n"
        f"Source excerpt:\n{source[:8000]}\n\n"
        "Review ALL attached viewport views (iso / top / front). Does this look like the requested part?"
    )
    try:
        review, trace = ai.chat_json(
            system,
            user,
            images=images[:6],
            trace_id=trace_id,
            max_tokens=2048,
            retry_on_truncation=False,
            reasoning_effort="medium",
            pro_floor=None,
        )
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Visual review failed (fail-closed): {exc}",
            "gate": "snapshot_review",
            "repair_note": str(exc),
            "inspect": inspect_out,
        }
    if not isinstance(review, dict):
        return {
            "ok": False,
            "error": "Visual review returned no structured verdict.",
            "gate": "snapshot_review",
            "inspect": inspect_out,
            "snapshot": snapshot_info,
        }
    if cancel_check and cancel_check():
        return {"ok": False, "error": "Generation canceled.", "gate": "snapshot_review"}
    if hashlib.sha256((project_path / glb_name).read_bytes()).hexdigest() != reviewed_glb_sha256:
        return {"ok": False, "error": "GLB changed during visual review.", "gate": "snapshot_review"}
    if review.get("pass") is True:
        return {
            "ok": True,
            "gate": "snapshot_review",
            "ai_trace": trace,
            "inspect": inspect_out,
            "snapshot": snapshot_info,
            "review": review,
            "parity": parity,
            "reviewed_glb_sha256": reviewed_glb_sha256,
        }
    note = str(review.get("repair_note") or "").strip()
    issues = [str(issue) for issue in (review.get("issues") or []) if str(issue).strip()]
    if not note and issues:
        note = "Viewport visual review failed: " + "; ".join(issues)
    if not note:
        note = "Viewport visual review failed: model does not match the brief."
    return {
        "ok": False,
        "error": f"Fail-closed visual review rejected the model:\n{note}",
        "gate": "snapshot_review",
        "repair_note": note,
        "ai_trace": trace,
        "inspect": inspect_out,
        "snapshot": snapshot_info,
    }
