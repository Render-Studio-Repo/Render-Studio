#!/usr/bin/env python3
"""Small LAN camera publisher for OpenArm Raspberry Pi wrist cameras."""

from __future__ import annotations

import os
import glob
import subprocess
import threading
import time

import cv2
import httpx
from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

JPEG_QUALITY = int(os.environ.get("OPENARM_CAMERA_JPEG_QUALITY", "78"))
TOP_CAMERA_URL = os.environ.get("OPENARM_TOP_CAMERA_URL", os.environ.get("OPENARM_ZED_CAMERA_URL", "")).strip()


def _video_name(path: str) -> str:
    try:
        node = os.path.basename(os.path.realpath(path))
        return open(f"/sys/class/video4linux/{node}/name", encoding="utf-8").read().strip()
    except OSError:
        return ""


def discover_wrist_devices() -> tuple[str, str]:
    configured = [
        os.environ.get("OPENARM_LEFT_CAMERA", "").strip(),
        os.environ.get("OPENARM_RIGHT_CAMERA", "").strip(),
    ]
    candidates = [
        path for path in sorted(glob.glob("/dev/v4l/by-path/*video-index0"))
        if "arducam" in _video_name(path).lower()
    ]
    selected = []
    for index, fallback in enumerate(("/dev/video0", "/dev/video2")):
        value = configured[index]
        selected.append(value if value and os.path.exists(value) else (candidates[index] if index < len(candidates) else fallback))
    return selected[0], selected[1]


def discover_top_device() -> str:
    configured = os.environ.get("OPENARM_TOP_CAMERA", os.environ.get("OPENARM_ZED_CAMERA", "")).strip()
    if configured and os.path.exists(configured):
        return configured
    candidates = sorted(glob.glob("/dev/v4l/by-id/*video-index0"))
    zed = [path for path in candidates if "zed" in (path + _video_name(path)).lower()]
    if zed:
        return zed[0]
    generic = [path for path in candidates if "arducam" not in (path + _video_name(path)).lower()]
    return generic[0] if generic else ""


LEFT_DEVICE, RIGHT_DEVICE = discover_wrist_devices()
TOP_DEVICE = discover_top_device()
TOP_MODEL = _video_name(TOP_DEVICE) or ("Network top camera" if TOP_CAMERA_URL else "")

app = FastAPI(title="OpenArm Pi Cameras")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class PublishBody(BaseModel):
    on: bool = True


class CameraWorker:
    def __init__(self, side: str, device: str):
        self.side = side
        self.device = device
        self.frame: bytes | None = None
        self.updated = 0.0
        self.reason = "starting"
        self.running = True
        self.lock = threading.Lock()
        threading.Thread(target=self._loop, daemon=True, name=f"openarm-cam-{side}").start()

    def _loop(self) -> None:
        while self.running:
            cap = cv2.VideoCapture(self.device, cv2.CAP_V4L2)
            if not cap.isOpened():
                self.reason = f"cannot open {self.device}"
                time.sleep(1.0)
                continue
            if self.side == "top":
                cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            else:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 600)
            cap.set(cv2.CAP_PROP_FPS, 20)
            while self.running and cap.isOpened():
                ok, image = cap.read()
                if not ok or image is None:
                    self.reason = f"no frame from {self.device}"
                    break
                encoded, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
                if encoded:
                    with self.lock:
                        self.frame = bytes(buf)
                        self.updated = time.time()
                        self.reason = ""
            cap.release()
            time.sleep(0.3)

    def snapshot(self) -> tuple[bytes | None, int, str]:
        with self.lock:
            age_ms = int(max(0.0, time.time() - self.updated) * 1000) if self.updated else 0
            return self.frame, age_ms, self.reason


workers = {
    "left": CameraWorker("left", LEFT_DEVICE),
    "right": CameraWorker("right", RIGHT_DEVICE),
}
top_worker = CameraWorker("top", TOP_DEVICE) if TOP_DEVICE else None


