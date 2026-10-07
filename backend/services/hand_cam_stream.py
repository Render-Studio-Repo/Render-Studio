"""Optional local hand-camera JPEG snapshots. No QuickTime. Skip FaceTime."""

from __future__ import annotations

import json
import os
import re
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

# Minimal 2x2 gray JPEG so the headset always has a texture without a webcam.
_PLACEHOLDER_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc00011080002000203012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda000c03010002110311003f00aa940034ffd9"
)

_PUBLISH = False
_CACHE: dict[str, tuple[float, bytes, bool]] = {}
_CACHE_TTL = 0.04
_CAPS: dict[str, object] = {}
_DEVICE_TTL = 30.0
_EMPTY_DEVICE_TTL = 1.5
_device_cache: tuple[float, tuple[int | None, int | None]] = (0.0, (None, None))
_device_names: list[tuple[int, str]] = []
_device_records: list[dict[str, object]] = []
_REASONS: dict[str, str] = {}
_LABELS: dict[str, object] = {"devices": {}, "titles": {"left": "Left", "right": "Right"}}
_LABELS_LOADED = False
_LABELS_LOCK = threading.Lock()
_SPAWNED: list[subprocess.Popen] = []
_SPAWN_LOCK = threading.Lock()
_GRAB_LOCK = threading.RLock()
_SIDE_LOCKS = {"left": threading.Lock(), "right": threading.Lock()}
_RESOLVE_LOCK = threading.RLock()
_OPEN_LOCK = threading.Lock()
_WORKER_LOCK = threading.Lock()
_WORKERS: dict[str, threading.Thread] = {}
_WORKER_STOP: dict[str, threading.Event] = {}
_STREAMS: dict[str, subprocess.Popen] = {}
_GRAB_EPOCH = 0
_RELEASE_WAIT = 0.4
_LAST_GOOD: dict[str, tuple[float, bytes]] = {}
_CAP_IDX: dict[str, int] = {}
_OPEN_WAIT: dict[str, tuple[int, float]] = {}
_READ_MISS: dict[str, int] = {}
_HOTPLUG_HOLD = 1.2
_OPEN_STABLE = 0.4
_LIVE_HOLD = 1.8
_STREAM_STALL_SEC = 3.5
_STREAM_FIRST_FRAME_SEC = 12.0
HAND_CAM_MJPEG_BOUNDARY = "frame"
_READ_MISS_MAX = 3
_device_pending: tuple[float, tuple[int | None, int | None]] | None = None
_HANDCAM_FF_RE = re.compile(r"(?i)(/render-studio/\.venv(?:-mac)?/bin/ffmpeg)")
_HANDCAM_DEST_RE = re.compile(r"(?i)(/tmp/handcam|handcam[-_])")
_BUSY_RE = re.compile(
    r"timed out|busy|in use|resource busy|cannot open|already (?:open|in use)|input/output error|device or resource busy",
    re.I,
)

_FACE_RE = re.compile(r"facetime", re.I)
_SCREEN_RE = re.compile(r"capture screen", re.I)
_SKIP_RE = re.compile(r"facetime|capture screen", re.I)
_WRIST_RE = re.compile(r"wrist|hand.?cam|arducam|openarm|b0495|ov9782|ov9281|usb.?camera|uvc camera", re.I)
UNPLUGGED_REASON = "no wrist USB camera plugged in"
ONLY_CAPTURE_SCREEN_REASON = "no wrist USB camera plugged in (only Capture screen)"
ONLY_FACETIME_REASON = "no wrist USB camera, only FaceTime"
_AV_INDEX_RE = re.compile(r"\[(\d+)\]\s+(.+)$")
_PERM_RE = re.compile(
    r"not (?:authorized|permitted|allowed)|permission denied|cannot open|operation not permitted|tcc|open timed out",
    re.I,
)
_PROFILER_NAME_RE = re.compile(r"^    (\S.+):\s*$")
_USB_VID_PID_RE = re.compile(r"VendorID_(\d+)\s+ProductID_(\d+)", re.I)
_UID_LINE_RE = re.compile(r"Unique ID:\s*(\S+)", re.I)
_MODEL_LINE_RE = re.compile(r"Model ID:\s*(.+)$", re.I)
_APP_BUNDLE_RE = re.compile(r"([^/]+\.app)(?:/|$)")
_PYTHON_APP_RE = re.compile(r"(.+?/Python\.app)(?:/|$)", re.I)
_FRAMEWORK_PY_RE = re.compile(r"(.+/Python3?\.framework/Versions/[^/]+)", re.I)

CAMERA_PRIVACY_URLS = (
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Camera",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
)
CLT_PYTHON_APP_EXES = (
    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python",
    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.10/Resources/Python.app/Contents/MacOS/Python",
    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.11/Resources/Python.app/Contents/MacOS/Python",
    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python",
    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python",
)
PYTHON_CAMERA_HELPER = "Check the Mac for a Camera prompt for Python."
FFMPEG_ALLOWED_PYTHON_DENIED = "ffmpeg allowed, Python.app still needs Camera"
PYTHON_CAMERA_SNIPPET = (
    "import cv2,time;"
    "c=cv2.VideoCapture({idx},getattr(cv2,'CAP_AVFOUNDATION',0));"
    "c.read();time.sleep(1.2);c.release()"
)


def _release_caps() -> None:
    for cap in list(_CAPS.values()):
        try:
            cap.release()  # type: ignore[union-attr]
        except Exception:
            pass
    _CAPS.clear()
    _CAP_IDX.clear()


def _release_cap(side: str) -> None:
    """Close one wrist capture without touching the other side."""
    which = "right" if str(side).lower() == "right" else "left"
    cap = _CAPS.pop(which, None)
    _CAP_IDX.pop(which, None)
    _OPEN_WAIT.pop(which, None)
    _READ_MISS.pop(which, None)
    if cap is None:
        return
    try:
        cap.release()  # type: ignore[union-attr]
    except Exception:
        pass


def is_hand_cam_child_cmdline(text: str) -> bool:
    """True for Studio hand-cam ffmpeg/cv2 children — never uvicorn or other ffmpeg."""
    line = str(text or "").strip()
    if not line:
        return False
    low = line.lower()
    if "uvicorn" in low or "backend.main" in low:
        return False
    if "list_devices" in low:
        return False
    if "ffmpeg" in low:
        if "avfoundation" not in low:
            return False
        project = bool(_HANDCAM_FF_RE.search(low))
        dest = bool(_HANDCAM_DEST_RE.search(low))
        # Venv ffmpeg grabbing AVFoundation is ours even if ps truncated the dest path.
        if project:
            return True
        return dest
    tokens = line.split()
    if "videocapture" in low and "cv2" in low and "-c" in tokens:
        return True
    return False


def _pid_is_descendant(pid: int, ancestor: int) -> bool:
    if pid <= 1 or ancestor <= 1:
        return False
    seen: set[int] = set()
    cur = int(pid)
    for _ in range(16):
        if cur <= 1 or cur in seen:
            return False
        if cur == ancestor:
            return True
        seen.add(cur)
        try:
            row = subprocess.check_output(
                ["ps", "-o", "ppid=", "-p", str(cur)],
                text=True,
                timeout=1,
            ).strip()
            cur = int(row.split()[0])
        except Exception:
            return False
    return False


