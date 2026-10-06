# OpenArm 2.0 Raspberry Pi + MuJoCo wiring

This setup connects Render Studio to a Raspberry Pi over the private LAN. Start with telemetry and Shadow mode. Do not enable physical motion until joint order, direction, limits, and the physical emergency stop have been verified.

## Physical wiring

1. Power the Raspberry Pi from its own regulated supply. Do not power motors from the Pi 5 V rail.
2. Connect the OpenArm motor bus/interface board to the Pi using the interface required by that board (normally USB or CAN through an isolated adapter). Follow the controller vendor's pinout; never guess GPIO-to-motor wiring.
3. Put the motor supply behind a physical, normally-closed emergency-stop circuit that removes actuator power. The Pi and motor logic may remain powered so faults can still be reported.
4. Bond protective earth and the robot frame as required by the motor-supply manufacturer. Keep motor power wiring separate from Pi, camera, and Ethernet/USB wiring.
5. Connect the Pi by Ethernet when possible. Reserve its LAN address in the router; the current Studio profile expects `192.168.1.77`.
6. Before applying motor power, verify polarity, protective earth, bus termination, and that the arm is mechanically supported.

## Pi services expected by Studio

Bind only to the trusted LAN, not the public internet:

```text
http://0.0.0.0:8450/robotics/config
http://0.0.0.0:8095/                 Viser
http://0.0.0.0:8001/                 wrist/ZED camera snapshots
https://0.0.0.0:8443/teleop          DimOS/OpenArm teleop
wss://0.0.0.0:8443/ws                single-owner control stream
```

The discovery response must use schema `render-studio-robotics/v1`. Render Studio validates that the address is a private LAN IP and stores the selected profile in the signed-in user's Robotics preferences.

The bridge must implement these safety actions:

```http
POST /teleop/y
Content-Type: application/json

{"action":"session_reset"}
```

This must immediately stop target streaming, disable actuator commands, clear queued trajectories, and latch a fault. It must not start homing.

```http
POST /teleop/home
Content-Type: application/json

{"action":"home","require_clear":true}
```

Homing must be rejected unless the kill is acknowledged, the operator explicitly requests recovery, joint feedback is fresh, the configured home path passes limits/collision checks, and the physical E-stop is released. Use a slow, bounded trajectory; never jump directly to zero radians.

## Bring-up order

1. Start the Pi robotics bridge and confirm `/robotics/config` from another device on the same LAN.
2. In Studio open **ROBOTICS → Robotics home** and press **Connect Pi**.
3. Confirm **SHADOW · PI ONLINE**. Move each joint by hand with actuator power disabled and verify the matching MuJoCo joint direction.
4. Press **KILL / DISABLE NOW** and verify actuator commands are rejected at the Pi.
5. Test guarded homing with the arm supported, reduced current/torque limits, and one operator at the physical E-stop.
6. Keep Hardware mode disabled until tracking-error, stale-state, joint-limit, velocity-limit, and collision gates have independent tests.

The on-screen KILL button is a network command and is not a substitute for the physical emergency stop.

## Mac mini and three-camera view

The Pi publishes snapshots only on the trusted LAN. The Mac mini fetches them server-side and exposes authenticated, same-origin links in Render, so users never receive the Pi address.

```text
Pi 192.168.1.77:8001 → Mac Render backend → /robot-cameras.html
  left wrist             /api/robotics/camera-wall/left.jpg
  right wrist            /api/robotics/camera-wall/right.jpg
  ZED side-by-side       /api/robotics/camera-wall/zed.jpg
```

Set `RENDER3D_ROBOT_CAMERA_BASE=http://192.168.1.77:8001` on the Mac, restart Render, then open `/robot-cameras.html` while signed in. Confirm the Pi first:

```bash
curl http://127.0.0.1:8001/api/robotics/hand-cam/status
curl http://127.0.0.1:8001/api/robotics/zed/status
```

### ZED on Raspberry Pi

The official ZED SDK does not support Raspberry Pi 5. It requires NVIDIA CUDA and its ARM package targets NVIDIA Jetson. Do not install a Jetson or x86 package on the Pi.

For color video, the Pi camera service uses the ZED/ZED Mini USB Video Class side-by-side stream through OpenCV. Connect the ZED directly to a blue USB 3 port without a hub or extension. On ZED Mini, the camera-end USB-C plug is orientation-sensitive: the engraved arrows must face the optics. After reconnecting, verify that `lsusb -t` shows a 5000M video interface and that `v4l2-ctl --list-devices` lists the ZED. Restart `openarm-pi-cameras.service`; it automatically selects `/dev/v4l/by-id/*ZED*video-index0`.

For depth, point clouds, or positional tracking, attach the ZED to a supported NVIDIA Jetson host and set `OPENARM_ZED_CAMERA_URL` on the Pi camera service to that host's JPEG snapshot endpoint.
