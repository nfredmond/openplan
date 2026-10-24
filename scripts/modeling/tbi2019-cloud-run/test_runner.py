"""Exercise configuration refusal and failure publication without model execution."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import runner

ENV={'TBI_S3_ENDPOINT':'http://local-s3:5000','TBI_S3_BUCKET':'fixture','TBI_ARCHIVE_KEY':'archive',
     'TBI_RESULTS_PREFIX':'results','TBI_S3_ACCESS_KEY_ID':'fixture-id','TBI_S3_SECRET_ACCESS_KEY':'fixture-secret'}


class RunnerTests(unittest.TestCase):
    def test_valid_settings_survive_label_change(self):
        self.assertEqual(runner.validate_settings({**ENV,'TBI_RUN_ID':'harmless_label'}),('harmless_label','results'))

    def test_process_override_refused(self):
        with self.assertRaisesRegex(runner.Refusal,'four-process'):
            runner.validate_settings({**ENV,'TBI_NUM_PROCESSES':'8'})

    def test_missing_secret_refused(self):
        env=ENV.copy();del env['TBI_S3_SECRET_ACCESS_KEY']
        with self.assertRaisesRegex(runner.Refusal,'missing'):runner.validate_settings(env)

    def test_model_environment_excludes_credentials(self):
        with patch.dict(os.environ,ENV):
            env=runner.model_environment()
        self.assertFalse(any(k.startswith(('AWS','TBI')) for k in env))
        self.assertNotIn('fixture-secret',env.values())
        self.assertEqual(env['OPENBLAS_NUM_THREADS'],'1')

    def test_endpoint_credentials_refused(self):
        with self.assertRaisesRegex(runner.Refusal,'endpoint'):
            runner.validate_settings({**ENV,'TBI_S3_ENDPOINT':'https://user:secret@example.test'})

    def test_failed_verification_publishes_terminal_last_and_starts_no_engine(self):
        with tempfile.TemporaryDirectory() as tmp:
            package=Path(tmp); (package/'admission.json').write_text(json.dumps({
                'package_files':{},'full':{'inventory':'inventory.json','sha256':'0'*64,'bytes':1}}))
            events=[]
            class S3:
                def put_object(self,**kw):
                    events.append(('put',kw['Key'],kw['Body']))
                def download_file(self,bucket,key,path):Path(path).write_bytes(b'x')
                def upload_file(self,path,bucket,key,**kwargs):events.append(('upload',key,Path(path).read_bytes()))
            with patch.dict(os.environ,ENV,clear=True),patch.object(runner,'PACKAGE',package), \
                 patch.object(runner.boto3,'client',return_value=S3()),patch.object(runner,'run_stage') as model:
                code=runner.main()
            self.assertEqual(code,1);model.assert_not_called()
            self.assertTrue(events[-1][1].endswith('/terminal.json'))
            terminal=json.loads(events[-1][2]);self.assertEqual(terminal['step'],'archive_verification')
            self.assertEqual(terminal['status'],'failed');self.assertIn('manifest_sha256',terminal)
            self.assertNotIn('fixture-secret',repr(events))


if __name__=='__main__':unittest.main()
