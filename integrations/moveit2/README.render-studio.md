# MoveIt2 server (Render Studio)

Local WebSocket motion-planning helper used with CAD Viewer / SRDF workflows.

**Canonical path:** `integrations/moveit2/` (repo-relative).  
Old path `tools/moveit2_server/` is a compatibility stub only.

## Upstream

- MoveIt2: https://github.com/moveit/moveit2
- RoboStack / conda-forge ROS: see `environment.yml` in this folder

## Setup (any machine)

```bash
cd integrations/moveit2
./setup.sh
# or follow README steps for conda env creation
```

Run via the repo script (resolves paths from the script location):

```bash
./scripts/run-moveit2-for-project.sh <project_id_or_abs_path>
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `MOVEIT2_SERVER_HOST` | `127.0.0.1` | Bind host |
| `MOVEIT2_SERVER_PORT` | `8765` | Bind port |
| `MOVEIT2_SERVER_REPO_ROOT` | set by runner | Project/repo CAD root |
| `RENDER_STUDIO_ROOT` | auto | Optional override of repo root |

Do not hard-code absolute developer machine paths in launch scripts.
