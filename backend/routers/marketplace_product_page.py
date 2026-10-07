"""Product-page editing and explicit downloadable assets; checkout stays existing."""
from __future__ import annotations
import json
import hashlib
from urllib.parse import quote
from fastapi import APIRouter,Depends,HTTPException,Query
from fastapi.responses import Response
from pydantic import BaseModel,Field
from backend.auth import get_current_user,get_current_user_optional
from backend.services import marketplace_catalog_service as catalog,marketplace_product_page_service as service
from backend.services import marketplace_store_builder_service as builder

class PageBody(BaseModel):
    layout:list[dict]=Field(default_factory=list,max_length=24)
    description:str=Field(default='',max_length=16000)
    preview_file_index:int|None=None
    revision:str=Field(min_length=64,max_length=64)

class SuggestBody(BaseModel):
    prompt:str=Field(min_length=3,max_length=4000)
    layout:list[dict]=Field(default_factory=list,max_length=24)
    ai_key_id:str|None=None
    ai_key_source:str|None=None
    model:str|None=None
    speed:str='fast'

def create_marketplace_product_page_router(get_ai):
    router=APIRouter(prefix='/api/marketplace/product/{kind}/{listing_id}',tags=['marketplace-product-pages'])
    def listing(kind,pid,user,owner=False):
        if kind not in ('model','knowledge','agent'):raise HTTPException(404,'Unknown product type.')
        item=catalog.get_product(kind,pid,user_id=(user or {}).get('id'),record=False)
        if not item:raise HTTPException(404,'Product not found.')
        if owner and item.get('created_by')!=user['id']:raise HTTPException(403,'Only the seller can edit this product page.')
        return item
    @router.get('/presentation')
    def get_page(kind:str,listing_id:str,user=Depends(get_current_user_optional)):
        item=listing(kind,listing_id,user);page=service.get_page(item['kind'],item['id'])
        eligible=service.entitled(item,user);assets=service.file_metadata(item)
        glb=next((f['index'] for f in assets if f['download_available'] and f['name'].lower().endswith('.glb')),None)
        preview=page['preview_file_index'] if page['preview_file_index'] is not None else (glb if eligible else None)
        return {'page':page,'can_edit':bool(user and user.get('id') and item.get('created_by')==user['id']),'can_download':eligible,'has_downloads':item['kind']=='agent' or any(f['download_available'] for f in assets),'files':assets,
                'preview_url':f'/api/marketplace/product/{kind}/{quote(item["id"])}/assets/{preview}?preview=true' if preview is not None else None}
    @router.put('/presentation')
    def save(kind:str,listing_id:str,body:PageBody,user=Depends(get_current_user)):
        item=listing(kind,listing_id,user,True)
        if body.preview_file_index is not None:
            files=service.file_metadata(item)
            if not any(f['index']==body.preview_file_index and f['name'].lower().endswith('.glb') for f in files):raise HTTPException(422,'Choose an attached GLB for the public 3D preview.')
        clean=body.model_dump();clean['preview_fingerprint']=''
        if body.preview_file_index is not None:
            try:
                name,data,_=service.read_asset(item,body.preview_file_index)
                if not data.startswith(b'glTF'):raise ValueError('Choose a valid self-contained GLB preview.')
                clean['preview_fingerprint']=hashlib.sha256(data).hexdigest()
            except (ValueError,FileNotFoundError,PermissionError) as exc:raise HTTPException(422,str(exc)) from exc
        try:return {'page':service.save_page(item['kind'],item['id'],clean,body.revision)}
        except FileExistsError as exc:raise HTTPException(409,str(exc)) from exc
    @router.post('/presentation/suggest')
    def suggest(kind:str,listing_id:str,body:SuggestBody,user=Depends(get_current_user)):
        item=listing(kind,listing_id,user,True)
        try:return builder.suggest_product_layout(get_ai(user,body),body.prompt,body.layout,item)
        except ValueError as exc:raise HTTPException(422,str(exc)) from exc
    @router.get('/assets/{index}')
    def asset(kind:str,listing_id:str,index:int,preview:bool=False,user=Depends(get_current_user_optional)):
        item=listing(kind,listing_id,user);page=service.get_page(item['kind'],item['id'])
        public_preview=preview and index==page['preview_file_index'] and bool(page['preview_fingerprint'])
        allowed=service.entitled(item,user)
        if not public_preview and not allowed:raise HTTPException(403,'Purchase this product to download its files.')
        try:name,data,mime=service.read_asset(item,index)
        except FileNotFoundError as exc:raise HTTPException(404,str(exc)) from exc
        except PermissionError as exc:raise HTTPException(403,str(exc)) from exc
        except ValueError as exc:raise HTTPException(422,str(exc)) from exc
        if not allowed and (not name.lower().endswith('.glb') or not data.startswith(b'glTF') or hashlib.sha256(data).hexdigest()!=page['preview_fingerprint']):
            raise HTTPException(403,'The seller needs to republish this changed preview.')
        if not preview:
            try:
                from backend.services import marketplace_analytics_service as analytics
                analytics.record('download',actor_user_id=(user or {}).get('id'),seller_user_id=item.get('created_by'),kind=item.get('kind') or kind,listing_id=item.get('id'),metadata={'filename':name})
            except Exception:pass
        return Response(data,media_type=mime,headers={'Content-Disposition':f"attachment; filename*=UTF-8''{quote(name)}",'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox'})
    @router.get('/package')
    def package(kind:str,listing_id:str,user=Depends(get_current_user)):
        item=listing(kind,listing_id,user)
        if not service.entitled(item,user):raise HTTPException(403,'Purchase this product first.')
        if item['kind']!='agent':raise HTTPException(422,'Use the attached product files.')
        data=json.dumps({'name':item['name'],'app_type':item.get('app_type'),'manifest':item.get('manifest') or {},'instructions':item.get('body_md') or '', 'license':item.get('license')},indent=2)
        return Response(data,media_type='application/json',headers={'Content-Disposition':f"attachment; filename*=UTF-8''{quote(item['slug'])}.json",'Cache-Control':'private, no-store'})
    return router
