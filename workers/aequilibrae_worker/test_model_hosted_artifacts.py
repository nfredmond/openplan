"""Hosted mirrors keep exact bytes and leave local handoff custody unchanged."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import model_hosted_artifacts as mirrors

RUN = "11111111-1111-4111-8111-111111111111"
STAGE = "22222222-2222-4222-8222-222222222222"


class HostedArtifactTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.source = self.root / "runs" / RUN / "run_output" / "link_volumes.csv"
        self.source.parent.mkdir(parents=True)
        self.data = b"link_id,volume\n1,42\n"
        self.source.write_bytes(self.data)
        self.payload = dict(run_id=RUN, stage_id=STAGE, file_url="local://" + str(self.source),
                            content_hash=hashlib.sha256(self.data).hexdigest(), file_size_bytes=len(self.data))

    def test_uploaded_bytes_match_registered_identity_and_keep_local_reference(self):
        before = dict(self.payload)
        upload = Mock(return_value="storage://run-artifacts/synthetic")
        self.assertEqual(mirrors.mirror_registered(self.root, self.payload, upload), upload.return_value)
        upload.assert_called_once_with(
            f"model-runs/{RUN}/stages/{STAGE}/sha256-{self.payload['content_hash']}/link_volumes.csv",
            self.data, "text/csv")
        self.assertEqual(self.payload, before)
        self.assertEqual(self.source.read_bytes(), self.data)
        self.assertEqual(list((self.root / "runs" / RUN).glob(".hosted-mirror-*")), [])

    def test_changed_bytes_and_cross_run_source_never_upload(self):
        upload = Mock()
        self.source.write_bytes(b"link_id,volume\n1,43\n")
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            mirrors.mirror_registered(self.root, self.payload, upload)
        self.source.write_bytes(self.data)
        foreign = self.root / "foreign.csv"
        foreign.write_bytes(self.data)
        with self.assertRaises(ValueError):
            mirrors.mirror_registered(self.root, {**self.payload, "file_url": "local://" + str(foreign)}, upload)
        upload.assert_not_called()

    def test_failed_verification_propagates_without_modifying_original(self):
        upload = Mock(side_effect=RuntimeError("stored byte receipt missing"))
        with self.assertRaisesRegex(RuntimeError, "receipt missing"):
            mirrors.mirror_registered(self.root, self.payload, upload)
        self.assertEqual(self.source.read_bytes(), self.data)

    def test_lost_upload_reply_is_resolved_only_by_exact_private_bytes(self):
        import requests
        env = {"SUPABASE_URL": "http://127.0.0.1:54321", "SUPABASE_SERVICE_ROLE_KEY": "synthetic"}
        retained = Mock(status_code=200, content=self.data)
        with patch.dict("os.environ", env), patch.object(requests, "post", side_effect=requests.Timeout), \
                patch.object(requests, "get", return_value=retained) as read:
            self.assertEqual(mirrors.configured_upload("synthetic.csv", self.data, "text/csv"),
                             "storage://run-artifacts/synthetic.csv")
            self.assertIn("/object/authenticated/run-artifacts/", read.call_args.args[0])
            retained.content = b"foreign bytes"
            with self.assertRaisesRegex(RuntimeError, "unconfirmed"):
                mirrors.configured_upload("synthetic.csv", self.data, "text/csv")
        self.assertEqual(retained.close.call_count, 2)


if __name__ == "__main__":
    unittest.main()
