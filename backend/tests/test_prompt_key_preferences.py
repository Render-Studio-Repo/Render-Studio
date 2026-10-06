import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.services import prompt_key_preferences as prefs


class PromptKeyPreferencesTest(unittest.TestCase):
    def test_pin_persists_and_isolates_accounts(self):
        with tempfile.TemporaryDirectory() as tmp:
            def connect():
                conn = sqlite3.connect(Path(tmp) / 'test.db')
                conn.row_factory = sqlite3.Row
                return conn
            with patch.object(prefs, 'get_conn', connect):
                user = {'id': 'one', 'email': 'owner@example.com'}
                other = {'id': 'two', 'email': 'other@example.com'}
                self.assertEqual(prefs.get_pinned_key(user), '')
                self.assertEqual(prefs.get_pinned_key(other), '')
                prefs.set_pinned_key(user, '')
                self.assertEqual(prefs.get_pinned_key(user), '')
                prefs.set_pinned_key(other, 'chatgpt:subscription')
                self.assertEqual(prefs.get_pinned_key(other), 'chatgpt:subscription')
                self.assertEqual(prefs.get_pinned_key(user), '')
                with self.assertRaises(ValueError):
                    prefs.set_pinned_key(user, 'invalid:key')
