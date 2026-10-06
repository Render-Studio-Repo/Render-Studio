from __future__ import annotations
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from backend.services import project_code_files as files, code_simulation_service as simulation


def upload(name, data): return SimpleNamespace(filename=name,file=io.BytesIO(data))
def archive(entries):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in entries.items(): z.writestr(name,data)
    return stream.getvalue()

class CodeWorkspaceFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'project';self.root.mkdir()
    def tearDown(self):self.temp.cleanup()
    def bundle(self):
        return files.import_bundle(self.root,[upload('robot.zip',archive({'src/main.ino':'void setup() {}','config.json':'{}','assets/photo.png':b'PNG','docs/readme.md':'hello'}))],name='Robot')
    def test_archive_keeps_source_images_and_hierarchy(self):
        result=self.bundle();tree=files.tree(self.root,result['root'])
        self.assertEqual(len(tree['files']),4)
        self.assertTrue((self.root/result['root']/'src/main.ino').is_file())
        refs=files.code_references(self.root)
        self.assertEqual(len(refs),4)
        self.assertTrue(all(r['folder'].startswith('Project Code/Robot') for r in refs))
    def test_traversal_is_atomic_and_rejected(self):
        for bad in ('../outside.py','/absolute.py','C:/outside.py','src/../../bad.py'):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):files.import_bundle(self.root,[upload('bad.zip',archive({'main.py':'print(1)',bad:'bad'}))])
                self.assertFalse(list((self.root/'references/Project Code').glob('.upload-*')))
        self.assertFalse((self.root.parent/'outside.py').exists())
    def test_zip_symlink_and_case_duplicate_rejected(self):
        blob=io.BytesIO()
        with zipfile.ZipFile(blob,'w') as z:
            link=zipfile.ZipInfo('link.py');link.create_system=3;link.external_attr=(0o120777<<16);z.writestr(link,'../../private')
        with self.assertRaises(ValueError):files.import_bundle(self.root,[upload('symlink.zip',blob.getvalue())])
        with self.assertRaises(ValueError):files.import_bundle(self.root,[upload('same.zip',archive({'main.py':'a','MAIN.py':'b'}))])
    def test_duplicate_folder_upload_never_overwrites(self):
        one=self.bundle();two=self.bundle();self.assertNotEqual(one['root'],two['root'])
    def test_unrecognized_zip_remains_cad_import(self):
        stream=io.BytesIO(archive({'part.step':'CAD','photo.png':'image'}));self.assertFalse(files.archive_is_code(stream));self.assertEqual(stream.tell(),0)
    def test_folder_file_paths_preserved(self):
        result=files.import_bundle(self.root,[upload('main.py',b'x=1'),upload('image.png',b'PNG')],paths=['robot/src/main.py','robot/image.png'])
        self.assertTrue((self.root/result['root']/'src/main.py').exists())
    def test_revision_conflict_does_not_destroy_newer_edit(self):
        result=self.bundle();name=result['root']+'/config.json';old=files.read_text(self.root,name)
        saved=files.save_text(self.root,name,'{"new":1}',old['revision'])
        with self.assertRaises(FileExistsError):files.save_text(self.root,name,'stale',old['revision'])
        self.assertEqual(files.read_text(self.root,name)['content'],'{"new":1}')
        self.assertNotEqual(saved['revision'],old['revision'])
    def test_only_reference_paths_and_no_symlinks(self):
        (self.root/'private.py').write_text('private')
        refs=self.root/'references';refs.mkdir();(refs/'linked.py').symlink_to(self.root/'private.py')
        for path in ('private.py','references/../private.py','references/linked.py'):
            with self.assertRaises(ValueError):files.read_text(self.root,path)
        self.assertEqual(files.tree(self.root)['files'],[])
    def test_project_tree_lists_empty_reference_folders_and_only_safe_root_file(self):
        (self.root/'project.json').write_text('{"name":"OpenArm Demo"}')
        (self.root/'generation.json').write_text('{"private":true}')
        (self.root/'references/Training Data/episodes').mkdir(parents=True)
        (self.root/'references/Demos').mkdir()
        manifest=files.tree(self.root,'project')
        self.assertEqual(manifest['project'],{'id':'project','name':'OpenArm Demo'})
        self.assertEqual([row['path'] for row in manifest['files']],['project.json'])
        self.assertEqual([row['path'] for row in manifest['entries']],[
            'project.json','references','references/Demos','references/Training Data','references/Training Data/episodes'])
        self.assertFalse(manifest['files'][0]['editable'])
    def test_project_json_can_be_previewed_but_never_saved(self):
        (self.root/'project.json').write_text('{"name":"Safe metadata"}')
        opened=files.read_text(self.root,'project.json')
        self.assertEqual(json.loads(opened['content'])['name'],'Safe metadata')
        with self.assertRaisesRegex(ValueError,'read only'):
            files.save_text(self.root,'project.json','{}',opened['revision'])
        with self.assertRaises(ValueError):
            files.read_text(self.root,'generation.json')
    def test_xlsx_can_preview_multiple_worksheets_and_escaped_cells(self):
        ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        data=archive({'main.py':'# companion',
          'sheets.xlsx':archive({
            'xl/workbook.xml':f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pins" r:id="r1"/><sheet name="Bill of materials" r:id="r2"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/pins.xml"/><Relationship Id="r2" Target="/xl/worksheets/bom.xml"/></Relationships>',
            'xl/worksheets/pins.xml':f'<worksheet xmlns="{ns}"><sheetData><row><c r="A1" t="inlineStr"><is><t>Pin &amp; value</t></is></c><c r="C1"><v>13</v></c></row></sheetData></worksheet>',
            'xl/worksheets/bom.xml':f'<worksheet xmlns="{ns}"><sheetData><row><c r="A1" t="inlineStr"><is><t>Servo</t></is></c></row></sheetData></worksheet>'})})
        result=files.import_bundle(self.root,[upload('sheet.zip',data)])
        path=result['root']+'/sheets.xlsx'
        self.assertEqual(files.spreadsheet(self.root,path)['rows'][0],['Pin & value','','13'])
        self.assertEqual(files.spreadsheet(self.root,path,1)['rows'][0],['Servo'])

