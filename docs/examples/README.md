# Render Studio example workflows

These examples are short starting points, not magic phrases. Adapt dimensions, materials, file names, and machine constraints to the project in front of you. Review generated geometry and machine instructions before fabrication or physical motion.

## 1. Generate a mounting plate

**Goal:** create a simple, measurable part that is easy to inspect.

1. Start a new Design project.
2. Enter:

   ```text
   Create a 120 × 80 × 6 mm mounting plate with 8 mm corner radii.
   Add four 5 mm through-holes, each centered 10 mm from its two nearest edges.
   Add a centered 30 × 18 mm rectangular cable opening with 3 mm corner radii.
   ```

3. Measure the overall body and two hole offsets.
4. Export the accepted solid in the format required by the next tool.

**Good follow-up:** `Keep the outside dimensions fixed and move only the cable opening 8 mm toward the nearest short edge.`

## 2. Edit from a selected reference

**Goal:** make the request spatially unambiguous.

1. Select a face, edge, corner, or drawn path in the viewport.
2. Insert the resulting reference chip into the prompt.
3. Enter a constrained edit such as:

   ```text
   At @face-1, add a 24 mm diameter, 3 mm deep circular recess.
   Keep every other feature unchanged.
   ```

4. Compare the result with the previous timeline step before accepting it.

## 3. Prepare a robot project

**Goal:** keep the model, scene, and controls in one project.

1. Import the robot model or URDF and its supporting meshes.
2. Open Robotics and choose the project setup.
3. Confirm joint names, limits, base orientation, and the intended simulation scene.
4. Load the scene in the supported simulator and inspect it before enabling any hardware path.
5. Save a snapshot or recording with the project so another contributor can reproduce the setup.

> [!CAUTION]
> Simulation success is not permission to move a physical robot. Verify the emergency stop, workspace clearance, limits, and the repository's hardware-specific safety guidance first.

## 4. Connect a sourced part to Wiring

**Goal:** preserve the identity of a real component while designing around it.

1. Find or import the component in Parts Catalog.
2. Send the part to Wiring.
3. Assign the documented pins and supply constraints.
4. Validate the circuit and resolve warnings.
5. Return to Design to build an enclosure or fixture around the measured part.

**Example design prompt:**

```text
Create a vented enclosure around the selected controller board.
Use the measured board bounds, preserve access to every connector,
and add four removable mounting posts with 2 mm clearance.
```

## 5. Review a build in VR

**Goal:** catch scale, access, and layout problems before fabrication.

1. Open the project in the VR workspace.
2. Fit the model, then inspect it at the intended physical scale.
3. Check maintenance access, cable routes, collision space, and operator reach.
4. Capture a screenshot or recording and attach it to the project review.

## 6. Prototype a concrete-printing workflow

**Goal:** keep experimental machine development separated from unsupported production claims.

1. Model the frame, motion system, hose path, and extruder as separate assemblies.
2. Record travel limits, nozzle assumptions, layer geometry, and material constraints in the project.
3. Simulate or dry-run motion without material.
4. Export reviewed geometry and machine context for the downstream controller.
5. Treat automated material deposition, calibration, collision handling, and production control as validation work until proven on the target machine.

**Example planning prompt:**

```text
Create a parameter table for a concrete-printer test wall:
overall size, layer height, bead width, nozzle offset, travel speed,
print speed, corner slowdown, and safe lift height. Do not invent values;
mark every unknown as requiring machine calibration.
```

## 7. Package a reusable project asset

**Goal:** help another user understand what they are installing or remixing.

Include:

- a clear title and one-sentence outcome;
- a preview image or short GIF;
- source and export formats;
- dimensions, dependencies, and supported hardware;
- setup and validation steps;
- license and attribution;
- explicit limitations and safety notes.

## Next references

- [VR and robotics workspace](../vr-robotics-workspace.md)
- [Robot learning workflow](../robot-learning-workflow.md)
- [OpenArm + MuJoCo wiring](../openarm-pi-mujoco-wiring.md)
- [Wiring component sources](../wiring-component-sources.md)
- [Marketplace hub](../marketplace-hub.md)

