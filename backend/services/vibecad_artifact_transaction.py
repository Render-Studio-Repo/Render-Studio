"""Restore the last accepted VibeCAD artifacts when candidate review fails."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import shutil
import tempfile
from typing import Iterator


def _artifact_candidates(roots: tuple[Path, ...], stem: str) -> set[Path]:
    prefixes = (stem + ".", stem + "__", stem + "_snapshot")
    return {
        path
        for root in roots
        if root.is_dir()
        for path in root.iterdir()
        if path.is_file() and path.name.startswith(prefixes)
    }


@dataclass
class CandidateArtifactTransaction:
    """A candidate becomes canonical only after every acceptance gate passes."""

    accepted: bool = False

    def accept(self) -> None:
        self.accepted = True


@contextmanager
def candidate_artifact_transaction(
    project_path: Path,
    directory: Path,
    stem: str,
) -> Iterator[CandidateArtifactTransaction]:
    roots = tuple(dict.fromkeys((Path(project_path), Path(directory))))
    transaction = CandidateArtifactTransaction()
    with tempfile.TemporaryDirectory(prefix="vibecad-candidate-") as temporary:
        saved: dict[Path, Path] = {}
        for index, path in enumerate(sorted(_artifact_candidates(roots, stem))):
            backup = Path(temporary) / str(index)
            shutil.copy2(path, backup)
            saved[path] = backup
        try:
            yield transaction
        finally:
            if not transaction.accepted:
                for path in _artifact_candidates(roots, stem) - saved.keys():
                    path.unlink()
                for path, backup in saved.items():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(backup, path)


@contextmanager
def preserve_accepted_artifacts(project_path: Path, directory: Path, stem: str):
    roots = tuple(dict.fromkeys((Path(project_path), Path(directory))))

    with tempfile.TemporaryDirectory(prefix="vibecad-accepted-") as temporary:
        saved = {}
        for index, path in enumerate(sorted(_artifact_candidates(roots, stem))):
            backup = Path(temporary) / str(index)
            shutil.copy2(path, backup)
            saved[path] = backup
        try:
            yield
        except BaseException:
            for path in _artifact_candidates(roots, stem) - saved.keys():
                path.unlink()
            for path, backup in saved.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup, path)
            raise
