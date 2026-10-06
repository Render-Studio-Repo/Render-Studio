"""Project-local code bundles and bounded document previews; never execute uploads."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import stat
import tempfile
import threading
import zipfile
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

CODE_FOLDER = "Project Code"
CODE_DUMP_FOLDER = "Dropped files"
MAX_FILES = 2000
MAX_HEX_BYTES = 4096
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_BUNDLE_BYTES = 100 * 1024 * 1024
MAX_TEXT_BYTES = 2 * 1024 * 1024
CODE_SUFFIXES = frozenset('.js .mjs .cjs .jsx .ts .tsx .py .ino .c .cc .cpp .cxx .h .hpp .java .go .rs .rb .php .sql .css .scss .less .html .htm .json .jsonc .yaml .yml .toml .ini .cfg .xml .sh .bash .zsh .vue .svelte .swift .kt .kts .r .lua .cs'.split())
TEXT_SUFFIXES = CODE_SUFFIXES | {'.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.gitignore', '.dockerignore'}
CODE_NAMES = {'Dockerfile', 'Makefile', 'CMakeLists.txt', 'requirements.txt', 'Pipfile', 'Gemfile'}
STRONG_CODE_SUFFIXES = frozenset('.js .mjs .cjs .jsx .ts .tsx .py .css .scss .less .html .htm .vue .svelte .ino .c .cc .cpp .cxx .h .hpp .java .go .rs .rb .php .sh .bash .zsh .kt .kts .swift .cs'.split())
CAD_SUFFIXES = frozenset('.step .stp .stl .glb .gltf .3mf .obj .sldprt .sldasm .f3d .f3z .iges .igs .brep .brp'.split())
EXECUTABLE_SUFFIXES = frozenset('.exe .dll .so .dylib .bin .app .com .msi .bat .cmd .ps1 .apk .dmg .pkg'.split())
IGNORED_DIRS = {'.git', '.svn', 'node_modules', '__pycache__', '.venv', 'venv', '__MACOSX'}
PROJECT_ROOT = 'project'
PROJECT_META = 'project.json'
_LOCKS = [threading.Lock() for _ in range(64)]


def is_code_name(name):
    return Path(name).suffix.lower() in CODE_SUFFIXES or Path(name).name in CODE_NAMES


def is_strong_code_name(name):
    return Path(name).suffix.lower() in STRONG_CODE_SUFFIXES or Path(name).name in CODE_NAMES


def names_are_code(names):
    names = [str(n) for n in names if n]
    strong = any(is_strong_code_name(n) for n in names)
    code = any(is_code_name(n) for n in names)
    cad = any(Path(n).suffix.lower() in CAD_SUFFIXES for n in names)
    executable = any(is_executable_name(n) for n in names)
    if cad and not strong:
        return False
    return bool(strong or (code and not cad) or (executable and not cad))


def is_text_name(name):
    return Path(name).suffix.lower() in TEXT_SUFFIXES or Path(name).name in CODE_NAMES


def is_executable_name(name):
    return Path(name).suffix.lower() in EXECUTABLE_SUFFIXES


def _disarm_executable(path: Path):
    """Never leave execute bits on stored uploads; view as text/hex only."""
    try:
        path.chmod(path.stat().st_mode & ~0o111)
    except OSError:
        pass


def safe_relative(value):
    raw = str(value or '').replace('\\', '/')
    parts = raw.split('/')
    if not raw or raw.startswith('/') or re.match(r'^[A-Za-z]:', raw) or any(p in ('', '.', '..') for p in parts) or any(ord(c) < 32 for c in raw):
        raise ValueError('Use a relative file path inside the project.')
    if len(raw) > 800 or len(parts) > 24:
        raise ValueError('File path is too long.')
    return PurePosixPath(raw)


def resolve_file(project, value, *, directory=False):
    rel = safe_relative(value)
    # Reference files and the read-only public project manifest are the complete
    # allowlist. Other project operational files must never reach this viewer.
    if rel.parts[0] != 'references' and str(rel) != PROJECT_META:
        raise ValueError('Choose a file or folder under Reference files.')
    root = Path(project).resolve()
    path = root.joinpath(*rel.parts)
    cursor = root
    for part in rel.parts:
        cursor /= part
        if cursor.is_symlink():
            raise ValueError('Linked files are not supported in the code viewer.')
    if str(rel) != PROJECT_META and not path.resolve().is_relative_to(root / 'references'):
        raise ValueError('File is outside Reference files.')
    if not (path.is_dir() if directory else path.is_file()):
        raise FileNotFoundError(str(rel))
    return path


def _skip(parts):
    return any(p in IGNORED_DIRS for p in parts) or parts[-1] == '.DS_Store' or parts[-1].endswith('.markup.json')


def tree(project, root='references'):
    project = Path(project).resolve()
    if root == PROJECT_ROOT:
        return _project_tree(project)
    try:
        directory = resolve_file(project, root, directory=True)
    except FileNotFoundError:
        return {'root': root, 'entries': [], 'files': [], 'truncated': False}
    files = []
    entries = []
    truncated = False
    for current, dirs, names in os.walk(directory, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED_DIRS and not (Path(current)/d).is_symlink())
        for name in dirs:
            if len(entries) >= MAX_FILES:
                truncated = True
                break
            path = Path(current) / name
            entries.append({'path': path.relative_to(project).as_posix(), 'name': name, 'type': 'directory', 'folder': True})
        if truncated:
            break
        for name in sorted(names):
            p = Path(current)/name
            if p.is_symlink() or _skip(p.parts):
                continue
            if len(entries) >= MAX_FILES:
                truncated = True
                break
            st = p.stat()
            file = {'path': p.relative_to(project).as_posix(), 'name': name, 'type': 'file',
                    'size': st.st_size, 'mtime': st.st_mtime, 'editable': is_text_name(name) and st.st_size <= MAX_TEXT_BYTES}
            files.append(file)
            entries.append(file)
        if truncated:
            break
    return {'root': root, 'entries': entries, 'files': files, 'truncated': truncated}


def _project_tree(project: Path):
    """Return the bounded user-facing project tree, never operational root files."""
    files = []
    entries = []
    meta = project / PROJECT_META
    if meta.is_file() and not meta.is_symlink():
        st = meta.stat()
        item = {'path': PROJECT_META, 'name': PROJECT_META, 'type': 'file', 'size': st.st_size,
                'mtime': st.st_mtime, 'editable': False, 'read_only': True}
        files.append(item)
        entries.append(item)
    references = project / 'references'
    if references.is_dir() and not references.is_symlink():
        entries.append({'path': 'references', 'name': 'references', 'type': 'directory', 'folder': True})
        nested = tree(project, 'references')
        files.extend(nested['files'])
        entries.extend(nested['entries'])
        truncated = nested['truncated']
    else:
        truncated = False
    project_name = project.name
    try:
        payload = json.loads(meta.read_text(encoding='utf-8'))
        project_name = str(payload.get('name') or project_name)
    except (OSError, ValueError, TypeError):
        pass
    return {'root': PROJECT_ROOT, 'entries': entries, 'files': files, 'truncated': truncated,
            'project': {'id': project.name, 'name': project_name}}


def code_references(project):
    return [dict(id=f['path'], name=f['name'], url=f['path'], folder=str(PurePosixPath(f['path']).parent).removeprefix('references/'),
                 stem=Path(f['name']).stem, format=Path(f['name']).suffix.lstrip('.'), size=f['size'], mtime=f['mtime'], section='references', code_project=True)
            for f in tree(project, 'references/' + CODE_FOLDER)['files']]


def _code_directory(project, *parts):
    root = Path(project).resolve()
    for part in ('references', CODE_FOLDER, *parts):
        root /= part
        if root.is_symlink():
            raise ValueError('Linked folders cannot receive code uploads.')
        root.mkdir(exist_ok=True)
    return root


def _bundle_destination(project, name):
    root = _code_directory(project)
    safe = re.sub(r'[^\w. -]', '_', Path(name).stem).strip(' .')[:100] or 'Uploaded code'
    dest = root/safe
    n = 2
    while dest.exists():
        dest = root/f'{safe} ({n})'; n += 1
    return dest


def _dump_destination(project):
    return _code_directory(project, CODE_DUMP_FOLDER)


def _unique_file(dest: Path, name: str) -> Path:
    safe = re.sub(r'[^\w. -]', '_', Path(name).name).strip(' .')[:120] or 'file'
    target = dest / safe
    n = 2
    while target.exists():
        stem, suffix = Path(safe).stem, Path(safe).suffix
        target = dest / f'{stem} ({n}){suffix}'
        n += 1
    return target


def _archive_entries(archive):
    infos = archive.infolist()
    if len(infos) > MAX_FILES * 2:
        raise ValueError(f'Archive has too many entries (limit {MAX_FILES} files).')
    entries = []; total = 0; seen = set()
    for info in infos:
        rel = safe_relative(info.filename.rstrip('/'))
        if stat.S_ISLNK(info.external_attr >> 16):
            raise ValueError('ZIP symlinks are not supported.')
        if info.is_dir() or _skip(rel.parts):
            continue
        if info.flag_bits & 1:
            raise ValueError('Encrypted ZIPs are not supported.')
        key = str(rel).casefold()
        if key in seen:
            raise ValueError('ZIP contains duplicate file paths.')
        seen.add(key)
        total += info.file_size
        if info.file_size > MAX_FILE_BYTES or total > MAX_BUNDLE_BYTES or len(entries) >= MAX_FILES:
            raise ValueError('Code upload exceeds the 25 MB per file / 100 MB per folder / 2,000 file limit.')
        entries.append((info, rel))
    return entries


def archive_is_code(stream):
    try:
        with zipfile.ZipFile(stream) as archive:
            names = [info.filename for info in archive.infolist() if not info.is_dir() and not _skip(PurePosixPath(info.filename).parts)]
            return names_are_code(names)
    except (zipfile.BadZipFile, IndexError):
        return False
    finally:
        try:
            stream.seek(0)
        except Exception:
            pass


def _strip_common_root(rels):
    if not rels:
        return rels
    firsts = [r.parts[0] for r in rels]
    if len(set(firsts)) == 1 and any(len(r.parts) > 1 for r in rels):
        return [PurePosixPath(*r.parts[1:]) if len(r.parts) > 1 else r for r in rels]
    return rels


def import_bundle(project, uploads, paths=None, name='Uploaded code'):
    """Validate the entire upload then publish; never execute stored files."""
    project = Path(project).resolve()
    is_zip = len(uploads) == 1 and str(uploads[0].filename).lower().endswith('.zip')
    nested = False
    if not is_zip:
        preview = [safe_relative(v) for v in (paths or [u.filename for u in uploads])]
        nested = any(len(r.parts) > 1 for r in preview)
    dump = (not is_zip) and (not nested)
    dest = _dump_destination(project) if dump else _bundle_destination(project, name)
    staged = Path(tempfile.mkdtemp(prefix='.upload-', dir=dest.parent))
    written = []
    try:
        if is_zip:
            upload = uploads[0]
            with zipfile.ZipFile(upload.file) as archive:
                entries = _archive_entries(archive)
                if not names_are_code(str(rel) for _, rel in entries):
                    raise ValueError('This ZIP contains no recognized code. Upload CAD archives using the model importer.')
                for info, rel in entries:
                    target = staged.joinpath(*rel.parts); target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info) as source, target.open('wb') as sink:
                        shutil.copyfileobj(source, sink, 1024*1024)
                    _disarm_executable(target)
                    written.append(target)
        else:
            if len(uploads) > MAX_FILES or (paths is not None and len(paths) != len(uploads)):
                raise ValueError('Invalid folder upload or too many files.')
            rels = _strip_common_root([safe_relative(v) for v in (paths or [u.filename for u in uploads])])
            if len({str(r).casefold() for r in rels}) != len(rels):
                raise ValueError('Folder contains duplicate paths.')
            if not names_are_code(str(r) for r in rels):
                raise ValueError('Select a folder containing code.')
            total = 0
            for upload, rel in zip(uploads, rels):
                if _skip(rel.parts):
                    continue
                target = _unique_file(staged, rel.name) if dump else staged.joinpath(*rel.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                size = 0
                with target.open('wb') as sink:
                    while True:
                        chunk = upload.file.read(1024*1024)
                        if not chunk: break
                        size += len(chunk); total += len(chunk)
                        if size > MAX_FILE_BYTES or total > MAX_BUNDLE_BYTES:
                            raise ValueError('Code upload exceeds the file or folder size limit.')
                        sink.write(chunk)
                _disarm_executable(target)
                written.append(target)
        if dump:
            for path in written:
                final = _unique_file(dest, path.name)
                path.replace(final)
            shutil.rmtree(staged, ignore_errors=True)
        else:
            staged.rename(dest)
    except Exception:
        shutil.rmtree(staged, ignore_errors=True)
        raise
    return {'project_id': Path(project).name, 'reference': True, 'code_project': True,
            'filename': dest.relative_to(project).as_posix(), 'root': dest.relative_to(project).as_posix(),
            'folder': dest.relative_to(Path(project)/'references').as_posix(), 'kind': 'code-project',
            'dump': dump}


def read_hex(project, name):
    path = resolve_file(project, name)
    size = path.stat().st_size
    with path.open('rb') as source:
        data = source.read(MAX_HEX_BYTES)
    lines = []
    for offset in range(0, len(data), 16):
        chunk = data[offset:offset + 16]
        hex_part = ' '.join(f'{b:02x}' for b in chunk)
        ascii_part = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        lines.append(f'{offset:08x}  {hex_part:<47}  {ascii_part}')
    return {
        'content': '\n'.join(lines),
        'bytes': size,
        'truncated': size > MAX_HEX_BYTES,
        'executable': is_executable_name(path.name),
        'revision': hashlib.sha256(path.read_bytes() if size <= MAX_TEXT_BYTES else data).hexdigest() if size <= MAX_FILE_BYTES else hashlib.sha256(data).hexdigest(),
    }


def read_text(project, name):
    path = resolve_file(project, name)
    if not is_text_name(path.name) or path.stat().st_size > MAX_TEXT_BYTES:
        raise ValueError('This file is not an editable text file, or exceeds 2 MB.')
    data = path.read_bytes()
    text = data.decode('utf-8-sig')
    if '\0' in text: raise ValueError('Binary files cannot be edited as text.')
    return {'content': text, 'revision': hashlib.sha256(data).hexdigest()}


def create_folder(project, parent, name):
    root = Path(project).resolve()
    parent_name = 'references' if str(parent or '') == PROJECT_ROOT else str(safe_relative(parent or 'references'))
    parent_rel = safe_relative(parent_name)
    if parent_rel.parts[0] != 'references':
        raise ValueError('Create folders under Reference files.')
    folder_name = str(name or '').strip()
    if (not folder_name or len(folder_name) > 100 or folder_name in ('.', '..')
            or folder_name.startswith('.') or '/' in folder_name or '\\' in folder_name
            or any(ord(char) < 32 for char in folder_name)):
        raise ValueError('Use a folder name without slashes, hidden prefixes, or control characters.')
    references = root / 'references'
    if references.is_symlink():
        raise ValueError('Linked folders cannot receive project files.')
    references.mkdir(exist_ok=True)
    parent_path = resolve_file(root, str(parent_rel), directory=True)
    target = parent_path / folder_name
    if target.exists():
        raise FileExistsError('A file or folder with that name already exists.')
    target.mkdir()
    return {'name': folder_name, 'path': target.relative_to(root).as_posix()}


def save_text(project, name, content, revision):
    if str(safe_relative(name)) == PROJECT_META:
        raise ValueError('project.json is read only in the project explorer.')
    path = resolve_file(project, name)
    if not is_text_name(path.name) or len(content.encode('utf-8')) > MAX_TEXT_BYTES:
        raise ValueError('Only text files up to 2 MB can be saved.')
    lock = _LOCKS[hash(str(path)) % len(_LOCKS)]
    with lock:
        current = hashlib.sha256(path.read_bytes()).hexdigest()
        if current != revision: raise FileExistsError('This file changed since you opened it. Reopen it before saving; your draft is still in the editor.')
        fd, tmp = tempfile.mkstemp(prefix='.code-save-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8', newline='') as sink: sink.write(content)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
    return {'revision': hashlib.sha256(content.encode('utf-8')).hexdigest(), 'bytes': path.stat().st_size}


def spreadsheet(project, name, sheet=0):
    path = resolve_file(project, name)
    if path.suffix.lower() != '.xlsx' or path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError('Use an .xlsx file up to 25 MB; export older .xls files as .xlsx or CSV.')
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as archive:
        infos = _archive_entries(archive)
        def xml(name):
            if archive.getinfo(name).file_size > 16*1024*1024: raise ValueError('Worksheet is too large to preview.')
            data = archive.read(name)
            if b'<!DOCTYPE' in data or b'<!ENTITY' in data: raise ValueError('Unsupported XML declarations.')
            return ET.fromstring(data)
        workbook = xml('xl/workbook.xml')
        rels = {r.attrib['Id']: r.attrib['Target'] for r in xml('xl/_rels/workbook.xml.rels')}
        sheets = workbook.findall('s:sheets/s:sheet', ns)
        if not 0 <= sheet < len(sheets): raise ValueError('Worksheet not found.')
        target = rels[sheets[sheet].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
        target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        safe_relative(target)
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(n.itertext()) for n in xml('xl/sharedStrings.xml').findall('s:si', ns)]
        rows = []; truncated = False
        for row in xml(target).findall('s:sheetData/s:row', ns):
            if len(rows) >= 500: truncated = True; break
            cells = []
            for cell in row.findall('s:c', ns):
                match = re.match(r'[A-Za-z]+', cell.attrib.get('r','A1'))
                if not match: raise ValueError('Invalid worksheet cell reference.')
                letters = match.group()
                col = 0
                for ch in letters.upper(): col = col*26+ord(ch)-64
                if col > 100: truncated = True; continue
                while len(cells) < col: cells.append('')
                val = cell.findtext('s:v', default='', namespaces=ns)
                kind = cell.attrib.get('t')
                if kind == 's': val = shared[int(val)] if val.isdigit() and int(val) < len(shared) else val
                elif kind == 'inlineStr':
                    inline = cell.find('s:is', ns)
                    val = ''.join(inline.itertext()) if inline is not None else ''
                elif kind == 'b': val = 'TRUE' if val == '1' else 'FALSE'
                formula = cell.findtext('s:f', default='', namespaces=ns)
                cells[col-1] = str(val or ('=' + formula if formula else ''))[:4000]
            rows.append(cells)
    return {'sheets': [s.attrib.get('name', f'Sheet {i+1}') for i,s in enumerate(sheets)], 'sheet': sheet, 'rows': rows, 'truncated': truncated}
