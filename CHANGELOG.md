# Changelog

<!-- simple-changelogs-signature agent="Cursor Grok 4.5" at="2026-07-27T05:10:00+00:00" -->

> Comprehensive product history reconstructed from `ai-context/worklog.md` (2026-07-19 onward) and git non-backup commits / daily Auto-backup diffs (2026-06-19, 2026-07-06→17). Date headings are deployment/session milestones, not SemVer releases. Auto-backup-only days with no durable frontend/backend deltas are omitted. Some early Jul 6–15 items marked as baseline or uncertain in source notes are stated without inventing boundaries.

## 2026-07-27

- Management dashboard has a Changelog tab that shows the live `CHANGELOG.md` from the repo (Refresh reloads the latest copy).
- New accounts get a one-time $10 Render3D Key trial with welcome popup and email; the shared key disappears when credits run out.
- Share to X prepares an MP4 when needed, then opens compose with your caption and downloads the clip to attach.
- Video studio supports multi-track clip editing with webcam, upload, and phone QR capture, plus Handy-oriented Bambu send on mobile.
- Connect X (X Corp logo) from Account → Authorized apps and Preferences → Authorized apps, with connect/unlink status.
- Mobile menu is a low-profile chip that expands into a navigable action grid; profile avatar stays top-right; four-corner overlay buttons stay hidden.

## 2026-07-26

- Export → Copy share link scopes the public viewer to the selected model (including 3MF → GLB) instead of every visible sibling.
- Applying a texture records a Texture timeline step; Solid mode can remove texturing and restore original rendered colors.
- Admin dashboard Recent Notifications tab for reviewing signup alerts and suggestions/bugs one at a time.
- Dense CAD meshes keep readable shading (heavy edge overlays no longer black out the model).
- Finishing CAD/Mesh generation leaves Design with the model visible even if Rigging was open.
- Gripper URDF authoring emits movable prismatic/revolute jaws instead of all-fixed joints.
- Generation loading steps only move forward; revise loops show “Revising model” instead of jumping backward.
- Multi-root robot URDF artifacts auto-repair once into a single tree before failing.
- Switching projects no longer stops generation on another project.
- Wiring Simulator is usable again; mesh project body requests no longer fail.

## 2026-07-25

- Mesh mode stays selected through Generate (no longer snaps back to CAD 2.0).
- Mesh results that finish while you are on another project still appear when you return.
- Mesh generating spinner/banner uses the same orange chrome as Mode 2.0.
- Project chat images open in an in-app lightbox instead of a new browser tab.
- Kimi selection no longer snaps back to Claude or OpenAI.
- Personal key Save & activate works reliably when adding an AI key.
- Shared credits include Render3D Kimi K3 (V3).
- Viewport orbit stops when you release the mouse.
- Mobile look-dev no longer shows pure-black models.
- Admin Recent Projects can be sorted by date, name, person, cost, or files.
- Fusion unlink howto shows the Break Link menu screenshot.
- After Fusion export/push, a one-time popup explains Insert → chain-link → Break Link before Extrude/Cut.
- Fusion Part push uploads a standalone Part STEP (not a linked Assembly insert).
- CAD colors avoid black / charcoal / aluminium washes on the dark canvas.
- STEP Part/Assembly export paths restored.
- Models stay upright instead of tipping onto their side.
- Fusion Extrude/Cut uses restored native STEP export (Jul 16 path).
- Mesh export Node path fixed; Mountain Mike recovery path restored.

## 2026-07-24

