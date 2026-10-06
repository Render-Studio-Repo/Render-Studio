"""Personal Claude access remains provider-scoped and owner-authorized."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import subscription_share_service as shares
from backend.services import personal_subscription_share_service as personal


class PersonalSubscriptionShareTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        db = patch('backend.database.DB_PATH', Path(self.tmp.name) / 'test.db')
        db.start()
        self.addCleanup(db.stop)
        init_db()
        self.signed_in = {('claude', 'owner'), ('cursor', 'owner')}
        auth = patch.object(shares, '_signed_in', side_effect=lambda p, u: (p, u) in self.signed_in)
        auth.start()
        self.addCleanup(auth.stop)
        workspace = patch('backend.services.teams_service.have_shared_workspace', return_value=False)
        workspace.start()
        self.addCleanup(workspace.stop)
        with get_conn() as conn:
            for uid in ('owner', 'recipient', 'other'):
                conn.execute('INSERT INTO users (id,email,display_name,password_hash,created_at) VALUES (?,?,?,?,?)',
                             (uid, uid + '@example.com', uid.title(), 'x', '2026-01-01'))

    def grant(self, provider='claude', **kwargs):
        return personal.add_personal_person('owner', provider, user_id='recipient',
                                            confirm_new_collaborator=True, **kwargs)

    def test_claude_grant_is_visible_and_resolves_without_workspace(self):
        self.grant()
        self.assertEqual(shares.resolve_owner('recipient', 'claude')['owner_user_id'], 'owner')
        self.assertEqual(shares.resolve_owner('recipient', 'claude')['kind'], 'personal')
        listing = shares.listing_for_user('recipient', 'claude')
        self.assertFalse(listing['signed_in'])
        self.assertEqual(listing['personal_received'][0]['owner_name'], 'Owner')
        self.assertTrue(listing['personal_received'][0]['owner_signed_in'])
        self.assertTrue(listing['personal_received'][0]['granted'])
        self.assertEqual(shares.listing_for_user('owner', 'claude')['personal_people'][0]['user_id'], 'recipient')

    def test_grants_do_not_cross_provider_or_account(self):
        self.grant()
        self.assertIsNone(shares.resolve_owner('recipient', 'cursor')['owner_user_id'])
        self.assertIsNone(shares.resolve_owner('other', 'claude')['owner_user_id'])
        self.assertEqual(personal.list_personal_received('recipient', 'cursor'), [])
        with self.assertRaises(ValueError):
            personal.set_personal_person_access('other', 'claude', 'recipient', granted=True)
        with self.assertRaises(ValueError):
            personal.remove_personal_person('other', 'claude', 'recipient')

    def test_daily_cap_and_unknown_spend_do_not_authorize(self):
        self.grant(daily_limit_usd=2)
        self.assertEqual(shares.resolve_owner('recipient', 'claude', spent_today_usd=1)['owner_user_id'], 'owner')
        for spent in (2, 3, None):
            resolved = shares.resolve_owner('recipient', 'claude', spent_today_usd=spent)
            self.assertIsNone(resolved['owner_user_id'])
            self.assertEqual(resolved['kind'], 'daily_limit')
        personal.set_personal_person_access('owner', 'claude', 'recipient', daily_limit_usd=None, daily_limit_provided=True)
        self.assertEqual(shares.resolve_owner('recipient', 'claude')['owner_user_id'], 'owner')

    def test_revoke_remove_and_owner_signout_take_effect(self):
        self.grant()
        personal.set_personal_person_access('owner', 'claude', 'recipient', granted=False)
        self.assertIsNone(shares.resolve_owner('recipient', 'claude')['owner_user_id'])
        self.assertEqual(personal.list_personal_received('recipient', 'claude'), [])
        self.assertEqual(self.grant()['status'], 'already_added')
        self.assertIsNone(shares.resolve_owner('recipient', 'claude')['owner_user_id'])
        personal.set_personal_person_access('owner', 'claude', 'recipient', granted=True)
        self.signed_in.remove(('claude', 'owner'))
        self.assertFalse(personal.list_personal_received('recipient', 'claude')[0]['owner_signed_in'])
        self.assertIsNone(shares.resolve_owner('recipient', 'claude')['owner_user_id'])
        personal.remove_personal_person('owner', 'claude', 'recipient')
        self.assertEqual(personal.list_personal_people('owner', 'claude'), [])

    def test_own_login_takes_precedence(self):
        self.grant(daily_limit_usd=0)
        self.signed_in.add(('claude', 'recipient'))
        self.assertEqual(shares.resolve_owner('recipient', 'claude')['kind'], 'self')

    def test_owner_must_be_signed_in_and_recipient_cannot_reshare(self):
        with self.assertRaises(ValueError):
            personal.add_personal_person('recipient', 'claude', user_id='other', confirm_new_collaborator=True)
        with self.assertRaises(ValueError):
            personal.add_personal_person('owner', 'claude', user_id='owner')

    def test_new_collaborator_confirmation_does_not_write(self):
        result = personal.add_personal_person('owner', 'claude', user_id='recipient')
        self.assertEqual(result['status'], 'needs_confirm')
        self.assertEqual(personal.list_personal_people('owner', 'claude'), [])

    def test_invalid_caps_are_rejected(self):
        for value in (-1, float('inf'), float('nan'), 'invalid'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.grant(daily_limit_usd=value)
