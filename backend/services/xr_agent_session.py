"""Bounded, per-user cross-device XR agent preferences and desktop requests."""
from __future__ import annotations
import fcntl
import hashlib
import json
import math
import os
import time
import uuid
from urllib.parse import urlparse
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response

MAX_STATE = 480_000
MAX_AUDIO = 3 * 1024 * 1024

def clean(value, depth=0):
    if depth > 8: return None
    if isinstance(value, str): return value[:12000]
    if isinstance(value, bool) or value is None: return value
    if isinstance(value, (int, float)): return value if math.isfinite(value) else None
    if isinstance(value, list): return [clean(v, depth + 1) for v in value[-200:]]
    if isinstance(value, dict):
        return {str(k)[:100]: clean(v, depth + 1) for k,v in list(value.items())[:100]
                if not any(word in str(k).lower() for word in ('secret','token','api_key','password'))}
    return None


def record_time(record):
    value = record.get('updatedAt') or record.get('at') or 0
    if isinstance(value, (int, float)) and math.isfinite(value): return float(value)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None: parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp() * 1000
        except (ValueError, OverflowError): pass
    return 0


def merge_records(existing, incoming, limit):
    records = {}
    for row in [*(existing if isinstance(existing, list) else []), *incoming]:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'].strip(): continue
        row = {**row, 'id': row['id'][:100]}
        previous = records.get(row['id'])
        if previous is None or record_time(row) >= record_time(previous): records[row['id']] = row
    return sorted(records.values(), key=record_time)[-limit:]


