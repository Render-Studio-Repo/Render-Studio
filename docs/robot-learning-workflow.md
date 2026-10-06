# Robot recording and learning workflow

This guide describes the recommended workflow for this Studio integration. Recording, training a policy, and executing a policy are separate operations. A downloaded MuJoCo XML scene describes the simulated world; it does not supply a hardware motion program.

## Understand the source

| Source | What it means here | Current recording limitation |
| --- | --- | --- |
| Simulation | MuJoCo computes a virtual robot and environment. | Studio currently captures analysis snapshots, not a continuous action/observation stream. |
| Shadow | A comparison workflow intended to observe real telemetry and predicted commands without applying those predictions. | A mode label alone does not establish a complete shadow controller or dataset. |
| Hardware | A real robot controller applies commands and reports measurements. | Studio DimOS samples contain commanded end-effector poses, not synchronized measured joint state and camera frames. |
| Viser | A visualization surface that can display robot state. | A displayed joint value is not proof that a physical actuator executed a command. Current captures are telemetry-only. |

Viser scene serialization stores visualization messages for playback or embedding. A `.viser` file does not by itself provide a robot-learning observation/action dataset. See the [Viser state serializer](https://viser.studio/main/api/advanced/state_serializer/).

## Collect a complete episode

Our recommended capture contract includes the task, project, scene, robot identity, operator, software version, calibration version and episode identifier. At each control step, preserve synchronized camera frames, measured joint state, commanded targets, commands actually accepted/applied by the controller, timestamps and control frequency. Retain camera intrinsics/extrinsics, units, joint order, frame conventions, gripper state, dropped-frame diagnostics and stop reasons. Distinguish requested commands from acknowledged execution.

Label success, failure, failure reason and human intervention intervals explicitly. Stopping a recording does not imply success. Record recoveries as their own labeled behavior. Keep simulator episodes, Viser display streams and physical trials distinguishable.

## Inspect, convert and train

For an initial imitation-learning experiment on a repeatable manipulation task, we recommend evaluating LeRobot with ACT. This is a starting choice, not a claim that ACT is universally best or most popular. ACT predicts action sequences and supports learning from demonstrations. Check hardware support, action representation and compute requirements first. See [ACT](https://huggingface.co/docs/lerobot/act) and [real-robot imitation learning](https://huggingface.co/docs/lerobot/il_robots).

LeRobotDataset v3 organizes numeric signals in Parquet, camera video in MP4 and episode/schema information in metadata. Convert with a validated adapter that maps timestamps, actions, observations and episode boundaries. Renaming a Studio JSONL file does not perform this conversion. See [LeRobotDataset v3](https://huggingface.co/docs/lerobot/lerobot-dataset-v3).

If an existing research stack uses robomimic, its dataset conventions are another supported design target to evaluate. Its expected observations and actions require deliberate formatting and validation. See [robomimic dataset documentation](https://robomimic.github.io/docs/datasets/overview.html).

If the robot already publishes ROS 2 topics, retaining the original streams in rosbag2 with MCAP is a useful raw archive option. MCAP storage is supported by the ROS 2 recording tools. It does not replace synchronized dataset conversion or a trainer. Installing ROS 2 is not required merely to save Studio recordings. See [ROS 2 MCAP recording](https://mcap.dev/guides/getting-started/ros-2).

## Evaluate and improve

Our recommended evaluation process splits whole episodes and collection sessions into training, validation and held-out evaluation sets. Avoid putting neighboring frames from the same take in different sets. Freeze the held-out tasks and conditions before comparing checkpoints. Measure task completion, interventions, limit violations and failures, not just training loss.

Collect corrections for observed failure modes, label them, retrain a new checkpoint and compare it with the previous checkpoint on the same held-out protocol. Keep checkpoint, dataset version, configuration and results together. A successful simulation evaluation does not establish physical readiness. Begin physical evaluation under supervision with the robot's existing limits, stop controls and calibration checks. This guide does not launch training or robot motion.

## Current Studio exports

Exports are `render-studio-recording/v1`, not certified LeRobot datasets. The metadata declares `capture_kind`, `training_ready: false` and `missing_fields`. MuJoCo exports are `simulation_snapshots`, Viser exports are `telemetry_only`, and DimOS exports are `commanded_ee_poses`. Collect the missing signals before training a policy that needs them.

Read every entry in `sample_chunks` to reconstruct an episode. Capture stops explicitly at the configured memory/sample limit. A failed save stays in this browser session for retry; closing the page can lose unsaved data. Saving does not upload a dataset or train a model.

Official documentation checked September 23, 2026.