class CodeSimulationTests(unittest.TestCase):
    def setUp(self):self.wiring={'components':[{'id':'board','type':'arduino-uno'},{'id':'led1','type':'led'}],'wires':[]}
    def test_wrong_library_hardware_blocks_before_ai(self):
        source=[{'path':'main.ino','content':'#include <Servo.h>\nServo arm;'}]
        check=simulation.preflight(source,self.wiring);self.assertFalse(check['compatible']);self.assertIn('Servo.h',check['mismatches'][0])
        ai=Mock();result=simulation.generate_plan(ai,source,self.wiring);self.assertFalse(result['compatible']);ai._call_model.assert_not_called()
    def test_wrong_board_is_rejected(self):
        check=simulation.preflight([{'path':'main.py','content':'import RPi.GPIO as GPIO'}],self.wiring)
        self.assertFalse(check['compatible'])
    def test_matching_visual_plan_and_source_revision(self):
        source=[{'path':'main.ino','content':'void setup() {} void loop() {digitalWrite(13,HIGH);delay(500);}'}]
        ai=Mock();plan={'compatible':True,'summary':'LED on pin 13','repeat':True,'actions':[{'component_id':'led1','action':'led','value':1,'duration_ms':500}]}
        ai._call_model.return_value=(json.dumps(plan),{});ai._json_payload.side_effect=lambda s:s
        result=simulation.generate_plan(ai,source,self.wiring)
        self.assertTrue(result['compatible']);self.assertEqual(len(result['source_revision']),64)
    def test_ai_cannot_invent_hardware_or_execute_source(self):
        for action in ({'component_id':'missing','action':'led','value':1,'duration_ms':500}, {'component_id':'led1','action':'servo','value':90,'duration_ms':500}, {'component_id':'led1','action':'exec','value':1,'duration_ms':500}, {'component_id':'led1','action':'led','value':1,'duration_ms':0}):
            with self.subTest(action=action),self.assertRaises(ValueError):simulation.validate_plan({'compatible':True,'actions':[action]},self.wiring)
    def test_uncertain_match_does_not_run(self):
        result=simulation.validate_plan({'compatible':True,'mismatches':['Missing sensor library'],'actions':[]},self.wiring)
        self.assertFalse(result['compatible'])

if __name__=='__main__':unittest.main()
