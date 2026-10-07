"""Mesh ObjectSculptSpec coercion so Astra JSON can pass img2threejs --strict-quality."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

from backend.services.mesh_sculpt_spec import normalize_mesh_sculpt_spec

FORGE_SPEC = Path(__file__).resolve().parents[1] / "skills" / "img2threejs" / "forge"
REAL_ASTRA_SPEC = (
    Path(__file__).resolve().parents[2]
    / "projects"
    / "c1383314"
    / ".img2threejs"
    / "object-sculpt-spec.json"
)


def _validate_strict(spec: dict) -> tuple[list[str], list[str]]:
    sys.path.insert(0, str(FORGE_SPEC / "stage2_spec"))
    sys.path.insert(0, str(FORGE_SPEC / "_shared"))
    sys.path.insert(0, str(FORGE_SPEC / "stage3_build"))
    from validate_sculpt_spec import validate_spec  # noqa: WPS433

    errors, warnings = validate_spec(spec)
    strict = list(errors)
    strict.extend(
        f"strict quality failure: {warning.removeprefix('quality: ').strip()}"
        for warning in warnings
        if warning.startswith("quality:")
    )
    return strict, warnings


def _astra_shaped_spec() -> dict:
    return {
        "targetName": "Terminator Spartan skull",
        "suitability": "conditional",
        "schemaVersion": "2.1",
        "coordinateFrame": {"up": "+Y"},
        "silhouette": {"primaryRead": "helmeted mechanical skull"},
        "sourceImage": "",
        "preSpecAssessment": {
            "objectClass": {
                "primaryType": "mechanical skull",
                "primaryDomain": "object",
                "formLanguage": ["hard-surface"],
                "structureKind": ["assembly"],
                "motionPotential": ["jaw hinge"],
                "materialFamilies": ["chrome steel"],
            },
            "complexity": {
                "tier": "moderate",
                "scores": {"silhouetteComplexity": 2},
                "estimatedCounts": {"macroComponents": 2},
                "reasoning": ["Named parts from the brief."],
            },
            "specDepthDecision": {
                "requiredDepth": "moderate",
                "minimumComponentLevels": ["macro", "meso"],
                "needsRepetitionSystems": False,
                "needsMaterialLocalOverrides": True,
                "needsMultipleReviewViews": True,
                "needsActionReadyHierarchy": True,
            },
            "unknownsToResolveBeforeImplementation": [],
            "detailInventory": {
                "targetMinDetails": 1,
                "details": [
                    {
                        "id": "d01",
                        "kind": "geometry",
                        "name": "Cranial vault",
                        "componentId": "SkullDome",
                        "localFeatureId": "cranial-vault",
                    }
                ],
            },
        },
        "qualityContract": {
            "qualityBar": "complex",
            "featureGroups": [
                {"id": "mechanical-face", "tier": "critical", "componentIds": ["SkullDome"]},
            ],
        },
        "featureReviewTargets": [
            {"id": "review-face", "tier": "critical", "componentIds": ["SkullDome"], "criteria": ["Readable skull"]},
        ],
        "componentTree": {
            "id": "WristMountRoot",
            "name": "WristMountRoot",
            "primitive": "group",
            "topologyClass": "transform-only",
            "children": [
                {
                    "id": "SkullDome",
                    "primitive": "custom",
                    "topologyClass": "closed-manifold",
                    "colorMaterialRecipe": {"materialId": "chrome"},
                    "position": [0, 1.1, 0],
                },
                {
                    "id": "DeepEyeSockets",
                    "primitive": "custom",
                    "topologyClass": "paired-thickened-cavity-shells",
                    "colorMaterialRecipe": {"materialId": "chrome"},
                },
            ],
        },
        "materials": [
            {
                "id": "chrome",
                "type": "MeshPhysicalMaterial",
                "color": "#d9dde2",
                "metalness": 1,
                "roughness": 0.18,
                "localOverrides": [{"region": "dull-wear", "materialId": "chrome"}],
                "referencePbr": {
                    "source": "user-brief",
                    "notes": "Polished chrome; no photograph.",
                    "maps": {
                        "albedo": {"mode": "solid", "value": "#d9dde2", "imageMap": False},
                        "roughness": {"mode": "scalar", "value": 0.18, "imageMap": False},
                        "normal": {"mode": "geometry", "imageMap": False},
                        "height": {"mode": "geometry", "imageMap": False},
                        "ao": {"mode": "geometry-and-lighting", "imageMap": False},
                    },
                },
            }
        ],
        "proceduralStrategy": {
            "implementation": "Code-only Three.js primitives.",
            "prohibitedResources": ["TextureLoader", "image maps"],
        },
        "buildPasses": [
            {"id": "blockout"},
            {"id": "structural-pass"},
            {"id": "form-refinement"},
            {"id": "material-pass"},
            {"id": "surface-pass"},
            {"id": "lighting-pass"},
            {"id": "interaction-pass"},
            {"id": "optimization-pass"},
        ],
        "sculptPipeline": {
            "orderedPassIds": [
                "blockout",
                "structural-pass",
                "form-refinement",
                "material-pass",
                "surface-pass",
                "lighting-pass",
                "interaction-pass",
                "optimization-pass",
            ]
        },
    }


class MeshSculptSpecNormalizeTests(unittest.TestCase):
    def test_astra_shapes_become_strict_quality_lists_and_names(self) -> None:
        spec = normalize_mesh_sculpt_spec(_astra_shaped_spec())
        self.assertIsInstance(spec["componentTree"], list)
        self.assertGreaterEqual(len(spec["componentTree"]), 3)
        self.assertIsInstance(spec["proceduralStrategy"], list)
        self.assertTrue(all(isinstance(item, str) for item in spec["proceduralStrategy"]))
        group = spec["qualityContract"]["featureGroups"][0]
        self.assertTrue(group["name"])
        target = spec["featureReviewTargets"][0]
        self.assertTrue(target["name"])
        chrome = next(item for item in spec["materials"] if item["id"] == "chrome")
        self.assertNotIn("referencePbr", chrome)
        self.assertTrue(chrome["textureless"]["declared"])
        sockets = next(item for item in spec["componentTree"] if item["id"] == "DeepEyeSockets")
        self.assertEqual(sockets["topologyClass"], "implicit")
        self.assertEqual(sockets["geometryDescriptor"]["sdf"]["operations"][0]["type"], "subtract")
        errors, _warnings = _validate_strict(spec)
        self.assertFalse(errors, "\n".join(errors))

    def test_nested_tree_records_parent_ids(self) -> None:
        spec = normalize_mesh_sculpt_spec(_astra_shaped_spec())
        by_id = {item["id"]: item for item in spec["componentTree"]}
        self.assertEqual(by_id["SkullDome"]["parent"], "WristMountRoot")
        self.assertEqual(by_id["WristMountRoot"]["primitive"], "box")
        self.assertEqual(by_id["WristMountRoot"]["topologyClass"], "material-only")

    @unittest.skipUnless(REAL_ASTRA_SPEC.is_file(), "failed Mesh project spec is not on this machine")
    def test_trace_182a6492_spec_passes_after_normalize(self) -> None:
        raw = json.loads(REAL_ASTRA_SPEC.read_text(encoding="utf-8"))
        spec = normalize_mesh_sculpt_spec(raw)
        errors, _warnings = _validate_strict(spec)
        self.assertFalse(
            errors,
            "strict-quality still blocked the saved Astra spec:\n" + "\n".join(errors[:40]),
        )


if __name__ == "__main__":
    unittest.main()
