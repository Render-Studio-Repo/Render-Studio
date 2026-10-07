# How to run OpenArm MuJoCo (and what it is *not*)

## What this sim is

| System | Role |
|--------|------|
| **MuJoCo tab / sandbox** | Browser **WASM** physics sim (Enactic `openarm_mujoco`) |
| **DimOS + Quest Y** | **Real robot** teleop on the Pi — separate stack |
| **Viser** | **3D viewer** for robot/scene on the Pi — separate stack |

**MuJoCo does not start from Quest Y.**  
**MuJoCo does not auto-pull training data from Viser or DimOS.**

Training demos are recorded from **MuJoCo analysis ticks** in the sandbox (`openarm-mujoco/episodes/`), not from Viser streams.

---

## Three ways to run the sim

### 1. Studio Robotics tab (easiest)

1. Open **Robotics** workspace → ribbon **MuJoCo** (or tab **MuJoCo**).
2. Sim loads automatically (`openarm_bimanual.xml` = arms only, no table).
3. Click in the sim pane — use **keyboard** per the sim’s key bindings (chip **Scene · Reset** in embed).
4. **Snapshot run** → writes `openarm-mujoco/runs/latest.json` for MCP/agents.

### 2. Sandbox full lab (no Studio chrome)

Open in browser:

```
https://render3d.app/sandbox/openarm-mujoco/
```

Same WASM sim, full control panel visible.

### 3. Your own Mac / local dev server (bring your own)

Clone upstream and run the **web** build locally:

```bash
git clone https://github.com/enactic/openarm_mujoco.git
cd openarm_mujoco/web
npm install
npm run dev   # note the port, often 5173
```

In Studio MuJoCo tab, paste your URL and **Connect sim**:

```
http://localhost:5173/?embed=1
```

Requirements:

- Page must load in an iframe (`embed=1` hides the floating panel).
- Must include `analysis-bridge.js` (Render’s vendored copy does).
- CORS/same-origin: local dev on `localhost` works from Studio on `localhost`; production Studio needs HTTPS or same host.

> **Note:** There is no wire-up yet to the **native MuJoCo desktop app** (MuJoCo Pro GUI). Today everything is the Enactic **browser** sim. A native bridge would be a separate integration (e.g. MJCF export + UDP/websocket shim).

---

## Scenes — table / pedestal

| Scene | Contents |
|-------|----------|
| `openarm_bimanual.xml` | **Arms only** (default now) |
| `pedestal/*.xml` | Table + pedestal mount |
| `cell/*.xml` | Workcell with enclosure |

Pick scene in the dropdown — no custom table height slider (removed).

---

## Training data path (sim only)

```
MuJoCo WASM running
    → analysis-bridge (end-of-run / train ticks)
    → openarm-mujoco/runs/latest.json     (agent probe)
    → openarm-mujoco/episodes/*.json(l)   (Train demo in sandbox)
    → external LeRobot / policy retrain   (outside browser)
```

**Viser** shows live robot/scene meshes — useful for monitoring, **not** the training recorder.  
**DimOS** streams real poses to hardware — **never** command hardware from the MuJoCo page.

Sandbox **Train demo** button (agent bar) listens to MuJoCo `postMessage` analysis — see `examples/openarm-train-loop.md`.

---

## MCP / agents

```
grok_mujoco_run
grok_sandbox action=read path=openarm-mujoco/runs/latest.json
```

Full robotics + Y (real robot): `grok_robotics_runbook`
