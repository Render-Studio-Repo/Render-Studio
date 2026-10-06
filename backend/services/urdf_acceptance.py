"""Validate robot artifacts and bind accepted XML to its CAD and mesh revisions."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import xml.etree.ElementTree as ET

import numpy as np


@dataclass(frozen=True)
class RobotArtifactIdentity:
    path: str
    sha256: str

    @classmethod
    def read(cls, path: Path, root: Path) -> RobotArtifactIdentity:
        path, root = Path(path).resolve(), Path(root).resolve()
        relative = path.relative_to(root).as_posix()
        data = path.read_bytes()
        if not data:
            raise ValueError(f"Empty robot dependency: {relative}")
        return cls(relative, hashlib.sha256(data).hexdigest())


def capture_dependencies(root: Path, paths) -> tuple[RobotArtifactIdentity, ...]:
    return tuple(RobotArtifactIdentity.read(Path(path), root) for path in paths)


def _assert_dependencies(root: Path, identities) -> None:
    for identity in identities:
        if RobotArtifactIdentity.read(Path(root) / identity.path, root) != identity:
            raise ValueError(f"Robot dependency changed: {identity.path}")


def finite_vector(value, count=3) -> list[float]:
    values = value.split() if isinstance(value, str) else value
    if not isinstance(values, (list, tuple)) or len(values) != count:
        raise ValueError(f"Expected {count} finite coordinates")
    result = [float(item) for item in values]
    if not all(math.isfinite(item) for item in result):
        raise ValueError("Robot coordinates must be finite")
    return result


def normalized_axis(value) -> list[float]:
    axis = finite_vector(value)
    norm = math.sqrt(sum(item * item for item in axis))
    if norm < 1e-12:
        raise ValueError("Joint axis must be nonzero")
    return [item / norm for item in axis]


def length_scale(unit: str) -> float:
    scales = {"m": 1.0, "meter": 1.0, "meters": 1.0, "mm": 0.001, "millimeter": 0.001, "millimeters": 0.001}
    if unit not in scales:
        raise ValueError(f"Unsupported robot length unit: {unit}")
    return scales[unit]


def joint_limits_si(joint: dict, *, length_unit="mm", angle_unit="deg") -> list[float] | None:
    kind = str(joint.get("type") or "fixed")
    if kind not in {"revolute", "prismatic"}:
        return None
    raw = joint.get("limits")
    if isinstance(raw, dict):
        raw = [raw.get("lower"), raw.get("upper")]
    limits = finite_vector(raw, 2)
    if limits[0] > limits[1]:
        raise ValueError("Joint lower limit exceeds upper limit")
    if kind == "prismatic":
        scale = length_scale(length_unit)
    elif angle_unit in {"deg", "degree", "degrees"}:
        scale = math.pi / 180.0
    elif angle_unit in {"rad", "radian", "radians"}:
        scale = 1.0
    else:
        raise ValueError(f"Unsupported robot angle unit: {angle_unit}")
    return [item * scale for item in limits]


def _number(value, label: str, *, positive=False, nonnegative=False) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {label}") from exc
    if not math.isfinite(number) or (positive and number <= 0) or (nonnegative and number < 0):
        raise ValueError(f"Invalid {label}")
    return number


def _graph(robot: ET.Element):
    links = [link.get("name", "") for link in robot.findall("link")]
    if not links or any(not name for name in links) or len(set(links)) != len(links):
        raise ValueError("Robot link names must be nonempty and unique")
    joints, parents = {}, {}
    for joint in robot.findall("joint"):
        name = joint.get("name", "")
        parent, child = joint.find("parent"), joint.find("child")
        parent = parent.get("link") if parent is not None else None
        child = child.get("link") if child is not None else None
        if not name or name in joints:
            raise ValueError("Robot joint names must be nonempty and unique")
        if parent not in links or child not in links or parent == child or child in parents:
            raise ValueError(f"Invalid parent/child relationship for joint {name}")
        joints[name], parents[child] = joint, parent
    roots = set(links) - parents.keys()
    if len(roots) != 1:
        raise ValueError("Robot must have exactly one root link")
    root = next(iter(roots))
    for link in links:
        visited = set()
        current = link
        while current in parents:
            if current in visited:
                raise ValueError("Robot joint graph has a cycle")
            visited.add(current)
            current = parents[current]
        if current != root:
            raise ValueError("Robot links must form one connected tree")
    return links, joints, root


def _mesh_path(uri: str, directory: Path, project_root: Path, packages: dict) -> Path:
    if not uri or "\\" in uri:
        raise ValueError("Invalid mesh URI")
    if uri.startswith("package://"):
        package, separator, relative = uri[len("package://"):].partition("/")
        if not separator or package not in packages:
            raise ValueError(f"Unresolved mesh package: {uri}")
        base = Path(packages[package]).resolve()
        path = (base / relative).resolve()
        path.relative_to(base)
    else:
        if ":" in uri or Path(uri).is_absolute():
            raise ValueError(f"Mesh URI must be project relative: {uri}")
        path = (directory / uri).resolve()
    path.relative_to(project_root)
    if path.suffix.lower() not in {".stl", ".glb", ".gltf", ".obj", ".dae"}:
        raise ValueError(f"Unsupported robot mesh: {uri}")
    if not path.is_file() or not path.stat().st_size:
        raise ValueError(f"Missing robot mesh: {uri}")
    return path


def validate_urdf(xml: str, *, directory: Path, project_root: Path | None = None,
                  packages: dict | None = None, require_geometry=False) -> dict:
    if "<!DOCTYPE" in xml.upper() or "<!ENTITY" in xml.upper():
        raise ValueError("Robot XML cannot contain external entities")
    robot = ET.fromstring(xml)
    if robot.tag != "robot" or not robot.get("name"):
        raise ValueError("Expected a named robot element")
    directory = Path(directory).resolve()
    root = Path(project_root or directory).resolve()
    directory.relative_to(root)
    links, joints, root_link = _graph(robot)
    for origin in robot.iter("origin"):
        finite_vector(origin.get("xyz", "0 0 0"))
        finite_vector(origin.get("rpy", "0 0 0"))
    for joint in joints.values():
        kind = joint.get("type")
        if kind not in {"fixed", "continuous", "revolute", "prismatic"}:
            raise ValueError(f"Unsupported joint type: {kind}")
        if kind != "fixed":
            axis = joint.find("axis")
            values = normalized_axis(axis.get("xyz", "1 0 0") if axis is not None else [1, 0, 0])
            if axis is not None and not np.allclose(values, finite_vector(axis.get("xyz")), atol=1e-8):
                raise ValueError("Joint axis must be normalized")
        limit = joint.find("limit")
        if kind in {"revolute", "prismatic"}:
            if limit is None:
                raise ValueError(f"Joint {joint.get('name')} requires limits")
            lo, hi = [_number(limit.get(key), key) for key in ("lower", "upper")]
            if lo > hi:
                raise ValueError("Joint limits are reversed")
        if limit is not None:
            for key in ("effort", "velocity"):
                _number(limit.get(key), key, nonnegative=True)
        mimic = joint.find("mimic")
        if mimic is not None:
            target = mimic.get("joint")
            if target not in joints or target == joint.get("name"):
                raise ValueError("Invalid mimic joint reference")
            if (kind == "prismatic") != (joints[target].get("type") == "prismatic"):
                raise ValueError("Mimic joint units differ")
            for key, default in (("multiplier", "1"), ("offset", "0")):
                _number(mimic.get(key, default), key)
    for name in joints:
        seen = set()
        current = name
        while joints[current].find("mimic") is not None:
            if current in seen:
                raise ValueError("Mimic joint graph has a cycle")
            seen.add(current)
            current = joints[current].find("mimic").get("joint")
    meshes, missing_inertial = [], []
    geometry_count = 0
    for link in robot.findall("link"):
        inertial = link.find("inertial")
        if inertial is None:
            missing_inertial.append(link.get("name"))
        else:
            mass, inertia = inertial.find("mass"), inertial.find("inertia")
            _number(mass.get("value") if mass is not None else None, "mass", positive=True)
            if inertia is None:
                raise ValueError("Missing inertia tensor")
            xx, yy, zz, xy, xz, yz = [_number(inertia.get(k), k) for k in ("ixx", "iyy", "izz", "ixy", "ixz", "iyz")]
            moments = np.linalg.eigvalsh([[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]])
            if moments[0] <= 0 or moments[2] > moments[0] + moments[1] + 1e-12:
                raise ValueError("Inertia tensor is not physically valid")
        for tag in ("visual", "collision"):
            for item in link.findall(tag):
                geometry = item.find("geometry")
                if geometry is None or len(geometry) != 1:
                    raise ValueError(f"Link {link.get('name')} has invalid {tag} geometry")
                shape = geometry[0]
                geometry_count += 1
                if shape.tag == "mesh":
                    scale = finite_vector(shape.get("scale", "1 1 1"))
                    if min(scale) <= 0:
                        raise ValueError("Robot mesh scale must be positive")
                    meshes.append(_mesh_path(shape.get("filename", ""), directory, root, packages or {}))
                elif shape.tag == "box":
                    if min(finite_vector(shape.get("size", ""))) <= 0:
                        raise ValueError("Box size must be positive")
                elif shape.tag in {"sphere", "cylinder"}:
                    _number(shape.get("radius"), "radius", positive=True)
                    if shape.tag == "cylinder":
                        _number(shape.get("length"), "length", positive=True)
                else:
                    raise ValueError(f"Unsupported robot geometry: {shape.tag}")
    if require_geometry and not geometry_count:
        raise ValueError("Robot has no geometry")
    identities = capture_dependencies(root, sorted(set(meshes)))
    return {"schema": "render3d.urdf-acceptance/1", "ok": True, "root_link": root_link,
            "link_count": len(links), "joint_count": len(joints), "geometry_count": geometry_count,
            "missing_inertial": missing_inertial, "simulation_ready": bool(geometry_count) and not missing_inertial,
            "meshes": [asdict(item) for item in identities]}


def _atomic_write(path: Path, data: bytes) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".urdf-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def publish_urdf(path: Path, xml: str, *, project_root: Path | None = None,
                 expected_dependencies=(), require_geometry=False) -> dict:
    path = Path(path).resolve()
    root = Path(project_root or path.parent).resolve()
    path.relative_to(root)
    report = validate_urdf(xml, directory=path.parent, project_root=root, require_geometry=require_geometry)
    dependencies = tuple(expected_dependencies) + tuple(RobotArtifactIdentity(**item) for item in report["meshes"])
    _assert_dependencies(root, dependencies)
    data = xml.encode("utf-8")
    relative = path.relative_to(root).as_posix()
    report.update({"urdf": {"path": relative, "sha256": hashlib.sha256(data).hexdigest()},
                   "dependencies": [asdict(item) for item in dependencies if item.path != relative]})
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest = path.with_suffix(path.suffix + ".acceptance.json")
    import fcntl

    with path.with_suffix(path.suffix + ".lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = path.read_bytes() if path.is_file() else None
        old_manifest = manifest.read_bytes() if manifest.is_file() else None
        try:
            _assert_dependencies(root, dependencies)
            _atomic_write(path, data)
            _atomic_write(manifest, json.dumps(report, indent=2, allow_nan=False).encode())
        except BaseException:
            for target, previous in ((path, old), (manifest, old_manifest)):
                if previous is None:
                    target.unlink(missing_ok=True)
                else:
                    _atomic_write(target, previous)
            raise
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    return report


def accepted_urdf_is_current(path: Path, project_root: Path) -> bool:
    try:
        report = json.loads(Path(path).with_suffix(Path(path).suffix + ".acceptance.json").read_text())
        if not report.get("ok"):
            return False
        _assert_dependencies(project_root, [RobotArtifactIdentity(**item) for item in [report["urdf"], *report["dependencies"]]])
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def _origin_matrix(origin: ET.Element | None):
    xyz = finite_vector(origin.get("xyz", "0 0 0") if origin is not None else [0, 0, 0])
    r, p, y = finite_vector(origin.get("rpy", "0 0 0") if origin is not None else [0, 0, 0])
    cr, sr, cp, sp, cy, sy = math.cos(r), math.sin(r), math.cos(p), math.sin(p), math.cos(y), math.sin(y)
    matrix = np.eye(4)
    matrix[:3, :3] = [[cy*cp, cy*sp*sr-sy*cr, cy*sp*cr+sy*sr], [sy*cp, sy*sp*sr+cy*cr, sy*sp*cr-cy*sr], [-sp, cp*sr, cp*cr]]
    matrix[:3, 3] = xyz
    return matrix


def bind_assembled_meshes(xml: str, mesh_by_link: dict[str, str]) -> tuple[str, int]:
    """Move assembled-mm visuals into link frames without moving joint pivots."""
    robot = ET.fromstring(xml)
    _, joints, root = _graph(robot)
    worlds = {root: np.eye(4)}
    pending = list(joints.values())
    while pending:
        for joint in pending[:]:
            parent = joint.find("parent").get("link")
            if parent in worlds:
                worlds[joint.find("child").get("link")] = worlds[parent] @ _origin_matrix(joint.find("origin"))
                pending.remove(joint)
    replaced = 0
    for link in robot.findall("link"):
        filename = mesh_by_link.get(link.get("name"))
        if not filename:
            continue
        inverse = np.linalg.inv(worlds[link.get("name")])
        rotation = inverse[:3, :3]
        pitch = math.asin(float(np.clip(-rotation[2, 0], -1, 1)))
        if abs(math.cos(pitch)) > 1e-8:
            roll, yaw = math.atan2(rotation[2, 1], rotation[2, 2]), math.atan2(rotation[1, 0], rotation[0, 0])
        else:
            roll, yaw = math.atan2(-rotation[1, 2], rotation[1, 1]), 0.0
        for tag in ("visual", "collision"):
            for item in list(link.findall(tag)):
                link.remove(item)
            item = ET.SubElement(link, tag)
            ET.SubElement(item, "origin", xyz=" ".join(map(str, inverse[:3, 3])), rpy=" ".join(map(str, (roll, pitch, yaw))))
            ET.SubElement(ET.SubElement(item, "geometry"), "mesh", filename=filename, scale="0.001 0.001 0.001")
        replaced += 1
    return ET.tostring(robot, encoding="unicode"), replaced
