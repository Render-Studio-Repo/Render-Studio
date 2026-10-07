"""Deterministic release checks for physical wiring data."""
from __future__ import annotations
from typing import Any

VERIFIED_MODES = {"verified", "verified-build", "fabrication"}
COPPER_OHMS_PER_M = {18: 0.02095, 20: 0.03331, 22: 0.05296, 24: 0.08422, 26: 0.1339, 28: 0.2129}


def _text(value: Any) -> str:
    return str(value or "").strip()


def part_identity(component: dict[str, Any]) -> dict[str, str]:
    part = component.get("part") if isinstance(component.get("part"), dict) else {}
    identity = component.get("partIdentity") if isinstance(component.get("partIdentity"), dict) else {}
    return {
        "manufacturer": _text(identity.get("manufacturer") or component.get("manufacturer") or part.get("manufacturer")),
        "partNumber": _text(identity.get("partNumber") or component.get("partNumber") or part.get("partNumber") or part.get("mpn")),
        "revision": _text(identity.get("revision") or component.get("revision") or part.get("revision")),
    }


def _pin_records(component: dict[str, Any]) -> list[dict[str, Any]]:
    for value in (component.get("pins"), (component.get("profile") or {}).get("pins"), component.get("pin_layout")):
        if isinstance(value, list):
            return [pin for pin in value if isinstance(pin, dict)]
    return []


def _pin(component: dict[str, Any], pin_id: Any) -> dict[str, Any] | None:
    target = _text(pin_id)
    return next((pin for pin in _pin_records(component) if _text(pin.get("id") or pin.get("pinId") or pin.get("number")) == target), None)


def _range(record: dict[str, Any], key: str) -> tuple[float | None, float | None]:
    value = record.get(key)
    if isinstance(value, (int, float)):
        number = float(value)
        return number, number
    if not isinstance(value, dict):
        return None, None
    low = value.get("min")
    high = value.get("max")
    return (float(low) if isinstance(low, (int, float)) else None, float(high) if isinstance(high, (int, float)) else None)


def component_accuracy(component: dict[str, Any]) -> dict[str, Any]:
    identity = part_identity(component)
    pins = _pin_records(component)
    connectors = component.get("connectors") if isinstance(component.get("connectors"), list) else []
    exact_identity = bool(identity["manufacturer"] and identity["partNumber"] and identity["revision"])
    exact_geometry = bool(component.get("sourceFile") and component.get("dimensions"))
    anchored = [pin for pin in pins if pin.get("position3d") is not None or pin.get("coordinates") is not None]
    evidenced = [pin for pin in pins if pin.get("evidence") or pin.get("documentation") or pin.get("verification") == "verified"]
    connector_cavities = sum(len(c.get("cavities") or []) for c in connectors if isinstance(c, dict))
    missing = []
    if not exact_identity: missing.append("manufacturer, part number, and revision")
    if not exact_geometry: missing.append("exact CAD model and dimensions")
    if not pins: missing.append("terminal definitions")
    elif len(anchored) != len(pins): missing.append("physical terminal anchors")
    if pins and len(evidenced) != len(pins): missing.append("terminal evidence")
    if pins and not connector_cavities: missing.append("connector cavity mapping")
    return {
        "componentId": _text(component.get("id")),
        "identity": identity,
        "exactIdentity": exact_identity,
        "exactGeometry": exact_geometry,
        "pinCount": len(pins),
        "anchoredPinCount": len(anchored),
        "evidencedPinCount": len(evidenced),
        "connectorCavityCount": connector_cavities,
        "verified": not missing,
        "missing": missing,
    }


