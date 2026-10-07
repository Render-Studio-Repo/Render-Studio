"""Exercise folder/list hooks without starting the application or calling Supabase."""
from __future__ import annotations

import ast
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import HTTPException


def hooks(**overrides):
    source = Path(__file__).resolve().parents[1] / "main.py"
    names = {"_personal_workspace_id", "_nest_shared_workspace_root_projects",
             "_private_project_summaries", "list_workspace_folders"}
    funcs = [n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in names]
    for node in funcs:
        node.decorator_list = []
        node.args.defaults = [ast.Constant(None) for _ in node.args.defaults]
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *funcs], type_ignores=[])
    env = {"HTTPException": HTTPException, **overrides}
    exec(compile(ast.fix_missing_locations(module), str(source), "exec"), env)
    return env


class WorkspaceLoadingTests(unittest.TestCase):
    def test_all_workspace_list_does_not_fetch_private_workspace_again(self):
        teams = SimpleNamespace(list_teams=Mock(side_effect=AssertionError("unnecessary request")))
        env = hooks(teams_service=teams)
        self.assertEqual(env["_private_project_summaries"]({"id": "u"}, None), [])

    def test_nesting_uses_one_fresh_team_list_and_keeps_personal_projects(self):
        rows = [{"id": "personal", "created_by": "u", "role": "owner", "member_count": 1},
                {"id": "shared", "created_by": "other", "role": "user", "member_count": 2, "name": "Team"}]
        service = SimpleNamespace(list_teams=Mock(return_value=rows))
        env = hooks(teams_service=service, _is_shared_workspace_folder_id=lambda v: False,
                    _shared_workspace_folder_id=lambda tid: f"shared:{tid}",
                    _shared_workspace_folder_name=lambda name: name)
        projects = [{"id": "p", "team_id": "personal"}, {"id": "s", "team_id": "shared"}]
        result = env["_nest_shared_workspace_root_projects"](projects, {"id": "u"})
        self.assertEqual(result[0], projects[0])
        self.assertEqual(result[1]["folder_id"], "shared:shared")
        service.list_teams.assert_called_once_with("u")

    def test_provided_empty_memberships_do_not_trigger_another_fetch(self):
        service = SimpleNamespace(list_teams=Mock(side_effect=AssertionError("unnecessary request")))
        env = hooks(teams_service=service)
        self.assertIsNone(env["_personal_workspace_id"]({"id": "u"}, teams=[]))

    def test_public_folder_count_needs_no_per_project_access_lookup(self):
        public = Mock(return_value=[{"id": "public1"}, {"id": "public2"}])
        folders = SimpleNamespace(list_folders=Mock(return_value=[{"id": "real", "can_manage": True}]))
        env = hooks(folders_service=folders, _public_project_summaries=public,
                    _public_folder_summary=lambda projects, tid: {"id": "public", "project_count": len(projects)},
                    _is_a1projects_admin=lambda user: False)
        env["_private_project_summaries"] = Mock(return_value=[])
        result = env["list_workspace_folders"]("team", {"id": "u"})
        folders.list_folders.assert_called_once_with("team", "u")
        public.assert_called_once_with()
        self.assertEqual(result["folders"][0]["can_manage"], True)
        self.assertEqual(result["folders"][1]["project_count"], 2)

    def test_folder_authorization_still_precedes_summaries(self):
        public = Mock(side_effect=AssertionError("must not read after denied access"))
        folders = SimpleNamespace(list_folders=Mock(side_effect=PermissionError("Not a member")))
        env = hooks(folders_service=folders, _public_project_summaries=public)
        with self.assertRaises(HTTPException) as error:
            env["list_workspace_folders"]("team", {"id": "outsider"})
        self.assertEqual(error.exception.status_code, 403)
        public.assert_not_called()


if __name__ == "__main__":
    unittest.main()
