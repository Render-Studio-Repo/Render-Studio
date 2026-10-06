from __future__ import annotations
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.database import init_db
from backend.services import marketplace_storefront_service as store
from backend.services import marketplace_store_builder_service as service
from backend.routers.marketplace_store_builder import create_marketplace_store_builder_router

class FakeAI:
    def __init__(self,result):self.result=result;self.context=None
    def _call_model(self,system,context,**kwargs):self.context=json.loads(context);return json.dumps(self.result),{}
    def _json_payload(self,raw):return raw

class StoreBuilderTests(unittest.TestCase):
    def test_schema_strips_scripts_unknown_keys_and_invalid_colors(self):
        out=store.normalize_layout([{'id':'hero','type':'hero','html':'<script>x()</script>'},{'id':'evil','type':'iframe'},{'id':'products!','type':'models','style':'absolute','accent':'url(javascript:x)','columns':999,'body':'Plain text','listing_ids':['p1','p1',4]}])
        self.assertEqual([x['type'] for x in out],['hero','models'])
        self.assertNotIn('html',out[0]);self.assertNotIn('style',out[1]);self.assertNotIn('accent',out[1])
        self.assertEqual(out[1]['id'],'products');self.assertEqual(out[1]['columns'],4);self.assertEqual(out[1]['listing_ids'],['p1'])

    def test_normalization_accepts_malformed_optional_values_without_500(self):
        result=store.normalize_layout([{'id':'products','type':'models','style':{},'tone':[],'kind':{},'columns':{},'interval':[]}])
        self.assertEqual(result,[{'id':'products','type':'models','visible':True,'label':'models'}])

    def test_normalization_is_bounded_and_preserves_order(self):
        out=store.normalize_layout([{'id':f'a{i}','type':'about','title':'x'*500,'body':'y'*9000,'visible':False} for i in range(100)])
        self.assertEqual(len(out),24);self.assertEqual(out[-1]['id'],'a23');self.assertEqual(len(out[0]['body']),8000);self.assertFalse(out[0]['visible'])

    def test_layout_save_roundtrip_preserves_structured_fields_and_cover(self):
        with tempfile.TemporaryDirectory() as tmp,patch('backend.database.DB_PATH',Path(tmp)/'test.db'):
            init_db()
            layout=[{'id':'show','type':'slideshow','title':'Robots','listing_ids':['p1'],'interval':7,'tone':'dark'},{'id':'code','type':'code','code':'print(1)','columns':2}]
            result=store.save_layout('u1',layout,{'image_url':'/assets/banner.png','enabled':True})
            self.assertEqual(store.get_layout('u1'),result['layout'])
            store.save_layout('u1',list(reversed(layout)))
            self.assertEqual(store.get_layout('u1')[0]['type'],'code');self.assertTrue(store.get_cover('u1')['enabled'])

    def test_context_excludes_private_payloads_and_bounds_metadata(self):
        out=service.listing_context({'id':'p1','files':[{'name':'robot.glb','data_url':'SECRET','path':'/private/secret'}],'metadata':{'api_key':'SECRET','dimensions':[10,20,30]},'description':'d'*20000})
        self.assertNotIn('SECRET',json.dumps(out));self.assertEqual(out['model_metadata']['dimensions'],[10,20,30]);self.assertEqual(len(out['description']),6000)

    def test_filename_only_assets_do_not_look_like_attached_models_to_ai(self):
        out=service.listing_context({'files':[{'name':'robot.glb','size':0,'builtin':True},{'name':'model.glb','data_url':'data:model/gltf-binary;base64,AAAA'}]})
        self.assertFalse(out['linked_files'][0]['source_attached']);self.assertTrue(out['linked_files'][1]['source_attached'])
        self.assertIn('not been inspected',out['reference_scope'])

    def test_ai_layout_uses_only_owned_ids_and_retains_catalog(self):
        ai=FakeAI({'summary':'A visual shelf','layout':[{'id':'images','type':'slideshow','listing_ids':['mine','other'],'html':'<script>x</script>'}]})
        result=service.suggest_layout(ai,'A visual shelf',[],[{'id':'mine','name':'My model'}])
        self.assertEqual(result['layout'][0]['listing_ids'],['mine']);self.assertEqual(result['layout'][-1]['type'],'models');self.assertTrue(result['draft']);self.assertNotIn('html',result['layout'][0])

    def test_malformed_ai_reply_does_not_publish(self):
        with self.assertRaises(ValueError):service.suggest_layout(FakeAI({'layout':{}}),'test',[],[])
        with self.assertRaises(ValueError):service.describe_product(FakeAI({}),'test',{'id':'p1'})

    def test_product_layout_only_contains_supported_detail_sections(self):
        ai=FakeAI({'layout':[{'id':'gallery','type':'gallery','title':'A closer look'},{'id':'catalog','type':'models'},{'id':'about','type':'about','body':'Useful context'}]})
        result=service.suggest_product_layout(ai,'A technical page',[],{'id':'p1'})
        self.assertEqual([x['type'] for x in result['layout']],['gallery','about'])
        self.assertTrue(result['draft'])

    def test_public_thumbnail_requires_public_project_owned_by_seller(self):
        from backend.services.marketplace_thumbnail_service import public_project_thumbnail
        from backend.database import get_conn
        with tempfile.TemporaryDirectory() as tmp,patch('backend.database.DB_PATH',Path(tmp)/'test.db'),patch('backend.services.marketplace_thumbnail_service.settings.projects_dir',tmp):
            init_db()
            for pid in ('public','private','foreign'):
                folder=Path(tmp)/pid;folder.mkdir();(folder/'.thumb.jpg').write_bytes(b'jpeg-test')
            with get_conn() as conn:
                for uid in ('seller','another'):
                    conn.execute('INSERT INTO users (id,email,display_name,password_hash,created_at) VALUES (?,?,?,?,?)',(uid,uid+'@example.com',uid,'not-a-real-password','2026-09-15'))
                conn.execute('INSERT INTO teams (id,name,created_by,created_at) VALUES (?,?,?,?)',('team','Test team','seller','2026-09-15'))
                conn.execute('INSERT INTO project_access (project_id,team_id,created_by,is_public,created_at) VALUES (?,?,?,?,?)',('public','team','seller',1,'2026-09-15'))
                conn.execute('INSERT INTO project_access (project_id,team_id,created_by,is_public,created_at) VALUES (?,?,?,?,?)',('private','team','seller',0,'2026-09-15'))
                conn.execute('INSERT INTO project_access (project_id,team_id,created_by,is_public,created_at) VALUES (?,?,?,?,?)',('foreign','team','another',1,'2026-09-15'))
                conn.commit()
            for pid in ('private','foreign'):
                self.assertIsNone(public_project_thumbnail({'created_by':'seller','files':[{'project_id':pid}]}))
            self.assertTrue(public_project_thumbnail({'created_by':'seller','files':[{'project_id':'public'}]}).startswith('/api/projects/public/thumb?v='))

    def test_product_copy_is_a_draft_not_a_listing_update(self):
        ai=FakeAI({'title':'Bracket','description':'A bracket for your project.','highlights':['STL included'],'notes':'Check dimensions.'})
        result=service.describe_product(ai,'Explain clearly',{'id':'p1','name':'Bracket','files':[{'name':'bracket.stl','data_url':'SECRET'}]})
        self.assertTrue(result['draft']);self.assertEqual(result['description'],'A bracket for your project.');self.assertNotIn('SECRET',json.dumps(ai.context))

