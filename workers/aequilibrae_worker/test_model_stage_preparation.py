"""Exact stage identity preparation across process restart and concurrency."""
import copy
import json
from pathlib import Path
import subprocess
import sqlite3
import sys
import tempfile
import unittest
import model_stage_preparation as preparation

RUN='11111111-1111-4111-8111-111111111111'
STAGE='22222222-2222-4222-8222-222222222222'


class StagePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name)/'journal'
        self.args=dict(base_url='http://127.0.0.1:54321',deployment_id='synthetic',run_id=RUN,stage_id=STAGE,source_files={'link_volumes':{'sha256':'a'*64,'size_bytes':10}},inputs={'setting':1})

    def test_repeated_input_retains_identity_and_detaches_values(self):
        first=preparation.prepare(self.directory,**self.args)
        self.assertEqual(preparation.prepare(self.directory,**self.args),first)
        self.args['inputs']['setting']=2
        self.assertEqual(first['inputs'],{'setting':1})
        with self.assertRaisesRegex(ValueError,'inputs changed'):
            preparation.prepare(self.directory,**self.args)

    def test_changed_bytes_and_scope(self):
        first=preparation.prepare(self.directory,**self.args)
        for facts in ({'sha256':'b'*64,'size_bytes':10},{'sha256':'a'*64,'size_bytes':11}):
            changed=copy.deepcopy(self.args);changed['source_files']['link_volumes']=facts
            with self.assertRaisesRegex(ValueError,'inputs changed'):preparation.prepare(self.directory,**changed)
        other=preparation.prepare(self.directory,**{**self.args,'deployment_id':'other'})
        self.assertNotEqual(first['output_artifact_id'],other['output_artifact_id'])

    def test_independent_concurrent_processes_keep_one_identity(self):
        code='''import json,sys
from pathlib import Path
import model_stage_preparation as p
v=json.load(sys.stdin)
print(json.dumps(p.prepare(Path(v['directory']),**v['arguments'])))'''
        value=json.dumps({'directory':str(self.directory),'arguments':self.args})
        processes=[]
        try:
            for _ in range(4):
                process=subprocess.Popen([sys.executable,'-B','-c',code],cwd=Path(__file__).parent,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                process.stdin.write(value);process.stdin.close();process.stdin=None
                processes.append(process)
            records=[]
            for process in processes:
                stdout,stderr=process.communicate(timeout=15)
                self.assertEqual(process.returncode,0,stderr)
                records.append(json.loads(stdout))
            self.assertTrue(all(value==records[0] for value in records))
            self.assertEqual(preparation.prepare(self.directory,**self.args),records[0])
        finally:
            for process in processes:
                if process.poll() is None:process.communicate(timeout=20)

    def test_corrupt_saved_identity_is_refused(self):
        preparation.prepare(self.directory,**self.args)
        connection=sqlite3.connect(self.directory/'model-commands.sqlite3')
        try:
            with connection:
                connection.execute("UPDATE stage_preparations SET output_artifact_id='invalid'")
        finally:connection.close()
        with self.assertRaises(ValueError):preparation.prepare(self.directory,**self.args)

    def test_invalid_source_and_nonfinite_input_do_not_create_journal(self):
        for facts in ({'sha256':'invalid','size_bytes':10},{'sha256':'a'*64,'size_bytes':True}):
            changed=copy.deepcopy(self.args);changed['source_files']['link_volumes']=facts
            with self.assertRaises(ValueError):preparation.prepare(self.directory,**changed)
        changed=copy.deepcopy(self.args);changed['inputs']['setting']=float('nan')
        with self.assertRaises(ValueError):preparation.prepare(self.directory,**changed)
        self.assertFalse(self.directory.exists())


if __name__=='__main__':unittest.main()
