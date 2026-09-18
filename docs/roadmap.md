# Roadmap

Render Studio already ships a meaningful product: AI CAD, direct 3D editing, XR review, wiring, rigging, robotics workflows, and in-product learning all live in one Studio. This roadmap is about what comes next as that foundation grows into a fuller Workshop, VR, and robot-operations story.

## Status key

| Status | Meaning here |
|--------|--------------|
| **Done** | Clearly present in the repo today |
| **In progress** | The building blocks exist, but the full product surface is not yet unified |
| **Planned** | Not shipped yet; included here as a roadmap commitment or product direction |

## Done foundations

These are the pieces already in place that make the Workshop, VR, and robotics roadmap credible.

| Status | Foundation | What ships now |
|--------|------------|----------------|
| **Done** | Studio shell and project workflows | A live Studio with projects, uploads, prompts, history, references, share flows, and workspace switching. |
| **Done** | WebXR support | Quest-oriented XR support, world-space panels, capture actions, and VR-specific controls. |
| **Done** | Voice-driven prompting | Live prompt dictation on desktop and in XR, with shared transcript plumbing. |
| **Done** | Object placement tools | Gizmo/direct placement, insert flows, architect placement, and XR spawn presets. |
| **Done** | Robotics runtime | Rigging, URDF/SRDF flows, robot playback, and optional MoveIt2 motion-planning hooks. |
| **Done** | Approval and training building blocks | Project creation, admin training views, approval queues, and review surfaces already exist in parts of the product. |

## Near-term roadmap

These are the next layers that fit the current codebase and product direction most naturally.

| Status | Item | Buyer-facing description | What the repo already proves |
|--------|------|--------------------------|------------------------------|
| **In progress** | **Viewport label VR, not AR** | Move the primary language toward VR-first buyer messaging while keeping WebXR support broad. | The XR stack already supports both AR and VR sessions; some UI labels are still AR-first while docs already speak in VR/XR terms. |
| **Planned** | **Click PC -> enter Workshop** | Make Workshop a clearer spatial destination from the desktop, not just a concept implied by Studio and XR features. | The repo ships Studio boot, workspace entry, and XR launch paths today, but not a distinct Workshop entry scene. |
| **Planned** | **No headset desktop Workshop** | Let desktop users enter a 3D printer or workshop environment with walk, mouse look, and spatial object placement. | Current desktop tools cover orbit, gizmo placement, direct modeling, and insert flows; first-person workshop navigation is not shipped yet. |
| **In progress** | **Editor tab for shop placement + live voice prompts** | Unify object move/place, cursor-follow placement preview, and live voice prompting into a clearer spatial editing workflow. | Placement tools and voice prompting already exist separately on desktop and XR, but not as one named Editor surface. |
| **Planned** | **God Mode tab for agents and tasks** | Add a room-scale view for agents, their jobs, and what needs human approval next. | The repo has Render Agent, Agent Store, activity views, and approval flows, but no spatial control-room UI yet. |
| **In progress** | **Project tabs for create/train/approve** | Bring project creation, training flows, and click-to-approve actions closer to the main Studio workflow. | Project creation is shipped, and training/approval surfaces already exist in admin and guide-review flows. |
| **In progress** | **Manage Render Agents / Queue / Debug in Studio Lab** | Consolidate queue visibility, agent management, and debugging tools into one clearer operating surface. | Queue, approvals, agent activity, and domain-specific debug panels already exist, but not under one Studio Lab destination. |
| **Planned** | **Teleop controls with explicit human gating** | Add Y-tap engage/pause, hold-Y disarm, robotics-menu priority while teleop is active, and a green state that clearly means a real live session. | XR controller inputs, robot runtime, and optional MoveIt2 planning exist, but a full teleop control layer does not ship yet. |

## Future of VR and robots

These items are vision-level roadmap themes. They are intentionally marked as **Planned** and should not be read as already shipped.

| Status | Vision | What it means |
|--------|--------|---------------|
| **Planned** | **Personal VR Workshop + shared/public Workshop scenes** | Workshop becomes a default destination for solo build sessions, team reviews, and shared public spaces. |
| **Planned** | **Human-gated teleop training school** | Teleop becomes a supervised training system with explicit human control and approval, not an “AI drives the robot live” claim. |
| **Planned** | **Cloud compute seats + optional PC lease marketplace** | Give teams a way to run heavier build, training, or simulation workloads without assuming every host machine is local and powerful. |
| **Planned** | **Agent ID bridge + team chat + success loops + receipts** | Tighten the loop between people, agents, outcomes, approvals, visible success loops, and clear receipts on the Render site. |
| **Planned** | **Sandbox IDE tabs streaming into Workshop** | Bring viewers, charts, cameras, and tooling panes into the Workshop scene instead of keeping them as separate flat utilities. |
| **Planned** | **Stronger agent orchestration with approval gates** | Expand build/train pipelines so agents can prepare work, pause for approval, and continue with clear handoffs. |

## Product language guidance

For external readers, use this framing:

- **Studio** is the shipped product surface today.
- **Workshop** is the near-term spatial direction growing out of Studio, XR, placement, and robotics capabilities.
- **Teleop** should be described as a human-gated roadmap area, not a fully shipped live-operations stack.

## Read next

- [README](../README.md)
- [Studio, workspaces, and XR](studio-and-xr.md)
- [Robotics, motion, and teleop hooks](robotics-and-motion.md)
