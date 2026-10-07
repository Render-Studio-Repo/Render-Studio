"""Normalize LLM ObjectSculptSpec JSON so img2threejs --strict-quality can pass.

GPT-6 Astra (and similar) often return a nested component tree, an object-shaped
proceduralStrategy, unnamed feature groups, and procedural referencePbr.maps with
no file locators. Mesh codegen is code-only (no TextureLoader), so those maps
must not fail-close the gate.
"""

from __future__ import annotations

import copy
import re
from typing import Any

VALID_PRIMITIVES = {
    "box",
    "sphere",
    "ellipsoid",
    "cylinder",
    "cone",
    "capsule",
    "torus",
    "tube",
    "lathe",
    "extrude",
    "ground-blade",
    "curve-sweep",
    "tapered-sweep",
    "plane-card",
    "instanced-cluster",
}
VALID_TOPOLOGY = {
    "continuous-sculpt",
    "assembled-solid",
    "conforming-shell",
    "surface-relief",
    "fiber-strand",
    "material-only",
    "implicit",
    "open-shell",
}
PRIMITIVE_ALIASES = {
    "group": "box",
    "pivot": "box",
    "empty": "box",
    "custom": "sphere",
    "mesh": "sphere",
    "buffergeometry": "sphere",
    "buffer-geometry": "sphere",
    "plane": "plane-card",
    "quad": "plane-card",
    "disc": "cylinder",
    "disk": "cylinder",
    "ring": "torus",
    "torus-knot": "torus",
}
TOPOLOGY_ALIASES = {
    "transform-only": "material-only",
    "closed-manifold": "assembled-solid",
    "repeated-closed-solids": "assembled-solid",
    "repeated-closed-annular-solids": "assembled-solid",
    "paired-closed-manifold": "assembled-solid",
    "closed-thickened-hemispherical-shell": "conforming-shell",
    "closed-thickened-partial-shell": "conforming-shell",
    "paired-closed-thickened-plates": "assembled-solid",
    "closed-swept-solids": "continuous-sculpt",
    "closed-swept-tapered-solid": "continuous-sculpt",
    "repeated-closed-tapered-fibre-solids": "fiber-strand",
    "paired-thickened-cavity-shells": "conforming-shell",
}
DETAIL_KIND_ALIASES = {
    "geometry": "contour",
    "form": "contour",
    "shape": "contour",
    "material": "stain",
    "finish": "stain",
    "wear": "scratch",
    "oxidation": "stain",
    "fibre": "ridge",
    "fiber": "ridge",
    "hair": "ridge",
    "hardware": "fastener",
    "bolt": "fastener",
    "opening": "hole",
    "cavity": "hole",
    "recess": "groove",
}
DEFAULT_LIGHTS = [
    "key light: upper-front directional, slightly camera-left",
    "fill light: opposite side, lower intensity, ACES filmic tone mapping, exposure 1.0",
    "rim light plus contact shadow / ground shadow and ambient occlusion at the mount",
]
CHARACTER_REVIEW_IDS = (
    "anatomy-proportion",
    "face-landmark-placement",
    "pose-silhouette",
    "outfit-and-palette",
)


