"""One read-mostly Viser connection per owner, shared with authorized room viewers."""
from __future__ import annotations
import asyncio,base64,hashlib,io,json,math,re,struct,time,uuid
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import msgpack,websockets,zstandard,httpx
from backend.services.viser_proxy import allow_viser_target
from backend.services.robotics_prefs import get_prefs
from backend.database import get_conn

SESSIONS={}
CACHE=Path(__file__).resolve().parents[2]/'.robotics-packages'/'.scene-cache'
MAX_PACKET=64*1024*1024
OWNER_RECONNECT_SECONDS=30
SIMULATION_VECTOR_LIMIT=64

def normalize_simulation_frame(raw):
    """Bound browser MuJoCo telemetry before it enters a shared Viser room."""
    if not isinstance(raw,dict):raise ValueError('Simulation frame must be an object')
    sample=raw.get('sample')
    if not isinstance(sample,dict):raise ValueError('Simulation frame is missing a sample')
    def text_value(value,limit=160):return str(value or '').strip()[:limit]
    def vector(name):
        value=sample.get(name,[])
        if not isinstance(value,list) or len(value)>SIMULATION_VECTOR_LIMIT:raise ValueError(f'Invalid {name} vector')
        if not all(type(item) in (int,float) and math.isfinite(item) and abs(item)<1e6 for item in value):raise ValueError(f'Invalid {name} vector')
        return [float(item) for item in value]
    def joints():
        value=sample.get('joints',[])
        if not isinstance(value,list) or len(value)>SIMULATION_VECTOR_LIMIT:raise ValueError('Invalid joints vector')
        out=[]
        for item in value:
            qpos=item.get('qpos') if isinstance(item,dict) else None
            if type(qpos) not in (int,float) or not math.isfinite(qpos) or abs(qpos)>=1e6:raise ValueError('Invalid joints vector')
            out.append({'name':text_value(item.get('name'),120),'qpos':float(qpos)})
        return out
    run_id=text_value(raw.get('runId'),80)
    if not run_id:raise ValueError('Simulation frame is missing a run ID')
    qvel_max=sample.get('qvel_max',0)
    if type(qvel_max) not in (int,float) or not math.isfinite(qvel_max) or abs(qvel_max)>=1e6:raise ValueError('Invalid qvel_max value')
    return {
        'schema':'render3d.simulation-frame/v1',
        'runId':run_id,
        'projectId':text_value(raw.get('projectId'),80),
        'scene':text_value(raw.get('scene') or sample.get('scene'),240),
        'status':text_value(raw.get('status') or 'running',24),
        'recordingRoot':text_value(raw.get('recordingRoot'),320),
        'sample':{
            'scene':text_value(sample.get('scene'),240),
            'observed_at':text_value(sample.get('observed_at'),64),
            'qpos':vector('qpos'),
            'qvel':vector('qvel'),
            'joints':joints(),
            'qvel_max':float(qvel_max),
        },
    }

def decode_packet(raw):
    if len(raw)>MAX_PACKET:raise ValueError('Viser packet exceeds scene budget')
    if len(raw)>20 and raw[16:20]==b'\x28\xb5\x2f\xfd':
        size,count=struct.unpack('<QQ',raw[:16])
        if size>MAX_PACKET or count>len(raw)-16:raise ValueError('Invalid Viser packet size')
        data=msgpack.unpackb(zstandard.ZstdDecompressor().decompress(raw[16:16+count],max_output_size=size),raw=False)
        buffers=[];offset=(16+count+7)//8*8
        for length in data.get('binaryBufferLengths',[]):
            if length<0 or offset+length>len(raw):raise ValueError('Invalid Viser binary buffer')
            buffers.append(raw[offset:offset+length]);offset=(offset+length+7)//8*8
        def unpack(v):
            if isinstance(v,dict):
                if '__binary_index' in v:return {'data':buffers[v['__binary_index']], 'dtype':v.get('dtype')}
                return {k:unpack(x) for k,x in v.items()}
            if isinstance(v,list):return [unpack(x) for x in v]
            return v
        return unpack(data['messages'])
    data=msgpack.unpackb(raw,raw=False)
    return data.get('messages',[]) if isinstance(data,dict) else list(data)