def _is_studio_avfoundation_holder(pid: int, cmd: str) -> bool:
    """Stuck wrist-cam ffmpeg started by this Studio process (any ffmpeg path)."""
    if is_hand_cam_child_cmdline(cmd):
        return True
    low = str(cmd or "").lower()
    if "ffmpeg" not in low or "avfoundation" not in low or "list_devices" in low:
        return False
    if "uvicorn" in low or "backend.main" in low:
        return False
    return _pid_is_descendant(int(pid), os.getpid())


def _iter_process_rows() -> list[tuple[int, str]]:
    try:
        out = subprocess.check_output(
            ["ps", "-ax", "-o", "pid=,command="],
            text=True,
            timeout=3,
        )
    except Exception:
        return []
    rows: list[tuple[int, str]] = []
    for raw in out.splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) < 2:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        rows.append((pid, parts[1]))
    return rows


def _safe_kill(pid: int, sig: int = signal.SIGTERM) -> bool:
    me = os.getpid()
    if pid <= 1 or pid == me:
        return False
    try:
        my_pgid = os.getpgid(me)
    except OSError:
        my_pgid = None
    try:
        pgid = os.getpgid(pid)
    except OSError:
        pgid = None
    try:
        if pgid and pgid == pid and pgid != my_pgid:
            os.killpg(pgid, sig)
        else:
            os.kill(pid, sig)
        return True
    except ProcessLookupError:
        return False
    except OSError:
        try:
            os.kill(pid, sig)
            return True
        except OSError:
            return False


def _kill_popen(proc: subprocess.Popen) -> bool:
    if proc.poll() is not None:
        return False
    pid = int(proc.pid or 0)
    sent = _safe_kill(pid)
    try:
        proc.wait(timeout=0.4)
    except subprocess.TimeoutExpired:
        _safe_kill(pid, signal.SIGKILL)
        try:
            proc.wait(timeout=0.4)
        except subprocess.TimeoutExpired:
            pass
    return sent or proc.poll() is not None


def _track_popen(proc: subprocess.Popen, timeout: float | None = None) -> None:
    with _SPAWN_LOCK:
        _SPAWNED.append(proc)
    if not timeout or timeout <= 0:
        return

    def _reap() -> None:
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_popen(proc)

    threading.Thread(target=_reap, name="hand-cam-reap", daemon=True).start()


def _forget_popen(proc: subprocess.Popen | None) -> None:
    if proc is None:
        return
    with _SPAWN_LOCK:
        try:
            _SPAWNED.remove(proc)
        except ValueError:
            pass


def _camera_name_for_index(idx: int) -> str:
    want = int(idx)
    for i, name in _device_names:
        if i == want:
            return str(name or "")
    for rec in _device_records:
        if rec.get("index") == want:
            return str(rec.get("name") or "")
    return ""


def is_skippable_camera_index(idx: int, *, refresh: bool = False) -> bool:
    """Refuse FaceTime / Capture screen — never grab AVFoundation index 0 when it is a screen."""
    name = _camera_name_for_index(idx)
    if not name and (refresh or not _device_names):
        try:
            resolve_wrist_devices(refresh=True)
        except Exception:
            pass
        name = _camera_name_for_index(idx)
    if name:
        return _is_skipped_camera(name)
    left, right = _device_cache[1]
    if left is None and right is None and _device_names:
        return True
    return False


def kill_hand_cam_children() -> int:
    """Free leftover hand-cam ffmpeg/cv2 so a Wrist Cam restart can reopen the USB cam."""
    _release_caps()
    killed: set[int] = set()
    with _SPAWN_LOCK:
        procs = list(_SPAWNED)
        _SPAWNED.clear()
    for proc in procs:
        pid = int(proc.pid or 0)
        if _kill_popen(proc) and pid:
            killed.add(pid)
    for pid, cmd in _iter_process_rows():
        if pid in killed or pid == os.getpid():
            continue
        if _is_studio_avfoundation_holder(pid, cmd) and _safe_kill(pid):
            killed.add(pid)
    if killed:
        time.sleep(0.12)
        for pid, cmd in _iter_process_rows():
            if _is_studio_avfoundation_holder(pid, cmd):
                _safe_kill(pid, signal.SIGKILL)
                killed.add(pid)
    return len(killed)


def _worker_alive(side: str) -> bool:
    which = "right" if str(side).lower() == "right" else "left"
    thread = _WORKERS.get(which)
    return bool(thread is not None and thread.is_alive())


def _grabbers_busy() -> bool:
    return bool(_CAPS) or bool(_STREAMS) or _worker_alive("left") or _worker_alive("right")


def _commit_live(side: str, frame: bytes) -> None:
    which = "right" if str(side).lower() == "right" else "left"
    if not frame or is_placeholder_jpeg(frame):
        return
    stamp = time.monotonic()
    with _GRAB_LOCK:
        _LAST_GOOD[which] = (stamp, frame)
        _CACHE[which] = (stamp, frame, True)
    _set_reason(which, "")


def _stop_grab_workers() -> None:
    with _WORKER_LOCK:
        stops = list(_WORKER_STOP.values())
        threads = list(_WORKERS.values())
        _WORKER_STOP.clear()
        _WORKERS.clear()
        streams = dict(_STREAMS)
        _STREAMS.clear()
    for ev in stops:
        ev.set()
    for proc in streams.values():
        try:
            _kill_popen(proc)
        except Exception:
            pass
    for thread in threads:
        try:
            thread.join(timeout=0.45)
        except Exception:
            pass


def _ensure_grab_workers() -> None:
    """One long-lived grabber thread per wrist — not one global ffmpeg."""
    if not _PUBLISH:
        return
    with _WORKER_LOCK:
        if not _PUBLISH:
            return
        epoch = _GRAB_EPOCH
        for side in ("left", "right"):
            thread = _WORKERS.get(side)
            if thread is not None and thread.is_alive():
                continue
            stop = threading.Event()
            _WORKER_STOP[side] = stop
            thread = threading.Thread(
                target=_worker_loop,
                args=(side, stop, epoch),
                name=f"hand-cam-{side}",
                daemon=True,
            )
            _WORKERS[side] = thread
            thread.start()


def _ffmpeg_avfoundation_input(idx: int) -> list[str]:
    """Arducam B0495 is 960x600@10 — do not force 30fps."""
    return [
        "-f",
        "avfoundation",
        "-pixel_format",
        "uyvy422",
        "-framerate",
        "10",
        "-i",
        str(int(idx)),
    ]


def _ffmpeg_stream_cmd(ff: str, idx: int) -> list[str]:
    # Match the proven Arducam pipe. Extra -fflags on this ffmpeg 6/AVFoundation
    # build exits before the first JPEG (restart loop, empty 503s).
    return [
        ff,
        "-hide_banner",
        "-loglevel",
        "error",
        *_ffmpeg_avfoundation_input(idx),
        "-an",
        "-q:v",
        "5",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]


def _take_latest_jpeg(buf: bytearray) -> bytes | None:
    """Keep the newest complete JPEG; drop queued older frames in stdout."""
    last: bytes | None = None
    consumed = 0
    search = 0
    while True:
        start = buf.find(b"\xff\xd8", search)
        if start < 0:
            if consumed:
                del buf[:consumed]
            elif len(buf) > 4_000_000:
                del buf[:-65536]
            return last
        end = buf.find(b"\xff\xd9", start + 2)
        if end < 0:
            if start:
                del buf[:start]
            return last
        last = bytes(buf[start : end + 2])
        consumed = end + 2
        search = consumed


