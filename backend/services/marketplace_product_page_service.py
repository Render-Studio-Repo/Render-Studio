"""Inert product page layouts and entitlement-checked listing file delivery."""
from __future__ import annotations
import base64
import hashlib
import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import unquote
from backend.config import settings
from backend.database import get_conn
from backend.services import marketplace_storefront_service as storefront

MAX_BYTES=30*1024*1024

def ensure_schema():
    with get_conn() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS marketplace_product_pages (kind TEXT NOT NULL, listing_id TEXT NOT NULL, page_json TEXT NOT NULL, PRIMARY KEY(kind,listing_id))')
        conn.commit()

def normalize_page(data):
    raw=data.get('layout') or [{'id':'about','type':'about','title':'About this product'}]
    layout=storefront.normalize_layout(raw)
    preview=data.get('preview_file_index')
    return {'layout':layout,'description':str(data.get('description') or '')[:16000],
            'preview_file_index':preview if type(preview) is int and 0<=preview<100 else None,
            'preview_fingerprint':str(data.get('preview_fingerprint') or '') if re.fullmatch(r'[a-f0-9]{64}',str(data.get('preview_fingerprint') or '')) else ''}

def get_page(kind,listing_id):
    ensure_schema()
    with get_conn() as conn:row=conn.execute('SELECT page_json FROM marketplace_product_pages WHERE kind=? AND listing_id=?',(kind,listing_id)).fetchone()
    data=normalize_page(json.loads(row['page_json']) if row else {})
    data['revision']=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
    return data

def save_page(kind,listing_id,data,revision):
    ensure_schema();clean=normalize_page(data)
    with get_conn() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT page_json FROM marketplace_product_pages WHERE kind=? AND listing_id=?',(kind,listing_id)).fetchone()
        current=normalize_page(json.loads(row['page_json']) if row else {})
        if hashlib.sha256(json.dumps(current,sort_keys=True).encode()).hexdigest()!=revision:raise FileExistsError('This product page changed. Reload before saving your draft.')
        conn.execute('INSERT INTO marketplace_product_pages VALUES (?,?,?) ON CONFLICT(kind,listing_id) DO UPDATE SET page_json=excluded.page_json',(kind,listing_id,json.dumps(clean)))
        conn.commit()
    return get_page(kind,listing_id)

def entitled(item,user):
    uid=(user or {}).get('id')
    if uid and uid==item.get('created_by'):return True
    if item.get('access_mode')=='view_only' or item.get('download_enabled') is False:return False
    if item.get('access_mode')!='paid' and not item.get('price_cents'):return True
    if not uid:return False
    from backend.services import marketplace_payments_service as payments
    return payments.has_entitlement(uid,'model' if item['kind']=='knowledge' else item['kind'],item['id'])

def asset_name(value, fallback='file'):
    name=str(value or fallback).replace('\\','/').rsplit('/',1)[-1]
    name=''.join(c for c in name if ord(c)>=32 and ord(c)!=127)[:200]
    return name if name not in ('','.','..') else fallback

def has_asset_source(value):
    return bool(re.match(r'^data:[^;,]*;base64,',str(value.get('data_url') or ''))
                or (value.get('project_id') and value.get('rel'))
                or re.fullmatch(r'/api/projects/[A-Za-z0-9_-]+/files/.+',str(value.get('ref') or '')))

def file_metadata(item):
    return [{'index':i,'name':asset_name(f.get('name') or f.get('filename'),f'file-{i+1}'),
             'download_available':has_asset_source(f),'size':f.get('size') if type(f.get('size')) is int and f['size']>=0 else None,'format':str(f.get('format') or Path(str(f.get('name') or '')).suffix.lstrip('.'))[:20]}
            for i,f in enumerate(item.get('files') or []) if isinstance(f,dict)]

def public_listing(item):
    """The shopping catalog carries metadata, never downloadable file payloads."""
    clean={k:v for k,v in item.items() if k not in ('manifest','source_url','body_md','members')}
    if isinstance(clean.get('owner'),dict):clean['owner']={k:v for k,v in clean['owner'].items() if k!='email'}
    examples=(item.get('manifest') or {}).get('example_images',[]) if isinstance(item.get('manifest'),dict) else []
    if isinstance(examples,list):
        public_images=[]
        for image in examples[:8]:
            if not isinstance(image,dict):continue
            url=str(image.get('data_url') or image.get('url') or '')
            if re.match(r'^data:image/(png|jpeg|jpg|webp|gif);base64,',url) or re.match(r'^https?://',url):public_images.append({'url':url,'name':str(image.get('name') or '')[:120]})
        if public_images:clean['example_images']=public_images
    return {**clean,'files':file_metadata(item)}

def protected_listing(item,user,kind):
    tagged={**item,'kind':kind}
    if (user or {}).get('id') and user['id']==item.get('created_by'):return item
    if not entitled(tagged,user):return {**public_listing(tagged),'can_download':False}
    clean={k:v for k,v in item.items() if k!='members'}
    if isinstance(clean.get('owner'),dict):clean['owner']={k:v for k,v in clean['owner'].items() if k!='email'}
    return clean

def read_asset(item,index):
    assets=item.get('files') or []
    if not 0<=index<len(assets) or not isinstance(assets[index],dict):raise FileNotFoundError('File not found.')
    item_file=assets[index];name=asset_name(item_file.get('name') or item_file.get('filename'),f'file-{index+1}')
    url=str(item_file.get('data_url') or '')
    if url:
        if len(url)>MAX_BYTES*1.4:raise ValueError('File exceeds the download size limit.')
        match=re.fullmatch(r'data:([^;,]*);base64,([A-Za-z0-9+/=\r\n]+)',url)
        if not match:raise ValueError('Unsupported embedded file format.')
        content=base64.b64decode(match[2],validate=True)
    else:
        pid=str(item_file.get('project_id') or '')
        rel=str(item_file.get('rel') or '')
        reference=str(item_file.get('ref') or '')
        if not pid or not rel:
            match=re.fullmatch(r'/api/projects/([A-Za-z0-9_-]+)/files/(.+)',reference)
            if not match:raise ValueError('This listing has no downloadable file attached.')
            pid,rel=match[1],unquote(match[2])
        if not re.fullmatch(r'[A-Za-z0-9_-]+',pid):raise ValueError('Invalid source project.')
        parts=Path(rel.replace('\\','/')).parts
        if not parts or Path(rel).is_absolute() or any(p in ('.','..') for p in parts):raise ValueError('Invalid asset path.')
        root=Path(settings.projects_dir).resolve()/pid;path=root
        for part in parts:
            path/=part
            if path.is_symlink():raise ValueError('Linked assets are not supported.')
        if not path.resolve().is_relative_to(root) or not path.is_file():raise FileNotFoundError('Published file is no longer available.')
        # A listing must point to its seller's project, never an arbitrary project ID.
        from backend.services import teams_service
        if not any(r.get('project_id')==pid and r.get('created_by')==item.get('created_by') for r in teams_service.user_project_access(item['created_by'],None)):
            raise PermissionError('The seller no longer owns this source project.')
        if path.stat().st_size>MAX_BYTES:raise ValueError('File exceeds the download size limit.')
        content=path.read_bytes()
    if len(content)>MAX_BYTES:raise ValueError('File exceeds the download size limit.')
    return name,content,mimetypes.guess_type(name)[0] or 'application/octet-stream'
