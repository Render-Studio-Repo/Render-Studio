"""Bind CAD acceptance to current-run artifacts without starting another author."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class CadArtifactIdentity:
    filename: str
    sha256: str
    byte_length: int
    mtime_ns: int

    @classmethod
    def read(cls, project_path: Path, filename: str) -> CadArtifactIdentity:
        root = Path(project_path).resolve()
        path = (root / filename).resolve()
        relative = path.relative_to(root).as_posix()
        before = path.stat()
        digest = hashlib.sha256()
        length = 0
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
                length += len(chunk)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError(f"CAD artifact changed while reading: {filename}")
        if not length or length != after.st_size:
            raise ValueError(f"CAD artifact is empty or incomplete: {filename}")
        return cls(relative, digest.hexdigest(), length, after.st_mtime_ns)


@dataclass(frozen=True)
class CadRunManifest:
    run_started_ns: int
    source: CadArtifactIdentity
    step: CadArtifactIdentity
    glb: CadArtifactIdentity

    @classmethod
    def capture(
        cls, project_path: Path, source_name: str, step_name: str, glb_name: str,
        *, run_started_ns: int,
    ) -> CadRunManifest:
        source = CadArtifactIdentity.read(project_path, source_name)
        step = CadArtifactIdentity.read(project_path, step_name)
        glb = CadArtifactIdentity.read(project_path, glb_name)
        for artifact in (step, glb):
            if artifact.mtime_ns < run_started_ns:
                raise ValueError(f"CAD export was not produced in this run: {artifact.filename}")
            if artifact.mtime_ns < source.mtime_ns:
                raise ValueError(f"CAD export predates its source: {artifact.filename}")
        return cls(run_started_ns, source, step, glb)

    def matches(self, project_path: Path) -> bool:
        try:
            return all(
                CadArtifactIdentity.read(project_path, item.filename) == item
                for item in (self.source, self.step, self.glb)
            )
        except (OSError, ValueError):
            return False

    def diagnostics(self) -> dict:
        return asdict(self)


def current_snapshot_ready(project_path: Path, snapshot: dict | None, *, started_ns: int) -> bool:
    if not snapshot or snapshot.get("ok") is False:
        return False
    filenames = snapshot.get("files") or ([snapshot["file"]] if snapshot.get("file") else [])
    try:
        return bool(filenames) and all(
            CadArtifactIdentity.read(project_path, name).mtime_ns >= started_ns
            for name in filenames
        )
    except (OSError, ValueError, TypeError):
        return False


def can_ship_exhausted_cad(*, step_ok: bool, glb_ok: bool, source_ok: bool) -> bool:
    return bool(step_ok and glb_ok and source_ok)


def exhausted_cad_note(last_error: str, attempts: int) -> str:
    err = " ".join(str(last_error or "").split())
    note = (
        f"text-to-cad 2.0 did not finish later repair/review after {attempts} tries; "
        "keeping the last exported STEP/GLB so the job is not discarded."
    )
    if err:
        return f"{note} Last error: {err[:900]}"
    return note


def jake_allows_host_source_rewrite(
    *,
    jake_identical: bool,
    canonical_source: bool,
    agent_attempted: bool,
) -> bool:
    """Host ``generate_cad_python_source`` loop is not the Jake author.

    Canonical benchmark templates may still be written by the host. After Codex
    or the CAD tool agent has run, do not start a second full-file rewrite.
    """
    if canonical_source:
        return True
    if jake_identical and agent_attempted:
        return False
    return True