def _run_ffmpeg_stream(side: str, idx: int, stop: threading.Event) -> None:
    """Keep one ffmpeg open and parse MJPEG; JPEG HTTP only reads latest frame."""
    which = "right" if str(side).lower() == "right" else "left"
    if is_skippable_camera_index(int(idx)):
        _set_reason(which, "skip Capture screen / FaceTime")
        return
    ff = _ffmpeg_bin()
    if not ff:
        _set_reason(which, "ffmpeg not found (cv2 missing)")
        return
    cmd = _ffmpeg_stream_cmd(ff, int(idx))
    proc: subprocess.Popen | None = None
    try:
        with _OPEN_LOCK:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                start_new_session=True,
            )
            # AVFoundation exclusive-open: serialize wrists and wait for the
            # device lock before the other wrist (or a restart) tries.
            time.sleep(0.55)
    except Exception as exc:
        _set_reason(which, str(exc)[:180])
        return
    _STREAMS[which] = proc
    _track_popen(proc)

    def _drain_err() -> None:
        try:
            if proc.stderr:
                proc.stderr.read()
        except Exception:
            pass

    threading.Thread(target=_drain_err, name=f"hand-cam-err-{which}", daemon=True).start()
    buf = bytearray()
    last_jpeg = time.monotonic()
    got_frame = False
    try:
        while not stop.is_set() and proc.poll() is None and _PUBLISH:
            stdout = proc.stdout
            if stdout is None:
                break
            try:
                ready, _, _ = select.select([stdout], [], [], 0.35)
            except (OSError, ValueError, select.error):
                break
            if not ready:
                stall = _STREAM_STALL_SEC if got_frame else _STREAM_FIRST_FRAME_SEC
                if time.monotonic() - last_jpeg > stall:
                    _kill_popen(proc)
                    break
                continue
            chunk = stdout.read(65536)
            if not chunk:
                break
            buf.extend(chunk)
            jpeg = _take_latest_jpeg(buf)
            if jpeg and not is_placeholder_jpeg(jpeg):
                _commit_live(which, jpeg)
                last_jpeg = time.monotonic()
                got_frame = True
    finally:
        if _STREAMS.get(which) is proc:
            _STREAMS.pop(which, None)
        _forget_popen(proc)
        if proc.poll() is None:
            _kill_popen(proc)


def _worker_loop(side: str, stop: threading.Event, epoch: int) -> None:
    which = "right" if str(side).lower() == "right" else "left"
    try:
        _worker_loop_inner(which, stop, epoch)
    except Exception as exc:
        _set_reason(which, str(exc)[:180])


def _looks_unplugged(reason: str) -> bool:
    text = str(reason or "").lower()
    return bool(
        text
        and (
            "plugged in" in text
            or "only facetime" in text
            or "only capture screen" in text
            or "no usb camera" in text
        )
    )


def _worker_loop_inner(which: str, stop: threading.Event, epoch: int) -> None:
    if which == "right":
        stop.wait(0.85)
    while not stop.is_set() and _PUBLISH and epoch == _GRAB_EPOCH:
        left_i, right_i, names = resolve_wrist_devices()
        idx = right_i if which == "right" else left_i
        if idx is None:
            listed = "AVFoundation video devices:\n" + "\n".join(f"[{i}] {name}" for i, name in names)
            _set_reason(
                which,
                empty_stream_reason(listed, which, assigned=(left_i, right_i)) or UNPLUGGED_REASON,
            )
            stop.wait(0.45)
            continue
        # Persistent ffmpeg per wrist. cv2 VideoCapture from these threads hangs
        # AVFoundation and never returns a frame.
        _run_ffmpeg_stream(which, int(idx), stop)
        if stop.is_set() or not _PUBLISH or epoch != _GRAB_EPOCH:
            break
        # Stagger every reopen, not just the first, so left/right do not
        # fight AVFoundation after a brief stall.
        stop.wait(0.85 if which == "right" else 0.35)


def release_wrist_cameras(*, wait: float | None = None) -> int:
    """Close our capture, kill leftover grab PIDs, then pause so macOS releases the USB cam."""
    global _GRAB_EPOCH
    _GRAB_EPOCH += 1
    _stop_grab_workers()
    killed = kill_hand_cam_children()
    invalidate_device_cache()
    _CACHE.clear()
    _LAST_GOOD.clear()
    _OPEN_WAIT.clear()
    _READ_MISS.clear()
    _REASONS.clear()
    if wait is None:
        delay = _RELEASE_WAIT if killed else 0.0
    else:
        delay = float(wait)
    if delay > 0:
        time.sleep(delay)
    return killed


def invalidate_device_cache() -> None:
    global _device_cache, _device_names, _device_records, _device_pending
    _device_cache = (0.0, (None, None))
    _device_names = []
    _device_records = []
    _device_pending = None
    _CACHE.clear()


def _app_from_path(path: str) -> str:
    match = _APP_BUNDLE_RE.search(str(path or ""))
    return match.group(1) if match else ""


def capture_app_name() -> str:
    """Bundle that TCC should list for this Studio capture process (lsof :8001)."""
    found: list[str] = []
    exe = _app_from_path(sys.executable or "")
    if exe:
        found.append(exe)
    pid = os.getpid()
    seen: set[int] = set()
    for _ in range(10):
        if not pid or pid in seen or pid <= 1:
            break
        seen.add(pid)
        try:
            row = subprocess.check_output(
                ["ps", "-o", "ppid=,command=", "-p", str(pid)],
                text=True,
                timeout=1,
            ).strip()
        except Exception:
            break
        parts = row.split(None, 1)
        if len(parts) < 2:
            break
        try:
            parent = int(parts[0])
        except ValueError:
            break
        bundle = _app_from_path(parts[1])
        if bundle and bundle not in found:
            found.append(bundle)
        pid = parent
    preferred = ("Cursor.app", "Terminal.app", "iTerm.app", "Code.app", "Python.app")
    for name in preferred:
        if name in found:
            return name
    return found[0] if found else "Python.app"


def _is_exec(path: str | Path) -> bool:
    try:
        return Path(path).is_file() and os.access(path, os.X_OK)
    except OSError:
        return False


def _python_app_binary(path: str) -> str:
    """Map a venv/framework python to Python.app/Contents/MacOS/Python for TCC."""
    text = str(path or "")
    if not text:
        return ""
    app = _PYTHON_APP_RE.search(text)
    if app:
        exe = Path(app.group(1)) / "Contents" / "MacOS" / "Python"
        if _is_exec(exe):
            return str(exe)
    framework = _FRAMEWORK_PY_RE.search(text)
    if framework:
        exe = Path(framework.group(1)) / "Resources" / "Python.app" / "Contents" / "MacOS" / "Python"
        if _is_exec(exe):
            return str(exe)
    return ""


def capture_python_exe() -> str:
    """Same Python.app that serves :8001 — not a venv shim — so TCC lists Python."""
    seen: list[str] = [sys.executable or "", os.path.realpath(sys.executable or "")]
    pid = os.getpid()
    walked: set[int] = set()
    for _ in range(10):
        if not pid or pid in walked or pid <= 1:
            break
        walked.add(pid)
        try:
            row = subprocess.check_output(
                ["ps", "-o", "ppid=,command=", "-p", str(pid)],
                text=True,
                timeout=1,
            ).strip()
        except Exception:
            break
        parts = row.split(None, 1)
        if len(parts) < 2:
            break
        seen.append(parts[1])
        try:
            pid = int(parts[0])
        except ValueError:
            break
    for item in seen:
        hit = _python_app_binary(item)
        if hit:
            return hit
    for known in CLT_PYTHON_APP_EXES:
        if _is_exec(known):
            return known
    return sys.executable or "python3"


