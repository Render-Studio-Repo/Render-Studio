"""Mesh mode: img2threejs 2.0.0 forge pipeline → Three.js factory → viewport GLB.

Kernel: backend/skills/img2threejs (forge/next.py, spec, generate_threejs_factory,
Playwright capture_views.py). Not Jake cadgen.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Optional

from backend.services.ai_service import AIService
from backend.services.mesh_acceptance import candidate_manifest, file_hash, snapshot_payloads, verify_manifest
from backend.services.mesh_sculpt_spec import normalize_mesh_sculpt_spec
from backend.services.prompt_language import with_multilingual_prompt_rule
from backend.services.trace_log import add as trace_add

ProgressCb = Optional[Callable[[dict[str, Any]], None]]
CancelCb = Optional[Callable[[], bool]]
UsageCb = Optional[Callable[[list[dict[str, Any]]], None]]

SKILL_DIR = Path(__file__).resolve().parent.parent / "skills" / "img2threejs"
IMG2_HOME = SKILL_DIR.parent / ".img2"
EXPORT_SCRIPT = SKILL_DIR / "scripts" / "export_glb.mjs"
_SKILL_VERSION_RE = re.compile(r"^version:\s*(\S+)", re.MULTILINE)
_WAND_VERSION_CACHE = ""


def assert_img2threejs_runtime(*, mesh_beta: bool) -> dict[str, str]:
    """Fail before model spend when the vendored Mesh runtime is incomplete."""
    required = {
        "img2threejs": SKILL_DIR / "SKILL.md",
        "exporter": EXPORT_SCRIPT,
        "harness": IMG2_HOME / "harness" / "package.json",
    }
    if mesh_beta:
        required.update(
            {
                "character plugin": IMG2_HOME / "plugins" / "character" / "plugin.json",
                "character domain": IMG2_HOME / "plugins" / "character" / "domain.json",
                "character gates": IMG2_HOME / "plugins" / "character" / "gates.json",
            }
        )
    missing = [label for label, path in required.items() if not path.is_file()]
    if missing:
        mode = "Mesh Beta" if mesh_beta else "Mesh"
        raise RuntimeError(
            f"{mode} runtime is incomplete ({', '.join(missing)} missing). "
            "Run scripts/update-img2threejs-safe.sh --repair before generating."
        )
    return {label: str(path) for label, path in required.items()}


def img2threejs_wand_version() -> str:
    """Wand version from img2threejs SKILL.md front-matter, else 2.0.0."""
    global _WAND_VERSION_CACHE
    if _WAND_VERSION_CACHE:
        return _WAND_VERSION_CACHE
    try:
        text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")[:800]
        match = _SKILL_VERSION_RE.search(text)
        if match:
            _WAND_VERSION_CACHE = match.group(1).strip()
            return _WAND_VERSION_CACHE
    except OSError:
        pass
    _WAND_VERSION_CACHE = "2.0.0"
    return _WAND_VERSION_CACHE

MESH_CHECKLIST = (
    {"id": "analyze", "label": "Analyze image & admission"},
    {"id": "spec", "label": "Sculpt spec / strict-quality"},
    {"id": "generate", "label": "Forge pass (factory)"},
    {"id": "export", "label": "Export GLB"},
    {"id": "snapshot", "label": "Playwright factory views"},
    {"id": "review", "label": "Vision review vs reference"},
    {"id": "finalize", "label": "Finalize viewport model"},
)

MESH_SYSTEM = with_multilingual_prompt_rule("""You are the img2threejs Mesh builder for Render Studio.

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
- Coordinate frame: Three.js Y-up (Y is vertical / height). The exporter converts to Render Studio Z-up.
- Prefer real colors from the reference image / prompt (hex or THREE.Color).
- When a reference image is attached: match silhouette, proportions, part count, and dominant colours first — do not invent a loosely related object.
- Complex subjects (cars, characters, weapons, bikes): NEVER one ExtrudeGeometry for the whole body. Build named blockout parts (body, cabin, nose, haunches, wheels, lights, intakes…) then refine. Prefer LatheGeometry / ExtrudeGeometry per PANEL, not one side-profile blob.
- Independent PBR channels — never fake metal with bright albedo alone.
- Compound objects need multiple named meshes (body, lid, handle, trim…), not one blob. Parent each named part as its own Group/Mesh child of root so the viewport can draw parts as they appear.
- Infer unseen sides by mirroring; do not invent fake fine detail you cannot justify.
- No TextureLoader / photo maps — approximate look with solid MeshPhysicalMaterial / MeshStandardMaterial colours and roughness/metalness.
- No imports, no network, no document/window, no TextureLoader URLs.
- Do not use McMaster-Carr catalog parts, STEP inserts, or project `mcmaster_library` hardware. Rebuild the object from the photo/prompt only.
- Do not add lights or cameras — only the object Group.
- Seat the model roughly around origin; the exporter will floor-align.
""")

MESH_SYSTEM_BETA = MESH_SYSTEM + """
## img2threejs 2.0.0 + plugin-character (animation-ready)

You are building for the Beta animation pipeline (img2threejs 2.0.0 with the registered character plugin). Follow all regular rules AND:

REQUIRED animation plan on the root Group:
```js
root.userData.animation = {
  continuousRotations: [
    { targets: ["Wheel_FL", "Wheel_FR"], axis: [0, 1, 0], speed: 3.0 }
  ],
  oscillations: [
    { targets: ["SteeringPivot"], axis: [0, 0, 1], amplitude: 0.25, frequency: 0.8 }
  ]
};
```

Animation rules:
- Put named pivot Groups for wheels, limbs, doors, propellers, steering, antennae, etc.
- `targets` must match `.name` on those pivot Groups (Wheel_FL, Arm_L, Propeller, …).
- `continuousRotations`: axis in local space (Y-up authorship), speed in radians/sec.
- `oscillations`: sinusoidal rotation around axis; amplitude in radians, frequency in Hz.
- Vehicles: wheelbase ~1.5× wheel diameter; wheels on corner pivot groups.
- Characters / humanoids / creatures: separate Head, Torso, Arm_L, Arm_R, Leg_L, Leg_R pivots.
- Do not bake / applyMatrix4 the same geometry twice — that scatters parts.
- Rigging may only ADD (skinIndex/skinWeight/bones). Never rewrite position/normal/uv buffers.
- A clip that exists must be able to play: named targets must be in the scene graph.
- Set `root.userData.render3dMeshBeta = true`.
- Still no imports, network, lights, or cameras.
"""

MESH_REVIEW_SYSTEM = with_multilingual_prompt_rule("""You are the Mesh visual/structure reviewer for Render Studio (img2threejs).

