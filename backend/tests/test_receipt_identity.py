import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.services import agent_knowledge_lake as lake

class ReceiptIdentityTest(unittest.TestCase):
    def test_metadata_cannot_replace_receipt_identity_and_revisions_survive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('hot', 'sandbox'):
                (root / name).mkdir()
            layout = {'hot': str(root/'hot'), 'sandbox': str(root/'sandbox'), 'cold': None}
            with patch.object(lake, 'layout', return_value=layout), patch.object(lake, '_db_path', return_value=root/'catalog.sqlite'):
                for revision in ('rev1', 'rev2'):
                    receipt = {'receipt_id':'same-fix','author':'codex','summary':'unverified headset fix','revision_id':revision}
                    result = lake.ingest_receipt(receipt, {'id':revision,'kind':'score','agent_id':'wrong','body':{},'label':'pending'})
                    self.assertEqual(result['record']['kind'], 'receipt')
                    self.assertEqual(result['record']['agent_id'], 'codex')
                    self.assertEqual(result['record']['body'], receipt)
                with lake._conn() as conn:
                    rows = conn.execute('SELECT id,kind,receipt_id FROM records ORDER BY id').fetchall()
                self.assertEqual([tuple(r) for r in rows], [('rev1','receipt','same-fix'), ('rev2','receipt','same-fix')])
                lines = (root/'hot'/'receipts.jsonl').read_text().splitlines()
                self.assertEqual(len(lines), 2)
                self.assertEqual(json.loads(lines[1])['body']['revision_id'], 'rev2')

if __name__ == '__main__': unittest.main()
