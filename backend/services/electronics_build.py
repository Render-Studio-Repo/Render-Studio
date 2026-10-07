"""Source-backed CAD electronics handoff to the existing, independently tracked wiring job."""
from __future__ import annotations

import fcntl
import hashlib
import json
import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)
CAD_MODES = {"v2", "fusion", "architect", "vibecad", "vibe", "vibecade", "mac", "macad", "multi_agent_cad", "multiagentcad"}
ELECTRONICS = re.compile(r"\b(electronics?|electrical|motors?|servos?|batter(?:y|ies)|encoders?|microcontrollers?|arduino|raspberry|robot(?:ic)?|sensors?|esc|pcb)\b", re.I)
WIRING_UPDATE_ACTION = re.compile(
    r"\b(add|attach|change|connect|disconnect|modify|remove|replace|reroute|redo|regenerate|rewire|update)\w*\b",
    re.I,
)
WIRING_UPDATE_TARGET = re.compile(
    r"\b(wir(?:e|es|ing)|circuit|schematic|pinout|electronics?|electrical|motor|servo|battery|encoder|microcontroller|arduino|raspberry|sensor|esc|pcb|limit switch)\b",
    re.I,
)


def requests_wiring_update(prompt):
    """Require an explicit electrical target and change action on later CAD turns."""
    text = str(prompt or "")
    return bool(WIRING_UPDATE_ACTION.search(text) and WIRING_UPDATE_TARGET.search(text))


def preserve_existing_wiring(root, prompt, *, ledger=None):
    """Return true when a CAD follow-up should leave project electronics untouched."""
    project = Path(root)
    prior = ledger if isinstance(ledger, dict) else _json(project / '.electronics-build.json')
    return bool((project / 'wiring.json').is_file() or prior) and not requests_wiring_update(prompt)


def electronics_parts_progress(project_path):
    """Compact electronics payload for the CAD harness generation HUD."""
    path = Path(project_path) / "electronics_parts.json"
    slim = []
    try:
        payload = json.loads(path.read_text()) if path.is_file() else {}
    except (OSError, ValueError, TypeError):
        payload = {}
    rows = payload.get("parts", []) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or row.get("id") or "").strip()
        if not name:
            continue
        slim.append({
            "id": str(row.get("id") or name)[:80],
            "name": name[:120],
            "qty": str(row.get("qty") or "1"),
            "url": str(row.get("url") or "")[:300],
            "model_filename": str(row.get("model_filename") or "")[:160],
            "status": "grabbed" if (row.get("model_filename") or row.get("url")) else "listed",
        })
        if len(slim) >= 40:
            break
    return {
        "electronics_parts": slim,
        "electronics_count": len(slim),
    }


def authoring_rules(model_electronics=True):
    return '''Electronics handoff (when this build uses electronics):
Use the explicitly specified products first; choose suitable sourced products for unspecified functions, documenting assumptions and unresolved compatibility. Read project links before asking questions. Never substitute another project's example circuit.
Write electronics_parts.json as {"parts":[{"id":"stable product id","name":"exact product","category":"electronics","qty":1,"url":"retrieved direct product URL","docs":[{"label":"Official pinout / wiring diagram","url":"retrieved document URL"}],"specs":{},"model_filename":"relative imported CAD filename if available"}],"questions":[{"question":"unresolved specification","reason":"why needed"}]}.
Include ALL purchased electrical modules used by the design: motors, encoders, controllers, drivers, battery/supplies, regulators, sensors, protection, disconnects and connectors. One row per product with total quantity; do not list internal PCB/heatsink/terminal geometry as separate purchases. Keep unsourced requirements in questions. Never invent URLs or pinouts. Include these same products in parts_list. The host publishes them to Parts List / Electronics and uses their documentation for a separate wiring prompt.
''' + ('''Electronics model import is ON: obtain manufacturer CAD first, then exact-match catalog CAD when unavailable; import and place it at the designed mounting locations, preserving unrelated geometry. Record the source and model_filename. If unavailable, label the envelope provisional and ask for missing dimensions; never claim it is exact vendor CAD.
''' if model_electronics else '''Electronics model import is OFF: do not fetch optional electronics CAD. Still publish the electrical parts/documentation and honor geometry explicitly requested by the user.
''')


def _json(path):
    try:
        if path.stat().st_size > 5_000_000: return {}
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError): return {}


