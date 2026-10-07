"""Export promises are explicit: metadata transport is not native mate recreation."""
from __future__ import annotations
FUSION_TYPES={'fixed','revolute','continuous','slider','prismatic','cylindrical','ball'}

def export_compatibility(rows, native=None):
    unsupported=[]
    for row in rows:
        reason=None
        if row['type'] not in FUSION_TYPES: reason='No Fusion adapter for this constraint or coupling'
        elif row.get('child_anchor',row['anchor']) != row['anchor'] or row.get('child_axis',row['axis']) != row['axis']: reason='Distinct connector frames require native mate positioning'
        elif row.get('parent_rotation') or row.get('child_rotation'): reason='Explicit connector rotations require native mate positioning'
        elif row.get('suppressed'): reason='Suppressed joint retained as data only'
        if reason: unsupported.append({'id':row['id'],'type':row['type'],'reason':reason})
    return {
        'geometry_format':'STEP B-rep','portable_joint_definitions':True,
        'standard_step_import_creates_native_joints':False,
        'freecad':{'status':'native_assembly' if native and native.get('ok') else 'not_verified','details':native or {}},
        'fusion':{'status':'adapter_required' if not unsupported else 'blocked_unsupported_constraints','supported_count':len(rows)-len(unsupported),'unsupported':unsupported,'verified_in_target':False},
        'onshape':{'status':'manual_mates_required','verified_in_target':False},
        'solidworks':{'status':'manual_mates_required','verified_in_target':False},
    }
