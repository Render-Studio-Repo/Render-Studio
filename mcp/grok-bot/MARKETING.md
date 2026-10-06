# Render Studio — Grok bot marketing source

**Product:** Render Studio  
**Site:** https://render3d.app  
**Repo (this checkout):** `/Users/sam/Render-Studio`  
**This file:** `/Users/sam/Render-Studio/mcp/grok-bot/MARKETING.md`  
**Catalog date:** Wednesday 16 September 2026  
**Window covered:** ~16 May 2026 → 16 September 2026 (last ~4 months)

This is the canonical marketing brief for the **Grok bot** (Studio Authorized app + Cursor MCP at `mcp/grok-bot/server.py`). Use it to find **every product surface**, **May–Sep 2026 updates**, **real media paths**, and **recipes to generate** GIFs, videos, 3D, and thumbnails when a stock asset does not exist.

Approximate inventory: **~340 discrete features/tools** listed below (buttons, tabs, modes, and small chrome included). Canonical in-app help catalog (subset) lives in `frontend/site/docs-features.js` (`DOC_FEATURES`, ~45 how-tos with GIFs).

---

## 0. How the Grok bot should load this file

Do **not** put X consumer secrets, xAI keys, or session tokens in tweets, logs, or this file.

### Load order (MCP)

1. Call **`grok_marketing`** (optional `section` = a `##` heading, e.g. `Brand`, `Master feature inventory`, `Changelog May–Sep 2026`, `Asset catalog`, `How to generate`, `X posting guidance`).
2. If you need a subset, pass `query` (substring match on headings/rows).
3. Draft copy with **`grok_chat`**, putting relevant excerpts in `system`. Always include the Brand + caption rules from §1–2.
4. Publish only via **`x_post`** with `confirm=false` first (draft). Live posts require an explicit human confirm (`confirm=true`).
5. Fallback if the tool is missing: read this file from disk:

```text
/Users/sam/Render-Studio/mcp/grok-bot/MARKETING.md
```

Also listed in `mcp/grok-bot/README.md`. Studio wiring: **Account → Preferences → Advanced → Authorized apps → Grok bot**.

### URL aliases

| Kind | Pattern |
|------|---------|
| Production | `https://render3d.app/<path>` |
| Local Studio | `http://127.0.0.1:8001/<path>` |
| Static files | served from `frontend/` — `/docs/media/ai-generate.gif` → `frontend/docs/media/ai-generate.gif` |
| Brand/media | `/media/images/...`, `/assets/brand/...`, `/assets/studio/...` |
| Public share | `https://render3d.app/share/<token>` |
| Public profile | `https://render3d.app/u/<handle>` |
| Getting Started anchors | `https://render3d.app/getting-started.html#<feature-id>` |
| Updates | `https://render3d.app/updates.html` |
| Marketplace | `https://render3d.app/marketplace.html` |
| Skills | `https://render3d.app/skills.html` |
| Docs | `https://render3d.app/docs.html` |
| Agent Store | `https://render3d.app/agent-store.html` |

Git note: this checkout’s `main` has **no commits**. Changelog sources are `ai-context/worklog.md`, `Getting-Started/CHANGELOG.md`, `frontend/docs/updates/shipped.json`, `frontend/docs/updates/milestones.js`, and `frontend/site/docs-features.js`. Do not invent git SHAs.

---

## 1. Brand

| Field | Value |
|-------|--------|
| Product name | **Render Studio** (never “Render3D” as the product name in new copy; “render3d.app” is the domain) |
| Domain | https://render3d.app |
| Tagline (og/title) | All-in-one robotics collaborative workspace |
| Short pitch | AI CAD, photoreal rendering, robotics, wiring, VR/AR, and real-time collab in one studio |
| GitHub | https://github.com/wprojects/Render-Studio |
| Discord | linked from Studio boot/toolbar (social row) |
| X | linked from Studio boot/toolbar (social row) |

### Logo / mark (use these)

| Use | Local path | URL |
|-----|------------|-----|
| **Current header / desktop mark** (12-tooth metallic spur gear + chrome R, no robot arm) | `frontend/media/images/render-animations/VR-Animations/render-logo-gear-still.png` | https://render3d.app/media/images/render-animations/VR-Animations/render-logo-gear-still.png |
| Vector still (same collage, no animation) | `frontend/media/images/render-animations/VR-Animations/render-logo-gear-still.svg` | `/media/images/render-animations/VR-Animations/render-logo-gear-still.svg` |
| OG / paste-preview gear (share cards, iMessage, X link preview) | `frontend/assets/brand/render-logo-gear-og.png` | https://render3d.app/assets/brand/render-logo-gear-og.png |
| Transparent R knockout | `frontend/assets/brand/render-logo-gear-r-transparent.png` | `/assets/brand/render-logo-gear-r-transparent.png` |
| Chrome wordmark | `frontend/assets/brand/render-studio-chrome-wordmark.png` | `/assets/brand/render-studio-chrome-wordmark.png` |
| Site OG banner | `frontend/assets/brand/render3d-og-banner.jpg` | https://render3d.app/render3d-og-banner.jpg |
| Favicons | `frontend/assets/brand/favicon.svg`, `favicon-32.png`, `favicon-180.png`, `favicon.ico` | `/favicon.svg` etc. |
| Quest / headset live splash (animated SVG) | `frontend/media/images/render-animations/VR-Animations/render-vr-animated.svg` | `/media/images/render-animations/VR-Animations/render-vr-animated.svg` |
| Gear only / electricity layers | `.../render-vr-gear.svg`, `.../render-vr-electricity.svg` | same folder |
| Duplicate stills (boot/header aliases) | `frontend/assets/boot/render-logo-gear-still.png`, `frontend/assets/brand/logo.png` | `/assets/boot/render-logo-gear-still.png` |
| Getting Started preview | `frontend/site/getting-started-preview.png` | https://render3d.app/getting-started-preview.png |
| img2threejs Mesh badge | `frontend/assets/brand/img2threejs-logo.svg` | `/assets/img2threejs-logo.svg` |

**Do not** use the old rocket-R knockout as the current product mark in new posts (header switched 2026-09-09, cache `logo-still`). Animated VR SVG is for **headset boot**, not tweets (X will not play SVG animation). Rasterize the still PNG.

### Caption convention (required)

Share-to-X code (`frontend/viewport/viewport-video-record.js`):

```text
<user caption>

Built in Render Studio https://render3d.app
```

Constants:

- `X_SHARE_ATTRIBUTION` = `Built in Render Studio`
- `X_SHARE_SITE` = `https://render3d.app`
- `X_SHARE_ATTRIBUTION_LINE` = `Built in Render Studio https://render3d.app`
- User caption budget ≈ **270 − attribution line**; X hard limit **280** for the MCP `x_post` tool

Always include **https://render3d.app**. Always say **Render Studio** as the product name.

### Do / don’t

**Do**

- Show real Studio UI, real CAD/mesh, real wiring boards, real Quest/VR when you have footage
- Link a try-it URL (`/`, `/getting-started.html#…`, `/updates.html`, `/marketplace.html`, `/share/<token>`)
- Prefer looping GIFs for tool demos; MP4 for orbit/record/VR; still PNG for logos and OG
- Credit open source when relevant (Jake, VibeCAD, img2threejs, Three.js, Fritzing) — `/credibility.html`
- Draft tweets first (`x_post` confirm false)

**Don’t**

