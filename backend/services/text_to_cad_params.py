"""Parse and patch module-scope parameters in text-to-cad Python sources."""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

from backend.services import cad_service, skill_runner

_SKIP_PARAM_NAMES = frozenset({
    "dxf_filename",
    "dxf_path",
    "__all__",
})

_STRING_PARAM_SUFFIXES = ("_layer", "_filename", "_path", "_label", "_name")


def _is_gen_step_node(node: ast.AST) -> bool:
    return isinstance(node, ast.FunctionDef) and node.name == "gen_step"


def _literal_value(node: ast.AST | None) -> Any | None:
    if node is None:
        return None
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant):
        if isinstance(node.operand.value, (int, float)):
            return -node.operand.value
    return None


def _param_kind(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    return "unknown"


def _normalize_part_token(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _param_matches_part(name: str, part_filter: str | None) -> bool:
    if not part_filter:
        return True
    token = _normalize_part_token(part_filter)
    if not token:
        return True
    norm = _normalize_part_token(name)
    if norm == token:
        return True
    if norm.startswith(f"{token}_") or norm.endswith(f"_{token}"):
        return True
    if token in norm.split("_"):
        return True
    return False


def _iter_module_assignments(tree: ast.Module) -> list[tuple[str, ast.AST, ast.AST]]:
    gen_step_idx = next((idx for idx, node in enumerate(tree.body) if _is_gen_step_node(node)), len(tree.body))
    out: list[tuple[str, ast.AST, ast.AST]] = []
    for node in tree.body[:gen_step_idx]:
        if isinstance(node, ast.Assign):
            value = node.value
            for target in node.targets:
                if isinstance(target, ast.Name):
                    out.append((target.id, value, node))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out.append((node.target.id, node.value, node))
    return out


def list_parameters(source: str, *, part_filter: str | None = None) -> list[dict[str, Any]]:
    tree = ast.parse(source)
    params: list[dict[str, Any]] = []
    for name, value_node, node in _iter_module_assignments(tree):
        if name.startswith("_") or name in _SKIP_PARAM_NAMES:
            continue
        value = _literal_value(value_node)
        if value is None:
            continue
        kind = _param_kind(value)
        if kind == "unknown":
            continue
        if kind == "string" and not name.endswith(_STRING_PARAM_SUFFIXES):
            continue
        if not _param_matches_part(name, part_filter):
            continue
        params.append(
            {
                "name": name,
                "value": value,
                "kind": kind,
                "line": getattr(node, "lineno", None),
            }
        )
    return params


def patch_parameters(source: str, updates: dict[str, Any]) -> str:
    if not updates:
        return source
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    pending: dict[int, str] = {}
    for name, value_node, node in _iter_module_assignments(tree):
        if name not in updates:
            continue
        new_value = updates[name]
        if isinstance(new_value, bool):
            rendered = "True" if new_value else "False"
        elif isinstance(new_value, (int, float)) and not isinstance(new_value, bool):
            rendered = repr(float(new_value) if isinstance(new_value, float) else int(new_value))
        elif isinstance(new_value, str):
            rendered = repr(new_value)
        else:
            continue
        line_no = getattr(node, "lineno", 0)
        if line_no <= 0 or line_no > len(lines):
            continue
        line = lines[line_no - 1]
        if isinstance(node, ast.AnnAssign):
            m = re.match(rf"^(\s*{re.escape(name)}\s*:\s*[^=]+=\s*)(.+?)(\s*(?:#.*)?)$", line.rstrip("\n"))
            if m:
                pending[line_no] = f"{m.group(1)}{rendered}{m.group(3)}{lines[line_no - 1][len(line.rstrip(chr(10))):]}"
                continue
        m = re.match(rf"^(\s*{re.escape(name)}\s*=\s*)(.+?)(\s*(?:#.*)?)$", line.rstrip("\n"))
        if not m:
            continue
        pending[line_no] = f"{m.group(1)}{rendered}{m.group(3)}{lines[line_no - 1][len(line.rstrip(chr(10))):]}"
    if not pending:
        return source
    out = []
    for idx, line in enumerate(lines, start=1):
        out.append(pending.get(idx, line))
    return "".join(out)


def resolve_source_for_model(project_path: Path, filename: str) -> tuple[Path, str] | None:
    safe = Path(filename).name
    stem = Path(safe).stem
    for suffix in (".py",):
        candidate = project_path / f"{stem}{suffix}"
        if candidate.is_file():
            return candidate, candidate.name
    edited = re.sub(r"(_edited(?:_\d+)?)+$", "", stem, flags=re.I)
    if edited != stem:
        candidate = project_path / f"{edited}.py"
        if candidate.is_file():
            return candidate, candidate.name
    return None


def regenerate_model(project_path: Path, source_name: str) -> dict[str, Any]:
    source_path = project_path / Path(source_name).name
    if not source_path.is_file():
        raise FileNotFoundError("CAD source not found")
    stem = source_path.stem
    step_name = f"{stem}.step"
    glb_name = f"{stem}.glb"
    stl_name = f"{stem}.stl"
    three_mf_name = f"{stem}.3mf"
    step_out = skill_runner.run_skill_tool(
        "cad",
        "step",
        [
            source_path.name,
            "-o",
            step_name,
            "--glb",
            glb_name,
            "--stl",
            stl_name,
            "--3mf",
            three_mf_name,
            "--force",
        ],
        cwd=project_path,
        timeout_sec=240.0,
    )
    if not step_out.get("ok"):
        detail = (step_out.get("stderr") or step_out.get("stdout") or "scripts/step failed").strip()
        raise RuntimeError(detail[:2000] or "scripts/step failed")
    glb_path = project_path / glb_name
    if glb_path.is_file():
        cad_service.apply_prompt_appearance_to_file(glb_path, "", seed=stem)
    return {
        "source": source_path.name,
        "step": step_name,
        "glb": glb_name,
        "stl": stl_name,
        "three_mf": three_mf_name,
    }