def create_xr_agent_router(get_current_user, data_dir):
    router = APIRouter(prefix='/api/xr-agent', tags=['XR agent'])
    root = Path(data_dir) / 'xr-agent'

    @contextmanager
    def locked(uid):
        directory = root / hashlib.sha256(str(uid).encode()).hexdigest()
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / '.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try: yield directory
            finally: fcntl.flock(lock, fcntl.LOCK_UN)

    def read(directory):
        defaults = {'version':1,'settings':{},'settingsUpdatedAt':'','history':[],'changes':[],'revision':0}
        try: value = clean(json.loads((directory / 'state.json').read_text()))
        except (OSError, ValueError): return defaults
        if not isinstance(value, dict): return defaults
        for field, fallback in defaults.items():
            if not isinstance(value.get(field), type(fallback)): value[field] = fallback
        return value

    def write(directory, value):
        packed = json.dumps(value, separators=(',',':'), allow_nan=False)
        if len(packed.encode()) > MAX_STATE: raise HTTPException(413, 'Agent history is too large')
        tmp = directory / 'state.tmp'; tmp.write_text(packed); os.replace(tmp, directory / 'state.json')

    @router.get('/state')
    def get_state(user=Depends(get_current_user)):
        with locked(user['id']) as directory: return read(directory)

    @router.patch('/state')
    async def patch_state(request: Request, user=Depends(get_current_user)):
        raw = await request.body()
        if len(raw) > MAX_STATE: raise HTTPException(413, 'Agent state is too large')
        try: body = clean(json.loads(raw))
        except (ValueError, TypeError): raise HTTPException(400, 'Invalid agent state')
        if not isinstance(body, dict): raise HTTPException(400, 'Invalid agent state')
        with locked(user['id']) as directory:
            state = read(directory)
            if isinstance(body.get('settings'), dict):
                incoming_time = record_time({'updatedAt':body.get('settingsUpdatedAt')})
                existing_time = record_time({'updatedAt':state.get('settingsUpdatedAt')})
                if incoming_time >= existing_time:
                    state['settings'].update(body['settings'])
                    state['settingsUpdatedAt'] = str(body.get('settingsUpdatedAt') or '')[:40]
            for field in ('history','changes'):
                if isinstance(body.get(field), list):
                    state[field] = merge_records(state.get(field,[]), body[field], 120 if field == 'history' else 80)
            state['revision'] = int(state.get('revision',0)) + 1
            state['updatedAt'] = int(time.time() * 1000)
            # Bound transcripts before persistence; never log audio or scene snapshots.
            while len(json.dumps(state).encode()) > MAX_STATE - 10000 and state.get('history'): state['history'].pop(0)
            write(directory,state)
            return {'ok':True,'revision':state['revision']}

    @router.post('/open-pc')
    def open_pc(user=Depends(get_current_user)):
        with locked(user['id']) as directory:
            state = read(directory)
            state['pcRequest'] = {'id':uuid.uuid4().hex,'at':int(time.time()*1000)}
            write(directory,state)
            return {'ok':True,**state['pcRequest']}

    @router.post('/open-slicer')
    async def open_slicer(request: Request, user=Depends(get_current_user)):
        raw = await request.body()
        if len(raw) > 4096: raise HTTPException(413, 'Slicer request is too large')
        try: body = clean(json.loads(raw))
        except (ValueError, TypeError): raise HTTPException(400, 'Invalid slicer request')
        if not isinstance(body, dict): raise HTTPException(400, 'Invalid slicer request')
        slicer_id = str(body.get('slicer_id') or '')[:32]
        if slicer_id not in {'bambu','orca','prusa','cura','creality'}:
            raise HTTPException(400, 'Unsupported slicer')
        file_url = str(body.get('file_url') or '')[:2048]
        parsed = urlparse(file_url)
        if parsed.scheme not in {'http','https'} or not parsed.netloc:
            raise HTTPException(400, 'Invalid 3MF URL')
        filename = str(body.get('filename') or 'model.3mf').replace('\\','/').split('/')[-1][:255]
        if not filename.lower().endswith('.3mf'): raise HTTPException(400, 'Slicer handoff requires a 3MF')
        with locked(user['id']) as directory:
            state = read(directory)
            state['slicerRequest'] = {
                'id':uuid.uuid4().hex,
                'at':int(time.time()*1000),
                'slicer_id':slicer_id,
                'file_url':file_url,
                'filename':filename,
                'source_client_id':str(body.get('source_client_id') or '')[:128],
            }
            state['revision'] = int(state.get('revision',0)) + 1
            write(directory,state)
            return {'ok':True,**state['slicerRequest']}

    @router.post('/slicer-request/{request_id}/ack')
    def ack_slicer_request(request_id: str, user=Depends(get_current_user)):
        with locked(user['id']) as directory:
            state = read(directory)
            current = state.get('slicerRequest')
            if not isinstance(current, dict) or current.get('id') != request_id:
                return {'ok':False}
            state.pop('slicerRequest', None)
            state['revision'] = int(state.get('revision',0)) + 1
            write(directory,state)
            return {'ok':True}

    @router.put('/throw-sound')
    async def upload_sound(request: Request, user=Depends(get_current_user)):
        mime = request.headers.get('content-type','').split(';')[0]
        if mime not in ('audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/mp4','audio/aac'):
            raise HTTPException(415,'Upload an audio clip')
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_AUDIO: raise HTTPException(413,'Maximum sound size is 3 MB')
        if not data: raise HTTPException(400,'Empty audio clip')
        with locked(user['id']) as directory:
            (directory / 'throw.audio').write_bytes(data)
            (directory / 'throw.mime').write_text(mime)
            state = read(directory)
            state['soundUpdatedAt'] = int(time.time() * 1000)
            state['revision'] += 1
            write(directory,state)
        return {'ok':True,'bytes':len(data)}

    @router.get('/throw-sound')
    def get_sound(user=Depends(get_current_user)):
        with locked(user['id']) as directory:
            if not (directory / 'throw.audio').exists(): raise HTTPException(404,'No dismissal sound')
            return Response((directory / 'throw.audio').read_bytes(), media_type=(directory / 'throw.mime').read_text(), headers={'Cache-Control':'no-store'})

    @router.delete('/throw-sound')
    def delete_sound(user=Depends(get_current_user)):
        with locked(user['id']) as directory:
            for filename in ('throw.audio','throw.mime'):
                try: (directory / filename).unlink()
                except FileNotFoundError: pass
            state = read(directory)
            state['soundUpdatedAt'] = int(time.time() * 1000)
            state['revision'] += 1
            write(directory,state)
        return {'ok':True}

    return router