def compact_glb(data):
    """Retain hierarchy/placement with a small per-link mesh for headset rendering."""
    key=hashlib.sha256(data).hexdigest();CACHE.mkdir(parents=True,exist_ok=True)
    path=CACHE/(key+'.glb')
    if path.is_file():return key,path.read_bytes()
    import trimesh
    scene=trimesh.load(io.BytesIO(data),file_type='glb',force='scene')
    for name,mesh in list(scene.geometry.items()):
        if len(mesh.faces)>3500:
            reduced=mesh.simplify_quadric_decimation(face_count=3500)
            try:reduced.visual=trimesh.visual.ColorVisuals(reduced,face_colors=mesh.visual.main_color)
            except Exception:pass
            scene.geometry[name]=reduced
    out=scene.export(file_type='glb');path.write_bytes(out)
    # Cache is shared, bounded and content-addressed, not copied for each account.
    files=sorted(CACHE.glob('*.glb'),key=lambda p:p.stat().st_mtime,reverse=True);total=0
    for p in files:
        total+=p.stat().st_size
        if total>200*1024*1024:p.unlink(missing_ok=True)
    return key,out

def workspace_get(user_id):
    with get_conn() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS robotics_workspace (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        row=conn.execute('SELECT payload FROM robotics_workspace WHERE user_id=?',(user_id,)).fetchone();conn.commit()
    return json.loads(row[0]) if row else {'presets':[]}

def workspace_put(user_id,data):
    if len(json.dumps(data))>262144:raise ValueError('Robotics workspace exceeds 256 KB')
    if len(data.get('presets',[]))>50:raise ValueError('Keep at most 50 target presets')
    workspace_get(user_id)
    with get_conn() as conn:
        conn.execute('INSERT OR REPLACE INTO robotics_workspace(user_id,payload) VALUES(?,?)',(user_id,json.dumps(data)));conn.commit()
    return data

class LiveScene:
    def __init__(self,user,url,profile):
        self.id=uuid.uuid4().hex;self.owner=user['id'];self.owner_name=user.get('display_name') or 'Robot owner'
        self.url=allow_viser_target(url)[0];self.profile=profile
        self.nodes={};self.gui={};self.assets={};self.clients={};self.socket=None;self.task=None
        self.share=False;self.emotes_shared=False;self.cameras_shared=False;self.camera_host=''
        self.pose={'position':[0,0,-0.9],'quaternion':[0,0,0,1],'scale':0.55}
        self.status='connecting';self.last_seen=time.monotonic();self.version='1.0.30';self.teleop={}
        self.simulation_run=None
        self.scene_bytes=0
        self.owner_expiry=None;self.closed=False;self.error=''
    def descriptor(self):
        return {'id':self.id,'owner':self.owner,'owner_name':self.owner_name,'share':self.share,'emotes_shared':self.emotes_shared,'cameras_shared':self.cameras_shared,'pose':self.pose,'status':self.status,'error':self.error,'simulation_run':self.simulation_run}
    def owner_connected(self):
        if self.owner_expiry:self.owner_expiry.cancel();self.owner_expiry=None
    def owner_disconnected(self):
        """Keep geometry and room identity through a brief headset/network interruption."""
        if self.closed or self.owner in self.clients.values():return
        self.owner_connected()
        async def expire():
            await asyncio.sleep(OWNER_RECONNECT_SECONDS)
            if self.owner not in self.clients.values():await self.close()
        self.owner_expiry=asyncio.create_task(expire())
    async def broadcast(self,message):
        dead=[]
        for client in tuple(self.clients):
            try:await asyncio.wait_for(client.send_json(message),timeout=2)
            except Exception:dead.append(client)
        for client in dead:self.clients.pop(client,None)
    async def publish_simulation_frame(self,raw):
        frame=normalize_simulation_frame(raw);self.simulation_run=frame
        await self.broadcast({'type':'simulation-frame','run':frame})
        return frame
    async def close(self):
        if self.closed:return
        self.closed=True
        if self.owner_expiry and self.owner_expiry is not asyncio.current_task():self.owner_expiry.cancel()
        self.owner_expiry=None
        if self.task:self.task.cancel()
        if self.socket:await self.socket.close()
        for client in tuple(self.clients):
            try:await client.close()
            except Exception:pass
        self.clients.clear();SESSIONS.pop(self.id,None)
    async def prepare(self,row):
        row=dict(row);kind=row.get('type','')
        if kind=='MeshMessage':
            props=dict(row.get('props',{}))
            faces=props.get('faces',{});vertices=props.get('vertices',{})
            if isinstance(faces,dict) and isinstance(vertices,dict) and len(faces.get('data',b''))>3500*12:
                def reduce_mesh():
                    import numpy as np,trimesh
                    mesh=trimesh.Trimesh(vertices=np.frombuffer(vertices['data'],dtype=vertices.get('dtype') or '<f4').reshape(-1,3),faces=np.frombuffer(faces['data'],dtype=faces.get('dtype') or '<u4').reshape(-1,3),process=False)
                    return mesh.export(file_type='glb')
                data=await asyncio.to_thread(reduce_mesh)
                props.pop('faces',None);props.pop('vertices',None);props['glb_data']=data
                row['type']='GlbMessage';row['props']=props;kind='GlbMessage' 
        if kind=='GlbMessage':
            props=dict(row['props']);data=props.get('glb_data')
            if isinstance(data,dict):data=data.get('data')
            if isinstance(data,bytes):
                key,body=await asyncio.to_thread(compact_glb,data)
                if self.scene_bytes+len(body)>MAX_PACKET:raise ValueError('Robot geometry exceeds headset scene budget')
                if key not in self.assets:self.scene_bytes+=len(body)
                self.assets[key]=body;props['glb_data']={'asset':key};row['props']=props
        def encode(v):
            if isinstance(v,bytes):return {'base64':base64.b64encode(v).decode()}
            if isinstance(v,dict):return {k:encode(x) for k,x in v.items()}
            if isinstance(v,(tuple,list)):return [encode(x) for x in v]
            return v
        return encode(row)
    def remember(self,row):
        kind=row.get('type','');name=row.get('name');uid=row.get('uuid')
        if kind.startswith('Gui') and uid:
            if kind=='GuiRemoveMessage':self.gui.pop(uid,None)
            elif kind=='GuiUpdateMessage':
                if uid in self.gui:
                    self.gui[uid]['props'].update(row.get('updates',{}))
                    if 'value' in row.get('updates',{}):self.gui[uid]['value']=row['updates']['value']
            else:self.gui[uid]=row
        elif name:
            if kind=='RemoveSceneNodeMessage':
                for key in list(self.nodes):
                    if key[0]==name or key[0].startswith(name+'/'):self.nodes.pop(key,None)
            elif kind=='SceneNodeUpdateMessage':
                previous=self.nodes.get((name,kind),{})
                self.nodes[(name,kind)]={**row,'updates':{**previous.get('updates',{}),**row.get('updates',{})}}
            else:self.nodes[(name,kind)]=row
    async def run(self):
        parsed=urlsplit(self.url);url=urlunsplit(('wss' if parsed.scheme=='https' else 'ws',parsed.netloc,parsed.path or '/','',''))
        try:
            while True:
                try:
                    async with websockets.connect(url,subprotocols=['viser-v'+self.version],max_size=MAX_PACKET,compression=None) as ws:
                        self.socket=ws;self.status='live';await self.broadcast({'type':'status','scene':self.descriptor()})
                        async for raw in ws:
                            rows=decode_packet(raw);out=[]
                            for row in rows:
                                if row.get('type') in {'BackgroundImageMessage','GuiAddPlotlyMessage'} or '/ghost/' in row.get('name',''):continue
                                ready=await self.prepare(row);self.remember(ready);out.append(ready)
                            if out:await self.broadcast({'type':'messages','messages':out})
                except websockets.ConnectionClosedError as exc:
                    match=re.search(r'Server: ([0-9.]+)',str(exc))
                    if match and match[1]!=self.version:self.version=match[1];continue
                    raise
        except asyncio.CancelledError:pass
        except Exception as exc:
            self.status='disconnected';self.error=str(exc)[:180] or type(exc).__name__
            await self.broadcast({'type':'error','error':self.error,'scene':self.descriptor()})
        finally:self.socket=None
    async def send(self,message):
        if not self.socket:raise ValueError('Viser is disconnected')
        await self.socket.send(msgpack.packb(message,use_bin_type=True))
    async def teleop_request(self,path,body=None):
        base=self.profile.get('ui','');url=urlsplit(base)
        if not url.hostname:raise ValueError('Install a Pi robotics profile first')
        target=urlunsplit((url.scheme,url.netloc,path,'',''))
        async with httpx.AsyncClient(verify=False,trust_env=False,timeout=5) as client:
            r=await client.get(target) if body is None else await client.post(target,json=body)
            r.raise_for_status();data=r.json()
        return data
    async def paused(self):
        # Read only: never issue a toggle to infer or manufacture a paused state.
        from backend.services.robotics_teleop_state import get_status
        status=get_status(self.profile.get('ui',''))
        if status is None:return False
        self.teleop=status
        return not bool(status.get('armed') or status.get('homing') or status.get('playing') or status.get('pending_arm'))
    async def gui_update(self,uid,value):
        row=self.gui.get(uid)
        if not row or row.get('props',{}).get('disabled'):raise ValueError('Viser control unavailable')
        props=row.get('props',{});kind=row.get('type')
        if kind=='GuiDropdownMessage' and value not in props.get('options',[]):raise ValueError('Choose an available Viser option')
        if kind=='GuiSliderMessage' and (type(value) not in (int,float) or not math.isfinite(value) or not props.get('min',-math.inf)<=value<=props.get('max',math.inf)):raise ValueError('Slider value is outside its limits')
        if kind in {'GuiButtonMessage','GuiCheckboxMessage'} and not isinstance(value,bool):raise ValueError('Invalid Viser button value')
        if kind not in {'GuiDropdownMessage','GuiSliderMessage','GuiButtonMessage','GuiCheckboxMessage'}:raise ValueError('Unsupported Viser control')
        if not await self.paused():raise ValueError('Pause teleop with Y before editing Viser targets')
        row={'type':'GuiUpdateMessage','uuid':uid,'updates':{'value':value}}
        await self.send(row);self.remember(row);await self.broadcast({'type':'messages','messages':[row]})
    async def transform(self,name,position,wxyz):
        if (name,'TransformControlsMessage') not in self.nodes:raise ValueError('Select a planning group to enable its target gizmo')
        if not await self.paused():raise ValueError('Pause teleop with Y before changing a target')
        values=position+wxyz
        if len(position)!=3 or len(wxyz)!=4 or not all(isinstance(x,(float,int)) and math.isfinite(x) and abs(x)<100 for x in values):raise ValueError('Invalid target transform')
        await self.send({'type':'TransformControlsUpdateMessage','name':name,'position':position,'wxyz':wxyz})
        rows=[{'type':'SetPositionMessage','name':name,'position':position},{'type':'SetOrientationMessage','name':name,'wxyz':wxyz}]
        for row in rows:self.remember(row)
        await self.broadcast({'type':'messages','messages':rows})

async def start_scene(user,url):
    for existing in tuple(SESSIONS.values()):
        if existing.owner==user['id']:
            if existing.url==allow_viser_target(url)[0] and existing.status!='disconnected':return existing
            await existing.close()
    if len(SESSIONS)>=12:raise ValueError('Live robot scene limit reached')
    prefs=get_prefs(user);profile=(prefs.get('roboticsProfile') or {}).get('profile') or {}
    scene=LiveScene(user,url,profile);scene.camera_host=prefs.get('cameraHost','')
    SESSIONS[scene.id]=scene;scene.task=asyncio.create_task(scene.run());scene.owner_disconnected();return scene