def build_context(root, parent, result, workspace):
    """Keep the originating request and its artifact identity, never the active browser selection."""
    request = parent.get("request_body") or {}
    manifests = []
    artifact = str(result.get("filename") or result.get("step") or result.get("glb") or "")
    stem = Path(artifact).name
    while Path(stem).suffix.lower() in {".glb", ".step", ".stp", ".json", ".vibecad"}: stem = Path(stem).stem
    for folder in (root / "vibecad", root):
        for path in sorted(folder.glob("*.vibecad.json"))[:50]:
            if stem and not path.name.startswith(stem + "."): continue
            data = _json(path)
            manifests.append({"file": path.relative_to(root).as_posix(), **{k: data[k] for k in ("parts_list", "assembly_inventory", "questions", "references", "parameters") if k in data}})
    parts = [p for p in workspace.get("parts", []) if p.get("category") == "electronics"]
    return {"cad_prompt": request.get("prompt") or parent.get("prompt") or "", "artifact": artifact,
            "electronics": parts, "requirements": workspace.get("questions", []), "cad_manifests": manifests,
            "references": request.get("references") or []}


def wiring_request(root, parent, result, workspace):
    context = build_context(root, parent, result, workspace)
    if not context["electronics"] and not ELECTRONICS.search(context["cad_prompt"] + json.dumps(context["cad_manifests"])):
        return None
    request = parent.get("request_body") or {}
    parent_trace = str(parent.get("trace_id") or parent.get("id") or "")
    identity = hashlib.sha256((root.name + ':' + parent_trace).encode()).hexdigest()[:20]
    # A separate immutable reference avoids truncating the electrical parts when the CAD brief is long.
    dest = root / 'references' / 'Electronics wiring' / f'cad-electronics-{identity}.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(context, indent=2, ensure_ascii=False))
    refs = [{"type": "document", "filename": dest.relative_to(root).as_posix(), "label": "Electronics from this CAD build", "id": "cad-electronics:" + identity}]
    links = []
    for part in context['electronics']:
        for url in [part.get('url'), *[d.get('url') for d in part.get('docs', [])]]:
            if url and url not in links: links.append(url)
    for ref in context['references']:
        if not isinstance(ref, dict): continue
        if len(refs) < 48: refs.append(ref)
        url = ref.get('url') or ref.get('filename')
        if str(url or '').startswith('https://') and url not in links: links.append(url)
    # Every URL stays in the context document even when the fetch batch is bounded.
    prompt = ("Generate the wiring schematic for the completed CAD build using the attached Electronics from this CAD build document. "
              "Include every electrical module and its required power, control, feedback and protection connections. "
              "Use the specified electronics and exact linked manufacturer pinouts/wiring diagrams. For unspecified products, select compatible sourced candidates from the supplied documents; clearly mark provisional choices. "
              "Preserve unrelated existing circuits and their IDs. Ignore unrelated example circuits in other notes. "
              "Every purchased component must retain source_url, qty and docs for Parts List / Electronics. Consolidate repeated products by total quantity. "
              "Use actual terminal names and explicit pin_layout for nonstandard components. Never guess a terminal or claim an unresolved circuit is ready to build. "
              "Generate all supported connections now and ask targeted followup_questions for missing motor ratings, protection sizing or pinouts. "
              "This is an automatic follow-up to CAD, attributed to the requesting user with an AI tag.\n\nCAD request:\n" + context['cad_prompt'][:4500])
    return {"prompt": prompt, "references": refs, "driver_links": links[:16], "mode": "wiring",
            "automation": {"kind": "cad-electronics", "parent_trace_id": parent_trace, "parent_prompt_id": parent.get("prompt_id")},
            **{k: request[k] for k in ('model', 'speed', 'ai_key_id', 'ai_key_source', 'use_knowledge_base', 'knowledge_base_ids', 'model_electronics') if k in request}}


