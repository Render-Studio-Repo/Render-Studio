"""LAN allowlist + Sam robotics defaults. No live Viser / webcam required."""

from __future__ import annotations

import asyncio
import inspect
import subprocess
import time
import unittest

from backend.services.hand_cam_stream import latest_jpeg, placeholder_jpeg
from backend.services.robotics_prefs import defaults_for, is_sam_camera_account
from backend.services.viser_proxy import (
    allow_viser_target,
    is_private_lan_host,
    normalize_camera_host,
    normalize_viser_url,
    rewrite_viser_html,
)


class ViserProxyTests(unittest.TestCase):
    def test_lan_urls_only(self) -> None:
        self.assertEqual(normalize_viser_url("192.168.1.77:8095"), "http://192.168.1.77:8095/")
        self.assertEqual(normalize_viser_url("ws://192.168.1.77:8095"), "http://192.168.1.77:8095/")
        self.assertEqual(normalize_viser_url("https://192.168.1.77:8095/"), "http://192.168.1.77:8095/")
        self.assertEqual(normalize_viser_url("wss://192.168.1.77:8095"), "http://192.168.1.77:8095/")
        self.assertEqual(normalize_viser_url("http://10.0.0.8:8095/foo"), "http://10.0.0.8:8095/foo")
        self.assertEqual(normalize_viser_url("127.0.0.1"), "http://127.0.0.1:8095/")
        self.assertEqual(normalize_viser_url("http://127.0.0.1:8095"), "http://127.0.0.1:8095/")
        self.assertEqual(normalize_viser_url("https://example.com/"), "")
        self.assertEqual(normalize_viser_url("http://8.8.8.8:8095/"), "")
        self.assertEqual(normalize_viser_url("http://169.254.169.254/"), "")
        self.assertTrue(is_private_lan_host("192.168.1.77"))
        self.assertTrue(is_private_lan_host("127.0.0.1"))
        self.assertTrue(is_private_lan_host("169.254.1.20"))
        self.assertTrue(is_private_lan_host("openarm.local"))
        self.assertFalse(is_private_lan_host("8.8.8.8"))
        self.assertFalse(is_private_lan_host("169.254.169.254"))

    def test_allow_viser_target(self) -> None:
        url, host, port, path = allow_viser_target("http://192.168.1.77:8095/")
        self.assertEqual(host, "192.168.1.77")
        self.assertEqual(port, 8095)
        self.assertEqual(path, "/")
        self.assertTrue(url.startswith("http://192.168.1.77:8095"))
        with self.assertRaises(ValueError):
            allow_viser_target("http://example.com/")

    def test_camera_host_normalize(self) -> None:
        self.assertEqual(normalize_camera_host("192.168.1.83"), "192.168.1.83")
        self.assertEqual(normalize_camera_host("192.168.1.83:8089"), "192.168.1.83:8089")
        self.assertEqual(normalize_camera_host("8.8.8.8"), "")

    def test_sam_defaults_are_lan_only(self) -> None:
        sam = {"id": "sam", "email": "sam@render3d.app"}
        other = {"id": "ada", "email": "ada@example.com"}
        self.assertTrue(is_sam_camera_account(sam))
        self.assertFalse(is_sam_camera_account(other))
        self.assertEqual(defaults_for(sam)["cameraHost"], "192.168.1.83")
        self.assertEqual(defaults_for(sam)["viserActive"], "http://127.0.0.1:8095/")
        self.assertEqual(defaults_for(sam)["viserUrls"], ["http://127.0.0.1:8095/"])
        self.assertEqual(defaults_for(sam)["teleopActive"], "https://192.168.1.77:8443/teleop")
        self.assertEqual(defaults_for(other)["cameraHost"], "")
        self.assertEqual(defaults_for(other)["viserActive"], "http://127.0.0.1:8095/")
        self.assertEqual(defaults_for(other)["viserUrls"], ["http://127.0.0.1:8095/"])

    def test_placeholder_jpeg_is_not_empty(self) -> None:
        from backend.services.hand_cam_stream import is_placeholder_jpeg, latest_live_jpeg

        data = placeholder_jpeg("left")
        self.assertGreater(len(data), 20)
        self.assertEqual(latest_jpeg("right")[:2], data[:2])
        self.assertTrue(is_placeholder_jpeg(data))
        self.assertIsNone(latest_live_jpeg("left"))

    def test_avfoundation_skips_facetime(self) -> None:
        from backend.services.hand_cam_stream import (
            empty_stream_reason,
            list_wrist_device_indices,
            parse_avfoundation_devices,
        )

        text = (
            "[AVFoundation indev @ 0x0] AVFoundation video devices:\n"
            "[AVFoundation indev @ 0x0] [0] FaceTime HD Camera\n"
            "[AVFoundation indev @ 0x0] [1] Left Arducam B0495\n"
            "[AVFoundation indev @ 0x0] [2] Right Arducam B0495\n"
            "[AVFoundation indev @ 0x0] AVFoundation audio devices:\n"
            "[AVFoundation indev @ 0x0] [0] MacBook Pro Microphone\n"
        )
        names = parse_avfoundation_devices(text)
        self.assertEqual(names[0][1], "FaceTime HD Camera")
        self.assertEqual(list_wrist_device_indices(text), (1, 2))

        only_face = (
            "[AVFoundation indev @ 0x0] AVFoundation video devices:\n"
            "[AVFoundation indev @ 0x0] [0] FaceTime HD Camera\n"
            "[AVFoundation indev @ 0x0] [1] Capture screen 0\n"
        )
        self.assertEqual(list_wrist_device_indices(only_face), (None, None))
        self.assertIn("only FaceTime", empty_stream_reason(only_face, "left"))

        only_screen = (
            "[AVFoundation indev @ 0x0] AVFoundation video devices:\n"
            "[AVFoundation indev @ 0x0] [0] Capture screen 0\n"
        )
        self.assertEqual(list_wrist_device_indices(only_screen), (None, None))
        screen_reason = empty_stream_reason(only_screen, "left")
        self.assertIn("only Capture screen", screen_reason)
        self.assertIn("plugged in", screen_reason)
        self.assertNotIn("FaceTime", screen_reason)
        self.assertNotIn("skip FaceTime", screen_reason)

        one_usb = (
            "[AVFoundation indev @ 0x0] AVFoundation video devices:\n"
            "[AVFoundation indev @ 0x0] [0] Arducam B0495 (USB3 2.3MP)\n"
            "[AVFoundation indev @ 0x0] [1] Capture screen 0\n"
        )
        self.assertEqual(list_wrist_device_indices(one_usb), (0, None))
        self.assertIn("only 1 camera", empty_stream_reason(one_usb, "right"))

        from backend.services.hand_cam_stream import _is_skipped_camera

        self.assertFalse(_is_skipped_camera("Arducam B0495 (USB3 2.3MP)"))
        self.assertFalse(_is_skipped_camera("Left Arducam B0495"))
        self.assertFalse(_is_skipped_camera("OpenArm wrist cam"))
        self.assertTrue(_is_skipped_camera("FaceTime HD Camera"))
        self.assertTrue(_is_skipped_camera("Capture screen 0"))
        self.assertFalse(_is_skipped_camera("iPhone Continuity Camera"))
        mixed_iphone = (
            "[AVFoundation indev @ 0x0] AVFoundation video devices:\n"
            "[AVFoundation indev @ 0x0] [0] iPhone Continuity Camera\n"
            "[AVFoundation indev @ 0x0] [1] Arducam B0495\n"
            "[AVFoundation indev @ 0x0] [2] Capture screen 0\n"
        )
        self.assertEqual(list_wrist_device_indices(mixed_iphone), (1, None))

    def test_label_map_maps_sole_device_to_right_and_status_reenumerates(self) -> None:
        from unittest.mock import patch

        from backend.services.hand_cam_stream import (
            assign_wrist_sides,
            capture_status,
            invalidate_device_cache,
            merge_camera_records,
            parse_avfoundation_devices,
            parse_system_profiler_camera_records,
            resolve_wrist_devices,
            set_camera_label_map,
        )

        one_usb = (
            "[AVFoundation indev @ 0x0] AVFoundation video devices:\n"
            "[AVFoundation indev @ 0x0] [0] Arducam B0495 (USB3 2.3MP)\n"
            "[AVFoundation indev @ 0x0] [1] Capture screen 0\n"
        )
        names = parse_avfoundation_devices(one_usb)
        records = merge_camera_records(names, [])
        left, right = assign_wrist_sides(records, {"name:arducam b0495": {"side": "right", "keys": ["name:arducam b0495"]}})
        self.assertIsNone(left)
        self.assertEqual(right, 0)

        profile = (
            "    Arducam B0495:\n"
            "      Model ID: UVC Camera VendorID_1204 ProductID_18768\n"
            "      Unique ID: 0x310000004b44950\n"
        )
        prof = parse_system_profiler_camera_records(profile)
        self.assertEqual(prof[0]["uniqueId"], "0x310000004b44950")
        self.assertIn("04b4:4950", prof[0]["usb"])

        unplugged = (
            "[AVFoundation indev @ 0x0] AVFoundation video devices:\n"
            "[AVFoundation indev @ 0x0] [0] Capture screen 0\n"
        )
        set_camera_label_map({"devices": {}, "titles": {}}, persist=False)
        invalidate_device_cache()
        from backend.services import hand_cam_stream as hcs

        hcs._CAPS.clear()
        clock = {"t": 40.0}

        def mono() -> float:
            return clock["t"]

        with patch("backend.services.hand_cam_stream._ffmpeg_device_list", side_effect=[one_usb, unplugged, unplugged, unplugged]), patch(
            "backend.services.hand_cam_stream._system_profiler_cameras",
            return_value="",
        ), patch("backend.services.hand_cam_stream.time.monotonic", side_effect=mono):
            pair1 = resolve_wrist_devices(refresh=True)
            self.assertEqual(pair1[0], 0)
            clock["t"] += 0.2
            pair2 = resolve_wrist_devices(refresh=True)
            self.assertEqual(pair2[0], 0)
            clock["t"] += 2.0
            pair3 = resolve_wrist_devices(refresh=True)
            self.assertEqual(pair3[0], None)
            self.assertEqual(pair3[1], None)
            status = capture_status(refresh=True)
            self.assertEqual(status["wristCount"], 0)
            self.assertTrue(all(d.get("skipped") for d in status["devices"]))

    def test_hold_last_good_jpeg_across_brief_miss(self) -> None:
        from unittest.mock import patch

        from backend.services import hand_cam_stream as hcs

        jpeg = b"\xff\xd8" + b"x" * 120 + b"\xff\xd9"
        hcs._PUBLISH = True
        hcs._CACHE.clear()
        hcs._LAST_GOOD.clear()
        hcs._CAPS.clear()
        with patch.object(hcs, "_CACHE_TTL", 0), patch.object(hcs, "_ensure_grab_workers"), patch.object(hcs, "_grab_side", side_effect=[jpeg, None]):
            data1, live1 = hcs.latest_jpeg_status("left")
            self.assertTrue(live1)
            self.assertEqual(data1, jpeg)
            data2, live2 = hcs.latest_jpeg_status("left")
            self.assertTrue(live2)
            self.assertEqual(data2, jpeg)
        hcs._PUBLISH = False
        hcs._stop_grab_workers()
        hcs._CACHE.clear()
        hcs._LAST_GOOD.clear()

    def test_live_jpeg_skips_snapshot_ffmpeg_while_worker_runs(self) -> None:
        from unittest.mock import patch

        from backend.services import hand_cam_stream as hcs

        jpeg = b"\xff\xd8" + b"y" * 120 + b"\xff\xd9"
        hcs._PUBLISH = True
        hcs._CACHE.clear()
        hcs._LAST_GOOD["left"] = (time.monotonic(), jpeg)
        with patch.object(hcs, "_CACHE_TTL", 0), patch.object(hcs, "_ensure_grab_workers"), patch.object(
            hcs, "_worker_alive", return_value=True
        ), patch.object(hcs, "_grab_side") as grab:
            data, live = hcs.latest_jpeg_status("left")
        self.assertTrue(live)
        self.assertEqual(data, jpeg)
        grab.assert_not_called()
        hcs._PUBLISH = False
        hcs._LAST_GOOD.clear()
        hcs._CACHE.clear()

    def test_stale_worker_jpeg_is_not_live(self) -> None:
        from unittest.mock import patch

        from backend.services import hand_cam_stream as hcs

        jpeg = b"\xff\xd8" + b"z" * 120 + b"\xff\xd9"
        hcs._PUBLISH = True
        hcs._CACHE.clear()
        hcs._LAST_GOOD["left"] = (time.monotonic() - 8.0, jpeg)
        with patch.object(hcs, "_CACHE_TTL", 0), patch.object(hcs, "_ensure_grab_workers"), patch.object(
            hcs, "_worker_alive", return_value=True
        ), patch.object(hcs, "_grab_side") as grab:
            _data, live = hcs.latest_jpeg_status("left")
        self.assertFalse(live)
        grab.assert_not_called()
        hcs._PUBLISH = False
        hcs._LAST_GOOD.clear()
        hcs._CACHE.clear()

    def test_ffmpeg_stream_cmd_is_low_latency(self) -> None:
        from backend.services.hand_cam_stream import _ffmpeg_stream_cmd, _take_latest_jpeg

        cmd = " ".join(_ffmpeg_stream_cmd("/opt/homebrew/bin/ffmpeg", 2))
        self.assertIn("-framerate 10", cmd)
        self.assertIn("image2pipe", cmd)
        self.assertIn("mjpeg", cmd)
        self.assertNotIn("-framerate 30", cmd)
        first = b"\xff\xd8" + b"a" * 8 + b"\xff\xd9"
        second = b"\xff\xd8" + b"b" * 8 + b"\xff\xd9"
        buf = bytearray(first + second + b"\xff\xd8partial")
        got = _take_latest_jpeg(buf)
        self.assertEqual(got, second)
        self.assertTrue(buf.startswith(b"\xff\xd8partial"))

    def test_camera_permission_helper_names_python_app(self) -> None:
        from backend.services.hand_cam_stream import (
            CAMERA_PRIVACY_URLS,
            _app_from_path,
            camera_permission_helper,
        )

        self.assertEqual(
            _app_from_path(
                "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python"
            ),
            "Python.app",
        )
        helper = camera_permission_helper("Python.app")
        self.assertIn("Python", helper)
        self.assertIn("Camera prompt", helper)
        self.assertNotIn("Developer Tools", helper)
        self.assertNotIn("Cmd+Shift+G", helper)
        self.assertTrue(any("Privacy_Camera" in url for url in CAMERA_PRIVACY_URLS))

    def test_request_permission_spawns_python_camera_cli(self) -> None:
        import time
        from unittest.mock import MagicMock, patch

        from backend.services.hand_cam_stream import (
            _python_app_binary,
            python_camera_open_cmd,
            request_camera_permission,
        )

        clt = (
            "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework"
            "/Versions/3.9/Resources/Python.app/Contents/MacOS/Python"
        )
        with patch("backend.services.hand_cam_stream._is_exec", return_value=True):
            self.assertEqual(
                _python_app_binary(
                    "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework"
                    "/Versions/3.9/bin/python3.9"
                ),
                clt,
            )
        cmd = python_camera_open_cmd(0)
        self.assertEqual(cmd[1], "-c")
        self.assertIn("VideoCapture", cmd[2])
        self.assertIn("cv2", cmd[2])

        started = time.monotonic()
        with patch("backend.services.hand_cam_stream.subprocess.Popen") as popen, patch(
            "backend.services.hand_cam_stream._probe_device_open",
            side_effect=lambda *a, **k: (time.sleep(8), (False, "hang"))[1],
        ), patch(
            "backend.services.hand_cam_stream._usable_wrist_index",
            return_value=(1, [(1, "Arducam B0495")]),
        ), patch(
            "backend.services.hand_cam_stream.is_skippable_camera_index",
            return_value=False,
        ), patch(
            "backend.services.hand_cam_stream.kill_hand_cam_children",
            return_value=0,
        ), patch(
            "backend.services.hand_cam_stream.time.sleep",
            return_value=None,
        ):
            popen.return_value = MagicMock(pid=4242)
            payload = request_camera_permission()
        self.assertLess(time.monotonic() - started, 1.5)
        self.assertTrue(payload.get("prompted"))
        self.assertIn("VideoCapture", str(payload.get("cli") or ""))
        self.assertIn("Camera prompt", str(payload.get("helper") or ""))
        argv_lists = [list(c.args[0]) for c in popen.call_args_list if c.args]
        self.assertTrue(
            any(len(a) >= 3 and a[1] == "-c" and "VideoCapture" in a[2] for a in argv_lists),
            argv_lists,
        )

    def test_hand_cam_publish_is_idempotent(self) -> None:
        from unittest.mock import patch

        from backend.services.hand_cam_stream import is_publish_on, set_publish

        with patch("backend.services.hand_cam_stream.kill_hand_cam_children", return_value=0) as killer, patch(
            "backend.services.hand_cam_stream.time.sleep",
            return_value=None,
        ) as slept:
            set_publish(False)
            self.assertFalse(is_publish_on())
            killer.reset_mock()
            slept.reset_mock()
            self.assertTrue(set_publish(True))
            self.assertEqual(killer.call_count, 1)
            killer.reset_mock()
            self.assertTrue(set_publish(True))
            self.assertEqual(killer.call_count, 0)
            slept.reset_mock()
            self.assertTrue(set_publish(True, restart=True))
            self.assertEqual(killer.call_count, 1)
            self.assertTrue(any(float(c.args[0]) >= 0.3 for c in slept.call_args_list if c.args))
            self.assertTrue(is_publish_on())
            self.assertFalse(set_publish(False))
            self.assertEqual(killer.call_count, 2)

    def test_grab_locks_are_per_camera_not_global(self) -> None:
        from backend.services import hand_cam_stream as hcs

        self.assertEqual(set(hcs._SIDE_LOCKS), {"left", "right"})
        self.assertFalse(hasattr(hcs, "_FFMPEG_GATE"))
        src = inspect.getsource(hcs.latest_jpeg_status)
        self.assertIn("_ensure_grab_workers", src)
        self.assertIn("_worker_alive", src)
        self.assertIn("_looks_unplugged", src)
        inner = inspect.getsource(hcs._worker_loop_inner)
        self.assertIn("0.85 if which == \"right\"", inner)
        worker = inspect.getsource(hcs._ensure_grab_workers)
        self.assertIn("hand-cam-{side}", worker)
        self.assertIn('"right"', worker)


