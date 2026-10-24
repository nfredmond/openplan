"""Exercise continuation refusals using synthetic final tables and stage calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

E=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('continuation',E/'run.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class Continuation(unittest.TestCase):
    def fixture(self,root):
        ref=root/'reference'; ref.mkdir(); out=root/'candidate'; out.mkdir()
        for table,key in m.IDENTITIES.items():
            for folder in [ref,out]:
                (folder/f'final_{table}.csv').write_text(f'{key},choice,mode_choice_logsum\n1,2,1.0\n')
        (root/'freeze.json').write_text(json.dumps({'references':{'current':{'path':str(ref),'hashes':{p.name:m.digest(p) for p in ref.iterdir()}}}}))
        return ref,out

    def test_exact_survives(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); ref,out=self.fixture(root)
            with patch.object(m,'R',root):
                self.assertEqual(len(m.compare('current',out)),7)

    def test_allowed_logsum_survives(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); ref,out=self.fixture(root)
            (out/'final_trips.csv').write_text('trip_id,choice,mode_choice_logsum\n1,2,1.0000000000000002\n')
            with patch.object(m,'R',root):
                self.assertEqual(len(m.compare('current',out)),7)

    def test_dtype_refusal(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); ref,out=self.fixture(root)
            (out/'final_trips.csv').write_text('trip_id,choice,mode_choice_logsum\n1,2.0,1.0\n')
            with patch.object(m,'R',root),self.assertRaisesRegex(RuntimeError,'dtype mismatch'):
                m.compare('current',out)

    def test_changed_choice_refusal(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); ref,out=self.fixture(root)
            (out/'final_trips.csv').write_text('trip_id,choice,mode_choice_logsum\n1,3,1.0\n')
            with patch.object(m,'R',root),self.assertRaises(AssertionError):
                m.compare('current',out)

    def test_reference_refusal(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); ref,out=self.fixture(root)
            (ref/'final_trips.csv').write_text('changed')
            with patch.object(m,'R',root),self.assertRaisesRegex(RuntimeError,'Reference custody'):
                m.compare('current',out)

    def test_full_refuses_missing_parity(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); (root/'status.json').write_text(json.dumps({'parity':{},'full':{a:{} for a in ['current','semcog']}}))
            with patch.object(m,'R',root),patch.object(m.prior,'verify'),patch.object(m,'execute_arm',return_value={}),self.assertRaisesRegex(RuntimeError,'Both parity'):
                m.full()

    def test_full_stops_after_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); (root/'status.json').write_text(json.dumps({'parity':{'current':'passed_choice_parity_retained','semcog':'passed_choice_parity'},'full':{a:{'status':'not_run'} for a in ['current','semcog']}}))
            with patch.object(m,'R',root),patch.object(m.prior,'verify'),patch.object(m,'execute_arm',side_effect=RuntimeError('synthetic cap')) as stage:
                with self.assertRaisesRegex(RuntimeError,'synthetic cap'):
                    m.full()
            self.assertEqual(stage.call_count,1)
            state=json.loads((root/'status.json').read_text())
            self.assertEqual(state['full']['semcog']['status'],'not_run')

    def test_engine_refusal(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(m,'R',Path(folder)/'new'),patch.object(m.prior,'verify'),patch.object(m,'digest',return_value='wrong'):
                with self.assertRaisesRegex(RuntimeError,'Installed engine changed'):
                    m.prepare()

    def test_stage_failure_and_cache_refusal(self):
        for failure in [True,False]:
            with tempfile.TemporaryDirectory() as folder:
                root=Path(folder); cache=root/'cache.csv'; cache.write_text('fixture')
                (root/'fullmp4-parity-semcog-prefix.engine.log').write_text('initial_row_size is zero')
                with patch.object(m,'R',root),patch.object(m.prior,'CACHE',cache),patch.object(m.prior,'run_stage',side_effect=RuntimeError('synthetic stage') if failure else None) as stage,patch.object(m.old,'check_checkpoint'),patch.object(m.old.r,'validate_suffix'),patch.object(m,'compare'):
                    with self.assertRaisesRegex(RuntimeError,'synthetic stage' if failure else 'Production cache'):
                        m.execute_arm('semcog',True)
                self.assertEqual(stage.call_count,1)

    def test_parity_failure_recorded(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); (root/'status.json').write_text(json.dumps({'parity':{'semcog':'not_run'}}))
            with patch.object(m,'R',root),patch.object(m,'execute_arm',side_effect=AssertionError('choice differs')):
                with self.assertRaisesRegex(AssertionError,'choice differs'):
                    m.parity()
            self.assertEqual(json.loads((root/'status.json').read_text())['parity']['semcog'],'failed')

    def test_monitor_boundaries(self):
        source=(E/'monitor.py').read_text()
        # Exercise the exact source branch in the stdout loop with retained log syntax.
        block=source[source.index('            match=re.match'):source.index('        code=proc.wait()')]
        import textwrap,re
        for message in ['#run_model running step workplace_location','Running trip_scheduling']:
            namespace={'re':re,'line':f'[00:03.17] 123 mp_households_0 INFO: {message}','labels':{},'stages':{}}
            exec(compile(textwrap.dedent(block),'<monitor branch>','exec'),namespace)
            self.assertEqual(namespace['stages'].get('123'),message)

if __name__=='__main__':
    unittest.main()
