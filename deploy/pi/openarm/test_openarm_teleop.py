# Copyright 2026 Dimensional Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Construction and component tests for safe OpenArm Quest teleoperation."""

import time
from typing import Any, cast

import numpy as np
import pytest
from pytest_mock import MockerFixture

from dimos.control.tasks.pose_target_ik import PoseTargetIKTaskConfig
from dimos.control.tasks.teleop_ik_task.teleop_ik_task import TeleopIKTask
from dimos.control.tick_loop import TickLoop
from dimos.core.coordination.blueprint_config.parser import BlueprintConfigParser
from dimos.core.coordination.blueprints import Blueprint
from dimos.hardware.whole_body.spec import WholeBodyAdapter
from dimos.imitation.collection.episode_monitor import EpisodeMonitorModule
from dimos.imitation.collection.recorder import CollectionRecorder
from dimos.manipulation.planning.kinematics.config import PinkKinematicsConfig
from dimos.manipulation.planning.spec.config import RobotModelConfig
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.msgs.std_msgs.Float32 import Float32
from dimos.robot.manipulators.openarm.blueprints.basic import openarm_planner_coordinator
from dimos.robot.manipulators.openarm.blueprints.teleop import (
    OPENARM_QUEST_TASK_NAME,
    OpenArmTeleopCoordinator,
    _OpenArmManipulationModule,
    teleop_quest_openarm,
)
from dimos.robot.manipulators.openarm.config import (
    OPENARM_ARM_JOINTS,
    OPENARM_GRIPPER_JOINTS,
    OPENARM_GRIPPER_REST_OPENING,
    OPENARM_HANG_DOWN_JOINTS,
    OPENARM_Y_HOME_ARM_JOINTS,
    OPENARM_HOME_JOINTS,
    OPENARM_HOME_VELOCITY_RAD_S,
    OPENARM_JOINTS,
    openarm_bimanual_model_config,
)
from dimos.robot.manipulators.openarm.quest_teleop import OpenArmQuestTeleopModule
from dimos.robot.manipulators.openarm.teleop_ik import OpenArmPinkPoseTargetSolver
from dimos.teleop.quest.quest_types import Buttons, Hand, QuestControllerState


def _module_kwargs(blueprint: Blueprint, module_type: type) -> dict[str, Any]:
    return next(atom.kwargs for atom in blueprint.blueprints if atom.module is module_type)


def _solver_config(
    model: RobotModelConfig,
    frames: tuple[str, ...],
    pink_config: PinkKinematicsConfig,
) -> PoseTargetIKTaskConfig:
    return PoseTargetIKTaskConfig(
        joint_names=tuple(OPENARM_ARM_JOINTS),
        robot_model=model,
        target_frames=frames,
        pink=pink_config,
    )


def test_openarm_model_uses_canonical_zero_start() -> None:
    model = openarm_bimanual_model_config()

    assert model.home_joints == OPENARM_HOME_JOINTS
    assert OPENARM_HOME_JOINTS == [0.0] * len(OPENARM_ARM_JOINTS)


def test_openarm_y_home_resets_all_seven_joints_including_wrists() -> None:
    assert OPENARM_Y_HOME_ARM_JOINTS == OPENARM_HOME_JOINTS
    assert OPENARM_HANG_DOWN_JOINTS == OPENARM_Y_HOME_ARM_JOINTS
    assert OPENARM_Y_HOME_ARM_JOINTS == [0.0] * len(OPENARM_ARM_JOINTS)
    # Wrist roll/yaw/pitch are joints 5–7 on each arm (0-based 4–6 / 11–13).
    assert OPENARM_Y_HOME_ARM_JOINTS[4:7] == [0.0, 0.0, 0.0]
    assert OPENARM_Y_HOME_ARM_JOINTS[11:14] == [0.0, 0.0, 0.0]


