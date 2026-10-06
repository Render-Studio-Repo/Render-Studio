"""Filesystem-only component manifest shared by project open and the full browser.

Keep component selection identical without parsing body meshes, CAD geometry,
sketches or render history before the first viewport paint.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_XR_CLIENTS = frozenset({"xr", "vr", "headset", "quest"})


def _is_xr_client(value: Any) -> bool:
    return str(value or "").strip().lower() in _XR_CLIENTS


def vr_created_filenames(project_path: Path) -> set[str]:
    """Filenames created in VR / as Create primitives (timeline + generation.json)."""
    names: set[str] = set()
    try:
        from backend.services.history_service import load_timeline

        data = load_timeline(project_path) or {}
        for entry in data.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            meta = entry.get("meta") if isinstance(entry.get("meta"), dict) else {}
            kind = str(entry.get("kind") or "").lower()
            client = meta.get("client") or meta.get("source") or ""
            if kind == "primitive" or meta.get("xr") or _is_xr_client(client):
                filename = str(entry.get("filename") or "").strip()
                if filename:
                    names.add(filename)
                    names.add(Path(filename).name)
    except Exception:
        pass
    try:
        gen_path = project_path / "generation.json"
        if gen_path.is_file():
            data = json.loads(gen_path.read_text(encoding="utf-8"))
            jobs = list(data.get("jobs") or [])
            jobs.append(data)
            for job in jobs:
                if not isinstance(job, dict):
                    continue
                rb = job.get("request_body") if isinstance(job.get("request_body"), dict) else {}
                client = job.get("client") or rb.get("client") or ""
                if not _is_xr_client(client):
                    continue
                filename = str(job.get("filename") or "").strip()
                if filename:
                    names.add(filename)
                    names.add(Path(filename).name)
    except Exception:
        pass
    return names


def project_viewport_browser(project_path: Path) -> dict[str, Any]:
    from backend.services.cad_service import (
        SUPPORTED_IMPORT, SUPPORTED_EXPORT, load_deleted_catalogs,
        catalog_is_deleted, _jake_hidden_assembly_previews,
        _viewport_component_stems, _load_sim_assembly_parts,
        _canonical_assembly_stem, looks_like_mcmaster_part_stem,
        viewer_filename_for_model, jake_viewport_glb_for_stem,
        _exploded_sidecar_for_stem, _component_display_label,
        looks_like_create_primitive_stem, newest_published_model,
        _mcmaster_parts_folder, collapse_orphan_exploded_part_components,
        collapse_duplicate_folder_stems, revive_tombstoned_assemblies_if_viewport_empty,
    )
    components: list[dict[str, Any]] = []
    vr_files = vr_created_filenames(project_path)
    preferred_suffixes = (
        ".step",
        ".stp",
        ".glb",
        ".gltf",
        ".3mf",
        ".stl",
        ".obj",
        ".ply",
        ".off",
    )
    from backend.services.engine_layout import ENGINE_LABELS, engine_folder_of, iter_design_files, project_rel, resolve_in_layout

    revive_tombstoned_assemblies_if_viewport_empty(project_path)
    deleted = set(load_deleted_catalogs(project_path))
    mesh_files = [
        f
        for f in iter_design_files(project_path)
        if f.is_file()
        and not f.name.startswith("_active_")
        and not f.name.startswith("_export_")
        and not f.name.startswith("_share_")
        and ".generation-live." not in f.name.lower()
        and f.suffix.lower() != ".dxf"
        and f.suffix.lower() in SUPPORTED_IMPORT | SUPPORTED_EXPORT
        and "__part_" not in f.name.lower()
        and "__faceted" not in f.name.lower()
        and not catalog_is_deleted(project_rel(project_path, f), deleted)
        and not catalog_is_deleted(f.name, deleted)
    ]
    by_stem: dict[str, list[Path]] = {}
    for f in mesh_files:
        rel = project_rel(project_path, f)
        folder = engine_folder_of(rel)
        key = f"{folder}/{f.stem}" if folder else f.stem
        by_stem.setdefault(key, []).append(f)

    existing_stems = {Path(key).name for key in by_stem}
    for stem, path in _jake_hidden_assembly_previews(project_path):
        if stem in existing_stems:
            continue
        by_stem.setdefault(stem, []).append(path)
        existing_stems.add(stem)

    viewport_stems = _viewport_component_stems(project_path, {Path(key).name for key in by_stem})
    sim_bases = _load_sim_assembly_parts(project_path)
    canonical = _canonical_assembly_stem(project_path)

    for key in sorted(by_stem):
        stem = Path(key).name
        if stem not in viewport_stems:
            continue
        group = by_stem[key]
        catalog_hardware = looks_like_mcmaster_part_stem(stem)
        rank = (
            (".glb", ".gltf", ".step", ".stp", ".3mf", ".stl", ".obj", ".ply", ".off")
            if catalog_hardware
            else preferred_suffixes
        )
        canonical_file = group[0]
        for ext in rank:
            match = next((f for f in group if f.suffix.lower() == ext), None)
            if match is not None:
                canonical_file = match
                break
        rel_name = project_rel(project_path, canonical_file)
        folder = engine_folder_of(rel_name)
        viewer = viewer_filename_for_model(rel_name, project_path)
        # Hidden CADJS `.{stem}.step.glb` is the assembled viewer after a tombstone.
        # Keep a public catalog name so the client does not treat it as an internal sidecar.
        jake_preview = jake_viewport_glb_for_stem(project_path, stem)
        if jake_preview is not None and canonical_file.name.startswith("."):
            # The public files may still exist but be tombstoned. The recovered
            # hidden viewer needs a public catalog identity in either case.
            rel_name = f"{stem}.glb"
            viewer = project_rel(project_path, jake_preview)
        already_exploded = stem.lower().endswith("_exploded")
        exploded_viewer = None if already_exploded else _exploded_sidecar_for_stem(project_path, stem)
        label = _component_display_label(project_path, stem)
        if folder:
            label = f"{label} · {ENGINE_LABELS.get(folder, folder)}"
        components.append(
            {
                "id": key,
                "name": rel_name,
                "stem": stem,
                "engine": folder,
                "label": label,
                "format": canonical_file.suffix.lower().lstrip("."),
                "viewer_filename": viewer,
                "size": canonical_file.stat().st_size,
                "primary": False,
                "auto_load": False,
                "catalog_hardware": catalog_hardware,
                "has_exploded": bool(exploded_viewer),
                "exploded_viewer": exploded_viewer,
            }
        )
        if looks_like_create_primitive_stem(stem):
            components[-1]["freecad_primitive"] = True
            components[-1]["xr_creation"] = True
        if (
            rel_name in vr_files
            or canonical_file.name in vr_files
            or str(viewer or "") in vr_files
            or Path(str(viewer or "")).name in vr_files
        ):
            components[-1]["xr_creation"] = True
            components[-1]["vr_generation"] = True
            components[-1]["client"] = "xr"

    # Prefer the newest published Mesh/Jake/VibeCAD model, including engine folders.
    # A root program+sim stem must not steal primary from a later mesh/ publish.
    def _mtime(entry: dict[str, Any]) -> float:
        for name in (entry.get("viewer_filename"), entry.get("name")):
            text = str(name or "")
            if not text:
                continue
            path = resolve_in_layout(project_path, text) or (project_path / text)
            try:
                if path.is_file():
                    return path.stat().st_mtime
            except OSError:
                continue
        return 0.0

    hardware = [c for c in components if c.get("catalog_hardware")]
    designed = collapse_duplicate_folder_stems(
        collapse_orphan_exploded_part_components(
            [c for c in components if not c.get("catalog_hardware")]
        )
    )
    picked = None
    published = newest_published_model(project_path)
    if published:
        picked = next(
            (
                c
                for c in designed
                if c.get("name") == published or c.get("viewer_filename") == published
            ),
            None,
        )
    if picked is None and canonical:
        matches = [c for c in designed if c.get("stem") == canonical]
        if matches:
            picked = max(matches, key=_mtime)
    if picked is None and designed:
        picked = max(designed, key=_mtime)
    merged_stems: set[str] = set()
    try:
        from backend.services.cad_harness import merged_part_stems

        merged_stems = merged_part_stems(project_path)
    except Exception:
        merged_stems = set()
    for comp in designed:
        stem = str(comp.get("stem") or "")
        if stem.lower().endswith("_exploded"):
            continue
        if stem in merged_stems or Path(stem).stem in merged_stems:
            comp["auto_load"] = False
            continue
        comp["auto_load"] = True
    if picked is not None and (
        str(picked.get("stem") or "") in merged_stems
        or Path(str(picked.get("stem") or "")).stem in merged_stems
    ):
        alt = next((c for c in designed if c is not picked and c.get("auto_load")), None)
        if alt is not None:
            picked = alt
    if picked is not None:
        picked["primary"] = True
        picked["auto_load"] = True

    # Fusion-style: the assembled model is the Component. Catalog McMaster files
    # live in a McMaster Parts folder inside that component's Bodies group — never
    # as sibling Components. Hardware-only projects expose the folder under Bodies.
    bodies_section: list[dict[str, Any]] = []
    if hardware:
        parent = picked or (designed[0] if designed else None)
        if parent is not None:
            parent["hardware"] = hardware
            parent["hardware_label"] = "McMaster Parts"
        else:
            bodies_section.append(_mcmaster_parts_folder(hardware))


    return {
        "components": designed,
        "bodies": bodies_section,
        "sketches": [], "wiring": [], "drawings": [], "references": [],
        "renders": [], "rigging": [], "robots": [],
    }
