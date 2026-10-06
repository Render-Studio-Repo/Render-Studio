import asyncio,json,math,time,uuid
from fastapi import APIRouter,Depends,HTTPException,Request,WebSocket,WebSocketDisconnect,Query
from fastapi.responses import Response
from pydantic import BaseModel,Field
from backend.auth import get_current_user,decode_token
from backend.ws.manager import hub
from backend.routers.robotics_studio import _require_lan_studio
from backend.services.robotics_live import SESSIONS,start_scene,workspace_get,workspace_put
from backend.services.robotics_teleop_state import get_status
from backend.services import robotics_policy_evaluation
from backend.services import robotics_hardware_program
from backend.services import robotics_rl_training
router=APIRouter()

def in_room(uid):return uid in hub._xr_public

def allowed(scene,uid):return scene.owner==uid or (scene.share and in_room(uid) and in_room(scene.owner))

def require_scene(sid,uid,owner=False):
    scene=SESSIONS.get(sid)
    if not scene:raise HTTPException(404,'Robot scene is no longer connected')
    if not allowed(scene,uid) or (owner and scene.owner!=uid):raise HTTPException(403,'This robot belongs to another user')
    return scene

class OpenBody(BaseModel):url:str=Field(max_length=2048)
class SimulationFrameBody(BaseModel):run:dict
class ActionBody(BaseModel):
    action:str=Field(max_length=50)
    value:dict=Field(default_factory=dict)

class PolicyEvaluationBody(BaseModel):
    checkpoint:str=Field(max_length=160)
    scene:str=Field(max_length=80)
    revision:str=Field(default="main",max_length=80)
    dataset:str=Field(default="",max_length=180)
    runId:str=Field(default="",max_length=120)

class RlProfileBody(BaseModel):
    projectId:str=Field(min_length=1,max_length=120)
    profile:dict=Field(default_factory=dict)

class RlProjectBody(BaseModel):
    projectId:str=Field(min_length=1,max_length=120)

@router.get('/api/robotics/rl/profile')
def rl_profile(project_id:str=Query(...,min_length=1,max_length=120),user=Depends(get_current_user)):
    return robotics_rl_training.get_profile(user['id'],project_id)

@router.put('/api/robotics/rl/profile')
def save_rl_profile(body:RlProfileBody,user=Depends(get_current_user)):
    try:return robotics_rl_training.save_profile(user['id'],body.projectId,body.profile)
    except (TypeError,ValueError) as e:raise HTTPException(400,str(e)) from e

@router.post('/api/robotics/rl/preflight')
def rl_preflight(body:RlProjectBody,user=Depends(get_current_user)):
    return robotics_rl_training.preflight(user['id'],body.projectId)

@router.post('/api/robotics/rl/start')
def rl_start(body:RlProjectBody,user=Depends(get_current_user)):
    return robotics_rl_training.start(user['id'],body.projectId)

@router.post('/api/robotics/policy/evaluate')
def evaluate_policy(body:PolicyEvaluationBody,user=Depends(get_current_user)):
    try:return robotics_policy_evaluation.start(user['id'],body.model_dump())
    except ValueError as e:raise HTTPException(400,str(e)) from e
    except RuntimeError as e:raise HTTPException(503,str(e)) from e

@router.get('/api/robotics/policy/evaluate')
def policy_evaluation_status(user=Depends(get_current_user)):
    return robotics_policy_evaluation.status(user['id'])

@router.delete('/api/robotics/policy/evaluate')
def stop_policy_evaluation(user=Depends(get_current_user)):
    return robotics_policy_evaluation.stop(user['id'])

@router.post('/api/robotics/policy/hardware-candidate')
def hardware_policy_candidate(user=Depends(get_current_user)):
    evaluation=robotics_policy_evaluation.status(user['id'])
    try:return robotics_hardware_program.build_hardware_candidate(evaluation=evaluation)
    except (OSError,TypeError,ValueError,json.JSONDecodeError) as e:raise HTTPException(409,str(e)) from e

@router.get('/api/robotics/live')
def list_scenes(user=Depends(get_current_user)):
    return {'scenes':[s.descriptor() for s in SESSIONS.values() if allowed(s,user['id'])]}
@router.post('/api/robotics/live')
async def open_scene(body:OpenBody,request:Request,user=Depends(get_current_user)):
    _require_lan_studio(request)
    try:return (await start_scene(user,body.url)).descriptor()
    except ValueError as e:raise HTTPException(400,str(e)) from e