class StoreBuilderApiTests(unittest.TestCase):
    def setUp(self):
        self.ai_calls=0
        def get_ai(user,body):self.ai_calls+=1;return FakeAI({'description':'A useful tool','layout':[{'id':'all','type':'models'}]})
        app=FastAPI();app.include_router(create_marketplace_store_builder_router(lambda:{'id':'seller'},get_ai));self.client=TestClient(app)
    def test_other_seller_product_rejected_before_ai(self):
        with patch('backend.routers.marketplace_store_builder.catalog.get_product',return_value={'id':'p1','created_by':'other'}):
            res=self.client.post('/api/marketplace/store/product-description',json={'prompt':'Describe this','listing_id':'p1'})
        self.assertEqual(res.status_code,403);self.assertEqual(self.ai_calls,0)
    def test_missing_product_rejected(self):
        with patch('backend.routers.marketplace_store_builder.catalog.get_product',return_value=None):
            res=self.client.post('/api/marketplace/store/product-description',json={'prompt':'Describe this','listing_id':'gone'})
        self.assertEqual(res.status_code,404);self.assertEqual(self.ai_calls,0)
    def test_owned_description_and_request_limits(self):
        with patch('backend.routers.marketplace_store_builder.catalog.get_product',return_value={'id':'p1','created_by':'seller'}):
            self.assertEqual(self.client.post('/api/marketplace/store/product-description',json={'prompt':'Describe this','listing_id':'p1'}).status_code,200)
        self.assertEqual(self.client.post('/api/marketplace/store/layout/suggest',json={'prompt':'x'*4001}).status_code,422)
    def test_layout_owner_filter_is_defensive(self):
        with patch('backend.routers.marketplace_store_builder.catalog.list_catalog',return_value=[{'id':'mine','created_by':'seller'},{'id':'other','created_by':'other'}]),patch.object(service,'suggest_layout',return_value={'draft':True}) as call:
            self.assertEqual(self.client.post('/api/marketplace/store/layout/suggest',json={'prompt':'Make a shelf'}).status_code,200)
            self.assertEqual([x['id'] for x in call.call_args.args[3]],['mine'])