- Prompt drafts stay per-project and clear on submit (no cross-project bleed).
- Fusion export sends one Part STEP without a companion .py.
- Fusion export lets you select root folders.
- Fusion export no longer auto-selects a folder.
- Fusion Export CTA is visible (orange) and easy to find.
- Fusion folder click selects with a checkmark.
- Fusion Export button stays pinned (no scroll to find it).
- Textures survive CAD wipe with better wrap; Mode 2.0 path unchanged.
- Export/share no longer uses a stale ball token; models export correctly.
- Mode 2.0 CAD shading no longer steals Mesh PBR heuristics.
- Right-click Export works without opening the project.
- Fusion export is one button and fits the viewport.
- AI compose panel no longer shows an outer scrollbar.
- Mesh models keep Three.js PBR shading (not CAD plastic).
- Mesh GLB maps Y-up → Z-up so models are not upside down or on their side.
- Mesh Edit selected keeps the selected stem.
- Overlay model label shows readable model names (e.g. Fable 5) instead of truncated ids.
- Mesh tab uses img2threejs coloring (not CAD cyan).
- Electronics toggle stays visible in the prompt mode row.
- Mesh continues with a Mode 2.0-style review loop; bike recovery path restored.
- Mesh mode has a Stop generating control.
- Mesh mode (img2threejs) replaces the Fusion prompt tab.
- Admin project cards no longer overflow on long filenames.
- Export uses viewport selection truth with Part/Assembly chooser.
- Fusion export no longer uses a hidden sibling filename (e.g. arduino).
- STEP export uses Fusion Part mode for Extrude/Cut.
- Export stem collision no longer sends the wrong Base/Arduino sibling.
- Pick bar sits on the ribbon bottom border.
- Fusion Uploading hang fixed; Replace dialog is no longer clipped.
- Chat unread badge no longer covers the Chat label.
- Admin Recent Projects left column is no longer scrunched.
- Fusion Extrude/Cut flattens assembly STEP → Part.
- Export visible models does not upload hidden siblings.
- Fusion export supports replace vs new with thumbnails.
- Fusion chooser shows Shared only when a file is present.
- Fusion export restores the Jul 16 / pre-Jul 19 working path.
- Fusion export error toasts auto-dismiss.
- STEP download restores native B-rep (no Part rewrite).
- Fusion B-rep Cut restores Jul 16 native STEP push.
- Fusion export shows a green check on success.
- Fusion export uploads to the current folder.
- Working B-rep export/Fusion path restored from backup.
- Fusion/STEP Part mode for editable solids.
- Admin STEP download keeps parametric B-rep.
- Fusion export nested folder grid picker.
- Part names use a product noun, not “fully assembled CAD”.
- Workspace members support invite / edit / view roles.
- Account menu includes Manage AI Keys.
- Admin prompts show original vs improved with copy.
- Personal projects remain visible when nested under shared workspaces.
- AI prompt draft persists across refresh.
- Click selects the whole object; double-click selects a part.
- Pick tools remain available after refresh without requiring a tab click.
- Pick bar in Create row with catalog suggestions and sketch D.
- Docs Getting Started layout and unique GIFs refreshed for laptop.
- Components hierarchy row layout fixed.

## 2026-07-23

- Invited workspace projects land in the shared folder.
- AI usage sparkline no longer overflows.
- Right panel tabs use two rows with tighter chrome.
- Share links only include unhidden models.
- Robot floor improved; rotate without forcing explode.
- Robotic work-cell props no longer pollute the Design viewport.
- Robotic Simulator tab (next to Electronics).
- Link previews title the product as AI & Robotics Studio.
- High-quality viewport video record control.
- Quest tracking lives under Preferences → Advanced.
- Workspaces menu drops All, nicer checks, auto-show on accept.
- Components tree shows Bodies for assemblies with less indent.
- Right-click share project with a teammate.
- Robot artifact gen produces gripper URDF/SRDF with clearer errors.

## 2026-07-22

- Shared workspace project checkboxes show the correct projects.
- Workspace invite uses a popup flow.

## 2026-07-21

- Quest Complete header note and tracking toggle.
- Quest Book progression checkpoints work end-to-end.

## 2026-07-19

- Product Quest Book visual stage shipped.

## 2026-07-17

- Codex repair toggle only appears/works with an OpenAI prompt key; Claude / Fable no longer silently fall back to an older OpenAI shared team key.
- Clearer prompt-status messaging when Codex is unavailable for the selected key.

## 2026-07-16

- Texture library: save rendered looks, favorites, sphere preview, upload images, apply to part/face.
- Timeline shows colored 2.0 vs render history steps with prompt text and tracked render cost when available.
- Wiring simulator pin labels, tooltips, wire context menu, and better motor-driver ↔ actuator helpers.

