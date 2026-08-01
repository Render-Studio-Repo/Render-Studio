# SPDX-License-Identifier: LGPL-2.1-or-later

"""Isolated build123d program runner.

This module is launched with ``python -I -S`` in an isolated sidecar process. It
does not import FreeCAD and communicates only through one request JSON file,
named STEP inputs, named STEP outputs, and one result JSON file.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import time
import traceback
from typing import Any


_ALLOWED_IMPORT_ROOTS = frozenset(
    {
        "build123d",
        "collections",
        "dataclasses",
        "decimal",
        "enum",
        "fractions",
        "functools",
        "itertools",
        "math",
        "numpy",
        "operator",
        "statistics",
        "typing",
    }
)

_FILLET_DIAGNOSTIC_BUDGET_SECONDS = 12.0
_FILLET_DIAGNOSTIC_RADIUS_FACTORS = (1.0, 0.75, 0.5)

_DISALLOWED_EXPORT_SYMBOLS = frozenset(
    {
        "ExportDXF",
        "ExportSVG",
        "Mesher",
        "export_brep",
        "export_gltf",
        "export_step",
        "export_stl",
    }
)
_DISALLOWED_BUILD123D_SUBMODULES = frozenset({"exporters", "exporters3d", "mesher"})


def _restricted_import(
    name: str,
    globals: dict[str, Any] | None = None,
    locals: dict[str, Any] | None = None,
    fromlist: tuple[str, ...] = (),
    level: int = 0,
) -> Any:
    if level:
        raise ImportError("Relative imports are not allowed in build123d source.")
    parts = str(name or "").split(".")
    root = parts[0]
    if root not in _ALLOWED_IMPORT_ROOTS:
        raise ImportError(f"Import is not allowed in build123d source: {root}")
    if root == "build123d":
        denied_modules = [
            part for part in parts[1:] if part in _DISALLOWED_BUILD123D_SUBMODULES
        ]
        if denied_modules:
            raise ImportError(
                f"Exporter modules are not allowed in build123d source: {name}"
            )
        for item in fromlist or ():
            symbol = str(item)
            if (
                symbol in _DISALLOWED_EXPORT_SYMBOLS
                or symbol in _DISALLOWED_BUILD123D_SUBMODULES
            ):
                raise ImportError(
                    f"Exporter symbols are not allowed in build123d source: {symbol}"
                )
    return __import__(name, globals, locals, fromlist, level)


def _restricted_builtins() -> dict[str, Any]:
    import builtins

    names = (
        "ArithmeticError",
        "AssertionError",
        "ImportError",
        "Exception",
        "IndexError",
        "KeyError",
        "NameError",
        "RuntimeError",
        "StopIteration",
        "TypeError",
        "ValueError",
        "ZeroDivisionError",
        "__build_class__",
        "abs",
        "all",
        "any",
        "bool",
        "classmethod",
        "dict",
        "enumerate",
        "filter",
        "float",
        "format",
        "frozenset",
        "int",
        "isinstance",
        "issubclass",
        "len",
        "list",
        "map",
        "max",
        "min",
        "object",
        "pow",
        "print",
        "property",
        "range",
        "reversed",
        "round",
        "set",
        "slice",
        "sorted",
        "str",
        "staticmethod",
        "sum",
        "super",
        "tuple",
        "zip",
    )
    allowed = {name: getattr(builtins, name) for name in names}
    allowed["__import__"] = _restricted_import
    return allowed


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(path)


def _set_soft_resource_limit(
    resource_module: Any,
    resource_id: int,
    requested_limit: int,
    label: str,
) -> None:
    if requested_limit <= 0:
        raise ValueError(f"{label} resource limit must be greater than zero.")

    _current_soft, current_hard = resource_module.getrlimit(resource_id)
    if current_hard == resource_module.RLIM_INFINITY:
        applied_soft = requested_limit
    else:
        applied_soft = min(requested_limit, int(current_hard))
        if applied_soft <= 0:
            raise RuntimeError(f"{label} resource hard limit is {current_hard}.")

    try:
        resource_module.setrlimit(resource_id, (applied_soft, current_hard))
    except (OSError, ValueError) as exc:
        raise RuntimeError(
            f"Could not apply {label} resource limit: requested={requested_limit}, "
            f"current_soft={_current_soft}, current_hard={current_hard}, "
            f"applied_soft={applied_soft}: {exc}"
        ) from exc


def _resource_limits(request: dict[str, Any]) -> None:
    try:
        import resource
    except ImportError:
        return
    memory_bytes = int(request.get("memory_limit_bytes") or 0)
    cpu_seconds = int(request.get("cpu_limit_seconds") or 0)
    output_bytes = int(request.get("output_limit_bytes") or 0)
    # Darwin can reject even a getrlimit()/setrlimit() round trip for address
    # space. The parent process enforces its configured RSS budget on macOS.
    if memory_bytes > 0 and sys.platform != "darwin":
        _set_soft_resource_limit(
            resource, resource.RLIMIT_AS, memory_bytes, "address-space"
        )
    if cpu_seconds > 0:
        _set_soft_resource_limit(resource, resource.RLIMIT_CPU, cpu_seconds, "CPU")
    if output_bytes > 0:
        _set_soft_resource_limit(
            resource, resource.RLIMIT_FSIZE, output_bytes, "output-file"
        )
    _set_soft_resource_limit(resource, resource.RLIMIT_NOFILE, 64, "open-file")


def _shape_facts(shape: Any) -> dict[str, Any]:
    bounds = shape.bounding_box()
    solids = list(shape.solids())
    faces = list(shape.faces())
    edges = list(shape.edges())
    vertices = list(shape.vertices())
    facts = {
        "shape_type": str(shape.shape_type),
        "valid": bool(shape.is_valid),
        "solid_count": len(solids),
        "face_count": len(faces),
        "edge_count": len(edges),
        "vertex_count": len(vertices),
        "volume_mm3": float(shape.volume),
        "bounds_mm": {
            "min": [float(bounds.min.X), float(bounds.min.Y), float(bounds.min.Z)],
            "max": [float(bounds.max.X), float(bounds.max.Y), float(bounds.max.Z)],
            "size": [float(bounds.size.X), float(bounds.size.Y), float(bounds.size.Z)],
            "diagonal": float(bounds.diagonal),
        },
    }
    try:
        facts["surface_area_mm2"] = float(shape.area)
    except Exception:
        pass
    try:
        center = shape.center()
        facts["center"] = [float(center.X), float(center.Y), float(center.Z)]
    except Exception:
        pass
    if edges:
        facts["minimum_edge_length_mm"] = min(float(edge.length) for edge in edges)
    if faces:
        facts["minimum_face_area_mm2"] = min(float(face.area) for face in faces)
    for label, items in (("face_geometry_types", faces), ("edge_geometry_types", edges)):
        histogram: dict[str, int] = {}
        for item in items:
            try:
                geometry_type = str(item.geom_type).rsplit(".", 1)[-1].lower()
            except Exception:
                geometry_type = "unknown"
            histogram[geometry_type] = histogram.get(geometry_type, 0) + 1
        facts[label] = histogram
    return facts


def _point(value: Any) -> list[float] | None:
    for names in (("X", "Y", "Z"), ("x", "y", "z")):
        try:
            return [float(getattr(value, name)) for name in names]
        except (AttributeError, TypeError, ValueError):
            continue
    return None


def _shape_evidence(shape: Any) -> dict[str, Any]:
    evidence = _shape_facts(shape)
    shape_type = str(evidence.get("shape_type") or "").lower()
    try:
        evidence["geometry_type"] = str(shape.geom_type).rsplit(".", 1)[-1].lower()
    except Exception:
        pass
    optional_properties = []
    if shape_type in {"edge", "wire"}:
        optional_properties.append(("length_mm", "length"))
    if shape_type in {"face", "shell", "solid", "compound", "compsolid"}:
        optional_properties.append(("area_mm2", "area"))
    for name, attribute in optional_properties:
        try:
            evidence[name] = float(getattr(shape, attribute))
        except Exception:
            pass
    try:
        vertices = list(shape.vertices())
        points = [_point(vertex.center()) for vertex in vertices]
        evidence["vertices"] = [point for point in points if point is not None][:8]
    except Exception:
        pass
    return evidence


def _shape_reference(shape: Any) -> dict[str, Any]:
    bounds = shape.bounding_box()
    reference: dict[str, Any] = {
        "shape_type": str(shape.shape_type),
        "valid": bool(shape.is_valid),
        "bounds_mm": {
            "min": [float(bounds.min.X), float(bounds.min.Y), float(bounds.min.Z)],
            "max": [float(bounds.max.X), float(bounds.max.Y), float(bounds.max.Z)],
        },
    }
    try:
        reference["geometry_type"] = str(shape.geom_type).rsplit(".", 1)[-1].lower()
    except Exception:
        pass
    shape_type = str(shape.shape_type).lower()
    if shape_type in {"edge", "wire"}:
        try:
            reference["length_mm"] = float(shape.length)
        except Exception:
            pass
    if shape_type == "face":
        try:
            reference["area_mm2"] = float(shape.area)
        except Exception:
            pass
    try:
        center = shape.center()
        reference["center"] = [float(center.X), float(center.Y), float(center.Z)]
    except Exception:
        pass
    if shape_type == "edge":
        try:
            points = [_point(vertex.center()) for vertex in shape.vertices()]
            reference["vertices"] = [point for point in points if point is not None][:2]
        except Exception:
            pass
    return reference


def _shape_is_closed(shape: Any) -> bool:
    value = getattr(shape, "is_closed", False)
    try:
        return bool(value() if callable(value) else value)
    except Exception:
        return False


def _edge_topology(
    edges: list[Any],
    target: Any,
) -> list[dict[str, Any]]:
    try:
        diagonal = float(target.bounding_box().diagonal)
    except Exception:
        diagonal = 1.0
    tolerance = max(1.0e-7, diagonal * 1.0e-8)

    endpoint_keys: list[list[tuple[int, int, int]]] = []
    edge_closed: list[bool] = []
    key_to_edges: dict[tuple[int, int, int], list[int]] = {}
    for index, edge in enumerate(edges):
        keys: list[tuple[int, int, int]] = []
        try:
            for vertex in edge.vertices():
                point = _point(vertex.center())
                if point is None:
                    continue
                key = tuple(int(round(component / tolerance)) for component in point)
                keys.append(key)
                key_to_edges.setdefault(key, []).append(index)
        except Exception:
            pass
        endpoint_keys.append(keys)
        edge_closed.append(_shape_is_closed(edge))

    parent = list(range(len(edges)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    for members in key_to_edges.values():
        for index in members[1:]:
            union(members[0], index)

    grouped: dict[int, list[int]] = {}
    for index in range(len(edges)):
        grouped.setdefault(find(index), []).append(index)

    components: list[dict[str, Any]] = []
    for component_index, indices in enumerate(grouped.values()):
        degrees: dict[tuple[int, int, int], int] = {}
        unknown_endpoints = 0
        for index in indices:
            keys = endpoint_keys[index]
            if edge_closed[index]:
                continue
            if not keys:
                unknown_endpoints += 1
                continue
            for key in keys:
                degrees[key] = degrees.get(key, 0) + 1
        open_endpoint_count = sum(degree % 2 for degree in degrees.values())
        branch_vertex_count = sum(degree > 2 for degree in degrees.values())
        components.append(
            {
                "component_index": component_index,
                "selection_indices": indices,
                "edge_count": len(indices),
                "closed_loop": bool(indices)
                and unknown_endpoints == 0
                and open_endpoint_count == 0,
                "open_endpoint_count": open_endpoint_count,
                "branch_vertex_count": branch_vertex_count,
                "endpoint_analysis_complete": unknown_endpoints == 0,
                "edges": [
                    {
                        "selection_index": index,
                        "shape": _shape_reference(edges[index]),
                    }
                    for index in indices
                ],
            }
        )
    return components


def _fillet_trial(target: Any, radius: float, edges: list[Any]) -> dict[str, Any]:
    started = time.monotonic()
    try:
        candidate = target.fillet(radius, edges)
        return {
            "succeeded": True,
            "radius_mm": radius,
            "elapsed_seconds": time.monotonic() - started,
            "result": _shape_facts(candidate),
        }
    except Exception as trial_error:
        return {
            "succeeded": False,
            "radius_mm": radius,
            "elapsed_seconds": time.monotonic() - started,
            "exception_type": type(trial_error).__name__,
            "error": str(trial_error),
        }


def _summarize_value(value: Any, shape_type: type[Any], shape_list_type: type[Any]) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value if not isinstance(value, str) or len(value) <= 1000 else value[:997] + "..."
    if isinstance(value, shape_type):
        return {"python_type": type(value).__name__, "shape": _shape_evidence(value)}
    if isinstance(value, shape_list_type) or (
        isinstance(value, (list, tuple))
        and value
        and all(isinstance(item, shape_type) for item in value)
    ):
        items = list(value)
        return {
            "python_type": type(value).__name__,
            "count": len(items),
            "items": [
                {"index": index, "shape": _shape_reference(item)}
                for index, item in enumerate(items[:16])
            ],
            "truncated": len(items) > 16,
        }
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in list(value.items())[:32]:
            summary = _summarize_value(item, shape_type, shape_list_type)
            if summary is not None:
                result[str(key)] = summary
        return {"python_type": "dict", "count": len(value), "items": result}
    if isinstance(value, (list, tuple)) and len(value) <= 32:
        items = [_summarize_value(item, shape_type, shape_list_type) for item in value]
        if all(item is not None for item in items):
            return {"python_type": type(value).__name__, "items": items}
    vector = _point(value)
    if vector is not None:
        return {"python_type": type(value).__name__, "xyz": vector}
    name = getattr(value, "name", None)
    if isinstance(name, str) and value.__class__.__module__.startswith("build123d"):
        return {"python_type": type(value).__name__, "name": name}
    return None


def _display_filename(filename: str, site_packages: Path) -> str:
    path = Path(filename)
    try:
        return str(path.resolve().relative_to(site_packages.resolve()))
    except (OSError, ValueError):
        return filename


def _traceback_evidence(
    tb: Any,
    source: str,
    site_packages: Path,
    shape_type: type[Any],
    shape_list_type: type[Any],
) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    source_lines = source.splitlines()
    while tb is not None:
        frame = tb.tb_frame
        filename = str(frame.f_code.co_filename)
        relevant = filename == "<vibecad-build123d>" or "build123d" in Path(filename).parts
        if relevant:
            item: dict[str, Any] = {
                "file": _display_filename(filename, site_packages),
                "line": int(tb.tb_lineno),
                "function": str(frame.f_code.co_name),
            }
            if filename == "<vibecad-build123d>" and 0 < tb.tb_lineno <= len(source_lines):
                item["source"] = source_lines[tb.tb_lineno - 1].strip()
            local_values: dict[str, Any] = {}
            local_items = list(frame.f_locals.items())
            if filename != "<vibecad-build123d>":
                argument_count = frame.f_code.co_argcount + frame.f_code.co_kwonlyargcount
                argument_names = set(frame.f_code.co_varnames[:argument_count])
                local_items = [
                    (name, value)
                    for name, value in local_items
                    if name in argument_names
                ]
            for name, value in local_items:
                if name.startswith("__"):
                    continue
                summary = _summarize_value(value, shape_type, shape_list_type)
                if summary is not None:
                    local_values[name] = summary
                if len(local_values) >= 32:
                    break
            if local_values:
                item["locals"] = local_values
            frames.append(item)
        tb = tb.tb_next
    return frames[-16:]


def _fillet_diagnostics(
    exc: BaseException,
    shape_type: type[Any],
    shape_list_type: type[Any],
) -> dict[str, Any] | None:
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        tb = current.__traceback__
        while tb is not None:
            frame = tb.tb_frame
            local_values = frame.f_locals
            if (
                frame.f_code.co_name == "fillet"
                and "self" in local_values
                and "radius" in local_values
                and "edge_list" in local_values
                and isinstance(local_values["self"], shape_type)
            ):
                target = local_values["self"]
                radius = float(local_values["radius"])
                edges = list(local_values["edge_list"])
                result: dict[str, Any] = {
                    "requested_radius_mm": radius,
                    "selected_edge_count": len(edges),
                    "target": {
                        key: value
                        for key, value in _shape_facts(target).items()
                        if key
                        in {
                            "valid",
                            "solid_count",
                            "face_count",
                            "edge_count",
                            "volume_mm3",
                            "bounds_mm",
                        }
                    },
                    "selected_edges": [
                        {"selection_index": index, "shape": _shape_reference(edge)}
                        for index, edge in enumerate(edges[:64])
                    ],
                    "selection_truncated": len(edges) > 64,
                    "diagnostic_budget_seconds": _FILLET_DIAGNOSTIC_BUDGET_SECONDS,
                }
                started = time.monotonic()
                deadline = started + _FILLET_DIAGNOSTIC_BUDGET_SECONDS
                components = _edge_topology(edges, target)
                result["connected_components"] = components
                component_trials: list[dict[str, Any]] = []
                individual_trials: list[dict[str, Any]] = []
                stop_reason = None

                for component in components:
                    if time.monotonic() >= deadline:
                        stop_reason = "time_budget_exhausted_before_all_components"
                        break
                    indices = list(component["selection_indices"])
                    component_edges = [edges[index] for index in indices]
                    trial = _fillet_trial(target, radius, component_edges)
                    trial.update(
                        {
                            "component_index": component["component_index"],
                            "selection_indices": indices,
                            "closed_loop": component["closed_loop"],
                        }
                    )
                    component_trials.append(trial)
                    if trial["succeeded"]:
                        continue
                    for factor in _FILLET_DIAGNOSTIC_RADIUS_FACTORS[1:]:
                        if time.monotonic() >= deadline:
                            stop_reason = "time_budget_exhausted_during_radius_ladder"
                            break
                        reduced = _fillet_trial(target, radius * factor, component_edges)
                        reduced.update(
                            {
                                "component_index": component["component_index"],
                                "selection_indices": indices,
                                "closed_loop": component["closed_loop"],
                                "radius_factor": factor,
                            }
                        )
                        component_trials.append(reduced)
                        if reduced["succeeded"]:
                            break
                    if stop_reason:
                        break

                failing_components = {
                    int(trial["component_index"])
                    for trial in component_trials
                    if trial.get("radius_mm") == radius and not trial["succeeded"]
                }
                for component in components:
                    if int(component["component_index"]) not in failing_components:
                        continue
                    if int(component["edge_count"]) <= 1:
                        continue
                    for index in component["selection_indices"]:
                        if time.monotonic() >= deadline:
                            stop_reason = "time_budget_exhausted_during_edge_isolation"
                            break
                        trial = _fillet_trial(target, radius, [edges[index]])
                        trial["selection_index"] = index
                        trial["component_index"] = component["component_index"]
                        individual_trials.append(trial)
                    if stop_reason:
                        break

                requested_component_trials = [
                    trial for trial in component_trials if trial.get("radius_mm") == radius
                ]
                result["component_trials"] = component_trials
                if individual_trials:
                    result["individual_edge_trials"] = individual_trials
                result["separate_component_fillet_possible"] = bool(
                    requested_component_trials
                ) and len(requested_component_trials) == len(components) and all(
                    trial["succeeded"] for trial in requested_component_trials
                )
                tested_indices = {
                    int(trial["selection_index"]) for trial in individual_trials
                }
                result["combined_selection_interaction"] = (
                    len(tested_indices) == len(edges)
                    and all(trial["succeeded"] for trial in individual_trials)
                )
                result["diagnostic_complete"] = stop_reason is None
                result["diagnostic_stop_reason"] = stop_reason
                result["diagnostic_elapsed_seconds"] = time.monotonic() - started
                return result
            tb = tb.tb_next
        current = current.__cause__ or current.__context__
    return None


def _exception_evidence_impl(
    exc: BaseException,
    source: str,
    site_packages: Path,
) -> dict[str, Any]:
    from build123d import Shape, ShapeList

    chain: list[dict[str, Any]] = []
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen and len(chain) < 8:
        seen.add(id(current))
        chain.append(
            {
                "exception_type": type(current).__name__,
                "error": str(current),
                "frames": _traceback_evidence(
                    current.__traceback__, source, site_packages, Shape, ShapeList
                ),
            }
        )
        current = current.__cause__ or current.__context__
    evidence: dict[str, Any] = {"exception_chain": chain}
    fillet = _fillet_diagnostics(exc, Shape, ShapeList)
    if fillet is not None:
        selected_count = int(fillet.get("selected_edge_count") or 0)
        for item in chain:
            for frame in item.get("frames") or []:
                local_values = frame.get("locals")
                if not isinstance(local_values, dict):
                    continue
                if frame.get("file") != "<vibecad-build123d>":
                    frame.pop("locals", None)
                    continue
                frame["locals"] = {
                    name: value
                    for name, value in local_values.items()
                    if not (
                        isinstance(value, dict)
                        and value.get("python_type") in {"ShapeList", "list", "tuple"}
                        and int(value.get("count") or 0) == selected_count
                    )
                }
                if not frame["locals"]:
                    frame.pop("locals")
        evidence["fillet_diagnostics"] = fillet
    return evidence


def _exception_evidence(exc: BaseException, source: str, site_packages: Path) -> dict[str, Any]:
    try:
        return _exception_evidence_impl(exc, source, site_packages)
    except Exception as diagnostic_error:
        return {
            "diagnostic_error": {
                "exception_type": type(diagnostic_error).__name__,
                "error": str(diagnostic_error),
            }
        }


def _exception_kind(exc: BaseException, evidence: dict[str, Any]) -> str:
    if evidence.get("fillet_diagnostics"):
        return "kernel_fillet_failure"
    if isinstance(exc, AssertionError):
        return "design_assertion_failure"
    if isinstance(exc, (AttributeError, TypeError)):
        for item in evidence.get("exception_chain") or []:
            for frame in item.get("frames") or []:
                if frame.get("file") != "<vibecad-build123d>":
                    continue
                for value in (frame.get("locals") or {}).values():
                    if isinstance(value, dict) and value.get("python_type") == "ShapeList":
                        return "shape_collection_contract_failure"
    return "python_execution_failure"


def _remove_exporter_symbols(module: Any) -> None:
    """Strip file-writing exporter entry points before user source executes.

    The worker's own STEP export uses the OCP writer directly, so removing
    the build123d exporter surface does not affect legitimate output flow.
    """
    targets: list[Any] = [module]
    shape_type = getattr(module, "Shape", None)
    if shape_type is not None:
        targets.append(shape_type)
    for target in targets:
        for symbol in _DISALLOWED_EXPORT_SYMBOLS:
            if symbol in getattr(target, "__dict__", {}):
                try:
                    delattr(target, symbol)
                except (AttributeError, TypeError):
                    pass
    for submodule in _DISALLOWED_BUILD123D_SUBMODULES:
        if submodule in getattr(module, "__dict__", {}):
            try:
                delattr(module, submodule)
            except (AttributeError, TypeError):
                pass
    exported_names = getattr(module, "__all__", None)
    if isinstance(exported_names, (list, tuple)):
        denied = _DISALLOWED_EXPORT_SYMBOLS | _DISALLOWED_BUILD123D_SUBMODULES
        safe_names = [name for name in exported_names if str(name) not in denied]
        module.__all__ = (
            tuple(safe_names) if isinstance(exported_names, tuple) else safe_names
        )


def _export_step_geometry(shape: Any, output_path: Path) -> None:
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer

    writer = STEPControl_Writer()
    transfer_status = writer.Transfer(shape.wrapped, STEPControl_AsIs)
    if transfer_status != IFSelect_RetDone:
        raise RuntimeError(f"STEP transfer failed: {transfer_status}")
    write_status = writer.Write(str(output_path))
    if write_status != IFSelect_RetDone:
        raise RuntimeError(f"STEP write failed: {write_status}")


def run(request_path: Path, result_path: Path, site_packages: Path) -> int:
    source = ""
    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
        if not isinstance(request, dict):
            raise ValueError("Runner request must be a JSON object.")
        _resource_limits(request)
        sys.path.insert(0, str(site_packages))

        import build123d
        from build123d import Shape, import_step

        expected_version = str(request.get("build123d_version") or "")
        actual_version = str(getattr(build123d, "__version__", "") or "")
        # Accept same minor line (VibeCAD pins 0.11.1; Render Studio may ship 0.11.0).
        if expected_version and actual_version:
            exp_parts = expected_version.split(".")[:2]
            act_parts = actual_version.split(".")[:2]
            if exp_parts != act_parts:
                raise RuntimeError(
                    f"build123d runtime version is {actual_version!r}; "
                    f"expected {expected_version!r} (same major.minor)."
                )
        _remove_exporter_symbols(build123d)

        inputs: dict[str, Shape] = {}
        raw_inputs = request.get("inputs") or {}
        if not isinstance(raw_inputs, dict):
            raise ValueError("inputs must be an object mapping aliases to STEP files.")
        for alias, relative_path in raw_inputs.items():
            inputs[str(alias)] = import_step(str(Path(str(relative_path))))

        parameters = request.get("parameters") or {}
        if not isinstance(parameters, dict):
            raise ValueError("parameters must be a JSON object.")
        source = str(request.get("source") or "")
        namespace: dict[str, Any] = {
            "__builtins__": _restricted_builtins(),
            "__name__": "__vibecad_build123d__",
            "inputs": inputs,
            "params": dict(parameters),
        }
        compiled = compile(source, "<vibecad-build123d>", "exec")
        exec(compiled, namespace, namespace)
        result = namespace.get("result")
        if not isinstance(result, dict) or not result:
            raise RuntimeError(
                "The build123d source must assign a non-empty dict[str, Shape] "
                "to result."
            )

        expected_outputs = [str(item) for item in request.get("expected_outputs") or []]
        actual_outputs = [str(item) for item in result]
        if actual_outputs != expected_outputs:
            raise RuntimeError(
                "result keys must exactly match expected_outputs in the same order; "
                f"expected {expected_outputs!r}, received {actual_outputs!r}."
            )

        output_directory = Path(str(request.get("output_directory") or "outputs"))
        output_directory.mkdir(parents=True, exist_ok=True)
        outputs: list[dict[str, Any]] = []
        for index, key in enumerate(expected_outputs):
            shape = result.get(key)
            if not isinstance(shape, Shape):
                raise TypeError(
                    f"result[{key!r}] is {type(shape).__name__}, not a build123d Shape."
                )
            facts = _shape_facts(shape)
            if not facts["valid"]:
                raise RuntimeError(f"result[{key!r}] is not a valid shape.")
            if facts["solid_count"] != 1:
                raise RuntimeError(
                    f"result[{key!r}] must contain exactly one solid; "
                    f"received {facts['solid_count']}. Return physical components "
                    "as separate named outputs."
                )
            output_path = output_directory / f"{index:03d}.step"
            _export_step_geometry(shape, output_path)
            outputs.append(
                {
                    "key": key,
                    "step_path": str(output_path),
                    "shape": facts,
                }
            )

        _write_json(
            result_path,
            {
                "ok": True,
                "build123d_version": actual_version,
                "outputs": outputs,
            },
        )
        return 0
    except BaseException as exc:
        evidence = _exception_evidence(exc, source, site_packages)
        _write_json(
            result_path,
            {
                "ok": False,
                "error": str(exc),
                "exception_type": exc.__class__.__name__,
                "traceback": traceback.format_exc(limit=16),
                "exception_kind": _exception_kind(exc, evidence),
                "exception_evidence": evidence,
            },
        )
        return 1


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: build123d_worker.py REQUEST_JSON RESULT_JSON SITE_PACKAGES"
        )
    return run(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))


if __name__ == "__main__":
    raise SystemExit(main())
