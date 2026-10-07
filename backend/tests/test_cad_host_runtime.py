"""CAD host: Codex for ChatGPT/OpenAI, vendor HTTP for Claude-class keys."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from backend.services.cad_host_runtime import (
    choose_cad_host,
    choose_mac_runtime,
    choose_mesh_runtime,
    choose_vibecad_runtime,
    jake_agent_flags,
)
from backend.services.codex_agent import resolve_codex_cli_model
from backend.services.vibecad_codex import choose_vibecad_runtime as vibe_choose


class HostChooserTests(unittest.TestCase):
    def test_cad_runtime_provenance_reports_resolved_subprocess_packages(self) -> None:
        from unittest.mock import patch

        from backend.services import skill_runner

        payload = (
            '{"python_executable":"/cad/python","python_version":"3.12.13",'
            '"build123d_version":"0.11.1","ocp_version":"7.9.3.1.1",'
            '"occt_version":"7.9.3.1","cadgen_version":"0.7.15"}'
        )
        skill_runner._cad_runtime_provenance.cache_clear()
        self.addCleanup(skill_runner._cad_runtime_provenance.cache_clear)
        with patch.object(skill_runner, "resolve_cad_python", return_value="/cad/python"), patch.object(
            skill_runner.subprocess, "check_output", return_value=payload
        ):
            actual = skill_runner.cad_runtime_provenance()
        self.assertEqual(actual, {
            "python_executable": "/cad/python",
            "python_version": "3.12.13",
            "build123d_version": "0.11.1",
            "ocp_version": "7.9.3.1.1",
            "occt_version": "7.9.3.1",
            "cadgen_version": "0.7.15",
        })

    def test_selected_openai_key_reaches_codex_exec_auth(self) -> None:
        from pathlib import Path
        from unittest.mock import patch
        from backend.services.cad_host_runtime import resolve_codex_launch

        ai = SimpleNamespace(provider="openai", api_key="fake-selected-key", model="gpt-5.6-sol", reasoning_effort="high")
        with patch("backend.services.codex_agent.resolve_codex_bin", return_value="codex"), \
             patch("backend.services.cad_host_runtime._chatgpt_home", return_value=None), \
             patch("backend.services.cad_host_runtime._api_key_home", return_value=Path("/tmp/api-home")):
            launch = resolve_codex_launch(ai, user_id="recipient")
        self.assertEqual(launch.env.get("CODEX_API_KEY"), "fake-selected-key")
        self.assertEqual(launch.auth_label, "openai_api")
        self.assertIn('model_reasoning_effort="high"', launch.extra_cli)

    def test_chatgpt_and_openai_default_to_codex_host(self) -> None:
        for ai in (
            SimpleNamespace(billing_source="chatgpt_subscription", model="gpt-5.6-sol", provider="openai"),
            SimpleNamespace(billing_source="chatgpt_subscription", model="gpt-6-astra", provider="openai"),
            SimpleNamespace(billing_source="byok", model="gpt-5.6-sol", provider="openai", api_key="sk-test"),
        ):
            self.assertEqual(choose_cad_host({}, ai), "codex_host")
            self.assertEqual(choose_vibecad_runtime({}, ai), "codex_host")
            self.assertEqual(vibe_choose({}, ai), "codex_host")
            self.assertEqual(choose_mac_runtime({}, ai), "codex_host")
            self.assertEqual(choose_mesh_runtime({}, ai), "codex_host")
            self.assertEqual(jake_agent_flags({}, ai, jake_identical=True), (True, False))

    def test_claude_uses_vendor_http_like_vibecad(self) -> None:
        ai = SimpleNamespace(
            billing_source="byok",
            model="claude-sonnet-4-5",
            provider="anthropic",
            api_key="sk-ant",
        )
        self.assertEqual(choose_cad_host({}, ai), "http")
        self.assertEqual(choose_vibecad_runtime({}, ai), "oneshot")
        self.assertEqual(vibe_choose({}, ai), "oneshot")
        self.assertEqual(choose_mac_runtime({}, ai), "http")
        self.assertEqual(choose_mesh_runtime({}, ai), "http")
        self.assertEqual(jake_agent_flags({}, ai, jake_identical=True), (False, False))

    def test_cursor_and_claude_subscriptions_use_cli_host(self) -> None:
        cursor = SimpleNamespace(
            billing_source="cursor_subscription",
            model="auto",
            provider="cursor",
            api_key="",
        )
        claude = SimpleNamespace(
            billing_source="claude_subscription",
            model="claude-opus-4-8",
            provider="anthropic",
            api_key="",
        )
        for ai in (cursor, claude):
            self.assertEqual(choose_cad_host({}, ai), "codex_host")
            self.assertEqual(choose_vibecad_runtime({}, ai), "codex_host")
            self.assertEqual(vibe_choose({}, ai), "codex_host")
            self.assertEqual(choose_mac_runtime({}, ai), "codex_host")
            self.assertEqual(choose_mesh_runtime({}, ai), "codex_host")
            self.assertEqual(jake_agent_flags({}, ai, jake_identical=True), (True, False))

    def test_debug_overrides_are_harness_local(self) -> None:
        ai = SimpleNamespace(billing_source="byok", model="gpt-5.6-sol", provider="openai")
        self.assertEqual(choose_vibecad_runtime({"vibecad_oneshot": True}, ai), "oneshot")
        self.assertEqual(choose_vibecad_runtime({"vibecad_agent": True}, ai), "agent")
        self.assertEqual(choose_mac_runtime({"vibecad_agent": True}, ai), "codex_host")
        self.assertEqual(choose_mesh_runtime({"vibecad_oneshot": True}, ai), "codex_host")
        self.assertEqual(jake_agent_flags({"vibecad_agent": True}, ai, jake_identical=True), (True, False))
        self.assertEqual(jake_agent_flags({"jake_force_tool_agent": True}, ai, jake_identical=True), (False, True))
        self.assertEqual(choose_mac_runtime({"mac_langgraph": True}, ai), "langgraph")
        self.assertEqual(choose_mesh_runtime({"mesh_llm_loop": True}, ai), "llm_loop")

    def test_sol_api_key_is_a_codex_cli_model(self) -> None:
        self.assertEqual(
            resolve_codex_cli_model("gpt-5.6-sol", api_key_auth=True),
            "gpt-5.6-sol",
        )

    def test_chatgpt_gpt61_sol_stays_selected(self) -> None:
        from pathlib import Path
        from unittest.mock import patch

        with patch("backend.services.codex_agent._codex_auth_mode", return_value="chatgpt"):
            self.assertEqual(
                resolve_codex_cli_model("gpt-6.1-sol", home=Path("/tmp/codex-home")),
                "gpt-6.1-sol",
            )

    def test_chatgpt_sol_maps_to_astra(self) -> None:
        from pathlib import Path
        from unittest.mock import patch

        with patch("backend.services.codex_agent._codex_auth_mode", return_value="chatgpt"):
            self.assertEqual(
                resolve_codex_cli_model("gpt-5.6-sol", home=Path("/tmp/codex-home")),
                "gpt-6-astra",
            )

    def test_shared_chatgpt_launch_uses_owner_home_not_requester(self) -> None:
        from pathlib import Path
        from unittest.mock import patch

        from backend.services.cad_host_runtime import resolve_codex_launch

        owner_home = Path("/tmp/codex-owner")
        ai = SimpleNamespace(
            billing_source="chatgpt_subscription",
            billing_user_id="owner-sam",
            model="gpt-6-astra",
            provider="openai",
            api_key="",
        )

        def fake_home(uid: str | None) -> Path | None:
            return owner_home if uid == "owner-sam" else None

        with (
            patch("backend.services.codex_agent.resolve_codex_bin", return_value="/usr/bin/codex"),
            patch("backend.services.codex_agent.resolve_codex_cli_model", return_value="gpt-6-astra"),
            patch("backend.services.codex_agent._trust_project_in_codex_config"),
            patch("backend.services.cad_host_runtime._chatgpt_home", side_effect=fake_home),
        ):
            launch = resolve_codex_launch(ai, user_id="requester-mojtaba", project_path=Path("/tmp/proj"))
        self.assertEqual(launch.home, owner_home)
        self.assertEqual(launch.auth_label, "chatgpt")


if __name__ == "__main__":
    unittest.main()
