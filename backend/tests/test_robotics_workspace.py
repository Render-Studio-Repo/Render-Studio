import asyncio,io,json,struct,zipfile
from unittest.mock import AsyncMock
import msgpack,pytest,zstandard
from backend.services import robotics_live as live, robotics_setup as setup
from backend.routers.robotics_live import allowed


def test_viser_binary_protocol_decodes_anchors_and_geometry():
    data={'messages':[{'type':'MeshMessage','name':'/robot','props':{'vertices':{'__binary_index':0,'dtype':'<f4'}}}], 'binaryBufferLengths':[12]}
    plain=msgpack.packb(data,use_bin_type=True);compressed=zstandard.ZstdCompressor().compress(plain)
    raw=struct.pack('<QQ',len(plain),len(compressed))+compressed;raw+=b'\0'*((-len(raw))%8)+struct.pack('<fff',1,2,3)
    row=live.decode_packet(raw)[0];assert row['props']['vertices']['data']==struct.pack('<fff',1,2,3)
    with pytest.raises(ValueError):live.decode_packet(raw[:-2])


def test_zip_rejects_traversal_and_symlinks():
    for name,mode in [('../setup.js',0),('/setup.js',0),('ui/a.js',0o120777<<16)]:
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:
            info=zipfile.ZipInfo(name);info.external_attr=mode;z.writestr(info,b'bad')
        with pytest.raises(ValueError):setup.read_bundle(buf.getvalue())


def test_template_reuses_assets_but_remaps_each_user_host(tmp_path,monkeypatch):
    monkeypatch.setattr(setup,'CACHE',tmp_path)
    a=asyncio.run(setup.install_setup('http://192.168.1.50:8450/robotics/config',use_template=True))
    b=asyncio.run(setup.install_setup('http://192.168.1.60:8450/robotics/config',use_template=True))
    assert a['profile']['installedSetup']['id']==b['profile']['installedSetup']['id']
    assert a['profile']['websocket']=='wss://192.168.1.50:8443/ws'
    assert b['profile']['controllers']['http_backups']['y']['url']=='https://192.168.1.60:8443/teleop/y'
    assert 'emote_picker' in a['profile']['controlDefinition']['actions']


def test_late_viewers_receive_merged_updates():
    s=live.LiveScene({'id':'owner'},'http://192.168.1.77:8095',{})
    s.remember({'type':'SceneNodeUpdateMessage','name':'/a','updates':{'color':[1,2,3]}})
    s.remember({'type':'SceneNodeUpdateMessage','name':'/a','updates':{'opacity':.5}})
    assert s.nodes[('/a','SceneNodeUpdateMessage')]['updates']=={'color':[1,2,3],'opacity':.5}


def test_target_actions_require_confirmed_pause_and_validate_values():
    s=live.LiveScene({'id':'owner'},'http://192.168.1.77:8095',{})
    s.send=AsyncMock();s.gui['group']={'type':'GuiDropdownMessage','props':{'options':['Current','Home']}}
    with pytest.raises(ValueError,match='Pause'):asyncio.run(s.gui_update('group','Current'))
    s.paused=AsyncMock(return_value=True)
    with pytest.raises(ValueError,match='option'):asyncio.run(s.gui_update('group','Execute'))
    s.nodes[('/target','TransformControlsMessage')]={'name':'/target'}
    asyncio.run(s.transform('/target',[1,2,3],[1,0,0,0]))
    assert s.nodes[('/target','SetPositionMessage')]['position']==[1,2,3]
    s.send.assert_awaited_once()


def test_room_sharing_requires_owner_opt_in_and_both_members(monkeypatch):
    from backend.routers import robotics_live as route
    monkeypatch.setattr(route,'in_room',lambda uid:uid in {'owner','guest'})
    s=live.LiveScene({'id':'owner'},'http://192.168.1.77:8095',{})
    assert allowed(s,'owner') and not allowed(s,'guest')
    s.share=True;assert allowed(s,'guest') and not allowed(s,'stranger')
    monkeypatch.setattr(route,'in_room',lambda uid:uid=='guest');assert not allowed(s,'guest')


def test_simulation_frames_are_bounded_and_broadcast_to_viser_room():
    s=live.LiveScene({'id':'owner'},'http://192.168.1.77:8095',{})
    client=AsyncMock();s.clients[client]='owner'
    frame=asyncio.run(s.publish_simulation_frame({
        'runId':'run-123','projectId':'project-1','scene':'cell/demo.xml','status':'running',
        'recordingRoot':'openarm-mujoco/episodes/run-123',
        'sample':{'scene':'cell/demo.xml','observed_at':'2026-09-23T18:00:00Z','qpos':[0,1.5],'qvel':[0,.2],'joints':[{'name':'left_joint1','qpos':.5}],'qvel_max':.2,'ignored':'large'},
    }))
    assert frame['runId']=='run-123' and frame['sample']['qpos']==[0.0,1.5]
    assert frame['sample']['joints']==[{'name':'left_joint1','qpos':.5}]
    assert 'ignored' not in frame['sample'] and s.descriptor()['simulation_run']==frame
    client.send_json.assert_awaited_once_with({'type':'simulation-frame','run':frame})
    with pytest.raises(ValueError,match='qpos'):
        live.normalize_simulation_frame({'runId':'bad','sample':{'qpos':[float('nan')],'qvel':[]}})
    with pytest.raises(ValueError,match='qvel_max'):
        live.normalize_simulation_frame({'runId':'bad','sample':{'qpos':[],'qvel':[],'qvel_max':float('inf')}})
