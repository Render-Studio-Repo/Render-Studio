"""Read-only fallback to existing, public, seller-owned project thumbnails."""
from __future__ import annotations
import hashlib
import re
import tempfile
from pathlib import Path
from backend.config import settings
from backend.database import get_conn


def public_project_thumbnail(item: dict) -> str | None:
    seller=str(item.get('created_by') or (item.get('owner') or {}).get('id') or '')
    if not seller:return None
    ids=[]
    for value in [item]+[f for f in (item.get('files') or [])[:16] if isinstance(f,dict)]:
        pid=str(value.get('project_id') or '')
        if not pid:
            match=re.match(r'^/api/projects/([A-Za-z0-9_-]+)/files/',str(value.get('ref') or ''))
            pid=match[1] if match else ''
        if re.fullmatch(r'[A-Za-z0-9_-]{1,80}',pid) and pid not in ids:ids.append(pid)
    if not ids:return None
    with get_conn() as conn:
        marks=','.join('?' for _ in ids)
        rows=conn.execute(f'SELECT project_id FROM project_access WHERE created_by=? AND is_public=1 AND project_id IN ({marks})',(seller,*ids)).fetchall()
    allowed={row['project_id'] for row in rows}
    root=Path(settings.projects_dir).resolve()
    for pid in ids:
        folder=root/pid;thumb=folder/'.thumb.jpg'
        if pid not in allowed or folder.is_symlink() or thumb.is_symlink():continue
        try:
            if thumb.is_file() and thumb.stat().st_size>0:
                return f'/api/projects/{pid}/thumb?v={thumb.stat().st_mtime_ns}'
        except OSError:continue
    return None


def svg_thumbnail_asset(item: dict) -> bytes | None:
    """Return an inert, bounded version of an existing SVG thumbnail, never file data."""
    import base64
    from xml.etree import ElementTree as ET
    thumb=item.get('thumbnail')
    if isinstance(thumb,str):url=thumb
    elif isinstance(thumb,dict):url=str(thumb.get('data_url') or thumb.get('url') or '')
    else:return None
    prefix='data:image/svg+xml;base64,'
    if not url.startswith(prefix) or len(url)>180_000:return None
    try:
        raw=base64.b64decode(url[len(prefix):],validate=True)
        if len(raw)>128_000 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():return None
        root=ET.fromstring(raw)
    except (ValueError,ET.ParseError):return None
    allowed={'svg','defs','linearGradient','radialGradient','stop','g','rect','circle','ellipse','path','line','polyline','polygon','text','tspan','title','desc','clipPath'}
    attrs={'id','viewBox','width','height','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','d','points','transform','fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-dasharray','opacity','offset','stop-color','stop-opacity','font-size','font-family','font-weight','text-anchor','dominant-baseline','gradientUnits','gradientTransform','clip-path','preserveAspectRatio'}
    def tag(el):return el.tag.rsplit('}',1)[-1] if isinstance(el.tag,str) else ''
    if tag(root)!='svg' or len(list(root.iter()))>500:return None
    for node in list(root.iter()):
        for child in list(node):
            if tag(child) not in allowed:node.remove(child)
        for key,value in list(node.attrib.items()):
            name=key.rsplit('}',1)[-1]
            if name not in attrs or len(value)>8000 or re.search(r'url\s*\(',value,re.I) and not re.fullmatch(r'url\(#[A-Za-z0-9_-]+\)',value):
                del node.attrib[key]
        if node.text and len(node.text)>1000:node.text=node.text[:1000]
        if node.tail and len(node.tail)>1000:node.tail=node.tail[:1000]
    ET.register_namespace('','http://www.w3.org/2000/svg')
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)


def model_thumbnail_asset(item: dict) -> bytes | None:
    """Render a bounded public PNG preview from an attached 3D asset."""
    from backend.services import marketplace_product_page_service as products
    from backend.services.cad_reference_geometry import preview_png_bytes

    supported={'.glb','.gltf','.stl','.obj','.ply','.off','.step','.stp','.3mf'}
    files=item.get('files') or []
    index=next((i for i,f in enumerate(files) if isinstance(f,dict)
                and Path(str(f.get('name') or f.get('filename') or '')).suffix.lower() in supported
                and products.has_asset_source(f)),None)
    if index is None:return None
    identity=f"{item.get('id')}|{item.get('updated_at')}|{index}|{files[index].get('size')}"
    cache=Path(settings.data_dir)/'marketplace-thumbnails'/f'{hashlib.sha256(identity.encode()).hexdigest()}.png'
    try:
        if cache.is_file() and cache.stat().st_size>0:return cache.read_bytes()
        name,data,_mime=products.read_asset(item,index)
        suffix=Path(name).suffix.lower()
        if suffix not in supported:return None
        with tempfile.TemporaryDirectory(prefix='render-market-thumb-') as folder:
            source=Path(folder)/f'model{suffix}'
            source.write_bytes(data)
            png=preview_png_bytes(source,view='iso',size=900)
        if not png.startswith(b'\x89PNG'):return None
        cache.parent.mkdir(parents=True,exist_ok=True)
        cache.write_bytes(png)
        return png
    except (OSError,ValueError,FileNotFoundError,PermissionError):
        return None
