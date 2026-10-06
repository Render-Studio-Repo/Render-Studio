#!/usr/bin/env python3
"""Capture iso / top / front PNGs of a Three.js factory or GLB.

img2threejs visual kernel: Playwright Chromium renders the actual factory/GLB
canvas. This is not cadgen snapshot.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
THREE_ROOT = HERE / "node_modules" / "three"
VIEWER_NAME = "capture_views.html"

VIEWER_HTML = """<!doctype html>
<html><head>
<meta charset="utf-8"/>
<style>html,body{margin:0;background:#f3f4f6;overflow:hidden}canvas{display:block}</style>
<script type="importmap">
{"imports":{
  "three":"/three/build/three.module.js",
  "three/addons/":"/three/examples/jsm/"
}}
</script>
</head>
<body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') || 'glb';
const src = params.get('src') || '/asset';
const upAxis = params.get('up') || 'y';
const W = 800, H = 600;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.setClearColor(0xf3f4f6, 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(4, 8, 6);
scene.add(key);
const fill = new THREE.DirectionalLight(0xcfe4ff, 0.35);
fill.position.set(-6, 3, -2);
scene.add(fill);

const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 10000);
let root = null;

function frameView(name) {
  if (!root) return;
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const dist = maxDim * 2.2;
  if (upAxis === 'z') {
    camera.up.set(0, 0, 1);
    if (name === 'top') {
      camera.up.set(0, 1, 0);
      camera.position.set(center.x, center.y, center.z + dist);
    } else if (name === 'front') camera.position.set(center.x, center.y - dist, center.z);
    else camera.position.set(center.x + dist * 0.7, center.y - dist * 0.7, center.z + dist * 0.55);
  } else {
    camera.up.set(0, 1, 0);
    if (name === 'top') camera.position.set(center.x, center.y + dist, center.z + 0.01);
    else if (name === 'front') camera.position.set(center.x, center.y, center.z + dist);
    else camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.7);
  }
  camera.near = Math.max(0.01, dist / 200);
  camera.far = dist * 20;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

async function boot() {
  try {
    if (kind === 'factory') {
      const mod = await import(src);
      const factory = (typeof mod.default === 'function' && mod.default)
        || (typeof mod.createModel === 'function' && mod.createModel)
        || (typeof mod.createObjectModel === 'function' && mod.createObjectModel)
        || (typeof mod.build === 'function' && mod.build);
      if (typeof factory !== 'function') throw new Error('factory export missing');
      root = factory(THREE);
    } else {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(src);
      root = gltf.scene;
    }
    if (!root) throw new Error('empty root');
    scene.add(root);
    frameView('iso');
    window.__IMG2THREEJS_READY__ = true;
  } catch (err) {
    window.__IMG2THREEJS_ERROR__ = String(err && err.stack || err);
    window.__IMG2THREEJS_READY__ = false;
  }
}

window.__IMG2THREEJS_CAPTURE__ = {
  async setCamera(name) { frameView(name); }
};
boot();
</script>
</body></html>
"""


def _three_root() -> Path:
    if (THREE_ROOT / "build" / "three.module.js").is_file():
        return THREE_ROOT
    raise SystemExit("three.js is missing under img2threejs/scripts/node_modules/three")


class _Handler(http.server.SimpleHTTPRequestHandler):
    asset_path: Path = Path(".")
    three_root: Path = THREE_ROOT
    viewer_html: bytes = VIEWER_HTML.encode("utf-8")

    def log_message(self, *_args) -> None:  # noqa: D401
        return

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in {"/", "/viewer.html"}:
            body = self.viewer_html
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/three/"):
            rel = path[len("/three/") :]
            target = (self.three_root / rel).resolve()
            if not str(target).startswith(str(self.three_root.resolve())) or not target.is_file():
                self.send_error(404)
                return
            self._send_file(target)
            return
        if path.startswith("/asset"):
            self._send_file(self.asset_path)
            return
        self.send_error(404)

    def _send_file(self, target: Path) -> None:
        data = target.read_bytes()
        mime = "application/javascript"
        suffix = target.suffix.lower()
        if suffix == ".js":
            mime = "application/javascript"
        elif suffix == ".mjs":
            mime = "text/javascript"
        elif suffix == ".glb":
            mime = "model/gltf-binary"
        elif suffix == ".json":
            mime = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)


def _serve(asset: Path, three_root: Path) -> tuple[socketserver.TCPServer, str]:
    class Bound(_Handler):
        pass

    Bound.asset_path = asset
    Bound.three_root = three_root
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Bound)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = httpd.server_address[:2]
    return httpd, f"http://{host}:{port}"


def capture(
    *,
    asset: Path,
    kind: str,
    out_dir: Path,
    stem: str,
    views: tuple[str, ...] = ("iso", "top", "front"),
    up_axis: str = "y",
) -> dict:
    if up_axis not in {"y", "z"}:
        raise ValueError("up_axis must be y or z")
    three_root = _three_root()
    asset = asset.expanduser().resolve()
    if not asset.is_file():
        raise FileNotFoundError(asset)
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Playwright is required for img2threejs capture_views.py. "
            "Install playwright and Chromium in the CAD Python env."
        ) from exc

    httpd, origin = _serve(asset, three_root)
    files: dict[str, str] = {}
    try:
        url = f"{origin}/viewer.html?kind={kind}&src=/asset&up={up_axis}"
        with sync_playwright() as playwright:
            launch_options = {"headless": True}
            if not Path(playwright.chromium.executable_path).is_file():
                candidates = [
                    os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", ""),
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                ]
                available = next((path for path in candidates if path and Path(path).is_file()), None)
                if available:
                    launch_options["executable_path"] = available
            browser = playwright.chromium.launch(**launch_options)
            page = browser.new_page(viewport={"width": 800, "height": 600})
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_function(
                "() => window.__IMG2THREEJS_READY__ === true || Boolean(window.__IMG2THREEJS_ERROR__)",
                timeout=30000,
            )
            err = page.evaluate("() => window.__IMG2THREEJS_ERROR__ || ''")
            if err:
                raise RuntimeError(f"capture page failed: {err}")
            for view in views:
                page.evaluate("(name) => window.__IMG2THREEJS_CAPTURE__.setCamera(name)", view)
                dest = out_dir / f"{stem}_snapshot_{view}.png"
                page.locator("canvas").screenshot(path=str(dest), type="png")
                if dest.is_file() and dest.stat().st_size > 32:
                    files[view] = dest.name
            browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
    if not files:
        raise RuntimeError("img2threejs capture produced no PNG views")
    return {"ok": True, "files": files, "file": files.get("iso") or next(iter(files.values())), "up_axis": up_axis}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--factory", type=Path)
    src.add_argument("--glb", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--stem", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    kind = "factory" if args.factory else "glb"
    asset = args.factory or args.glb
    try:
        payload = capture(asset=asset, kind=kind, out_dir=args.out_dir, stem=args.stem)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(payload.get("file") or "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
