import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.auth import get_current_user,get_current_user_optional
from backend.database import init_db
from backend.routers.marketplace_product_page import create_marketplace_product_page_router
from backend.services import marketplace_product_page_service as service

class ProductPageTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=patch('backend.database.DB_PATH',Path(self.tmp.name)/'test.db');self.db.start();init_db()
  self.item={'id':'item','slug':'robot','kind':'model','name':'Robot','created_by':'seller','access_mode':'paid','price_cents':1000,'download_enabled':True,'files':[{'name':'robot.glb','data_url':'data:application/octet-stream;base64,'+base64.b64encode(b'glTF-test').decode()}]}
  self.user={'id':'seller'};self.app=FastAPI();self.app.include_router(create_marketplace_product_page_router(lambda *a:None));self.app.dependency_overrides[get_current_user]=lambda:self.user;self.app.dependency_overrides[get_current_user_optional]=lambda:self.user
  self.lookup=patch('backend.routers.marketplace_product_page.catalog.get_product',side_effect=lambda *a,**k:self.item);self.lookup.start();self.client=TestClient(self.app);self.base='/api/marketplace/product/model/item'
 def tearDown(self):self.lookup.stop();self.db.stop();self.tmp.cleanup()
 def test_owner_layout_save_reload_and_conflict(self):
  page=self.client.get(self.base+'/presentation').json()['page'];page['layout']=[{'id':'demo','type':'about','title':'Updated','html':'<script>bad</script>','url':'javascript:x'}]
  result=self.client.put(self.base+'/presentation',json=page);self.assertEqual(result.status_code,200);self.assertNotIn('html',result.json()['page']['layout'][0]);self.assertNotIn('url',result.json()['page']['layout'][0]);self.assertEqual(self.client.put(self.base+'/presentation',json=page).status_code,409)
  self.assertEqual(self.client.get(self.base+'/presentation').json()['page']['layout'][0]['title'],'Updated')
 def test_other_seller_cannot_edit(self):
  page=self.client.get(self.base+'/presentation').json()['page'];self.user={'id':'other'};self.assertEqual(self.client.put(self.base+'/presentation',json=page).status_code,403)
 def test_paid_asset_requires_entitlement(self):
  self.user={'id':'buyer'}
  with patch('backend.services.marketplace_payments_service.has_entitlement',return_value=False):self.assertEqual(self.client.get(self.base+'/assets/0').status_code,403)
  with patch('backend.services.marketplace_payments_service.has_entitlement',return_value=True):self.assertEqual(self.client.get(self.base+'/assets/0').content,b'glTF-test')
 def test_public_preview_requires_explicit_seller_opt_in(self):
  self.user=None;self.assertEqual(self.client.get(self.base+'/assets/0?preview=true').status_code,403)
  self.user={'id':'seller'};page=self.client.get(self.base+'/presentation').json()['page'];page['preview_file_index']=0;self.assertEqual(self.client.put(self.base+'/presentation',json=page).status_code,200)
  self.user=None;self.assertEqual(self.client.get(self.base+'/assets/0?preview=true').status_code,200);self.assertEqual(self.client.get(self.base+'/assets/0').status_code,403)
 def test_changed_preview_file_is_never_public(self):
  page=self.client.get(self.base+'/presentation').json()['page'];page['preview_file_index']=0;self.client.put(self.base+'/presentation',json=page)
  self.user=None;self.item['files'][0]={'name':'paid-source.py','data_url':'data:text/plain;base64,'+base64.b64encode(b'secret').decode()}
  self.assertEqual(self.client.get(self.base+'/assets/0?preview=true').status_code,403)
 def test_public_skill_metadata_omits_source_payload(self):
  clean=service.public_listing({**self.item,'manifest':{'secret':'x'},'source_url':'private','body_md':'private code'})
  for key in ('manifest','source_url','body_md'):self.assertNotIn(key,clean)
 def test_malformed_file_metadata_is_bounded(self):
  data=service.file_metadata({'files':[{'name':{'unexpected':'object'},'size':'bad'}]});self.assertIsInstance(data[0]['name'],str);self.assertIsNone(data[0]['size'])
 def test_legacy_payload_keeps_owner_access_but_protects_buyers(self):
  self.assertIn('data_url',service.protected_listing(self.item,{'id':'seller'},'model')['files'][0])
  with patch('backend.services.marketplace_payments_service.has_entitlement',return_value=False):self.assertNotIn('data_url',service.protected_listing(self.item,{'id':'buyer'},'model')['files'][0])
 def test_public_catalog_file_metadata_has_no_payload(self):
  clean=service.public_listing(self.item);self.assertEqual(clean['files'][0]['name'],'robot.glb');self.assertNotIn('data_url',clean['files'][0]);self.assertNotIn('ref',clean['files'][0])
 def test_free_and_view_only_asset_policies(self):
  self.user=None;self.item.update(access_mode='free',price_cents=0);self.assertEqual(self.client.get(self.base+'/assets/0').status_code,200)
  self.item.update(access_mode='view_only');self.assertEqual(self.client.get(self.base+'/assets/0').status_code,403)
 def test_file_bounds_and_non_glb_preview_rejected(self):
  self.assertEqual(self.client.get(self.base+'/assets/20').status_code,404)
  self.item['files'][0]['name']='private.py';page=self.client.get(self.base+'/presentation').json()['page'];page['preview_file_index']=0;self.assertEqual(self.client.put(self.base+'/presentation',json=page).status_code,422)
 def test_asset_rejects_external_urls_and_traversal(self):
  for asset in ({'name':'x.glb','ref':'http://localhost/private'}, {'name':'x.glb','project_id':'p','rel':'../../secret'}):
   self.item['files']=[asset];self.assertEqual(self.client.get(self.base+'/assets/0').status_code,422)