def test_openarm_quest_blueprint_has_one_bimanual_mock_task() -> None:
    coordinator_kwargs = _module_kwargs(teleop_quest_openarm, OpenArmTeleopCoordinator)
    teleop_kwargs = _module_kwargs(teleop_quest_openarm, OpenArmQuestTeleopModule)
    manipulation_kwargs = _module_kwargs(teleop_quest_openarm, _OpenArmManipulationModule)
    tasks = coordinator_kwargs["tasks"]

    assert any(atom.module is EpisodeMonitorModule for atom in teleop_quest_openarm.blueprints)
    assert any(atom.module is CollectionRecorder for atom in teleop_quest_openarm.blueprints)
    monitor = next(
        atom for atom in teleop_quest_openarm.blueprints if atom.module is EpisodeMonitorModule
    )
    assert monitor.kwargs["button_map"] == {"toggle": "A", "discard": "B"}

    assert "hardware" not in coordinator_kwargs
    assert "left_can_port" not in coordinator_kwargs
    assert "right_can_port" not in coordinator_kwargs
    assert len(tasks) == 4

    task = next(task for task in tasks if task.type == "teleop_ik")
    trajectory = next(task for task in tasks if task.type == "trajectory")
    grippers = [task for task in tasks if task.type == "gripper"]
    bindings = task.params["bindings"]
    assert task.name == OPENARM_QUEST_TASK_NAME
    assert task.type == "teleop_ik"
    assert task.joint_names == OPENARM_ARM_JOINTS
    assert {binding["hand"] for binding in bindings} == {"left", "right"}
    assert {binding["target_frame"] for binding in bindings} == {
        "openarm_left_grasp_frame",
        "openarm_right_grasp_frame",
    }
    assert {joint for gripper in grippers for joint in gripper.joint_names} == set(
        OPENARM_GRIPPER_JOINTS
    )
    assert {gripper.stream_bind["gripper_command"] for gripper in grippers} == {
        "left_gripper_command",
        "right_gripper_command",
    }
    assert isinstance(task.params["pink"], PinkKinematicsConfig)
    assert "robot_model" not in task.params
    assert task.params["solver_type"] is OpenArmPinkPoseTargetSolver
    assert task.params["pink"].joint_limit_posture_margin == 0.3
    assert task.params["pink"].position_cost == 8.0
    assert task.params["pink"].orientation_cost == 0.3
    assert task.params["pink"].posture_cost == 0.01
    assert task.params["pink"].lm_damping == 0.01
    assert task.params["pink"].damping == 1e-3
    assert task.params["max_command_tracking_error_deg"] == 10.0
    assert task.params["max_joint_velocity_rad_s"] == 2.0
    expected_velocity_limits = {
        joint_name: limit
        for side_offset in (0, 7)
        for joint_name, limit in zip(
            OPENARM_ARM_JOINTS[side_offset : side_offset + 7],
            (1.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0),
            strict=True,
        )
    }
    assert task.params["joint_velocity_limits_rad_s"] == expected_velocity_limits
    assert task.params["joint_command_filter_cutoff_hz"] == 5.0
    assert task.params["deadman"] == "pose_stream"
    assert task.priority == 10
    assert trajectory.joint_names == OPENARM_JOINTS
    assert trajectory.priority == 20
    assert trajectory.params["velocity_limits"] == {
        joint_name: OPENARM_HOME_VELOCITY_RAD_S for joint_name in OPENARM_JOINTS
    }
    assert manipulation_kwargs["kinematics"] == task.params["pink"]
    assert manipulation_kwargs["visualization"] == {"backend": "viser", "host": "0.0.0.0"}
    assert teleop_kwargs == {}
    assert teleop_quest_openarm.remapping_map == {
        (OpenArmQuestTeleopModule.name, "left_controller_output"): "left_cartesian_command",
        (OpenArmQuestTeleopModule.name, "left_gripper_command"): "left_gripper_command",
        (OpenArmQuestTeleopModule.name, "right_controller_output"): "right_cartesian_command",
        (OpenArmQuestTeleopModule.name, "right_gripper_command"): "right_gripper_command",
        (OpenArmQuestTeleopModule.name, "joint_command"): "joint_command",
    }


def test_openarm_can_ports_are_blueprint_cli_options() -> None:
    for blueprint in (teleop_quest_openarm, openarm_planner_coordinator):
        parsed = BlueprintConfigParser(blueprint).parse(
            ["--left-can-port", "can1", "--right-can-port", "can0"],
            environ={},
        )

        coordinator = parsed.module_kwargs("ControlCoordinator")
        assert coordinator["left_can_port"] == "can1"
        assert coordinator["right_can_port"] == "can0"


