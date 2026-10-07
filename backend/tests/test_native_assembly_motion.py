import json
import math
import os
import subprocess
from pathlib import Path
import pytest
from backend.services import cad_harness as h
from backend.services.assembly_motion import solve_native, publish_native, assembly_info, joint_folder_file, browser_joints, validate_values, motion_authoring_error
from backend.services.assembly_joint_export import joint_export_bundle
from backend.services.joint_compatibility import export_compatibility

JOINT={'id':'hinge','parent':'Base','child':'Lid','type':'revolute','anchor':[0,0,5],'axis':[1,0,0],'limits':[0,90]}

def test_explicit_motion_triggers_joints_without_false_word_substrings():
    assert h.prompt_wants_joints('I want to see it move')
    assert not h.prompt_wants_joints('A camera case with matching warm color')
    assert motion_authoring_error('I want to see it move',[])
    assert not motion_authoring_error('move the entire box left',[])
    assert not motion_authoring_error('I want to see it move',[JOINT])

@pytest.mark.parametrize('kind',['fixed','revolute','slider','cylindrical','ball','distance','parallel','perpendicular','angle','rack_pinion','screw','gears','belt'])
def test_all_native_types_round_trip(kind,tmp_path):
    row={**JOINT,'type':kind,'distance':10,'distance2':20,'angle':45,'child_axis':[0,1,0]}
    h.write_harness_joints_file(tmp_path,[row],stem='arm')
    loaded=h.load_harness_joints(tmp_path,stem='arm')[0]
    assert loaded['type']==kind and loaded['distance2']==20 and loaded['child_axis']==[0,1,0]
    assert joint_folder_file(tmp_path,'arm').is_file()
    assert browser_joints(tmp_path)[0]['joint_count']==1

def test_export_distinguishes_metadata_and_native_adapters():
    report=export_compatibility([JOINT])
    assert report['fusion']['status']=='adapter_required'
    assert report['onshape']['status']=='manual_mates_required'
    assert not report['standard_step_import_creates_native_joints']
    report=export_compatibility([{**JOINT,'type':'gears'}])
    assert report['fusion']['status']=='blocked_unsupported_constraints'

def test_limits_paths_and_bad_couplings(tmp_path):
    with pytest.raises(ValueError): validate_values([JOINT],{'hinge':{'angle':91}})
    with pytest.raises(ValueError): validate_values([JOINT],{'hinge':{'distance':10}})
    with pytest.raises(ValueError): joint_folder_file(tmp_path,'../../escape')
    with pytest.raises(ValueError): h.normalize_harness_joints([{**JOINT,'type':'gears'}])

@pytest.fixture
def native_fixture(tmp_path):
    if os.environ.get('R3D_TEST_FREECAD')!='1': pytest.skip('Set R3D_TEST_FREECAD=1 for installed FreeCAD integration')
    from backend.services.freecad_engine import find_freecad_cmd
    cmd=find_freecad_cmd()
    if not cmd: pytest.skip('FreeCAD unavailable')
    macro=tmp_path/'fixture.py'
    macro.write_text("import FreeCAD as A, Part, Import\nd=A.newDocument('Test')\na=d.addObject('Part::Feature','Base');a.Shape=Part.makeBox(20,20,5)\nb=d.addObject('Part::Feature','Lid');b.Shape=Part.makeBox(20,20,2,A.Vector(0,0,5))\nd.recompute()\nImport.export([a,b],"+repr(str(tmp_path/'arm.step'))+")\n")
    subprocess.run([str(cmd),str(macro)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
    return tmp_path

def test_real_hinge_solve_native_file_and_stale_export(native_fixture):
    root=native_fixture
    h.write_harness_joints_file(root,[JOINT],stem='arm')
    result=publish_native(root,'arm',h.normalize_harness_joints([JOINT]))
    assert result['ok'],result
    assert joint_folder_file(root,'arm','.FCStd').is_file()
    moved=solve_native(root,'arm',[JOINT],values={'hinge':{'angle':45}})
    assert moved['matrices']['Lid'][5]==pytest.approx(math.sqrt(.5))
    assert moved['matrices']['Base'][0]==pytest.approx(1)
    import zipfile,io
    archive=zipfile.ZipFile(io.BytesIO(joint_export_bundle(root,root/'arm.step')))
    assert 'arm.FCStd' in archive.namelist() and 'compatibility.json' in archive.namelist()
    (root/'arm.step').write_bytes((root/'arm.step').read_bytes()+b'\n')
    assert not assembly_info(root,'arm')['native']['ok']

@pytest.mark.parametrize('kind,values,index,expected',[('slider',{'distance':10},3,10),('cylindrical',{'angle':45,'distance':10},3,10),('ball',{'roll':45},5,math.sqrt(.5))])
def test_real_other_motion(native_fixture,kind,values,index,expected):
    row={**JOINT,'type':kind};row.pop('limits')
    result=solve_native(native_fixture,'arm',[row],values={'hinge':values})
    # Axis is X: translation along X; ball roll is local X after connector alignment.
    if kind=='ball':
        assert result['matrices']['Lid'][0]==pytest.approx(math.sqrt(.5))
        assert abs(result['matrices']['Lid'][1])==pytest.approx(math.sqrt(.5))
    else: assert result['matrices']['Lid'][index]==pytest.approx(expected)

@pytest.mark.parametrize('kind,extra',[('fixed',{}),('distance',{'distance':0}),('parallel',{}),('perpendicular',{'child_axis':[0,1,0]}),('angle',{'angle':90,'child_axis':[0,1,0]})])
def test_real_native_constraints(native_fixture,kind,extra):
    row={**JOINT,'type':kind,**extra};row.pop('limits')
    result=solve_native(native_fixture,'arm',[row])
    assert result['ok'] and result['joint_count']==1

@pytest.mark.parametrize('kind',['gears','belt','rack_pinion','screw'])
def test_real_native_couplings(native_fixture,kind):
    root=native_fixture
    from backend.services.freecad_engine import find_freecad_cmd
    macro=root/'coupling.py'
    macro.write_text("import FreeCAD as A, Part, Import\nd=A.newDocument('Coupling')\nobjects=[]\nfor name,x in [('Base',0),('Spindle',0),('Follower',30)]:\n o=d.addObject('Part::Feature',name);o.Shape=Part.makeBox(5,5,5,A.Vector(x,0,0));objects.append(o)\nd.recompute()\nImport.export(objects,"+repr(str(root/'arm.step'))+")\n")
    subprocess.run([str(find_freecad_cmd()),str(macro)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
    angular=kind in ('gears','belt')
    follower_axis=[0,1,0] if kind=='rack_pinion' else [0,0,1]
    rows=[
      {'id':'drive','type':'revolute','parent':'Base','child':'Spindle','anchor':[0,0,0],'axis':[0,0,1]},
      {'id':'follower','type':'revolute' if angular else 'slider','parent':'Base','child':'Follower','anchor':[30,0,0],'axis':follower_axis},
      {'id':'coupling','type':kind,'parent':'Spindle','child':'Follower','anchor':[0,0,0],'child_anchor':[30,0,0],'axis':[0,0,1],'child_axis':follower_axis,'distance':10,'distance2':20},
    ]
    result=solve_native(root,'arm',rows,values={'drive':{'angle':30}})
    assert result['joint_count']==3
    matrix=result['matrices']['Follower']
    if angular:
        assert matrix[0]==pytest.approx(math.cos(math.radians(15)),abs=1e-6)
    else:
        assert abs(matrix[7] if kind=='rack_pinion' else matrix[11])>0.01
