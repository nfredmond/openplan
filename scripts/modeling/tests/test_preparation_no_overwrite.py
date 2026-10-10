"""Development preparation preserves existing freezes and partial evidence."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import prepare_development_validation_instruments as preparation
from validation_instrument import InstrumentError


class PreparationCustodyTests(unittest.TestCase):
    def test_network_copy_reuses_identical_bytes_and_refuses_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); source=root/'source'; target=root/'retained'
            source.write_bytes(b'original network')
            preparation._copy_exact(source,target)
            inode=target.stat().st_ino
            preparation._copy_exact(source,target)
            self.assertEqual(target.stat().st_ino,inode)
            source.write_bytes(b'changed network')
            with self.assertRaisesRegex(InstrumentError,'Existing preparation source differs'):
                preparation._copy_exact(source,target)
            self.assertEqual(target.read_bytes(),b'original network')

    def test_dangling_target_is_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';target=root/'retained';missing=root/'missing'
            source.write_bytes(b'network');target.symlink_to(missing)
            with self.assertRaisesRegex(InstrumentError,'Preparation target already exists'):
                preparation._copy_exact(source,target)
            self.assertFalse(missing.exists())

    def registry(self,root):
        registry=root/'registry.json'
        registry.write_text(json.dumps({'schema':'openplan.development-validation-instrument-study.v2',
            'study_id':'fixture','counties':[{'geography_id':'fixture'}]}))
        return registry

    def test_existing_output_refuses_before_acquisition_and_preserves_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);registry=self.registry(root);output=root/'output';output.mkdir()
            frozen=output/'instrument-readiness.json';frozen.write_bytes(b'original frozen record')
            with patch.object(preparation,'prepare_one',return_value={'geography_id':'fixture','ready':True}) as acquire:
                with self.assertRaisesRegex(InstrumentError,'Preparation output already exists'):
                    preparation.prepare_all(root,registry,output)
                acquire.assert_not_called()
            self.assertEqual(frozen.read_bytes(),b'original frozen record')
            self.assertEqual(list(output.iterdir()),[frozen])

    def test_fresh_output_writes_readiness_and_failed_acquisition_is_not_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);registry=self.registry(root)
            with patch.object(preparation,'prepare_one',return_value={'geography_id':'fixture','ready':True}) as acquire:
                result=preparation.prepare_all(root,registry,root/'fresh')
                acquire.assert_called_once()
                self.assertEqual(result,json.loads((root/'fresh/instrument-readiness.json').read_text()))
            partial=root/'partial'
            with patch.object(preparation,'prepare_one',side_effect=InstrumentError('source unavailable')):
                with self.assertRaisesRegex(InstrumentError,'source unavailable'):
                    preparation.prepare_all(root,registry,partial)
            self.assertTrue(partial.is_dir())
            with patch.object(preparation,'prepare_one',return_value={'geography_id':'fixture','ready':True}) as acquire:
                with self.assertRaisesRegex(InstrumentError,'Preparation output already exists'):
                    preparation.prepare_all(root,registry,partial)
                acquire.assert_not_called()


if __name__=='__main__':unittest.main()
