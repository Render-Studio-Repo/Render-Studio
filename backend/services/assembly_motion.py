"""Native FreeCAD assembly creation and non-destructive motion previews."""
from __future__ import annotations
import json
import hashlib
import math
import os
import re
import subprocess
import tempfile
import shutil
from pathlib import Path

NATIVE_TYPES = {'fixed':'Fixed','revolute':'Revolute','continuous':'Revolute','prismatic':'Slider','slider':'Slider','cylindrical':'Cylindrical','ball':'Ball','distance':'Distance','parallel':'Parallel','perpendicular':'Perpendicular','angle':'Angle','rack_pinion':'RackPinion','screw':'Screw','gears':'Gears','belt':'Belt'}
DRIVE_TYPES = {'revolute','continuous','prismatic','slider','cylindrical','ball'}

def joint_folder_file(root, stem, suffix='.joints.json'):
    root=Path(root).resolve()
    relative=Path(str(stem))
    if relative.is_absolute() or '..' in relative.parts: raise ValueError('Invalid model path')
    dest=root/'Joints'/relative.parent/(relative.name+suffix)
    if not dest.resolve().is_relative_to(root): raise ValueError('Invalid joint path')
    return dest

def browser_joints(root):
    root=Path(root);rows=[]
    from backend.services.engine_layout import ENGINE_FOLDERS
    files=list((root/'Joints').rglob('*.joints.json')) if (root/'Joints').is_dir() else []
    files+=list(root.glob('*.joints.json'))
    for folder in ENGINE_FOLDERS: files+=list((root/folder).glob('*.joints.json'))
    seen=set()
    for file in sorted(files):
        try:
            payload=json.loads(file.read_text())
            if not payload.get('joints') or payload.get('stem') in seen: continue
            seen.add(payload.get('stem'))
            rows.append({'name':file.relative_to(root).as_posix(),'display_name':Path(payload['stem']).name,'stem':payload['stem'],'model_filename':payload['stem']+('.step' if (root/(payload['stem']+'.step')).is_file() else '.stp'),'kind':'joints','format':'json','joint_count':len(payload['joints'])})
        except (ValueError,KeyError,OSError): continue
    return rows

def validate_values(rows, values):
    if not isinstance(values,dict): raise ValueError('Joint values must be an object')
    by_id={r['id']:r for r in rows}
    for name, value in values.items():
        row=by_id.get(name)
        if not row or row.get('suppressed') or row['type'] not in DRIVE_TYPES: raise ValueError('Unknown or non-drivable joint: '+name)
        if not isinstance(value,dict): raise ValueError('Use named angle/distance/yaw/pitch/roll values')
        allowed={'ball':{'yaw','pitch','roll'},'slider':{'distance'},'prismatic':{'distance'},'cylindrical':{'angle','distance'}}.get(row['type'],{'angle'})
        if set(value)-allowed: raise ValueError('Unsupported drive coordinate for '+name)
        for key,v in value.items():
            if not isinstance(v,(int,float)) or not math.isfinite(v): raise ValueError('Joint values must be finite numbers')
            limits=row.get('angular_limits' if key=='angle' else 'linear_limits')
            if not limits and row['type'] in ('revolute','slider','prismatic'): limits=row.get('limits')
            if limits and not limits[0]<=v<=limits[1]: raise ValueError('Joint value exceeds authored limits: '+name)
    return values

def solve_native(root, stem, rows, *, values=None, publish=False):
    from backend.services.freecad_engine import find_freecad_cmd
    root=Path(root).resolve()
    dest=joint_folder_file(root,stem,'.FCStd')
    step=root/(stem+'.step')
    if not step.is_file(): step=root/(stem+'.stp')
    if not step.is_file(): raise ValueError('A named STEP assembly is required for native joint solving')
    if not rows: raise ValueError('No joints authored for this model')
    cmd=find_freecad_cmd()
    if not cmd: raise ValueError('FreeCADCmd is not installed')
    validate_values(rows,values or {})
    with tempfile.TemporaryDirectory(prefix='render-joints-') as work:
        work=Path(work);req=work/'request.json';res=work/'result.json';out=work/'assembly.FCStd'
        snapshot=work/step.name
        shutil.copy2(step,snapshot)
        source_hash=hashlib.sha256(snapshot.read_bytes()).hexdigest()
        req.write_text(json.dumps({'step':str(snapshot),'joints':rows,'values':values or {},'output':str(out) if publish else None},allow_nan=False))
        worker=Path(__file__).with_name('freecad_assembly_worker.py')
        try:
            subprocess.run([str(cmd),str(worker),str(req),str(res)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=90,env={**os.environ,'QT_QPA_PLATFORM':'offscreen'},check=False)
        except subprocess.TimeoutExpired as exc:
            raise ValueError('FreeCAD assembly solve timed out') from exc
        if not res.is_file(): raise ValueError('FreeCAD assembly worker did not return a result')
        result=json.loads(res.read_text())
        if not result.get('ok'): raise ValueError(result.get('error','Assembly solve failed'))
        if publish:
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(out,dest)
            result['native_file']=dest.relative_to(root).as_posix()
        result['step_sha256']=source_hash
        result['joints_sha256']=hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
        return result

def publish_native(root,stem,rows):
    status=joint_folder_file(root,stem,'.status.json')
    try: result=solve_native(root,stem,rows,publish=True)
    except Exception as exc:
        result={'ok':False,'error':str(exc)[:800],'solver':'FreeCAD Assembly'}
        joint_folder_file(root,stem,'.FCStd').unlink(missing_ok=True)
    status.parent.mkdir(parents=True,exist_ok=True)
    status.write_text(json.dumps(result,indent=2))
    return result

def assembly_info(root, stem):
    from backend.services.cad_harness import load_harness_joints
    status=joint_folder_file(root,stem,'.status.json')
    try: native=json.loads(status.read_text())
    except (OSError,ValueError): native={'ok':False,'error':'Native assembly has not been built yet'}
    rows=load_harness_joints(root,stem=stem)
    if native.get('ok'):
        step=Path(root)/(stem+'.step')
        if not step.is_file(): step=Path(root)/(stem+'.stp')
        if (not step.is_file() or hashlib.sha256(step.read_bytes()).hexdigest()!=native.get('step_sha256') or hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()!=native.get('joints_sha256')):
            native={'ok':False,'error':'Assembly changed since the native solve; validate and save joints again.'}
    from backend.services.joint_compatibility import export_compatibility
    return {'joints':rows,'native':native,'types':list(NATIVE_TYPES),'drive_types':list(DRIVE_TYPES),'compatibility':export_compatibility(rows,native)}


def motion_authoring_error(prompt, rows):
    """Explicit internal-motion requests cannot be completed by a static fused solid."""
    explicit = re.search(r"\b(?:see (?:it|them|this|the .{1,30}) move|make (?:it|them) move|show (?:it|them) moving|animate|animation|articulate|working mechanism)\b", prompt or "", re.I)
    if explicit and not any(row.get('type') not in ('fixed',) for row in rows or []):
        return 'This motion request requires movable joints. Return joints with exact separate component names, physical pivot/axis, and limits; then verify the native assembly solve.'
    return None
