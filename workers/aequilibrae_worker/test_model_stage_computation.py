"""Computed records survive retry while interrupted starts refuse recomputation."""
from pathlib import Path
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock
import model_stage_computation as checkpoint

ARGS=dict(base_url='http://127.0.0.1:54321',deployment_id='synthetic',run_id='11111111-1111-4111-8111-111111111111',stage_id='22222222-2222-4222-8222-222222222222',name='synthetic-assessment-v1',inputs={'source_sha256':'a'*64,'method_version':1})


class ComputationTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.directory=Path(temp.name)/'journal'

    def test_saved_result_is_detached_and_reused_in_fresh_process(self):
        original={'assessment_id':'synthetic-id','outcome':'inconclusive','nested':{'value':1}}
        callback=Mock(return_value=original)
        first=checkpoint.compute_once(self.directory,**ARGS,compute=callback)
        original['nested']['value']=2;first['nested']['value']=3
        code="import json,sys;from pathlib import Path;import model_stage_computation as c;v=json.load(sys.stdin);print(json.dumps(c.compute_once(Path(v['directory']),**v['args'],compute=lambda: (_ for _ in ()).throw(AssertionError('recomputed')))))"
        r=subprocess.run([sys.executable,'-B','-c',code],input=json.dumps({'directory':str(self.directory),'args':ARGS}),text=True,capture_output=True,cwd=Path(__file__).parent,timeout=15)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(json.loads(r.stdout),{'assessment_id':'synthetic-id','outcome':'inconclusive','nested':{'value':1}})
        callback.assert_called_once()

    def test_changed_inputs_refused_but_distinct_destination_is_independent(self):
        checkpoint.compute_once(self.directory,**ARGS,compute=lambda:{'value':1})
        callback=Mock(return_value={'value':2})
        with self.assertRaisesRegex(checkpoint.ComputationUnconfirmed,'inputs changed'):
            checkpoint.compute_once(self.directory,**{**ARGS,'inputs':{'method_version':2}},compute=callback)
        callback.assert_not_called()
        result=checkpoint.compute_once(self.directory,**{**ARGS,'deployment_id':'other'},compute=callback)
        self.assertEqual(result,{'value':2})

    def test_process_loss_leaves_start_and_prevents_second_computation(self):
        code="import json,sys,os;from pathlib import Path;import model_stage_computation as c;v=json.load(sys.stdin);c.compute_once(Path(v['directory']),**v['args'],compute=lambda:os._exit(19))"
        r=subprocess.run([sys.executable,'-B','-c',code],input=json.dumps({'directory':str(self.directory),'args':ARGS}),text=True,capture_output=True,cwd=Path(__file__).parent,timeout=15)
        self.assertEqual(r.returncode,19,r.stderr)
        callback=Mock(return_value={'value':'recomputed'})
        with self.assertRaisesRegex(checkpoint.ComputationUnconfirmed,'previously started'):
            checkpoint.compute_once(self.directory,**ARGS,compute=callback)
        callback.assert_not_called()

    def test_changed_saved_bytes_are_refused(self):
        checkpoint.compute_once(self.directory,**ARGS,compute=lambda:{'value':1})
        with sqlite3.connect(self.directory/'model-commands.sqlite3') as db:
            db.execute("UPDATE stage_computations SET result_json=?",('{"value":2}',))
        with self.assertRaisesRegex(checkpoint.ComputationUnconfirmed,'digest differs'):
            checkpoint.compute_once(self.directory,**ARGS,compute=lambda:self.fail('recomputed'))

    def test_changed_checkpoint_before_save_refuses_result(self):
        def compute():
            with sqlite3.connect(self.directory/'model-commands.sqlite3') as db:
                db.execute("UPDATE stage_computations SET inputs_json='{}'")
            return {'value':1}
        with self.assertRaisesRegex(checkpoint.ComputationUnconfirmed,'changed before result retention'):
            checkpoint.compute_once(self.directory,**ARGS,compute=compute)

    def test_invalid_result_leaves_start_and_invalid_input_never_starts(self):
        with self.assertRaises(ValueError):checkpoint.compute_once(self.directory,**{**ARGS,'inputs':{'value':float('nan')}},compute=lambda:{})
        self.assertFalse(self.directory.exists())
        with self.assertRaisesRegex(checkpoint.ComputationUnconfirmed,'return an object'):
            checkpoint.compute_once(self.directory,**ARGS,compute=lambda:[])
        with self.assertRaisesRegex(checkpoint.ComputationUnconfirmed,'previously started'):
            checkpoint.compute_once(self.directory,**ARGS,compute=lambda:{})

if __name__=='__main__':unittest.main()
