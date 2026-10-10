"""All immutable upload families require exact authenticated readback."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from worker_import_for_tests import import_worker_main

main = import_worker_main()


class ImmutableUploadRecoveryTests(unittest.TestCase):
    def exercise(self, post_error=None, read_status=200, read_bytes=b'fixture', read_error=None):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'record.json'; path.write_bytes(b'fixture')
            calls=(lambda:main.upload_immutable_validation_json('run','assessment',str(path)),
                   lambda:main.upload_immutable_structural_demand_json('run','diagnosis',str(path)),
                   lambda:main.upload_content_addressed_artifact('run','stage','record.json',b'fixture','application/json'))
            for invoke in calls:
                with self.subTest(invoke=invoke), patch.object(main.requests,'post',return_value=Mock(status_code=409),side_effect=post_error) as post, patch.object(main.requests,'get',return_value=Mock(status_code=read_status,content=read_bytes),side_effect=read_error) as get:
                    if read_status!=200 or read_bytes!=b'fixture' or read_error:
                        with self.assertRaises(main.WorkerStateWriteUnconfirmed): invoke()
                    else:
                        self.assertTrue(invoke().startswith('storage://run-artifacts/model-runs/run/'))
                    post.assert_called_once(); get.assert_called_once()
                    self.assertEqual(post.call_args.kwargs['headers']['x-upsert'],'false')
                    self.assertIs(post.call_args.kwargs['allow_redirects'],False)
                    self.assertIs(get.call_args.kwargs['allow_redirects'],False)
                    self.assertIn('/object/authenticated/run-artifacts/',get.call_args.args[0])
                    self.assertEqual(get.call_args.kwargs['headers']['Authorization'], post.call_args.kwargs['headers']['Authorization'])

    def test_exact_retry(self): self.exercise()
    def test_lost_upload_reply(self): self.exercise(post_error=main.requests.Timeout('synthetic lost reply'))
    def test_changed_bytes_refused(self): self.exercise(read_bytes=b'changed')
    def test_unavailable_read_refused(self): self.exercise(read_status=503)
    def test_lost_read_reply(self): self.exercise(read_error=main.requests.Timeout('synthetic lost read'))


if __name__ == '__main__': unittest.main()
