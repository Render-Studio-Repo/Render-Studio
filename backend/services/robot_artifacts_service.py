"""Canonical robot-description sources for Jake-compatible rigging workflows."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


SUPPORTED_SOURCE_SUFFIXES = frozenset({".py", ".urdf", ".srdf"})


@dataclass(frozen=True)
class RobotArtifactSource:
    path: Path
    mode: str
    urdf: Path | None = None
    srdf: Path | None = None

    @classmethod
    def resolve(cls, project_root: Path, source_name: str) -> "RobotArtifactSource":
        root = project_root.resolve()
        source = root / Path(source_name).name
        if not source.is_file() or source.suffix.lower() not in SUPPORTED_SOURCE_SUFFIXES:
            raise FileNotFoundError("Robot source must be an existing .py, .urdf, or .srdf file")
        suffix = source.suffix.lower()
        if suffix == ".py":
            return cls(path=source, mode="legacy-python")
        if suffix == ".urdf":
            paired = source.with_suffix(".srdf")
            return cls(path=source, mode="direct-xml", urdf=source, srdf=paired if paired.is_file() else None)
        paired = source.with_suffix(".urdf")
        if not paired.is_file():
            raise FileNotFoundError(f"Paired URDF not found beside {source.name}: {paired.name}")
        return cls(path=source, mode="direct-xml", urdf=paired, srdf=source)

    def validation_targets(self, kind: str) -> tuple[Path, ...]:
        if self.mode != "direct-xml":
            return ()
        requested = kind.strip().lower()
        targets: list[Path] = []
        if requested in {"urdf", "both"} and self.urdf:
            targets.append(self.urdf)
        if requested in {"srdf", "both"}:
            if not self.srdf:
                if requested == "srdf":
                    raise FileNotFoundError(f"Paired SRDF not found beside {self.urdf.name}")
            else:
                targets.append(self.srdf)
        return tuple(dict.fromkeys(targets))


def validate_direct_source(
    source: RobotArtifactSource,
    kind: str,
    *,
    skill_runner: Any,
) -> dict[str, Any]:
    """Validate direct XML with Jake's installed validators and return UI-ready output."""
    outputs: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for target in source.validation_targets(kind):
        tool = target.suffix.lower().lstrip(".")
        result = skill_runner.run_skill_tool(
            tool,
            "validate",
            [target.name, "--format", "json"],
            cwd=target.parent,
            timeout_sec=120.0,
        )
        payload = {
            "tool": tool,
            "filename": target.name,
            "stdout": (result.get("stdout") or "")[-12000:],
            "stderr": (result.get("stderr") or "")[-4000:],
            "exit_code": result.get("exit_code"),
            "validated": bool(result.get("ok")),
        }
        (outputs if result.get("ok") else errors).append(payload)
    return {
        "message": "Validated direct URDF/SRDF artifacts." if not errors else "Robot description validation failed.",
        "authored": False,
        "source_mode": source.mode,
        "outputs": outputs,
        "errors": errors,
    }