Given the user brief, optional reference image(s), GLB snapshot views, the Three.js factory source, and export metadata, decide if THIS BUILD PASS is good enough.

Return JSON only:
{"pass": true|false, "issues": ["..."], "repair_brief": "..."}

Rules (img2threejs repo):
- Fail a pass if an identity-defining feature is missing (no helmet, no skull, no eyes when required, one blob, collapsed size).
- pass=true when named major parts exist and the silhouette is recognizable for THIS pass. Mesh is code-only primitives — do not fail structural-pass only because plates still look faceted, chrome is not photo-real, or teeth are simplified.
- When a reference image is attached: pass=false if the object is a different class than the photo (wrong subject), not because bevels/PBR are unfinished.
- pass=false for placeholder blobs, one ExtrudeGeometry for a whole car/character, missing primary parts, collapsed size, or ignoring the photo.
- Include estimatedFidelity from 0 to 1.
- repair_brief: concrete factory edits for the next rewrite. Empty string when pass=true.
- Do not ask for photogrammetry, TextureLoader, or external assets.
""")

MESH_SPEC_SYSTEM = """You fill an img2threejs ObjectSculptSpec so forge/stage2_spec/validate_sculpt_spec.py --strict-quality can pass.

Return JSON only. Merge into the supplied starter spec. Required top-level keys:
targetName, suitability, coordinateFrame, silhouette, componentTree, materials, proceduralStrategy.

Schema types (wrong types fail-close codegen):
- componentTree: a FLAT array of parts. Use parent ids. Do not nest children[] and do not return one tree object.
- proceduralStrategy: an array of strings, never an object.
- qualityContract.featureGroups[].name and featureReviewTargets[].name are required strings (copy from id if needed).
- primitive must be one of: box, sphere, ellipsoid, cylinder, cone, capsule, torus, tube, lathe, extrude, ground-blade, curve-sweep, tapered-sweep, plane-card, instanced-cluster. Never "group" or "custom". Pivots use box + topologyClass material-only.
- topologyClass: assembled-solid | continuous-sculpt | conforming-shell | surface-relief | fiber-strand | material-only | implicit | open-shell.
- Recessed sockets/cavities: topologyClass implicit with geometryDescriptor.sdf operations that include subtract.
- colorMaterialRecipe.dominantAlbedo and secondaryAlbedo must be rgba(r, g, b, a) strings (alpha like 1.0).