class PublicProductMetadataTests(unittest.TestCase):
 def test_metadata_only_files_are_not_advertised_as_downloads(self):
  self.assertFalse(service.file_metadata({'files':[{'name':'demo.glb','builtin':True,'size':0}]})[0]['download_available'])
  self.assertTrue(service.file_metadata({'files':[{'name':'model.glb','ref':'/api/projects/owned/files/model.glb'}]})[0]['download_available'])
  self.assertFalse(service.has_asset_source({'ref':'https://remote.test/model.glb'}))
 def test_visitors_never_receive_team_emails(self):
  item={'id':'free','kind':'model','created_by':'seller','access_mode':'free','price_cents':0,'owner':{'id':'seller','email':'private@example.com'},'members':[{'email':'member@example.com'}],'files':[]}
  for clean in (service.public_listing(item),service.protected_listing(item,None,'model')):
   self.assertNotIn('members',clean);self.assertNotIn('email',clean['owner'])
  self.assertIn('members',service.protected_listing(item,{'id':'seller'},'model'))
 def test_published_examples_survive_without_skill_source(self):
  clean=service.public_listing({'files':[],'manifest':{'instructions':'private','example_images':[{'url':'https://example.com/preview.png'},{'url':'javascript:bad'},{'url':'data:image/svg+xml;base64,PHN2Zz4='}]}})
  self.assertNotIn('manifest',clean);self.assertEqual(clean['example_images'],[{'url':'https://example.com/preview.png','name':''}])
 def test_display_and_download_names_are_basename_only(self):
  for raw in ('../other/file.glb','..\\other\\file.glb','/tmp/file.glb','file\x00.glb'):
   item={'files':[{'name':raw,'data_url':'data:application/octet-stream;base64,Z2xURg=='}]}
   self.assertEqual(service.file_metadata(item)[0]['name'],'file.glb')
   self.assertEqual(service.read_asset(item,0)[0],'file.glb')
 def test_missing_owner_does_not_bypass_paid_policy(self):
  item={'id':'paid','access_mode':'paid','price_cents':100,'files':[{'name':'secret.py','data_url':'private'}]}
  clean=service.protected_listing(item,None,'model')
  self.assertFalse(clean['can_download']);self.assertNotIn('data_url',clean['files'][0])

if __name__=='__main__':unittest.main()
