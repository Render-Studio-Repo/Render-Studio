"""Loop: snapshot Agent_Introductions until PM handshake phrase, then record elapsed."""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "logs" / "Agent_Introductions"
PHRASE = "deez nutz"
TZ = ZoneInfo("America/Chicago")
STOP_HOUR = datetime(2026, 9, 16, 19, 0, tzinfo=TZ)


def _now() -> str:
    return datetime.now(TZ).isoformat()


def snapshot(loop: int, extra: dict) -> None:
    dest = PACK / "loop" / "snapshots" / f"loop-{loop:04d}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"loop": loop, "ts": _now(), **extra}, indent=2) + "\n", encoding="utf-8")


def pm_said_phrase() -> bool:
    path = PACK / "handshake" / "project-manager.json"
    if not path.is_file():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return bool(data.get("ok"))


def main() -> int:
    started = time.perf_counter()
    loop = 0
    while datetime.now(TZ) < STOP_HOUR:
        loop += 1
        done = pm_said_phrase()
        snapshot(loop, {"pm_ok": done, "elapsed_s": round(time.perf_counter() - started, 3)})
        if done:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            rec = {"ok": True, "loops": loop, "elapsed_ms": elapsed_ms, "ts": _now(), "phrase": PHRASE}
            (PACK / "handshake" / "loop-done.json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(rec))
            return 0
        time.sleep(15)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    rec = {"ok": False, "loops": loop, "elapsed_ms": elapsed_ms, "ts": _now(), "reason": "stopped-19:00"}
    (PACK / "handshake" / "loop-timeout.json").write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(rec))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