def _venv_site_packages() -> str:
    root = Path(__file__).resolve().parents[2]
    ver = f"python{sys.version_info.major}.{sys.version_info.minor}"
    for base in (root / ".venv", root / ".venv-mac"):
        site = base / "lib" / ver / "site-packages"
        if site.is_dir():
            return str(site)
    return ""


def python_camera_open_cmd(idx: int = 0) -> list[str]:
    """CLI that opens AVFoundation as Python.app — same idea as running ffmpeg."""
    return [capture_python_exe(), "-c", PYTHON_CAMERA_SNIPPET.format(idx=int(idx))]


def python_camera_open_cli(idx: int = 0) -> str:
    return subprocess.list2cmdline(python_camera_open_cmd(idx))


def _spawn_cli(
    cmd: list[str],
    env: dict[str, str] | None = None,
    *,
    timeout: float | None = 6.0,
) -> dict[str, object]:
    try:
        proc = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        _track_popen(proc, timeout=timeout)
        return {"ok": True, "pid": proc.pid, "cmd": cmd, "cli": subprocess.list2cmdline(cmd)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:180], "cmd": cmd, "cli": subprocess.list2cmdline(cmd)}


def spawn_python_camera_cli(idx: int = 0) -> dict[str, object]:
    if is_skippable_camera_index(int(idx)):
        return {
            "ok": False,
            "error": "skip Capture screen / FaceTime",
            "cmd": [],
            "cli": "",
        }
    env = os.environ.copy()
    site = _venv_site_packages()
    if site:
        prev = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = site if not prev else f"{site}{os.pathsep}{prev}"
    return _spawn_cli(python_camera_open_cmd(idx), env, timeout=4.0)


def spawn_ffmpeg_camera_cli(idx: int = 0) -> dict[str, object]:
    if is_skippable_camera_index(int(idx)):
        return {
            "ok": False,
            "error": "skip Capture screen / FaceTime",
            "cmd": [],
            "cli": "",
        }
    ff = _ffmpeg_bin()
    if not ff:
        return {"ok": False, "error": "ffmpeg not found", "cmd": [], "cli": ""}
    dest = f"/tmp/handcam-perm-{int(idx)}.jpg"
    cmd = [
        ff,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-framerate",
        "30",
        "-i",
        str(int(idx)),
        "-frames:v",
        "1",
        "-y",
        dest,
    ]
    return _spawn_cli(cmd, timeout=4.0)


def camera_permission_helper(app: str = "") -> str:
    void = app
    return PYTHON_CAMERA_HELPER


def open_camera_privacy_pane() -> bool:
    if sys.platform != "darwin":
        return False
    opener = shutil.which("open")
    if not opener:
        return False
    opened = False
    for url in CAMERA_PRIVACY_URLS:
        try:
            proc = subprocess.run(
                [opener, url],
                capture_output=True,
                text=True,
                timeout=4,
                check=False,
            )
            if proc.returncode == 0:
                opened = True
        except Exception:
            continue
    return opened


def _probe_device_open(idx: int, timeout: float = 3.0) -> tuple[bool, str]:
    """Prefer already-allowed ffmpeg; cv2 is the Python.app TCC path."""
    if is_skippable_camera_index(int(idx)):
        return False, "skip Capture screen / FaceTime"
    frame, err = _grab_ffmpeg(int(idx), timeout=min(float(timeout), 3.0))
    if frame:
        return True, ""
    return False, err or f"could not open USB camera {idx}"


def _usable_wrist_index() -> tuple[int | None, list[tuple[int, str]]]:
    left_i, right_i, names = resolve_wrist_devices(refresh=True)
    if left_i is not None:
        return int(left_i), names
    if right_i is not None:
        return int(right_i), names
    return None, names


def request_camera_permission() -> dict[str, object]:
    """Spawn Python.app camera CLI immediately (like running ffmpeg). Do not wait."""
    app = capture_app_name()
    set_publish(True, restart=True)
    idx, names = _usable_wrist_index()
    invalidate_device_cache()
    if idx is None:
        spawned = {"ok": False, "error": "no wrist USB camera", "cmd": [], "cli": ""}
        ffmpeg_spawned = {"ok": False, "error": "no wrist USB camera", "cmd": [], "cli": ""}
    else:
        spawned = spawn_python_camera_cli(idx)
        ffmpeg_spawned = spawn_ffmpeg_camera_cli(idx)
    result: dict[str, object] = {
        "ok": True,
        "publish": True,
        "app": app,
        "pythonExe": capture_python_exe(),
        "cli": spawned.get("cli") or (python_camera_open_cli(idx) if idx is not None else ""),
        "deviceIndex": idx,
        "devices": [{"index": i, "name": name} for i, name in names],
        "privacyOpened": False,
        "prompted": bool(spawned.get("ok")),
        "live": False,
        "helper": camera_permission_helper(app),
        "reason": last_stream_reason("left") or PYTHON_CAMERA_HELPER,
        "ffmpegCli": ffmpeg_spawned.get("cli") or "",
    }

    def _kick() -> None:
        if idx is None:
            _set_reason("left", "no USB camera plugged in")
            return
        ok, err = _probe_device_open(idx, timeout=2.0)
        if ok:
            _set_reason("left", "")
        elif err:
            _set_reason("left", snapshot_reason_from(err))

    threading.Thread(target=_kick, name="hand-cam-tcc", daemon=True).start()
    return result


def set_publish(on: bool, *, restart: bool = False) -> bool:
    global _PUBLISH
    want = bool(on)
    if not want:
        release_wrist_cameras()
        with _GRAB_LOCK:
            _PUBLISH = False
        return False
    if restart:
        # Kill hung ffmpeg first — do not wait on the grab lock (it can be held
        # for the open timeout while the Arducam is already stuck).
        release_wrist_cameras(wait=_RELEASE_WAIT)
        with _GRAB_LOCK:
            _PUBLISH = True
        return True
    if not _PUBLISH:
        release_wrist_cameras()
        with _GRAB_LOCK:
            _PUBLISH = True
        return True
    _PUBLISH = True
    return True


def is_publish_on() -> bool:
    return _PUBLISH


def placeholder_jpeg(side: str = "left") -> bytes:
    void = side
    return _PLACEHOLDER_JPEG


def is_placeholder_jpeg(data: bytes | None) -> bool:
    if not data:
        return True
    if data == _PLACEHOLDER_JPEG:
        return True
    return len(data) < 80


def last_stream_reason(side: str = "left") -> str:
    which = "right" if str(side).lower() == "right" else "left"
    return _REASONS.get(which) or _REASONS.get("*") or ""


def snapshot_reason_from(reason: str) -> str:
    text = str(reason or "").strip()
    if _looks_like_permission(text) and _ffmpeg_bin():
        return FFMPEG_ALLOWED_PYTHON_DENIED
    return text


def snapshot_reason(side: str = "left") -> str:
    return snapshot_reason_from(last_stream_reason(side))


