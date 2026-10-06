"""Install declarative Pi controls/menus once; retain account-specific host selection."""
from __future__ import annotations
import hashlib
import io
import json
import re
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, urlunsplit
import httpx
from backend.services.robotics_profile import discover_profile, validate_profile_selection
from backend.services.viser_proxy import is_private_lan_host

TEMPLATE = Path(__file__).resolve().parents[2] / 'integrations/dimos/Render-DimOS-Bridge/render-dimos-robotics-setup'
CACHE = Path(__file__).resolve().parents[2] / '.robotics-packages'
MAX_ZIP = 8 * 1024 * 1024
MAX_EXPANDED = 32 * 1024 * 1024


def setup_url(value, config_url, *, bundle=False):
    base, url = urlsplit(config_url), urlsplit(value)
    if url.scheme not in {'http','https'} or url.username or url.password or url.hostname != base.hostname or not is_private_lan_host(url.hostname or ''):
        raise ValueError('Setup assets must be on the selected Pi LAN host')
    if not url.path.startswith('/robotics/') or (bundle and not url.path.endswith('.zip')):
        raise ValueError('Use the Pi /robotics/bundle.zip setup URL')
    return value


def read_bundle(data):
    if len(data) > MAX_ZIP: raise ValueError('Setup archive exceeds 8 MB')
    files = {}; total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.infolist()) > 100: raise ValueError('Too many setup files')
        for item in archive.infolist():
            path = PurePosixPath(item.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in item.filename or (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe setup archive path')
            if item.is_dir(): continue
            total += item.file_size
            if total > MAX_EXPANDED: raise ValueError('Expanded setup exceeds 32 MB')
            # Bundles may contain one enclosing directory.
            parts = path.parts
            if parts and parts[0] == 'render-dimos-robotics-setup': parts = parts[1:]
            rel = '/'.join(parts)
            if not rel or path.suffix.lower() not in {'.json','.html','.css','.js','.md','.svg','.png'}: continue
            files[rel] = archive.read(item)
    for name in ('controls.json','menus.json'):
        obj=json.loads(files.get(name,b'null'))
        if not isinstance(obj,dict) or obj.get('schema') != 'render-studio-robotics/v1':
            raise ValueError(f'Setup is missing a valid {name}')
    return files


def remap_host(value, old_host, new_host):
    if isinstance(value,dict): return {k:remap_host(v,old_host,new_host) for k,v in value.items()}
    if isinstance(value,list): return [remap_host(v,old_host,new_host) for v in value]
    if isinstance(value,str): return value.replace(old_host,new_host)
    return value


def apply_definitions(profile, controls, menus):
    p=dict(profile)
    c=dict(p.get('controllers') or {})
    for key in ('buttons','http_backups','y_map'):
        if key in controls: c[key]=controls[key]
    stream=controls.get('stream') or (controls.get('websocket') or {}).get('url')
    if stream: c['stream']=stream; c['websocket']=stream; p['websocket']=stream
    p.update(controllers=c, controlDefinition=controls, menuDefinition=menus)
    if controls.get('y_map'): p['y_map']=controls['y_map']
    return p


async def install_setup(config_url, *, bundle_url='', use_template=False):
    if use_template:
        # manifest.json is the package manifest, while the supplied config is the profile.
        default=Path(__file__).resolve().parents[2]/'frontend/xr/robotics-default-profile.json'
        profile=json.loads(default.read_text())
        host=urlsplit(config_url).hostname
        setup_url(config_url,config_url)
        files={str(p.relative_to(TEMPLATE)):p.read_bytes() for p in TEMPLATE.rglob('*') if p.is_file()}
        profile=remap_host(profile,profile.get('host','192.168.1.77'),host)
        profile['host']=host; profile['paste_url']=config_url
    else:
        selected=await discover_profile(config_url); profile=selected['profile']
        setup=profile.get('setup') or {}
        value=bundle_url or setup.get('bundle_url') or setup.get('download_url') or setup.get('zip_url') or profile.get('ui_summary',{}).get('download')
        if not value: value=urlunsplit((*urlsplit(config_url)[:2],'/robotics/bundle.zip','',''))
        setup_url(value,config_url,bundle=True)
        async with httpx.AsyncClient(timeout=20,verify=False,follow_redirects=False,trust_env=False) as client:
            async with client.stream('GET',value) as response:
                response.raise_for_status(); data=bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data)>MAX_ZIP: raise ValueError('Setup archive exceeds 8 MB')
        files=read_bundle(data)
    controls=json.loads(files['controls.json']);menus=json.loads(files['menus.json'])
    original_host=str(controls.get('host') or '192.168.1.77'); host=urlsplit(config_url).hostname
    controls=remap_host(controls,original_host,host);menus=remap_host(menus,original_host,host)
    digest=hashlib.sha256(b''.join(k.encode()+files[k] for k in sorted(files))).hexdigest()[:24]
    target=CACHE/digest;target.mkdir(parents=True,exist_ok=True)
    for name,data in files.items():
        dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True)
        if not dest.exists():dest.write_bytes(data)
    profile=apply_definitions(profile,controls,menus)
    profile['installedSetup']={'id':digest,'version':controls.get('version','1'),'files':len(files)}
    return validate_profile_selection({'mode':'integrated','profile':profile,'configUrl':config_url})
