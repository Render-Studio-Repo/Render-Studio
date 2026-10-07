# Copyright 2026 Dimensional Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/License-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""OpenArm Quest teleop: Y tap pause/resume, hold-Y 3s session kill."""

from __future__ import annotations

import json
import threading
import time
from typing import Any

from fastapi import WebSocket

from dimos.core.core import rpc
from dimos.core.stream import In, Out
from dimos.imitation.collection.episode_monitor import EpisodeStatus
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.JointState import JointState
from dimos.msgs.sensor_msgs.Joy import Joy
from dimos.msgs.std_msgs.Float32 import Float32
from dimos.robot.manipulators.openarm.config import (
    OPENARM_ARM_JOINTS,
    OPENARM_GRIPPER_REST_OPENING,
    OPENARM_JOINTS,
    OPENARM_Y_HOME_ARM_JOINTS,
)
from dimos.teleop.quest.emote_store import list_emotes, load_emote, new_emote_id, save_emote
from dimos.teleop.quest.quest_extensions import ArmTeleopModule
from dimos.teleop.quest.quest_types import Hand, QuestControllerState
from dimos.teleop.utils.teleop_transforms import webxr_to_openarm
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

_HOME_TOLERANCE_RAD = 0.12
_HOME_SETTLE_S = 0.5
_HOME_FALLBACK_S = 20.0
_Y_BOUNCE_GUARD_S = 0.45
_Y_TAP_MAX_S = 0.35
_Y_HOLD_S = 3.0
_Y_HTTP_DEDUP_S = 0.4
_Y_RESET_ACTIONS = frozenset({"reset", "home", "hold", "kill", "session_reset"})
_Y_MAP = "tap_pause_hold3_kill"
_ROBOTICS_SERVICE_VERSION = "1.0.4"


