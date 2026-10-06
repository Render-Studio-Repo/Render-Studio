"""Fusion desktop script: import a Render Studio STEP into a new jointed design.

Uses Autodesk's ImportManager and AsBuiltJoints APIs. No server credentials.
The input is data only; never executes Python contained in a downloaded model.
"""
import base64
import json
import math
import re
from pathlib import Path


def read_metadata(filename):
    data = Path(filename).read_bytes()
    match = re.search(rb"/\* RENDER3D_JOINTS_V1\s+([A-Za-z0-9+/=\s]+?)\s+END_RENDER3D_JOINTS \*/", data)
    if not match or len(match[1]) > 4_000_000:
        raise ValueError("Choose the STEP from a Render Studio STEP + joints package.")
    payload = json.loads(base64.b64decode(re.sub(rb"\s", b"", match[1]), validate=True))
    if payload.get("schema") != "render3d.joints/1" or payload.get("units") != {"length": "mm", "angle": "deg"}:
        raise ValueError("Unsupported joint schema or units.")
    if payload.get("coordinate_frame") != "assembled_model" or not payload.get("joints"):
        raise ValueError("Missing assembled-model joint coordinates.")
    return payload


def _items(collection):
    return [collection.item(i) for i in range(collection.count)]


def resolve_occurrence(root, name):
    exact, aliases = [], []
    for occurrence in _items(root.allOccurrences):
        if name in {occurrence.fullPathName, occurrence.name}:
            exact.append(occurrence)
        elif name in {occurrence.component.name, re.sub(r":\d+$", "", occurrence.name)}:
            aliases.append(occurrence)
    matches = exact or aliases
    if len(matches) != 1:
        raise ValueError("Component %r: expected one occurrence, found %d. Preserve unique STEP component names." % (name, len(matches)))
    return matches[0]


def _vec(value):
    result = [float(v) for v in value]
    if len(result) != 3 or not all(math.isfinite(v) for v in result):
        raise ValueError("Joint coordinates must be three finite numbers")
    return result


def motion_limits(row):
    """Fusion uses radians/cm; its as-built zero is the imported pose."""
    kind = row["type"]
    values = []
    if kind in {"revolute", "continuous", "cylindrical"}:
        limits = row.get("angular_limits", row.get("limits") if kind != "cylindrical" else None)
        if limits is not None:
            offset = float(row.get("state", 0)) if kind != "cylindrical" else 0
            values.append(("rotationLimits", [(float(v) - offset) * math.pi / 180 for v in limits]))
    if kind in {"slider", "prismatic", "cylindrical"}:
        limits = row.get("linear_limits", row.get("limits") if kind != "cylindrical" else None)
        if limits is not None:
            offset = float(row.get("state", 0)) if kind != "cylindrical" else 0
            values.append(("slideLimits", [(float(v) - offset) / 10 for v in limits]))
    for _, bounds in values:
        if len(bounds) != 2 or not all(math.isfinite(v) for v in bounds) or bounds[0] > bounds[1]:
            raise ValueError("Invalid joint limits")
    if kind == "cylindrical" and (row.get("limits") or row.get("state")):
        raise ValueError("Cylindrical joints need angular_limits and linear_limits, with the exported pose as zero")
    return values