@router.post('/api/robotics/live/simulation-frame')
async def simulation_frame(body:SimulationFrameBody,user=Depends(get_current_user)):
    scene=next((item for item in SESSIONS.values() if item.owner==user['id'] and not item.closed),None)
    if not scene:return {'ok':False,'connected':False,'reason':'no_live_scene'}
    try:frame=await scene.publish_simulation_frame(body.run)
    except ValueError as e:raise HTTPException(400,str(e)) from e
    return {'ok':True,'connected':True,'scene_id':scene.id,'run_id':frame['runId']}
@router.delete('/api/robotics/live/{sid}')
async def close_scene(sid:str,user=Depends(get_current_user)):
    await require_scene(sid,user['id'],True).close();return {'ok':True}
@router.get('/api/robotics/live/{sid}/asset/{asset}')
def scene_asset(sid:str,asset:str,token:str=Query(...)):
    uid=decode_token(token)
    if not uid:raise HTTPException(401,'Sign in')
    data=require_scene(sid,uid).assets.get(asset)
    if data is None:raise HTTPException(404,'Scene asset unavailable')
    return Response(data,media_type='model/gltf-binary',headers={'Cache-Control':'private, max-age=3600'})
@router.websocket('/api/robotics/live/{sid}/ws')
async def live_socket(ws:WebSocket,sid:str,token:str=Query(...)):
    uid=decode_token(token)
    try:
        if not uid:raise HTTPException(401,'Sign in')
        scene=require_scene(sid,uid)
    except HTTPException as exc:await ws.close(code=4404 if exc.status_code==404 else 4403);return
    await ws.accept();scene.clients[ws]=uid
    if scene.owner==uid:scene.owner_connected()
    try:
        await ws.send_json({'type':'snapshot','scene':scene.descriptor(),'messages':list(scene.nodes.values())+list(scene.gui.values())})
        while True:
            await asyncio.wait_for(ws.receive_text(),timeout=35)
            if not allowed(scene,uid):break
            scene.last_seen=time.monotonic()
            await ws.send_json({'type':'status','scene':scene.descriptor(),'teleop':get_status(scene.profile.get('ui',''))})
    except (WebSocketDisconnect,asyncio.TimeoutError):pass
    finally:
        scene.clients.pop(ws,None)
        if scene.owner==uid:scene.owner_disconnected()
@router.get('/api/robotics/workspace')
def workspace(user=Depends(get_current_user)):return workspace_get(user['id'])
@router.put('/api/robotics/workspace')
def save_workspace(body:dict,user=Depends(get_current_user)):
    try:return workspace_put(user['id'],body)
    except ValueError as e:raise HTTPException(400,str(e)) from e
@router.get('/api/robotics/live/{sid}/emotes')
async def emotes(sid:str,user=Depends(get_current_user)):
    scene=require_scene(sid,user['id'])
    if scene.owner!=user['id'] and not scene.emotes_shared:raise HTTPException(403,'Owner has not shared emotes')
    return await scene.teleop_request('/emotes')