class OpenArmQuestTeleopModule(ArmTeleopModule):
    """Y tap pauses or re-arms; hold Y 3s kills the session (fresh next Y).

    Short Y while following holds the current MIT/gravity pose (original
    DimOS X+A release): stop IK/follow, keep motors enabled in place.
    Short Y from HOLD resumes follow from the current pose with no slam.
    Short Y from OFF starts follow / calibrate like a new session.
    Hold Y (>=3s) tears the session down in place — no Dora all-zero slam.
    Release before 3s cancels the kill and stays HOLD if pause had started.
    """

    coordinator_joint_state: In[JointState]
    joint_command: Out[JointState]

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._y_was_pressed = False
        self._y_press_started_mono = 0.0
        self._y_tap_consumed = False
        self._y_hold_consumed = False
        self._holding = False
        self._homing = False
        self._pending_arm = False
        self._home_started_mono = 0.0
        self._home_in_tolerance_since = 0.0
        self._home_reached = False
        self._home_safe_hold = False
        self._home_failure = ""
        self._home_max_error_rad: float | None = None
        self._home_feedback_joint_count = 0
        self._home_feedback_joints: set[str] = set()
        self._session_reset_mono = 0.0
        self._last_y_click_mono = 0.0
        self._latest_arm_positions: dict[str, float] = {}
        self._home_awaiting_feedback = False
        self._missing_home_joints_logged = False
        self._arm_wait_missing: tuple[str, ...] = ()
        self._recording_buffer: list[tuple[float, list[float]]] = []
        self._recording_t0: float | None = None
        self._pending_emote: dict[str, Any] | None = None
        self._playing_emote = False
        self._emote_done_mono = 0.0
        self._emote_status = ""
        self._logged_left_joy = False

    @rpc
    def start(self) -> None:
        super().start()

    def _client_connected(self, ws: WebSocket) -> bool:
        connected = super()._client_connected(ws)
        if connected:
            self._broadcast_teleop_status()
        return connected

    def _reset_controller_state(self) -> None:
        super()._reset_controller_state()
        with self._lock:
            self._y_was_pressed = False
            self._y_press_started_mono = 0.0
            self._y_tap_consumed = False
            self._y_hold_consumed = False
            self._holding = False
            self._homing = False
            self._pending_arm = False
            self._home_awaiting_feedback = False
            self._clear_home_result_locked()
            self._playing_emote = False
            self._arm_wait_missing = ()
            self._logged_left_joy = False
            self._last_y_click_mono = 0.0
            self._session_reset_mono = 0.0
        # Do not broadcast here: connect/disconnect hold `_clients_lock`, and
        # `_broadcast_text` needs that same lock. OpenArm connect broadcasts
        # after the lock is released.

    def _on_pose_bytes(self, data: bytes) -> None:
        msg = PoseStamped.lcm_decode(data)
        hand = self._resolve_hand(msg.frame_id)
        robot_pose = webxr_to_openarm(msg)
        with self._lock:
            self._current_poses[hand] = robot_pose
            self._last_pose_update[hand] = time.monotonic()

    def _expire_stale_state(self, now: float) -> None:
        """Drop stale poses/Joy, but keep the Y latch until both hands are gone.

        The base module clears ``_is_engaged`` per-hand on a 1s dropout. That
        silently unarmed follow after a successful Y-home.
        """
        input_expired = False
        alive = {Hand.LEFT: False, Hand.RIGHT: False}
        for hand in Hand:
            pose_update = self._last_pose_update[hand]
            controller_update = self._last_controller_update[hand]
            pose_stale = pose_update is None or now - pose_update > self.config.input_timeout_s
            controller_stale = (
                controller_update is None or now - controller_update > self.config.input_timeout_s
            )
            input_expired |= (pose_stale and pose_update is not None) or (
                controller_stale and controller_update is not None
            )
            if pose_stale:
                self._current_poses[hand] = None
                self._last_pose_update[hand] = None
            if controller_stale:
                self._controllers[hand] = None
                self._last_controller_update[hand] = None
            alive[hand] = not pose_stale or not controller_stale
        if input_expired:
            self._publish_safe_command()
        latched = self._homing or self._pending_arm or any(self._is_engaged.values())
        if latched and not alive[Hand.LEFT] and not alive[Hand.RIGHT]:
            was_following = any(self._is_engaged.values())
            self._homing = False
            self._pending_arm = False
            self._home_awaiting_feedback = False
            self._disengage()
            if was_following:
                self._holding = True
            logger.info("OpenArm teleop dropped (both controllers lost)")
            self._broadcast_teleop_status()

    def _on_joy_bytes(self, data: bytes) -> bool:
        """Keep the Y latch if a Joy packet is short or malformed."""
        msg = Joy.lcm_decode(data)
        hand = self._resolve_hand(msg.frame_id)
        try:
            controller = QuestControllerState.from_joy(msg, is_left=(hand == Hand.LEFT))
        except ValueError:
            logger.warning(
                "Malformed Joy for %s: axes=%d, buttons=%d — keeping Y latch",
                hand.name,
                len(msg.axes or []),
                len(msg.buttons or []),
            )
            return False
        with self._lock:
            self._controllers[hand] = controller
            self._last_controller_update[hand] = time.monotonic()
            if hand == Hand.LEFT and not self._logged_left_joy:
                logger.info(
                    "OpenArm left Joy buttons=%s primary=%s left_secondary=%s",
                    list(msg.buttons or []),
                    controller.primary,
                    controller.secondary,
                )
                self._logged_left_joy = True
        return True

    def _cancel_emote_locked(self) -> None:
        if not self._playing_emote:
            return
        self._playing_emote = False
        self._emote_status = "playback cancelled"
        logger.info("OpenArm emote playback cancelled (Y)")
        self._broadcast_teleop_status()

    def _apply_y_tap_locked(self) -> None:
        now = time.monotonic()
        logger.info(
            "OpenArm Y tap homing=%s pending=%s engaged=%s holding=%s playing=%s",
            self._homing,
            self._pending_arm,
            dict(self._is_engaged),
            self._holding,
            self._playing_emote,
        )
        if self._playing_emote:
            self._last_y_click_mono = now
            self._cancel_emote_locked()
            return
        if self._homing:
            logger.info("OpenArm Y tap ignored while homing")
            return
        if any(self._is_engaged.values()):
            self._last_y_click_mono = now
            self._pending_arm = False
            self._disengage()
            self._holding = True
            logger.info("OpenArm teleop paused (Y tap) — holding pose")
            self._broadcast_teleop_status()
            return
        self._last_y_click_mono = now
        self._holding = False
        self._pending_arm = True
        logger.info("OpenArm Y tap: arm follow from current pose")
        self._broadcast_teleop_status()
        self._try_arm_locked()

    def _apply_y_reset_locked(self) -> None:
        now = time.monotonic()
        logger.info(
            "OpenArm Y hold-kill homing=%s pending=%s engaged=%s holding=%s playing=%s",
            self._homing,
            self._pending_arm,
            dict(self._is_engaged),
            self._holding,
            self._playing_emote,
        )
        if self._playing_emote:
            self._cancel_emote_locked()
        if self._session_reset_mono and now - self._session_reset_mono < _Y_BOUNCE_GUARD_S:
            logger.info("OpenArm Y bounce ignored during session reset")
            return
        self._last_y_click_mono = now
        self._session_reset_mono = now
        self._session_kill_locked()

    def _on_y_click(self, body: dict[str, Any] | None = None) -> dict[str, Any]:
        action = str((body or {}).get("action") or "tap").strip().lower()
        with self._lock:
            now = time.monotonic()
            if action in _Y_RESET_ACTIONS:
                if self._y_hold_consumed and now - self._last_y_click_mono < _Y_HTTP_DEDUP_S:
                    return {"ok": True, **self._teleop_status_payload()}
                self._apply_y_reset_locked()
                self._y_hold_consumed = True
                self._y_tap_consumed = True
                self._y_was_pressed = True
                return {"ok": True, **self._teleop_status_payload()}
            if (
                (self._y_tap_consumed or self._y_hold_consumed)
                and now - self._last_y_click_mono < _Y_HTTP_DEDUP_S
            ):
                return {"ok": True, **self._teleop_status_payload()}
            self._apply_y_tap_locked()
            self._y_tap_consumed = True
            self._y_was_pressed = True
            return {"ok": True, **self._teleop_status_payload()}

    def _on_calibrate(self, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Align controller origins to the current arm pose; never zero encoders."""
        body = body or {}
        if body.get("require_stationary") is not True:
            return {"ok": False, "error": "require_stationary=true is required"}
        with self._lock:
            if self._homing or self._playing_emote:
                return {"ok": False, "error": "robot is busy"}
            missing = [hand.name.lower() for hand in Hand if self._current_poses.get(hand) is None]
            if missing:
                return {"ok": False, "error": f"fresh controller poses required: {', '.join(missing)}"}
            self._session_kill_locked()
            self._pending_arm = True
            self._try_arm_locked()
            if not all(self._is_engaged.values()):
                return {"ok": False, "error": "controller-to-arm alignment did not engage"}
            logger.info("OpenArm API calibration: controller origins aligned to current pose")
            return {"ok": True, "calibration": "controller_origin", **self._teleop_status_payload()}

    def _on_home(self, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Start the existing feedback-checked full-arm arms-down trajectory."""
        body = body or {}
        if body.get("require_clear") is not True:
            return {"ok": False, "error": "require_clear=true is required"}
        if body.get("pose", "arms_down") not in {"arms_down", "home"}:
            return {"ok": False, "error": "only the arms_down home pose is supported"}
        if body.get("orientation", "canonical") != "canonical":
            return {"ok": False, "error": "only canonical orientation is supported"}
        with self._lock:
            missing = [name for name in OPENARM_JOINTS if name not in self._latest_arm_positions]
            if missing:
                return {"ok": False, "error": f"fresh joint feedback required; missing {missing[:4]}"}
            if self._playing_emote:
                self._cancel_emote_locked()
            self._session_kill_locked()
            self._start_home_locked(time.monotonic())
            return {"ok": True, "pose": "arms_down", **self._teleop_status_payload()}

    def _handle_engage(self) -> None:
        left = self._controllers.get(Hand.LEFT)
        y_pressed = left is not None and bool(left.secondary)
        now = time.monotonic()
        if y_pressed and not self._y_was_pressed:
            self._y_press_started_mono = now
            self._y_tap_consumed = False
            self._y_hold_consumed = False
            if any(self._is_engaged.values()):
                self._apply_y_tap_locked()
                self._y_tap_consumed = True
        elif y_pressed and not self._y_hold_consumed:
            if now - self._y_press_started_mono >= _Y_HOLD_S:
                self._apply_y_reset_locked()
                self._y_hold_consumed = True
                self._y_tap_consumed = True
        elif not y_pressed and self._y_was_pressed and not self._y_hold_consumed:
            held = now - self._y_press_started_mono
            if not self._y_tap_consumed and held < _Y_TAP_MAX_S:
                self._apply_y_tap_locked()
            self._y_tap_consumed = True
        self._y_was_pressed = y_pressed

        if self._playing_emote and now >= self._emote_done_mono:
            self._playing_emote = False
            self._emote_status = "playback done"
            logger.info("OpenArm emote playback finished")
            self._broadcast_teleop_status()

        if self._homing and now - self._home_started_mono >= _HOME_FALLBACK_S:
            self._fail_home_locked(f"timed out after {_HOME_FALLBACK_S:.1f}s")
        if self._pending_arm:
            self._try_arm_locked()

    def _session_kill_locked(self) -> None:
        """Stop follow and drop session state so the next Y is a fresh calibrate.

        Does not slam joints to the Dora all-zero home. Motors stay in the last
        MIT/gravity hold from disengage; leftover follow origin and HOLD clear.
        """
        self._disengage()
        self._holding = False
        self._homing = False
        self._pending_arm = False
        self._home_awaiting_feedback = False
        self._playing_emote = False
        for hand in Hand:
            self._initial_poses[hand] = None
        self._publish_safe_command()
        logger.info("OpenArm Y-kill: session reset — next Y is a fresh calibrate")
        self._broadcast_teleop_status()

    def _start_home_locked(self, now: float) -> None:
        self._disengage()
        self._holding = False
        self._homing = True
        self._pending_arm = False
        self._home_awaiting_feedback = True
        self._home_started_mono = now
        self._home_in_tolerance_since = 0.0
        self._clear_home_result_locked()
        self._missing_home_joints_logged = False
        logger.info("OpenArm Y-home: slow full-arm reset (wrists + grippers)")
        self._broadcast_teleop_status()
        self.joint_command.publish(
            JointState(
                name=list(OPENARM_JOINTS),
                position=[
                    *OPENARM_Y_HOME_ARM_JOINTS,
                    OPENARM_GRIPPER_REST_OPENING,
                    OPENARM_GRIPPER_REST_OPENING,
                ],
            )
        )

    def _clear_home_result_locked(self) -> None:
        self._home_reached = False
        self._home_safe_hold = False
        self._home_failure = ""
        self._home_max_error_rad = None
        self._home_feedback_joint_count = 0
        self._home_feedback_joints.clear()

    def _finish_home_locked(self, error: float, feedback_joint_count: int) -> None:
        self._homing = False
        self._home_awaiting_feedback = False
        self._pending_arm = False
        self._holding = True
        self._home_reached = True
        self._home_safe_hold = True
        self._home_failure = ""
        self._home_max_error_rad = error
        self._home_feedback_joint_count = feedback_joint_count
        logger.info(
            "OpenArm Y-home reached and holding; error=%.3f rad feedback=%d/%d",
            error,
            feedback_joint_count,
            len(OPENARM_JOINTS),
        )
        self._broadcast_teleop_status()

    def _fail_home_locked(self, reason: str) -> None:
        self._homing = False
        self._home_awaiting_feedback = False
        self._pending_arm = False
        self._holding = True
        self._home_reached = False
        self._home_safe_hold = False
        self._home_failure = reason
        logger.warning("OpenArm Y-home failed; holding current actuator targets: %s", reason)
        self._broadcast_teleop_status()

    def _try_arm_locked(self) -> None:
        if not self._pending_arm:
            return
        missing = tuple(hand.name.lower() for hand in Hand if self._current_poses.get(hand) is None)
        if missing:
            if missing != self._arm_wait_missing:
                logger.info("OpenArm Y-arm waiting for %s pose", "+".join(missing))
                self._arm_wait_missing = missing
            return
        self._arm_wait_missing = ()
        if not self._engage():
            return
        self._pending_arm = False
        self._holding = False
        logger.info("OpenArm teleop armed from current pose")
        self._broadcast_teleop_status()

    def _home_error(self) -> tuple[float, int]:
        target_positions = [
            *OPENARM_Y_HOME_ARM_JOINTS,
            OPENARM_GRIPPER_REST_OPENING,
            OPENARM_GRIPPER_REST_OPENING,
        ]
        feedback_joint_count = len(self._home_feedback_joints)
        if feedback_joint_count < len(OPENARM_JOINTS):
            if not self._missing_home_joints_logged:
                missing = [name for name in OPENARM_JOINTS if name not in self._home_feedback_joints]
                logger.warning(
                    "OpenArm Y-home missing joint feedback (%d/%d): %s",
                    feedback_joint_count,
                    len(OPENARM_JOINTS),
                    missing[:8],
                )
                self._missing_home_joints_logged = True
            return float("inf"), feedback_joint_count
        return max(
            abs(self._latest_arm_positions[name] - target)
            for name, target in zip(OPENARM_JOINTS, target_positions, strict=True)
        ), feedback_joint_count

    async def handle_coordinator_joint_state(self, msg: JointState) -> None:
        names = list(msg.name or [])
        positions = list(msg.position or [])
        if len(names) != len(positions):
            return
        named = {name: float(position) for name, position in zip(names, positions, strict=True)}
        with self._lock:
            for name, position in named.items():
                if name in OPENARM_ARM_JOINTS or name in OPENARM_JOINTS:
                    self._latest_arm_positions[name] = position
            recording = (
                self._latest_episode_status is not None
                and self._latest_episode_status.state == "recording"
            )
            if recording:
                packed: list[float] = []
                missing = False
                for name in OPENARM_JOINTS:
                    value = named.get(name)
                    if value is None:
                        missing = True
                        break
                    packed.append(value)
                if not missing:
                    now = time.monotonic()
                    if self._recording_t0 is None:
                        self._recording_t0 = now
                    self._recording_buffer.append((now - self._recording_t0, packed))
            if not self._homing:
                return
            if self._home_awaiting_feedback:
                # Skip the in-flight sample from before the reset command.
                self._home_awaiting_feedback = False
                self._home_feedback_joints.clear()
                logger.info("OpenArm Y-home: first joint_state after command, waiting for hang")
                return
            self._home_feedback_joints.update(name for name in named if name in OPENARM_JOINTS)
            if time.monotonic() - self._home_started_mono >= _HOME_FALLBACK_S:
                self._fail_home_locked(f"timed out after {_HOME_FALLBACK_S:.1f}s")
                return
            error, feedback_joint_count = self._home_error()
            self._home_max_error_rad = error if error != float("inf") else None
            self._home_feedback_joint_count = feedback_joint_count
            if error <= _HOME_TOLERANCE_RAD:
                now = time.monotonic()
                if self._home_in_tolerance_since == 0.0:
                    self._home_in_tolerance_since = now
                    logger.info(
                        "OpenArm Y-home in tolerance; settling %.1fs before verification",
                        _HOME_SETTLE_S,
                    )
                elif now - self._home_in_tolerance_since >= _HOME_SETTLE_S:
                    self._finish_home_locked(error, feedback_joint_count)
            else:
                self._home_in_tolerance_since = 0.0

    def _on_episode_status(self, status: EpisodeStatus) -> None:
        pending_payload: dict[str, Any] | None = None
        with self._lock:
            if status.last_event == "start" and status.state == "recording":
                self._recording_buffer = []
                self._recording_t0 = None
                self._pending_emote = None
            elif status.last_event == "discard":
                self._recording_buffer = []
                self._recording_t0 = None
                self._pending_emote = None
            elif status.last_event == "save":
                buffer = list(self._recording_buffer)
                self._recording_buffer = []
                self._recording_t0 = None
                if buffer:
                    take_name = f"Take {status.episodes_saved:03d}"
                    self._pending_emote = {
                        "id": new_emote_id(),
                        "name": take_name,
                        "joint_names": list(OPENARM_JOINTS),
                        "times": [sample[0] for sample in buffer],
                        "positions": [sample[1] for sample in buffer],
                    }
                    pending_payload = {
                        "type": "emote_confirm",
                        "id": self._pending_emote["id"],
                        "name": take_name,
                        "samples": len(buffer),
                    }
                    logger.info(
                        "OpenArm take saved; waiting for emote confirm (%s, %d samples)",
                        take_name,
                        len(buffer),
                    )
                else:
                    self._pending_emote = None
                    logger.info("OpenArm take saved with no joint samples; skipping emote prompt")
        super()._on_episode_status(status)
        if pending_payload is not None:
            self._broadcast_text(json.dumps(pending_payload, separators=(",", ":")))

    def _emote_list(self) -> dict[str, Any]:
        recordings = list_emotes()
        status = self._emote_status
        if not status:
            status = "" if recordings else "no emotes yet — save a take and accept"
        return {
            "recordings": recordings,
            "loops": [],
            "emote_status": status,
        }

    def _accept_emote(self, body: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            pending = self._pending_emote
            self._pending_emote = None
        if pending is None:
            return {"ok": False, "emote_status": "no pending take"}
        destination = body or {}
        folder_id = str(destination.get("folder_id") or "emotes").strip()[:64] or "emotes"
        folder_name = str(destination.get("folder_name") or ("Emotes" if folder_id == "emotes" else folder_id)).strip()[:64]
        pending["folder_id"] = folder_id
        pending["folder_name"] = folder_name
        saved = save_emote(pending)
        self._emote_status = f"saved {saved['name']} to {folder_name}"
        logger.info("OpenArm recording accepted %s (%s) in %s", saved["id"], saved["name"], folder_id)
        return {"ok": True, "emote_status": self._emote_status, **self._emote_list()}

    def _reject_emote(self) -> dict[str, Any]:
        with self._lock:
            pending = self._pending_emote
            self._pending_emote = None
        if pending is None:
            return {"ok": False, "emote_status": "no pending take"}
        self._emote_status = "take kept, not an emote"
        logger.info("OpenArm emote discarded for %s", pending.get("name"))
        return {"ok": True, "emote_status": self._emote_status, **self._emote_list()}

    def _play_emote(self, body: dict[str, Any]) -> dict[str, Any]:
        emote_id = str(body.get("id") or "")
        emote = load_emote(emote_id)
        if emote is None:
            self._emote_status = "emote not found"
            return {"ok": False, "emote_status": self._emote_status, **self._emote_list()}
        frames = self._emote_frames(emote)
        if not frames:
            self._emote_status = "emote has no motion"
            return {"ok": False, "emote_status": self._emote_status, **self._emote_list()}
        names, timed = frames
        duration = timed[-1][0]
        with self._lock:
            self._homing = False
            self._pending_arm = False
            self._home_awaiting_feedback = False
            self._holding = False
            self._disengage()
            self._playing_emote = True
            self._emote_done_mono = time.monotonic() + max(0.4, duration + 0.25)
        self._emote_status = f"playing {emote.get('name') or emote_id}"
        logger.info(
            "OpenArm emote play %s (%s) duration=%.2fs points=%d",
            emote_id,
            emote.get("name"),
            duration,
            len(timed),
        )
        self.joint_command.publish(JointState(name=names, position=timed[0][1]))
        threading.Thread(
            target=self._run_emote_playback,
            args=(names, timed),
            daemon=True,
            name="OpenArmEmotePlayback",
        ).start()
        self._broadcast_teleop_status()
        return {"ok": True, "emote_status": self._emote_status, **self._emote_list()}

    def _emote_frames(
        self, emote: dict[str, Any]
    ) -> tuple[list[str], list[tuple[float, list[float]]]] | None:
        names = [str(name) for name in emote.get("joint_names") or list(OPENARM_JOINTS)]
        times = [float(value) for value in emote.get("times") or []]
        positions = list(emote.get("positions") or [])
        if not names or not positions:
            return None
        width = len(names)
        timed: list[tuple[float, list[float]]] = []
        previous_t = -1.0
        for index, row in enumerate(positions):
            if not isinstance(row, list) or len(row) != width:
                continue
            t = times[index] if index < len(times) else index / 50.0
            t = max(0.0, float(t))
            if t <= previous_t:
                t = previous_t + 0.02
            timed.append((t, [float(value) for value in row]))
            previous_t = t
        if not timed:
            return None
        return names, timed

    def _run_emote_playback(
        self, names: list[str], timed: list[tuple[float, list[float]]]
    ) -> None:
        t0 = time.monotonic()
        try:
            for t, positions in timed[1:]:
                delay = t - (time.monotonic() - t0)
                if delay > 0 and self._stop_event.wait(delay):
                    return
                with self._lock:
                    if not self._playing_emote:
                        return
                self.joint_command.publish(JointState(name=names, position=positions))
        finally:
            with self._lock:
                self._playing_emote = False
            self._emote_status = "playback done"
            logger.info("OpenArm emote playback finished")
            self._broadcast_teleop_status()

    def _teleop_status_payload(self) -> dict[str, Any]:
        calibrated = all(name in self._latest_arm_positions for name in OPENARM_ARM_JOINTS)
        return {
            "type": "teleop_status",
            "version": _ROBOTICS_SERVICE_VERSION,
            "service_version": _ROBOTICS_SERVICE_VERSION,
            "capabilities": ["guarded_home"],
            "guarded_home": True,
            "home_supported": True,
            "calibrated": calibrated,
            "armed": all(self._is_engaged.values()),
            "holding": self._holding and not any(self._is_engaged.values()),
            "homing": self._homing,
            "pending_arm": self._pending_arm,
            "playing": self._playing_emote,
            "home_reached": self._home_reached,
            "home_safe_hold": self._home_safe_hold,
            "home_failure": self._home_failure,
            "home_max_error_rad": self._home_max_error_rad,
            "home_target_joint_count": len(OPENARM_JOINTS),
            "home_feedback_joint_count": self._home_feedback_joint_count,
            "y_map": _Y_MAP,
            "mock": False,
            "hardware": "openarm_damiao",
            "json_control": True,
        }

    def _ws_hello_payload(self) -> dict[str, Any]:
        with self._lock:
            payload = dict(self._teleop_status_payload())
        payload["type"] = "hello"
        payload["ok"] = True
        return payload

    def _broadcast_teleop_status(self) -> None:
        self._broadcast_text(json.dumps(self._teleop_status_payload(), separators=(",", ":")))

    def _gripper_opening(
        self, hand: Hand, controller: QuestControllerState | None
    ) -> float:
        """Dora-style pinch-to-close from a half-open rest, both hands."""
        if controller is None or not self._is_engaged[hand]:
            return OPENARM_GRIPPER_REST_OPENING
        trigger = min(1.0, max(0.0, float(controller.trigger)))
        return OPENARM_GRIPPER_REST_OPENING * (1.0 - trigger)

    def _publish_gripper_commands(
        self,
        left: QuestControllerState | None,
        right: QuestControllerState | None,
    ) -> None:
        """Pinch-to-close after Y-arm; hold pose on pause until follow or kill."""
        if self._homing or self._playing_emote or not any(self._is_engaged.values()):
            return
        self.left_gripper_command.publish(Float32(data=self._gripper_opening(Hand.LEFT, left)))
        self.right_gripper_command.publish(Float32(data=self._gripper_opening(Hand.RIGHT, right)))
