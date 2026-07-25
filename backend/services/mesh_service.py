"""Mesh mode: img2threejs-style procedural Three.js → GLB for the viewport.

Mirrors Jake Mode 2.0: write → export → review → repair → continue until gates pass
(or cancel). Artifacts are Three.js factories exported via headless GLTFExporter.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from backend.services.ai_service import AIService
from backend.services.trace_log import add as trace_add

ProgressCb = Callable[[dict[str, Any]], None] | None
CancelCb = Callable[[], bool] | None
UsageCb = Callable[[list[dict[str, Any]]], None] | None

SKILL_DIR = Path(__file__).resolve().parent.parent / "skills" / "img2threejs"
EXPORT_SCRIPT = SKILL_DIR / "scripts" / "export_glb.mjs"

MESH_CHECKLIST = (
    {"id": "analyze", "label": "Analyze prompt & reference"},
    {"id": "generate", "label": "Write Three.js factory"},
    {"id": "export", "label": "Export GLB"},
    {"id": "review", "label": "Review mesh vs brief"},
    {"id": "finalize", "label": "Finalize viewport model"},
)

MESH_SYSTEM = """You are the img2threejs Mesh builder for Render3D.

Rebuild the requested object as a CODE-ONLY procedural Three.js model (primitives + materials).
This is reconstruction-by-code — NOT photogrammetry, NOT downloading meshes.

Output ONLY a complete ES module. No markdown fences. No prose.

Contract:
```js
export default function createModel(THREE) {
  const root = new THREE.Group();
  root.name = "MeshModel";
  // ... build from BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry,
  // TorusGeometry, ExtrudeGeometry, LatheGeometry, TubeGeometry, CapsuleGeometry
  // Materials: MeshStandardMaterial / MeshPhysicalMaterial with real metalness/roughness
  // Hierarchy: name parts, nest under pivots/groups for animation readiness
  return root;
}
```

Rules:
- Units: millimeters-ish (typical object ~20–400 units across).
- Coordinate frame: Three.js Y-up (Y is vertical / height). The exporter converts to Render3D Z-up.
- Prefer real colors from the reference image / prompt (hex or THREE.Color).
- Independent PBR channels — never fake metal with bright albedo alone.
- Compound objects need multiple named meshes (body, lid, handle, trim…), not one blob.
- Infer unseen sides by mirroring; do not invent fake fine detail you cannot justify.
- No imports, no network, no document/window, no TextureLoader URLs.
- Do not add lights or cameras — only the object Group.
- Seat the model roughly around origin; the exporter will floor-align.
"""

MESH_REVIEW_SYSTEM = """You are the Mesh visual/structure reviewer for Render3D (img2threejs).

Given the user brief, the Three.js factory source, and export metadata, decide if the mesh is good enough to ship to the viewport.

Return JSON only:
{"pass": true|false, "issues": ["..."], "repair_brief": "..."}

