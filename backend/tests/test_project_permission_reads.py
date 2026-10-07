"""Project-open permissions are reused only within a single read response."""
from __future__ import annotations

import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from backend.services import supabase_workspace_store as ws, teams_service


class ProjectPermissionReadTests(unittest.TestCase):
    def test_read_and_edit_share_two_fresh_queries(self):
        def select(table, **filters):
            if table == ws.ACCESS:
                return [{"project_id": "p", "team_id": "t"}]
            return [{"role": "user", "access": "view"}]

        with patch.object(ws, "_select", side_effect=select) as fetch, patch.object(teams_service, "_ws_live", return_value=True):
            with ws.permission_read_scope():
                self.assertTrue(teams_service.can_access_project("u", "p"))
                self.assertFalse(teams_service.can_edit_project("u", "p"))
            self.assertEqual(fetch.call_count, 2)
            # Nothing survives the response, including a previously granted read.
            with ws.permission_read_scope():
                self.assertTrue(teams_service.can_access_project("u", "p"))
            self.assertEqual(fetch.call_count, 4)

    def test_user_project_and_returned_rows_are_isolated(self):
        with patch.object(ws, "_select", return_value=[{"role": "user"}]) as fetch:
            with ws.permission_read_scope():
                ws.get_member("t", "u1")["role"] = "owner"
                self.assertEqual(ws.get_member("t", "u1")["role"], "user")
                ws.get_member("t", "u2")
                ws.get_member("other-team", "u1")
                ws.get_project_access("p1")
                ws.get_project_access("p2")
            self.assertEqual(fetch.call_count, 5)

    def test_missing_membership_not_retained_after_error(self):
        with patch.object(ws, "_select", return_value=[]) as fetch:
            with self.assertRaises(ValueError), ws.permission_read_scope():
                self.assertIsNone(ws.get_member("t", "u"))
                self.assertIsNone(ws.get_member("t", "u"))
                raise ValueError("response failed")
            self.assertEqual(fetch.call_count, 1)
            fetch.return_value = [{"role": "owner"}]
            self.assertEqual(ws.get_member("t", "u")["role"], "owner")
            self.assertEqual(fetch.call_count, 2)

    def test_concurrent_responses_do_not_share_cache(self):
        def read(_):
            with ws.permission_read_scope():
                ws.get_member("t", "u")
                ws.get_member("t", "u")

        with patch.object(ws, "_select", return_value=[] ) as fetch:
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(read, range(4)))
            self.assertEqual(fetch.call_count, 4)


if __name__ == "__main__":
    unittest.main()