def import_joints(design, payload, core, fusion):
    root = design.rootComponent
    # STEP compounds sometimes import as several named bodies in one component.
    # Promote only named moving bodies; never guess by body order.
    names = {r[k] for r in payload["joints"] for k in ("parent", "child") if r.get(k) != "world"}
    components = [root]
    seen = set()
    for occurrence in _items(root.allOccurrences):
        comp = occurrence.component
        if comp.entityToken not in seen:
            components.append(comp)
            seen.add(comp.entityToken)
    for comp in components:
        for body in _items(comp.bRepBodies):
            if body.name in names and (comp == root or comp.bRepBodies.count > 1):
                name = body.name
                moved = body.createComponent()
                if not moved:
                    raise ValueError("Could not make a component for " + name)
                moved.parentComponent.name = name

    # Resolve and validate the complete map before modifying the new assembly.
    mapping = {name: resolve_occurrence(root, name) for name in names}
    rows = payload["joints"]
    for row in rows:
        if row["type"] not in {"fixed", "revolute", "continuous", "prismatic", "slider", "cylindrical", "ball"}:
            raise ValueError("Unsupported joint type: " + row["type"])
        if row.get('child_anchor',row['anchor']) != row['anchor'] or row.get('child_axis',row['axis']) != row['axis']:
            raise ValueError('Distinct connector frames are not supported by this Fusion importer: '+row['id'])
        if row.get('parent_rotation') or row.get('child_rotation'):
            raise ValueError('Explicit connector rotations need manual setup: '+row['id'])
        if row.get('suppressed'):
            raise ValueError('Suppressed joint needs manual setup: '+row['id'])
        _vec(row["anchor"])
        if sum(v*v for v in _vec(row["axis"])) < 1e-12:
            raise ValueError("Joint axis cannot be zero")
        motion_limits(row)
        if row["parent"] == row["child"]:
            raise ValueError("Joint connects a component to itself")
    for occurrence in mapping.values():
        occurrence.isGrounded = False
    if any(r.get("parent") == "world" for r in rows):
        ground = root.occurrences.addNewComponent(core.Matrix3D.create())
        ground.component.name = "Render Studio Ground"
        ground.isGrounded = True
        mapping["world"] = ground
    else:
        children = {r["child"] for r in rows}
        for name in names - children:
            mapping[name].isGrounded = True

    created, failed = [], []
    for row in rows:
        joint = None
        sketch = None
        try:
            parent, child = mapping[row["parent"]], mapping[row["child"]]
            if parent.fullPathName == child.fullPathName:
                raise ValueError("Parent and child resolved to the same occurrence")
            kind = row["type"]
            geometry, axis_line = None, None
            if kind != "fixed":
                # A hidden 3D sketch supplies pivot/axis geometry, without adding solids.
                sketch = root.sketches.add(root.xYConstructionPlane)
                sketch.name = "Joint datum: " + row["id"]
                anchor = [v / 10 for v in _vec(row["anchor"])]
                axis = _vec(row["axis"])
                norm = math.sqrt(sum(v*v for v in axis))
                axis = [v / norm for v in axis]
                point = sketch.sketchPoints.add(core.Point3D.create(*anchor))
                point.isFixed = True
                geometry = fusion.JointGeometry.createByPoint(point)
                axis_line = sketch.sketchCurves.sketchLines.addByTwoPoints(point, core.Point3D.create(*[a+b for a, b in zip(anchor, axis)]))
                axis_line.isConstruction = True
                axis_line.isFixed = True
            entry = root.asBuiltJoints.createInput(child, parent, geometry)
            custom = fusion.JointDirections.CustomJointDirection
            if kind in {"revolute", "continuous"}:
                ok = entry.setAsRevoluteJointMotion(custom, axis_line)
            elif kind in {"slider", "prismatic"}:
                ok = entry.setAsSliderJointMotion(custom, axis_line)
            elif kind == "cylindrical":
                ok = entry.setAsCylindricalJointMotion(custom, axis_line)
            elif kind == "ball":
                helper = [1, 0, 0] if abs(axis[0]) < 0.9 else [0, 1, 0]
                dot = sum(a*b for a, b in zip(axis, helper))
                yaw = [h-dot*a for h, a in zip(helper, axis)]
                yaw_line = sketch.sketchCurves.sketchLines.addByTwoPoints(point, core.Point3D.create(*[a+b for a, b in zip(anchor, yaw)]))
                yaw_line.isConstruction = True
                yaw_line.isFixed = True
                ok = entry.setAsBallJointMotion(custom, custom, axis_line, yaw_line)
            else:
                ok = entry.setAsRigidJointMotion()
            if ok is False:
                raise ValueError("Fusion rejected the joint motion")
            joint = root.asBuiltJoints.add(entry)
            if not joint:
                raise ValueError("Fusion did not create the joint")
            joint.name = row["id"]
            for attr, bounds in motion_limits(row):
                limits = getattr(joint.jointMotion, attr)
                limits.minimumValue, limits.maximumValue = bounds
                limits.isMinimumValueEnabled = limits.isMaximumValueEnabled = True
            joint.attributes.add("RenderStudio", "joint", json.dumps(row))
            created.append(row["id"])
        except Exception as exc:
            if joint:
                joint.deleteMe()
            failed.append(row["id"] + ": " + str(exc))
        finally:
            if sketch:
                sketch.isLightBulbOn = False
    root.attributes.add("RenderStudio", "assembly_joints", json.dumps(payload))
    return created, failed


def run(context):
    import adsk.core as core
    import adsk.fusion as fusion
    app = core.Application.get()
    ui = app.userInterface
    try:
        dialog = ui.createFileDialog()
        dialog.title = "Import Render Studio STEP + joints into a new design"
        dialog.filter = "STEP files (*.step;*.stp)"
        if dialog.showOpen() != core.DialogResults.DialogOK:
            return
        payload = read_metadata(dialog.filename)
        document = app.importManager.importToNewDocument(app.importManager.createSTEPImportOptions(dialog.filename))
        if not document:
            raise ValueError("Fusion could not import the STEP")
        design = fusion.Design.cast(app.activeProduct)
        created, failed = import_joints(design, payload, core, fusion)
        app.activeViewport.fit()
        message = "Created %d of %d joints in the new design." % (len(created), len(payload["joints"]))
        if failed:
            message += "\nUnresolved joints:\n" + "\n".join(failed)
        else:
            message += "\nSave this design in Fusion to keep the native joints."
        ui.messageBox(message)
    except Exception as exc:
        ui.messageBox("Joint import incomplete: " + str(exc))
