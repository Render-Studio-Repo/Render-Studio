"""Verified Google and password signup share one normalized Render identity."""
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

from backend.services import social_oauth, teams_service


class AccountEmailIdentityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'identity.db'
        db = patch('backend.database.DB_PATH', self.path)
        db.start()
        self.addCleanup(db.stop)
        with sqlite3.connect(self.path) as conn:
            conn.executescript('''
                CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT UNIQUE, display_name TEXT,
                    password_hash TEXT, created_at TEXT, handle TEXT, avatar_url TEXT);
                CREATE TABLE teams(id TEXT PRIMARY KEY, name TEXT, created_by TEXT, created_at TEXT);
                CREATE TABLE team_members(team_id TEXT, user_id TEXT, role TEXT, joined_at TEXT);
                CREATE TABLE team_invites(id TEXT, team_id TEXT, email TEXT, status TEXT);
                CREATE TABLE social_accounts(provider TEXT, provider_user_id TEXT, user_id TEXT,
                    email TEXT, display_name TEXT, picture_url TEXT, created_at TEXT, updated_at TEXT,
                    UNIQUE(provider, provider_user_id));
            ''')
        patches = (
            patch('backend.services.supabase_users_store.upsert_local_user', return_value=False),
            patch('backend.services.supabase_users_store.prefer_supabase', return_value=False),
            patch('backend.services.supabase_auth_service.enabled', return_value=False),
            patch.object(teams_service, '_ws', side_effect=RuntimeError('isolated test')),
            patch.object(teams_service, 'hash_password', side_effect=lambda text: 'hash:' + text),
            patch.object(teams_service, 'verify_password', side_effect=lambda text, hashed: hashed == 'hash:' + text),
            patch.object(teams_service, 'accept_pending_invites_for_user', return_value=[]),
        )
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def google(self, email='Member@Example.com', sub='google-person', verified=True):
        return social_oauth.upsert_social_user({'provider': 'google', 'provider_user_id': sub,
            'email': email, 'email_verified': verified, 'display_name': 'Member'})

    def existing(self, email='Member@Example.com', uid='original'):
        with sqlite3.connect(self.path) as conn:
            conn.execute('INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)',
                         (uid, email, 'Member', 'hash:original-password', '2026-01-01'))

    def rows(self):
        with sqlite3.connect(self.path) as conn:
            return conn.execute('SELECT id,email,password_hash FROM users').fetchall()

    def test_google_reuses_existing_mixed_case_email_and_preserves_password(self):
        self.existing()
        self.assertEqual(self.google()['id'], 'original')
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0][2], 'hash:original-password')
        self.assertEqual(teams_service.authenticate(' MEMBER@example.COM ', 'original-password')['id'], 'original')
        self.assertIsNone(teams_service.authenticate('member@example.com', 'wrong'))

    def test_password_signup_rejects_existing_mixed_case_google_email(self):
        self.existing()
        with self.assertRaisesRegex(ValueError, 'already registered'):
            teams_service.create_user(' member@EXAMPLE.com ', 'replacement', 'Member')
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0][2], 'hash:original-password')

    def test_google_first_then_signup_cannot_replace_password(self):
        first = self.google()
        with self.assertRaisesRegex(ValueError, 'already registered'):
            teams_service.create_user('MEMBER@example.COM', 'replacement', 'Member')
        self.assertEqual(self.rows(), [(first['id'], 'member@example.com', '')])

    def test_unverified_email_never_links_to_existing_account(self):
        self.existing()
        result = self.google(verified=False)
        self.assertNotEqual(result['id'], 'original')
        self.assertTrue(result['email'].endswith('@social.render3d.local'))
        self.assertEqual(self.rows()[0][2], 'hash:original-password')

    def test_absent_email_verification_claim_is_unverified(self):
        cfg = social_oauth.ProviderConfig('google', 'Google', '', '', 'client', 'secret', '', '', userinfo_url='https://example.invalid/userinfo')
        response = Mock()
        response.json.return_value = {'sub': 'subject', 'email': 'member@example.com'}
        with patch.object(social_oauth.httpx, 'get', return_value=response):
            profile = social_oauth._userinfo_profile(cfg, {'access_token': 'fake-test-token'})
        self.assertFalse(profile['email_verified'])

    def test_ambiguous_legacy_emails_do_not_choose_an_account(self):
        self.existing('Member@Example.com', 'first')
        self.existing('member@example.com', 'second')
        with self.assertRaisesRegex(ValueError, 'Multiple accounts'):
            self.google()
        self.assertEqual(len(self.rows()), 2)

    def test_simultaneous_google_callbacks_reuse_one_identity(self):
        barrier = threading.Barrier(2)
        def login(sub):
            barrier.wait()
            return self.google(sub=sub)['id']
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(login, ['google-person', 'google-person']))
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(len(self.rows()), 1)

    def test_simultaneous_password_and_google_signup_use_one_identity(self):
        barrier = threading.Barrier(2)
        def password():
            barrier.wait()
            try:
                return teams_service.create_user('member@EXAMPLE.com', 'password', 'Member')['id']
            except ValueError as exc:
                self.assertIn('already registered', str(exc))
                return None
        def google():
            barrier.wait()
            return self.google()['id']
        with ThreadPoolExecutor(max_workers=2) as pool:
            one, two = pool.submit(password), pool.submit(google)
            password_id, google_id = one.result(), two.result()
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0][0], google_id)
        if password_id:
            self.assertEqual(password_id, google_id)
