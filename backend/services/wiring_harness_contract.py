"""Physical harness authoring metadata stays distinct from a 2D circuit diagram."""
from copy import deepcopy

COMPONENT_FIELDS = ('sourceFile','model_source','partIdentity','manufacturer','partNumber','revision','position3d','rotation3d','quaternion','dimensions','units','spatial','connectors','pins','pin_positions','electrical','evidence','documentation','docs','verification')
WIRE_FIELDS = ('route3d','minBendRadiusMm','gauge','awg','conductorAreaMm2','wireType','insulation','diameterMm','outerDiameterMm','connectors','lengthMm','cutLengthMm','maxCurrentA','loadCurrentA','voltageDropV','units','documentation','sources','verification')
RULES = '''
3D STEP HARNESS SUPPORT:
Preserve existing physical pin positions, placement, CAD sourceFile, wire routes and wire specifications unless the requested edit changes them. Manufacturer STEP supplies geometry, not a verified electrical pinout. Use exact linked manufacturer CAD filenames and sourced terminal labels; do not invent a sourceFile or measured terminal coordinates.
Components may include sourceFile (project-relative STEP/GLB), position3d [x,y,z] in mm, rotation3d (Euler radians), and pins [{id,label,position3d:[x,y,z],units:"mm",verification:"user-placed"}]. Pin positions are in the component local frame, not schematic pixels. Do not treat 2D pin_layout coordinates as measurements.
When the request asks for a physical harness and actual placements/terminal coordinates are provided, generate route3d:{units:"mm",points:[[x,y,z],...]} interior waypoints in assembly coordinates, excluding endpoints (the viewer connects the two actual pins). Use simple serviceable paths with minBendRadiusMm only from the wire specification or an explicitly labeled assumption. The viewer rounds corners and flags radii that cannot fit. CAD coordinates use a Y-up wiring frame; respect supplied component rotations. Keep each wire's label, exact from/to pins, gauge, connectors, docs and verification. Never mark packaging clearance, cut length, or electrical suitability verified from an illustrative route. Missing geometry and wire specifications become targeted followup_questions; supported electrical connections still belong in the schematic.
'''

def fields(value, names):
    return {k:value[k] for k in names if k in value}

def preserve(current, schematic):
    old_components={c.get('id'):c for c in (current or {}).get('components',[])}
    unchanged=set()
    for component in schematic.get('components',[]):
        old=old_components.get(component.get('id'))
        if not old or old.get('type')!=component.get('type') or old.get('source_url')!=component.get('source_url'):continue
        unchanged.add(component['id'])
        for key in COMPONENT_FIELDS:
            if key in old and key not in component:component[key]=deepcopy(old[key])
    old_wires={w.get('id'):w for w in (current or {}).get('wires',[])}
    for wire in schematic.get('wires',[]):
        old=old_wires.get(wire.get('id'))
        if not old or old.get('from')!=wire.get('from') or old.get('to')!=wire.get('to'):continue
        if any((wire.get(end) or {}).get('componentId') not in unchanged for end in ('from','to')):continue
        for key in WIRE_FIELDS:
            if key in old and key not in wire:wire[key]=deepcopy(old[key])
    return schematic
