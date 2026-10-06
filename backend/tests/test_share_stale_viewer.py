import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import main

class StaleShareViewerTests(unittest.TestCase):
    def test_missing_stored_viewer_uses_existing_model_glb(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'part.step').write_text('ISO-10303-21;')
            (root/'part.glb').write_bytes(b'glTF'+b'\0'*64)
            share={'filename':'part.step','viewer_filename':'removed.glb','assembly_filename':'removed.glb','share_mode':'view'}
            with patch.object(main,'_resolve_share_token',return_value=('test',root,share)), patch.object(main.project_store,'load_meta',return_value={'name':'Fixture'}), patch.object(main,'_share_preview_image_meta',return_value={}), patch.object(main,'_share_snapshot_filename',return_value=None):
                result=main._share_metadata('fixture')
            self.assertEqual(result['viewer_filename'],'part.glb')
            self.assertIn('part.glb',result['viewer_url'])

    def test_downloadable_share_lists_lazy_3mf_but_view_only_does_not(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'part.glb').write_bytes(b'glTF' + b'\0' * 64)

            def metadata_for(mode):
                share = {'filename': 'part.glb', 'share_mode': mode}
                with patch.object(main, '_resolve_share_token', return_value=('test', root, share)), patch.object(main.project_store, 'load_meta', return_value={'name': 'Fixture'}), patch.object(main, '_share_preview_image_meta', return_value={}), patch.object(main, '_share_snapshot_filename', return_value=None):
                    return main._share_metadata('fixture')

            downloadable = metadata_for('edit')
            three_mf = next(item for item in downloadable['exports'] if item['format'] == '3mf')
            self.assertTrue(three_mf['convertible'])
            self.assertEqual(three_mf['size'], 0)
            self.assertEqual(three_mf['url'], '/api/share/fixture/files/part.3mf')
            self.assertEqual(metadata_for('view')['exports'], [])
