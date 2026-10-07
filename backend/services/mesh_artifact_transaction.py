"""Run-isolated Mesh candidates with guarded pair publication."""

from __future__ import annotations

import fcntl
import json
import os
import shutil
import tempfile
from contextlib import ExitStack
from pathlib import Path

from backend.services.mesh_acceptance import file_hash, verify_manifest


def run_isolated(generate, prompt, project_path, context, ai, **kwargs):
    from backend.services.engine_layout import artifacts_for, model_stem

    project = Path(project_path)
    project.mkdir(parents=True, exist_ok=True)
    runs = project / ".mesh-runs"
    runs.mkdir(exist_ok=True)
    baseline = {str(p.relative_to(project)): file_hash(p)
                for directory in (project, project / "mesh") for p in directory.glob("*")
                if p.is_file() and p.suffix in {".glb", ".js", ".mjs"}}
    progress = kwargs.get("progress_callback")
    completed = []
    if progress:
        def candidate_progress(event):
            if event.get("stage") == "done":
                completed.append(event)
            else:
                event = dict(event)
                name = event.get("preview_filename")
                if name:
                    candidate = (work / name).resolve()
                    if not candidate.is_relative_to(work) or not candidate.is_file():
                        raise ValueError("Mesh draft escaped its run directory")
                    draft = project / "mesh" / f"{candidate.stem}.{work.name}.generation-live.glb"
                    draft.parent.mkdir(exist_ok=True)
                    staged = work / "draft-promotion.glb"
                    shutil.copy2(candidate, staged)
                    os.replace(staged, draft)
                    if draft not in drafts:
                        drafts.add(draft)
                        stack.callback(draft.unlink, missing_ok=True)
                    event["preview_filename"] = str(draft.relative_to(project))
                progress(event)
        kwargs["progress_callback"] = candidate_progress
    with ExitStack() as stack:
        directory = stack.enter_context(tempfile.TemporaryDirectory(prefix="run-", dir=runs))
        work = Path(directory)
        drafts = set()
        result = generate(prompt, work, context, ai, **kwargs)
        files = result["result"]["files"]
        source, glb = (work / files[k] for k in ("source", "glb"))
        for candidate in (source, glb):
            if not candidate.resolve().is_relative_to(work):
                raise ValueError("Mesh candidate escaped its run directory")
        arts = artifacts_for(project, "mesh", model_stem(source.name),
                             previous_source_name=kwargs.get("previous_source_name"),
                             base_filename=(context or {}).get("base_filename"))
        manifest = json.loads((work / "mesh-acceptance.json").read_text())
        verify_manifest(source, glb, manifest, work.name)
        cancel = kwargs.get("cancel_check")
        if cancel and cancel():
            raise RuntimeError("Generation canceled.")
        targets = [(source, arts.source_path), (glb, arts.glb_path),
                   (work / "mesh-acceptance.json", arts.glb_path.with_suffix(".glb.acceptance.json"))]
        with (runs / "publish.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            for _, target in targets[:2]:
                old = baseline.get(str(target.relative_to(project)))
                if (file_hash(target) if target.is_file() else None) != old:
                    raise RuntimeError("Selected Mesh changed during generation. Retry using its latest revision.")
            backups = []
            promoted = []
            try:
                for index, (candidate, target) in enumerate(targets):
                    target.parent.mkdir(parents=True, exist_ok=True)
                    backup = work / f"accepted-backup-{index}"
                    if target.exists():
                        shutil.copy2(target, backup)
                    backups.append((target, backup))
                    staged = work / f"promotion-{index}"
                    shutil.copy2(candidate, staged)
                    os.replace(staged, target)
                    promoted.append(target)
                if cancel and cancel():
                    raise RuntimeError("Generation canceled.")
            except BaseException:
                for target, backup in reversed(backups):
                    if backup.exists():
                        os.replace(backup, target)
                    elif target in promoted:
                        target.unlink(missing_ok=True)
                raise
        result["result"]["acceptance"] = manifest
        result["result"]["files"].update(source=arts.source_name, glb=arts.glb_name)
        result["result"].update(source=arts.source_name, glb=arts.glb_name, primary=arts.glb_name)
        result.update(primary=arts.glb_name, filename=arts.glb_name)
        if progress:
            for event in completed:
                try:
                    progress(event)
                except Exception:
                    pass
        return result
