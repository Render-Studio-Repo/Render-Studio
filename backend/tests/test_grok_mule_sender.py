import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

class MuleSenderTests(unittest.TestCase):
    def test_explicit_sender_is_preserved_on_both_records(self):
        path=Path(__file__).resolve().parents[2]/'mcp/grok-bot/server.py'
        spec=importlib.util.spec_from_file_location('mule_sender_test_server',path)
        module=importlib.util.module_from_spec(spec)
        sys.modules[spec.name]=module
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory, patch.object(module,'MULE_OUTBOX',Path(directory)/'out.jsonl'), patch.object(module,'grok_group_chat') as chat, patch('backend.services.mcp_watchdog_service.rm_queue'):
            result=module.grok_mule_hop({'action':'post','sender':'codex','text':'test fixture only'})
            self.assertEqual(result['hop']['from'],'codex')
            self.assertEqual(chat.call_args.args[0]['agent'],'codex')