def parse_avfoundation_devices(text: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    in_video = False
    for line in str(text or "").splitlines():
        if "AVFoundation video devices" in line:
            in_video = True
            continue
        if in_video and "AVFoundation audio devices" in line:
            break
        if not in_video:
            continue
        match = _AV_INDEX_RE.search(line)
        if match:
            out.append((int(match.group(1)), match.group(2).strip()))
    return out


def parse_system_profiler_cameras(text: str) -> list[str]:
    names: list[str] = []
    for line in str(text or "").splitlines():
        match = _PROFILER_NAME_RE.match(line)
        if not match:
            continue
        name = match.group(1).strip().rstrip(":")
        if name.lower() in {"camera", "model id", "unique id", "manufacturer"}:
            continue
        names.append(name)
    return names


def parse_system_profiler_camera_records(text: str) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for line in str(text or "").splitlines():
        match = _PROFILER_NAME_RE.match(line)
        if match:
            name = match.group(1).strip().rstrip(":")
            if name.lower() in {"camera", "model id", "unique id", "manufacturer"}:
                continue
            if current:
                records.append(current)
            current = {"name": name, "uniqueId": "", "modelId": "", "usb": "", "usbDec": ""}
            continue
        if not current:
            continue
        uid = _UID_LINE_RE.search(line)
        if uid:
            current["uniqueId"] = uid.group(1).strip()
        model = _MODEL_LINE_RE.search(line)
        if model:
            current["modelId"] = model.group(1).strip()
            usb = _USB_VID_PID_RE.search(current["modelId"])
            if usb:
                vid, pid = int(usb.group(1)), int(usb.group(2))
                current["usbDec"] = f"{vid}:{pid}"
                current["usb"] = f"{vid:04x}:{pid:04x}"
    if current:
        records.append(current)
    return records


def _norm_cam_name(name: str) -> str:
    text = re.sub(r"\s+", " ", str(name or "").strip().lower())
    text = re.sub(r"\s*\(usb[^)]*\)\s*$", "", text)
    return re.sub(r"\s*\(.*\)$", "", text).strip() or text


def camera_identity_keys(record: dict[str, object]) -> list[str]:
    keys: list[str] = []
    uid = str(record.get("uniqueId") or "").strip()
    if uid:
        keys.append(f"uid:{uid.lower()}")
    usb = str(record.get("usb") or "").strip().lower()
    if usb:
        keys.append(f"usb:{usb}")
    usb_dec = str(record.get("usbDec") or "").strip()
    if usb_dec:
        keys.append(f"usb:{usb_dec}")
    name = _norm_cam_name(str(record.get("name") or ""))
    if name:
        keys.append(f"name:{name}")
    return keys


def sanitize_camera_label_map(payload: dict[str, object] | None) -> dict[str, object]:
    devices_raw = payload.get("devices") if isinstance(payload, dict) else None
    titles_raw = payload.get("titles") if isinstance(payload, dict) else None
    if isinstance(payload, dict) and devices_raw is None and "side" not in str(payload.keys()):
        devices_raw = {k: v for k, v in payload.items() if k not in {"titles", "devices"}}
    devices: dict[str, dict[str, object]] = {}
    if isinstance(devices_raw, dict):
        for key, entry in devices_raw.items():
            token = str(key or "").strip()[:180]
            if not token or not isinstance(entry, dict):
                continue
            requested = str(entry.get("side") or "").lower()
            side = requested if requested in {"left", "right", "pov"} else "left"
            display = str(entry.get("displayName") or "").strip()[:80]
            extra = [str(x).strip()[:180] for x in (entry.get("keys") or []) if str(x).strip()]
            keys = []
            for item in [token, *extra]:
                low = item.lower()
                if low and low not in keys:
                    keys.append(low)
            devices[token] = {"side": side, "displayName": display, "keys": keys[:16]}
    titles = {"left": "Left", "right": "Right", "pov": "Robot POV"}
    if isinstance(titles_raw, dict):
        for side in ("left", "right", "pov"):
            label = str(titles_raw.get(side) or "").strip()[:80]
            if label:
                titles[side] = label
    return {"devices": devices, "titles": titles}


def _labels_path() -> Path:
    try:
        from backend.config import settings

        return Path(settings.data_dir) / "hand_cam_labels.json"
    except Exception:
        return Path(__file__).resolve().parents[2] / "data" / "hand_cam_labels.json"


def get_camera_label_map() -> dict[str, object]:
    global _LABELS, _LABELS_LOADED
    with _LABELS_LOCK:
        if not _LABELS_LOADED:
            _LABELS_LOADED = True
            try:
                raw = json.loads(_labels_path().read_text(encoding="utf-8"))
                _LABELS = sanitize_camera_label_map(raw if isinstance(raw, dict) else {})
            except Exception:
                pass
        return {
            "devices": dict(_LABELS.get("devices") or {}),
            "titles": dict(_LABELS.get("titles") or {"left": "Left", "right": "Right"}),
        }


def set_camera_label_map(payload: dict[str, object] | None, *, persist: bool = True) -> dict[str, object]:
    global _LABELS, _LABELS_LOADED
    cleaned = sanitize_camera_label_map(payload or {})
    with _LABELS_LOCK:
        _LABELS = cleaned
        _LABELS_LOADED = True
        if persist:
            path = _labels_path()
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(cleaned, indent=2), encoding="utf-8")
            except OSError:
                pass
    invalidate_device_cache()
    return get_camera_label_map()


def lookup_camera_label(record: dict[str, object], labels: dict[str, object] | None) -> dict[str, object] | None:
    devices = labels if isinstance(labels, dict) else {}
    if "devices" in devices and isinstance(devices.get("devices"), dict):
        devices = devices["devices"]  # type: ignore[assignment]
    identity = {k.lower() for k in camera_identity_keys(record)}
    for stored_key, entry in devices.items():
        if not isinstance(entry, dict):
            continue
        stored = {str(stored_key).lower(), *[str(k).lower() for k in (entry.get("keys") or [])]}
        if identity & stored:
            return entry
    return None


def merge_camera_records(
    av_names: list[tuple[int, str]],
    profiler: list[dict[str, str]] | None = None,
) -> list[dict[str, object]]:
    leftover = list(profiler or [])
    out: list[dict[str, object]] = []
    for index, name in av_names:
        rec: dict[str, object] = {
            "index": int(index),
            "name": name,
            "uniqueId": "",
            "modelId": "",
            "usb": "",
            "usbDec": "",
            "skipped": _is_skipped_camera(name),
        }
        match_i = -1
        want = _norm_cam_name(name)
        for i, prof in enumerate(leftover):
            got = _norm_cam_name(prof.get("name") or "")
            if want and (want == got or want in got or got in want):
                match_i = i
                break
        if match_i < 0 and len(leftover) == 1 and len(av_names) == 1:
            match_i = 0
        if match_i >= 0:
            prof = leftover.pop(match_i)
            rec["uniqueId"] = prof.get("uniqueId") or ""
            rec["modelId"] = prof.get("modelId") or ""
            rec["usb"] = prof.get("usb") or ""
            rec["usbDec"] = prof.get("usbDec") or ""
            if not rec.get("name"):
                rec["name"] = prof.get("name") or name
        rec["keys"] = camera_identity_keys(rec)
        out.append(rec)
    return out