Rules:
- suitability: pass or conditional (not unassessed).
- Mesh mode is code-only: omit referencePbr.maps. Do not invent TextureLoader paths or urls. Put color/metalness/roughness on the material.
- preSpecAssessment.objectClass.primaryDomain: object|character|hybrid. Fill formLanguage/structureKind/motionPotential/materialFamilies.
- detailInventory.details: at least targetMinDetails identity features mapped via mapsTo.ref to component.localFeatures or material.localOverrides.
- buildPasses must include: blockout, structural-pass, form-refinement, material-pass, surface-pass, lighting-pass, interaction-pass, optimization-pass.
- lightingFromPhoto: at least three key/fill/rim entries including exposure/tone mapping and contact shadow.
- Keep coordinateFrame Y-up for Three.js authorship.
- Never include McMaster-Carr part numbers, catalog fasteners, or imported STEP hardware.
"""

MESH_PASSES = (
    (
        "blockout",
        "BLOCKOUT PASS: named major volumes only. Match silhouette and part count from the photo. "
        "No fake fillets or decals. Unlit blockout.",
    ),
    (
        "structural-pass",
        "STRUCTURAL PASS: hierarchy, pivots, attachments, and load-bearing connections.",
    ),
    (
        "form-refinement",
        "FORM PASS: refine proportions, panel splits, bevels, and identity features from the photo.",
    ),
    (
        "material-pass",
        "MATERIAL PASS: independent MeshPhysicalMaterial / MeshStandardMaterial per part matching the photo.",
    ),
    (
        "surface-pass",
        "SURFACE PASS: wear, seams, micro detail that the photo shows. Still procedural, no TextureLoader URLs.",
    ),
    (
        "lighting-pass",
        "LIGHTING PASS: do not add scene lights to the exported Group. Encode look-dev in materials/userData only.",
    ),
    (
        "interaction-pass",
        "INTERACTION PASS: named pivots/sockets for later animation. Do not bake transforms twice.",
    ),
    (
        "optimization-pass",
        "OPTIMIZATION PASS: keep named parts; reduce wasteful segments. Do not collapse back to one blob.",
    ),
)


def _find_node() -> str:
    """Resolve a Node binary for headless Mesh GLB export.

    Launchd/uvicorn often has a minimal PATH (no Homebrew / nvm), so we also
    probe common install locations and Cursor-server's bundled Node on macOS/Linux.
    """
    env = (os.environ.get("RENDER3D_NODE") or os.environ.get("NODE_BIN") or "").strip()
    if env and Path(env).is_file() and os.access(env, os.X_OK):
        return env
    which = shutil.which("node")
    if which and Path(which).is_file():
        return which

    home = Path(os.environ.get("HOME") or Path.home())
    candidates: list[Path] = []

    # Explicit / common system installs
    for p in (
        Path("/opt/homebrew/bin/node"),
        Path("/usr/local/bin/node"),
        Path("/usr/bin/node"),
        home / "Library/Application Support/Render3D/node/bin/node",
        home / ".local/bin/node",
    ):
        candidates.append(p)

    # Local node-dist trees (Jake cadgen 0.5 GLB/3MF export needs Node >=20)
    candidates.extend((home / "bin" / "node-dist").glob("*/bin/node"))

    # Cursor-server ships Node under bin/<platform>/<hash>/node
    for root in (
        home / ".cursor-server" / "bin",
        Path("/home/ubuntu/.cursor-server/bin"),
    ):
        if not root.is_dir():
            continue
        candidates.extend(root.glob("darwin-*/*/node"))
        candidates.extend(root.glob("linux-*/*/node"))
        candidates.extend(root.glob("*/node"))

    # nvm / fnm / volta (best-effort newest)
    nvm = home / ".nvm" / "versions" / "node"
    if nvm.is_dir():
        candidates.extend(nvm.glob("*/bin/node"))
    fnm = home / ".local" / "share" / "fnm" / "node-versions"
    if fnm.is_dir():
        candidates.extend(fnm.glob("*/installation/bin/node"))
    volta = home / ".volta" / "bin" / "node"
    candidates.append(volta)

    usable = [c for c in candidates if c.is_file() and os.access(c, os.X_OK)]
    if usable:
        usable.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return str(usable[0])
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


def _mesh_checklist(stage: str, label: Optional[str] = None) -> list[dict[str, Any]]:
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
            "harness": "mesh",
            "wand": "img2threejs",
            "wand_version": img2threejs_wand_version(),
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
    progress_callback: ProgressCb = None,
) -> dict[str, Any]:
    from backend.services.live_preview import cleanup_live_sidecar, emit_live_preview, live_preview_path

    node = _find_node()
    source_sha256 = file_hash(factory_path)
    out_glb.unlink(missing_ok=True)
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
    live_glb = live_preview_path(out_glb)
    last_live_mtime = 0.0
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
            if live_glb.is_file():
                try:
                    mtime = live_glb.stat().st_mtime
                except OSError:
                    mtime = 0.0
                if mtime > last_live_mtime:
                    last_live_mtime = mtime
                    emit_live_preview(
                        progress_callback,
                        live_glb,
                        label="Mesh · drawing in viewport…",
                        stage="export",
                    )
            time.sleep(0.25)
        stdout, stderr = proc.communicate(timeout=5)
    except RuntimeError:
        cleanup_live_sidecar(out_glb)
        raise
    except subprocess.TimeoutExpired:
        cleanup_live_sidecar(out_glb)
        raise
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
        if proc.poll() is not None:
            stdout, stderr = proc.communicate(timeout=5)
        cleanup_live_sidecar(out_glb)
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
    ok = proc.returncode == 0 and out_glb.is_file() and out_glb.stat().st_size > 100
    if ok:
        emit_live_preview(
            progress_callback,
            out_glb,
            label="Mesh · drawing in viewport…",
            stage="export",
            pct=78,
            append=False,
        )
    cleanup_live_sidecar(out_glb)
    return {
        "ok": ok,
        "exit_code": proc.returncode,
        "stdout": stdout[-4000:],
        "stderr": stderr[-4000:],
        "meta": meta,
        "bytes": out_glb.stat().st_size if out_glb.is_file() else 0,
        "command": cmd,
        "source_sha256": source_sha256,
    }


def _parse_review(raw: str) -> dict[str, Any]:
    text = _strip_fences(raw)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {"pass": False, "issues": [], "repair_brief": "Reviewer returned incomplete or invalid JSON."}


def _decode_data_url_bytes(data_url: str) -> tuple[bytes, str]:
    raw = str(data_url or "").strip()
    if "," not in raw:
        return b"", "png"
    header, b64 = raw.split(",", 1)
    ext = "jpg" if ("jpeg" in header or "jpg" in header) else "webp" if "webp" in header else "png"
    try:
        import base64

        return base64.b64decode(b64), ext
    except Exception:
        return b"", ext


def _write_mesh_reference(project_path: Path, images: list[dict[str, Any]]) -> Path | None:
    work = project_path / ".img2threejs"
    work.mkdir(parents=True, exist_ok=True)
    for img in images or []:
        blob, ext = _decode_data_url_bytes(str(img.get("data_url") or ""))
        if len(blob) < 32:
            continue
        dest = work / f"reference.{ext}"
        dest.write_bytes(blob)
        return dest
    return None


def _forge_python() -> str:
    from backend.services.skill_runner import resolve_cad_python

    return resolve_cad_python()


def _forge_run(
    rel: str,
    args: list[str],
    *,
    timeout: float = 60.0,
    cwd: Path | None = None,
) -> dict[str, Any]:
    script = SKILL_DIR / rel
    if not script.is_file():
        return {"ok": False, "exit_code": 127, "stdout": "", "stderr": f"missing {rel}"}
    proc = subprocess.run(
        [_forge_python(), str(script), *args],
        cwd=str(cwd or SKILL_DIR),
        env={**os.environ, "IMG2_HOME": str(IMG2_HOME)},
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "stdout": proc.stdout or "",
        "stderr": proc.stderr or "",
    }


def _init_img2threejs_state(project_path: Path, reference: Path | None, *, mesh_beta: bool) -> Path | None:
    if not reference or not reference.is_file():
        return None
    work = project_path / ".img2threejs"
    work.mkdir(parents=True, exist_ok=True)
    state_path = work / "state.json"
    spec_path = work / "object-sculpt-spec.json"
    if state_path.is_file():
        try:
            state_path.unlink()
        except OSError:
            pass
    out = _forge_run(
        "forge/state.py",
        [
            "init",
            "--state",
            str(state_path),
            "--reference",
            str(reference),
            "--profile",
            "animated-character" if mesh_beta else "generic",
            "--spec",
            str(spec_path),
        ],
        timeout=30,
    )
    if not out.get("ok"):
        trace_add("warning", f"[Mesh] forge/state.py init: {(out.get('stderr') or '')[:400]}")
    return state_path if state_path.is_file() else None


def _forge_next(state_path: Path, spec_path: Path | None = None) -> dict[str, Any]:
    args = ["--state", str(state_path)]
    if spec_path and spec_path.is_file():
        args.append(str(spec_path))
    return _forge_run("forge/next.py", args, timeout=30)


def _forge_mark(state_path: Path, step_id: str, *, evidence: str = "") -> None:
    args = [step_id, "--state", str(state_path), "--status", "done"]
    if evidence:
        args.extend(["--evidence", evidence])
    _forge_run("forge/state.py", ["mark", *args], timeout=20)


def _admit_reference(reference: Path) -> dict[str, Any]:
    out = _forge_run(
        "forge/stage1_intake/check_reference_admission.py",
        [str(reference), "--json"],
        timeout=30,
    )
    payload: dict[str, Any] = {}
    raw = (out.get("stdout") or "").strip()
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                payload = parsed
        except Exception:
            payload = {}
    payload["ok"] = bool(out.get("ok")) or bool(payload.get("admitted"))
    payload["stdout"] = out.get("stdout")
    payload["stderr"] = out.get("stderr")
    return payload


def _probe_reference_image(reference: Path) -> str:
    probe = SKILL_DIR / "forge" / "stage1_intake" / "probe_image.py"
    if not probe.is_file() or not reference.is_file():
        return ""
    out = _forge_run("forge/stage1_intake/probe_image.py", [str(reference)], timeout=30)
    return ((out.get("stdout") or "") + "\n" + (out.get("stderr") or "")).strip()[:2000]


def _run_glb_snapshot(
    project_path: Path,
    factory_path: Path,
    base: str,
    *,
    prompt: str,
    source: str,
    trace_id: Optional[str],
) -> dict[str, Any] | None:
    """Capture the exported Z-up GLB that will be published."""
    del prompt, source
    script = SKILL_DIR.parent / "vibecad" / "scripts" / "capture_views.py"
    if not script.is_file() or not factory_path.is_file():
        return None
    try:
        proc = subprocess.run(
            [
                _forge_python(),
                str(script),
                "--glb",
                str(factory_path),
                "--out-dir",
                str(project_path),
                "--stem",
                base,
                "--json",
            ],
            cwd=str(SKILL_DIR / "scripts"),
            capture_output=True,
            text=True,
            timeout=90,
        )
    except Exception as exc:
        trace_add("warning", f"[Mesh] factory capture failed: {exc}", trace_id=trace_id)
        return None
    raw = (proc.stdout or "").strip()
    payload: dict[str, Any] = {}
    if "{" in raw:
        try:
            parsed = json.loads(raw[raw.find("{") : raw.rfind("}") + 1])
            if isinstance(parsed, dict):
                payload = parsed
        except Exception:
            payload = {}
    if proc.returncode != 0 or not payload.get("ok"):
        trace_add(
            "warning",
            f"[Mesh] factory capture failed: {(proc.stderr or proc.stdout or '')[:400]}",
            trace_id=trace_id,
        )
        return None
    return payload


def _snapshot_images_for_review(project_path: Path, snapshot_info: dict[str, Any] | None) -> list[dict[str, Any]]:
    return snapshot_payloads(project_path, dict(snapshot_info or {}))


def _author_mesh_spec(
    ai: AIService,
    *,
    prompt: str,
    images: Optional[list[dict[str, Any]]],
    probe_text: str,
    trace_id: Optional[str],
    starter: Optional[dict[str, Any]] = None,
    validate_errors: str = "",
) -> tuple[dict[str, Any], Optional[dict[str, Any]]]:
    user = f"User request:\n{prompt[:4000]}\n"
    if probe_text:
        user += f"\nprobe_image.py:\n{probe_text}\n"
    if starter:
        user += f"\nStarter ObjectSculptSpec to merge into:\n{json.dumps(starter, indent=2)[:12000]}\n"
    if validate_errors:
        user += f"\nvalidate_sculpt_spec.py --strict-quality failed. Fix every error:\n{validate_errors[:4000]}\n"
    if images:
        user += "\nA reference image is attached — the spec must describe THAT object.\n"
    text, trace = ai._call_model(
        MESH_SPEC_SYSTEM,
        user,
        trace_id=trace_id,
        images=images,
        max_tokens=8000,
        json_response=True,
        allow_truncated=True,
    )
    parsed: dict[str, Any] = {}
    raw = (text or "").strip()
    try:
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            parsed = loaded
    except Exception:
        try:
            start = raw.find("{")
            end = raw.rfind("}")
            if start >= 0 and end > start:
                loaded = json.loads(raw[start : end + 1])
                if isinstance(loaded, dict):
                    parsed = loaded
        except Exception:
            parsed = {}
    spec = normalize_mesh_sculpt_spec(parsed, starter=starter)
    return spec, trace if isinstance(trace, dict) else None


def _validate_strict(spec_path: Path) -> dict[str, Any]:
    out = _forge_run(
        "forge/stage2_spec/validate_sculpt_spec.py",
        [str(spec_path), "--strict-quality", "--json"],
        timeout=45,
    )
    payload: dict[str, Any] = {"ok": bool(out.get("ok")), "errors": [], "raw": out}
    raw = (out.get("stdout") or "").strip()
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                payload.update(parsed)
        except Exception:
            pass
    if not payload.get("ok"):
        errs = payload.get("errors") or []
        payload["error_text"] = "\n".join(str(x) for x in errs) or (out.get("stderr") or out.get("stdout") or "strict-quality failed")
    return payload


def _bootstrap_forge_spec(
    project_path: Path,
    *,
    name: str,
    reference: Path | None,
    ai: AIService,
    prompt: str,
    images: Optional[list[dict[str, Any]]],
    probe_text: str,
    trace_id: Optional[str],
    append_trace: Callable[[Any], None],
    llm: bool = True,
) -> tuple[dict[str, Any], Path]:
    work = project_path / ".img2threejs"
    work.mkdir(parents=True, exist_ok=True)
    spec_path = work / "object-sculpt-spec.json"
    assessment_path = work / "assessment.json"
    args = [name, "--complexity", "moderate", "--out", str(assessment_path), "--force"]
    if reference:
        args.extend(["--image", str(reference)])
    _forge_run("forge/stage2_spec/new_pre_spec_assessment.py", args, timeout=90)
    sculpt_args = [name, "--out", str(spec_path), "--force"]
    if reference:
        sculpt_args.extend(["--image", str(reference)])
    if assessment_path.is_file():
        sculpt_args.extend(["--assessment", str(assessment_path)])
    _forge_run("forge/stage2_spec/new_sculpt_spec.py", sculpt_args, timeout=60)
    starter: dict[str, Any] = {}
    if spec_path.is_file():
        try:
            loaded = json.loads(spec_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                starter = loaded
        except Exception:
            starter = {}
    if not llm:
        spec = starter
        if spec:
            spec_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
        return spec, spec_path
    errors = ""
    spec = starter
    for _attempt in range(3):
        spec, spec_trace = _author_mesh_spec(
            ai,
            prompt=prompt,
            images=images,
            probe_text=probe_text,
            trace_id=trace_id,
            starter=spec or starter,
            validate_errors=errors,
        )
        append_trace(spec_trace)
        spec_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
        verdict = _validate_strict(spec_path)
        if verdict.get("ok"):
            return spec, spec_path
        errors = str(verdict.get("error_text") or "strict-quality failed")
    raise RuntimeError(
        "img2threejs strict-quality blocked codegen (fail-closed). "
        f"Fix the ObjectSculptSpec:\n{errors[:4000]}"
    )


def _generate_pass_skeleton(spec_path: Path, pass_id: str, out_ts: Path) -> dict[str, Any]:
    args = [str(spec_path), "--out", str(out_ts), "--pass-id", pass_id, "--force"]
    out = _forge_run("forge/stage3_build/generate_threejs_factory.py", args, timeout=60)
    blocked = ""
    blob = (out.get("stderr") or "") + "\n" + (out.get("stdout") or "")
    if "BLOCKED" in blob or not out.get("ok"):
        blocked = blob[:4000]
    skeleton = out_ts.read_text(encoding="utf-8") if out_ts.is_file() else ""
    return {"ok": bool(out.get("ok") and skeleton), "skeleton": skeleton, "blocked": blocked, "raw": out}


def _append_pass_review(
    spec_path: Path,
    *,
    pass_id: str,
    passed: bool,
    summary: str,
    reference: Path | None,
    render_png: Path | None,
    score: float,
) -> None:
    comparison = spec_path.parent / f"{pass_id}-comparison.png"
    if reference and reference.is_file() and render_png and render_png.is_file():
        _forge_run(
            "forge/stage4_review/make_comparison_sheet.py",
            ["--reference", str(reference), "--render", str(render_png), "--out", str(comparison)],
            timeout=30,
        )
    action = "continue" if passed else "refine-code"
    args = [
        str(spec_path),
        "--pass-id",
        pass_id,
        "--fidelity",
        f"{score:.3f}",
        "--action",
        action,
        "--summary",
        summary[:500] or pass_id,
        "--in-place",
        "--ai-vision-score",
        f"{score:.3f}",
    ]
    if comparison.is_file():
        args.extend(["--comparison-image", str(comparison)])
    if render_png and render_png.is_file():
        args.extend(["--render-screenshot", str(render_png)])
        if pass_id == "blockout":
            args.extend(["--map-stripped-render", str(render_png)])
    if reference and reference.is_file():
        args.extend(["--reference-screenshot", str(reference)])
    if passed and pass_id in {
        "blockout",
        "structural-pass",
        "form-refinement",
        "material-pass",
        "surface-pass",
        "lighting-pass",
        "interaction-pass",
    }:
        args.extend(["--review-viewpoints-json", json.dumps(["iso", "top", "front", "thickness-axis", "long-axis"])])
    _forge_run("forge/stage4_review/append_review.py", args, timeout=30)


def _review_factory(
    ai: AIService,
    *,
    prompt: str,
    source: str,
    export_meta: dict[str, Any],
    trace_id: Optional[str],
    images: Optional[list[dict[str, Any]]] = None,
    snapshot_images: Optional[list[dict[str, Any]]] = None,
    pass_id: str = "form-refinement",
    spec: Optional[dict[str, Any]] = None,
) -> tuple[bool, str, Optional[dict[str, Any]]]:
    """Return (passed, repair_brief, ai_trace). Fail-closed — never accept on crash."""
    snaps = list(snapshot_images or [])
    if not snaps:
        return False, (
            "Mandatory img2threejs visual gate: no Playwright factory-view PNGs. "
            "Rerun scripts/capture_views.py before accepting this pass."
        ), None
    size = export_meta.get("size") if isinstance(export_meta, dict) else None
    review_images = snaps[:3] + list(images or [])[:3]
    spec_blob = json.dumps(spec or {}, separators=(",", ":"))[:2500]
    user = (
        f"Build pass: {pass_id}\n"
        f"User brief:\n{prompt[:4000]}\n\n"
        f"Sculpt spec:\n{spec_blob}\n\n"
        "Reference photo (if attached) AND iso/top/front GLB snapshots follow. "
        "Judge silhouette, proportions, named parts, and colours against the photo.\n"
        f"Export meta: bytes={export_meta.get('bytes') if isinstance(export_meta, dict) else None}, "
        f"size={size}\n\n"
        f"Factory source:\n```js\n{source[:10000]}\n```"
    )
    try:
        text, trace = ai._call_model(
            MESH_REVIEW_SYSTEM,
            user,
            trace_id=trace_id,
            images=review_images[:6],
            max_tokens=1600,
            json_response=True,
            allow_truncated=False,
        )
    except Exception as exc:
        return False, f"Reviewer failed (fail-closed): {exc}", None

    data = _parse_review(text or "")
    passed = data.get("pass") is True
    repair = str(data.get("repair_brief") or "").strip()
    if not passed and not repair:
        issues = data.get("issues") or []
        repair = "; ".join(str(x) for x in issues[:6]) or "Improve fidelity to the brief and snapshots."
    return passed, repair, trace if isinstance(trace, dict) else None


def _write_mesh_host_docs(project_path: Path, factory_name: str) -> None:
    (project_path / "MESH.md").write_text(
        "# Mesh (img2threejs) workspace\n\n"
        "You are Codex, the Mesh host for Render Studio.\n"
        f"Write `{factory_name}` as `export default function createModel(THREE) {{ ... }}`.\n"
        "Units millimetres-ish, Three.js Y-up. No TextureLoader, no McMaster, no network.\n"
        "Do not call OpenAI HTTP or start a homemade JSON tool loop.\n"
        "The host exports GLB with export_glb.mjs after you stop. Stop when the factory is complete.\n",
        encoding="utf-8",
    )
    agents = project_path / "AGENTS.md"
    if not agents.is_file():
        agents.write_text(
            "This is a Render Studio Mesh project. Follow MESH.md and img2threejs SKILL.md.\n",
            encoding="utf-8",
        )


def _factory_from_workspace(project_path: Path, factory_path: Path, last_message: str = "") -> str:
    candidates = [factory_path]
    for path in sorted(project_path.glob("*.js")) + sorted(project_path.glob("*.mjs")):
        if path.resolve() != factory_path.resolve():
            candidates.append(path)
    for path in candidates:
        if not path.is_file():
            continue
        src = _strip_fences(path.read_text(encoding="utf-8", errors="ignore"))
        if _looks_like_factory(src) and "THREE" in src:
            m = re.search(r"export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)", src)
            if m and m.start() > 0:
                src = src[m.start() :].strip()
            return src
    src = _strip_fences(last_message or "")
    if _looks_like_factory(src) and "THREE" in src:
        m = re.search(r"export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)", src)
        if m and m.start() > 0:
            src = src[m.start() :].strip()
        return src
    raise RuntimeError("Codex did not write a createModel(THREE) factory.")


def run_mesh_img2threejs(prompt, project_path, context, ai, **kwargs):
    from backend.services.mesh_artifact_transaction import run_isolated

    return run_isolated(_run_mesh_candidate, prompt, project_path, context, ai, **kwargs)


def _run_mesh_candidate(
    prompt: str,
    project_path: Path,
    context: dict[str, Any],
    ai: AIService,
    *,
    trace_id: Optional[str] = None,
    images: Optional[list[dict[str, Any]]] = None,
    previous_source: Optional[str] = None,
    previous_source_name: Optional[str] = None,
    cancel_check: CancelCb = None,
    progress_callback: ProgressCb = None,
    usage_callback: UsageCb = None,
    max_repairs: int = 12,
) -> dict[str, Any]:
    """Generate a procedural Three.js factory and export a viewport GLB (Jake-style loop)."""
    from backend.services.project_store import file_stem_from_prompt
    from backend.services.engine_layout import artifacts_for, model_stem as _layout_stem

    project_path = Path(project_path)
    ctx = context or {}
    assert_img2threejs_runtime(mesh_beta=bool(ctx.get("mesh_beta")))
    from backend.services.cad_host_runtime import choose_mesh_runtime

    runtime = choose_mesh_runtime(ctx, ai)
    target_mode = str(ctx.get("target_mode") or "").strip().lower()
    base_filename = str(ctx.get("base_filename") or "").strip() or None
    is_edit = target_mode == "edit" or bool(previous_source_name and base_filename)

    # Prefer the selected object stem on Edit so we overwrite that GLB instead of
    # inventing a new prompt-derived name.
    base = ""
    if previous_source_name:
        base = _layout_stem(previous_source_name)
    if not base and is_edit and base_filename:
        base = _layout_stem(base_filename)
    if not base:
        base = file_stem_from_prompt(prompt, max_len=48) or "mesh_model"
    if not is_edit and base.lower() in {"create", "make", "build", "design", "new model", "mesh"}:
        better = file_stem_from_prompt(prompt, max_len=48)
        if better and better.lower() not in {"new model", "mesh"}:
            base = better
        else:
            base = "mesh_model"
    base = _safe_stem(base, max_len=48)

    arts = artifacts_for(
        project_path,
        "mesh",
        base,
        previous_source_name=previous_source_name,
        base_filename=base_filename,
    )
    arts.directory.mkdir(parents=True, exist_ok=True)
    factory_name = arts.source_name
    glb_name = arts.glb_name
    factory_path = arts.source_path
    glb_path = arts.glb_path
    ai_traces: list[dict[str, Any]] = []
    acceptance: dict[str, Any] = {}

    def _sync_usage() -> None:
        if usage_callback and ai_traces:
            usage_callback(list(ai_traces))

    def _on_codex_trace(trace: dict[str, Any]) -> None:
        if not isinstance(trace, dict):
            return
        last = ai_traces[-1] if ai_traces else None
        if (
            isinstance(last, dict)
            and last.get("stage") == "codex_llm"
            and last.get("elapsed_ms") is None
        ):
            ai_traces[-1] = trace
        else:
            ai_traces.append(trace)
        _sync_usage()

    if hasattr(ai, "set_usage_callback"):
        try:
            ai.set_usage_callback(_on_codex_trace)
        except Exception:
            pass

    def _canceled() -> bool:
        return bool(cancel_check and cancel_check())

    def _success(
        source: str,
        attempts: int,
        note: Optional[str] = None,
        warnings: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        if _canceled():
            raise RuntimeError("Generation canceled.")
        verify_manifest(factory_path, glb_path, acceptance, project_path.name)
        (project_path / "mesh-acceptance.json").write_text(json.dumps(acceptance, indent=2))
        action = "Updated" if is_edit else "Built"
        msg = f"{action} {base} as a procedural Three.js mesh (img2threejs)."
        if note:
            msg = f"{msg} {note}"
        _progress(progress_callback, "done", 100, "Mesh ready")
        try:
            from backend.services.cad_harness import finalize_harness_run

            finalize_harness_run(project_path)
        except Exception:
            pass
        from backend.services.ai_cost import usage_fields_for_history

        payload = {
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
            "dfm_warnings": [w for w in (warnings or []) if str(w).strip()],
            "primary": glb_name,
            "filename": glb_name,
        }
        payload.update(usage_fields_for_history(ai_traces) or {})
        return payload

    _progress(progress_callback, "analyze", 8, "Mesh · analyzing reference (img2threejs intake)…")

    raw_images = list(images or [])
    clean_images = AIService._clean_images(raw_images)
    if raw_images and not clean_images:
        raise RuntimeError(
            "A reference image was attached but could not be read for Mesh "
            "(missing/invalid data URL). Re-attach the image and try again."
        )
    images = clean_images
    has_image = bool(images)
    reference_path = _write_mesh_reference(project_path, images or [])
    if reference_path:
        _init_img2threejs_state(project_path, reference_path, mesh_beta=bool(ctx.get("mesh_beta")))
    probe_text = _probe_reference_image(reference_path) if reference_path else ""

    try:
        _find_node()
    except RuntimeError as exc:
        raise RuntimeError(str(exc)) from exc

    _progress(progress_callback, "spec", 14, "Mesh · forge spec / strict-quality…")
    spec: dict[str, Any] = {}
    spec_path = project_path / ".img2threejs" / "object-sculpt-spec.json"
    state_path = project_path / ".img2threejs" / "state.json"
    if reference_path:
        admitted = _admit_reference(reference_path)
        if not (admitted.get("admitted") or admitted.get("ok")):
            reasons = admitted.get("reasons") or admitted.get("stderr") or admitted.get("stdout") or "rejected"
            raise RuntimeError(f"img2threejs admission rejected the reference image: {reasons}")
    try:
        spec, spec_path = _bootstrap_forge_spec(
            project_path,
            name=base.replace("_", " ") or "Object",
            reference=reference_path,
            ai=ai,
            prompt=prompt,
            images=images,
            probe_text=probe_text,
            trace_id=trace_id,
            append_trace=lambda t: ai_traces.append(t) if isinstance(t, dict) else None,
            llm=True,
        )
        _sync_usage()
        if state_path.is_file():
            nxt = _forge_next(state_path, spec_path)
            if nxt.get("exit_code") == 3:
                raise RuntimeError(
                    "img2threejs forge/next.py hard-stop:\n"
                    + ((nxt.get("stdout") or "") + (nxt.get("stderr") or ""))[:2000]
                )
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"img2threejs spec pipeline failed: {exc}") from exc

    edit_line = (
        f"EDIT selected object `{base_filename or glb_name}` — revise the existing procedural mesh in place; "
        "keep the same overall identity unless the user asks to change it.\n"
        if is_edit
        else "NEW object — create a fresh procedural mesh (do not reuse unrelated project parts).\n"
    )
    spec_line = f"\nSculpt spec:\n{json.dumps(spec, indent=2)[:4000]}\n" if spec else ""
    user_brief = (
        f"{edit_line}"
        f"User request:\n{prompt.strip()}\n\n"
        f"{'A reference image is attached — match proportions, silhouette, and colours from the PHOTO first (not a generic guess).' if has_image else 'No image attached — invent a clean hard-surface prop from the description.'}\n"
        f"{spec_line}"
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
    cross = ctx.get("cross_engine_base") if isinstance(ctx, dict) else None
    if isinstance(cross, dict) and cross.get("source_engine"):
        user_brief += (
            f"\n\nCROSS-HARNESS EDIT: the selected object was made with {cross.get('source_label')}. "
            "Do not run CAD/STEP generators. Rebuild it as a procedural Three.js factory. "
            f"Viewport file: {cross.get('glb') or cross.get('filename') or base_filename}."
        )

    source = previous_source or ""
    last_error = None
    attempts = 0
    last_passed_source = ""
    review_notes: list[str] = []
    per_pass = 3
    repair_budget = max(0, int(max_repairs))
    budget = len(MESH_PASSES) + repair_budget
    system_prompt = MESH_SYSTEM_BETA if ctx.get("mesh_beta") else MESH_SYSTEM

    def _append_trace(trace: Any) -> None:
        if not isinstance(trace, dict):
            return
        last = ai_traces[-1] if ai_traces else None
        if (
            isinstance(last, dict)
            and last.get("stage") == "codex_llm"
            and last.get("elapsed_ms") is None
        ):
            ai_traces[-1] = trace
        else:
            ai_traces.append(trace)
        _sync_usage()

    def _accept(export, pass_id):
        nonlocal acceptance
        try:
            acceptance = candidate_manifest(factory_path, glb_path, run_id=project_path.name,
                                            runtime={"provider_runtime": runtime, "wand": img2threejs_wand_version(),
                                                     **(export.get("meta", {}).get("runtime") or {})})
            if export.get("source_sha256") and export["source_sha256"] != acceptance["source_sha256"]:
                raise ValueError("Factory changed during export")
        except Exception as exc:
            return False, f"Final GLB inspection failed: {exc}", None
        snapshot_info = _run_glb_snapshot(project_path, glb_path, base, prompt=prompt,
                                          source=source, trace_id=trace_id)
        try:
            snap_images = _snapshot_images_for_review(project_path, snapshot_info)
        except Exception as exc:
            return False, f"Final GLB capture failed: {exc}", None
        passed, repair, review_trace = _review_factory(
            ai, prompt=prompt, source=source, export_meta={"bytes": export.get("bytes"), **(export.get("meta") or {})},
            trace_id=trace_id, images=images, snapshot_images=snap_images, pass_id=pass_id, spec=spec)
        _append_trace(review_trace)
        acceptance["review_passed"] = passed
        acceptance["review"] = {"pass_id": pass_id, "passed": passed, "repair_brief": repair,
                                "views": [{"name": item["name"], "sha256": item["sha256"]} for item in snap_images]}
        if passed:
            verify_manifest(factory_path, glb_path, acceptance, project_path.name)
        return passed, repair, snapshot_info

    if runtime == "codex_host":
        from backend.services.chatgpt_codex_llm import exec_in_workspace, trace_for_codex_usage

        _write_mesh_host_docs(project_path, factory_name)
        if previous_source and previous_source.strip():
            factory_path.write_text(previous_source.rstrip() + "\n", encoding="utf-8")
        last_error = ""
        source = previous_source or ""
        host_attempts = 1 + repair_budget
        for attempt in range(host_attempts):
            if _canceled():
                raise RuntimeError("Generation canceled.")
            _progress(
                progress_callback,
                "generate",
                22 if attempt == 0 else 40,
                f"Mesh · Codex host session {attempt + 1}/{host_attempts}…",
            )
            host_prompt = (
                f"{MESH_SYSTEM_BETA if ctx.get('mesh_beta') else MESH_SYSTEM}\n\n"
                f"{user_brief}\n\n"
                "Codex is the host. Write the factory file in this workspace. "
                "Do not emit JSON tool calls. Stop when createModel(THREE) is complete.\n"
            )
            if last_error:
                host_prompt += f"\nPrevious attempt failed. Fix it:\n{last_error[:4000]}\n"
            try:
                last_message, trace = exec_in_workspace(
                    project_path=project_path,
                    prompt=host_prompt,
                    images=images if attempt == 0 else None,
                    trace_id=trace_id,
                    ai=ai,
                    user_id=str(ctx.get("user_id") or getattr(ai, "billing_user_id", "") or "") or None,
                    usage_callback=lambda usage: _append_trace(
                        trace_for_codex_usage(getattr(ai, "model", None), usage, trace_id=trace_id)
                    ),
                    cancel_check=cancel_check,
                    progress_callback=progress_callback,
                    pipeline="img2threejs",
                )
                if isinstance(trace, dict):
                    _append_trace(trace)
                source = _factory_from_workspace(project_path, factory_path, last_message)
                factory_path.write_text(source.rstrip() + "\n", encoding="utf-8")
                _progress(progress_callback, "export", 70, "Mesh · exporting GLB…")
                export = _run_export(
                    factory_path, glb_path, cancel_check=_canceled, progress_callback=progress_callback
                )
            except Exception as exc:
                last_error = str(exc)
                if "canceled" in last_error.lower() or "node.js is required" in last_error.lower():
                    raise
                continue
            if not export.get("ok"):
                last_error = export.get("stderr") or export.get("stdout") or "GLB export failed"
                continue
            _progress(progress_callback, "snapshot", 88, "Mesh · Playwright factory views…")
            passed, last_error, _ = _accept(export, "final")
            if not passed:
                continue
            return _success(source, attempt + 1)
        raise RuntimeError(last_error or "Mesh Codex host generation failed")

    for pass_index, (pass_id, pass_brief) in enumerate(MESH_PASSES):
        pass_ok = False
        last_error = None
        for retry in range(per_pass):
            if _canceled():
                raise RuntimeError("Generation canceled.")
            attempts += 1
            if retry:
                if repair_budget <= 0:
                    break
                repair_budget -= 1
            if attempts > budget:
                break
            _progress(
                progress_callback,
                "generate",
                min(70, 18 + pass_index * 8 + retry * 3),
                f"Mesh · {pass_id} ({retry + 1}/{per_pass})…",
            )
            if state_path.is_file():
                nxt = _forge_next(state_path, spec_path)
                if nxt.get("exit_code") == 3:
                    raise RuntimeError(
                        "img2threejs forge/next.py hard-stop:\n"
                        + ((nxt.get("stdout") or "") + (nxt.get("stderr") or ""))[:2000]
                    )
            skeleton_path = spec_path.parent / f"createObjectModel.{pass_id}.ts"
            gen = _generate_pass_skeleton(spec_path, pass_id, skeleton_path)
            repair_block = f"\n\n{pass_brief}\n"
            if gen.get("blocked") and not gen.get("ok"):
                repair_block += (
                    "\nforge/stage3_build/generate_threejs_factory.py BLOCKED this pass. "
                    "Keep implementing from the spec; if the block is spec-quality, the host will fail closed.\n"
                    f"{gen.get('blocked')[:2000]}\n"
                )
            if gen.get("skeleton"):
                repair_block += (
                    "\nForge TypeScript skeleton from generate_threejs_factory.py. "
                    "Implement THIS pass as `export default function createModel(THREE)` — "
                    "no imports, THREE is injected by export_glb.mjs.\n"
                    f"```ts\n{gen['skeleton'][:8000]}\n```\n"
                )
            if last_error:
                repair_block += (
                    "\nPrevious attempt failed this pass. Fix the factory and return the FULL module only.\n"
                    f"Feedback:\n{last_error[:3500]}\n"
                )
            if source:
                repair_block += f"\nCurrent factory to refine:\n```js\n{source[:12000]}\n```\n"
            try:
                text, trace = ai._call_model(
                    system_prompt,
                    user_brief + repair_block,
                    trace_id=trace_id,
                    images=images,
                    max_tokens=12000,
                    json_response=False,
                    allow_truncated=False,
                )
                _append_trace(trace)
            except Exception as exc:
                last_error = str(exc)
                trace_add("error", f"[Mesh] AI factory write failed: {exc}", trace_id=trace_id)
                continue

            source = _strip_fences(text)
            if not _looks_like_factory(source) or "THREE" not in source:
                last_error = "Model did not return a valid createModel(THREE) ES module."
                continue
            m = re.search(r"export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)", source)
            if m and m.start() > 0:
                source = source[m.start() :].strip()

            factory_path.write_text(source, encoding="utf-8")
            _progress(progress_callback, "export", min(86, 50 + pass_index * 10), f"Mesh · exporting GLB ({pass_id})…")
            try:
                export = _run_export(
                    factory_path, glb_path, cancel_check=_canceled, progress_callback=progress_callback
                )
            except RuntimeError as exc:
                msg = str(exc)
                if "canceled" in msg.lower():
                    raise
                if "node.js is required" in msg.lower():
                    raise
                last_error = msg
                continue
            except subprocess.TimeoutExpired:
                last_error = "GLB export timed out."
                continue
            except Exception as exc:
                last_error = f"Export failed: {exc}"
                continue
            if not export.get("ok"):
                last_error = export.get("stderr") or export.get("stdout") or "GLB export failed"
                continue

            _progress(progress_callback, "snapshot", 88, "Mesh · Playwright factory views…")
            _progress(progress_callback, "review", 92, f"Mesh · vision review ({pass_id})…")
            passed, repair_brief, snapshot_info = _accept(export, pass_id)
            render_png = None
            if snapshot_info:
                files = snapshot_info.get("files") or {}
                name = files.get("iso") if isinstance(files, dict) else None
                if not name and isinstance(files, dict) and files:
                    name = next(iter(files.values()))
                if name:
                    cand = project_path / str(name)
                    if cand.is_file():
                        render_png = cand
            try:
                _append_pass_review(
                    spec_path,
                    pass_id=pass_id,
                    passed=passed,
                    summary=repair_brief or f"{pass_id} {'accepted' if passed else 'rejected'}",
                    reference=reference_path,
                    render_png=render_png,
                    score=0.86 if passed else 0.2,
                )
            except Exception as exc:
                trace_add("warning", f"[Mesh] append_review: {exc}", trace_id=trace_id)
            if passed:
                last_passed_source = source
                pass_ok = True
                if state_path.is_file():
                    _forge_mark(state_path, pass_id, evidence=str(render_png or factory_path))
                trace_add("info", f"[Mesh] pass {pass_id} accepted", trace_id=trace_id)
                break
            last_error = repair_brief or f"{pass_id} review requested repairs."
            trace_add("warning", f"[Mesh] {pass_id} repair: {last_error[:400]}", trace_id=trace_id)

        if not pass_ok:
            raise RuntimeError(
                last_error
                or f"img2threejs {pass_id} failed visual review (fail-closed). "
                "The repo does not ship a pass that failed identity checks."
            )

    if last_passed_source and glb_path.is_file() and glb_path.stat().st_size > 100:
        factory_path.write_text(last_passed_source, encoding="utf-8")
        return _success(
            last_passed_source,
            attempts,
            note=review_notes[0] if review_notes else None,
            warnings=review_notes,
        )

    raise RuntimeError(last_error or "Mesh generation failed")
