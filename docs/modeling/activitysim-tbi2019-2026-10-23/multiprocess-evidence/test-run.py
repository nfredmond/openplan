"""Check cohort, process-count, exact-comparison and stop boundaries."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('multiprocess_run',E/'run.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Admission(unittest.TestCase):
    def test_declared_config(self):
        m.validate_settings(m.settings('current','prefix'),m.settings('current','suffix'))

    def test_refuse_sliced_or_chunked_suffix(self):
        for key,value in [('multiprocess',True),('chunk_size',1),('chunk_training_mode','production'),('resume_after','school_location')]:
            with self.subTest(key=key):
                suffix=m.settings('current','suffix'); suffix[key]=value
                with self.assertRaisesRegex(RuntimeError,'Trip scheduling'):
                    m.validate_settings(m.settings('current','prefix'),suffix)

    def test_refuse_scheduling_in_prefix(self):
        prefix=m.settings('current','prefix'); prefix['models'].append('trip_scheduling')
        with self.assertRaisesRegex(RuntimeError,'Trip scheduling'):
            m.validate_settings(prefix,m.settings('current','suffix'))

    def test_refuse_changed_process_count(self):
        prefix=m.settings('current','prefix'); prefix['multiprocess_steps'][1]['num_processes']=6
        with self.assertRaisesRegex(RuntimeError,'Household slicing'):
            m.validate_settings(prefix,m.settings('current','suffix'))

    def test_refuse_changed_slice(self):
        prefix=m.settings('current','prefix'); prefix['multiprocess_steps'][1]['slice']={'tables':['persons']}
        with self.assertRaisesRegex(RuntimeError,'Household slicing'):
            m.validate_settings(prefix,m.settings('current','suffix'))

    def test_reference_custody(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); reference=root/'reference'; reference.mkdir()
            (reference/'final_trips.csv').write_text('trip_id,depart\n1,10\n')
            (root/'criterion-before-run.json').write_text(json.dumps({'references':{'current':{'path':str(reference),'hashes':{'final_trips.csv':'wrong'}}}}))
            with patch.object(m,'R',root),self.assertRaisesRegex(RuntimeError,'Reference changed'):
                m.compare('current',root)

    def test_exact_failure_retained(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); reference=root/'reference'; reference.mkdir()
            (root/'criterion-before-run.json').write_text(json.dumps({'references':{'current':{'path':str(reference),'hashes':{}}}}))
            with patch.object(m,'R',root),patch.object(m,'compare_tables',side_effect=AssertionError('exact cell differs')):
                with self.assertRaisesRegex(AssertionError,'exact cell differs'):
                    m.compare('current',reference)
            self.assertEqual(json.loads((root/'current-comparison.json').read_text())['status'],'failed_exact_parity')

    def test_engine_failure_stops_before_suffix_and_second_arm(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'status.json').write_text(json.dumps({'parity':{'current':'not_run','semcog':'not_run'}}))
            cache=root/'cache.csv'; cache.write_text('synthetic cache')
            with patch.object(m,'R',root),patch.object(m.prior,'CACHE',cache),patch.object(m.prior,'run_stage',side_effect=RuntimeError('synthetic stage failure')) as stage:
                with self.assertRaisesRegex(RuntimeError,'synthetic stage failure'):
                    m.parity()
            self.assertEqual(stage.call_count,1)
            state=json.loads((root/'status.json').read_text())
            self.assertEqual(state['parity'],{'current':'failed','semcog':'not_run'})
            self.assertFalse((root/'parity-semcog').exists())

    def test_prepare_refuses_changed_engine(self):
        real_digest=m.digest
        def changed(path):
            return 'wrong' if str(path).endswith('activitysim/core/assign.py') else real_digest(path)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'new'
            with patch.object(m,'R',root),patch.object(m.prior,'verify'),patch.object(m,'digest',side_effect=changed):
                with self.assertRaisesRegex(RuntimeError,'Installed source custody mismatch'):
                    m.prepare()

    def test_prepare_refuses_changed_reference(self):
        real_digest=m.digest
        def changed(path):
            return 'wrong' if 'r2-2000-current-reference' in str(path) else real_digest(path)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'new'
            with patch.object(m,'R',root),patch.object(m.prior,'verify'),patch.object(m,'digest',side_effect=changed):
                with self.assertRaisesRegex(RuntimeError,'Reference custody mismatch'):
                    m.prepare()

    def test_cache_refusal_stops_suffix(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'status.json').write_text(json.dumps({'parity':{'current':'not_run','semcog':'not_run'}}))
            cache=root/'cache.csv'; cache.write_text('synthetic cache')
            (root/'mp4-current-prefix.engine.log').write_text('Running chunk 2 of 2\ninitial_row_size is zero\n')
            (root/'mp4-semcog-prefix.engine.log').write_text('Running chunk 2 of 2\n')
            with patch.object(m,'R',root),patch.object(m.prior,'CACHE',cache),patch.object(m.prior,'run_stage') as stage,patch.object(m,'compare'):
                with self.assertRaisesRegex(RuntimeError,'Production cache coverage missing'):
                    m.parity()
            self.assertEqual(stage.call_count,1)

    def test_parity_failure_stops_second_arm(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'status.json').write_text(json.dumps({'parity':{'current':'not_run','semcog':'not_run'}}))
            cache=root/'cache.csv'; cache.write_text('synthetic cache')
            (root/'mp4-current-prefix.engine.log').write_text('Running chunk 2 of 2\n')
            with patch.object(m,'R',root),patch.object(m.prior,'CACHE',cache),patch.object(m.prior,'run_stage') as stage,patch.object(m,'compare',side_effect=AssertionError('exact departure differs')):
                with self.assertRaisesRegex(AssertionError,'exact departure differs'):
                    m.parity()
            self.assertEqual(stage.call_count,2)
            state=json.loads((root/'status.json').read_text())
            self.assertEqual(state['parity'],{'current':'failed','semcog':'not_run'})


if __name__=='__main__':
    unittest.main()