- Fake claims (shipping dates, user counts, “GPT-5” unless the in-app picker actually shows that model)
- Paid-generation spam: do **not** burn shared credits or fire live Generate jobs from the bot to make promo assets. Use existing GIFs, viewport Record on a local project, or the GIF scripts in `scripts/gif-demos/`
- Post Consumer Key / Secret, API keys, emails of private users, or other people’s unreleased projects
- Call Simulation / Manufacture “live” — those workspace modes exist in the switcher but are **Coming soon** (`enabled: false` in `workspace-modes.js`)
- Treat Architect as a primary marketing mode — it is **hidden** in the mode menu (`hidden: true`) even though the module exists
- Promise Fusion/Onshape/Bambu/DIMOS hardware that the viewer cannot see in the clip
- Use “Render3D Key trial is $10” — Sep 2026 copy is **3 ChatGPT renders** for new-user trial (worklog 2026-09-07)

---

## 2. X posting guidance

| Media | Prefer for | Studio limits / X notes |
|-------|------------|-------------------------|
| **PNG / JPG** | Logo, OG, screenshot of a tool, exploded BOM, Imagine still | Studio Share-to-X image path max **5 MB**; PNG/JPEG/WebP/GIF |
| **GIF** | Tool loops (finder, catalog, canvas, wiring) | Convert via **Editor → GIF** or `POST /api/video/convert` `format=gif`. Keep short (2–6s loop). Docs GIFs are 720×400 studio-dark |
| **MP4** | Viewport Record, VR spectator, orbit, teleop | Share to X **downloads the clip then opens compose** — it does **not** re-encode through `/api/video/convert`. Studio upload cap **512 MB / 140 s**. Prefer H.264 MP4, 16:9, 30 or 60 fps |
| **WebM** | Native Record output | Convert to MP4 before X if the composer rejects WebM (`/api/video/convert` `format=mp4`) |
| **GLB / STEP / STL / 3MF** | Cannot attach to X as 3D | Screenshot, Record orbit, or public `/share/<token>` link. Export from Export menu |

**Always:** product name **Render Studio** + **https://render3d.app**.  
**Share to X flow (product):** Record → stop → **You’re done recording** popup → Share to X (download-then-compose) + caption `Built in Render Studio https://render3d.app`. Same from screenshot markup, clip editor, VR/mobile POV, and Reference Files videos.

**Music for posts:** call `grok_taste` then `grok_music_request` (song name + `reason` `x_post` / `instagram_post` / `linkedin_post`). Prefer official/Topic/VEVO; else most popular. **Never** clean/non-explicit, covers, or instrumentals. Hosted MP3 + player URLs come back from the API. After the live URL: `grok_social_post` (set `same_video_group` if the same video is on two platforms), check in days 1–3 then weekly × 4 (`grok_social_checkin` with comments + sentiment + whether negativity or positivity drove views), and upload `grok_social_weekly`. Management → Social media. Live key lives in gitignored `Marketing/GROK.md` only.

**Swipe-back guard:** Mac trackpad horizontal swipe in the viewport/editor does not navigate browser history (`frontend/studio/browser-swipe-guard.js`) — mention as a quality-of-life if posting editor/UX clips.

**Stop-record popup asset:** `frontend/assets/studio/record-done-hint.gif` (also `.svg`). Logo on that card uses the gear still.

---

## 3. Master feature inventory

Grouped the way the UI is laid out. If a **button exists**, it is listed. If there is **no stock GIF/PNG**, the row says so and points at a generate recipe.

**Help GIFs (when present)** live at `frontend/docs/media/<name>.gif` → `https://render3d.app/docs/media/<name>.gif`.

### 3.1 Shell, boot, account

| Feature | Where | Asset |
|---------|--------|--------|
| Boot splash (PC) | Full-tab loader, chrome wordmark, social GitHub/Discord/X | Animated VR SVG is headset-only; PC uses gear still. `frontend/assets/boot/` |
| Boot splash (Quest) | Enter VR, How, live `render-vr-animated.svg` | `/media/images/render-animations/VR-Animations/render-vr-animated.svg` |
| Enter VR from boot | `studio-boot-enter-vr` — requests WebXR on the gesture, opens last project | no stock; Record Quest or generate via recipe **VR session** |
| How to VR | `studio-boot-xr-how` | docs VR pages |
| Suggestions overlay | Boot Suggestions — type, transcribe, sketch pad (cyan/orange/white/red/violet), Add sketch | no stock; screenshot boot overlay |
| Walkthroughs | Account → Walkthrough; boot random walkthrough queue | `/docs/media/ai-generate.gif`, `/docs/media/select-object.gif` |
| Quest Book | Account → Quest Book (gold) | no stock; UI path Account menu |
| Header logo | Top-left gear still | `render-logo-gear-still.png` |
| Management / Foundry toolbar | Super-admin / developer links | `/admin-dashboard.html`, `/foundry.html` |
| Site nav | Studio / Marketplace / Skills Library / Docs / Tips & Tricks / Updates | public pages |
| Agent (Render Agent) | Toolbar Agent | `/docs/media/render-agent.gif` + social `render-agent.social.gif` |
| Project chat | Toolbar Chat | no stock; generate via collab session |
| Social network | Toolbar people | no stock |
| Suggestions / Report bug | Toolbar | `/docs/media/management-feedback-dms.png` (admin side) |
| Workspace activity | Activity tab | no stock |
| Account menu | Sign in / avatar | `/docs/media/preferences.gif` |
| Cloud: Fusion connect | Account → Cloud | `/docs/media/cloud-sync.gif` |
| Cloud: Onshape connect | Account → Cloud | same |
| Preferences | Account → Preferences | `/docs/media/preferences.gif` |
| Costs | Account → Costs | no stock |
| AI keys | Account → AI keys / Key pill | no stock |
| Subscriptions | Account (when shown) | no stock |
| Public profile | Account → Public profile | `render3d.app/u/<handle>` |
| Team workspaces | Account → Team workspaces | `/docs/media/workspaces.gif` |
| Log out | Account | — |
| Units | Toolbar mm/cm/m/in/ft | mentioned in Getting Started |
| Pin projects (star, max 5) | Explorer star / right-click / Finder | `/docs/media/pin-projects.gif` |

Preferences sections (Account → Preferences): **General** (Appearance, AI Prompt preferences, Projects & files, Developer) then **Robotics / Payments / Notifications / Calendar / Controllers**. Advanced → **Authorized apps** (X, Discord, GitHub, Google Drive, Stripe/PayPal/wallets, **Grok bot**, stream providers Live/Twitch/Kick). Viewport extra: Account → Viewport layout links.

### 3.2 Workspace modes & design ribbon

Switcher `#workspace-mode-btn` (`frontend/workspace/workspace-modes.js`):

| Mode | Status | Notes |
|------|--------|--------|
| Design | **Live** | Default. Ribbon: SOLID, ROBOTICS, Parts Catalog, TEXTURE, CANVAS, Editor |
| Wiring Simulator | **Live** | Tabs: WIRING, ELECTRONICS, ROBOTICS, Parts Catalog, Parts list |
| Architect | Hidden | Build grid still exists in modules; not in the mode menu |
| Simulation | Coming soon | Do not market as shipped |
| Manufacture | Coming soon | Do not market as shipped |

Removed from Design ribbon (still exist elsewhere): SKETCH (internal), ELECTRONICS, RIGGING, ARCHITECT. Insert tab is gone → **Parts Catalog**.

### 3.3 Left explorer / projects

