import unittest
from backend.services.public_project_listing import merge_public_projects


class PublicProjectListingTest(unittest.TestCase):
    def test_owner_keeps_folder_and_permissions_without_duplicate(self):
        owned = {'id': 'one', 'folder_id': 'designs', 'team_id': 'personal', 'read_only_project': False, 'sort_order': 3}
        public = {'id': 'one', 'folder_id': '__public__', 'team_id': None, 'public': True, 'owner_user_id': 'me', 'public_pinned': True}
        rows = merge_public_projects([owned], [public], 'me')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['folder_id'], 'designs')
        self.assertEqual(rows[0]['team_id'], 'personal')
        self.assertFalse(rows[0]['read_only_project'])
        self.assertTrue(rows[0]['public'])
        self.assertTrue(rows[0]['public_pinned'])
        self.assertEqual(merge_public_projects([], [public], 'other'), [public])

    def test_private_projects_and_other_peoples_public_projects_are_unchanged(self):
        private = {'id': 'private', 'folder_id': None}
        public = {'id': 'public', 'public': True, 'owner_user_id': 'other', 'folder_id': '__public__'}
        self.assertEqual(merge_public_projects([private], [public], 'me'), [private, public])
