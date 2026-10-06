"""Permission-checked code workspace API, mounted with existing project policies."""
from __future__ import annotations

import json
import uuid
import zipfile
from xml.etree import ElementTree as ET
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from backend.services import project_code_files as files, code_simulation_service as simulation

class TextBody(BaseModel):
    path: str = Field(max_length=800)
    content: str = Field(max_length=files.MAX_TEXT_BYTES)
    revision: str = Field(min_length=64, max_length=64)

class SimulationBody(BaseModel):
    wiring_project_id: str = Field(min_length=1, max_length=80)
    paths: list[str] = Field(min_length=1, max_length=40)
    drafts: dict[str,str] = Field(default_factory=dict)
    ai_key_id: str | None = None
    ai_key_source: str | None = None
    model: str | None = None
    speed: str = 'fast'

class FolderBody(BaseModel):
    parent: str = Field(default='references', min_length=1, max_length=800)
    name: str = Field(min_length=1, max_length=100)


def create_project_code_router(get_user, require_read, require_write, touch, get_ai, list_projects=None, record_history=None):
    router = APIRouter(prefix='/api/projects/{project_id}/code', tags=['project-code'])
    def call(fn, *args, **kwargs):
        try: return fn(*args, **kwargs)
        except FileExistsError as exc: raise HTTPException(409,str(exc)) from exc
        except FileNotFoundError as exc: raise HTTPException(404,'File or folder not found.') from exc
        except (ValueError, UnicodeError) as exc: raise HTTPException(400,str(exc)) from exc
        except (zipfile.BadZipFile, ET.ParseError, KeyError) as exc: raise HTTPException(400,'Invalid or incomplete archive / spreadsheet file.') from exc

    def history(project, kind, label, filename, user):
        if record_history:
            try: record_history(project, kind, label, filename, user)
            except Exception: pass

    @router.get('/manifest')
    def tree(project_id: str, root: str = 'references', user=Depends(get_user)):
        return call(files.tree, require_read(user,project_id), root)

    @router.get('/text')
    def text(project_id: str, path: str, user=Depends(get_user)):
        return call(files.read_text, require_read(user,project_id), path)

    @router.get('/hex')
    def hex_view(project_id: str, path: str, user=Depends(get_user)):
        return call(files.read_hex, require_read(user,project_id), path)

    @router.put('/text')
    def save(project_id: str, body: TextBody, user=Depends(get_user)):
        project = require_write(user,project_id)
        result = call(files.save_text, project, body.path, body.content, body.revision)
        touch(project)
        history(project, 'upload', f'Edited {Path(body.path).name}', body.path, user)
        return result

    @router.get('/content')
    def content(project_id: str, path: str, user=Depends(get_user)):
        file = call(files.resolve_file, require_read(user,project_id), path)
        if file.stat().st_size > files.MAX_FILE_BYTES: raise HTTPException(413,'Preview limited to files up to 25 MB.')
        return FileResponse(file, filename=file.name, headers={'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"sandbox", 'Cache-Control':'private, no-store'})

    @router.get('/spreadsheet')
    def sheet(project_id: str, path: str, sheet: int = Query(0,ge=0), user=Depends(get_user)):
        return call(files.spreadsheet, require_read(user,project_id), path, sheet)

    @router.post('/upload')
    def upload(project_id: str, uploads: list[UploadFile] = File(...), paths: str = Form('[]'), name: str = Form('Uploaded code'), user=Depends(get_user)):
        project = require_write(user,project_id)
        try: relative = json.loads(paths)
        except ValueError as exc: raise HTTPException(400,'Invalid relative paths.') from exc
        if not isinstance(relative,list) or any(not isinstance(p,str) for p in relative): raise HTTPException(400,'Invalid relative paths.')
        result = call(files.import_bundle, project, uploads, relative or None, name)
        touch(project)
        history(project, 'upload', f'Uploaded code {result.get("folder") or name}', result.get('filename') or name, user)
        return result

    @router.post('/folders')
    def create_folder(project_id: str, body: FolderBody, user=Depends(get_user)):
        project = require_write(user,project_id)
        result = call(files.create_folder, project, body.parent, body.name)
        touch(project)
        history(project, 'upload', f'Created folder {result["name"]}', result['path'], user)
        return result

    @router.get('/wiring-projects')
    def wiring_projects(project_id: str, user=Depends(get_user)):
        project = require_read(user,project_id)
        listing = list_projects(user) if list_projects else []
        candidates = listing.get('projects',[]) if isinstance(listing,dict) else listing
        candidates = [{'id':project_id,'name':Path(project).name}, *(candidates or [])]
        result=[]; seen=set()
        for row in candidates:
            pid = str(row.get('id') or '')
            if not pid or pid in seen: continue
            seen.add(pid)
            try:
                schematic = simulation.load_wiring(require_read(user,pid))
                result.append({'id':pid,'name':row.get('name') or pid,'components':len(schematic['components'])})
            except (HTTPException, ValueError, OSError):
                continue
        return {'projects':result}

    @router.post('/simulation')
    def run(project_id: str, body: SimulationBody, user=Depends(get_user)):
        project = require_write(user,project_id)
        wiring_project = require_read(user,body.wiring_project_id)
        schematic = call(simulation.load_wiring,wiring_project)
        sources = call(simulation.source_snapshot,project,body.paths,body.drafts)
        check = simulation.preflight(sources,schematic)
        if not check['compatible']: return {**check,'actions':[]}
        ai = get_ai(user,body,project_id=project_id,consume_trial=True)
        try: plan = simulation.generate_plan(ai,sources,schematic,trace_id='code-sim-'+uuid.uuid4().hex[:12])
        except (ValueError, RuntimeError) as exc: raise HTTPException(422,'Could not generate a validated simulation: '+str(exc)[:700]) from exc
        return {**plan,'schematic':schematic,'wiring_project_id':body.wiring_project_id}

    return router