def top_camera_present() -> bool:
    return bool((TOP_DEVICE and os.path.exists(TOP_DEVICE)) or TOP_CAMERA_URL)


def top_camera_reason() -> str:
    if TOP_CAMERA_URL:
        return "Network top-camera feed configured"
    if top_worker:
        frame, age_ms, reason = top_worker.snapshot()
        return "Top webcam ready" if frame and age_ms <= 5000 else (reason or "waiting for top webcam")
    try:
        text = subprocess.check_output(["lsusb"], text=True, timeout=2).lower()
        if "stereolabs" in text or "zed" in text:
            return "ZED control interface detected, but its USB video interface is unavailable"
    except Exception:
        pass
    return "No top webcam detected"


@app.get("/api/robotics/hand-cam/{side}.jpg")
def camera_jpeg(side: str):
    worker = workers.get(side.lower())
    if not worker:
        return Response(status_code=404)
    frame, age_ms, reason = worker.snapshot()
    if not frame or age_ms > 5000:
        return Response(status_code=503, headers={"X-Camera-Reason": reason or "stale frame"})
    return Response(frame, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Camera-Age-Ms": str(age_ms)})


@app.get("/api/robotics/hand-cam/status")
def camera_status():
    devices = []
    sides = {}
    for side, worker in workers.items():
        frame, age_ms, reason = worker.snapshot()
        live = bool(frame) and age_ms <= 5000
        devices.append({"side": side, "path": worker.device, "name": "Arducam B0495", "live": live})
        sides[side] = {"device": worker.device, "live": live, "age_ms": age_ms, "reason": reason}
    return {"ok": True, "publish": True, "host": "0.0.0.0", "port": 8001, "devices": devices, **sides}


@app.post("/api/robotics/hand-cam/publish")
def camera_publish(body: PublishBody):
    return {"ok": True, "publish": bool(body.on), **camera_status()}


@app.get("/api/robotics/zed/status")
def top_camera_status():
    frame, age_ms, _ = top_worker.snapshot() if top_worker else (None, 0, "")
    return {
        "ok": True,
        "usb": top_camera_present(),
        "configured": bool(TOP_CAMERA_URL or TOP_DEVICE),
        "live": bool(TOP_CAMERA_URL or (frame and age_ms <= 5000)),
        "mode": "jpeg-url" if TOP_CAMERA_URL else ("uvc-top" if TOP_DEVICE else "unavailable"),
        "device": TOP_DEVICE,
        "model": TOP_MODEL,
        "age_ms": age_ms,
        "reason": top_camera_reason(),
        "localUrl": "/api/robotics/zed.jpg",
    }


@app.get("/api/robotics/zed.jpg")
def top_camera_jpeg():
    if top_worker:
        frame, age_ms, reason = top_worker.snapshot()
        if frame and age_ms <= 5000:
            return Response(frame, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Camera-Age-Ms": str(age_ms)})
        return JSONResponse({"ok": False, "reason": reason or "Top webcam frame is stale"}, status_code=503)
    if not TOP_CAMERA_URL:
        return JSONResponse({"ok": False, "reason": top_camera_reason()}, status_code=503)
    try:
        response = httpx.get(TOP_CAMERA_URL, headers={"Accept": "image/jpeg"}, timeout=4.0, follow_redirects=False)
        media = str(response.headers.get("content-type") or "").split(";", 1)[0].lower()
        if response.status_code != 200 or media not in {"image/jpeg", "image/png", "image/webp"} or not response.content:
            return JSONResponse({"ok": False, "reason": f"Top camera returned {response.status_code}"}, status_code=503)
        if len(response.content) > 8 * 1024 * 1024:
            return JSONResponse({"ok": False, "reason": "Top camera frame exceeds 8 MB"}, status_code=503)
        return Response(response.content, media_type=media, headers={"Cache-Control": "no-store"})
    except Exception as exc:
        return JSONResponse({"ok": False, "reason": f"Top camera unavailable: {type(exc).__name__}"}, status_code=503)


@app.get("/health")
def health():
    return camera_status()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
