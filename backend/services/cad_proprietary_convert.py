"""Best-effort conversion of proprietary CAD uploads → STEP / mesh for viewport preview.

SolidWorks (.sldprt/.sldasm) and Fusion (.f3d) are closed formats. This module tries:
1. Archive extract (Fusion .f3z/.zip, and .f3d when it is zip-packaged)
2. External converter CLI when ``CAD_CONVERTER_CMD`` is set
3. FreeCADCmd ``Import.insert`` when FreeCAD can read the file

Returns a sibling STEP/mesh path on success; callers keep the original upload.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SOLIDWORKS_SUFFIXES = {".sldprt", ".sldasm"}
FUSION_NATIVE_SUFFIXES = {".f3d"}
PROPRIETARY_CONVERT_SUFFIXES = SOLIDWORKS_SUFFIXES | FUSION_NATIVE_SUFFIXES | {
    ".x_t",
    ".x_b",
    ".sat",
    ".sab",
}
VIEWABLE_OUT_SUFFIXES = {".step", ".stp", ".stl", ".glb", ".gltf", ".obj", ".3mf", ".iges", ".igs", ".brep", ".brp"}


def _unique_sibling(dest_dir: Path, stem: str, suffix: str) -> Path:
    out = dest_dir / f"{stem}{suffix}"
    n = 2
    while out.exists():
        out = dest_dir / f"{stem}_{n}{suffix}"
        n += 1
    return out


def _try_zip_extract(path: Path, dest_dir: Path) -> Path | None:
    """Pull the first STEP/mesh (or nested zip member) out of an archive-like file."""
    from backend.services.cad_reference_geometry import BREP_SUFFIXES, MESH_SUFFIXES, extract_cad_from_archive

    # Reuse the f3z/zip extractor when the suffix is already known.
    extracted = extract_cad_from_archive(path, dest_dir)
    if extracted is not None:
        return extracted

    # .f3d is usually proprietary, but some Fusion packages are zip containers.
    try:
        if not zipfile.is_zipfile(path):
            return None
        with zipfile.ZipFile(path, "r") as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
            ranked: list[tuple[int, str]] = []
            for name in names:
                ext = Path(name).suffix.lower()
                if ext in BREP_SUFFIXES:
                    ranked.append((0, name))
                elif ext in MESH_SUFFIXES:
                    ranked.append((1, name))
                elif ext in {".smt", ".sab", ".sat", ".x_t", ".x_b"}:
                    ranked.append((2, name))
                elif ext in {".zip", ".f3z"}:
                    ranked.append((3, name))
            if not ranked:
                return None
            ranked.sort(key=lambda row: (row[0], len(row[1])))
            member = ranked[0][1]
            ext = Path(member).suffix.lower()
            out = _unique_sibling(dest_dir, f"{path.stem}__extracted", ext or ".bin")
            with zf.open(member) as src, out.open("wb") as dst:
                dst.write(src.read())
            if ext in {".zip", ".f3z"}:
                nested = extract_cad_from_archive(out, dest_dir)
                if nested is not None:
                    try:
                        out.unlink(missing_ok=True)
                    except Exception:
                        pass
                    return nested
            if out.suffix.lower() in VIEWABLE_OUT_SUFFIXES | {".smt"}:
                return out
            return None
    except Exception as exc:
        logger.debug("zip extract failed for %s: %s", path.name, exc)
        return None


def _run_external_converter(src: Path, dest_dir: Path) -> Path | None:
    """Optional CLI: CAD_CONVERTER_CMD with {input} {output} placeholders (STEP preferred)."""
    template = (os.environ.get("CAD_CONVERTER_CMD") or "").strip()
    if not template:
        return None
    out = _unique_sibling(dest_dir, f"{src.stem}__converted", ".step")
    cmd = template.replace("{input}", str(src)).replace("{output}", str(out))
    # Also support $INPUT / $OUTPUT style.
    cmd = cmd.replace("$INPUT", str(src)).replace("$OUTPUT", str(out))
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            check=False,
            capture_output=True,
            text=True,
            timeout=float(os.environ.get("CAD_CONVERTER_TIMEOUT_SEC") or 240),
        )
        if proc.returncode == 0 and out.is_file() and out.stat().st_size > 0:
            return out
        # Some CLIs write a different extension next to output stem.
        for alt in out.parent.glob(f"{out.stem}.*"):
            if alt.suffix.lower() in VIEWABLE_OUT_SUFFIXES and alt.stat().st_size > 0:
                return alt
        logger.info(
            "CAD_CONVERTER_CMD failed for %s (code=%s): %s",
            src.name,
            proc.returncode,
            (proc.stderr or proc.stdout or "")[:400],
        )
    except Exception as exc:
        logger.info("CAD_CONVERTER_CMD error for %s: %s", src.name, exc)
    return None


_FREECAD_IMPORT_TEMPLATE = r'''# Render Studio proprietary → STEP via FreeCAD Import
import json
import sys
import traceback
from pathlib import Path

REQ = Path(sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
RES = Path(sys.argv[3] if len(sys.argv) > 3 else "result.json")
request = json.loads(REQ.read_text(encoding="utf-8"))
out = {"ok": False, "error": "not started"}

try:
    import FreeCAD as App
    import Part

    src = Path(request["src"])
    step_path = Path(request["step_path"])
    step_path.parent.mkdir(parents=True, exist_ok=True)
    doc = App.newDocument("RenderStudioImport")
    imported = False
    last_err = ""

    # Prefer Import workbench when available (broader format coverage).
    try:
        import Import
        Import.insert(str(src), doc.Name)
        imported = True
    except Exception as exc:
        last_err = str(exc)
        try:
            Part.insert(str(src), doc.Name)
            imported = True
        except Exception as exc2:
            last_err = f"{last_err}; {exc2}"

    doc.recompute()
    shapes = []
    for obj in list(doc.Objects):
        shape = getattr(obj, "Shape", None)
        if shape is None:
            continue
        try:
            if shape.isNull():
                continue
        except Exception:
            continue
        shapes.append(obj)

    if not imported or not shapes:
        raise RuntimeError(
            f"FreeCAD could not import {src.name}"
            + (f" ({last_err})" if last_err else "")
        )

    Part.export(shapes, str(step_path))
    if not step_path.is_file() or step_path.stat().st_size <= 0:
        raise RuntimeError("FreeCAD export produced an empty STEP file")
    out = {"ok": True, "step_path": str(step_path), "object_count": len(shapes)}
except Exception as exc:
    out = {"ok": False, "error": str(exc), "traceback": traceback.format_exc()}

RES.write_text(json.dumps(out), encoding="utf-8")
'''


def _run_freecad_import(src: Path, dest_dir: Path) -> Path | None:
    from backend.services.freecad_engine import find_freecad_cmd

    cmd = find_freecad_cmd()
    if not cmd:
        return None
    work = Path(tempfile.mkdtemp(prefix="rs_cad_import_"))
    try:
        step_path = work / f"{src.stem}.step"
        req_path = work / "request.json"
        res_path = work / "result.json"
        runner_path = work / "runner.py"
        runner_path.write_text(_FREECAD_IMPORT_TEMPLATE, encoding="utf-8")
        req_path.write_text(
            __import__("json").dumps({"src": str(src), "step_path": str(step_path)}),
            encoding="utf-8",
        )
        proc = subprocess.run(
            [str(cmd), str(runner_path), str(req_path), str(res_path)],
            cwd=str(work),
            capture_output=True,
            text=True,
            timeout=float(os.environ.get("CAD_FREECAD_IMPORT_TIMEOUT_SEC") or 180),
            env={**os.environ, "QT_QPA_PLATFORM": "offscreen"},
        )
        payload: dict[str, Any] = {}
        if res_path.is_file():
            try:
                payload = __import__("json").loads(res_path.read_text(encoding="utf-8"))
            except Exception:
                payload = {}
        if not payload.get("ok"):
            logger.info(
                "FreeCAD import failed for %s: %s",
                src.name,
                payload.get("error") or (proc.stderr or proc.stdout or "")[:300],
            )
            return None
        produced = Path(str(payload.get("step_path") or step_path))
        if not produced.is_file() or produced.stat().st_size <= 0:
            return None
        out = _unique_sibling(dest_dir, f"{src.stem}__converted", ".step")
        shutil.copy2(produced, out)
        return out
    except Exception as exc:
        logger.info("FreeCAD import error for %s: %s", src.name, exc)
        return None
    finally:
        shutil.rmtree(work, ignore_errors=True)


def try_convert_proprietary_cad(src: Path, dest_dir: Path | None = None) -> dict[str, Any] | None:
    """Attempt to produce a viewport-friendly STEP/mesh sibling for a proprietary CAD file.

    Returns ``{"path": Path, "method": str, "note": str}`` or ``None``.
    """
    src = Path(src)
    if not src.is_file():
        return None
    suffix = src.suffix.lower()
    dest_dir = Path(dest_dir or src.parent)
    dest_dir.mkdir(parents=True, exist_ok=True)

    # 1) Archive / packaged extract (Fusion f3z, zip-wrapped f3d, etc.)
    if suffix in {".f3d", ".f3z", ".zip"} | SOLIDWORKS_SUFFIXES:
        extracted = _try_zip_extract(src, dest_dir)
        if extracted is not None and extracted.suffix.lower() in VIEWABLE_OUT_SUFFIXES:
            return {
                "path": extracted,
                "method": "archive_extract",
                "note": f"Extracted {extracted.name} from {src.name} for viewport preview.",
            }
        # Nested proprietary (e.g. extracted .smt/.x_t) — try FreeCAD next on that file.
        if extracted is not None and extracted.suffix.lower() in PROPRIETARY_CONVERT_SUFFIXES | {".smt"}:
            nested = _run_freecad_import(extracted, dest_dir) or _run_external_converter(extracted, dest_dir)
            if nested is not None:
                return {
                    "path": nested,
                    "method": "archive_then_convert",
                    "note": f"Converted embedded {extracted.name} from {src.name} → {nested.name}.",
                }

    # 2) External commercial / custom converter
    external = _run_external_converter(src, dest_dir)
    if external is not None:
        return {
            "path": external,
            "method": "external_cli",
            "note": f"Converted {src.name} → {external.name} via CAD_CONVERTER_CMD.",
        }

    # 3) FreeCAD Import (works for some neutrals / plugin-enabled formats; best-effort for SW/Fusion)
    freecad = _run_freecad_import(src, dest_dir)
    if freecad is not None:
        return {
            "path": freecad,
            "method": "freecad_import",
            "note": f"Converted {src.name} → {freecad.name} with FreeCAD.",
        }

    return None


def proprietary_convert_hint(suffix: str) -> str:
    s = str(suffix or "").lower()
    if s in SOLIDWORKS_SUFFIXES:
        return (
            f"{s} was saved as a reference. SolidWorks natives cannot be tessellated here without "
            "a converter — export STEP (.step/.stp) or STL from SolidWorks for viewport preview. "
            "Optional: set CAD_CONVERTER_CMD='your-cli {input} {output}' on the server."
        )
    if s in FUSION_NATIVE_SUFFIXES:
        return (
            f"{s} was saved as a reference. Prefer Fusion archive (.f3z) with embedded STEP, "
            "or export STEP/STL from Fusion. Optional: set CAD_CONVERTER_CMD for local conversion."
        )
    return (
        f"{s} was saved as a reference. Export STEP (.step/.stp) or a mesh (.stl/.glb) "
        "for viewport preview, or configure CAD_CONVERTER_CMD."
    )
