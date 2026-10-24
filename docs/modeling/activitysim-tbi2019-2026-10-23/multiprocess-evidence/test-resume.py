"""Exercise stock checkpoint custody, suffix isolation and replay stop behavior."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('replay_tests',E/'replay.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Recovery(unittest.TestCase):
    def test_valid_suffix(self):
        m.r.validate_suffix(m.r.suffix_settings('current'))

    def test_refuse_wrong_suffix(self):
        for key,value in [('resume_after','trip_purpose_and_destination'),('models',['initialize_households','trip_scheduling']),('multiprocess',True),('chunk_size',1),('chunk_training_mode','production')]:
            with self.subTest(key=key):
                settings=m.r.suffix_settings('current'); settings[key]=value
                with self.assertRaisesRegex(RuntimeError,'Suffix must restore'):
                    m.r.validate_suffix(settings)

    def test_valid_checkpoint(self):
        with patch.object(m.pd,'read_parquet',return_value=pd.DataFrame({'checkpoint_name':['init','mp_households']})):
            m.check_checkpoint(Path('/synthetic'))

    def test_refuse_missing_checkpoint(self):
        with patch.object(m.pd,'read_parquet',return_value=pd.DataFrame({'checkpoint_name':['init']})):
            with self.assertRaisesRegex(RuntimeError,'Missing coalesced checkpoint'):
                m.check_checkpoint(Path('/synthetic'))

    def test_copy_custody_refuses_changed_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'criterion-before-run.json').write_text(json.dumps({'criterion':'exact'}))
            (root/'status.json').write_text('{}')
            (root/'parity-current').mkdir(); (root/'parity-current'/'checkpoint').write_text('frozen')
            for arm in ['current','semcog']:
                (root/f'config-{arm}-suffix').mkdir()
            real=m.r.m.digest
            def changed(path):
                return 'changed' if 'parity-current-r2' in str(path) else real(path)
            with patch.object(m.r,'R',root),patch.object(m.r.m,'R',root),patch.object(m.r.m,'digest',side_effect=changed):
                with self.assertRaisesRegex(RuntimeError,'Copied checkpoint custody differs'):
                    m.r.prepare()

    def test_parity_failure_stops_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); cache=root/'cache.csv'; cache.write_text('synthetic cache')
            (root/'status.json').write_text('{}'); (root/'criterion-before-run.json').write_text('{}')
            (root/'mp4-r3-current-prefix.engine.log').write_text('Running chunk 2 of 2\n')
            with patch.object(m,'R',root),patch.object(m.m,'R',root),patch.object(m.m.prior,'CACHE',cache),patch.object(m.m.prior,'run_stage') as stage,patch.object(m,'check_checkpoint'),patch.object(m.m,'compare',side_effect=AssertionError('synthetic parity failure')):
                with self.assertRaisesRegex(AssertionError,'synthetic parity failure'):
                    m.execute()
            self.assertEqual(stage.call_count,2)
            self.assertFalse((root/'parity-semcog-r3').exists())
            self.assertEqual(json.loads((root/'status.json').read_text())['parity'],{'current':'failed','semcog':'not_run'})


if __name__=='__main__':
    unittest.main()