| Feature | Where | Asset |
|---------|--------|--------|
| Projects list + | `btn-projects-new` — new project immediately | `/docs/media/new-project.gif` |
| Shared workspaces folder menu | Compact folder picker | `/docs/media/workspaces.gif` |
| Personal vs shared destination prompt | New project when in a shared workspace | same |
| Pin / unpin | Star, right-click Pin to projects; Pin to public on public projects | `/docs/media/pin-projects.gif` |
| Explorer panes | Projects / Reference Files / Cad Connections | `/docs/media/reference-folders.gif` |
| Reference folders | McMaster, Screenshots, Screen Recordings, AR, Improve Lab, canvas/ | `/docs/media/reference-folders.gif` |
| Right-click delete/rename references | Browser context | no stock |
| Cad Connections rail | Fusion / Onshape / SolidWorks chips | `/docs/media/cloud-sync.gif`; logos `frontend/cad/fusion-360-logo.png`, `onshape-logo.png`, `solidworks-logo.svg` |
| Fusion library Browse / mirrors | Left Fusion panel | `/docs/media/cloud-sync.gif` |
| Fusion unlink howto | Break Link screenshots | `frontend/media/images/fusion-instructions/fusion-unlink-break-link.png`, `fusion-unlink-full.png`, `fusion-unlink-browser.png` |
| Drop files | STEP, STL, GLB, DXF, PDF, images onto viewport or explorer | `/docs/media/cloud-sync.gif` |
| DXF Drawings section | Project browser | DXF viewer tab |
| Components tree / Bodies | Assemblies, McMaster under Bodies | no stock |
| ⓘ source parts | Identify/source online, Use this, drag to Wiring | `/docs/media/source-parts.gif` |
| Collapse bodies | Edit-selected picker | no stock |
| Public projects live | Push to Public | Discord announcement optional |

### 3.4 Viewport / CAD display (every chrome control)