Rules:
- pass=true when major named parts from the brief exist, silhouette/proportions are plausible, and materials roughly match.
- pass=false for missing primary parts, collapsed/degenerate size, wrong hierarchy, or materials that ignore the brief.
- repair_brief: short concrete instructions for the next factory rewrite (what to add/fix). Empty string when pass=true.
- Do not ask for photogrammetry or external assets.
"""


def _find_node() -> str:
    env = (os.environ.get("RENDER3D_NODE") or os.environ.get("NODE_BIN") or "").strip()
    if env and Path(env).is_file():
        return env
    which = shutil.which("node")
    if which:
        return which
    cursor_bins = sorted(Path("/home/ubuntu/.cursor-server/bin").glob("linux-*/node"))
    for candidate in reversed(cursor_bins):
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError("Node.js is required for Mesh mode (img2threejs GLB export).")


def _strip_fences(text: str) -> str:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:js|javascript|ts|typescript|json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def _looks_like_factory(source: str) -> bool:
    return bool(
        re.search(r"export\s+default\s+function\s+\w*\s*\(", source)
        or re.search(r"export\s+(?:async\s+)?function\s+(?:createModel|createObjectModel|build)\s*\(", source)
        or re.search(r"export\s+default\s+\w+", source)
    )


def _mesh_checklist(stage: str, label: str | None = None) -> list[dict[str, Any]]:
    ids = [item["id"] for item in MESH_CHECKLIST]
    active = stage if stage in ids else ""
    if stage == "done":
        active = "finalize"
    active_idx = ids.index(active) if active in ids else -1
    out: list[dict[str, Any]] = []
    for i, item in enumerate(MESH_CHECKLIST):
        if stage == "done":
            status = "done"
        elif active_idx < 0:
            status = "pending"
        elif i < active_idx:
            status = "done"
        elif i == active_idx:
            status = "active"
        else:
            status = "pending"
        entry = {"id": item["id"], "label": item["label"], "status": status}
        if status == "active" and label:
            entry["detail"] = str(label)[:240]
        out.append(entry)
    return out


def _progress(cb: ProgressCb, stage: str, pct: int, label: str) -> None:
    if not cb:
        return
    cb(
        {
            "stage": stage,
            "pct": pct,
            "label": label,
            "pipeline": "img2threejs",
            "checklist": _mesh_checklist(stage if stage != "done" else "done", label),
        }
    )


def _safe_stem(raw: str, *, max_len: int = 48) -> str:
    stem = re.sub(r'[\\/:*?"<>|]+', "", (raw or "").strip(" ."))
    stem = re.sub(r"\s+", " ", stem).strip()
    if len(stem) > max_len:
        stem = stem[:max_len].rstrip(" .-_")
    return stem or "mesh_model"


def _run_export(
    factory_path: Path,
    out_glb: Path,
    *,
    timeout_sec: float = 90.0,
    cancel_check: CancelCb = None,
) -> dict[str, Any]:
    node = _find_node()
    scripts_dir = EXPORT_SCRIPT.parent
    cmd = [node, str(EXPORT_SCRIPT), str(factory_path), str(out_glb)]
    proc = subprocess.Popen(
        cmd,
        cwd=str(scripts_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ, "NODE_PATH": str(scripts_dir / "node_modules")},
    )
    deadline = time.monotonic() + max(5.0, float(timeout_sec))
    stdout = ""
    stderr = ""
    try:
        while True:
            if cancel_check and cancel_check():
                proc.kill()
                try:
                    proc.wait(timeout=3)
                except Exception:
                    pass
                raise RuntimeError("Generation canceled.")
            if proc.poll() is not None:
                break
            if time.monotonic() >= deadline:
                proc.kill()
                try:
                    proc.wait(timeout=3)
                except Exception:
                    pass
                raise subprocess.TimeoutExpired(cmd, timeout_sec)
            time.sleep(0.25)
        stdout, stderr = proc.communicate(timeout=5)
    except RuntimeError:
        raise
    except subprocess.TimeoutExpired:
        raise
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
        if proc.poll() is not None:
            stdout, stderr = proc.communicate(timeout=5)
        raise
    stdout = (stdout or "").strip()
    stderr = (stderr or "").strip()
    meta: dict[str, Any] = {}
    if stdout:
        try:
            for line in reversed(stdout.splitlines()):
                line = line.strip()
                if line.startswith("{"):
                    meta = json.loads(line)
                    break
        except Exception:
            meta = {"raw": stdout[-2000:]}
    return {
        "ok": proc.returncode == 0 and out_glb.is_file() and out_glb.stat().st_size > 100,
        "exit_code": proc.returncode,
        "stdout": stdout[-4000:],
        "stderr": stderr[-4000:],
        "meta": meta,
        "bytes": out_glb.stat().st_size if out_glb.is_file() else 0,
        "command": cmd,
    }


def _parse_review(raw: str) -> dict[str, Any]:
    text = _strip_fences(raw)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    # Truncated / messy JSON — best-effort
    passed = bool(re.search(r'"pass"\s*:\s*true', text, re.I))
    failed = bool(re.search(r'"pass"\s*:\s*false', text, re.I))
    repair = ""
    m = re.search(r'"repair_brief"\s*:\s*"((?:\\.|[^"\\])*)"', text)
    if m:
        repair = bytes(m.group(1), "utf-8").decode("unicode_escape")
    return {
        "pass": passed and not failed,
        "issues": [],
        "repair_brief": repair or ("Reviewer did not confirm pass." if not passed else ""),
    }


def _review_factory(
    ai: AIService,
    *,
    prompt: str,
    source: str,
    export_meta: dict[str, Any],
    trace_id: str | None,
) -> tuple[bool, str, dict[str, Any] | None]:
    """Return (passed, repair_brief, ai_trace)."""
    size = export_meta.get("size") if isinstance(export_meta, dict) else None
    user = (
        f"User brief:\n{prompt[:4000]}\n\n"
        f"Export meta: bytes={export_meta.get('bytes') if isinstance(export_meta, dict) else None}, "
        f"size={size}\n\n"
        f"Factory source:\n```js\n{source[:14000]}\n```"
    )
    try:
        text, trace = ai._call_model(
            MESH_REVIEW_SYSTEM,
            user,
            trace_id=trace_id,
            max_tokens=1200,
            json_response=True,
            allow_truncated=True,
        )
    except Exception as exc:
        # Soft-open on reviewer failure — keep exported mesh (2.0 still iterates on hard gates;
        # Mesh treats review crashes as pass-with-warning so a good export is not discarded).
        return True, f"Reviewer unavailable ({exc}); accepting export.", None

    data = _parse_review(text or "")
    passed = bool(data.get("pass"))
    repair = str(data.get("repair_brief") or "").strip()
    if not passed and not repair:
        issues = data.get("issues") or []
        repair = "; ".join(str(x) for x in issues[:6]) or "Improve fidelity to the brief."
    return passed, repair, trace if isinstance(trace, dict) else None


def run_mesh_img2threejs(
    prompt: str,
    project_path: Path,
    context: dict[str, Any],
    ai: AIService,
    *,
    trace_id: str | None = None,
    images: list[dict[str, Any]] | None = None,
    previous_source: str | None = None,
    previous_source_name: str | None = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
    max_repairs: int = 12,
) -> dict[str, Any]:
    """Generate a procedural Three.js factory and export a viewport GLB (Jake-style loop)."""
    from backend.services.project_store import file_stem_from_prompt

    project_path = Path(project_path)
    ctx = context or {}
    target_mode = str(ctx.get("target_mode") or "").strip().lower()
    base_filename = str(ctx.get("base_filename") or "").strip() or None
    is_edit = target_mode == "edit" or bool(previous_source_name and base_filename)

    # Prefer the selected object stem on Edit so we overwrite that GLB instead of
    # inventing a new prompt-derived name.
    base = ""
    if previous_source_name:
        base = Path(previous_source_name).stem
    if not base and is_edit and base_filename:
        base = Path(base_filename).stem
    if base.endswith(".mesh"):
        base = base[: -len(".mesh")]
    if not base:
        base = file_stem_from_prompt(prompt, max_len=48) or "mesh_model"
    if not is_edit and base.lower() in {"create", "make", "build", "design", "new model", "mesh"}:
        better = file_stem_from_prompt(prompt, max_len=48)
        if better and better.lower() not in {"new model", "mesh"}:
            base = better
        else:
            base = "mesh_model"
    base = _safe_stem(base, max_len=48)

    factory_name = f"{base}.mesh.mjs"
    glb_name = f"{base}.glb"
    factory_path = project_path / factory_name
    glb_path = project_path / glb_name
    ai_traces: list[dict[str, Any]] = []

    def _sync_usage() -> None:
        if usage_callback and ai_traces:
            usage_callback(list(ai_traces))

    def _canceled() -> bool:
        return bool(cancel_check and cancel_check())

    def _success(source: str, attempts: int, note: str | None = None) -> dict[str, Any]:
        action = "Updated" if is_edit else "Built"
        msg = f"{action} {base} as a procedural Three.js mesh (img2threejs)."
        if note:
            msg = f"{msg} {note}"
        _progress(progress_callback, "done", 100, "Mesh ready")
        return {
            "intent": "generative",
            "message": msg,
            "specs_used": ["img2threejs"],
            "result": {
                "primary": glb_name,
                "files": {
                    "source": factory_name,
                    "glb": glb_name,
                },
                "glb": glb_name,
                "source": factory_name,
                "pipeline": "img2threejs",
            },
            "attempts": attempts,
            "ai_trace": ai_traces,
            "dfm_warnings": [],
            "primary": glb_name,
            "filename": glb_name,
        }

    _progress(progress_callback, "analyze", 8, "Mesh · analyzing reference…")

    has_image = bool(images)
    edit_line = (
        f"EDIT selected object `{base_filename or glb_name}` — revise the existing procedural mesh in place; "
        "keep the same overall identity unless the user asks to change it.\n"
        if is_edit
        else "NEW object — create a fresh procedural mesh (do not reuse unrelated project parts).\n"
    )
    user_brief = (
        f"{edit_line}"
        f"User request:\n{prompt.strip()}\n\n"
        f"{'A reference image is attached — match proportions, silhouette, and colours.' if has_image else 'No image attached — invent a clean hard-surface prop from the description.'}\n"
        f"Write {factory_name} as a complete ES module factory (export default function createModel(THREE))."
    )
    if previous_source and previous_source.strip():
        user_brief += (
            "\n\nExisting factory to revise (keep structure where possible):\n"
            f"```js\n{previous_source[:12000]}\n```"
        )
    elif is_edit:
        user_brief += (
            "\n\nNo prior Three.js factory was found for this selection — rebuild a new factory that "
            "replaces the selected object while matching the edit request."
        )

    source = previous_source or ""
    last_error = None
    attempts = 0
    last_good_export: dict[str, Any] | None = None
    budget = max(1, int(max_repairs))

    for attempt in range(budget):
        if _canceled():
            # Prefer shipping a last-good GLB rather than discarding work (2.0 keeps artifacts).
            if last_good_export and glb_path.is_file() and glb_path.stat().st_size > 100 and source:
                factory_path.write_text(source, encoding="utf-8")
                return _success(source, attempts or attempt + 1, note="(stopped after last good export)")
            raise RuntimeError("Generation canceled.")

        attempts = attempt + 1
        _progress(
            progress_callback,
            "generate",
            min(70, 12 + attempt * 8),
            f"Mesh · writing Three.js factory (try {attempts}/{budget})…",
        )

        repair_block = ""
        if last_error:
            repair_block = (
                "\n\nPrevious attempt failed review/export. Fix the factory and return the FULL module only.\n"
                f"Feedback:\n{last_error[:3500]}\n"
            )

        try:
            text, trace = ai._call_model(
                MESH_SYSTEM,
                user_brief + repair_block,
                trace_id=trace_id,
                images=images if attempt == 0 else None,
                max_tokens=12000,
                json_response=False,
                allow_truncated=False,
            )
            if isinstance(trace, dict):
                ai_traces.append(trace)
                _sync_usage()
        except Exception as exc:
            last_error = str(exc)
            trace_add("error", f"[Mesh] AI factory write failed: {exc}", trace_id=trace_id)
            continue

        source = _strip_fences(text)
        # Tolerate leading prose if a factory is present later in the blob.
        if not _looks_like_factory(source) or "THREE" not in source:
            last_error = "Model did not return a valid createModel(THREE) ES module."
            continue
        # If the model wrapped the factory in commentary, keep from first export.
        m = re.search(r"export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)", source)
        if m and m.start() > 0:
            source = source[m.start() :].strip()

        factory_path.write_text(source, encoding="utf-8")
        _progress(progress_callback, "export", min(88, 55 + attempt * 5), "Mesh · exporting GLB…")

        # Finish the current export even if cancel flips after the write — cancel still
        # kills a hung exporter via cancel_check inside _run_export.
        try:
            export = _run_export(factory_path, glb_path, cancel_check=_canceled)
        except RuntimeError as exc:
            if "canceled" in str(exc).lower():
                if last_good_export and glb_path.is_file() and glb_path.stat().st_size > 100:
                    return _success(source, attempts, note="(stopped after last good export)")
                raise
            last_error = str(exc)
            continue
        except subprocess.TimeoutExpired:
            last_error = "GLB export timed out."
            continue
        except Exception as exc:
            last_error = f"Export failed: {exc}"
            continue

        if not export.get("ok"):
            last_error = export.get("stderr") or export.get("stdout") or "GLB export failed"
            trace_add("warning", f"[Mesh] Export failed (try {attempts}): {last_error[:400]}", trace_id=trace_id)
            continue

        last_good_export = export
        trace_add(
            "info",
            f"[Mesh] Exported {glb_name} ({export.get('bytes')} bytes)",
            trace_id=trace_id,
            data=export.get("meta") or {},
        )

        # Review gate (Jake-style). Soft-open on reviewer crashes.
        _progress(progress_callback, "review", min(96, 78 + attempt * 2), "Mesh · reviewing against brief…")
        if _canceled():
            return _success(source, attempts, note="(stopped after export)")

        passed, repair_brief, review_trace = _review_factory(
            ai,
            prompt=prompt,
            source=source,
            export_meta={"bytes": export.get("bytes"), **(export.get("meta") or {})},
            trace_id=trace_id,
        )
        if isinstance(review_trace, dict):
            ai_traces.append(review_trace)
            _sync_usage()

        if passed:
            return _success(source, attempts)

        last_error = repair_brief or "Mesh review requested repairs."
        trace_add("warning", f"[Mesh] Review requested repair (try {attempts}): {last_error[:400]}", trace_id=trace_id)
        # Continue like 2.0 — keep iterating with the repair brief.

    if last_good_export and glb_path.is_file() and glb_path.stat().st_size > 100 and source:
        # Exhausted budget but we have a shippable GLB — return it (2.0 also surfaces best effort).
        return _success(source, attempts, note="(shipped last export after repair budget)")

    raise RuntimeError(last_error or "Mesh generation failed")