## 2026-07-15

- Public share links: mobile-friendly viewer with rotate, section, inspector, history, wireframe/transparent, downloads, remix, and motion/URDF when present.
- Project collaboration chat (threads, mentions, reactions, image drop).
- Knowledge Bases: libraries of docs/CAD selectable as prompt context.
- Getting Started + guided Show me tours (including Robot Arm demo seeding).
- Product Marketplace / Model Store with paid listings and Stripe Connect checkout.
- In-app feedback (bugs/suggestions) with screenshot drop; admins can DM follow-ups.
- Discord account linking for mention alerts; optional Discord announcements when a project goes Public.
- Google new-user profile photo/name + Robot Arm onboarding walkthrough.
- AI setup intro for signed-in users without AI access.
- Shared workspaces folder grouping + personal vs shared project destination prompts.
- Visual Skills Library (grid/list/compact, media cards).
- Render Agent Do it for me guided task flow.
- Send to Bambu Studio via plate-ready 3MF export.
- Photoreal Render can wrap a generated image as a texture onto the selected model.
- Mode 2.0 selected-face lengthen/extend stays on the selected viewport part.
- Screenshot capture preferences (full window vs crop) remembered between clicks.
- Rigging animation controls appear only when playable motion exists.
- Realtime editor viewport popup from the workspace strip.
- Loading tips / queued walkthrough when Studio becomes ready.
- Sticky docs topic legend on Getting Started / Full Documentation.
- Welcome onboarding email path for new users (when SMTP is configured).

## 2026-07-14

- Architect Build tiles: blank wall / door / window bays with drag-paint, room drag, erase, and phase navigation.
- Reference-file workspace: tabbed DXF / image / PDF / text viewers with pen markup, notes, and save.
- Viewport measure HUD: edge / face / corner picks with live readout and unit support.
- Team invite UI: invite by email or people you’ve worked with.
- Folder edit modal: rename folders and projects from the workspace browser.
- Direct-modeling extrude HUD hinting (click face / drag arrow).

## 2026-07-10

- Architect Mode early wall-builder: ground-floor bay painting, levels, clear-plan, and step UI.
- Fusion Library Browse vs linked-mirrors tabs, stale-mirror cleanup, and clearer re-link guidance.
- URDF / robot runtime in the viewport (MoveIt2 messaging when available).
- STEP module and planetary-gear runtimes for interactive parametric assemblies.
- Soft client update banner when Studio JS is stale.
- Export controls for downloading GLB / STL / STEP / 3MF.

## 2026-07-07

- Live CAD parameter panel: edit module-scope parameters and rebuild without re-prompting from scratch.
- Wiring generation Speed vs Quality mode (faster path vs deeper Pro path).
- Visible “someone is generating with AI” presence in the viewport and project browser.
- DXF Drawings section in the project browser.
- Ribbon shortcuts for parametric history Tree and Ask Render Agent.

## 2026-07-06

- Connect Fusion 360 from the account menu; browse hubs/projects/folders and import models.
- Fusion Library: push STEP to Fusion, link/unlink folder mirrors, and sync mirrored folders.
- Fusion-oriented generation with Generate + Push to Fusion 360.
- Drop a .dxf onto the prompt pane to attach it as a text reference chip.
- Shared AI-key daily spend limit picker ($5 / $10 / $20 / no limit / custom).
- Floating Render Agent assistant for tooling questions and onboarding.
- Agent Store for browsing and publishing agent apps.
- Management dashboard for operators (users, projects, prompts, stats).
- Wiring debugger focus diagram and photo-debug tooling.
- Extrude-drag and measure tooling modules in Studio.
- Local Fusion 360 add-in scaffold (Render3DLink) for localhost script bridge use.

## 2026-06-19

- Canvas mode: write a prompt and generate a 3D model from the sketch plus voice transcript; voice controls live in the right panel.
- Wiring AI adds ULN2003 / 28BYJ-48 sanity checks and auto-repair for common wiring mistakes.
- Studio baseline enters git: CAD generate, Onshape library, wiring simulator, skills, and core project browser (first snapshot; not all features were necessarily new that day).
