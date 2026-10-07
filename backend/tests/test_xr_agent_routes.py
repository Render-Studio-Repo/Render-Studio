"""Isolated XR companion route tests: temporary data, fake AI, no paid calls."""
from __future__ import annotations
import json
from tempfile import TemporaryDirectory
import unittest

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from backend.services.xr_agent_discussion import create_xr_agent_discussion_router, discussion_image
from backend.services.xr_agent_session import create_xr_agent_router, clean, merge_records


def fake_user(request: Request):
    if not request.headers.get('x-test-user'): raise HTTPException(401, 'Sign in')
    return {'id': request.headers['x-test-user']}


class DiscussionTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        events = self.events
        class FakeAI:
            model = 'chosen-cad-model'
            def chat_json(self, system, content, **kwargs):
                events.append(('chat', system, content, kwargs))
                return {'answer':'Move the bracket.','proposals':[{'prompt':'Move bracket 2mm','targetIds':['bracket']}],'requestReview':True}, {'cost_usd':0.001}
        def require(user, pid):
            events.append(('permission', user['id'], pid))
            if pid != 'owned': raise HTTPException(403, 'No project access')
        def resolve(user, body, pid):
            events.append(('resolve', body.model, body.ai_key_source, pid))
            return FakeAI()
        def usage(user, body, ai, trace, pid, answer):
            events.append(('usage', user['id'], trace['cost_usd'], pid))
        app = FastAPI()
        app.include_router(create_xr_agent_discussion_router(fake_user, resolve, require, usage))
        self.client = TestClient(app)
        self.body = {'question':'How can this board fit?', 'project_id':'owned', 'model':'chosen-cad-model', 'ai_key_source':'personal', 'context':{'wire':{'id':'W1','gauge':'22AWG','sources':['https://maker.example/pins']}, 'token':'private'}}

    def post(self, body=None):
        return self.client.post('/api/xr-agent/discuss', json=body or self.body, headers={'x-test-user':'alice'})

    def test_selected_model_context_review_and_accounting(self):
        reply = self.post()
        self.assertEqual(reply.status_code, 200, reply.text)
        data = reply.json()
        self.assertEqual(data['model'], 'chosen-cad-model')
        self.assertTrue(data['requestReview'])
        self.assertEqual(data['proposals'][0]['targetIds'], ['bracket'])
        self.assertEqual([event[0] for event in self.events], ['permission','resolve','chat','usage'])
        context = self.events[2][2]
        self.assertIn('maker.example/pins', context)
        self.assertNotIn('private', context)

    def test_authorization_precedes_any_paid_call(self):
        response = self.client.post('/api/xr-agent/discuss', json=self.body)
        self.assertEqual(response.status_code,401)
        response = self.post({**self.body,'project_id':'not-owned'})
        self.assertEqual(response.status_code,403)
        self.assertFalse(any(event[0] == 'resolve' for event in self.events))

    def test_invalid_large_context_and_image_are_rejected(self):
        self.assertEqual(self.post({**self.body,'context':{'items':['x'*6000]*40}}).status_code,413)
        self.assertEqual(self.post({**self.body,'image':'https://external.example/image.png'}).status_code,400)
        self.assertFalse(any(event[0] == 'chat' for event in self.events))
        with self.assertRaises(HTTPException): discussion_image('data:image/png;base64,AAAA')


class AgentStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        app = FastAPI()
        app.include_router(create_xr_agent_router(fake_user,self.tmp.name))
        self.client = TestClient(app)
        self.headers = {'x-test-user':'alice'}

    def test_nonfinite_and_invalid_ids_do_not_break_storage(self):
        self.assertIsNone(clean(float('nan')))
        self.assertIsNone(clean(float('inf')))
        body = {'settings':{'volume':float('nan'),'api_key':'private'},'changes':[{'id':['invalid'],'at':0},{'id':'good','at':'2026-09-15T10:00:00Z'}]}
        response = self.client.patch('/api/xr-agent/state',content=json.dumps(body),headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        state = self.client.get('/api/xr-agent/state',headers=self.headers).json()
        self.assertIsNone(state['settings']['volume'])
        self.assertNotIn('api_key',state['settings'])
        self.assertEqual([r['id'] for r in state['changes']],['good'])

    def test_stale_device_does_not_overwrite_newer_feedback(self):
        new = {'id':'change1','status':'accepted','updatedAt':'2026-09-15T12:00:00Z'}
        old = {'id':'change1','status':'pending','updatedAt':'2026-09-15T11:00:00Z'}
        self.client.patch('/api/xr-agent/state',json={'changes':[new]},headers=self.headers)
        self.client.patch('/api/xr-agent/state',json={'changes':[old]},headers=self.headers)
        state = self.client.get('/api/xr-agent/state',headers=self.headers).json()
        self.assertEqual(state['changes'][0]['status'],'accepted')

    def test_version_and_settings_timestamp_survive_and_reject_stale_device_preferences(self):
        newer = {'version':1,'settings':{'name':'Nova'},'settingsUpdatedAt':'2026-09-15T12:00:00Z'}
        older = {'version':1,'settings':{'name':'Old'},'settingsUpdatedAt':'2026-09-15T11:00:00Z'}
        self.client.patch('/api/xr-agent/state',json=newer,headers=self.headers)
        self.client.patch('/api/xr-agent/state',json=older,headers=self.headers)
        state=self.client.get('/api/xr-agent/state',headers=self.headers).json()
        self.assertEqual(state['version'],1)
        self.assertEqual(state['settings']['name'],'Nova')
        self.assertEqual(state['settingsUpdatedAt'],newer['settingsUpdatedAt'])

    def test_history_bound_cross_user_isolation_and_pc_signal(self):
        self.client.patch('/api/xr-agent/state',json={'history':[{'id':str(i),'at':i,'text':'hello'} for i in range(180)]},headers=self.headers)
        state = self.client.get('/api/xr-agent/state',headers=self.headers).json()
        self.assertEqual(len(state['history']),120)
        other = self.client.get('/api/xr-agent/state',headers={'x-test-user':'bob'}).json()
        self.assertEqual(other['history'],[])
        signal = self.client.post('/api/xr-agent/open-pc',headers=self.headers).json()
        self.assertEqual(self.client.get('/api/xr-agent/state',headers=self.headers).json()['pcRequest']['id'],signal['id'])

    def test_slicer_request_reaches_another_signed_in_session_and_can_be_acknowledged(self):
        body = {
            'slicer_id':'bambu',
            'file_url':'https://studio.example/api/share/public/files/part.3mf',
            'filename':'folder/part.3mf',
            'source_client_id':'source-mac',
        }
        response = self.client.post('/api/xr-agent/open-slicer',json=body,headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        request = self.client.get('/api/xr-agent/state',headers=self.headers).json()['slicerRequest']
        self.assertEqual(request['filename'],'part.3mf')
        self.assertEqual(request['source_client_id'],'source-mac')
        other = self.client.get('/api/xr-agent/state',headers={'x-test-user':'bob'}).json()
        self.assertNotIn('slicerRequest',other)
        ack = self.client.post(f"/api/xr-agent/slicer-request/{request['id']}/ack",headers=self.headers)
        self.assertEqual(ack.json(),{'ok':True})
        self.assertNotIn('slicerRequest',self.client.get('/api/xr-agent/state',headers=self.headers).json())

    def test_slicer_request_rejects_unsafe_or_non_3mf_payloads(self):
        invalid = {'slicer_id':'bambu','file_url':'javascript:alert(1)','filename':'part.3mf'}
        self.assertEqual(self.client.post('/api/xr-agent/open-slicer',json=invalid,headers=self.headers).status_code,400)
        invalid = {'slicer_id':'unknown','file_url':'https://studio.example/part.stl','filename':'part.stl'}
        self.assertEqual(self.client.post('/api/xr-agent/open-slicer',json=invalid,headers=self.headers).status_code,400)

    def test_audio_upload_bound_type_and_private_retrieval(self):
        response = self.client.put('/api/xr-agent/throw-sound',content=b'clip',headers={**self.headers,'content-type':'text/plain'})
        self.assertEqual(response.status_code,415)
        response = self.client.put('/api/xr-agent/throw-sound',content=b'clip',headers={**self.headers,'content-type':'audio/mpeg'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.client.get('/api/xr-agent/throw-sound',headers=self.headers).content,b'clip')
        self.assertEqual(self.client.get('/api/xr-agent/throw-sound',headers={'x-test-user':'bob'}).status_code,404)
        self.assertEqual(self.client.delete('/api/xr-agent/throw-sound',headers=self.headers).status_code,200)
        self.assertEqual(self.client.get('/api/xr-agent/throw-sound',headers=self.headers).status_code,404)
        response = self.client.put('/api/xr-agent/throw-sound',content=b'x'*(3*1024*1024+1),headers={**self.headers,'content-type':'audio/mpeg'})
        self.assertEqual(response.status_code,413)


if __name__ == '__main__': unittest.main()
