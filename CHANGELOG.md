# Changelog

<!-- simple-changelogs-signature agent="Cursor Grok 4.5" at="2026-07-27T03:54:44+00:00" -->
## 2026-07-27

- Share to X opens a compose window with your caption filled and downloads the clip or screenshot to attach (direct API media upload needs X write permissions and API credits).
- Video studio supports multi-track clip editing with webcam, upload, and phone QR capture, plus Handy-oriented Bambu send on mobile.

## 2026-07-26

- Export → Copy share link scopes the public viewer to the selected model (including resolving 3MF to a GLB preview) instead of baking every visible sibling.
- Applying a texture records a Texture step on the timeline; Solid mode can remove texturing and restore original rendered colors.
- Generation loading steps only move forward; revise loops show “Revising model” instead of jumping backward.
- Switching projects no longer stops generation on another project.
- Finishing CAD/Mesh generation leaves Design with the model visible even if Rigging was open.
- Wiring Simulator is usable again; mesh project body requests no longer fail.
- Dense CAD meshes keep readable shading (heavy edge overlays no longer black out the model).

## 2026-07-25

- Mesh mode stays selected through Generate; Mesh results that finish while you are on another project still appear when you return.
- Project chat images open in an in-app lightbox instead of a new browser tab.
- Shared credits include Render3D Kimi; personal key Save & activate works reliably; Kimi selection no longer snaps back to Claude or OpenAI.
- Viewport orbit stops when you release the mouse; mobile look-dev no longer shows pure-black models.
- Fusion export: clearer unlink howto, Part (not linked Assembly) push, and restored STEP Part/Assembly export paths.
- CAD colors avoid black / charcoal / aluminium washes on the dark canvas; models stay upright instead of tipping onto their side.
- Prompt drafts stay per-project (no cross-project bleed when switching mid-load).
- Admin Recent Projects can be sorted by date, name, person, cost, or files.

## 2026-07-24

- Mesh mode (img2threejs) replaces the Fusion prompt tab: keeps PBR shading, Y-up→Z-up orientation, Stop generating, review-loop continue, and Edit-selected stem retention.
- Export uses viewport selection truth with Part/Assembly chooser; hidden siblings are not uploaded; right-click Export works without opening the project.
- Fusion export UX: pinned orange Export CTA, folder picker with checks, replace-vs-new with thumbnails, success check, unlink guidance, and Part-oriented STEP for Extrude/Cut.
- Share links and Connect X flows improved; electronics toggle stays visible in the prompt mode row.
- Account menu includes Manage AI Keys; workspace members support invite / edit / view roles.
- Docs Getting Started layout and GIFs refreshed; pick tools and Components hierarchy polish.

## 2026-07-23

- Robotic Simulator tab (alongside Electronics) with a cleaner robot floor; Design viewport no longer inherits work-cell props.
- High-quality viewport video record control.
- Share links only include unhidden models; right-click share project with a teammate.
- Workspace invites and menu polish; invited projects land in the shared folder.
- Components tree shows Bodies for assemblies with less indent.
- Link previews title the product as AI & Robotics Studio.
- Quest tracking lives under Preferences → Advanced.

## 2026-07-22

- Shared workspace project checkboxes show the correct projects.
- Workspace invite uses a popup flow.

## 2026-07-21

- Quest Book progression checkpoints work end-to-end; Quest Complete header note and tracking toggle.

## 2026-07-19

- Product Quest Book visual stage shipped.
