# VR Studio spatial AI Draw

Entry: **VR Studio → Draw → AI Prompt**. Open a project first. A model must already have a lightweight viewport preview before it can be placed on this board.

1. Add project references. Models appear about 28 cm across, within reach. Grip to move or rotate; Selection tools provides size, rename, duplicate and remove. Presentation transforms never change the source CAD file or units.
2. In Draw & select, choose Lasso and circle a model surface with the trigger. Pen, line, arrow and label also work in space. Face and Edge select a surface triangle or its nearest edge, carrying a CAD face ID when the model supplies one.
3. Start Live voice while drawing. Discuss the selected region. A split note records intent and assembly requirements; missing printer model or connector style produces a clarification tied to that region, even after gaze changes.
4. Open Region notes to edit, add, expand or collapse multiple notes. Long notes use a paged anchored panel. Memo nodes retain their audio and editable transcript.
5. Link selects endpoint A, then B. Add a relationship caption using text, voice or the shared @ picker. Stable IDs retain references through renaming. Select an image and use Selection tools → Final look.
6. Smart Description follows connected chains, notes and memo transcripts, preserving the existing draft and attachments. Review the organized prompt; this does not run generation.
7. Explicit Generate freezes the selected connected graph, source identities, transforms, anchors, notes, captions and final-look choices. Missing split details or invalid anchors must be resolved first. CAD/mesh generation uses the existing project pipeline.
8. Undo/Redo acts on the board, including completed strokes and transformations. Cancel returns to Move and drops only unfinished gestures. Close retains completed work. The project Canvas store uses atomic revision-checked saves; conflicting saves retain local edits.

## Performance boundaries

- Reuses the existing Three.js renderer, controller routing, project APIs, composer and live voice transport. No additional renderer, background model converter or per-frame screenshot capture.
- Up to 12 visible reference nodes and six image previews. Model previews share source geometry, use a simple material, and are limited to 8,000 triangles/12 meshes **within** the existing scene's combined 16,000-triangle/24-mesh CAD budget. Heavy, animated and instanced previews are deferred.
- Image headers are checked before decoding: static PNG/JPEG/WebP, at most 2 MiB compressed and 2 megapixels for scene previews, resized to a 512-pixel edge. Prompt image attachment uses a stricter 1 MiB limit. Decoding is serialized and canceled when hidden. Unsupported/oversized images request a smaller still preview.
- Only completed input commits to history/persistence. Held transforms update view buffers, then commit once on release. Idle updates do not repaint canvases, encode images or rebuild geometry. Surface hover is throttled; stroke samples project onto the selected face plane.
- Continuous wrapping of ink across curved surfaces is deferred because it requires more surface queries while drawing. Current surface ink remains on its selected face plane and follows its model instance.
- Ink and dotted connectors use fixed buffers. When visual capacity is exceeded, a visible message requests simplification and generation is held until all selected instructions can be reviewed.
- Teleop retains button ownership. Hide/resume, disconnect and input-source reorder cancel partial gestures and retain completed board content.

## Verification and remaining headset checks

Browser evidence is stored under `backups/xr-ai-draw-20260915/verification/`. The synthetic WebXR harness uses actual Three.js geometry, scene controls, target rays, controller events and persistence adapters; provider/generation calls are mocked to avoid starting a paid job or changing a user project. Separate tests exercise actual audio/voice transport with a mocked provider and validate the prepared request through the backend schema.

A physical Quest test remains necessary for binocular text readability, microphone permissions and live provider audio, pinch/controller tracking, sustained GPU frame timing during drawing plus conversation, passthrough visibility, and removal/resume/reconnect behavior on headset hardware. Browser JavaScript timing is not headset FPS and does not establish crash-free operation on a physical device.
