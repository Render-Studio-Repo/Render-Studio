"""Keep the requested product scope intact through Improve and CAD authoring."""

CAD_ASSEMBLY_SCOPE_RULES = """Assembly scope:
- Preserve every requested material, component, @reference, and manufacturing process.
  A steel frame stays steel. FDM settings apply only to parts intended for printing;
  selecting a printer skill does not turn the whole product into a printed-parts kit.
- A request for a robot/base/machine with all parts and electronics means the complete
  assembled product: frame, panels, battery, wheels, motors, mounts, electronics,
  wiring and specified purchased hardware. A BOM alone does not represent geometry.
- "Few parts" means simplify the custom construction, not omit functional components.
  Keep purchased modules intact. Do not impose an arbitrary target body count.
- Keep the primary model in its assembled pose with components at their mating locations.
  An exploded layout or print-bed layout is a separate, explicitly requested view; it
  must never replace the assembled model or move its authored body coordinates.
- Use verified vendor CAD/dimensions when available. Otherwise show clearly labeled
  provisional component envelopes and retain the unresolved dimensions as questions.
  Do not invent exact vendor mounting patterns or claim a fabrication-ready design.
- Only limit the output to printable/custom parts when the user explicitly requests
  that subset. Preserve selected models and unaffected bodies during edits.
"""

VIBECAD_RESULT_RULES = """VibeCAD output contract:
`result` is the ONLY published geometry dictionary. Include ALL requested physical
components in assembled coordinates, regardless of material or source: metal,
printed parts, electronics, wheels/motors, battery, wiring and placed catalog hardware.
Each key is a meaningful named single solid. Use separate named leaf solids for a
purchased multi-solid module; keep its assembly proportions and placement unchanged.
All result keys must match expected_outputs in order. Large results are exported
as one assembly; the preview limit must not change which components are included.
Do not hide required geometry in auxiliary assembly_result/assembly variables or
claim the host will export an unrecognized scene. `result = printed` is appropriate
only for an explicitly requested printed-parts-only deliverable.
"""


def validate_assembly_manifest(manifest):
    """Reject an explicit request for an export channel the host cannot publish."""
    assembly = manifest.get("assembly") if isinstance(manifest, dict) else None
    if isinstance(assembly, dict) and assembly.get("host_support_required"):
        raise ValueError(
            "Required assembly is outside result. The host only publishes result; "
            "include the complete requested assembly there and update expected_outputs. "
            "Auxiliary assembly scenes are not an export channel."
        )
