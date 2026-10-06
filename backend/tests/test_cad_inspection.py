import json
import tempfile
import unittest
from pathlib import Path
from backend.services.cad_inspection import prepare_inspection, record_inspection, inspection_status, REQUIRED_CHECKS

class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root/'part.step').write_text('fixture CAD bytes')
        (self.root/'measurements.json').write_text('{"fixture": true}')
        self.info = prepare_inspection(self.root, 'part.step')
    def review(self):
        return {'reviewer':'test-reviewer','artifact_revision':self.info['artifact_revision'],
                'checks':{n:{'status':'pass','reason':'fixture result','evidence':['measurements.json']} for n in REQUIRED_CHECKS}}
    def test_generation_is_not_inspection(self):
        self.assertFalse(self.info['all_passed'])
    def test_changed_model_invalidates_review(self):
        p=record_inspection(self.root,self.info['packet'],self.review())
        self.assertTrue(p['all_passed'])
        (self.root/'part.step').write_text('changed')
        self.assertEqual(inspection_status(self.root,p)['status'],'stale')
        with self.assertRaises(ValueError):record_inspection(self.root,self.info['packet'],self.review())
    def test_evidence_mutation_invalidates_pass(self):
        p=record_inspection(self.root,self.info['packet'],self.review())
        (self.root/'measurements.json').write_text('changed')
        self.assertFalse(inspection_status(self.root,p)['all_passed'])
    def test_missing_check_is_unverified(self):
        r=self.review();del r['checks']['dimensions']
        self.assertFalse(record_inspection(self.root,self.info['packet'],r)['all_passed'])
    def test_fail_blocks_pass(self):
        r=self.review();r['checks']['geometry']['status']='fail'
        self.assertEqual(record_inspection(self.root,self.info['packet'],r)['status'],'failed')
    def test_no_evidence_and_path_escape_rejected(self):
        for evidence in [[],['../outside.json']]:
            r=self.review();r['checks']['geometry']['evidence']=evidence
            with self.assertRaises(ValueError):record_inspection(self.root,self.info['packet'],r)
    def test_same_revision_preserves_review(self):
        record_inspection(self.root,self.info['packet'],self.review())
        self.assertTrue(prepare_inspection(self.root,'part.step')['all_passed'])
    def test_joint_change_invalidates_review(self):
        (self.root/'part.joints.json').write_text('{}')
        new=prepare_inspection(self.root,'part.step')
        self.assertNotEqual(new['artifact_revision'],self.info['artifact_revision'])
    def test_new_companion_invalidates_existing_verdict(self):
        packet=record_inspection(self.root,self.info['packet'],self.review())
        (self.root/'part.glb').write_bytes(b'new companion')
        self.assertEqual(inspection_status(self.root,packet)['status'],'stale')