def test_openarm_quest_commands_both_arms_and_grippers_through_coordinator(
    mocker: MockerFixture,
) -> None:
    coordinator_kwargs = _module_kwargs(teleop_quest_openarm, OpenArmTeleopCoordinator)
    mocker.patch.object(OpenArmPinkPoseTargetSolver, "_validate_frame_targets")
    frame_poses = mocker.patch.object(
        OpenArmPinkPoseTargetSolver,
        "frame_poses",
        return_value={
            "openarm_left_grasp_frame": PoseStamped(position=[0.5, 0.2, 0.4]),
            "openarm_right_grasp_frame": PoseStamped(position=[0.5, -0.2, 0.4]),
        },
    )
    step = mocker.patch.object(
        OpenArmPinkPoseTargetSolver,
        "step",
        return_value=JointState(
            name=list(OPENARM_ARM_JOINTS),
            position=[0.01] * len(OPENARM_ARM_JOINTS),
        ),
    )
    mocker.patch.object(TickLoop, "start")
    coordinator = OpenArmTeleopCoordinator(publish_joint_state=False, **coordinator_kwargs)

    try:
        coordinator.start()
        task = cast("TeleopIKTask", coordinator._tasks[OPENARM_QUEST_TASK_NAME])
        assert task._teleop_config.robot_model.joint_names == OPENARM_ARM_JOINTS
        assert task._teleop_config.max_joint_velocity_rad_s == 2.0
        assert task._teleop_config.joint_velocity_limits_rad_s == {
            joint_name: limit
            for side_offset in (0, 7)
            for joint_name, limit in zip(
                OPENARM_ARM_JOINTS[side_offset : side_offset + 7],
                (1.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0),
                strict=True,
            )
        }
        assert task._teleop_config.joint_command_filter_cutoff_hz == 5.0
        assert task._teleop_config.deadman == "pose_stream"
        buttons = Buttons()
        buttons.left_primary = True
        buttons.right_primary = True
        buttons.pack_analog_triggers(left=0.25, right=0.75)
        coordinator._dispatch("teleop_buttons", buttons)
        coordinator._dispatch("left_gripper_command", Float32(data=0.75))
        coordinator._dispatch("right_gripper_command", Float32(data=0.25))
        coordinator._dispatch(
            "left_cartesian_command",
            PoseStamped(frame_id=OPENARM_QUEST_TASK_NAME, position=[1.0, 0.0, 0.0]),
        )
        coordinator._dispatch(
            "right_cartesian_command",
            PoseStamped(frame_id=OPENARM_QUEST_TASK_NAME, position=[-1.0, 0.0, 0.0]),
        )

        assert coordinator._tick_loop is not None
        coordinator._tick_loop._tick()

        connected = coordinator._hardware["openarm"]
        states = cast("WholeBodyAdapter", connected.adapter).read_motor_states()
        assert [state.q for state in states[: len(OPENARM_ARM_JOINTS)]] == [0.01] * len(
            OPENARM_ARM_JOINTS
        )
        assert [state.q for state in states[-2:]] == [
            0.75,
            0.25,
        ]
        frame_poses.assert_called_once()
        step.assert_called_once()

        released = Buttons()
        coordinator._dispatch("teleop_buttons", released)
        coordinator._dispatch(
            "left_cartesian_command",
            PoseStamped(frame_id=OPENARM_QUEST_TASK_NAME, position=[1.1, 0.0, 0.0]),
        )
        coordinator._dispatch(
            "right_cartesian_command",
            PoseStamped(frame_id=OPENARM_QUEST_TASK_NAME, position=[-1.1, 0.0, 0.0]),
        )
        coordinator._tick_loop._tick()
        assert step.call_count == 2
    finally:
        coordinator.stop()


