---
name: openarm-calibration
summary: Analyze synchronized OpenArm 2.0 and Quest pose recordings, printed controller nests, and held-out calibration checks.
---

# OpenArm 2.0 controller calibration

Use after `openarm-research` has pinned the exact hardware, gripper, headset/controller and simulator versions. This skill is for evidence review and simulation proposals. It never homes, resets, powers, or moves the robot.

## Intake

Require: project/tenant ID, robot and controller serial/revision, nest CAD SHA and print settings, tracking origin and grip/aim pose selection, robot base frame, end-effector/tool frame, table frame, sensor/encoder timestamps and synchronization estimate, left/right labels, tracking validity, FK version, motor/controller datasheet, signed operator observations and session ID. Treat absent fields as `unknown`; do not reuse an old transform after Quest recenter or fixture remount without revalidation.

## Algorithm and acceptance

1. Validate frame direction and units. For each pose, `B_i = T_robot_ee`, `Q_i = T_quest_controller`, `Z = T_robot_quest`, `X = T_controller_ee`; solve `B_i = Z Q_i X`.
2. Reject a single pose or a set rotating about only one axis. Collect varied translations and at least two independent rotation axes while the controller stays tracked.
3. Fit on a training subset; evaluate held-out position and orientation residuals. Record RMS, maximum, timestamp offset, tracking dropouts, and sensitivity to leaving one pose out. Use thresholds declared **before** viewing results and tied to the task's clearance budget. The notebook's 2 mm/1 degree numbers are demonstration values only.
4. Compare square/upright and tilted printed nests by independent remount sessions. Prefer the variant with a repeatable keyed mount, unoccluded tracking, positive clearance and smaller held-out residual. A render cannot prove any of those measurements.
5. In MuJoCo, place the table/cube from measured transforms, check swept collision and safe return paths, and perturb pose/friction/mass within measured uncertainty. Mark a simulation pass separately from printed fit and hardware pass.
6. Record `calibration` and `rig_audit` events through `openarm_research`; include source IDs/hashes and a diagnosis if the new run differs from the last observed working run. Propose exactly one parameter/design change and a test that could disprove the cause.

## Report

State: source version; transform matrix and frame convention; training/held-out count; residuals and confidence intervals across **independent** remounts; tracking losses; collision/fit evidence; manual interventions with minutes; last working and first failing artifact IDs; proposed next measurement. Never mark `ready_for_physical_motion` true from this skill or the synthetic example.

Method references: [OpenCV calibration](https://docs.opencv.org/5.0/main_modules/calib.html), [robot-world/hand-eye paper](https://arxiv.org/abs/1907.12425), [OpenXR pose definitions](https://registry.khronos.org/OpenXR/specs/1.1-khr/pdf/xrspec.pdf), [OpenArm hardware](https://github.com/enactic/openarm_hardware).