def after_cad_complete(root, parent, result):
    """One child per successful CAD trace, with no retry that silently bills again."""
    from backend.services import generation_service as jobs, parts_workspace as parts, prompt_history_service as history
    request = parent.get('request_body') or {}
    mode = str(request.get('mode') or parent.get('mode') or '').lower()
    if parent.get('kind') not in {'prompt', 'cad'} or mode not in CAD_MODES: return None
    if result.get('blocker') or result.get('success') is False or result.get('status') in {'failed','canceled','needs_input'}: return None
    workspace = parts.get_workspace(root)  # Always publish the completed CAD's shopping list.
    if request.get('automatic_wiring') is not True or parent.get('status') != 'running': return None
    if jobs.is_canceled(root, parent.get('trace_id')): return None
    trace = 'ew-' + hashlib.sha256((root.name + ':' + str(parent.get('trace_id'))).encode()).hexdigest()[:20]
    with (root / '.electronics-build.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        ledger_path = root / '.electronics-build.json'
        ledger = _json(ledger_path)
        if trace in ledger or jobs.get_job_by_trace(root, trace): return trace
        prompt = request.get('prompt') or parent.get('prompt') or ''
        if preserve_existing_wiring(root, prompt, ledger=ledger):
            log.info(
                "Skipping automatic wiring for CAD follow-up project=%s trace=%s; existing wiring is unchanged",
                root.name,
                parent.get('trace_id'),
            )
            return None
        body = wiring_request(root, parent, result, workspace)
        if body is None: return None
        from backend.auth import get_user_by_id
        from backend import main
        user = get_user_by_id(parent.get('by_user_id'))
        if not user: raise ValueError('The CAD author is no longer available for automatic wiring')
        main._require_project_write(user, root.name)  # Re-check the original author's current write access.
        try:
            jobs.start(root, kind='wiring', trace_id=trace, user=user, prompt=body['prompt'], label='Automatic electronics wiring',
                       request_body=body, model=body.get('model'), mode='wiring', allow_parallel=True)
        except jobs.GenerationInProgress:
            # Do not displace a manually started wiring job; expose a resumable requirement.
            parts.save_questions(root, [{'id':'automatic-wiring:' + str(parent.get('trace_id')), 'question':'Generate wiring for the latest CAD electronics after the current wiring job finishes.', 'reason':'An existing wiring generation owns the schematic.'}])
            return None
        history.append_entry(root, prompt=body['prompt'], success=False, status='running', kind='wiring', prompt_mode='wiring',
            trace_id=trace, user_id=user['id'], user_name=user['display_name'], user_avatar_url=parent.get('by_avatar_url'),
            model=body.get('model'), references=body['references'], automation=body['automation'])
        ledger[trace] = {'parent_trace_id': parent.get('trace_id'), 'status':'queued'}
        ledger_path.write_text(json.dumps(ledger, indent=2))
        try:
            from backend.services.generation_process import spawn_detached
            spawn_detached('backend.services.electronics_build.run_wiring', [root.name, body, trace, user["id"]], project_path=root, trace_id=trace)
        except Exception as exc:
            jobs.fail(root, str(exc), trace_id=trace)
            history.append_entry(root, prompt=body['prompt'], success=False, status='failed', error=str(exc), kind='wiring', trace_id=trace,
                user_id=user['id'], user_name=user['display_name'], automation=body['automation'])
            raise
    return trace


def run_wiring(project_id, body, trace, user_id):
    from backend import main
    from backend.services import parts_workspace, generation_service, prompt_history_service
    from backend.auth import get_user_by_id
    root = main.PROJECTS / project_id
    user = get_user_by_id(user_id)
    if not user:
        generation_service.fail(root, "CAD author no longer available", trace_id=trace)
        return
    try:
        main._require_project_write(user, project_id)
        if generation_service.is_canceled(root, trace): return
        if body.get('model_electronics') is True:
            from backend.services.wiring_models import import_models
            import_models(root)
        main._background_wiring_prompt(project_id, body, trace, user)
        parts_workspace.get_workspace(root)
        job = generation_service.get_job_by_trace(root, trace) or {}
        entries = prompt_history_service.list_entries(root) if hasattr(prompt_history_service, 'list_entries') else []
        already_recorded = any(e.get('trace_id') == trace and e.get('status') == 'failed' for e in entries)
        if job.get('status') == 'failed' and not already_recorded:
            prompt_history_service.append_entry(root, prompt=body['prompt'], success=False, status='failed', error=job.get('error'),
                trace_id=trace, kind='wiring', user_id=user['id'], user_name=user['display_name'], automation=body['automation'])
    except Exception as exc:
        generation_service.fail(root, str(exc), trace_id=trace)
        prompt_history_service.append_entry(root, prompt=body['prompt'], success=False, status='failed', error=str(exc),
            trace_id=trace, kind='wiring', user_id=user['id'], user_name=user['display_name'], automation=body['automation'])
        raise