if __name__=='__main__':unittest.main()

class MarketplaceThumbnailSvgTests(unittest.TestCase):
    def svg(self,raw):
        import base64
        return {'thumbnail':{'data_url':'data:image/svg+xml;base64,'+base64.b64encode(raw.encode()).decode()}}
    def test_existing_illustration_keeps_geometry_but_no_active_content(self):
        from backend.services.marketplace_thumbnail_service import svg_thumbnail_asset
        payload=svg_thumbnail_asset(self.svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><defs><linearGradient id="fill"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="100" height="100" fill="url(#fill)"/><script>alert(1)</script><foreignObject><div>NO</div></foreignObject><image href="https://example.com/track"/><text style="background:url(https://example.com)">Sample</text><circle fill="url(https://example.com/a)" r="4"/></svg>')).decode()
        for unsafe in ('script','onload','foreignObject','https://','style='):self.assertNotIn(unsafe,payload)
        self.assertIn('linearGradient',payload);self.assertIn('url(#fill)',payload);self.assertIn('Sample',payload)
    def test_svg_entities_and_oversized_payloads_rejected(self):
        from backend.services.marketplace_thumbnail_service import svg_thumbnail_asset
        self.assertIsNone(svg_thumbnail_asset(self.svg('<!DOCTYPE svg [<!ENTITY x "danger">]><svg>&x;</svg>')))
        self.assertIsNone(svg_thumbnail_asset(self.svg('<svg>'+('a'*150000)+'</svg>')))
        self.assertIsNone(svg_thumbnail_asset({'thumbnail':{'data_url':'data:image/svg+xml;base64,not valid'}}))
    def test_non_svg_thumbnails_are_not_transformed(self):
        from backend.services.marketplace_thumbnail_service import svg_thumbnail_asset
        self.assertIsNone(svg_thumbnail_asset({'thumbnail':{'data_url':'data:image/png;base64,AAAA'}}))


class MarketplaceThumbnailApiTests(unittest.TestCase):
    svg=MarketplaceThumbnailSvgTests.svg
    def setUp(self):
        from backend.routers.marketplace_thumbnails import router
        app=FastAPI();app.include_router(router);self.client=TestClient(app)
    def test_only_public_approved_thumbnail_is_served_with_csp(self):
        item={**self.svg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#f00"/></svg>'),'status':'approved'}
        with patch('backend.routers.marketplace_thumbnails.model_marketplace_service.get_listing',return_value=item) as get:
            r=self.client.get('/api/marketplace/product/model/seed-id/thumbnail')
            self.assertEqual(r.status_code,200);self.assertIn('sandbox',r.headers['content-security-policy']);self.assertEqual(r.headers['x-content-type-options'],'nosniff')
            get.assert_called_once_with('seed-id',user_id=None,include_pending=False)
    def test_private_unknown_and_non_svg_records_return_404(self):
        for item in (None,{'status':'pending',**self.svg('<svg/>')},{'status':'approved','thumbnail':{'data_url':''}}):
            with patch('backend.routers.marketplace_thumbnails.model_marketplace_service.get_listing',return_value=item):
                self.assertEqual(self.client.get('/api/marketplace/product/model/not-public/thumbnail').status_code,404)
        self.assertEqual(self.client.get('/api/marketplace/product/unknown/x/thumbnail').status_code,404)
    def test_attached_model_is_rendered_as_png_when_no_svg_exists(self):
        item={'id':'model-id','status':'approved','thumbnail':{'data_url':''},'files':[{'name':'part.glb','source':'attached'}]}
        png=b'\x89PNG\r\n\x1a\npreview'
        with patch('backend.routers.marketplace_thumbnails.model_marketplace_service.get_listing',return_value=item),patch('backend.routers.marketplace_thumbnails.model_thumbnail_asset',return_value=png):
            response=self.client.get('/api/marketplace/product/model/model-id/thumbnail')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['content-type'],'image/png')
        self.assertEqual(response.content,png)
    def test_catalog_uses_safe_endpoint_for_svg_but_keeps_raster_data(self):
        from backend.services.marketplace_catalog_service import _thumb_url
        item={'id':'seed-id',**self.svg('<svg/>')}
        self.assertEqual(_thumb_url(item,kind='model'),'/api/marketplace/product/model/seed-id/thumbnail')
        self.assertEqual(_thumb_url({'thumbnail':{'data_url':'data:image/png;base64,AAAA'}}),'data:image/png;base64,AAAA')
