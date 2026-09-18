# Robotics, motion, and teleop hooks

Render Studio has a real robotics path in the repository, but it is important to describe it precisely.

## What is clearly shipped

The codebase contains user-facing robotics and motion surfaces for:

- rigging assemblies
- generating and loading URDF/SRDF artifacts
- simulating articulated assets in the viewport
- working with robot scenes and motion controls
- optionally connecting to MoveIt2 for pose solving and planning

## The main building blocks

| Path | Role |
|------|------|
| `frontend/rigging-editor.js` | Rigging and joint editing |
| `frontend/robotic-simulator.js` | Robot-oriented workspace and simulation UI |
| `frontend/urdf-robot-runtime.js` | URDF/SRDF runtime in the viewport |
| `backend/physics/urdf.py` | URDF generation helpers |
| `backend/services/rigging_service.py` | Rigging-related backend logic |
| `tools/moveit2_server/` | Optional MoveIt2 websocket server for advanced motion workflows |

## What teams can reasonably expect

### Rigging and articulated review

Render Studio supports the workflow of:

1. creating or importing geometry
2. defining rigging and joints
3. generating robot-friendly artifacts
4. reviewing movement in the same viewport

That makes it useful for robot concept development, motion review, and model preparation.

### URDF/SRDF support

The repo includes clear evidence of:

- URDF generation
- SRDF handling
- link, joint, and visual parsing
- articulated playback in the browser viewport

### MoveIt2 integration

The repository also ships an **optional** MoveIt2 server path.

That path is for:

- inverse kinematics
- plan-to-pose workflows
- motion-planning experiments on top of URDF/SRDF assets

It is not enabled as a default hosted dependency. The docs in `tools/moveit2_server/README.md` explicitly describe it as an optional module with its own environment.

## The teleop note

The user's mental model may include "robotics teleop," but the current codebase does **not** present a standalone teleoperation product layer with operator networking, joystick session management, or field-control infrastructure.

The accurate claim today is:

> Render Studio ships robotics and motion-planning building blocks, including rigging, URDF/SRDF runtime, simulation-facing UI, and optional MoveIt2 hooks.

That is a strong story. It is also different from claiming a fully packaged teleop stack.

## Where it fits in the broader product

The robotics path sits alongside:

- AI CAD generation
- solid modeling
- wiring and electronics
- XR review
- cloud CAD import/export

For founders and engineering teams, the value is that robot-oriented geometry and review do not need to leave the main Studio context.

## Roadmap framing

These statements are safe:

- robotics support is already present and visible in the product
- MoveIt2 is optional and integration-oriented
- deeper teleop-specific workflows would be roadmap or customer-specific integration work

These statements would overreach:

- "Render Studio ships a complete teleoperation control stack"
- "MoveIt2 is part of the default hosted deployment"

## Read next

- [Studio, workspaces, and XR](studio-and-xr.md)
- [Architecture](architecture.md)
- [Roadmap](roadmap.md)
- [Contributing and deploy-sync notes](contributing.md)
