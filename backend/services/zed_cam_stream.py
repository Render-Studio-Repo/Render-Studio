"""Local ZED Mini capture for Robotics top POV (macOS via zed-sdk-mlx)."""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path

_PUBLISH = False
_CACHE: tuple[float, bytes] | None = None
_CACHE_TTL = 0.35
_REASON = ""
_LOCK = threading.RLock()
_WORKER: threading.Thread | None = None
_WORKER_STOP: threading.Event | None = None

_MLX_ROOT = Path(os.environ.get("ZED_SDK_MLX_ROOT", str(Path.home() / "zed-sdk-mlx"))).expanduser()
_CAPTURE_BIN = (
    _MLX_ROOT
    / "build/zed-capture-diagnostics/ZEDCaptureDiagnostics.app/Contents/MacOS/ZEDCaptureDiagnostics"
)

_USB_PRODUCT_RE = re.compile(r'"USB Product Name" = "([^"]*ZED[^"]*)"', re.I)
_USB_SERIAL_RE = re.compile(r'"USB Serial Number" = "([^"]+)"')
_AUTH_RE = re.compile(r"camera_auth_after=(\w+)")
_GRANTED_RE = re.compile(r"camera_access_granted=(true|false)")

_TCC_DB = Path.home() / "Library/Application Support/com.apple.TCC/TCC.db"
_ZED_BUNDLE = "com.robotflowlabs.zedcapturediagnostics"
_JPG_FALLBACK = Path("/tmp/zed-studio-latest.jpg")
_CAPTURE_TIMEOUT_SEC = 28
_GRANTED_FLAG = Path.home() / ".render-studio/zed-camera-granted"


def _tcc_camera_auth(client: str) -> str | None:
    """Return authorized|denied|restricted|not_determined from TCC when readable."""
    if not _TCC_DB.is_file():
        return None
    try:
        import sqlite3
        con = sqlite3.connect(f"file:{_TCC_DB}?mode=ro", uri=True)
        row = con.execute(
            """
            SELECT auth_value FROM access
            WHERE service='kTCCServiceCamera'
              AND (client LIKE ? OR client LIKE ? OR client LIKE ?)
            LIMIT 1
            """,
            (f"%{client}%", "%ZEDCaptureDiagnostics%", "%zedcapturediagnostics%"),
        ).fetchone()
        con.close()
        if row is None:
            return "not_determined"
        val = int(row[0])
        if val == 2:
            return "authorized"
        if val == 0:
            return "denied"
        if val == 1:
            return "restricted"
        return "not_determined"
    except Exception:
        return None