def electrical_issues(schematic: dict[str, Any]) -> list[dict[str, Any]]:
    components = {str(c.get("id")): c for c in schematic.get("components", []) if isinstance(c, dict)}
    issues: list[dict[str, Any]] = []
    for wire in schematic.get("wires", []):
        if not isinstance(wire, dict): continue
        ends = []
        for side in ("from", "to"):
            endpoint = wire.get(side) if isinstance(wire.get(side), dict) else {}
            component = components.get(_text(endpoint.get("componentId")))
            pin = _pin(component or {}, endpoint.get("pinId")) if component else None
            ends.append((side, component, pin, endpoint))
        if any(component is None or pin is None for _, component, pin, _ in ends):
            continue
        (_, _, a, _), (_, _, b, _) = ends
        a_role, b_role = _text(a.get("role") or a.get("direction")).lower(), _text(b.get("role") or b.get("direction")).lower()
        if a_role == "output" and b_role == "output":
            issues.append({"code":"output-contention", "wireId":wire.get("id"), "severity":"error", "message":"Two output terminals are connected."})
        a_min, a_max = _range(a, "voltage")
        b_min, b_max = _range(b, "voltage")
        if a_min is not None and a_max is not None and b_min is not None and b_max is not None and (a_max < b_min or b_max < a_min):
            issues.append({"code":"voltage-range", "wireId":wire.get("id"), "severity":"error", "message":f"Voltage ranges do not overlap: {a_min:g}-{a_max:g} V and {b_min:g}-{b_max:g} V."})
        a_connector = _text(a.get("connectorFamily") or a.get("connector"))
        b_connector = _text(b.get("connectorFamily") or b.get("connector"))
        if a_connector and b_connector and a_connector.lower() != b_connector.lower() and not wire.get("adapter"):
            issues.append({"code":"connector-family", "wireId":wire.get("id"), "severity":"error", "message":f"Connector families do not mate: {a_connector} and {b_connector}."})
        a_gender, b_gender = _text(a.get("connectorGender")).lower(), _text(b.get("connectorGender")).lower()
        if a_gender and b_gender and a_gender == b_gender and a_gender in {"male", "female", "plug", "receptacle"} and not wire.get("adapter"):
            issues.append({"code":"connector-gender", "wireId":wire.get("id"), "severity":"error", "message":f"Connector genders do not mate: {a_gender} to {b_gender}."})
        max_current = wire.get("maxCurrentA")
        load_current = wire.get("loadCurrentA")
        if isinstance(max_current, (int, float)) and isinstance(load_current, (int, float)) and load_current > max_current:
            issues.append({"code":"wire-ampacity", "wireId":wire.get("id"), "severity":"error", "message":f"Load {load_current:g} A exceeds the declared wire capacity {max_current:g} A."})
        awg, length = wire.get("awg"), wire.get("cutLengthMm") or wire.get("lengthMm")
        if isinstance(awg, (int, float)) and int(awg) in COPPER_OHMS_PER_M and isinstance(length, (int, float)) and isinstance(load_current, (int, float)):
            drop = 2 * float(length) / 1000 * COPPER_OHMS_PER_M[int(awg)] * float(load_current)
            limit = wire.get("maxVoltageDropV")
            if isinstance(limit, (int, float)) and drop > limit:
                issues.append({"code":"voltage-drop", "wireId":wire.get("id"), "severity":"error", "calculatedVoltageDropV":round(drop, 4), "message":f"Calculated round-trip voltage drop {drop:.3f} V exceeds {limit:g} V."})
    return issues


def accuracy_report(schematic: dict[str, Any]) -> dict[str, Any]:
    components = [component_accuracy(c) for c in schematic.get("components", []) if isinstance(c, dict)]
    wires = [w for w in schematic.get("wires", []) if isinstance(w, dict)]
    exact = sum(1 for item in components if item["exactGeometry"])
    verified = sum(1 for item in components if item["verified"])
    physical_endpoints = 0
    by_id = {str(c.get("id")): c for c in schematic.get("components", []) if isinstance(c, dict)}
    for wire in wires:
        for side in ("from", "to"):
            endpoint = wire.get(side) or {}
            pin = _pin(by_id.get(_text(endpoint.get("componentId")), {}), endpoint.get("pinId"))
            if pin and (pin.get("position3d") is not None or pin.get("coordinates") is not None): physical_endpoints += 1
    denominator = len(wires) * 2
    issues = electrical_issues(schematic)
    ready = bool(components) and verified == len(components) and (not denominator or physical_endpoints == denominator) and not issues
    return {
        "mode": _text(schematic.get("buildMode") or schematic.get("accuracyMode") or "concept").lower(),
        "componentCount": len(components),
        "verifiedComponentCount": verified,
        "exactGeometryPercent": round(100 * exact / len(components)) if components else 0,
        "physicalEndpointPercent": round(100 * physical_endpoints / denominator) if denominator else 0,
        "components": components,
        "electricalIssues": issues,
        "readyForPhysicalWiring": ready,
    }


def verified_build_issues(schematic: dict[str, Any]) -> list[str]:
    report = accuracy_report(schematic)
    if report["mode"] not in VERIFIED_MODES:
        return []
    issues = []
    for item in report["components"]:
        if item["missing"]:
            issues.append(f"{item['componentId'] or 'Component'} needs {', '.join(item['missing'])}.")
    issues.extend(issue["message"] for issue in report["electricalIssues"] if issue["severity"] == "error")
    for wire in schematic.get("wires", []):
        if not isinstance(wire, dict): continue
        missing = []
        if wire.get("awg") is None and wire.get("conductorAreaMm2") is None: missing.append("wire gauge")
        if not wire.get("wireType") and not wire.get("insulation"): missing.append("wire type or insulation")
        if not isinstance(wire.get("minBendRadiusMm"), (int, float)): missing.append("minimum bend radius")
        if not wire.get("connectors"): missing.append("termination connectors")
        if not isinstance(wire.get("cutLengthMm"), (int, float)): missing.append("cut length")
        if missing: issues.append(f"Wire {wire.get('id') or '?'} needs {', '.join(missing)}.")
    if schematic.get("wires") and report["physicalEndpointPercent"] < 100:
        issues.append("Every wire endpoint needs a verified physical terminal anchor.")
    return list(dict.fromkeys(issues))
