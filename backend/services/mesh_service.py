"""Mesh mode: img2threejs-style procedural Three.js → GLB for the viewport.

Mirrors the Jake text-to-cad flow (AI writes code → run skill script → load GLB),
but the artifact is a Three.js factory exported via headless GLTFExporter.
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
- Prefer real colors from the reference image / prompt (hex or THREE.Color).
- Independent PBR channels — never fake metal with bright albedo alone.
- Compound objects need multiple named meshes (body, lid, handle, trim…), not one blob.
- Infer unseen sides by mirroring; do not invent fake fine detail you cannot justify.
- No imports, no network, no document/window, no TextureLoader URLs.
- Do not add lights or cameras — only the object Group.
- Seat the model roughly around origin; the exporter will floor-align.
"""


def _find_node() -> str:
    env = (os.environ.get("RENDER3D_NODE") or os.environ.get("NODE_BIN") or "").strip()
    if env and Path(env).is_file():
        return env
    which = shutil.which("node")
    if which:
        return which
    # Cursor-server bundled Node (dev hosts without system node/npm).
    cursor_bins = sorted(Path("/home/ubuntu/.cursor-server/bin").glob("linux-*/node"))
    for candidate in reversed(cursor_bins):
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError("Node.js is required for Mesh mode (img2threejs GLB export).")


def _strip_fences(text: str) -> str:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:js|javascript|ts|typescript)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def _looks_like_factory(source: str) -> bool:
    return bool(
        re.search(r"export\s+default\s+function\s+\w*\s*\(", source)
        or re.search(r"export\s+(?:async\s+)?function\s+(?:createModel|createObjectModel|build)\s*\(", source)
        or re.search(r"export\s+default\s+\w+", source)
    )


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
        stdout, stderr = proc.communicate(timeout=5) if proc.poll() is not None else ("", "")
        raise
    stdout = (stdout or "").strip()
    stderr = (stderr or "").strip()
    meta: dict[str, Any] = {}
    if stdout:
        try:
            # last JSON line
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
    max_repairs: int = 3,
) -> dict[str, Any]:
    """Generate a procedural Three.js factory and export a viewport GLB."""
    from backend.services.project_store import file_stem_from_prompt

    project_path = Path(project_path)
    base = Path(previous_source_name).stem if previous_source_name else ""
    if not base:
        base = file_stem_from_prompt(prompt) or "mesh_model"
    if base.lower() in {"create", "make", "build", "design", "new model", "mesh"}:
        better = file_stem_from_prompt(prompt)
        if better and better.lower() not in {"new model", "mesh"}:
            base = better
        else:
            base = "mesh_model"

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

    if progress_callback:
        progress_callback({"stage": "analyze", "pct": 8, "label": "Mesh · analyzing reference…"})

    has_image = bool(images)
    user_brief = (
        f"User request:\n{prompt.strip()}\n\n"
        f"{'A reference image is attached — match proportions, silhouette, and colours.' if has_image else 'No image attached — invent a clean hard-surface prop from the description.'}\n"
        f"Write {factory_name} as a complete ES module factory (export default function createModel(THREE))."
    )
    if previous_source and previous_source.strip():
        user_brief += (
            "\n\nExisting factory to revise (keep structure where possible):\n"
            f"```js\n{previous_source[:12000]}\n```"
        )

    source = previous_source
    last_error = None
    attempts = 0

    for attempt in range(max(1, max_repairs)):
        if _canceled():
            raise RuntimeError("Generation canceled.")
        attempts = attempt + 1
        if progress_callback:
            progress_callback(
                {
                    "stage": "generate",
                    "pct": 15 + attempt * 20,
                    "label": f"Mesh · writing Three.js factory (try {attempts})…",
                }
            )

        repair_block = ""
        if last_error:
            repair_block = (
                "\n\nPrevious export failed. Fix the factory.\n"
                f"Error:\n{last_error[:2500]}\n"
                "Return the FULL corrected module only."
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
        if not _looks_like_factory(source) or "THREE" not in source:
            last_error = "Model did not return a valid createModel(THREE) ES module."
            continue

        factory_path.write_text(source, encoding="utf-8")
        if progress_callback:
            progress_callback(
                {
                    "stage": "export",
                    "pct": 55 + attempt * 10,
                    "label": "Mesh · exporting GLB…",
                }
            )
        if _canceled():
            raise RuntimeError("Generation canceled.")

        try:
            export = _run_export(factory_path, glb_path, cancel_check=_canceled)
        except RuntimeError as exc:
            if "canceled" in str(exc).lower():
                raise
            last_error = str(exc)
            continue
        except subprocess.TimeoutExpired:
            last_error = "GLB export timed out."
            continue
        except Exception as exc:
            last_error = f"Export failed: {exc}"
            continue

        if export.get("ok"):
            trace_add(
                "info",
                f"[Mesh] Exported {glb_name} ({export.get('bytes')} bytes)",
                trace_id=trace_id,
                data=export.get("meta") or {},
            )
            if progress_callback:
                progress_callback({"stage": "done", "pct": 100, "label": "Mesh ready"})
            return {
                "intent": "generative",
                "message": f"Built {base} as a procedural Three.js mesh (img2threejs).",
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

        last_error = export.get("stderr") or export.get("stdout") or "GLB export failed"
        trace_add("warning", f"[Mesh] Export failed (try {attempts}): {last_error[:400]}", trace_id=trace_id)

    raise RuntimeError(last_error or "Mesh generation failed")
