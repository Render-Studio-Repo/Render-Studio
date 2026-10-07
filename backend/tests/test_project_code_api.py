from __future__ import annotations
import io
import json
import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from backend.routers.project_code import create_project_code_router
from backend.services import project_code_files

class CodeApiTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.project=Path(self.temp.name)/'p1';refs=self.project/'references/Project Code/Demo';refs.mkdir(parents=True)
  (refs/'main.ino').write_text('#include <Servo.h>\nServo arm;')
  (self.project/'wiring.json').write_text(json.dumps({'components':[{'id':'board','type':'arduino-uno'},{'id':'led','type':'led'}],'wires':[]}))
  self.user={'id':'test','read_only':False};self.ai_calls=0
  def read(user,pid):
   if pid!='p1':raise HTTPException(403,'No access')
   return self.project
  def write(user,pid):
   path=read(user,pid)
   if user['read_only']:raise HTTPException(403,'Read only')
   return path
  def ai(*args,**kwargs):self.ai_calls+=1;raise AssertionError('No real AI in API tests')
  app=FastAPI();app.include_router(create_project_code_router(lambda:self.user,read,write,lambda p:None,ai,lambda u:{'projects':[{'id':'p1','name':'Demo'},{'id':'private','name':'Private'}]}));self.client=TestClient(app);self.base='/api/projects/p1/code'
 def tearDown(self):self.temp.cleanup()
 def test_shared_read_only_user_can_preview_but_cannot_save(self):
  self.user['read_only']=True
  res=self.client.get(self.base+'/text',params={'path':'references/Project Code/Demo/main.ino'});self.assertEqual(res.status_code,200)
  data=res.json();res=self.client.put(self.base+'/text',json={'path':'references/Project Code/Demo/main.ino','content':'new','revision':data['revision']});self.assertEqual(res.status_code,403)
 def test_source_and_selected_wiring_permissions_checked(self):
  body={'wiring_project_id':'private','paths':['references/Project Code/Demo/main.ino']}
  self.assertEqual(self.client.post(self.base+'/simulation',json=body).status_code,403)
  self.assertEqual(self.client.get('/api/projects/private/code/manifest').status_code,403)
  self.assertEqual(self.ai_calls,0)
 def test_incompatible_code_returns_popup_details_without_ai_call(self):
  res=self.client.post(self.base+'/simulation',json={'wiring_project_id':'p1','paths':['references/Project Code/Demo/main.ino']})
  self.assertEqual(res.status_code,200);self.assertFalse(res.json()['compatible']);self.assertIn('Servo.h',res.json()['mismatches'][0]);self.assertEqual(self.ai_calls,0)
 def test_wiring_picker_does_not_leak_other_project(self):
  res=self.client.get(self.base+'/wiring-projects');self.assertEqual([p['id'] for p in res.json()['projects']],['p1'])
 def test_wiring_picker_includes_other_accessible_electronics(self):
  app=FastAPI()
  def read(user,pid):
   if pid not in ('p1','p2'):raise HTTPException(403,'No access')
   return self.project
  app.include_router(create_project_code_router(lambda:self.user,read,read,lambda p:None,lambda *a,**k:None,lambda u:{'projects':[{'id':'p2','name':'Electronics'},{'id':'private','name':'Hidden'}]}))
  res=TestClient(app).get(self.base+'/wiring-projects')
  self.assertEqual([p['id'] for p in res.json()['projects']],['p1','p2'])
 def test_malformed_workbook_is_client_error(self):
  path='references/Project Code/Demo/broken.xlsx';(self.project/path).write_bytes(b'not a zip')
  self.assertEqual(self.client.get(self.base+'/spreadsheet',params={'path':path}).status_code,400)
 def test_upload_rejects_linked_destination(self):
  dest=self.project/'references/Project Code/Dropped files';outside=Path(self.temp.name)/'outside';outside.mkdir();dest.symlink_to(outside,target_is_directory=True)
  res=self.client.post(self.base+'/upload',files=[('uploads',('main.py',b'print(1)','text/plain'))])
  self.assertEqual(res.status_code,400);self.assertEqual(list(outside.iterdir()),[])
 def test_content_path_traversal_rejected(self):
  for path in ('references/../../secret','/etc/passwd','generation.json'):
   self.assertEqual(self.client.get(self.base+'/content',params={'path':path}).status_code,400)
 def test_upload_and_manifest_preserve_assets(self):
  res=self.client.post(self.base+'/upload',files=[('uploads',('main.py',b'print(1)','text/plain')),('uploads',('art.svg',b'<svg/>','image/svg+xml'))],data={'paths':json.dumps(['src/main.py','art.svg']),'name':'Robot'})
  self.assertEqual(res.status_code,200,res.text)
  tree=self.client.get(self.base+'/manifest',params={'root':res.json()['root']}).json();self.assertEqual(len(tree['files']),2)
 def test_project_manifest_is_bounded_and_project_json_is_read_only(self):
  (self.project/'project.json').write_text('{"name":"OpenArm Demo"}')
  (self.project/'references/Empty Demos').mkdir()
  manifest=self.client.get(self.base+'/manifest',params={'root':'project'}).json()
  self.assertEqual(manifest['project'],{'id':'p1','name':'OpenArm Demo'})
  self.assertIn('references/Empty Demos',[row['path'] for row in manifest['entries']])
  self.assertNotIn('wiring.json',[row['path'] for row in manifest['entries']])
  opened=self.client.get(self.base+'/text',params={'path':'project.json'});self.assertEqual(opened.status_code,200)
  saved=self.client.put(self.base+'/text',json={'path':'project.json','content':'{}','revision':opened.json()['revision']})
  self.assertEqual(saved.status_code,400)
 def test_create_folder_is_bounded_to_reference_files(self):
  created=self.client.post(self.base+'/folders',json={'parent':'references/Project Code','name':'New Run'})
  self.assertEqual(created.status_code,200,created.text)
  self.assertEqual(created.json(),{'name':'New Run','path':'references/Project Code/New Run'})
  self.assertTrue((self.project/'references/Project Code/New Run').is_dir())
  self.assertEqual(self.client.post(self.base+'/folders',json={'parent':'project','name':'Scenes'}).status_code,200)
  for payload in ({'parent':'../outside','name':'bad'},{'parent':'references','name':'../bad'},{'parent':'references','name':'.hidden'}):
   self.assertEqual(self.client.post(self.base+'/folders',json=payload).status_code,400)
 def test_loose_code_file_lands_in_dropped_files(self):
  res=self.client.post(self.base+'/upload',files=[('uploads',('schema.json',b'{"ok":true}','application/json'))])
  self.assertEqual(res.status_code,200,res.text)
  self.assertIn('Dropped files', res.json().get('folder') or '')
 def test_executable_is_hex_only(self):
  path='references/Project Code/Demo/tool.exe';(self.project/path).write_bytes(b'MZ\x00\x00not-runnable')
  res=self.client.get(self.base+'/hex',params={'path':path})
  self.assertEqual(res.status_code,200,res.text)
  data=res.json();self.assertTrue(data.get('executable'));self.assertIn('4d 5a', data.get('content','').lower())
 def test_text_conflicts_are_409(self):
  path='references/Project Code/Demo/main.ino';body={'path':path,'content':'changed','revision':'0'*64};res=self.client.put(self.base+'/text',json=body);self.assertEqual(res.status_code,409)