@pytest.mark.self_hosted
def test_openarm_teleop_pink_objective_uses_robot_specific_tuning() -> None:
    model = openarm_bimanual_model_config()
    frames = ("openarm_left_grasp_frame", "openarm_right_grasp_frame")
    config = PinkKinematicsConfig(
        dt=0.01,
        posture_cost=0.01,
        joint_limit_posture_margin=0.3,
        lm_damping=0.01,
        gain=0.25,
    )
    seed = JointState(name=OPENARM_ARM_JOINTS, position=[0.0] * len(OPENARM_ARM_JOINTS))
    solver = OpenArmPinkPoseTargetSolver(_solver_config(model, frames, config))
    targets = solver.frame_poses(seed, frames)

    solver.step(targets, seed, 0.01)

    tasks = next(iter(solver._control_contexts.values())).tasks
    assert tasks is not None
    for frame_name in frames:
        frame_task = tasks[f"frame/{frame_name}"]
        assert frame_task.position_cost == pytest.approx([8.0, 8.0, 8.0])
        assert frame_task.orientation_cost == pytest.approx([0.3, 0.3, 0.3])
        assert f"manipulability/{frame_name}" not in tasks
    assert tasks["posture/current"].cost == pytest.approx(
        np.tile([4.0, 3.0, 0.1, 3.0, 1.0, 1.0, 0.1], 2) * 0.01
    )
    assert tasks["posture/current"].target_q == pytest.approx(
        np.tile([0.0, 0.0, 0.0, 0.8, 0.0, 0.0, 0.0], 2)
    )

    moved_seed = JointState(
        name=OPENARM_ARM_JOINTS,
        position=np.tile([0.1, -0.1, 0.2, 0.4, 0.1, -0.1, 0.2], 2).tolist(),
    )
    solver.reset()
    solver.step(targets, moved_seed, 0.01)

    assert tasks["posture/current"].target_q == pytest.approx(
        np.tile([0.0, 0.0, 0.0, 0.8, 0.0, 0.0, 0.0], 2)
    )


@pytest.mark.self_hosted
def test_openarm_bimanual_pink_steps_from_canonical_zero_with_bounded_updates() -> None:
    model = openarm_bimanual_model_config()
    frames = ("openarm_left_grasp_frame", "openarm_right_grasp_frame")
    config = PinkKinematicsConfig(
        dt=0.01,
        position_cost=1.0,
        orientation_cost=1.0,
        posture_cost=1e-3,
        joint_limit_posture_margin=0.3,
        lm_damping=1e-6,
        gain=0.25,
    )
    ik = OpenArmPinkPoseTargetSolver(_solver_config(model, frames, config))
    seed = JointState(name=OPENARM_ARM_JOINTS, position=[0.0] * len(OPENARM_ARM_JOINTS))
    initial = ik.frame_poses(seed, frames)
    targets = {
        name: PoseStamped(
            frame_id=pose.frame_id,
            position=[pose.position.x, pose.position.y, pose.position.z + 0.01],
            orientation=pose.orientation,
        )
        for name, pose in initial.items()
    }

    max_delta = 0.0
    for _ in range(100):
        result = ik.step(targets, seed, 0.01)
        assert result is not None
        max_delta = max(
            max_delta,
            float(np.max(np.abs(np.asarray(result.position) - np.asarray(seed.position)))),
        )
        seed = result

    final = ik.frame_poses(seed, frames)
    errors = [
        np.linalg.norm(
            np.array([target.position.x, target.position.y, target.position.z])
            - np.array(
                [
                    final[name].position.x,
                    final[name].position.y,
                    final[name].position.z,
                ]
            )
        )
        for name, target in targets.items()
    ]
    assert seed.position[3] > 0.1
    assert seed.position[10] > 0.1
    assert max(errors) < 1e-3
    assert np.rad2deg(max_delta) < 5.0


@pytest.mark.self_hosted
def test_openarm_pink_hold_from_joint_limits_survives_stalled_tick() -> None:
    model = openarm_bimanual_model_config()
    frames = ("openarm_left_grasp_frame", "openarm_right_grasp_frame")
    config = PinkKinematicsConfig(
        dt=0.01,
        posture_cost=0.01,
        joint_limit_posture_margin=0.3,
        lm_damping=0.01,
        gain=0.25,
    )
    solver = OpenArmPinkPoseTargetSolver(_solver_config(model, frames, config))
    context = solver._get_control_context(model, frames, tuple(OPENARM_ARM_JOINTS))
    at_lower = [
        float(context.robot.model.lowerPositionLimit[index]) for index in context.robot.mapping.idx_q
    ]
    seed = JointState(name=OPENARM_ARM_JOINTS, position=at_lower)
    targets = solver.frame_poses(seed, frames)

    result = solver.step(targets, seed, 0.2)

    assert result is not None
    assert result.name == list(OPENARM_ARM_JOINTS)
    delta = np.max(np.abs(np.asarray(result.position) - np.asarray(seed.position)))
    assert float(delta) <= np.deg2rad(10.0) + 1e-9


