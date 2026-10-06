import io
import json
import math
import zipfile
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import patch
import pytest
from backend.services import assembly_joint_export as transport, cad_harness as harness, autodesk_oauth as oauth
from backend.cad_adapters import RenderStudioJoints as fusion

STEP=b'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=PRODUCT(\'Base\',\'Base\',\'\',());\nENDSEC;\nEND-ISO-10303-21;\n'
JOINT={'id':'hinge','parent':'Base','child':'Lid','type':'revolute','anchor':[5,6,7],'axis':[2,0,0],'limits':[0,90]}

@pytest.mark.parametrize('digits',['1','12','123','1234','65403','123456','123456789'])
def test_postgres_expiry_precision(digits):
    parsed=oauth._parse_oauth_timestamp('2030-09-15T09:14:30.'+digits+'+00:00')
    assert parsed.microsecond==int(digits[:6].ljust(6,'0'))
    assert parsed.tzinfo==timezone.utc


def test_missing_or_invalid_expiry_returns_none():
    assert oauth._parse_oauth_timestamp('broken') is None
    assert oauth._parse_oauth_timestamp(None) is None
    assert oauth._parse_oauth_timestamp('2030-01-01T00:00:00Z').tzinfo==timezone.utc


def test_token_lookup_accepts_supabase_five_digits_without_refresh():
    from backend.services import supabase_workspace_store as ws
    with patch.object(ws,'live',return_value=True),patch.object(ws,'oauth_get',return_value={'expires_at':'2099-09-15T09:14:30.65403+00:00','access_token':'test-token','refresh_token':'test-refresh'}),patch.object(oauth,'refresh_access_token') as refresh:
        assert oauth.get_valid_access_token('user')=='test-token'
        refresh.assert_not_called()


def test_invalid_expiry_refreshes_instead_of_crashing():
    from backend.services import supabase_workspace_store as ws
    with patch.object(ws,'live',return_value=True),patch.object(ws,'oauth_get',return_value={'expires_at':'bad','access_token':'expired','refresh_token':'refresh'}),patch.object(oauth,'refresh_access_token',return_value={'access_token':'new'}),patch.object(oauth,'upsert_user_tokens'):
        assert oauth.get_valid_access_token('user')=='new'


def test_step_metadata_is_idempotent_and_preserves_entities(tmp_path):
    rows=harness.normalize_harness_joints([JOINT])
    payload=transport.joint_payload(rows,stem='robot')
    packed=transport.pack_step_joints(STEP,payload)
    assert packed.split(b'DATA;',1)[1]==STEP.split(b'DATA;',1)[1]
    assert transport.unpack_step_joints(packed)==payload
    assert transport.pack_step_joints(packed,payload)==packed
    assert transport.pack_step_joints(packed,transport.joint_payload([]))==STEP
    step=tmp_path/'robot.step';step.write_bytes(packed)
    assert fusion.read_metadata(step)==payload


def test_nested_model_scope_ignores_other_global_joint(tmp_path):
    (tmp_path/'vibecad').mkdir()
    (tmp_path/'vibecad/robot.step').write_bytes(STEP)
    harness.write_harness_joints_file(tmp_path,[JOINT],stem='other')
    assert harness.load_harness_joints(tmp_path,stem='vibecad/robot')==[]
    harness.apply_harness_joints(tmp_path,[JOINT],stem='vibecad/robot',published_step='vibecad/robot.step')
    assert harness.load_harness_joints(tmp_path,stem='vibecad/robot')[0]['id']=='hinge'
    assert not (tmp_path/'other.sim.json').exists()
    harness.apply_harness_joints(tmp_path,[],stem='vibecad/robot',published_step='vibecad/robot.step')
    assert harness.load_harness_joints(tmp_path,stem='vibecad/robot')==[]
    assert transport.unpack_step_joints((tmp_path/'vibecad/robot.step').read_bytes()) is None


def test_normalization_preserves_sim_anchors_and_motion_type():
    row=harness.normalize_harness_joints([{'child':'Ball','parent':'Base','type':'fixed','overlay_type':'ball','anchor_mm':[1,2,3],'axis':[0,0,9]}])[0]
    assert row['type']=='ball' and row['anchor']==[1,2,3] and row['axis']==[0,0,1]
    with pytest.raises(ValueError): harness.normalize_harness_joints([{**JOINT,'type':'gear'}])


def test_bundle_has_native_importer_and_matching_metadata(tmp_path):
    step=tmp_path/'robot.step';step.write_bytes(STEP)
    harness.write_harness_joints_file(tmp_path,[JOINT],stem='robot')
    archive=zipfile.ZipFile(io.BytesIO(transport.joint_export_bundle(tmp_path,step)))
    assert 'RenderStudioJoints/RenderStudioJoints.py' in archive.namelist()
    assert json.loads(archive.read('robot.joints.json'))==transport.unpack_step_joints(archive.read('robot.step'))
    assert b'not implemented' in archive.read('README.txt')


def test_native_limit_units_and_current_pose_offset():
    angular=fusion.motion_limits({**JOINT,'state':30})[0]
    assert angular[0]=='rotationLimits'
    assert angular[1][0]==pytest.approx(-math.pi/6)
    linear=fusion.motion_limits({'type':'slider','limits':[0,100],'state':10})[0]
    assert linear==('slideLimits',[-1,9])
    with pytest.raises(ValueError): fusion.motion_limits({'type':'cylindrical','limits':[0,100]})


def test_step_still_loads_as_same_occt_solid(tmp_path):
    pytest.importorskip('OCP')
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.STEPControl import STEPControl_Writer,STEPControl_Reader,STEPControl_AsIs
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID
    step=tmp_path/'solid.step'
    writer=STEPControl_Writer();writer.Transfer(BRepPrimAPI_MakeBox(10,20,30).Shape(),STEPControl_AsIs);writer.Write(str(step))
    before=step.read_bytes();harness.stamp_joints_into_step(step,[JOINT])
    assert step.read_bytes().split(b'DATA;',1)[1]==before.split(b'DATA;',1)[1]
    reader=STEPControl_Reader();assert reader.ReadFile(str(step))==IFSelect_RetDone
    reader.TransferRoots();explorer=TopExp_Explorer(reader.OneShape(),TopAbs_SOLID);count=0
    while explorer.More(): count+=1;explorer.Next()
    assert count==1
