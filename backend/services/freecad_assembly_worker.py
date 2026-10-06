"""Data-only FreeCADCmd assembly adapter. Invoked by assembly_motion, never as AI code."""
import json
import math
import sys
from pathlib import Path
import FreeCAD as App
import Import
sys.path.insert(0, App.getResourceDir() + 'Mod/Assembly')
import JointObject
# Explicit solves only; property setters must not solve a half-built graph.
JointObject.solveIfAllowed = lambda *args, **kwargs: None

TYPES = {'fixed':'Fixed','revolute':'Revolute','continuous':'Revolute','slider':'Slider','prismatic':'Slider','cylindrical':'Cylindrical','ball':'Ball','distance':'Distance','parallel':'Parallel','perpendicular':'Perpendicular','angle':'Angle','rack_pinion':'RackPinion','screw':'Screw','gears':'Gears','belt':'Belt'}

def frame(row, child=False):
    anchor = row.get('child_anchor', row['anchor']) if child else row['anchor']
    axis = row.get('child_axis', row['axis']) if child else row['axis']
    quaternion=row.get('child_rotation' if child else 'parent_rotation')
    rotation=App.Rotation(*quaternion) if quaternion else App.Rotation(App.Vector(0,0,1), App.Vector(*axis))
    return App.Placement(App.Vector(*anchor), rotation)

def build(req):
    doc = App.newDocument('MotionAssembly')
    Import.insert(req['step'], doc.Name)
    names = {r[k] for r in req['joints'] for k in ('parent','child')} - {'world'}
    mapping = {}
    # Exact labels only. Ambiguity must not attach motion to an unrelated solid.
    for name in names:
        matches = [o for o in doc.Objects if o.Label == name and hasattr(o,'Shape') and not o.Shape.isNull()]
        if len(matches) != 1:
            raise ValueError('Component %r: expected one STEP body, found %d' % (name,len(matches)))
        mapping[name] = matches[0]
    assembly = doc.addObject('Assembly::AssemblyObject','Assembly')
    assembly.Type = 'Assembly'
    group = assembly.newObject('Assembly::JointGroup','Joints')
    # Copy each named shape in assembled coordinates to independent assembly bodies.
    parts = {}
    for name, source in mapping.items():
        obj = assembly.newObject('Part::Feature','Component')
        obj.Label = name
        shape = source.Shape.copy()
        shape.Placement = source.getGlobalPlacement().multiply(source.Placement.inverse()).multiply(shape.Placement)
        obj.Shape = shape
        parts[name] = obj
    world = assembly.newObject('Part::Feature','World')
    world.Label = 'world'
    parts['world'] = world
    roots = names - {r['child'] for r in req['joints']}
    for name in roots | {'world'}:
        ground = group.newObject('App::FeaturePython','Ground')
        JointObject.GroundedJoint(ground, parts[name])
    originals = {n:o.Placement for n,o in parts.items()}
    created = []
    for row in req['joints']:
        j = group.newObject('App::FeaturePython','Joint')
        j.Label = row['id']
        JointObject.Joint(j, JointObject.JointTypes.index(TYPES[row['type']]))
        parent, child = parts[row['parent']], parts[row['child']]
        j.Reference1 = (parent,[''])
        j.Reference2 = (child,[''])
        j.Detach1 = j.Detach2 = True
        j.Placement1 = parent.Placement.inverse().multiply(frame(row))
        j.Placement2 = child.Placement.inverse().multiply(frame(row,True))
        for field, prop in [('distance','Distance'),('distance2','Distance2'),('angle','Angle')]:
            if field in row: setattr(j,prop,row[field])
        for key, prefix in [('angular_limits','Angle'),('linear_limits','Length')]:
            limits=row.get(key)
            if limits is None and ((prefix=='Angle' and row['type']=='revolute') or (prefix=='Length' and row['type'] in ('slider','prismatic'))): limits=row.get('limits')
            if limits:
                offset=float(row.get('state',0)) if row['type'] in ('revolute','slider','prismatic','continuous') else 0
                setattr(j,prefix+'Min',limits[0]-offset);setattr(j,prefix+'Max',limits[1]-offset)
                setattr(j,'Enable'+prefix+'Min',True);setattr(j,'Enable'+prefix+'Max',True)
        j.Suppressed = bool(row.get('suppressed',False))
        created.append((row,j))
    # Remove imported objects now that independent shapes have been retained.
    for obj in list(mapping.values()):
        obj.Visibility=False
    doc.recompute()
    baseline = assembly.solve()
    if baseline != 0:
        raise ValueError('FreeCAD assembly solve failed (code %s)' % baseline)
    if req.get('output'):
        doc.recompute();doc.saveAs(req['output'])
    for row,j in created:
        values=req.get('values',{}).get(row['id'])
        if values is None: continue
        kind=row['type']
        if kind not in ('revolute','continuous','slider','prismatic','cylindrical','ball'):
            raise ValueError('Drive a revolute/slider/ball joint; constraints and couplings follow the native solver')
        offset=float(row.get('state',0))
        angle=float(values.get('angle',offset))-offset if kind in ('revolute','continuous') else float(values.get('angle',0))
        distance=float(values.get('distance',offset))-offset if kind in ('slider','prismatic') else float(values.get('distance',0))
        # Lock the requested joint coordinates only for this preview solve.
        motion=App.Placement(App.Vector(0,0,distance if kind in ('slider','prismatic','cylindrical') else 0), App.Rotation(App.Vector(0,0,1),angle if kind in ('revolute','continuous','cylindrical') else 0))
        if kind=='ball': motion.Rotation=App.Rotation(float(values.get('yaw',0)),float(values.get('pitch',0)),float(values.get('roll',0)))
        j.Placement1=j.Placement1.multiply(motion)
        j.JointType='Fixed'
    doc.recompute()
    solved=assembly.solve()
    if solved != 0: raise ValueError('FreeCAD motion solve failed (code %s)' % solved)
    matrices={n:list(o.Placement.multiply(originals[n].inverse()).toMatrix().A) for n,o in parts.items() if n!='world'}
    return {'ok':True,'solver':'FreeCAD Assembly','version':'.'.join(App.Version()[:3]),'joint_count':len(created),'matrices':matrices,'native_file':req.get('output')}

if len(sys.argv) >= 4:
    req_path,result_path=sys.argv[-2:]
    try: result=build(json.loads(Path(req_path).read_text()))
    except Exception as exc: result={'ok':False,'error':str(exc)}
    Path(result_path).write_text(json.dumps(result,allow_nan=False))