| Feature | Control | Shortcut / notes | Asset |
|---------|---------|------------------|--------|
| Orbit | Pick mode Orbit | LMB orbit (mouse presets in Preferences) | `/docs/media/picks.gif` |
| Pan / zoom | Mouse preset | Preferences → mouse | same |
| View cube | Viewport cube | Standard views | no stock; generate orbit GIF |
| Fit | Fit (ribbon / F) | Frame selection | no stock |
| Transparent | `#btn-transparent-viewport` | **T**. Click items, or ▾ **All objects** (ghost every loaded model). Unclick restores | no stock; generate via Transparent → All objects |
| Ghost (mobile) | Mobile tool Ghost | Same as Transparent | no stock |
| Exploded | `#btn-exploded-viewport` | Space parts for BOM | no stock |
| Exploded ▾ | Rotate off / Rotate model (level turntable) / Rotate exploded | Keeps exploded if already on | no stock |
| Section | `#btn-section-viewport` | **Shift+X** — cut to see mates | public share also has section |
| Grid | `#btn-grid` | **Shift+G** | no stock |
| Grid ▾ scene | Dark scene / Light scene (Fusion-style gray) | | no stock |
| Jake CAD lighting slider | Grid menu | Brightness | no stock |
| Look overlay | `#btn-viewport-look` | Lighting color palette, light color, background color, brightness, Reset, New projects default | no stock |
| Viewport prefs gear | `#btn-viewport-prefs` | Lighting, grid, AI key, share defaults | `/docs/media/preferences.gif` |
| Remix | `#btn-remix-viewport` | On share links | `/docs/media/share-folder.gif` |
| Capture crescent | Shot / Rec / Stream | | `/docs/media/clip-video-editor.gif` |
| Stream / Cast | Stream, Cast with Meta, AirPlay / SharePlay | | no stock |
| Screenshot | 📷 + ▾ | Viewport window / Full page / Fullscreen / Saved crop / Ask each time | no stock; **generate via recipe Screenshot** |
| Record | Rec + ▾ | Target: Viewport / Full page / Fullscreen; Quality Standard/High/**Ultra**; 30/60 fps; Include microphone; Open editor; Start recording | `/docs/media/clip-video-editor.gif` |
| AR FAB | `#btn-xr-vr` | Place: Eye / Floor / Table / Near / Far | no stock; Quest footage |
| Measure HUD | Viewport Measure | Edge / face / corner picks, live readout, units | no stock |
| Gizmo | Move/rotate gizmo | Transform (M). Cmd+Z after gizmo must not undo generation timeline | no stock |
| Joints overlay | Joints | Native FreeCAD joints / motion preview | no stock |
| Bounder | Scene bounder (skipped by Transparent) | Printer fence / bounder helpers | no stock |
| Wireframe | Share viewer + Mesh | | no stock |
| Generation banner | Parallel skinny rows, View more, Stop picker (up to 5) | Metallic loader + mini printer/robot HUD | no stock of HUD; describe |
| “Someone is generating” | Presence chip | | no stock |
| Cmd/Ctrl+F finder | Spotlight: projects, prompts, timeline; does not steal find-in-page from prompt | `/docs/media/viewport-finder.gif` |
| Browser panel | Search / collapse / expand BROWSER | | no stock |
| Improve Lab | Four viewports original vs Improve | Nested in Reference Files | no stock |
| Swipe-back guard | Trackpad | | no stock |

**Pick modes** (top toolbar): Object, Corner, Face, Edge, Line/path, Lasso, Orbit, left-drag mode. Click = whole object; double-click = part. `@face` / `@edge` / `@path` chips in the prompt. GIF: `/docs/media/picks.gif`.

**Mobile FAB / chrome:** Browser FAB; tools Grid / Transparent(Ghost) / Orbit / AI / Measure; hamburger action grid (Models, Upload, Parts Catalog, …); profile top-right; four-corner overlays hidden. Social GIF: `/docs/media/social/select-object.social.gif`.

### 3.5 SOLID ribbon — Create / Modify / Pattern / Sketch

From `frontend/studio/ribbon.js` (every tool id):

**Create / solids:** Box, Cylinder, Sphere, Cone, Torus, Extrude, Revolve (vase profile, angle, fuse/cut/new body), Hole (diameter, through), Pad, Pocket, Groove (L-profile), Loft.

**Modify:** Fillet, Chamfer, Thickness (shell), Boolean Cut, Draft, Move / Rotate, Mirror, Mirror Body.

**Pattern:** Linear, Circular.

**Inspect / IO:** Measure, Export.

**Sketch (when SKETCH active):** Create Sketch; Select; Line, Rectangle, Circle, Arc, Polygon, Point, Spline; Fillet, Chamfer, Trim, Extend, Offset, Mirror; Rect Pattern, Circ Pattern; constraints Coincident, Collinear, Concentric, Parallel, Perpendicular, Horizontal, Vertical, Equal, Tangent, Fix, Dimension, Angle; Finish Sketch, Stop Sketch, Extrude (new/add/cut).

Extrude types: Dimension / Two dimensions / Symmetric to plane / Through all; Reversed; Taper; Operation Fuse / Cut / New body. Pad/Pocket match FreeCAD Tasks (kernel persist 2026-09-08).

**Direct tools (right Tools / object-tools):** Press-Pull, Transform (M), Color, Measure, Split bodies, Delete (persists), multi-select transform group.

GIF stand-in: `/docs/media/solid-tools.gif`, `/docs/media/sketch.gif`, `/docs/media/picks.gif`.

### 3.6 AI Compose (right panel)

Tabs: **Compose / History / Imagine**.

Mode chips (equal-width row): **Render / CAD / Mesh / Parts / Speed–Quality / Improve**. Narrow sidebar is 3×2; wide is 6 columns.

| Chip | What it does |
|------|----------------|
| Render | Photoreal of the **exact viewport model**, current facing; materials wrap the **object only** |
| CAD | Parametric STEP/Python. Click CAD to pick harness: **Jake** (text-to-cad), **VibeCAD** (FreeCAD/build123d → STEP/GLB), **MAC** (Multi-Agent CAD, `.venv-mac`) |
| Mesh | img2threejs procedural Three.js + PBR. Click Mesh: **Regular** vs **Beta 1.5.2** (character clips & VFX). Demo clip: `frontend/assets/img2threejs/1.5-beta-pikachu.mp4` |
| Parts | McMaster-Carr on/off for generate/Improve |
| Speed / Quality | Speed = faster; Quality = Pro path. GPT-5.5 Pro defaults to Speed |
| Improve | Spice rewrite. CAD: dimensions, named bodies, shop colours. Render: lock facing + object-only wrap. Mesh: img2threejs look-dev. Imagine has its own Improve |
| Codex | Optional repair loop (OpenAI key only) |
| CAD Debug | Off by default; debug prompt on Improve/Generate |
| Electronics | Toggle on prompt mode row (visibility kept) |
| Key pill | Provider + model; KEY shows key name + provider mark |
| Skills chips | CAD, DXF, URDF, molds, … `/skills.html` |
| Knowledge base | Attach doc collections |
| Stop | Stop one or all; Mesh Stop restores draft + cost |
| Parallel gen | Up to 5 |

Also: prompt drafts **per project** (CAD / Wiring / Imagine maps; no live-box leak). History stamps, cost metadata (2.0 yellow, renders purple). Click prompt photos to edit and resend. `@prompt:…` refs. Attach images, DXF, @component. GIF: `/docs/media/ai-generate.gif`, `/docs/media/prompt-persist.gif`, `/docs/media/multi-gen.gif`.

**Imagine:** product images (OpenAI Image 2.5 / Grok Imagine). Gallery grid/list. Markup. Send to CAD / Mesh. **`/fetch`**: Tab complete; formats STL / GLB / STEP / 3MF; public CAD URLs + **step.parts**. Saves `imagine/` and `imagine/fetched/`. GIF: `/docs/media/imagine-panel.gif`.

**DXF prefs:** ask / auto / always_dxf / always_image.

### 3.7 Texture

Design tab **TEXTURE**. Texture library: save rendered looks, favorites, sphere preview, upload, apply to part/face. Photoreal Render can wrap the generated image onto the selected model (textured GLB) without a CAD prompt. Solid mode can remove texturing. Timeline records Texture steps. GIF stand-in: `/docs/media/ai-generate.gif`. No dedicated texture GIF — generate via Texture tab → apply → screenshot.

### 3.8 Canvas (2D board)

Open from **CANVAS** ribbon / document tabs. Open last or Create new; name the board. Saves under project `canvas/`.

Toolbar (every tool): name field; Canvases ▾ (Replace viewer / New tab); Share (Copy share link, permissions, Share to Discord); Download PNG / JPG / WebP / JSON; **Split view** (beside 3D); **Invite** (User / Team / Workspace, search, copy link, Remix into my workspace); **Send to AI** (far right); **Smart Description** (organize links/notes/final look into prompt — does **not** generate).

Draw tools: Select/move (V), Pen (P), Eraser (E), Line (L), Arrow (A), Dotted image link, View tag, Face of interest, Edge of interest, Split (box or Shift-lasso), Rectangle, Rounded rect, Diamond, Circle, Oval, Triangle, Hexagon, Cloud, Callout, Parallelogram, Sticky note, Text (T), Image from library, Webcam Snap. Stroke color + presets (blue/red/green/yellow/purple/white), width 1–24px, Undo/Redo, Clear. Collab remote cursors. Edit timeline.

GIFs: `/docs/media/canvas.gif` (older), `/docs/media/canvas-workspace.gif` (2026-09-16). **Canvas Invite** — no stock; generate via Canvas → Invite.

VR spatial canvas: Draw → AI Prompt, lasso, live voice, Region notes, Link, Final look, Smart Description, Generate snapshot. Documented in `docs-features.js` `vr-ai-draw`. No stock GIF.

### 3.9 Editor / video / code

| Feature | Where | Asset |
|---------|--------|--------|
| Clip / video editor | Viewport Record → Editor tab; Reference Files → Screen Recordings | `/docs/media/clip-video-editor.gif` |
| Timeline | Video lane, audio lane, trim handles | same |
| Drop clips / stills / MP3 | Onto lanes | same |
| AI film-edit | Under timeline: Improve + Generate | same; backend `video_film_edit.py` |
| Share / GIF export | Preview | convert API |
| Realtime editor popup | Workspace strip → collapses to chip | `/docs/media/workspaces.gif` |
| Project code editor | Code tab: upload folder, Ln/Col, UTF-8 | no stock |
| Local terminal | ROBOTICS → Terminal (local hosts only, not render3d.app) | no stock |

### 3.10 Document tabs, split, layouts, BOM

Tab strip (`frontend/studio/document-tabs.js`): Viewport, **BOM / Parts List**, **Wiring** (viewport tab), video/clip, canvas, image, PDF, DXF, McMaster, Viser, Teleop, code. Right-click tab: rename, pin, **Split Up / Left / Down / Right**. Max **6 panes**. Split **retracts left browser + right AI dock**.

**Layouts** button always last on the strip: save popup (required name, optional description, CSS mosaic thumbnail of live split tree labeled Viewport / Wiring / Parts List), saved list, import URL/JSON, copy share link. Stored as **general Studio setting** `/api/me/viewport-layouts` (not per-project). Share `/share/{token}` → Import to your workspace (no space picker). Marketplace free **Viewport layouts** section. Right-click save: copy link / public profile / marketplace. Extra links: Account → Viewport.

**Parts List / BOM:** viewport tab + Wiring **Parts list** + Catalog **My Parts List**. Thumbnails on rows. Filters (wiring): models / McMaster / electronics. Multi-select, Send to wiring. Catalog **Split view** shows My Parts List beside Parts or McMaster. No stock GIF of thumbnails — generate via Parts List tab after sourcing parts (`/docs/media/parts-catalog.gif` covers catalog).

### 3.11 Parts Catalog / McMaster / step.parts

Amazon-style storefront (`catalog-panel.js`) over ~16k step.parts models.

Tabs: **Parts**, **McMaster-Carr**, **My Parts List**, **Split view**.

Departments: Popular, Electronics, Fasteners, Motors & servos, Bearings, Linear motion, Gears & belts, Hardware, Enclosures, Fans & heatsinks.

Actions: search, Import STEP, Send to wiring, Load McMaster catalog, manage STEP files. McMaster logo: `/assets/brands/mcmaster-carr-masthead.svg`. GIF: `/docs/media/parts-catalog.gif`.

### 3.12 Wiring & electronics

| Feature | Notes | Asset |
|---------|--------|--------|
| Wiring Simulator mode | Breadboard from AI, pin-to-pin, drivers, code & simulate | `/docs/media/wiring.gif` |
| Compact compose | Title + Mode Quality + key; Project parts row; knowledge/voice icons | `/docs/media/wiring-compose.gif` |
| History stamp | Pending row on Generate → succeeded/failed | same |
| Link chips | 5-word title + Google s2 favicon (Amazon ASIN / electronics / host) | same |
| Drafts per project | `render3d:wiringComposeDraft:v1` | `/docs/media/prompt-persist.gif` |
| Send to wiring | Catalog / electronics suggestions | wiring-compose.gif |
| Fritzing pictorial skins | Every wiring part | no dedicated GIF |
| Code & Simulate | | wiring.gif |
| Wiring as viewport tab | Split with 3D | Layouts |
| Wiring 3D/AR | Bottom-left AR/3D, isolated wiring render, contact-only 1:1 AR | no stock |
| Examples | `frontend/wiring-examples/*.json` + `blink-led-schematic.svg` | local files |
| Electronics suggestions dock | Docs / Send to wiring / dismiss | no stock |

### 3.13 Robotics, Viser, Teleop, printer, cameras

ROBOTICS ribbon (`ribbon.js`):

- **Viser** — open, Network, Connect. HTTP LAN `http://LAN:8095` → `/api/viser/p/host/port/`. GIF: `/docs/media/robotics-viser.gif`
- **Teleop** — URL field, Connect, Teleop / Robotics setup. HTTPS `https://LAN:8443/teleop` → `/api/teleop/p/host/port/teleop`. GIF: `/docs/media/robotics-teleop.gif`
- **3D Printer** / Printer Config — Bambu and slicer brands
- **Cloud** — robotics Cloud settings (save Viser URL for HTTPS embed)
- **Cam IP**, **Cam**, **Wrist cams**, **Debug** — Arducam-style USB on the Mac; JPEG `/api/robotics/hand-cam/left.jpg` `right.jpg`; Allow camera (Python/ffmpeg); drag overlays to corners
- **Terminal** — local PTY

Also: DIMOS coordinator `/api/dimos/ensure-coordinator`; Enable Robotics / Activate mounts quest viewer (status, Connect robot PC, JPEG stream, HUD). Cloud never exposes :8443. Open Arm `hardware_id=openarm` mock|can. VR Robot/DIMOS gated until Enable. Docs: `/getting-started.html#robotics-configuration`, GIF `/docs/media/robotics-configuration.gif`.

**Send to Bambu Studio:** plate-ready 3MF, unique mesh IDs, one assembled plate, only unhidden parts. Slicer logos: `frontend/slicer-logos/{bambu,orca,prusa,cura,creality,elegoo,anycubic,superslicer}.svg`. Machine thumbs: `frontend/machine-thumbs/` (Bambu A1/A1 mini/P1S/X1C, Ender-3 V3, Formlabs Form4, Elegoo Saturn 4, CNC mill/router, Cricut, generic FDM, etc.). Context Lab: pick printer thumbnail → live in Improve.

Onboarding GIFs: `frontend/assets/onboarding/robot-motion-demo.gif`, `text-to-cad-demo.gif`.

### 3.14 Rigging / URDF / Motion

(Not on Design ribbon; still in product.) Add Bone, Auto Rig, Connect, Keyframe, Play/Pause, Stop, Move, Rotate Joint, Delete Bone, Clear Rig, Select, Export URDF, Save Rig, Reload. Viewport: Load robot, Refresh, Play, Pause, Reset pose, Generate, Create URDF / SRDF / SDF, artifact source select. URDF drives real `__part_*.glb` (not white boxes). Motion workbench. Gripper prismatic/revolute jaws. GIF: `/docs/media/rigging-urdf.gif`. Animation banner only when playable.

### 3.15 VR / AR / Quest (tools, even small ones)

Enter: boot Enter VR, PC AR FAB, headset splash. Place: Eye / Floor / Table / Near / Far. Passthrough / white-room wrist toggle.

**Hold-A tool wheel** (`xr-tool-wheel.js`): Measure, Box, Cyl, Sphere, Wall, Height, Floor, Cone, Torus, Bool, Slice, Revolve, Loft, Prompt, Draw, Talk (voice mold), Generate, Move, Scale, Snap, Sym, Mirror, Copy, Stamp, Array, Layer, Undo, Group, Studio.

**Create primitives** (`xr-tool-appearance.js`): Cube, Cylinder, Sphere, Cone, Ring, Wall, Floor. Draw brushes: Pen, Brush, Highlight. Fine / Med / Bold. Box face / Extrude / Join / Move. Undo / Redo.

**Board tools:** Move, Pen, Line, Arrow, Lasso, Label, Link, Eraser, Face, Edge.

**Capture folder:** Record, Screenshot → PC / Share to X, Share, Passthrough. While recording: Pause, Stop (popup, not Rec-as-toggle). After stop: Send to computer, Share to X, new Shot.

**Other VR:** left wrist plate + Render logo; right-wrist agent button; audio-reactive avatar; native searchable settings keyboard; throw dismissal; Talk microphone; nametags; public room drop project; collab presence; Explorer + AI windows in spectator recording; green pulsing AI VR icon while generating; Snap on Hold-A wheel; menu-aim tip (cube/cyl/sphere) + short hit beam; grip 6DoF windows; DimOS HUD Enable/Record; reference-file windows (Anchor, Curved screen, Resize, Hide from others); emotes (if present on nametag/social — no dedicated stock asset; do not invent animations). Pen tip / controller tip idle; short beam on hit. Bounder / printer fence skipped by Transparent.

Avatars (Kenney GLB): `frontend/assets/avatars/kenney/{skaterFemaleA,skaterMaleA,cyborgFemaleA}.glb`. Controllers: `frontend/assets/controllers/quest-touch-plus/{left,right}.glb`.

No stock Quest GIF in `docs/media` — **generate via headset Record** (spectator) or screenshot the splash SVG rasterized.

### 3.16 Share, social, X, collab

| Feature | Notes | Asset |
|---------|--------|--------|
| Export menu | GLB, STL, STEP, 3MF, assembly STEP; Copy share link pinned | `/docs/media/share-folder.gif` |
| Copy share link | Selected model (incl. 3MF→GLB); unhidden only | same |
| Public viewer `/share.html` | Orbit, section, inspector, history, wireframe/transparent, downloads, remix, motion/URDF | `/share/<token>` |
| Share to X | Download-then-compose; caption convention | record-done-hint.gif |
| Share to Discord / Slack | Copy formatted text + URL | no stock |
| OG gear on paste preview | `render-logo-gear-og.png` + `share_preview.py` dark PNG thumbs | `/assets/brand/render-logo-gear-og.png` |
| Workspace invite | Email / typeahead / roles invite-edit-view | `/docs/media/workspaces.gif` |
| Right-click share project | Teammate | same |
| Project chat | Threads, mentions, reactions, image drop, unread badge | no stock |
| Canvas Invite / collab | Landed — User/Team/Workspace | no stock |
| Connect X | Authorized apps + Preferences | X Corp logo in UI |
| Discord link | Mention DMs; optional Public announcements | shipped 2026-07-15 |
| Grok bot | Authorized apps; MCP; X consumer keys on user (`x_consumer_key` / `x_consumer_secret` on Supabase — **never paste here**) | this file |
| Incognito | `incognito-ui.js` | no stock |

### 3.17 Marketplace, Agent Store, Skills

| Surface | URL | Notes |
|---------|-----|--------|
| Marketplace | `/marketplace.html` | Models, knowledge, agents; Stripe; seller store builder; shopping; community header; private messages; discovery |
| Viewport layouts (free) | Marketplace section | Install → general store |
| Model store | `/model-store.html` | |
| Storefront | `/storefront.html` | Seller |
| Agent Store | `/agent-store.html` | Browse/install/submit; permissions; featured/free/premium |
| Skills Library | `/skills.html` | Grid/list/compact; media cards |
| Knowledge store | `/knowledge-store.html` | |
| Setup marketplace | `/setup-marketplace.html` | |

No marketplace thumbnail folder in `frontend/marketplace/` (listings store thumbs in DB). Use product `thumbnail_url` or generate a viewport screenshot.

### 3.18 Help, docs, Quest Book, Foundry, admin

| Surface | URL / where |
|---------|-------------|
| Getting Started | `/getting-started.html` + `#<id>` |
| Full docs | `/docs.html` |
| Tips & tricks | inner docs chrome |
| Updates | `/updates.html` (`shipped.json`, milestones) |
| Roadmap | `/roadmap.html` |
| Credibility | `/credibility.html` |
| Privacy | `/privacy.html` |
| Database configuration | `/database.html` |
| Setup / self-host | `/setup.html` |
| Show me tours | live spotlight (`show-me-tour.js`) |
| Render Agent Do it for me | Agent → guided sticky notes |
| Quest Book | Account |
| Management dashboard | `/admin-dashboard.html` — Control Center, fullscreen analytics, Prompts, Changelog tab, notes FAB, users |
| Foundry | `/foundry.html` — Pulse, GitHub link, PRs, Submit to the project |
| Capture phone QR | `/capture.html` |

### 3.19 Auth, keys, payments, calendar

Sign in (Google etc.). New Google users: profile name/photo + Robot Arm walkthrough. AI setup intro if no key. Trial: **3 ChatGPT renders** (not $10). Shared credits / personal keys. Daily spend picker. Manage AI Keys. Share ChatGPT CAD with a team. Receive money: Stripe / PayPal / X / wallets (Authorized apps). Calendar meetings + reminders. Notifications prefs (chat, purchases, credits, meetings, workspace invites).

---

## 4. Changelog May–Sep 2026 (with routes)

**Sources:** `Getting-Started/CHANGELOG.md`, `frontend/docs/updates/shipped.json`, `frontend/docs/updates/milestones.js`, `ai-context/worklog.md` (this checkout is **September-heavy**; May 16–June 18 has **no dated worklog/CHANGELOG rows** here — git is empty). Do not invent May features.

Public: https://render3d.app/updates.html · Getting Started: https://render3d.app/getting-started.html#`<id>`

### 2026-05-16 → 2026-06-18

No durable dated changelog in this tree. If you need May history, ask a human or inspect `backups/snapshots/` (read-only). Do not guess.

### 2026-06-19

- Canvas mode: prompt + sketch + voice transcript → 3D; voice in right panel. Route: Design → CANVAS. GIF `/docs/media/canvas.gif`. Work: `Getting-Started/CHANGELOG.md`.
- Wiring AI ULN2003 / 28BYJ-48 sanity checks. GIF `/docs/media/wiring.gif`.
- Studio baseline snapshot (CAD generate, Onshape, wiring, skills, browser).

### 2026-07-06

Fusion connect + library push STEP / mirrors; Fusion-oriented generate; DXF drop on prompt; spend-limit picker; Render Agent; Agent Store; Management dashboard; wiring debugger; extrude-drag + measure; Fusion add-in scaffold. GIF `/docs/media/cloud-sync.gif`, `/docs/media/render-agent.gif`.

### 2026-07-07

Live CAD parameter panel; Wiring Speed vs Quality; generating presence; DXF Drawings; ribbon Tree + Agent.

### 2026-07-10

Architect bay painter; Fusion Browse vs mirrors; URDF runtime; STEP + planetary-gear runtimes; client update banner; Export GLB/STL/STEP/3MF.

### 2026-07-14

Architect Build tiles; reference-file workspace (DXF/image/PDF/text + pen + Send to AI); Measure HUD; team invite; folder edit modal; extrude HUD.

### 2026-07-15 (large ship — many shipped.json ids)

Public share viewer; project chat; Knowledge Bases; Getting Started + Show me; Marketplace + Stripe; feedback + admin DMs (`/docs/media/management-feedback-dms.png`); Discord link + Public announcements; Google robot walkthrough (`/docs/media/select-object.gif`); AI setup intro; Shared workspaces folder; Skills media cards; Render Agent Do it for me; Send to Bambu; Render texture wrap; Mode 2.0 selected-face edit (`/docs/media/picks.gif`); screenshot capture prefs; rigging animation banner; realtime editor popup; loading tips; sticky docs nav; timeline render history (`/docs/media/timeline-render-history.png`); welcome email.

Social drafts: `frontend/docs/updates/social/posts.json` + `*.social.gif`.

### 2026-07-16

Texture library; timeline colors + cost; wiring pin labels / wire context menu.

### 2026-07-17

Codex repair only with OpenAI key (no silent Claude fallback).

### 2026-07-19–21

Quest Book visual stage; Quest Complete header; Book checkpoints.

### 2026-07-22–23

Workspace invite popup; shared checkboxes; invited projects land in shared folder; Robotic Simulator tab; HQ viewport video record; Quest tracking under Preferences → Advanced; right-click share with teammate; gripper URDF; high-quality record.

### 2026-07-24–26 (Fusion/Mesh week)

Mesh mode (img2threejs) replaces Fusion prompt tab; Mesh stop; PBR vs CAD plastic; Y-up→Z-up; pick bar; prompt drafts per project; Fusion export Part STEP / folders / thumbnails / Extrude-Cut native path; STEP B-rep; workspace roles; click vs double-click select; electronics toggle; Wiring Simulator usable again; texture timeline + Solid unwrap; Copy share link scopes to selected model; admin notifications.

### 2026-07-27

Management Changelog tab; $10 trial **later replaced**; Share to X prepares MP4 then compose + download; multi-track video + webcam + phone QR + Handy Bambu; Connect X from Authorized apps; mobile chip menu.

### 2026-07-28–30 (`shipped.json`)

GPT-5.5 Pro defaults Speed; Mesh Improve realistic materials; faster share links; mobile/VR POV Screenshot & Record → Share to X; Mesh Stop restores draft/costs; Bambu 3MF real plates; XR captures → Reference Files → AR; right-click delete references; VR spectator recording FOV; green AI VR generating icon; URDF real CAD meshes.

### 2026-08-13 (`Getting-Started/CHANGELOG.md`)

MAC uses `.venv-mac`; Kimi K3 CAD; memory guard; VibeCAD image upload + DXF like Jake; MAC shares photo/DXF/@-ref/electronics packet.

### 2026-09-02 → 2026-09-16 (`ai-context/worklog.md` — exhaustive product-facing)

Worklog is the source of truth for September. Highlights the bot should market (skip pure crash/perf unless asked):

| Date | Feature | Routes / files | Asset |
|------|---------|----------------|--------|
| 09-06 | Fritzing skins; persist 60fps MP4 into Screen Recordings; Exploded off reloads assembly; mobile chrome | `wiring/`, `viewport-video-record.js` | convert API; no GIF |
| 09-07 | Canvas shortcuts don’t steal prompt; Texture sample on model; Extrude/Pad/Pocket FreeCAD Tasks; Improve realistic colours; SolidWorks library; Recording HUD dock/hide from clip; Catalog storefront; capture names newest-first; Texture wrap; Remix nested CAD; Wireframe on Mesh; Share link live GLB; Share to X + nametag send-file; CSG Combine; Quest wheel copy/layer/snap/undo/wall pull; public VR room; ICE voice | worklog 09-07 | catalog.gif later |
| 09-08 | FreeCAD kernel move/delete/extrude persist; Parts Catalog (Insert gone); Marketplace storefront redesign; Receive money Stripe/PayPal/X; Foundry GitHub OAuth; Management console; Canvas Cmd+Z/resize/Delete; Context Lab machines+customers | `workspace-modes.js`, `catalog-panel.js` | `/docs/media/parts-catalog.gif` |
| 09-09 | **Imagine + /fetch**; DXF prefs; DimOS viewer; VR pointers/Measure/Snap; Enter VR last project; logo gear still; Control Center; Notes FAB; GitHub PAT; fullscreen analytics; prompt persist | `imagine.js`; `render-logo-gear-still.png` | `/docs/media/imagine-panel.gif`, `/docs/media/prompt-persist.gif` |
| 09-14 | Teleop HTTPS proxy; Updates tab restored; clip editor; Viser LAN + Cloud; reference folders; Database configuration docs | `teleop-viewer`, `updates.html`, `database.html` | robotics-*.gif, clip-video-editor.gif, reference-folders.gif |
| 09-15 | Wrist cameras; Wiring 3D/AR + VR voice companion; Edit Selected scale/context; Marketplace shopping/store/discovery; FreeCAD joints; even CAD chips | Getting Started `#robotics-wrist-cameras` | robotics-configuration.gif |
| 09-16 | Cmd/Ctrl+F finder; pin projects; Canvas open last/Smart Description; Wiring History/Send to wiring; **saved viewport split layouts** + marketplace; wiring drafts per project; Grok bot MCP (this folder); Transparent ▾ All objects; tab split; Send to AI far right; split retracts sidebars; Canvas Invite | `docs-features.js`, `viewport-layout-saves.js`, `mcp/grok-bot/` | `/docs/media/viewport-finder.gif`, `pin-projects.gif`, `canvas-workspace.gif`, `wiring-compose.gif` |

Cache-bust tokens (for engineers, not tweets): `newfeats1`, `vplayout=20260916-1`, `alltrans=20260916-1`, `imagine1`/`imagine2`, `logo-still`, `teleop2`, `updtab1`, `xragent3`, …

---

## 5. Asset catalog

### 5.1 Docs / Getting Started GIFs (best tweet loops)

| Path | URL | Suggested tweet use |
|------|-----|---------------------|
| `frontend/docs/media/ai-generate.gif` | https://render3d.app/docs/media/ai-generate.gif | Generate CAD from text |
| `frontend/docs/media/multi-gen.gif` | …/multi-gen.gif | Parallel generations |
| `frontend/docs/media/picks.gif` | …/picks.gif | Face/edge picks, @face |
| `frontend/docs/media/select-object.gif` | …/select-object.gif | Click object / onboarding |
| `frontend/docs/media/solid-tools.gif` | …/solid-tools.gif | SOLID tools |
| `frontend/docs/media/sketch.gif` | …/sketch.gif | Constrained sketch |
| `frontend/docs/media/canvas.gif` | …/canvas.gif | Older canvas |
| `frontend/docs/media/canvas-workspace.gif` | …/canvas-workspace.gif | Canvas 2026-09 (open last, Smart Description) |
| `frontend/docs/media/imagine-panel.gif` | …/imagine-panel.gif | Imagine + /fetch |
| `frontend/docs/media/parts-catalog.gif` | …/parts-catalog.gif | Parts Catalog / McMaster |
| `frontend/docs/media/pin-projects.gif` | …/pin-projects.gif | Star/pin projects |
| `frontend/docs/media/viewport-finder.gif` | …/viewport-finder.gif | Cmd+F finder |
| `frontend/docs/media/clip-video-editor.gif` | …/clip-video-editor.gif | Clip editor / film-edit |
| `frontend/docs/media/prompt-persist.gif` | …/prompt-persist.gif | Per-project drafts |
| `frontend/docs/media/reference-folders.gif` | …/reference-folders.gif | Screenshots / recordings folders |
| `frontend/docs/media/reference-markup.gif` | …/reference-markup.gif | Pen markup + Send to AI |
| `frontend/docs/media/wiring.gif` | …/wiring.gif | Wiring Simulator |
| `frontend/docs/media/wiring-compose.gif` | …/wiring-compose.gif | Wiring History / Send to wiring |
| `frontend/docs/media/source-parts.gif` | …/source-parts.gif | ⓘ source + drag to Wiring |
| `frontend/docs/media/workspaces.gif` | …/workspaces.gif | Team workspaces |
| `frontend/docs/media/share-folder.gif` | …/share-folder.gif | Share / public link |
| `frontend/docs/media/cloud-sync.gif` | …/cloud-sync.gif | Fusion / Onshape |
| `frontend/docs/media/render-agent.gif` | …/render-agent.gif | Render Agent |
| `frontend/docs/media/preferences.gif` | …/preferences.gif | Preferences |
| `frontend/docs/media/new-project.gif` | …/new-project.gif | New project + |
| `frontend/docs/media/link-to-prompt.gif` | …/link-to-prompt.gif | Link chips to prompt |
| `frontend/docs/media/rigging-urdf.gif` | …/rigging-urdf.gif | URDF / bones |
| `frontend/docs/media/robotics-configuration.gif` | …/robotics-configuration.gif | Viser + Teleop setup |
| `frontend/docs/media/robotics-viser.gif` | …/robotics-viser.gif | Viser LAN |
| `frontend/docs/media/robotics-teleop.gif` | …/robotics-teleop.gif | Teleop proxy |

Opt (older/alternate): `frontend/docs/media/opt/*.gif`.  
Social crops: `frontend/docs/media/social/{ai-generate,picks,render-agent,select-object,workspaces}.social.gif`.

### 5.2 Stills / LinkedIn / timeline

| Path | Use |
|------|-----|
| `frontend/docs/media/timeline-render-history.png` | Timeline colors + cost |
| `frontend/docs/media/management-feedback-dms.png` | Admin DMs |
| `frontend/docs/media/render3d-linkedin-ai-cad.png` | LinkedIn AI CAD |
| `frontend/docs/media/render3d-linkedin-hello-world.png` | Hello world |
| `frontend/docs/media/render3d-linkedin-open-source.png` | Open source |
| `frontend/docs/media/render-studio-roadmap-robotics.jpg` | Robotics roadmap still |

### 5.3 Studio chrome GIFs

| Path | Use |
|------|-----|
| `frontend/assets/studio/record-done-hint.gif` | Stop-record popup |
| `frontend/assets/studio/shared-projects-hint.gif` | Shared projects hint |
| `frontend/assets/onboarding/text-to-cad-demo.gif` | Email / onboarding CAD |
| `frontend/assets/onboarding/robot-motion-demo.gif` | Robot motion |
| `frontend/media/images/Logos/Render-Animations/Loading-Screen/chrome-electric-matrix/animation-preview.gif` | Loading experiment — not header logo |

### 5.4 Video / 3D stock

| Path | Type | Use |
|------|------|-----|
| `frontend/assets/img2threejs/1.5-beta-pikachu.mp4` | mp4 | Mesh Beta character/VFX |
| `static/promo/render-studio-x-showme.mp4` | mp4 | Promo recorder output (if present after `scripts/promo-record/record-x-showme.mjs`) |
| Kenney avatar GLBs | glb | VR people — not product CAD |
| Quest Touch Plus GLBs | glb | Controller viz |
| `projects/<id>/*.glb` | glb | **User/project CAD — do not tweet other people’s private files.** Use public `/share/` or a project you own |

Wiring example JSON/SVG: `frontend/wiring-examples/`.

### 5.5 Features with **no** stock asset (generate)

Layouts mosaic, Transparent All objects, tab split, Canvas Invite, Parts List thumbnails, Grok bot prefs row, Control Center, finder (except docs GIF), wrist-cam overlays, FreeCAD joints overlay, OG paste-preview in iMessage (use `render-logo-gear-og.png`), live Quest passthrough.

---

## 6. How to generate media

**Never** run paid Generate from the bot. Use Record/Screenshot on an already-open local project, or the scripts below.

### 6.1 Screenshot (PNG)

UI: Viewport capture crescent → **Shot**, or 📷. Options: Viewport window / Full page / Fullscreen / Saved crop / Ask each time. Saves **Reference Files → Screenshots**. Markup modal → annotate → Share to X or download.

VR/mobile: POV Screenshot → lands in **AR** folder; PC popup without refresh.

API thumbs: `GET /api/autodesk/thumbnail`, `GET /api/onshape/thumbnail` (auth). Share OG: `backend/services/share_preview.py` builds dark PNG from iso snapshot.

Recipe if missing: open the tool → Shot → Viewport window → download PNG ≤5 MB.

### 6.2 Record WebM / MP4

1. Viewport **Rec** ▾ → Full page (includes Docs) or Viewport or Fullscreen.
2. Quality **Ultra**, **60 fps**, microphone optional.
3. Start recording → use the feature → **Stop**.
4. **You’re done recording** popup (`record-done-hint.gif`): Share to X (download-then-compose, **no** ffmpeg convert), Open editor, or save to **Screen Recordings**.
5. Native blob is often **WebM**. Download MP4 from editor, or:

```http
POST /api/video/convert
# multipart: video=<file>; format=mp4|webm|gif; quality=standard|high|ultra; audio=true|false
# max 180 MB convert; trim_in / trim_out optional
```

Implementation: `backend/main.py` `@app.post("/api/video/convert")`, `backend/services/video_ffmpeg.py`.

Share to X product path **must not** call convert (by design). MCP posts are text-first; attach media via Studio Share to X on a human machine when you need video.

VR: capture folder → Record; spectator is head-centered with Explorer + AI windows.

### 6.3 GIF

- Clip editor → export GIF (uses convert `format=gif`, no audio).
- Docs-style 720×400 studio-dark loops:

```bash
cd /Users/sam/Render-Studio
.venv/bin/python scripts/gif-demos/record_sept_feature_gifs.py
.venv/bin/python scripts/gif-demos/record_robotics_configuration_gifs.py
.venv/bin/python scripts/gif-demos/record_getting_started_gifs.py
.venv/bin/python scripts/gif-demos/record_source_parts_gif.py
.venv/bin/python scripts/brand-update-gifs.py
```

Output: `frontend/docs/media/<name>.gif`. Playwright live recorders live in `scripts/gif-demos/` (`record_gs_demos.py` for real UI). Promo 1280×720 MP4: `node scripts/promo-record/record-x-showme.mjs [http://127.0.0.1:8001]` → `static/promo/render-studio-x-showme.mp4` (and Desktop copy).

**Grok bot clip board:** `POST https://render3d.app/mcp/clips` with `title` + `prompt`. `GET https://render3d.app/mcp/clips` lists every `url` (`https://render3d.app/docs/media/<slug>.gif`) and repo `path`. After the bot copies a file, `POST https://render3d.app/mcp/clips/{id}/grab`. MCP: `grok_request_clip`, `grok_clips`, `grok_clip_grab`. Cursor inbox: https://render3d.app/mcp/harness.md. `run=sept|aug|getting-started|robotics|source-parts` reruns those recorders. Never paid Generate.

ffmpeg local (if convert API is down):

```bash
ffmpeg -y -i input.webm -vf "fps=12,scale=720:-1:flags=lanczos" -loop 0 out.gif
```

### 6.4 3D export / models / thumbnails

Export menu: **GLB** (viewer/share), **STL**, **STEP** (B-rep Part/Assembly), **3MF** (Bambu plates). Right-click project Export without opening. Fusion: push Part STEP (not linked Assembly); Onshape library import/export; SolidWorks library.

Thumbnails: project cards use solid-model thumbs (not dotted splat). Catalog/McMaster cards use catalog imagery. Parts List rows show part thumbnails (mini-viewer WebGL). Marketplace `thumbnail_url`. Share-link PNG via `share_preview.py`.

Canvas export: toolbar Download PNG/JPG/WebP/JSON. Smart Description does not generate CAD.

Imagine: gallery files under project `imagine/`; `/fetch` CAD under `imagine/fetched/` + Components.

### 6.5 3D for tweets when you cannot attach GLB

1. Export GLB (human).
2. Record a slow orbit (Rec → Viewport → Ultra → 60 fps) ~5 s.
3. Convert GIF or MP4.
4. Tweet with public share URL `https://render3d.app/share/<token>` so people can orbit.

---

## 7. Public pages & in-app routes cheat sheet

| Route | What |
|-------|------|
| `/` | Studio |
| `/getting-started.html#viewport-finder` etc. | Guides (ids = `DOC_FEATURES` / shipped.json) |
| `/docs.html` | Full docs |
| `/updates.html` | Changelog cards |
| `/marketplace.html` | Store + free viewport layouts |
| `/skills.html` | Skills Library |
| `/agent-store.html` | Agent apps |
| `/credibility.html` | OSS licenses |
| `/share/<token>` | Public model / layout import |
| `/u/<handle>` | Public profile |
| `/admin-dashboard.html` | Management |
| `/foundry.html` | Developer desk |
| `/database.html` | Database configuration |
| `/capture.html` | Phone capture |

Feature ids for `#` anchors (from `docs-features.js`): `ai-generate`, `ai-modes`, `codex-spice`, `multi-gen`, `picks`, `skills-kb`, `prompt-history`, `imagine-panel`, `prompt-persist`, `workspaces`, `share-folders`, `projects-upload`, `pin-projects`, `clip-video-editor`, `reference-folders`, `timeline-history`, `public-share`, `reference-markup`, `solid-tools`, `viewport-controls`, `viewport-finder`, `feature-history`, `sketch`, `canvas`, `rigging-bones`, `rigging-urdf`, `robotics-configuration`, `robotics-viser-lan`, `robotics-teleop-proxy`, `robotics-wrist-cameras`, `wiring`, `wiring-compose`, `source-parts`, `cloud-sync`, `import-export`, `architect`, `catalog`, `render-agent`, `agent-store-browse`, `agent-store-submit`, `preferences`, `ai-keys`, `credibility`, `vr-ai-draw`.

---

## 8. Copy starters (fill media from §5)

Always end with:

```text
Built in Render Studio https://render3d.app
```

Examples (draft only):

- Finder: “Cmd+F your projects and prompts without leaving the 3D view.” + `viewport-finder.gif`
- Catalog: “McMaster + step.parts in the Parts Catalog — Insert is gone.” + `parts-catalog.gif`
- Imagine: “Product shots in Imagine, then /fetch public CAD.” + `imagine-panel.gif`
- Clip editor: “Record the viewport, trim, GIF, or AI film-edit in Studio.” + `clip-video-editor.gif`
- Layouts: “Save split views (3D + Wiring + Parts List) and install them from the marketplace.” — **no stock GIF; record tab strip → Layouts**
- Share to X: “Stop recording → download → compose. Caption already has Render Studio.” + `record-done-hint.gif`
- VR: “Quest recording matches what you see — then Share to X on the PC.” — **record headset spectator**
- Gear logo: still PNG as the mark; don’t post the live SVG as a “video”

---

## 9. Related code (for the pipeline, not for tweets)

| Thing | Path |
|-------|------|
| MCP server | `mcp/grok-bot/server.py` |
| MCP example | `mcp/grok-bot/mcp.json.example` |
| Debug path tracer | `mcp/grok-bot/DEBUG-PATH-TRACER.md` |
| Studio Grok service | `backend/services/grok_bot_service.py` |
| Share to X caption | `frontend/viewport/viewport-video-record.js` |
| X media upload | `backend/services/twitter_link_service.py` |
| Feature catalog | `frontend/site/docs-features.js` |
| Shipped cards | `frontend/docs/updates/shipped.json` |
| Worklog | `ai-context/worklog.md` |
| Product CHANGELOG | `Getting-Started/CHANGELOG.md` |
| Social drafts | `frontend/docs/updates/social/` |
| GIF recorders | `scripts/gif-demos/` |
| Promo MP4 | `scripts/promo-record/record-x-showme.mjs` |

**Grok bot must never print `x_consumer_secret` or any API key.**

## 7. Pitch decks (`mktpitch1`)

Marketing can assemble a **pitch deck** (Markdown outline + PDF slides) in the sandbox file set only:

- MCP: `grok_pitch_deck` (`action=generate`, optional `topic` / `slides`)
- HTTP: `POST /mcp/sandbox/pitch`
- Files: `frontend/sandbox/examples/pitch-social-growth.md` + `.pdf`
- Super IDE **PDF** tab → Pitch; **Notes** → outline. Point **left/right** of the PDF to step slides (same Draw/point idea as Bambu plates).
- Social track: `@a1_projects`, `@winstead_works`. **No fake follower counts.** Draft X only (`x_post confirm=false`). Never auto-publish.
- Keep `sandbox1`–`sandbox4`. No extra WebGL.

RnD benchmark plan for these surfaces: `frontend/sandbox/curriculum/rnd-benchmarks.md` (`grok_rnd_benchmarks`).

