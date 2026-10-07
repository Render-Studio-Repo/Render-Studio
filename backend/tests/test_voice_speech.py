import unittest
from unittest.mock import patch, AsyncMock
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.services import voice_speech as speech

class SpeechTests(unittest.TestCase):
    def test_payload_preserves_selected_voice_and_natural_rate(self):
        p=speech.speech_payload('Hello there.', 'cedar')
        self.assertEqual(p['voice'],'cedar')
        self.assertEqual(p['speed'],1.0)
        self.assertEqual(p['response_format'],'pcm')
    def test_default_voice_and_bounds(self):
        self.assertEqual(speech.speech_payload('Hello','invalid')['voice'],'marin')
        for line in ['', 'x'*4097]:
            with self.assertRaises(ValueError):speech.speech_payload(line,'marin')
    def test_authenticated_route_uses_project_key_and_returns_pcm(self):
        app=FastAPI();app.include_router(speech.speech_router(lambda:{'id':'fixture-user'}))
        with patch.object(speech.voices,'resolve_openai_api_key',return_value='test-key') as key, patch.object(speech,'synthesize_speech',new=AsyncMock(return_value=b'\0\0')) as synth:
            r=TestClient(app).post('/api/voice-mold/speech',json={'text':'Hello','voice':'cedar','project_id':'fixture'})
            self.assertEqual(r.status_code,200)
            self.assertEqual(r.json()['sample_rate'],24000)
            self.assertEqual(r.json()['voice'],'cedar')
            key.assert_called_once_with({'id':'fixture-user'},project_id='fixture')
            synth.assert_awaited_once_with('test-key','Hello','cedar')
    def test_provider_failure_is_actionable_without_substituting_voice(self):
        app=FastAPI();app.include_router(speech.speech_router(lambda:{'id':'fixture-user'}))
        with patch.object(speech.voices,'resolve_openai_api_key',return_value='test-key'), patch.object(speech,'synthesize_speech',new=AsyncMock(side_effect=RuntimeError('secret provider detail'))):
            r=TestClient(app).post('/api/voice-mold/speech',json={'text':'Hello'})
            self.assertEqual(r.status_code,502)
            self.assertIn('text reply',r.json()['detail'])
            self.assertNotIn('secret',r.text)