def _tcc_camera_auth_cli(client: str) -> str | None:
    """Fallback for launchd workers that cannot open TCC.db via sqlite3 Python module."""
    if not _TCC_DB.is_file():
        return None
    sqlite3_bin = Path("/usr/bin/sqlite3")
    if not sqlite3_bin.is_file():
        return None
    try:
        proc = subprocess.run(
            [
                str(sqlite3_bin),
                str(_TCC_DB),
                (
                    "SELECT auth_value FROM access "
                    "WHERE service='kTCCServiceCamera' "
                    f"AND (client LIKE '%{client}%' "
                    "OR client LIKE '%ZEDCaptureDiagnostics%' "
                    "OR client LIKE '%zedcapturediagnostics%') "
                    "LIMIT 1"
                ),
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if proc.returncode != 0:
            return None
        raw = proc.stdout.strip()
        if not raw:
            return "not_determined"
        val = int(raw.split("|", 1)[0])
        if val == 2:
            return "authorized"
        if val == 0:
            return "denied"
        if val == 1:
            return "restricted"
        return "not_determined"
    except Exception:
        return None


def _mark_permission_granted() -> None:
    try:
        _GRANTED_FLAG.parent.mkdir(parents=True, exist_ok=True)
        _GRANTED_FLAG.write_text(str(time.time()))
    except Exception:
        pass


def _permission_granted_cached() -> bool:
    return _GRANTED_FLAG.is_file()


def _read_fallback_jpeg() -> bytes | None:
    try:
        if not _JPG_FALLBACK.is_file():
            return None
        age = time.time() - _JPG_FALLBACK.stat().st_mtime
        if age > 3.0:
            return None
        data = _JPG_FALLBACK.read_bytes()
        return data if len(data) > 80 else None
    except Exception:
        return None


def mlx_capture_bin() -> Path:
    return _CAPTURE_BIN


def mlx_sdk_ready() -> bool:
    lib = _MLX_ROOT / "build/zed-open-capture/libzed_open_capture.dylib"
    return _CAPTURE_BIN.is_file() and lib.is_file()


def detect_usb_zed() -> dict[str, str]:
    try:
        out = subprocess.check_output(
            ["ioreg", "-p", "IOUSB", "-l", "-w", "0"],
            text=True,
            errors="replace",
            timeout=4,
        )
    except Exception:
        return {}
    for block in out.split("+-o "):
        if "STEREOLABS" not in block and "ZED" not in block:
            continue
        product = _USB_PRODUCT_RE.search(block)
        serial = _USB_SERIAL_RE.search(block)
        if product:
            name = product.group(1).strip()
            return {
                "product": name,
                "model": "ZED-M" if "ZED-M" in name.upper() else name,
                "serial": serial.group(1).strip() if serial else "",
            }
    return {}


def _probe_permission() -> str:
    if not mlx_sdk_ready():
        return "sdk_missing"
    if _permission_granted_cached():
        return "authorized"
    tcc = _tcc_camera_auth(_ZED_BUNDLE)
    if tcc and tcc != "not_determined":
        return tcc
    tcc_cli = _tcc_camera_auth_cli(_ZED_BUNDLE)
    if tcc_cli and tcc_cli != "not_determined":
        return tcc_cli
    with _LOCK:
        if _CACHE and (time.time() - _CACHE[0]) < 45:
            return "authorized"
    return "not_determined"


def maybe_auto_publish() -> None:
    if is_publish_on():
        return
    if not detect_usb_zed() or not mlx_sdk_ready():
        return
    if _probe_permission() == "authorized":
        set_publish(True)


def request_camera_permission() -> dict[str, object]:
    if not mlx_sdk_ready():
        return {
            "ok": False,
            "reason": "zed-sdk-mlx not built — clone ~/zed-sdk-mlx and run make build-capture-app",
            "privacyOpened": False,
        }
    perm = _probe_permission()
    if perm == "authorized":
        set_publish(True)
        return {
            "ok": True,
            "permission": perm,
            "privacyOpened": False,
            "helper": "ZED camera already allowed — streaming.",
        }
    settings_url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
    try:
        subprocess.Popen(["open", settings_url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Ask macOS through the signed capture app. Never launch a Terminal
        # `.command` from a browser button; repeated clicks used to create a
        # new shell window every time.
        app_bundle = _CAPTURE_BIN.parent.parent.parent
        subprocess.Popen(["open", str(app_bundle), "--args", "--permission-only"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as exc:
        return {"ok": False, "reason": str(exc), "privacyOpened": False}
    return {
        "ok": False,
        "permission": _probe_permission(),
        "privacyOpened": True,
        "helper": (
            "Click Allow if macOS asks for Camera. "
            "Then System Settings → Privacy & Security → Camera → turn ON ZEDCaptureDiagnostics. "
            "Reopen Robot POV."
        ),
        "settingsUrl": settings_url,
    }


def _decode_yuv_to_jpeg(yuv_path: Path, meta_path: Path | None = None) -> bytes | None:
    try:
        import cv2
        import numpy as np
    except Exception:
        return None
    width = height = None
    meta = Path(f"{yuv_path}.txt")
    if meta_path and meta_path.is_file():
        meta = meta_path
    if meta.is_file():
        for line in meta.read_text().splitlines():
            if line.startswith("width="):
                width = int(line.split("=", 1)[1])
            elif line.startswith("height="):
                height = int(line.split("=", 1)[1])
    payload = yuv_path.read_bytes()
    if not width or not height:
        height = 720
        width = 2560 if len(payload) >= 2560 * 720 * 2 else 1280
    expected = width * height * 2
    if len(payload) < expected:
        return None
    frame_yuyv = np.frombuffer(payload[:expected], dtype=np.uint8).reshape((height, width, 2))
    frame_bgr = cv2.cvtColor(frame_yuyv, cv2.COLOR_YUV2BGR_YUYV)
    left_bgr = frame_bgr[:, : width // 2]
    ok, buf = cv2.imencode(".jpg", left_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    return bytes(buf) if ok else None


def _grab_once() -> tuple[bytes | None, str]:
    if not mlx_sdk_ready():
        return None, "zed-sdk-mlx capture app missing"
    if not detect_usb_zed():
        return None, "ZED camera not plugged in"
    perm = _probe_permission()
    if perm not in {"authorized"}:
        fb = _read_fallback_jpeg()
        if fb:
            _mark_permission_granted()
            return fb, ""
        if perm == "denied":
            return None, "Camera blocked — enable ZEDCaptureDiagnostics in System Settings → Privacy → Camera"
        return None, "Click Allow camera on ZED TOP, then enable ZEDCaptureDiagnostics in System Settings → Camera"
    with tempfile.TemporaryDirectory(prefix="zedcam-") as tmp:
        yuv_path = Path(tmp) / "frame.yuv"
        try:
            proc = subprocess.run(
                [str(_CAPTURE_BIN), "-1", str(yuv_path)],
                capture_output=True,
                text=True,
                timeout=_CAPTURE_TIMEOUT_SEC,
                check=False,
            )
        except subprocess.TimeoutExpired:
            fb = _read_fallback_jpeg()
            if fb:
                _mark_permission_granted()
                return fb, ""
            return None, "ZED capture timed out — run Render-Studio/scripts/zed-studio-capture-loop.command in Terminal"
        except Exception as exc:
            return None, str(exc)
        text = f"{proc.stdout}\n{proc.stderr}"
        if proc.returncode != 0 or not yuv_path.is_file():
            if "permission" in text.lower() or "not granted" in text.lower():
                return None, "Camera permission required for ZEDCaptureDiagnostics"
            if "Cannot open camera" in text:
                return None, "Cannot open ZED camera — check USB 3 and Camera permission"
            return None, (text.strip().splitlines()[-1] if text.strip() else "ZED capture failed")
        jpeg = _decode_yuv_to_jpeg(yuv_path)
        if not jpeg:
            fb = _read_fallback_jpeg()
            if fb:
                _mark_permission_granted()
                return fb, ""
            return None, "Failed to decode ZED frame"
        _mark_permission_granted()
        return jpeg, ""


def _worker_loop(stop: threading.Event) -> None:
    global _CACHE, _REASON
    while not stop.is_set():
        if not _PUBLISH:
            stop.wait(0.25)
            continue
        frame, reason = _grab_once()
        with _LOCK:
            if frame:
                _CACHE = (time.time(), frame)
                _REASON = ""
            else:
                _REASON = reason or "waiting for ZED frame"
        stop.wait(0.45)


def set_publish(on: bool) -> bool:
    global _PUBLISH, _WORKER, _WORKER_STOP
    want = bool(on)
    with _LOCK:
        if not want:
            _PUBLISH = False
            if _WORKER_STOP:
                _WORKER_STOP.set()
            _WORKER = None
            _WORKER_STOP = None
            return False
        _PUBLISH = True
        if _WORKER and _WORKER.is_alive():
            return True
        _WORKER_STOP = threading.Event()
        _WORKER = threading.Thread(target=_worker_loop, args=(_WORKER_STOP,), name="zed-cam", daemon=True)
        _WORKER.start()
        return True


def is_publish_on() -> bool:
    return _PUBLISH


def peek_live_jpeg() -> tuple[bytes | None, int, str]:
    with _LOCK:
        if _CACHE:
            ts, data = _CACHE
            age_ms = int(max(0.0, (time.time() - ts) * 1000))
            if age_ms <= int(_CACHE_TTL * 1000 * 8):
                return data, age_ms, ""
        reason = _REASON
    if not reason and _PUBLISH:
        reason = "waiting for first ZED frame"
    return None, 0, reason


def latest_live_jpeg() -> bytes | None:
    frame, _, _ = peek_live_jpeg()
    return frame


def capture_status() -> dict[str, object]:
    maybe_auto_publish()
    usb = detect_usb_zed()
    perm = _probe_permission() if usb and mlx_sdk_ready() else ("sdk_missing" if not mlx_sdk_ready() else "unplugged")
    frame, age_ms, reason = peek_live_jpeg()
    live = bool(frame)
    if live and perm == "not_determined":
        perm = "authorized"
    return {
        "usb": bool(usb),
        "product": usb.get("product", ""),
        "model": usb.get("model", ""),
        "serial": usb.get("serial", ""),
        "mlxSdk": mlx_sdk_ready(),
        "mlxRoot": str(_MLX_ROOT),
        "permission": perm,
        "publish": is_publish_on(),
        "live": live,
        "ageMs": age_ms,
        "localUrl": "/api/robotics/zed.jpg",
        "reason": reason or ("" if live else _REASON),
    }
