"""Local, source-recorded manufacturer CAD imports for the wiring workspace."""
from __future__ import annotations
import hashlib
import json
import fcntl
from pathlib import Path
from urllib.parse import urlparse, urljoin
import httpx
from backend.services import parts_workspace, cad_service
from backend.services.url_document_service import _is_blocked_host

LIMIT = 40_000_000

def _identity(part):
    return {
        'manufacturer': str(part.get('manufacturer') or '').strip(),
        'partNumber': str(part.get('partNumber') or part.get('mpn') or '').strip(),
        'revision': str(part.get('revision') or '').strip(),
    }

def _file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''): digest.update(block)
    return digest.hexdigest()

def _model_key(part):
    identity = _identity(part)
    if all(identity.values()):
        return 'mpn:' + '|'.join(identity[key].lower() for key in ('manufacturer','partNumber','revision'))
    return part.get('url')

def _read(root):
    try: return json.loads((root / 'wiring-models.json').read_text())
    except (OSError, ValueError): return {}

def _download(url, dest):
    for _ in range(5):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.username or parsed.password or _is_blocked_host(parsed.hostname):
            raise ValueError('Manufacturer CAD requires a public HTTPS URL')
        with httpx.stream('GET', url, timeout=30, follow_redirects=False) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers['location']); continue
            response.raise_for_status()
            total = 0
            with dest.open('wb') as output:
                for block in response.iter_bytes():
                    total += len(block)
                    if total > LIMIT: raise ValueError('STEP download exceeds 40 MB')
                    output.write(block)
            return
    raise ValueError('Too many CAD download redirects')

def import_models(root):
    root = Path(root)
    with (root / '.wiring-models.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        return _import_models(root)

def _import_models(root):
    root = Path(root); models = _read(root); failures = []
    folder = root / 'electronics-cad'; folder.mkdir(exist_ok=True)
    for part in parts_workspace.get_workspace(root).get('parts', [])[:500]:
        if part.get('category') != 'electronics': continue
        url = part.get('step_url') or next((d.get('url') for d in part.get('docs', []) if Path(urlparse(d.get('url', '')).path).suffix.lower() in {'.step','.stp'}), '')
        existing = part.get('model_filename')
        if existing:
            local = (root / existing).resolve()
            if local.is_relative_to(root.resolve()) and local.is_file() and local.suffix.lower() in {'.step','.stp','.glb'}:
                key = _model_key(part); prior = models.get(key, models.get(part['url'], {}))
                models[key] = {**prior, 'sourceFile':existing, 'source_url':url or prior.get('source_url') or part['url'], 'product_url':part['url'], 'name':part['name'], 'partIdentity':_identity(part), 'sha256':_file_sha256(local)}
                if local.suffix.lower() != '.glb': cad_service.schedule_tessellate_step_to_glb(local)
                continue
        if not url: continue
        key = _model_key(part)
        if len(models) >= 100 and key not in models: break
        filename = 'manufacturer-' + hashlib.sha256(url.encode()).hexdigest()[:20] + '.step'
        dest = folder / filename
        try:
            if not dest.is_file():
                temp = dest.with_suffix('.download')
                try:
                    _download(url, temp)
                    with temp.open('rb') as source: header=source.read(512)
                    if b'ISO-10303-21' not in header: raise ValueError('Source did not return a STEP file')
                    temp.replace(dest)
                finally: temp.unlink(missing_ok=True)
            models[key] = {'sourceFile':dest.relative_to(root).as_posix(), 'source_url':url, 'product_url':part['url'], 'name':part['name'], 'partIdentity':_identity(part), 'sha256':_file_sha256(dest)}
            cad_service.schedule_tessellate_step_to_glb(dest)
        except Exception as exc: failures.append({'part':part['name'], 'error':str(exc)[:300]})
    (root / 'wiring-models.json').write_text(json.dumps(models,indent=2))
    return {'models':list(models.values()), 'failures':failures}

def model_index(root):
    result=[]
    for item in _read(Path(root)).values():
        file=Path(root)/item['sourceFile'];preview=file.with_suffix('.glb')
        result.append({**item,'previewFile':preview.relative_to(root).as_posix(), 'ready':preview.is_file()})
    return {'models':result}

def bind_models(root, schematic):
    from backend.services.purchase_parts import purchase_url
    models=_read(Path(root))
    for component in schematic.get('components', []):
        product=purchase_url(component.get('source_url') or component.get('product_url') or (component.get('part') or {}).get('url'))
        identity_source={**(component.get('part') or {}), **component, **(component.get('partIdentity') or {})}
        model=models.get(_model_key(identity_source)) or models.get(product)
        if model:
            component['sourceFile']=model['sourceFile']
            component['model_source']=model
            if any(model.get('partIdentity', {}).values()): component['partIdentity']=model['partIdentity']
    return schematic