class RoboticsRouterImportTests(unittest.TestCase):
    def test_router_paths_exist(self) -> None:
        from backend.routers.robotics_studio import router

        paths = {getattr(r, "path", "") for r in router.routes}
        self.assertTrue(any("/api/viser/open" in p for p in paths))
        self.assertTrue(any("/api/teleop/open" in p for p in paths))
        self.assertTrue(any("/api/robotics/hand-cam/{side}.jpg" in p for p in paths))
        self.assertTrue(any("/api/robotics/hand-cam/{side}.mjpeg" in p for p in paths))
        self.assertTrue(any("/api/robotics/hand-cam/status" in p for p in paths))
        self.assertTrue(any("/api/robotics/hand-cam/request-permission" in p for p in paths))
        self.assertTrue(any("/api/cam/p/{host}/{port}/{side}.jpg" in p for p in paths))
        self.assertTrue(any("robotics-prefs" in p for p in paths))
        self.assertTrue(any("cloud-compute-interest" in p for p in paths))

    def test_hand_cam_jpeg_offloads_ffmpeg_off_event_loop(self) -> None:
        from backend.routers import robotics_studio as rs

        src = inspect.getsource(rs.hand_cam_jpeg)
        self.assertIn("asyncio.to_thread", src)
        self.assertIn("latest_live_jpeg", src)
        mjpeg = inspect.getsource(rs.hand_cam_mjpeg)
        self.assertIn("StreamingResponse", mjpeg)
        self.assertIn("asyncio.sleep", mjpeg)
        self.assertIn("peek_live_jpeg", mjpeg)
        self.assertNotIn("time.sleep", mjpeg)

    def test_hand_cam_mjpeg_retries_the_pi_camera_wall(self) -> None:
        from unittest.mock import AsyncMock, patch

        from backend.routers import robotics_studio as rs

        class Request:
            headers = {"host": "render3d.app"}

            async def is_disconnected(self) -> bool:
                return False

        pi_frame = b"\xff\xd8pi-mjpeg-frame\xff\xd9"

        async def first_chunk() -> bytes:
            with patch.object(rs, "ensure_hand_cam_streaming"), patch.object(
                rs,
                "peek_live_jpeg",
                return_value=(None, 0),
            ), patch.object(
                rs.robot_camera_wall,
                "frame",
                new=AsyncMock(return_value=(pi_frame, "image/jpeg")),
            ) as pi_fallback:
                response = await rs.hand_cam_mjpeg("left", Request())
                chunk = await response.body_iterator.__anext__()
                await response.body_iterator.aclose()
            pi_fallback.assert_awaited_once_with("left")
            return chunk

        chunk = asyncio.run(first_chunk())
        self.assertIn(pi_frame, chunk)
        self.assertIn(b"X-Hand-Cam-Live: 1", chunk)

    def test_self_hosted_render3d_host_can_open_lan_viser(self) -> None:
        from unittest.mock import patch

        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from backend.auth import get_current_user
        from backend.routers.robotics_studio import router

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: {"id": "u1", "email": "ada@example.com"}
        unreachable = "Can't reach Viser at http://127.0.0.1:8080/. Start Viser locally or enter a LAN address."
        client = TestClient(app)
        with patch("backend.routers.robotics_studio.probe_viser", return_value=(False, unreachable)):
            res = client.post(
                "/api/viser/open",
                json={"url": "http://127.0.0.1:8080/"},
                headers={"host": "render3d.app"},
            )
        self.assertNotEqual(res.status_code, 403, res.text)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertTrue(str(body.get("iframe") or "").startswith("/api/viser/p/127.0.0.1/8080"))
        self.assertEqual(body.get("ok"), False)
        self.assertNotIn("Cloud Studio", str(body.get("error") or ""))
        self.assertIn("Start Viser locally", str(body.get("error") or ""))

        with patch("backend.routers.robotics_studio.probe_viser", return_value=(True, "")):
            lan = client.post(
                "/api/viser/open",
                json={"url": "http://192.168.1.77:8080/"},
                headers={"host": "render3d.app"},
            )
        self.assertEqual(lan.status_code, 200, lan.text)
        self.assertEqual(lan.json().get("ok"), True)
        self.assertIn("/api/viser/p/192.168.1.77/8080", lan.json().get("iframe") or "")

        with patch("backend.routers.robotics_studio.latest_live_jpeg", return_value=None), patch(
            "backend.routers.robotics_studio.last_stream_reason",
            return_value="no wrist USB camera, only FaceTime",
        ):
            jpeg = client.get("/api/robotics/hand-cam/left.jpg", headers={"host": "render3d.app"})
        self.assertNotEqual(jpeg.status_code, 403)
        self.assertEqual(jpeg.status_code, 503, jpeg.text)
        self.assertEqual(jpeg.headers.get("x-hand-cam-live"), "0")
        self.assertEqual(jpeg.headers.get("x-hand-cam-reason"), "no wrist USB camera, only FaceTime")
        self.assertNotEqual(jpeg.status_code, 404)

        pi_frame = b"\xff\xd8pi-wrist-frame\xff\xd9"
        with patch("backend.routers.robotics_studio.latest_live_jpeg", return_value=None), patch(
            "backend.routers.robotics_studio.last_stream_reason",
            return_value="no wrist USB camera plugged in",
        ), patch(
            "backend.routers.robotics_studio.robot_camera_wall.frame",
            return_value=(pi_frame, "image/jpeg"),
        ) as pi_fallback:
            jpeg = client.get("/api/robotics/hand-cam/left.jpg", headers={"host": "render3d.app"})
        self.assertEqual(jpeg.status_code, 200, jpeg.text)
        self.assertEqual(jpeg.content, pi_frame)
        self.assertEqual(jpeg.headers.get("x-hand-cam-live"), "1")
        pi_fallback.assert_awaited_once_with("left")

        from backend.services.hand_cam_stream import is_self_camera_target

        self.assertTrue(is_self_camera_target("127.0.0.1", 8001))
        with patch("backend.routers.robotics_studio.latest_live_jpeg", return_value=None), patch(
            "backend.routers.robotics_studio.last_stream_reason",
            return_value="no wrist USB camera plugged in",
        ):
            proxy = client.get("/api/cam/p/127.0.0.1/8001/left.jpg", headers={"host": "render3d.app"})
        self.assertEqual(proxy.status_code, 503)
        self.assertNotIn("Not Found", proxy.text)

        pi_status = {
            "cameras": {
                "left": {"live": True, "label": "Left wrist"},
                "right": {"live": True, "label": "Right wrist"},
            },
        }
        local_status = {
            "publish": True,
            "devices": [],
            "wristCount": 0,
            "leftLive": False,
            "rightLive": False,
            "leftReason": "no wrist USB camera plugged in",
            "rightReason": "no wrist USB camera plugged in",
        }
        with patch("backend.routers.robotics_studio.capture_status", return_value=local_status), patch(
            "backend.routers.robotics_studio.robot_camera_wall.status",
            return_value=pi_status,
        ) as pi_status_fallback:
            status = client.get("/api/robotics/hand-cam/status", headers={"host": "render3d.app"})
        self.assertEqual(status.status_code, 200, status.text)
        self.assertEqual(status.json().get("source"), "raspberry-pi")
        self.assertEqual(status.json().get("wristCount"), 2)
        pi_status_fallback.assert_awaited_once_with()

        top_frame = b"\xff\xd8pi-top-frame\xff\xd9"
        with patch(
            "backend.routers.robotics_studio.robot_camera_wall.frame",
            return_value=(top_frame, "image/jpeg"),
        ) as top_fallback, patch("backend.routers.robotics_studio.zed_peek_live_jpeg", return_value=(None, 0, "offline")):
            top = client.get("/api/robotics/zed.jpg", headers={"host": "render3d.app"})
        self.assertEqual(top.status_code, 200, top.text)
        self.assertEqual(top.content, top_frame)
        top_fallback.assert_awaited_once_with("zed")

        from backend.services.hand_cam_stream import set_publish

        set_publish(False)
        pub = client.get("/api/robotics/hand-cam/publish", headers={"host": "192.168.1.83:8001"})
        self.assertEqual(pub.status_code, 200, pub.text)
        self.assertFalse(pub.json().get("publish"))
        on = client.post(
            "/api/robotics/hand-cam/publish",
            json={"on": True},
            headers={"host": "192.168.1.83:8001"},
        )
        self.assertEqual(on.status_code, 200, on.text)
        self.assertTrue(on.json().get("publish"))
        again = client.post(
            "/api/robotics/hand-cam/publish",
            json={"on": True},
            headers={"host": "192.168.1.83:8001"},
        )
        self.assertEqual(again.status_code, 200, again.text)
        self.assertTrue(again.json().get("publish"))
        set_publish(False)

        from backend.services.hand_cam_stream import CAMERA_PRIVACY_URLS

        self.assertTrue(any("Privacy_Camera" in u for u in CAMERA_PRIVACY_URLS))
        with patch("backend.routers.robotics_studio.request_camera_permission", return_value={
            "ok": True,
            "publish": True,
            "app": "Python.app",
            "privacyOpened": True,
            "prompted": True,
            "live": False,
            "helper": "Check the Mac for a Camera prompt for Python.",
            "reason": "camera permission denied for Studio",
        }):
            perm = client.post(
                "/api/robotics/hand-cam/request-permission",
                headers={"host": "192.168.1.83:8001"},
            )
        self.assertEqual(perm.status_code, 200, perm.text)
        self.assertEqual(perm.json().get("app"), "Python.app")
        self.assertTrue(perm.json().get("prompted"))
        self.assertTrue(perm.json().get("publish"))

        with patch("backend.routers.robotics_studio.probe_viser", return_value=(True, "")):
            https_lan = client.post(
                "/api/viser/open",
                json={"url": "https://192.168.1.77:8095/"},
                headers={"host": "render3d.app"},
            )
        self.assertEqual(https_lan.status_code, 200, https_lan.text)
        self.assertEqual(https_lan.json().get("ok"), True)
        self.assertTrue(str(https_lan.json().get("url") or "").startswith("http://192.168.1.77:8095"))
        self.assertIn("/api/viser/p/192.168.1.77/8095", https_lan.json().get("iframe") or "")