def _press_y(module: OpenArmQuestTeleopModule, pressed: bool) -> None:
    module._controllers[Hand.LEFT] = QuestControllerState(is_left=True, secondary=pressed)
    module._handle_engage()


def test_openarm_status_advertises_guarded_home_only_with_feedback_state() -> None:
    module = OpenArmQuestTeleopModule()
    try:
        status = module._teleop_status_payload()
        assert status["version"] == "1.0.4"
        assert status["guarded_home"] is True
        assert status["home_supported"] is True
        assert status["capabilities"] == ["guarded_home"]
        assert status["calibrated"] is False
        assert status["home_reached"] is False
        assert status["home_safe_hold"] is False
        assert status["home_target_joint_count"] == len(OPENARM_JOINTS)

        module._latest_arm_positions.update(dict.fromkeys(OPENARM_ARM_JOINTS, 0.0))
        assert module._teleop_status_payload()["calibrated"] is True
    finally:
        module.stop()


@pytest.mark.asyncio
async def test_guarded_home_requires_all_joints_and_a_settled_hold(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        mocker.patch.object(module.joint_command, "publish")
        target = [
            *OPENARM_Y_HOME_ARM_JOINTS,
            OPENARM_GRIPPER_REST_OPENING,
            OPENARM_GRIPPER_REST_OPENING,
        ]
        module._latest_arm_positions.update(dict(zip(OPENARM_JOINTS, target, strict=True)))
        module._start_home_locked(time.monotonic())

        arm_only = JointState(
            name=list(OPENARM_ARM_JOINTS),
            position=list(OPENARM_Y_HOME_ARM_JOINTS),
        )
        await module.handle_coordinator_joint_state(arm_only)
        await module.handle_coordinator_joint_state(arm_only)
        assert module._homing is True
        assert module._home_reached is False

        complete = JointState(name=list(OPENARM_JOINTS), position=target)
        await module.handle_coordinator_joint_state(complete)
        assert module._homing is True
        assert module._home_reached is False

        module._home_in_tolerance_since = time.monotonic() - 0.6
        await module.handle_coordinator_joint_state(complete)
        status = module._teleop_status_payload()
        assert status["homing"] is False
        assert status["home_reached"] is True
        assert status["home_safe_hold"] is True
        assert status["holding"] is True
        assert status["home_feedback_joint_count"] == len(OPENARM_JOINTS)
        assert status["home_max_error_rad"] == pytest.approx(0.0)
    finally:
        module.stop()


def test_guarded_home_timeout_is_failure_not_success(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        mocker.patch.object(module.joint_command, "publish")
        module._latest_arm_positions.update(dict.fromkeys(OPENARM_JOINTS, 0.0))
        module._start_home_locked(time.monotonic() - 21.0)

        module._handle_engage()

        status = module._teleop_status_payload()
        assert status["homing"] is False
        assert status["home_reached"] is False
        assert status["home_safe_hold"] is False
        assert status["holding"] is True
        assert "timed out" in status["home_failure"]
    finally:
        module.stop()


def test_openarm_y_tap_arms_from_off_and_pauses_without_home(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        home = mocker.patch.object(module.joint_command, "publish")
        left_grip = mocker.patch.object(module.left_gripper_command, "publish")
        right_grip = mocker.patch.object(module.right_gripper_command, "publish")
        pose = PoseStamped(frame_id="left", position=[0.0, 0.0, 0.0])
        module._current_poses[Hand.LEFT] = pose
        module._current_poses[Hand.RIGHT] = pose
        module._controllers[Hand.RIGHT] = QuestControllerState(is_left=False, primary=True)

        _press_y(module, True)
        assert not module._homing
        assert not any(module._is_engaged.values())
        home.assert_not_called()

        _press_y(module, False)
        assert not module._homing
        assert module._is_engaged[Hand.LEFT]
        assert module._is_engaged[Hand.RIGHT]
        assert not module._holding
        home.assert_not_called()
        left_grip.assert_not_called()
        right_grip.assert_not_called()

        _press_y(module, True)
        assert not module._is_engaged[Hand.LEFT]
        assert not module._is_engaged[Hand.RIGHT]
        assert module._holding
        assert not module._homing
        home.assert_not_called()

        _press_y(module, False)
        assert module._holding
        assert not any(module._is_engaged.values())
        home.assert_not_called()

        _press_y(module, True)
        _press_y(module, False)
        assert module._is_engaged[Hand.LEFT]
        assert module._is_engaged[Hand.RIGHT]
        assert not module._holding
        home.assert_not_called()
    finally:
        module.stop()


def test_openarm_y_hold_kills_and_fresh_calibrate(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        home = mocker.patch.object(module.joint_command, "publish")
        pose = PoseStamped(frame_id="left", position=[0.0, 0.0, 0.0])
        module._current_poses[Hand.LEFT] = pose
        module._current_poses[Hand.RIGHT] = pose
        module._controllers[Hand.RIGHT] = QuestControllerState(is_left=False)

        _press_y(module, True)
        _press_y(module, False)
        assert all(module._is_engaged.values())
        home.assert_not_called()

        _press_y(module, True)
        assert module._holding
        assert not any(module._is_engaged.values())
        home.assert_not_called()
        module._y_press_started_mono = time.monotonic() - 3.05
        _press_y(module, True)

        assert not module._homing
        assert not any(module._is_engaged.values())
        assert not module._holding
        assert not module._pending_arm
        home.assert_not_called()
        status = module._teleop_status_payload()
        assert status["armed"] is False
        assert status["holding"] is False
        assert status["y_map"] == "tap_pause_hold3_kill"

        _press_y(module, False)
        assert not any(module._is_engaged.values())
        assert not module._holding

        _press_y(module, True)
        _press_y(module, False)
        assert module._is_engaged[Hand.LEFT]
        assert module._is_engaged[Hand.RIGHT]
        assert not module._holding
        home.assert_not_called()
    finally:
        module.stop()


def test_openarm_y_hold_release_from_off_does_not_arm(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        home = mocker.patch.object(module.joint_command, "publish")
        pose = PoseStamped(frame_id="left", position=[0.0, 0.0, 0.0])
        module._current_poses[Hand.LEFT] = pose
        module._current_poses[Hand.RIGHT] = pose

        _press_y(module, True)
        assert not any(module._is_engaged.values())
        module._y_press_started_mono = time.monotonic() - 1.2
        _press_y(module, False)

        assert not any(module._is_engaged.values())
        assert not module._holding
        assert not module._homing
        home.assert_not_called()
    finally:
        module.stop()


def test_openarm_y_hold_release_early_stays_paused(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        home = mocker.patch.object(module.joint_command, "publish")
        pose = PoseStamped(frame_id="left", position=[0.0, 0.0, 0.0])
        module._current_poses[Hand.LEFT] = pose
        module._current_poses[Hand.RIGHT] = pose

        _press_y(module, True)
        _press_y(module, False)
        _press_y(module, True)
        assert module._holding
        module._y_press_started_mono = time.monotonic() - 0.4
        _press_y(module, False)

        assert module._holding
        assert not module._homing
        assert not any(module._is_engaged.values())
        home.assert_not_called()
    finally:
        module.stop()


def test_openarm_holding_x_and_a_does_not_engage(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        mocker.patch.object(module.joint_command, "publish")
        pose = PoseStamped(frame_id="left", position=[0.0, 0.0, 0.0])
        module._current_poses[Hand.LEFT] = pose
        module._current_poses[Hand.RIGHT] = pose
        module._controllers[Hand.LEFT] = QuestControllerState(is_left=True, primary=True)
        module._controllers[Hand.RIGHT] = QuestControllerState(is_left=False, primary=True)

        module._handle_engage()

        assert not module._homing
        assert not module._is_engaged[Hand.LEFT]
        assert not module._is_engaged[Hand.RIGHT]
    finally:
        module.stop()


def test_openarm_grippers_rest_slightly_open_and_pinch_to_close(
    mocker: MockerFixture,
) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        left_publish = mocker.patch.object(module.left_gripper_command, "publish")
        right_publish = mocker.patch.object(module.right_gripper_command, "publish")
        released = QuestControllerState(is_left=True, trigger=0.0)
        squeezed = QuestControllerState(is_left=False, trigger=1.0)
        half = QuestControllerState(is_left=False, trigger=0.5)

        module._publish_gripper_commands(released, released)
        left_publish.assert_not_called()
        right_publish.assert_not_called()

        module._is_engaged[Hand.LEFT] = True
        module._is_engaged[Hand.RIGHT] = True
        module._publish_gripper_commands(released, released)
        assert left_publish.call_args.args[0].data == pytest.approx(OPENARM_GRIPPER_REST_OPENING)
        assert right_publish.call_args.args[0].data == pytest.approx(OPENARM_GRIPPER_REST_OPENING)

        module._publish_gripper_commands(squeezed, squeezed)
        assert left_publish.call_args.args[0].data == pytest.approx(0.0)
        assert right_publish.call_args.args[0].data == pytest.approx(0.0)

        module._publish_gripper_commands(half, half)
        assert left_publish.call_args.args[0].data == pytest.approx(0.25)
        assert right_publish.call_args.args[0].data == pytest.approx(0.25)
    finally:
        module.stop()


def test_openarm_y_latch_survives_one_hand_timeout(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        mocker.patch.object(module.joint_command, "publish")
        pose = PoseStamped(frame_id="left", position=[0.0, 0.0, 0.0])
        now = 100.0
        module._is_engaged[Hand.LEFT] = True
        module._is_engaged[Hand.RIGHT] = True
        module._current_poses[Hand.LEFT] = pose
        module._current_poses[Hand.RIGHT] = pose
        module._controllers[Hand.LEFT] = QuestControllerState(is_left=True)
        module._controllers[Hand.RIGHT] = QuestControllerState(is_left=False)
        module._last_pose_update[Hand.LEFT] = now
        module._last_pose_update[Hand.RIGHT] = now
        module._last_controller_update[Hand.LEFT] = now - 5.0
        module._last_controller_update[Hand.RIGHT] = now

        module._expire_stale_state(now)

        assert module._is_engaged[Hand.LEFT]
        assert module._is_engaged[Hand.RIGHT]
        assert module._controllers[Hand.LEFT] is None
        assert module._controllers[Hand.RIGHT] is not None
    finally:
        module.stop()


def test_openarm_saved_takes_are_not_auto_listed_as_emotes(
    mocker: MockerFixture, tmp_path, monkeypatch
) -> None:
    from dimos.imitation.collection.episode_monitor import EpisodeStatus
    from dimos.teleop.quest import emote_store

    monkeypatch.setattr(emote_store, "DIMOS_PROJECT_ROOT", tmp_path)
    module = OpenArmQuestTeleopModule()
    try:
        mocker.patch.object(module, "_broadcast_text")
        module._latest_episode_status = EpisodeStatus(
            ts=1.0,
            state="idle",
            episodes_saved=4,
            episodes_discarded=1,
            last_event="save",
        )
        listed = module._emote_list()
        assert listed["recordings"] == []
        assert "no emotes" in listed["emote_status"]
    finally:
        module.stop()


def test_openarm_accept_emote_persists_and_plays(
    mocker: MockerFixture, tmp_path, monkeypatch
) -> None:
    from dimos.imitation.collection.episode_monitor import EpisodeStatus
    from dimos.teleop.quest import emote_store

    monkeypatch.setattr(emote_store, "DIMOS_PROJECT_ROOT", tmp_path)
    module = OpenArmQuestTeleopModule()
    try:
        mocker.patch.object(module, "_broadcast_text")
        play = mocker.patch.object(module.joint_command, "publish")
        rest = [0.0] * len(OPENARM_JOINTS)
        moved = list(rest)
        moved[3] = 0.4
        module._latest_episode_status = EpisodeStatus(
            ts=1.0,
            state="recording",
            episodes_saved=0,
            episodes_discarded=0,
            last_event="start",
        )
        module._recording_buffer = [(0.0, rest), (0.2, moved)]
        module._recording_t0 = 1.0
        module._on_episode_status(
            EpisodeStatus(
                ts=2.0,
                state="idle",
                episodes_saved=1,
                episodes_discarded=0,
                last_event="save",
            )
        )
        assert module._pending_emote is not None
        assert module._emote_list()["recordings"] == []

        accepted = module._accept_emote()
        assert accepted["ok"] is True
        assert accepted["recordings"]
        stored = tmp_path / "user_data" / "emotes"
        assert list(stored.glob("*.json"))

        played = module._play_emote({"id": accepted["recordings"][0]["id"]})
        assert played["ok"] is True
        play.assert_called()
        published = play.call_args.args[0]
        assert published.name == list(OPENARM_JOINTS)
        assert len(published.position) == len(OPENARM_JOINTS)
    finally:
        module.stop()


def test_openarm_client_connect_broadcasts_teleop_status_without_deadlock(
    mocker: MockerFixture,
) -> None:
    import json

    module = OpenArmQuestTeleopModule()
    try:
        broadcast = mocker.patch.object(module, "_broadcast_text")
        assert module._client_connected(mocker.MagicMock()) is True
        types = [json.loads(call.args[0])["type"] for call in broadcast.call_args_list]
        assert "teleop_status" in types
        payload = json.loads(broadcast.call_args.args[0])
        assert payload["armed"] is False
        assert payload["homing"] is False
        assert payload["holding"] is False
        with module._clients_lock:
            module._reset_controller_state()
    finally:
        module.stop()


def test_openarm_y_http_tap_and_reset_without_double_fire(mocker: MockerFixture) -> None:
    module = OpenArmQuestTeleopModule()
    try:
        home = mocker.patch.object(module.joint_command, "publish")
        mocker.patch.object(module, "_broadcast_text")
        pose = PoseStamped(frame_id="left", position=[0.0, 0.0, 0.0])
        module._current_poses[Hand.LEFT] = pose
        module._current_poses[Hand.RIGHT] = pose
        first = module._on_y_click({"action": "tap"})
        assert first["ok"] is True
        assert first["armed"] is True
        assert first["mock"] is False
        assert first["hardware"] == "openarm_damiao"
        assert first["holding"] is False
        assert first["homing"] is False
        home.assert_not_called()
        second = module._on_y_click({"action": "tap"})
        assert second["armed"] is True
        home.assert_not_called()
        module._y_tap_consumed = False
        paused = module._on_y_click({"action": "tap"})
        assert paused["holding"] is True
        assert paused["armed"] is False
        home.assert_not_called()
        reset = module._on_y_click({"action": "session_reset"})
        assert reset["homing"] is False
        assert reset["armed"] is False
        assert reset["holding"] is False
        assert reset["y_map"] == "tap_pause_hold3_kill"
        home.assert_not_called()
        again = module._on_y_click({"action": "session_reset"})
        assert again["homing"] is False
        assert again["holding"] is False
        home.assert_not_called()
        module._y_hold_consumed = False
        module._y_was_pressed = False
        module._controllers[Hand.LEFT] = QuestControllerState(is_left=True, secondary=True)
        module._handle_engage()
        assert not module._homing
        assert not module._holding
        home.assert_not_called()
    finally:
        module.stop()


def test_openarm_malformed_joy_keeps_y_latch(mocker: MockerFixture) -> None:
    from types import SimpleNamespace

    module = OpenArmQuestTeleopModule()
    try:
        mocker.patch.object(module.joint_command, "publish")
        module._is_engaged[Hand.LEFT] = True
        module._is_engaged[Hand.RIGHT] = True
        module._controllers[Hand.LEFT] = QuestControllerState(is_left=True, secondary=True)
        mocker.patch(
            "dimos.robot.manipulators.openarm.quest_teleop.Joy.lcm_decode",
            return_value=SimpleNamespace(frame_id="left", axes=[], buttons=[]),
        )
        assert module._on_joy_bytes(b"malformed") is False
        assert module._is_engaged[Hand.LEFT]
        assert module._is_engaged[Hand.RIGHT]
        assert module._controllers[Hand.LEFT] is not None
    finally:
        module.stop()


def test_quest_from_joy_pads_six_face_buttons() -> None:
    from types import SimpleNamespace

    from dimos.teleop.quest.quest_types import QuestControllerState

    joy = SimpleNamespace(
        axes=[0.0, 0.0, 0.1, 0.2],
        buttons=[0, 0, 0, 0, 0, 1],
    )
    parsed = QuestControllerState.from_joy(joy, is_left=True)
    assert parsed.secondary is True
    assert parsed.primary is False
    assert parsed.menu is False