def assign_wrist_sides(
    records: list[dict[str, object]],
    labels: dict[str, object] | None = None,
) -> tuple[int | None, int | None]:
    """Map devices to Left/Right using persisted labels; default first usable to Left."""
    usable = [r for r in records if not r.get("skipped")]
    preferred = [r for r in usable if _WRIST_RE.search(str(r.get("name") or ""))]
    pool = preferred or usable
    label_devices = labels or {}
    if isinstance(label_devices, dict) and isinstance(label_devices.get("devices"), dict):
        label_devices = label_devices["devices"]  # type: ignore[assignment]
    left: int | None = None
    right: int | None = None
    claimed: set[int] = set()
    for rec in pool:
        hit = lookup_camera_label(rec, label_devices)
        if not hit:
            continue
        idx = rec.get("index")
        if not isinstance(idx, int):
            continue
        side = str(hit.get("side") or "left").lower()
        if side == "right" and right is None:
            right = idx
            claimed.add(id(rec))
        elif side != "right" and left is None:
            left = idx
            claimed.add(id(rec))
    for rec in pool:
        if id(rec) in claimed:
            continue
        idx = rec.get("index")
        if not isinstance(idx, int):
            continue
        if left is None:
            left = idx
        elif right is None:
            right = idx
        else:
            break
    return left, right


def _is_skipped_camera(name: str) -> bool:
    text = str(name or "")
    if _WRIST_RE.search(text):
        return False
    return bool(_FACE_RE.search(text) or _SCREEN_RE.search(text) or _SKIP_RE.search(text))


def list_wrist_device_indices(text: str) -> tuple[int | None, int | None]:
    """Skip FaceTime / screen / built-in webcams; prefer labeled wrist/USB cams."""
    parsed = parse_avfoundation_devices(text)
    usable = [(i, name) for i, name in parsed if not _is_skipped_camera(name)]
    preferred = [(i, name) for i, name in usable if _WRIST_RE.search(name)]
    pool = preferred or usable
    left = pool[0][0] if pool else None
    right = pool[1][0] if len(pool) > 1 else None
    return left, right


def empty_stream_reason(
    text: str,
    side: str = "left",
    assigned: tuple[int | None, int | None] | None = None,
) -> str:
    """Human reason when no JPEG can be captured after FaceTime/screen skip."""
    which = "right" if str(side).lower() == "right" else "left"
    parsed = parse_avfoundation_devices(text)
    if not parsed:
        names = parse_system_profiler_cameras(text)
        parsed = [(i, name) for i, name in enumerate(names)]
    skipped = [(i, name) for i, name in parsed if _is_skipped_camera(name)]
    usable = [(i, name) for i, name in parsed if not _is_skipped_camera(name)]
    faces = [name for _, name in skipped if _FACE_RE.search(name)]
    screens = [name for _, name in skipped if _SCREEN_RE.search(name)]
    if not parsed:
        return UNPLUGGED_REASON
    if not usable:
        if faces:
            return ONLY_FACETIME_REASON
        if screens:
            return ONLY_CAPTURE_SCREEN_REASON
        return UNPLUGGED_REASON
    if assigned is not None:
        left_i, right_i = assigned
        if which == "left" and left_i is None and right_i is not None:
            return "no wrist USB camera for left (cam labeled Right)"
        if which == "right" and right_i is None and left_i is not None:
            label = usable[0][1] if usable else "camera"
            return f"no wrist USB camera for right (only 1 camera: {label})"
        if which == "left" and left_i is None:
            return UNPLUGGED_REASON
        if which == "right" and right_i is None:
            return f"no wrist USB camera for right (only 1 camera: {usable[0][1]})" if usable else UNPLUGGED_REASON
    if which == "right" and len(usable) < 2:
        return f"no wrist USB camera for right (only 1 camera: {usable[0][1]})"
    if which == "left" and not usable:
        return UNPLUGGED_REASON
    return ""


def _ffmpeg_bin() -> str:
    try:
        from backend.services.video_ffmpeg import ffmpeg_bin

        found = ffmpeg_bin()
        if found and found != "ffmpeg":
            return found
        if found == "ffmpeg" and shutil.which("ffmpeg"):
            return found
    except Exception:
        pass
    root = Path(__file__).resolve().parents[2]
    for path in (
        root / ".venv" / "bin" / "ffmpeg",
        root / ".venv-mac" / "bin" / "ffmpeg",
        Path("/opt/homebrew/bin/ffmpeg"),
        Path("/usr/local/bin/ffmpeg"),
    ):
        try:
            if path.is_file() and os.access(path, os.X_OK):
                return str(path)
        except OSError:
            continue
    return shutil.which("ffmpeg") or ""


def _ffmpeg_device_list() -> str:
    ff = _ffmpeg_bin()
    if not ff:
        return ""
    try:
        proc = subprocess.run(
            [ff, "-f", "avfoundation", "-list_devices", "true", "-i", ""],
            capture_output=True,
            text=True,
            timeout=6,
            check=False,
        )
        return f"{proc.stderr or ''}\n{proc.stdout or ''}"
    except Exception:
        return ""