@router.post('/api/robotics/live/{sid}/action')
async def action(sid:str,body:ActionBody,user=Depends(get_current_user)):
    scene=require_scene(sid,user['id']);owner=scene.owner==user['id'];value=body.value
    if not owner and not (scene.emotes_shared and body.action=='emote-play'):raise HTTPException(403,'Robot owner controls this action')
    try:
        if body.action=='sharing':
            scene.share=bool(value.get('room'));scene.emotes_shared=bool(value.get('emotes')) and scene.share;scene.cameras_shared=bool(value.get('cameras')) and scene.share
            await scene.broadcast({'type':'status','scene':scene.descriptor()})
            for client in tuple(scene.clients):
                # The receive loop checks room membership; revoke immediately on hide too.
                if not allowed(scene,scene.clients.get(client)):
                    await client.send_json({'type':'sharing-revoked','owner':scene.owner})
                    scene.clients.pop(client,None)
                    await client.close(code=4403)
        elif body.action=='pose':
            vals=value.get('position',[])+value.get('quaternion',[])+[value.get('scale',1)]
            if len(vals)!=8 or not all(isinstance(v,(int,float)) and math.isfinite(v) and abs(v)<100 for v in vals):raise ValueError('Invalid robot scene placement')
            if not 0.05<=value.get('scale',0)<=5:raise ValueError('Robot presentation scale must be 0.05–5')
            scene.pose={k:value[k] for k in ('position','quaternion','scale')};await scene.broadcast({'type':'status','scene':scene.descriptor()})
        elif body.action=='gui':await scene.gui_update(value['uuid'],value.get('value'))
        elif body.action=='transform':await scene.transform(value['name'],value['position'],value['wxyz'])
        elif body.action=='emote-play':
            listing=await scene.teleop_request('/emotes');items=listing.get('recordings',[])+listing.get('loops',[])
            if not any(str(i.get('id'))==str(value.get('id')) for i in items):raise ValueError('Emote is no longer available')
            if not await scene.paused():raise ValueError('Owner must pause teleop before playing an emote')
            if not allowed(scene,user['id']) or (not owner and not scene.emotes_shared):raise HTTPException(403,'Emote access was revoked')
            if time.monotonic()-getattr(scene,'last_emote',0)<2:raise ValueError('Wait for the current emote request')
            scene.last_emote=time.monotonic()
            return await scene.teleop_request('/emote/play',{'id':value['id']})
        elif body.action in {'emote-accept','emote-discard'}:return await scene.teleop_request('/'+body.action.replace('-','/'),{})
        elif body.action=='preset-save':
            if not await scene.paused():raise ValueError('Pause teleop with Y before saving a preset')
            if value.get('source')=='current':
                dropdown=next((g for g in scene.gui.values() if g.get('props',{}).get('label')=='Preset'),None)
                if not dropdown:raise ValueError('Select a planning group first')
                await scene.gui_update(dropdown['uuid'],'Current');await asyncio.sleep(0.25)
            targets=[]
            for (name,kind),row in scene.nodes.items():
                if kind!='TransformControlsMessage':continue
                p=scene.nodes.get((name,'SetPositionMessage'),{}).get('position',[0,0,0]);q=scene.nodes.get((name,'SetOrientationMessage'),{}).get('wxyz',[1,0,0,0])
                targets.append({'name':name,'position':p,'wxyz':q})
            if not targets:raise ValueError('Select a planning group to create a target before saving')
            data=workspace_get(scene.owner);preset={'id':uuid.uuid4().hex[:12],'name':str(value.get('name') or 'Target preset')[:80],'role':value.get('role') if value.get('role') in ['init','current','home'] else 'current','targets':targets,'host':scene.url}
            data.setdefault('presets',[]).append(preset);workspace_put(scene.owner,data);return preset
        elif body.action=='preset-apply':
            p=next((p for p in workspace_get(scene.owner).get('presets',[]) if p['id']==value.get('id') and p.get('host')==scene.url),None)
            if not p:raise ValueError('Preset not found for this robot')
            for target in p['targets']:await scene.transform(**target)
        else:raise ValueError('Unknown robotics action')
        return {'ok':True,'scene':scene.descriptor()}
    except (ValueError,KeyError,TypeError) as e:raise HTTPException(400,str(e)) from e

@router.get('/api/robotics/live/{sid}/camera/{side}')
async def scene_camera(sid:str,side:str,request:Request,token:str=Query(...)):
    uid=decode_token(token)
    if not uid:raise HTTPException(401,'Sign in')
    scene=require_scene(sid,uid)
    if scene.owner!=uid and not scene.cameras_shared:raise HTTPException(403,'Owner has not shared cameras')
    from backend.routers.robotics_studio import hand_cam_jpeg
    return await hand_cam_jpeg(side,request,host=scene.camera_host or None,strict_remote=True)

class PrinterProbe(BaseModel):
    host:str=Field(max_length=255)
    protocol:str=Field(default='Bambu LAN',max_length=30)

@router.post('/api/robotics/printer/probe')
async def printer_probe(body:PrinterProbe,request:Request,user=Depends(get_current_user)):
    """Read-only TCP reachability; never submit a print or move a printer."""
    _require_lan_studio(request)
    from backend.services.viser_proxy import is_private_lan_host
    host=body.host.strip()
    if not is_private_lan_host(host):raise HTTPException(400,'Enter a printer LAN IP address')
    if body.protocol not in {'Bambu LAN','OctoPrint'}:raise HTTPException(400,'Choose Bambu LAN or OctoPrint')
    port=8883 if body.protocol=='Bambu LAN' else 80
    try:
        reader,writer=await asyncio.wait_for(asyncio.open_connection(host,port),timeout=3)
        writer.close();await writer.wait_closed()
    except (OSError,asyncio.TimeoutError) as e:raise HTTPException(502,f'Printer is not reachable at {host}:{port}') from e
    return {'ok':True,'message':f'{body.protocol} reachable at {host}:{port}. Authentication and print submission use the printer settings in the slicer.'}
