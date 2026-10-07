"""Local observation harness for the sandbox teleop viewport. Simulation only."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from training_plan import next_step

HERE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("OPENARM_LAB_DATA", HERE / "runs"))
ID = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")
app = FastAPI(title="OpenArm Teleop Training Lab", description="Sandbox simulation harness")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def safe_id(value: Any) -> str:
    value = str(value or "")
    if not ID.fullmatch(value):
        raise HTTPException(400, "invalid episode id")
    return value


def paths(episode_id: str) -> tuple[Path, Path]:
    DATA.mkdir(parents=True, exist_ok=True)
    eid = safe_id(episode_id)
    return DATA / f"{eid}.json", DATA / f"{eid}.jsonl"


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise HTTPException(404, "episode not found")
    return json.loads(path.read_text())


def save_json(path: Path, obj: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":")))
    tmp.replace(path)


def finite_pose(value: Any) -> bool:
    import math

    return (
        isinstance(value, dict)
        and isinstance(value.get("position"), list)
        and isinstance(value.get("quaternion"), list)
        and len(value["position"]) == 3
        and len(value["quaternion"]) == 4
        and all(
            isinstance(x, (int, float)) and math.isfinite(x)
            for x in value["position"] + value["quaternion"]
        )
    )


@app.post("/api/start")
def start(body: dict[str, Any]) -> dict[str, Any]:
    meta, stream = paths(body.get("episode_id"))
    if meta.exists():
        raise HTTPException(409, "episode already exists")
    prompt = str(body.get("prompt") or "")[:2000]
    if not prompt.strip():
        raise HTTPException(400, "prompt required")
    state = {
        "episode_id": safe_id(body["episode_id"]),
        "prompt": prompt,
        "rig_version": str(body.get("rig_version") or ""),
        "status": "recording",
        "samples": 0,
        "last_sequence": -1,
        "last_timestamp_ms": -1,
        "latest_sample": None,
        "trials": [],
        "scope": "simulation_only",
    }
    save_json(meta, state)
    stream.write_text("")
    save_json(DATA / "latest.json", {"episode_id": state["episode_id"], "status": "recording"})
    return {"ok": True, "episode_id": state["episode_id"]}


@app.post("/api/sample")
def sample(body: dict[str, Any]) -> dict[str, Any]:
    meta, stream = paths(body.get("episode_id"))
    state = read_json(meta)
    if state["status"] != "recording":
        raise HTTPException(409, "episode is closed")
    seq, stamp = body.get("sequence"), body.get("timestamp_ms")
    if not isinstance(seq, int) or isinstance(seq, bool) or seq <= state["last_sequence"]:
        raise HTTPException(400, "non-monotonic sequence")
    if not isinstance(stamp, (int, float)) or stamp <= state["last_timestamp_ms"]:
        raise HTTPException(400, "non-monotonic timestamp")
    for name in ("head_pose", "left_grip_pose", "right_grip_pose"):
        if not finite_pose(body.get(name)):
            raise HTTPException(400, f"invalid {name}")
    payload = {key: body.get(key) for key in (
        "episode_id", "sequence", "timestamp_ms", "prompt_id", "rig_version",
        "head_pose", "left_grip_pose", "right_grip_pose", "controller_edges",
        "scene", "feature_checks", "gripper",
    )}
    with stream.open("a") as file:
        file.write(json.dumps(payload, separators=(",", ":")) + "\n")
    state.update(
        samples=state["samples"] + 1,
        last_sequence=seq,
        last_timestamp_ms=stamp,
        latest_sample=payload,
    )
    save_json(meta, state)
    save_json(DATA / "latest.json", {
        "episode_id": state["episode_id"],
        "status": state["status"],
        "sample": payload,
    })
    return {"ok": True, "samples": state["samples"]}


@app.post("/api/end")
def end(body: dict[str, Any]) -> dict[str, Any]:
    meta, _ = paths(body.get("episode_id"))
    state = read_json(meta)
    state["status"] = "closed"
    state["operator_label_success"] = bool(body.get("success"))
    save_json(meta, state)
    return {
        "ok": True,
        "samples": state["samples"],
        "note": "Operator label is not an independent validation result",
    }


@app.post("/api/trials")
def trials(body: dict[str, Any]) -> dict[str, Any]:
    meta, _ = paths(body.get("episode_id"))
    state = read_json(meta)
    rows = body.get("results")
    if not isinstance(rows, list) or len(rows) > 20:
        raise HTTPException(400, "expected at most 20 trial results")
    clean = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("success"), bool):
            raise HTTPException(400, "invalid trial")
        clean.append({
            "valid": bool(row.get("valid")),
            "success": row["success"],
            "hard_limit_violations": max(0, int(row.get("hardLimitViolations", 0))),
            "failure_mode": str(row.get("failureMode") or "")[:100],
            "origin": "viewport_synthetic",
        })
    state["trials"].extend(clean)
    save_json(meta, state)
    return {
        "ok": True,
        "plan": next_step(state["trials"]),
        "note": "Browser-reported synthetic trials are untrusted examples, not held-out proof",
    }


@app.get("/api/latest")
def latest() -> dict[str, Any]:
    path = DATA / "latest.json"
    return json.loads(path.read_text()) if path.exists() else {"status": "empty"}


@app.get("/api/episode/{episode_id}")
def episode(episode_id: str) -> dict[str, Any]:
    meta, _ = paths(episode_id)
    state = read_json(meta)
    return {**state, "plan": next_step(state["trials"])}


app.mount("/", StaticFiles(directory=HERE, html=True), name="viewport")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("OPENARM_LAB_PORT", "8765")))
