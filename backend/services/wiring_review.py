"""Generation completeness and follow-up questions, independent of AI transport success."""
from __future__ import annotations
from typing import Any


def normalize_questions(raw: Any) -> list[dict[str, Any]]:
    result = []
    for index, item in enumerate(raw if isinstance(raw, list) else []):
        question = {"question": item} if isinstance(item, str) else item
        if not isinstance(question, dict):
            continue
        title = str(question.get("question") or question.get("text") or question.get("title") or "").strip()
        if not title:
            continue
        options = [str(x)[:500] for x in (question.get("options") or question.get("choices") or []) if isinstance(x, (str, int, float))][:8]
        result.append({"id": str(question.get("id") or f"detail-{index + 1}")[:100], "question": title[:1200], "options": options, "required": question.get("required", True) is not False})
    return result[:8]


def connectivity_issues(schematic: dict[str, Any]) -> list[str]:
    components = {str(c.get("id")): c for c in schematic.get("components", []) if isinstance(c, dict) and c.get("id") is not None}
    connected: dict[str, set[str]] = {key: set() for key in components}
    issues = []
    for wire in schematic.get("wires", []):
        if not isinstance(wire, dict):
            continue
        valid = True
        endpoints = []
        for side in ("from", "to"):
            end = wire.get(side) or {}
            cid, pin = str(end.get("componentId", "")), str(end.get("pinId", ""))
            comp = components.get(cid)
            if not comp or not pin:
                issues.append(f"Connection {wire.get('id', '')} has a missing {side} terminal."); valid = False
            elif comp.get("pin_layout_mode") == "diagram" and pin not in {str(p.get("id")) for p in comp.get("pin_layout", [])}:
                issues.append(f"{comp.get('label', cid)} has no terminal named {pin}."); valid = False
            endpoints.append((cid, pin))
        if valid:
            for cid, pin in endpoints:
                connected[cid].add(pin)
    for cid, comp in components.items():
        if comp.get("type") in {"breadboard", "annotation", "label"} or comp.get("optional"):
            continue
        # ULN2003 can use its onboard motor socket instead of individual visible wires.
        harness = comp.get("connection") or comp.get("motor_connection")
        if "28byj" in str(comp.get("label", "")).lower() and any("uln2003" in str(c.get("label", "")).lower().replace(" ", "") for c in components.values()):
            harness = "ULN2003 onboard motor socket"
        if len(components) > 1 and not connected[cid] and not harness:
            issues.append(f"{comp.get('label', cid)} is disconnected.")
        missing = [str(pin) for pin in comp.get("required_connections", []) if str(pin) not in connected[cid]]
        if missing:
            issues.append(f"{comp.get('label', cid)} needs connections at {', '.join(missing)}.")
    return list(dict.fromkeys(issues))


def review_schematic(schematic: dict[str, Any]) -> dict[str, Any]:
    from backend.services.wiring_accuracy import accuracy_report, verified_build_issues
    result = dict(schematic)
    issues = connectivity_issues(result)
    issues.extend(verified_build_issues(result))
    questions = normalize_questions(result.get("followup_questions"))
    blocker = result.get("blocker") if isinstance(result.get("blocker"), dict) else None
    if issues or questions or blocker:
        reason = (blocker or {}).get("reason") or (' '.join(issues[:4]) if issues else "Additional details are needed to finish this circuit.")
        result["blocker"] = {**(blocker or {}), "blocked": True, "reason": reason, "issues": issues, "wire_count": len(result.get("wires", [])), "component_count": len(result.get("components", []))}
        if not questions:
            questions = [{"id": "circuit-details", "question": f"{reason}\nProvide the missing connection requirements or a pinout/reference link so generation can finish.", "options": [], "required": True}]
    else:
        result["blocker"] = None
    result["followup_questions"] = questions
    result["accuracyReport"] = accuracy_report(result)
    return result


def answers_context(answers: list[dict[str, Any]]) -> str:
    if not answers:
        return ""
    import json
    return "\n\nUser answers to the wiring follow-up questions (project references still apply):\n" + json.dumps(answers, ensure_ascii=False) + "\nUse these answers to resolve the questions. Do not ask again for facts already supplied by these answers or the linked references. Check electrical compatibility before connecting."