class HandCamChildKillerTests(unittest.TestCase):
    def test_matcher_keeps_unrelated_ffmpeg_and_uvicorn(self) -> None:
        from backend.services.hand_cam_stream import is_hand_cam_child_cmdline

        studio = (
            "/Users/sam/Render-Studio/.venv/bin/ffmpeg -hide_banner -loglevel error "
            "-f avfoundation -framerate 30 -i 0 -frames:v 1 -y /tmp/handcam-perm-0.jpg"
        )
        other = "/opt/homebrew/bin/ffmpeg -i movie.mov -c:v libx264 /tmp/out.mp4"
        uvicorn = (
            "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/"
            "Versions/3.9/Resources/Python.app/Contents/MacOS/Python -m uvicorn "
            "backend.main:app --host 0.0.0.0 --port 8001"
        )
        listed = (
            "/Users/sam/Render-Studio/.venv/bin/ffmpeg -f avfoundation "
            "-list_devices true -i "
        )
        cv2_cli = (
            "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/"
            "Versions/3.9/Resources/Python.app/Contents/MacOS/Python -c "
            "import cv2,time;c=cv2.VideoCapture(1)"
        )
        venv_short = "/Users/sam/Render-Studio/.venv/bin/ffmpeg -hide_banner -f avfoundation -i 1"
        homebrew_snap = (
            "/opt/homebrew/bin/ffmpeg -f avfoundation -i 0 -frames:v 1 -y /tmp/out.jpg"
        )
        self.assertTrue(is_hand_cam_child_cmdline(studio))
        self.assertTrue(is_hand_cam_child_cmdline(cv2_cli))
        self.assertTrue(is_hand_cam_child_cmdline(venv_short))
        self.assertFalse(is_hand_cam_child_cmdline(other))
        self.assertFalse(is_hand_cam_child_cmdline(uvicorn))
        self.assertFalse(is_hand_cam_child_cmdline(listed))
        self.assertFalse(is_hand_cam_child_cmdline(homebrew_snap))

    def test_spawn_and_grab_skip_capture_screen(self) -> None:
        from backend.services import hand_cam_stream as hcs

        prev_names = list(hcs._device_names)
        prev_recs = list(hcs._device_records)
        prev_cache = hcs._device_cache
        try:
            hcs._device_names = [(0, "Capture screen 0"), (1, "FaceTime HD Camera")]
            hcs._device_records = [
                {"index": 0, "name": "Capture screen 0", "skipped": True},
                {"index": 1, "name": "FaceTime HD Camera", "skipped": True},
            ]
            hcs._device_cache = (time.monotonic(), (None, None))
            screen = hcs.spawn_ffmpeg_camera_cli(0)
            face = hcs.spawn_ffmpeg_camera_cli(1)
            self.assertFalse(screen.get("ok"))
            self.assertIn("skip", str(screen.get("error") or "").lower())
            self.assertFalse(face.get("ok"))
            frame, err = hcs._grab_ffmpeg(0, timeout=0.2)
            self.assertIsNone(frame)
            self.assertIn("skip", err.lower())
        finally:
            hcs._device_names = prev_names
            hcs._device_records = prev_recs
            hcs._device_cache = prev_cache

    def test_killer_only_signals_hand_cam_pids(self) -> None:
        from unittest.mock import patch

        from backend.services.hand_cam_stream import kill_hand_cam_children

        studio = (
            "/Users/sam/Render-Studio/.venv/bin/ffmpeg -hide_banner -f avfoundation "
            "-i 0 -frames:v 1 -y /tmp/handcam-perm-0.jpg"
        )
        uvicorn = "Python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001"
        other = "/opt/homebrew/bin/ffmpeg -i movie.mov /tmp/out.mp4"
        sent: list[int] = []

        def fake_kill(pid: int, sig: int = 15) -> bool:
            sent.append(pid)
            return True

        rows = [(4242, studio), (10706, uvicorn), (99, other)]
        with patch("backend.services.hand_cam_stream._iter_process_rows", return_value=rows), patch(
            "backend.services.hand_cam_stream._safe_kill",
            side_effect=fake_kill,
        ), patch("backend.services.hand_cam_stream._release_caps"), patch(
            "backend.services.hand_cam_stream.time.sleep",
            return_value=None,
        ):
            n = kill_hand_cam_children()
        self.assertGreaterEqual(n, 1)
        self.assertIn(4242, sent)
        self.assertNotIn(10706, sent)
        self.assertNotIn(99, sent)

    def test_killer_signals_descendant_avfoundation_ffmpeg(self) -> None:
        from unittest.mock import patch

        from backend.services.hand_cam_stream import kill_hand_cam_children

        hung = "/opt/homebrew/bin/ffmpeg -f avfoundation -pixel_format uyvy422 -i 0"
        sent: list[int] = []

        def fake_kill(pid: int, sig: int = 15) -> bool:
            sent.append(pid)
            return True

        rows = [(888, hung)]
        with patch("backend.services.hand_cam_stream._iter_process_rows", return_value=rows), patch(
            "backend.services.hand_cam_stream._pid_is_descendant",
            return_value=True,
        ), patch(
            "backend.services.hand_cam_stream._safe_kill",
            side_effect=fake_kill,
        ), patch("backend.services.hand_cam_stream._release_caps"), patch(
            "backend.services.hand_cam_stream.time.sleep",
            return_value=None,
        ):
            n = kill_hand_cam_children()
        self.assertGreaterEqual(n, 1)
        self.assertIn(888, sent)

    def test_recam_waits_even_when_no_child_pid(self) -> None:
        from unittest.mock import patch

        from backend.services.hand_cam_stream import set_publish

        with patch("backend.services.hand_cam_stream.kill_hand_cam_children", return_value=0), patch(
            "backend.services.hand_cam_stream.time.sleep",
            return_value=None,
        ) as slept:
            set_publish(True, restart=True)
        self.assertTrue(any(float(c.args[0]) >= 0.3 for c in slept.call_args_list if c.args))

    def test_grab_kills_timed_out_popen(self) -> None:
        from unittest.mock import MagicMock, patch

        from backend.services import hand_cam_stream as hcs

        proc = MagicMock()
        proc.pid = 777
        proc.poll.return_value = None
        proc.communicate.side_effect = subprocess.TimeoutExpired(cmd="ffmpeg", timeout=0.1)
        prev_names = list(hcs._device_names)
        prev_recs = list(hcs._device_records)
        try:
            hcs._device_names = [(2, "Arducam B0495")]
            hcs._device_records = [{"index": 2, "name": "Arducam B0495", "skipped": False}]
            with patch.object(hcs, "_ffmpeg_bin", return_value="/Users/sam/Render-Studio/.venv/bin/ffmpeg"), patch.object(
                hcs.subprocess, "Popen", return_value=proc
            ), patch.object(hcs, "_kill_popen", return_value=True) as killer:
                frame, err = hcs._grab_ffmpeg(2, timeout=0.1)
            self.assertIsNone(frame)
            self.assertIn("timed out", err)
            killer.assert_called()
        finally:
            hcs._device_names = prev_names
            hcs._device_records = prev_recs


class ViserHtmlRewriteTests(unittest.TestCase):
    def test_html_rewrite_is_same_origin_prefix(self) -> None:
        html = rewrite_viser_html(
            '<html><head></head><body><script src="/assets/index.js"></script></body></html>',
            "/api/viser/p/192.168.1.77/8095/",
            "192.168.1.77",
        )
        self.assertIn('href="/api/viser/p/192.168.1.77/8095/"', html)
        self.assertIn('src="/api/viser/p/192.168.1.77/8095/assets/index.js"', html)
        self.assertIn("window.WebSocket", html)
        self.assertIn("192.168.1.77", html)
