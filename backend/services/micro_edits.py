"""Snapshot-based micro edit runs, bounded benchmarks, and result ratings."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from backend.services import prompt_learning

SKILL = Path(__file__).parents[1] / "skills/micro-edit/SKILL.md"
VARIANTS = {
    "minimal": "Use the fewest exact local operations. Return only the JSON plan.",
    "constraints": "Before returning the same JSON plan, check requested dimensions and preservation of each unselected body. Do not output your reasoning.",
    "mount-first": "Prioritize the explicitly identified mounting interface, confirmed hole pattern and connector clearances. Do not broaden the requested edit. Return only the JSON plan.",
}
RATING_CATEGORIES = ("intent", "dimensions", "preservation", "mount_fit", "overall")
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="cad-micro")
_LOCK = threading.RLock()
_ACTIVE = {}


def now(): return datetime.now(timezone.utc).isoformat()


def resolve_base(root, filename):
    from backend.services import cad_service
    from backend.services.freecad_engine import resolve_project_step
    root = Path(root).resolve()
    name = cad_service.resolve_existing_project_file(root, filename or "")
    if not name: raise ValueError("Select an existing CAD model")
    original = (root / name).resolve()
    if not original.is_relative_to(root): raise ValueError("Invalid project model")
    step = original if original.suffix.lower() in {".step", ".stp"} else original.with_suffix(".step")
    if not step.is_file(): step = resolve_project_step(root, name)
    if not step or not Path(step).resolve().is_relative_to(root) or not Path(step).is_file():
        raise ValueError("This model has no B-rep STEP source. Generate CAD or import STEP before using micro edits.")
    step = Path(step).resolve()
    if step.stat().st_size > 100 * 1024 * 1024: raise ValueError("Isolate the mounting subassembly first; this STEP exceeds 100 MB")
    return step, hashlib.sha256(step.read_bytes()).hexdigest()[:24]


def kernel(request, *, timeout=90):
    with tempfile.TemporaryDirectory(prefix="r3d-micro-kernel-") as tmp:
        inp, out = Path(tmp) / "request.json", Path(tmp) / "result.json"
        inp.write_text(json.dumps(request, allow_nan=False))
        try:
            subprocess.run([sys.executable, "-m", "backend.services.micro_edit_kernel", str(inp), str(out)],
                           cwd=Path(__file__).parents[2], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=timeout, check=True)
        except subprocess.TimeoutExpired as exc:
            raise ValueError("CAD micro edit exceeded its time limit; use a smaller selected subassembly") from exc
        if not out.is_file(): raise ValueError("CAD kernel did not return a result")
        result = json.loads(out.read_text())
        if not result.get("ok"): raise ValueError(result.get("error") or "CAD validation failed")
        return result["result"]


def inspect(root, filename, body_ids=()):
    step, revision = resolve_base(root, filename)
    return {**kernel({"action": "inspect", "step": str(step), "body_ids": list(body_ids)}, timeout=60),
            "base_filename": filename, "step_filename": step.relative_to(Path(root).resolve()).as_posix(), "revision": revision}


def _path(root, run_id):
    if not isinstance(run_id, str) or len(run_id) != 16 or any(c not in "0123456789abcdef" for c in run_id):
        raise ValueError("Invalid micro-edit run")
    return Path(root) / "Parts List" / "Micro edits" / (run_id + ".json")


def save(root, run):
    with _LOCK:
        path = _path(root, run["id"])
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_file():
            previous = json.loads(path.read_text())
            for row in run["results"]:
                saved = next((r for r in previous.get("results", []) if r["id"] == row["id"]), {})
                for uid, rating in saved.get("ratings", {}).items():
                    current = row.setdefault("ratings", {}).get(uid)
                    if not current or rating["at"] > current["at"]: row["ratings"][uid] = rating
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(run, indent=2, ensure_ascii=False, allow_nan=False))
        temp.replace(path)
        # Compact per-project logs have their own small cap; model files are user assets.
        files = sorted(path.parent.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        used = 0
        for index, file in enumerate(files):
            used += file.stat().st_size
            if (index >= 200 or used > 20 * 1024 * 1024) and file.stem not in _ACTIVE:
                file.unlink(missing_ok=True)


def load(root, run_id):
    with _LOCK:
        path = _path(root, run_id)
        if not path.is_file(): raise ValueError("Micro-edit log is unavailable or has been pruned")
        run = json.loads(path.read_text())
        if run["status"] in {"queued", "running", "canceling"} and run_id not in _ACTIVE:
            run["status"] = "interrupted"
            run["error"] = "The server restarted. Completed variants are preserved; start a new run to continue."
        return run


def recent(root, limit=20):
    folder = Path(root) / "Parts List" / "Micro edits"
    paths = sorted(folder.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    return [load(root, p.stem) for p in paths]


def start(root, user, request, ai_factory):
    root = Path(root).resolve()
    trials = request["models"]
    total = sum(row["count"] for row in trials)
    if not 1 <= total <= 10: raise ValueError("Select 1–10 total debug variants")
    if not request.get("body_ids"): raise ValueError("Select at least one inspected CAD body")
    if any(v not in VARIANTS for v in request["variants"]): raise ValueError("Unknown prompt variation")
    for row in trials:
        client = ai_factory(row["model"])
        resolved = str(getattr(client, "model", ""))
        if resolved != row["model"]: raise ValueError(f"Requested {row['model']}, but this AI source resolved to {resolved}; choose a model supported by this source")
    step, revision = resolve_base(root, request["base_filename"])
    if revision != request["revision"]: raise ValueError("Model changed. Inspect it again before running the edit")
    run_id = uuid.uuid4().hex[:16]
    with _LOCK:
        if len(_ACTIVE) >= 8: raise ValueError("Micro-edit queue is full; try again after a run finishes")
        if any(v["root"] == str(root) for v in _ACTIVE.values()): raise ValueError("A micro-edit run is already active for this project")
        cancel = threading.Event()
        _ACTIVE[run_id] = {"root": str(root), "cancel": cancel, "user_id": user["id"]}
    run = {"id": run_id, "project_id": request["project_id"], "user_id": user["id"], "status": "queued",
           "created_at": now(), "base_filename": request["base_filename"], "revision": revision,
           "prompt": request["prompt"], "harness": request.get("harness") or "CAD",
           "body_ids": request["body_ids"], "face_ids": request.get("face_ids") or [],
           "models": trials, "variants": request["variants"], "total": total, "results": [],
           "skill_version": hashlib.sha256(SKILL.read_bytes()).hexdigest()[:12],
           "debug": bool(request.get("debug")), "repair_passes": request.get("repair_passes", 0)}
    work = None
    try:
        work = Path(tempfile.mkdtemp(prefix="r3d-micro-run-"))
        snapshot = work / "source.step"
        shutil.copyfile(step, snapshot)
        if hashlib.sha256(snapshot.read_bytes()).hexdigest()[:24] != revision:
            raise ValueError("Model changed while creating the snapshot. Inspect it again")
        save(root, run)
        _POOL.submit(_execute, root, user, request, run, work, ai_factory, cancel)
    except Exception:
        with _LOCK: _ACTIVE.pop(run_id, None)
        if work: shutil.rmtree(work, ignore_errors=True)
        raise
    return run


def _plan(ai, system, context, images, cancel):
    if hasattr(ai, "set_cancel_check"): ai.set_cancel_check(cancel.is_set)
    if getattr(ai, "billing_source", "") == "chatgpt_subscription":
        from backend.services.chatgpt_codex_llm import complete
        raw, trace = complete(user_id=ai.billing_user_id, model=ai.model, system_prompt=system, user_content=context,
            images=images or None, json_response=True, timeout_sec=120, cancel_check=cancel.is_set, lightweight=True)
    else:
        raw, trace = ai._call_model(system, context, images=images or None, max_tokens=1600,
                                   json_response=True, reasoning_effort="low" if "astra" in ai.model else "none")
    if isinstance(raw, dict): return raw, trace
    text = str(raw).strip()
    result = json.loads(text[text.find("{"):text.rfind("}") + 1])
    if not isinstance(result, dict): raise ValueError("AI did not return a micro-edit plan")
    if len(json.dumps(result)) > 24000: raise ValueError("Micro-edit plan is too large")
    return result, trace


def _execute(root, user, request, run, work, ai_factory, cancel):
    start_time = time.monotonic()
    try:
        run["status"] = "running"; save(root, run)
        geometry = kernel({"action": "inspect", "step": str(work / "source.step"), "body_ids": request["body_ids"]}, timeout=60)
        geometry["bodies"] = [b for b in geometry["bodies"] if b["id"] in request["body_ids"]]
        context = {"request": request["prompt"], "geometry": geometry, "face_ids": run["face_ids"],
                   "references": request.get("references") or [], "parts_changes": request.get("parts_changes") or []}
        if len(json.dumps(context)) > 100_000: raise ValueError("Micro-edit context is too large; narrow the selected parts or references")
        run["context_snapshot"] = context
        for selection in request["models"]:
            for repeat in range(selection["count"]):
                if cancel.is_set(): break
                n = len(run["results"]) + 1
                variant = request["variants"][(n - 1) % len(request["variants"])]
                row = {"id": n, "name": f"{'Debug' if run['debug'] else 'Micro edit'} {n}", "model": selection["model"],
                       "variant": variant, "repeat": repeat + 1, "status": "planning", "started_at": now(), "attempts": []}
                run["results"].append(row); save(root, run)
                began = time.monotonic()
                traces = []
                try:
                    ai = ai_factory(selection["model"])
                    row["provider"] = getattr(ai, "provider", "")
                    row["ai_source"] = getattr(ai, "billing_source", request.get("ai_key_source") or "key")
                    system = SKILL.read_text() + "\n" + VARIANTS[variant]
                    row["system_prompt"] = system
                    trial_context = dict(context)
                    for attempt in range(request.get("repair_passes", 0) + 1):
                        if cancel.is_set(): break
                        t = time.monotonic()
                        plan, trace = _plan(ai, system, json.dumps(trial_context), request.get("images"), cancel)
                        traces.append(trace)
                        if getattr(ai, "billing_source", "") == "platform":
                            from backend.services.ai_credit_service import spend_for_trace
                            spend_for_trace(user["id"], trace, project_id=run["project_id"])
                        timing = {"plan_ms": round((time.monotonic() - t) * 1000), "plan": plan}
                        # Keep only usage fields, never hidden reasoning, credentials or full provider traces.
                        timing["usage"] = {k: trace[k] for k in ("usage", "cost_usd", "model", "provider", "duration_ms") if k in (trace or {})}
                        row["attempts"].append(timing)
                        if cancel.is_set(): break
                        if plan.get("questions"):
                            row["status"] = "needs_information"; row["questions"] = plan["questions"]; break
                        row["status"] = "building"; save(root, run)
                        t = time.monotonic()
                        try:
                            built = kernel({"action": "apply", "step": str(work / "source.step"), "dest": str(work / f"variant_{n}.step"),
                                            "plan": plan, "body_ids": run["body_ids"], "face_ids": run["face_ids"]})
                            timing["kernel_ms"] = round((time.monotonic() - t) * 1000)
                            if cancel.is_set(): break
                            stem = f"{'Debug' if run['debug'] else 'Micro_edit'}_{n}_{run['id']}"
                            for kind in ("step", "glb"):
                                dest = root / f"{stem}.{kind}"
                                with dest.open("xb") as stream, Path(built[kind]).open("rb") as source:
                                    shutil.copyfileobj(source, stream)
                                row[kind + "_filename"] = dest.name
                            row["validation"] = {k: v for k, v in built.items() if k not in {"step", "glb"}}
                            row["status"] = "complete"
                            break
                        except ValueError as exc:
                            timing["kernel_ms"] = round((time.monotonic() - t) * 1000)
                            timing["error"] = str(exc)
                            if attempt >= request.get("repair_passes", 0): raise
                            trial_context["repair"] = {"previous_plan": plan, "error": str(exc), "scope": "Same selected bodies and original face IDs only"}
                    if cancel.is_set(): row["status"] = "canceled"
                except Exception as exc:
                    row["status"] = "canceled" if cancel.is_set() else "failed"
                    row["error"] = str(exc)[:1800]
                row["elapsed_ms"] = round((time.monotonic() - began) * 1000)
                try:
                    from backend.services.prompt_history_service import append_entry
                    from backend.services.ai_cost import usage_fields_for_history
                    usage = usage_fields_for_history(traces)
                    append_entry(root, prompt=run["prompt"], success=row["status"] == "complete", filename=row.get("glb_filename"),
                        base_filename=run["base_filename"], message=row["name"] + " · " + variant, error=row.get("error"),
                        user_id=user["id"], user_name=user.get("display_name"), model=row["model"], provider=row.get("provider"),
                        key_source=request.get("ai_key_source"), shared_key_id=request.get("ai_key_id") if request.get("ai_key_source") == "team" else None,
                        prompt_mode=run["harness"], target_mode="edit", skills=["micro-edit"], entry_id=run["id"]+str(n),
                        trace_id=hashlib.sha256(f"micro:{run['id']}:{n}".encode()).hexdigest()[:12],
                        status="complete" if row["status"] == "complete" else "failed", elapsed_ms=row["elapsed_ms"],
                        usage=usage.get("usage"), cost_usd=usage.get("cost_usd"), ai_calls=len(traces))
                except Exception as exc: row["history_warning"] = str(exc)[:200]
                try:
                    payload = {k: row.get(k) for k in ("name", "model", "variant", "status", "elapsed_ms", "validation", "glb_filename", "error")}
                    payload.update({"prompt": run["prompt"], "run_id": run["id"], "skill_version": run["skill_version"]})
                    row["feedback_event_id"] = prompt_learning.record(user["id"], run["project_id"],
                        "micro:" + run["skill_version"] + ":" + variant, "micro_edit", payload)
                except Exception as exc: row["feedback_warning"] = str(exc)[:200]
                save(root, run)
            if cancel.is_set(): break
        run["status"] = "canceled" if cancel.is_set() else "complete"
    except Exception as exc:
        run["status"] = "failed"; run["error"] = str(exc)[:1800]
    finally:
        run["elapsed_ms"] = round((time.monotonic() - start_time) * 1000)
        run["finished_at"] = now()
        save(root, run)
        shutil.rmtree(work, ignore_errors=True)
        with _LOCK: _ACTIVE.pop(run["id"], None)


def cancel(root, run_id):
    run = load(root, run_id)
    with _LOCK:
        active = _ACTIVE.get(run_id)
        if active and active["root"] == str(Path(root).resolve()): active["cancel"].set()
    return {"ok": True, "status": "canceling" if active else run["status"]}


def rate(root, user_id, filename, ratings, comment=""):
    if set(ratings) != set(RATING_CATEGORIES) or any(type(n) is not int or not 1 <= n <= 5 for n in ratings.values()):
        raise ValueError("Rate each category from 1 to 5")
    # Ratings identify an actual current project asset, and never rewrite a prompt automatically.
    from backend.services.model_followups import model
    path, revision = model(root, filename)
    for run in recent(root, limit=200):
        for row in run["results"]:
            if filename in {row.get("glb_filename"), row.get("step_filename")}:
                with _LOCK:
                    latest = load(root, run["id"])
                    target = next(r for r in latest["results"] if r["id"] == row["id"])
                    target.setdefault("ratings", {})[user_id] = {"scores": ratings, "comment": comment[:2000], "revision": revision, "at": now()}
                    save(root, latest)
                if row.get("feedback_event_id") and user_id == run["user_id"]:
                    prompt_learning.rate(user_id, row["feedback_event_id"], ratings["overall"] >= 4,
                                         json.dumps({"scores": ratings, "comment": comment[:2000]}))
                return {"ok": True, "run_id": run["id"]}
    event = prompt_learning.record(user_id, Path(root).name, "model-rating-v1", "model_rating", {
        "filename": filename, "revision": revision, "ratings": ratings, "comment": comment[:2000]})
    return {"ok": True, "feedback_event_id": event}