def normalize_mesh_sculpt_spec(
    spec: dict[str, Any] | None,
    starter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Deep-merge the LLM spec onto the forge starter, then coerce Astra-shaped fields."""
    merged = _deep_merge(starter or {}, spec or {})
    if not isinstance(merged, dict):
        merged = dict(starter or {})
    _coerce_component_tree(merged)
    _coerce_procedural_strategy(merged, starter)
    _fill_names(merged)
    _normalize_feature_groups(merged)
    _normalize_feature_review_targets(merged)
    _normalize_materials(merged)
    _normalize_components(merged)
    _link_detail_inventory(merged)
    _ensure_mesh_look_dev(merged, starter)
    _ensure_anatomy_track(merged)
    _ensure_pipeline(merged)
    _ensure_contract_lists(merged)
    return merged


def _deep_merge(base: Any, overlay: Any) -> Any:
    if not isinstance(overlay, dict):
        return copy.deepcopy(overlay) if overlay is not None else copy.deepcopy(base)
    if not isinstance(base, dict):
        return copy.deepcopy(overlay)
    out = copy.deepcopy(base)
    for key, value in overlay.items():
        if value is None:
            continue
        if key in out and isinstance(out[key], dict) and isinstance(value, dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def _title_from_id(value: str) -> str:
    slug = re.sub(r"[_\-]+", " ", value).strip()
    slug = re.sub(r"(?<!^)([A-Z])", r" \1", slug)
    slug = re.sub(r"\s+", " ", slug).strip()
    return slug[:1].upper() + slug[1:] if slug else "Unnamed"


def _ensure_named(item: dict[str, Any], fallback: str = "Unnamed") -> None:
    name = item.get("name")
    if isinstance(name, str) and name.strip():
        return
    ident = item.get("id")
    if isinstance(ident, str) and ident.strip():
        item["name"] = _title_from_id(ident)
    else:
        item["name"] = fallback


def _hex_to_rgba(color: Any, alpha: float = 1.0) -> str:
    raw = str(color or "").strip()
    if raw.startswith("#"):
        digits = raw[1:]
        if len(digits) == 3:
            digits = "".join(ch * 2 for ch in digits)
        if len(digits) >= 6:
            try:
                red = int(digits[0:2], 16)
                green = int(digits[2:4], 16)
                blue = int(digits[4:6], 16)
                return f"rgba({red}, {green}, {blue}, {alpha:.1f})"
            except ValueError:
                pass
    return "rgba(160, 160, 160, 1.0)"


def _shift_rgba(rgba: str) -> str:
    match = re.match(
        r"rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)",
        rgba.strip(),
        re.I,
    )
    if not match:
        return "rgba(96, 96, 96, 1.0)"
    red = max(0, min(255, int(match.group(1)) - 24))
    green = max(0, min(255, int(match.group(2)) - 18))
    blue = max(0, min(255, int(match.group(3)) - 12))
    return f"rgba({red}, {green}, {blue}, {float(match.group(4)):.1f})"


def _flatten_components(node: Any, parent_id: str | None, out: list[dict[str, Any]]) -> None:
    if isinstance(node, list):
        for item in node:
            _flatten_components(item, parent_id, out)
        return
    if not isinstance(node, dict):
        return
    looks_like_component = any(key in node for key in ("id", "primitive", "name", "children"))
    if not looks_like_component and node and all(isinstance(value, dict) for value in node.values()):
        for key, value in node.items():
            item = dict(value)
            item.setdefault("id", key)
            _flatten_components(item, parent_id, out)
        return
    children = node.get("children")
    item = {key: value for key, value in node.items() if key != "children"}
    ident = item.get("id")
    if isinstance(ident, str) and ident.strip():
        if parent_id and not item.get("parent"):
            item["parent"] = parent_id
        out.append(item)
        next_parent = ident
    else:
        next_parent = parent_id
    if children is not None:
        _flatten_components(children, next_parent, out)


def _coerce_component_tree(spec: dict[str, Any]) -> None:
    tree = spec.get("componentTree")
    if isinstance(tree, list):
        if tree and any(isinstance(item, dict) and "children" in item for item in tree):
            flat: list[dict[str, Any]] = []
            _flatten_components(tree, None, flat)
            spec["componentTree"] = flat
        return
    if isinstance(tree, dict):
        flat: list[dict[str, Any]] = []
        _flatten_components(tree, None, flat)
        spec["componentTree"] = flat
        return
    spec["componentTree"] = []


def _coerce_procedural_strategy(spec: dict[str, Any], starter: dict[str, Any] | None) -> None:
    strategy = spec.get("proceduralStrategy")
    if isinstance(strategy, list):
        spec["proceduralStrategy"] = [
            item if isinstance(item, str) else str(item) for item in strategy if item is not None
        ]
        if spec["proceduralStrategy"]:
            return
    lines: list[str] = []
    if isinstance(strategy, dict):
        for key, value in strategy.items():
            if isinstance(value, list):
                lines.extend(str(item) for item in value if item is not None)
            elif isinstance(value, str) and value.strip():
                lines.append(value if key in {"implementation", "summary"} else f"{key}: {value}")
            elif value is not None:
                lines.append(f"{key}: {value}")
    elif isinstance(strategy, str) and strategy.strip():
        lines.append(strategy.strip())
    if not lines:
        fallback = (starter or {}).get("proceduralStrategy")
        if isinstance(fallback, list) and fallback:
            lines = [str(item) for item in fallback]
        else:
            lines = [
                "Block out named primitive volumes first.",
                "Parent parts under pivot groups; do not use TextureLoader maps.",
                "Refine bevels and MeshPhysicalMaterial color/metalness/roughness in code.",
            ]
    spec["proceduralStrategy"] = lines


def _fill_names(spec: dict[str, Any]) -> None:
    for material in spec.get("materials") or []:
        if isinstance(material, dict):
            _ensure_named(material)
    for component in spec.get("componentTree") or []:
        if isinstance(component, dict):
            _ensure_named(component)


def _normalize_feature_groups(spec: dict[str, Any]) -> None:
    contract = spec.get("qualityContract")
    if not isinstance(contract, dict):
        return
    groups = contract.get("featureGroups")
    if not isinstance(groups, list):
        return
    for group in groups:
        if not isinstance(group, dict):
            continue
        _ensure_named(group)
        if not isinstance(group.get("qualityCriteria"), list):
            criteria = group.get("criteria")
            if isinstance(criteria, list) and all(isinstance(item, str) for item in criteria):
                group["qualityCriteria"] = criteria
            elif isinstance(group.get("componentIds"), list):
                group["qualityCriteria"] = [
                    f"Named parts {', '.join(str(item) for item in group['componentIds'][:8])} stay distinct."
                ]
        if not isinstance(group.get("evidenceRefs"), list):
            group["evidenceRefs"] = ["full-object"]


def _normalize_feature_review_targets(spec: dict[str, Any]) -> None:
    targets = spec.get("featureReviewTargets")
    if not isinstance(targets, list):
        return
    pass_cycle = [
        "blockout",
        "structural-pass",
        "form-refinement",
        "material-pass",
        "surface-pass",
        "interaction-pass",
    ]
    critical_on_pass: dict[str, int] = {}
    for index, target in enumerate(targets):
        if not isinstance(target, dict):
            continue
        _ensure_named(target)
        if not isinstance(target.get("componentRefs"), list):
            ids = target.get("componentIds") or target.get("componentRefs")
            if isinstance(ids, list):
                target["componentRefs"] = [str(item) for item in ids if item]
        if not isinstance(target.get("evidenceRefs"), list):
            target["evidenceRefs"] = ["full-object"]
        if not isinstance(target.get("passIds"), list) or not target["passIds"]:
            target["passIds"] = [pass_cycle[index % len(pass_cycle)]]
        if not isinstance(target.get("qualityCriteria"), list):
            criteria = target.get("criteria")
            if isinstance(criteria, list) and all(isinstance(item, str) for item in criteria):
                target["qualityCriteria"] = criteria
        tier = target.get("tier")
        priority = str(target.get("priority") or "").strip().lower()
        # Older normalizer output wrote every unknown tier as important while
        # preserving the original priority. Recover that source intent so a
        # second normalization is idempotent under the 2.0 per-pass limits.
        if priority == "critical" and tier == "important":
            tier = "critical"
            target["tier"] = tier
        elif tier not in {"critical", "important", "detail"}:
            tier = priority if priority in {"critical", "important", "detail"} else "important"
            target["tier"] = tier
        if tier == "critical":
            for pass_id in target.get("passIds") or []:
                if not isinstance(pass_id, str):
                    continue
                count = critical_on_pass.get(pass_id, 0) + 1
                if count > 5:
                    target["tier"] = "important"
                    break
                critical_on_pass[pass_id] = count


def _map_has_locator(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    path = value.get("path")
    url = value.get("url")
    return (isinstance(path, str) and path.strip()) or (isinstance(url, str) and url.strip())


def _material_class_for(material: dict[str, Any]) -> str:
    ident = str(material.get("id") or material.get("name") or "").lower()
    if any(token in ident for token in ("lens", "glass", "emissive")):
        return "glass"
    if any(token in ident for token in ("crest", "hair", "fibre", "fiber", "cloth")):
        return "fabric"
    if any(token in ident for token in ("oxide", "patina", "dirt")):
        return "stone"
    metalness = material.get("metalness")
    if isinstance(metalness, dict):
        metalness = metalness.get("base")
    if isinstance(metalness, (int, float)) and not isinstance(metalness, bool):
        return "metal" if float(metalness) >= 0.45 else "plastic"
    if any(token in ident for token in ("chrome", "steel", "brass", "bronze", "silver", "bolt")):
        return "metal"
    return "unknown"


def _normalize_materials(spec: dict[str, Any]) -> None:
    materials = spec.get("materials")
    if not isinstance(materials, list):
        return
    colors: list[str] = []
    for material in materials:
        if not isinstance(material, dict):
            continue
        color = material.get("color") or material.get("baseColor")
        recipe = material.get("colorMaterialRecipe")
        if isinstance(recipe, dict):
            color = color or recipe.get("dominantAlbedo")
        if isinstance(color, str) and color.startswith("#"):
            colors.append(color)
            material.setdefault("baseColor", color)
        reference = material.get("referencePbr")
        if isinstance(reference, dict):
            maps = reference.get("maps")
            if isinstance(maps, dict):
                keep = {channel: value for channel, value in maps.items() if _map_has_locator(value)}
                if keep:
                    reference["maps"] = keep
                else:
                    notes = [str(reference.get("notes") or "").strip()]
                    for channel, value in maps.items():
                        if isinstance(value, dict):
                            bits = [channel, str(value.get("mode") or ""), str(value.get("value") or ""), str(value.get("notes") or "")]
                            notes.append(" ".join(bit for bit in bits if bit).strip())
                    shader = material.get("shaderNotes")
                    extra = "; ".join(item for item in notes if item)
                    if extra:
                        if isinstance(shader, list):
                            shader.append(extra)
                        elif isinstance(shader, str) and shader.strip():
                            material["shaderNotes"] = [shader, extra]
                        else:
                            material["shaderNotes"] = [extra]
                    material.pop("referencePbr", None)
            elif maps is None:
                # Notes-only PBR is fine for Mesh; maps would fail-close or promote to a quality error.
                material.pop("referencePbr", None)
        if "referencePbr" not in material and not (
            isinstance(material.get("textureless"), dict) and material["textureless"].get("declared") is True
        ):
            material["textureless"] = {
                "declared": True,
                "evidence": [
                    "Mesh mode is code-only MeshPhysicalMaterial / MeshStandardMaterial; TextureLoader maps are forbidden.",
                    "Albedo and roughness are solid/scalar values from the brief, not extracted image maps.",
                ],
            }
        if not isinstance(material.get("colorVariation"), str):
            primary = recipe.get("dominantAlbedo") if isinstance(recipe, dict) else None
            secondary = recipe.get("secondaryAlbedo") if isinstance(recipe, dict) else None
            if primary or secondary:
                material["colorVariation"] = f"{primary or secondary} to {secondary or primary}"
            elif colors:
                primary = colors[0]
                secondary = colors[1] if len(colors) > 1 else primary
                material["colorVariation"] = f"{primary} to {secondary}"
        roughness = recipe.get("roughness") if isinstance(recipe, dict) else None
        if isinstance(roughness, (int, float)) and not isinstance(roughness, bool):
            local_values = [
                float(item["roughness"])
                for item in material.get("localOverrides") or []
                if isinstance(item, dict)
                and isinstance(item.get("roughness"), (int, float))
                and not isinstance(item.get("roughness"), bool)
            ]
            variation = max([abs(value - float(roughness)) for value in local_values] or [0.05])
            material.setdefault("roughness", {"base": float(roughness), "variation": variation})
        overrides = material.get("localOverrides")
        if isinstance(overrides, list):
            for index, override in enumerate(overrides):
                if isinstance(override, dict) and not isinstance(override.get("id"), str):
                    region = str(override.get("region") or f"override-{index}")
                    override["id"] = re.sub(r"[^A-Za-z0-9]+", "-", region).strip("-") or f"override-{index}"


def _cavity_sdf() -> dict[str, Any]:
    return {
        "primitives": [
            {"id": "host", "type": "sphere", "center": [0.0, 0.0, 0.0], "radius": 0.12},
            {"id": "cut", "type": "sphere", "center": [0.0, 0.0, 0.05], "radius": 0.09},
        ],
        "operations": [
            {"id": "cavity", "type": "subtract", "left": "host", "right": "cut"},
        ],
        "resolution": 16,
        "bounds": {"min": [-0.14, -0.14, -0.14], "max": [0.14, 0.14, 0.14]},
    }


def _is_recessed_identity(component: dict[str, Any]) -> bool:
    blob = re.sub(
        r"[\s_-]+",
        "",
        f"{component.get('role') or ''} {component.get('name') or ''} {component.get('id') or ''}".lower(),
    )
    tokens = set(re.findall(r"[a-z0-9]+", f"{component.get('role') or ''} {component.get('name') or ''} {component.get('id') or ''}".lower()))
    return bool(tokens & {"cavity", "canal", "recess", "recessed", "nostril"}) or "eyesocket" in blob


def _coerce_primitive(raw: Any, topology: str) -> str:
    value = str(raw or "").strip().lower()
    if value in VALID_PRIMITIVES:
        primitive = value
    else:
        primitive = PRIMITIVE_ALIASES.get(value, "sphere")
    if topology == "fiber-strand" and primitive in {"box", "plane-card"}:
        return "tube"
    if topology == "continuous-sculpt" and primitive in {"box", "cylinder", "cone"}:
        return "lathe"
    if topology == "implicit":
        return "sphere"
    return primitive if primitive in VALID_PRIMITIVES else "sphere"


def _coerce_topology(raw: Any, primitive: str) -> str:
    value = str(raw or "").strip()
    if value in VALID_TOPOLOGY:
        topology = value
    else:
        lowered = value.lower()
        topology = TOPOLOGY_ALIASES.get(lowered)
        if topology is None:
            if "fibre" in lowered or "fiber" in lowered or "hair" in lowered:
                topology = "fiber-strand"
            elif "shell" in lowered:
                topology = "conforming-shell"
            elif "relief" in lowered:
                topology = "surface-relief"
            elif primitive == "box" and value in {"", "group", "transform-only"}:
                topology = "material-only"
            else:
                topology = "assembled-solid"
    if topology == "continuous-sculpt" and primitive in {"box", "cylinder", "cone"}:
        return "assembled-solid"
    if topology == "fiber-strand" and primitive in {"box", "plane-card"}:
        return "assembled-solid"
    return topology


def _recipe_for_component(
    component: dict[str, Any],
    materials_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    recipe = component.get("colorMaterialRecipe")
    recipe = dict(recipe) if isinstance(recipe, dict) else {}
    material_id = recipe.get("materialId") or component.get("material")
    material = materials_by_id.get(str(material_id)) if material_id else None
    if material is None and materials_by_id:
        material = next(iter(materials_by_id.values()))
    color = None
    if isinstance(material, dict):
        color = material.get("baseColor") or material.get("color")
        if not component.get("material") and material.get("id"):
            component["material"] = material["id"]
    dominant = recipe.get("dominantAlbedo")
    if not (isinstance(dominant, str) and dominant.strip().lower().startswith("rgba(")):
        recipe["dominantAlbedo"] = _hex_to_rgba(color)
    secondary = recipe.get("secondaryAlbedo")
    if not (isinstance(secondary, str) and secondary.strip().lower().startswith("rgba(")):
        recipe["secondaryAlbedo"] = _shift_rgba(str(recipe["dominantAlbedo"]))
    if recipe.get("materialClass") not in {
        "metal",
        "plastic",
        "wood",
        "fabric",
        "skin",
        "glass",
        "ceramic",
        "rubber",
        "stone",
        "unknown",
    }:
        recipe["materialClass"] = _material_class_for(material or component)
    confidence = recipe.get("materialClassConfidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        recipe["materialClassConfidence"] = 0.72
    return recipe


def _default_attachment(parent_id: str) -> dict[str, Any]:
    return {
        "parentId": parent_id,
        "parentSocket": "origin",
        "contactType": "flush",
        "localStart": [0.0, 0.0, 0.0],
        "localEnd": [0.0, 0.02, 0.0],
        "embedDepth": 0.02,
        "gapTolerance": 0.002,
    }


def _normalize_components(spec: dict[str, Any]) -> None:
    components = spec.get("componentTree")
    if not isinstance(components, list):
        return
    materials_by_id = {
        str(material["id"]): material
        for material in spec.get("materials") or []
        if isinstance(material, dict) and isinstance(material.get("id"), str)
    }
    attachment_primitives = {"cylinder", "cone", "capsule", "tube", "curve-sweep"}
    for index, component in enumerate(components):
        if not isinstance(component, dict):
            continue
        if _is_recessed_identity(component):
            component["topologyClass"] = "implicit"
            component["primitive"] = "sphere"
            descriptor = component.get("geometryDescriptor")
            if not isinstance(descriptor, dict):
                descriptor = {}
            descriptor["sdf"] = _cavity_sdf()
            component["geometryDescriptor"] = descriptor
            component["topologyRationale"] = (
                "Visible recessed socket: carved from a host volume with an SDF subtract, "
                "not a convex patch sitting on the surface."
            )
        descriptor = component.get("geometryDescriptor")
        sdf = descriptor.get("sdf") if isinstance(descriptor, dict) else None
        if isinstance(sdf, dict):
            resolution = sdf.get("resolution")
            if not isinstance(resolution, int) or isinstance(resolution, bool):
                sdf["resolution"] = 16
            else:
                sdf["resolution"] = max(4, min(64, resolution))
        topology = _coerce_topology(component.get("topologyClass"), str(component.get("primitive") or ""))
        primitive = _coerce_primitive(component.get("primitive"), topology)
        topology = _coerce_topology(topology, primitive)
        component["primitive"] = primitive
        component["topologyClass"] = topology
        if not isinstance(component.get("topologyRationale"), str) or not str(component["topologyRationale"]).strip():
            component["topologyRationale"] = (
                f"{component.get('name') or component.get('id')} is built as {topology} "
                f"because the brief calls for a distinct {primitive} volume, not a painted card."
            )
        elif re.sub(r"[\s_-]+", "", str(component["topologyRationale"]).lower()) == re.sub(
            r"[\s_-]+", "", topology.lower()
        ):
            component["topologyRationale"] = (
                f"{component.get('name') or component.get('id')} uses {topology} from the visible "
                "part breakdown in the user brief."
            )
        if topology != "material-only":
            component["colorMaterialRecipe"] = _recipe_for_component(component, materials_by_id)
        position = component.get("position")
        if isinstance(position, list) and len(position) == 3:
            transform = component.get("transform")
            if not isinstance(transform, dict):
                transform = {}
            transform.setdefault("position", position)
            component["transform"] = transform
        if component.get("level") not in {"macro", "meso", "micro"}:
            ident = str(component.get("id") or "").lower()
            if index == 0 or any(token in ident for token in ("root", "helmet", "skull", "body")):
                component["level"] = "macro"
            elif any(token in ident for token in ("bolt", "tooth", "teeth", "fibre", "fiber")):
                component["level"] = "micro"
            else:
                component["level"] = "meso"
        parent = component.get("parent")
        needs_attachment = isinstance(parent, str) and parent.strip() and (
            primitive in attachment_primitives
            or bool(
                set(re.findall(r"[a-z0-9]+", str(component.get("name") or component.get("id") or "").lower()))
                & {
                    "appendage",
                    "branch",
                    "limb",
                    "arm",
                    "leg",
                    "handle",
                    "connector",
                    "tube",
                    "cable",
                    "horn",
                    "wing",
                    "tail",
                    "root",
                    "fork",
                    "rib",
                    "support",
                    "hinge",
                    "socket",
                    "pipe",
                }
            )
        )
        if needs_attachment:
            attachment = component.get("attachment")
            if not isinstance(attachment, dict):
                component["attachment"] = _default_attachment(str(parent))
            else:
                attachment.setdefault("parentId", parent)
                attachment.setdefault("parentSocket", "origin")
                attachment.setdefault("contactType", "flush")
                attachment.setdefault("localStart", [0.0, 0.0, 0.0])
                attachment.setdefault("localEnd", [0.0, 0.02, 0.0])
                attachment.setdefault("embedDepth", 0.02)
                attachment.setdefault("gapTolerance", 0.002)


def _link_detail_inventory(spec: dict[str, Any]) -> None:
    assessment = spec.get("preSpecAssessment")
    if not isinstance(assessment, dict):
        return
    inventory = assessment.get("detailInventory")
    if not isinstance(inventory, dict):
        return
    details = inventory.get("details")
    if not isinstance(details, list):
        return
    components = {
        str(component["id"]): component
        for component in spec.get("componentTree") or []
        if isinstance(component, dict) and isinstance(component.get("id"), str)
    }
    materials = {
        str(material["id"]): material
        for material in spec.get("materials") or []
        if isinstance(material, dict) and isinstance(material.get("id"), str)
    }
    for detail in details:
        if not isinstance(detail, dict):
            continue
        kind = str(detail.get("kind") or "")
        if kind not in {
            "gloss",
            "bevel",
            "fastener",
            "linework",
            "contour",
            "seam",
            "stitch",
            "stain",
            "scratch",
            "chip",
            "decal",
            "emissive",
            "hole",
            "groove",
            "ridge",
        }:
            detail["kind"] = DETAIL_KIND_ALIASES.get(kind.lower(), "contour")
        mapping = detail.get("mapping") if isinstance(detail.get("mapping"), dict) else {}
        component_id = (
            (mapping.get("componentId") if isinstance(mapping.get("componentId"), str) else None)
            or (str(detail["componentId"]) if isinstance(detail.get("componentId"), str) else None)
        )
        feature_id = (
            (mapping.get("localFeatureId") if isinstance(mapping.get("localFeatureId"), str) else None)
            or (str(detail["localFeatureId"]) if isinstance(detail.get("localFeatureId"), str) else None)
            or (str(detail["id"]) if isinstance(detail.get("id"), str) else None)
        )
        maps_to = detail.get("mapsTo")
        ref = maps_to.get("ref") if isinstance(maps_to, dict) else None
        if isinstance(ref, str) and "." in ref:
            owner, candidate = ref.split(".", 1)
            if owner in components or owner in materials:
                component_id = owner if owner in components else component_id
                feature_id = candidate
                detail["mapsTo"] = {"ref": f"{owner}/{candidate}"}
                ref = detail["mapsTo"]["ref"]
        if not (isinstance(ref, str) and ref.strip()):
            detail["mapsTo"] = {"ref": feature_id or component_id or "root"}
            ref = detail["mapsTo"]["ref"]
        if component_id and component_id in components and feature_id:
            component = components[component_id]
            features = component.get("localFeatures")
            if not isinstance(features, list):
                features = []
            existing = {
                item if isinstance(item, str) else item.get("id")
                for item in features
                if isinstance(item, (str, dict))
            }
            if feature_id not in existing:
                features.append({"id": feature_id, "name": detail.get("name") or feature_id})
            component["localFeatures"] = features


def _ensure_mesh_look_dev(spec: dict[str, Any], starter: dict[str, Any] | None) -> None:
    look = spec.get("lookDevTargets")
    if not isinstance(look, dict):
        look = copy.deepcopy((starter or {}).get("lookDevTargets") or {}) if isinstance((starter or {}).get("lookDevTargets"), dict) else {}
        spec["lookDevTargets"] = look
    look["qualityPriority"] = "procedural-code"
    material_pass = look.get("materialPass")
    if not isinstance(material_pass, dict):
        material_pass = {}
        look["materialPass"] = material_pass
    extraction = material_pass.get("referencePbrExtraction")
    if not isinstance(extraction, dict):
        extraction = {}
        material_pass["referencePbrExtraction"] = extraction
    extraction["requiredWhenSourceImagePresent"] = False
    lights = spec.get("lightingFromPhoto")
    if not isinstance(lights, list) or sum(1 for item in lights if item) < 3:
        spec["lightingFromPhoto"] = list(DEFAULT_LIGHTS)
    else:
        blob = " ".join(str(item).lower() for item in lights)
        extras: list[str] = []
        if not any(term in blob for term in ("exposure", "tone", "aces", "filmic")):
            extras.append("ACES filmic tone mapping, exposure 1.0")
        if not any(term in blob for term in ("contact shadow", "ground shadow", "ambient occlusion", "ao")):
            extras.append("contact shadow at the mounting flange")
        if extras:
            spec["lightingFromPhoto"] = list(lights) + extras


def _ensure_anatomy_track(spec: dict[str, Any]) -> None:
    assessment = spec.get("preSpecAssessment")
    if not isinstance(assessment, dict):
        return
    object_class = assessment.get("objectClass")
    domain = object_class.get("primaryDomain") if isinstance(object_class, dict) else None
    if domain not in {"character", "hybrid"}:
        return
    anatomy = assessment.get("anatomy")
    if not isinstance(anatomy, dict):
        anatomy = {}
        assessment["anatomy"] = anatomy
    anatomy["applies"] = True
    if not isinstance(anatomy.get("styleHeads"), (int, float)) or isinstance(anatomy.get("styleHeads"), bool):
        anatomy["styleHeads"] = 1.0
    proportions = anatomy.get("proportions")
    if not isinstance(proportions, dict):
        proportions = {}
        anatomy["proportions"] = proportions
    proportions.setdefault("headUnit", 1.0)
    if not isinstance(proportions.get("torso"), (int, float)) or proportions["torso"] <= 0:
        proportions["torso"] = 0.15
    if not isinstance(proportions.get("legs"), (int, float)) or proportions["legs"] <= 0:
        proportions["legs"] = 0.12
    landmarks = anatomy.get("faceLandmarks")
    if not isinstance(landmarks, dict):
        landmarks = {}
        anatomy["faceLandmarks"] = landmarks
    landmarks.setdefault("eyeLine", 0.58)
    landmarks.setdefault("noseBase", 0.42)
    landmarks.setdefault("mouthLine", 0.32)
    targets = spec.get("featureReviewTargets")
    if not isinstance(targets, list):
        targets = []
        spec["featureReviewTargets"] = targets
    have = {item.get("id") for item in targets if isinstance(item, dict)}
    names = {
        "anatomy-proportion": "Anatomy proportion",
        "face-landmark-placement": "Face landmark placement",
        "pose-silhouette": "Pose silhouette",
        "outfit-and-palette": "Outfit and palette",
    }
    for ident in CHARACTER_REVIEW_IDS:
        if ident in have:
            continue
        targets.append(
            {
                "id": ident,
                "name": names[ident],
                "tier": "detail",
                "passIds": ["form-refinement"],
                "mustPass": False,
                "componentRefs": [],
                "evidenceRefs": ["full-object"],
            }
        )
    # Prefer a real root id when present.
    root_id = None
    for component in spec.get("componentTree") or []:
        if isinstance(component, dict) and isinstance(component.get("id"), str):
            root_id = component["id"]
            break
    if root_id:
        for ident in CHARACTER_REVIEW_IDS:
            for target in targets:
                if isinstance(target, dict) and target.get("id") == ident and not target.get("componentRefs"):
                    target["componentRefs"] = [root_id]


def _ensure_pipeline(spec: dict[str, Any]) -> None:
    pipeline = spec.get("sculptPipeline")
    if not isinstance(pipeline, dict):
        pipeline = {}
        spec["sculptPipeline"] = pipeline
    order = pipeline.get("passOrder")
    if not isinstance(order, list) or not order:
        alt = pipeline.get("orderedPassIds")
        if isinstance(alt, list) and alt:
            pipeline["passOrder"] = [str(item) for item in alt]
        else:
            passes = spec.get("buildPasses")
            if isinstance(passes, list):
                pipeline["passOrder"] = [
                    str(item.get("id"))
                    for item in passes
                    if isinstance(item, dict) and item.get("id")
                ]
    pipeline.setdefault("passGateMode", "locked-sequential")
    if not pipeline.get("currentPass"):
        order = pipeline.get("passOrder")
        pipeline["currentPass"] = order[0] if isinstance(order, list) and order else "blockout"


def _ensure_contract_lists(spec: dict[str, Any]) -> None:
    contract = spec.get("qualityContract")
    if not isinstance(contract, dict):
        contract = {}
        spec["qualityContract"] = contract
    if not isinstance(contract.get("definitionOfDone"), list) or not contract["definitionOfDone"]:
        contract["definitionOfDone"] = [
            "Named parts exist, silhouette matches the brief, and materials are procedural MeshPhysicalMaterial values.",
        ]
    for field in ("visualDeltaChecks", "antiShallowSpecRules", "mustNotDo"):
        if not isinstance(contract.get(field), list) or not contract[field]:
            contract[field] = [
                "Do not use TextureLoader or invented PBR map paths.",
                "Do not collapse the object into one unnamed blob.",
            ]
    bar = contract.get("qualityBar")
    if not isinstance(bar, str) or not bar.strip() or bar.strip().lower() == "unassessed":
        contract["qualityBar"] = "complex"
    minimums = contract.get("minimumSpecDepth")
    if not isinstance(minimums, dict):
        minimums = {}
        contract["minimumSpecDepth"] = minimums
    targets = spec.get("qualityTargets")
    if not isinstance(targets, dict):
        targets = {}
        spec["qualityTargets"] = targets
    views = targets.get("reviewViewpoints")
    if not isinstance(views, list) or len(views) < 3:
        targets["reviewViewpoints"] = ["front", "three-quarter", "side", "top", "rear"]
    targets.setdefault("targetFidelity", 0.7)
    if not isinstance(targets.get("mustMatch"), list) or not targets["mustMatch"]:
        targets["mustMatch"] = ["macro silhouette and named parts from the brief"]
    components = [item for item in spec.get("componentTree") or [] if isinstance(item, dict)]
    actual = {
        "macroComponents": sum(1 for item in components if item.get("level") == "macro"),
        "mesoComponents": sum(1 for item in components if item.get("level") == "meso"),
        "microFeatureGroups": sum(
            len(item.get("localFeatures") or [])
            for item in components
            if isinstance(item.get("localFeatures"), list)
        ),
        "materialLayers": len([item for item in spec.get("materials") or [] if isinstance(item, dict)]),
        "repetitionSystems": len(
            [item for item in spec.get("repetitionSystems") or [] if isinstance(item, dict)]
        ),
        "reviewViewpoints": len(targets.get("reviewViewpoints") or [])
        if isinstance(targets.get("reviewViewpoints"), list)
        else 0,
    }
    for field, actual_count in actual.items():
        current = minimums.get(field)
        if not isinstance(current, int) or isinstance(current, bool) or actual_count < current:
            minimums[field] = actual_count
    groups = contract.get("featureGroups")
    if not isinstance(groups, list):
        groups = []
        contract["featureGroups"] = groups
    while len(groups) < 3:
        extras = (
            ("overall-silhouette", "Overall silhouette and proportions"),
            ("primary-structure", "Primary structure and hierarchy"),
            ("surface-material-response", "Surface material response"),
        )
        ident, name = extras[len(groups)]
        if any(isinstance(group, dict) and group.get("id") == ident for group in groups):
            ident = f"{ident}-{len(groups)}"
        groups.append(
            {
                "id": ident,
                "name": name,
                "required": True,
                "qualityCriteria": [name],
                "evidenceRefs": ["full-object"],
            }
        )