def _system_profiler_cameras() -> str:
    sp = shutil.which("system_profiler")
    if not sp:
        return ""
    try:
        proc = subprocess.run(
            [sp, "SPCameraDataType"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        return proc.stdout or ""
    except Exception:
        return ""


def debounce_wrist_pair(
    prev: tuple[int | None, int | None],
    listed: tuple[int | None, int | None],
    now: float,
) -> tuple[int | None, int | None]:
    """Keep the last assigned indexes through a 1-frame USB disappear / re-enum."""
    global _device_pending
    if listed == prev:
        _device_pending = None
        return listed
    if prev == (None, None):
        _device_pending = None
        return listed
    pending = _device_pending
    if pending is None or pending[1] != listed:
        _device_pending = (now, listed)
        return prev
    if now - pending[0] < _HOTPLUG_HOLD:
        return prev
    _device_pending = None
    return listed


def resolve_wrist_devices(*, refresh: bool = False) -> tuple[int | None, int | None, list[tuple[int, str]]]:
    global _device_cache, _device_names, _device_records
    with _RESOLVE_LOCK:
        return _resolve_wrist_devices_locked(refresh=refresh)


def _resolve_wrist_devices_locked(*, refresh: bool = False) -> tuple[int | None, int | None, list[tuple[int, str]]]:
    global _device_cache, _device_names, _device_records
    now = time.monotonic()
    cached_pair = _device_cache[1]
    ttl = _EMPTY_DEVICE_TTL if cached_pair == (None, None) else _DEVICE_TTL
    grabbing = _grabbers_busy()
    if grabbing and (cached_pair != (None, None) or _device_names):
        # ffmpeg -list_devices steals the exclusive UVC lock from an open capture.
        return cached_pair[0], cached_pair[1], list(_device_names)
    if not refresh and now - _device_cache[0] < ttl and _device_names:
        return cached_pair[0], cached_pair[1], list(_device_names)
    listed = _ffmpeg_device_list()
    names = parse_avfoundation_devices(listed) if listed else []
    profile = _system_profiler_cameras()
    if not names:
        names = [(i, name) for i, name in enumerate(parse_system_profiler_cameras(profile))]
        listed = listed or profile
    records = merge_camera_records(names, parse_system_profiler_camera_records(profile))
    if not records and names:
        records = [
            {
                "index": i,
                "name": name,
                "uniqueId": "",
                "usb": "",
                "usbDec": "",
                "skipped": _is_skipped_camera(name),
                "keys": camera_identity_keys({"name": name}),
            }
            for i, name in names
        ]
    pair = assign_wrist_sides(records, get_camera_label_map())
    if pair == (None, None) and names:
        usable = [(i, name) for i, name in names if not _is_skipped_camera(name)]
        pair = (usable[0][0] if usable else None, usable[1][0] if len(usable) > 1 else None)
    pair = debounce_wrist_pair(cached_pair, pair, now)
    old = _device_cache[1]
    if pair[0] != old[0]:
        _release_cap("left")
    if pair[1] != old[1]:
        _release_cap("right")
    _device_names = names
    _device_records = records
    _device_cache = (now, pair)
    if pair == (None, None):
        _REASONS["*"] = empty_stream_reason(listed or "\n".join(n for _, n in names), assigned=pair)
    return pair[0], pair[1], names


def resolve_wrist_device_indices() -> tuple[int | None, int | None]:
    left, right, _names = resolve_wrist_devices()
    return left, right


def _set_reason(side: str, reason: str) -> None:
    which = "right" if str(side).lower() == "right" else "left"
    if reason:
        _REASONS[which] = reason
    else:
        _REASONS.pop(which, None)


def _looks_like_permission(text: str) -> bool:
    return bool(_PERM_RE.search(text or ""))


def _cap_for(side: str):
    which = "right" if str(side).lower() == "right" else "left"
    hit = _CAPS.get(which)
    if hit is not None:
        return hit
    try:
        import cv2  # type: ignore
    except Exception:
        return None
    left_i, right_i, names = resolve_wrist_devices()
    idx = right_i if which == "right" else left_i
    if idx is None or is_skippable_camera_index(int(idx)):
        listed = "\n".join(f"[{i}] {name}" for i, name in names)
        _set_reason(which, empty_stream_reason("AVFoundation video devices:\n" + listed, which, assigned=(left_i, right_i)))
        return None
    now = time.monotonic()
    wait = _OPEN_WAIT.get(which)
    if wait is None or wait[0] != int(idx):
        _OPEN_WAIT[which] = (int(idx), now)
        return None
    if now - wait[1] < _OPEN_STABLE:
        return None
    cap = None
    with _OPEN_LOCK:
        try:
            cap = cv2.VideoCapture(int(idx), getattr(cv2, "CAP_AVFOUNDATION", 0))
        except Exception:
            cap = cv2.VideoCapture(int(idx))
        if not cap or not cap.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            _OPEN_WAIT[which] = (int(idx), now)
            return None
        try:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 600)
        except Exception:
            pass
        _CAPS[which] = cap
        _CAP_IDX[which] = int(idx)
        _OPEN_WAIT.pop(which, None)
        # First read while still exclusive — later reads run per-camera.
        try:
            cap.read()
        except Exception:
            pass
    return cap


def _grab_cv2(side: str) -> bytes | None:
    cap = _cap_for(side)
    if cap is None:
        return None
    try:
        ok, frame = cap.read()
        if not ok or frame is None:
            return None
        import cv2  # type: ignore

        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        if not ok:
            return None
        return bytes(buf)
    except Exception:
        return None


def _grab_ffmpeg(idx: int, timeout: float = 8.0) -> tuple[bytes | None, str]:
    if is_skippable_camera_index(int(idx)):
        return None, "skip Capture screen / FaceTime"
    ff = _ffmpeg_bin()
    if not ff:
        return None, "ffmpeg not found (cv2 missing)"
    return _grab_ffmpeg_locked(int(idx), ff, timeout)


def _grab_ffmpeg_locked(idx: int, ff: str, timeout: float) -> tuple[bytes | None, str]:
    dest = ""
    proc: subprocess.Popen | None = None
    try:
        handle = tempfile.NamedTemporaryFile(prefix="handcam-", suffix=".jpg", delete=False)
        dest = handle.name
        handle.close()
        cmd = [
            ff,
            "-hide_banner",
            "-loglevel",
            "error",
            *_ffmpeg_avfoundation_input(idx),
            "-frames:v",
            "1",
            "-q:v",
            "5",
            "-y",
            dest,
        ]
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        _track_popen(proc)
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_popen(proc)
            return None, "camera permission denied for Studio (open timed out)"
        err = f"{stderr or ''} {stdout or ''}"
        if _looks_like_permission(err):
            return None, "camera permission denied for Studio"
        if proc.returncode != 0:
            return None, (err.strip() or f"ffmpeg failed for device {idx}")[:180]
        data = Path(dest).read_bytes() if Path(dest).is_file() else b""
        if is_placeholder_jpeg(data) or data[:2] != b"\xff\xd8":
            return None, f"ffmpeg wrote no JPEG for device {idx}"
        return data, ""
    except Exception as exc:
        if proc is not None and proc.poll() is None:
            _kill_popen(proc)
        return None, str(exc)[:180]
    finally:
        _forget_popen(proc)
        if dest:
            try:
                os.unlink(dest)
            except OSError:
                pass


def _grab_side(side: str) -> bytes | None:
    which = "right" if str(side).lower() == "right" else "left"
    left_i, right_i, names = resolve_wrist_devices()
    idx = right_i if which == "right" else left_i
    if idx is None:
        listed = "AVFoundation video devices:\n" + "\n".join(f"[{i}] {name}" for i, name in names)
        _set_reason(
            which,
            empty_stream_reason(listed, which, assigned=(left_i, right_i))
            or UNPLUGGED_REASON,
        )
        return None
    if _cv2_available():
        frame = _grab_cv2(which)
        if frame:
            _READ_MISS[which] = 0
            _set_reason(which, "")
            return frame
        if which in _CAPS:
            _READ_MISS[which] = _READ_MISS.get(which, 0) + 1
            if _READ_MISS[which] >= _READ_MISS_MAX:
                _release_cap(which)
                _READ_MISS[which] = 0
            return None
        return None
    last_err = ""
    for attempt in range(2):
        frame, err = _grab_ffmpeg(int(idx), timeout=4.0)
        if frame:
            _set_reason(which, "")
            return frame
        last_err = err or last_err
        if attempt == 0 and _BUSY_RE.search(last_err or "") and not _grabbers_busy():
            kill_hand_cam_children()
            time.sleep(_RELEASE_WAIT)
            invalidate_device_cache()
            left_i, right_i, names = resolve_wrist_devices(refresh=True)
            idx = right_i if which == "right" else left_i
            if idx is None:
                break
            continue
        break
    if last_err:
        _set_reason(which, snapshot_reason_from(last_err))
        return None
    _set_reason(which, f"could not open USB camera {idx}")
    return None


def latest_jpeg(side: str = "left") -> bytes:
    data, _live = latest_jpeg_status(side)
    return data


def latest_live_jpeg(side: str = "left") -> bytes | None:
    data, live = latest_jpeg_status(side)
    return data if live else None


def frame_age_ms(side: str = "left") -> int | None:
    which = "right" if str(side).lower() == "right" else "left"
    held = _LAST_GOOD.get(which)
    if not held:
        return None
    return max(0, int((time.monotonic() - held[0]) * 1000))


def peek_live_jpeg(side: str = "left") -> tuple[bytes | None, int]:
    """Newest committed frame if it is still fresh. Does not rewrite its stamp."""
    which = "right" if str(side).lower() == "right" else "left"
    held = _LAST_GOOD.get(which)
    if not held or is_placeholder_jpeg(held[1]):
        return None, -1
    age_ms = max(0, int((time.monotonic() - held[0]) * 1000))
    if age_ms > int(_LIVE_HOLD * 1000):
        return None, age_ms
    return held[1], age_ms


def ensure_hand_cam_streaming() -> None:
    set_publish(True)
    _ensure_grab_workers()


def latest_jpeg_status(side: str = "left") -> tuple[bytes, bool]:
    which = "right" if str(side).lower() == "right" else "left"
    with _GRAB_LOCK:
        now = time.monotonic()
        hit = _CACHE.get(which)
        if hit and now - hit[0] < _CACHE_TTL:
            return hit[1], bool(hit[2]) if len(hit) > 2 else not is_placeholder_jpeg(hit[1])
        epoch = _GRAB_EPOCH
        publish = _PUBLISH
        if not publish and not last_stream_reason(which):
            _set_reason(which, "publish off")
    if publish:
        _ensure_grab_workers()
    frame = None
    from_grabber = False
    worker = _worker_alive(which)
    streaming = _STREAMS.get(which) is not None
    if publish and (worker or streaming):
        held = _LAST_GOOD.get(which)
        if held and not is_placeholder_jpeg(held[1]):
            frame = held[1]
            from_grabber = True
    elif publish:
        lock = _SIDE_LOCKS[which]
        got_lock = lock.acquire(blocking=False)
        if not got_lock:
            hit = _CACHE.get(which)
            if hit:
                return hit[1], bool(hit[2]) if len(hit) > 2 else not is_placeholder_jpeg(hit[1])
            held = _LAST_GOOD.get(which)
            if held:
                return held[1], True
            return placeholder_jpeg(which), False
        try:
            frame = _grab_side(which)
        finally:
            lock.release()

    def _finish(data: bytes, live: bool) -> tuple[bytes, bool]:
        with _GRAB_LOCK:
            if epoch != _GRAB_EPOCH:
                hit = _CACHE.get(which)
                if hit:
                    return hit[1], bool(hit[2]) if len(hit) > 2 else not is_placeholder_jpeg(hit[1])
                return data, live
            _CACHE[which] = (time.monotonic(), data, live)
            return data, live

    if from_grabber and frame:
        held = _LAST_GOOD.get(which)
        age = (time.monotonic() - held[0]) if held else 999.0
        if held and age < _LIVE_HOLD:
            return _finish(frame, True)
        return _finish(placeholder_jpeg(which), False)

    live = bool(frame) and not is_placeholder_jpeg(frame)
    with _GRAB_LOCK:
        if epoch != _GRAB_EPOCH:
            hit = _CACHE.get(which)
            if hit:
                return hit[1], bool(hit[2]) if len(hit) > 2 else not is_placeholder_jpeg(hit[1])
            return (frame if live else placeholder_jpeg(which)), live
        stamp = time.monotonic()
        if live and frame:
            _LAST_GOOD[which] = (stamp, frame)
            _CACHE[which] = (stamp, frame, True)
            return frame, True
        held = _LAST_GOOD.get(which)
        unplugged = _looks_unplugged(last_stream_reason(which))
        if held and not is_placeholder_jpeg(held[1]) and not unplugged:
            if stamp - held[0] < _LIVE_HOLD:
                _CACHE[which] = (stamp, held[1], True)
                return held[1], True
        if not live and _PUBLISH and not last_stream_reason(which) and which not in _LAST_GOOD and not _worker_alive(which):
            _set_reason(which, UNPLUGGED_REASON)
        data = held[1] if held and not is_placeholder_jpeg(held[1]) else placeholder_jpeg(which)
        _CACHE[which] = (stamp, data, False)
        return data, False


def _cached_side_live(side: str) -> bool:
    which = "right" if str(side).lower() == "right" else "left"
    hit = _CACHE.get(which)
    if not hit:
        return False
    return bool(hit[2]) if len(hit) > 2 else not is_placeholder_jpeg(hit[1])


def capture_status(*, refresh: bool | None = None) -> dict[str, object]:
    live = _cached_side_live("left") or _cached_side_live("right") or _grabbers_busy()
    if refresh is None:
        refresh = not live
    left_i, right_i, names = resolve_wrist_devices(refresh=refresh and not _grabbers_busy())
    app = capture_app_name()
    labels = get_camera_label_map()
    devices = []
    source = _device_records or [
        {
            "index": i,
            "name": name,
            "uniqueId": "",
            "usb": "",
            "usbDec": "",
            "skipped": _is_skipped_camera(name),
            "keys": camera_identity_keys({"name": name}),
        }
        for i, name in names
    ]
    for rec in source:
        idx = rec.get("index")
        hit = lookup_camera_label(rec, labels)
        side = ""
        if isinstance(idx, int) and idx == right_i:
            side = "right"
        elif isinstance(idx, int) and idx == left_i:
            side = "left"
        elif hit:
            side = str(hit.get("side") or "")
        display = ""
        if hit and hit.get("displayName"):
            display = str(hit.get("displayName") or "")
        elif side:
            display = str((labels.get("titles") or {}).get(side) or "")
        devices.append(
            {
                "index": idx,
                "name": rec.get("name") or "",
                "uniqueId": rec.get("uniqueId") or "",
                "usb": rec.get("usb") or rec.get("usbDec") or "",
                "skipped": bool(rec.get("skipped")),
                "keys": rec.get("keys") or camera_identity_keys(rec),
                "side": side,
                "displayName": display,
                "pluggedIn": not bool(rec.get("skipped")),
            }
        )
    return {
        "publish": is_publish_on(),
        "devices": devices,
        "wristCount": sum(1 for d in devices if not d.get("skipped")),
        "leftIndex": left_i,
        "rightIndex": right_i,
        "leftReason": last_stream_reason("left"),
        "rightReason": last_stream_reason("right"),
        "leftLive": _cached_side_live("left"),
        "rightLive": _cached_side_live("right"),
        "leftWorker": _worker_alive("left"),
        "rightWorker": _worker_alive("right"),
        "titles": labels.get("titles") or {"left": "Left", "right": "Right", "pov": "Robot POV"},
        "labels": labels.get("devices") or {},
        "ffmpeg": _ffmpeg_bin() or "",
        "cv2": _cv2_available(),
        "captureApp": app,
        "helper": camera_permission_helper(app),
    }


def _cv2_available() -> bool:
    try:
        import cv2  # noqa: F401

        return True
    except Exception:
        return False


def local_ipv4s() -> set[str]:
    found = {"127.0.0.1", "localhost"}
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(info[4][0])
    except OSError:
        pass
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("192.168.1.1", 80))
        found.add(sock.getsockname()[0])
        sock.close()
    except OSError:
        pass
    return {str(x).lower() for x in found if x}


def is_self_camera_target(host: str, port: int | None = None) -> bool:
    name = str(host or "").split(":")[0].strip().lower()
    if not name:
        return True
    if name in {"127.0.0.1", "localhost", "::1"}:
        return True
    if port not in (None, 8001, 80, 443):
        return name in local_ipv4s()
    return name in local_ipv4s()


def snapshot_headers(live: bool = False, reason: str = "", age_ms: int | None = None) -> dict[str, str]:
    headers = {
        "Cache-Control": "no-store, no-cache",
        "Pragma": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "X-Hand-Cam-Live": "1" if live else "0",
        "X-Accel-Buffering": "no",
    }
    if reason:
        headers["X-Hand-Cam-Reason"] = reason[:220]
    if age_ms is not None and age_ms >= 0:
        headers["X-Hand-Cam-Age-Ms"] = str(int(age_ms))
    return headers
