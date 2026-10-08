"""Exercise the normal dispatcher with colliding historical path prefixes."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from worker_import_for_tests import import_worker_main

main = import_worker_main()
IDS = ['12345678-1234-4123-8123-123456789abc', '12345678-1234-4567-8567-987654321abc']

class ScratchIdentityTests(unittest.TestCase):
    def test_normal_setup_retains_separate_files_and_ignores_legacy_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            legacy = root / 'runs' / IDS[0][:12]
            legacy.mkdir(parents=True)
            (legacy / 'state.json').write_text('unknown historical owner')
            def setup(run_id, stage_id, work_dir, bbox, package):
                Path(work_dir, 'owned-output.txt').write_text(run_id)
                return {'log': 'synthetic setup', 'owner': run_id}
            with mock.patch.object(main, 'RUN_WORK_ROOT', temporary), \
                 mock.patch.object(main, 'sb_claim_stage', return_value=True), \
                 mock.patch.object(main, 'sb_patch_run'), mock.patch.object(main, 'sb_patch_stage'), \
                 mock.patch.object(main, 'sb_get_run', return_value={}), \
                 mock.patch.object(main, 'ensure_dynamic_package', return_value={'package_dir': temporary, 'bbox': [0, 0, 1, 1]}), \
                 mock.patch.object(main, 'stage_setup', side_effect=setup), \
                 mock.patch.object(main.requests, 'get', return_value=mock.Mock(status_code=200, json=lambda: [])):
                for identity in IDS:
                    self.assertTrue(main.process_stage({'id': identity, 'run_id': identity, 'stage_name': 'AequilibraE Setup'}))
                for identity in IDS:
                    directory = root / 'runs' / identity
                    self.assertEqual((directory / 'owned-output.txt').read_text(), identity)
                    self.assertEqual(json.loads((directory / 'state.json').read_text())['setup']['owner'], identity)
                self.assertEqual((legacy / 'state.json').read_text(), 'unknown historical owner')

    def test_legacy_inflight_state_is_refused_before_claim(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(main, 'RUN_WORK_ROOT', temporary), mock.patch.object(main, 'sb_claim_stage', return_value=False) as claim:
            legacy = Path(temporary, 'runs', IDS[0][:12])
            legacy.mkdir(parents=True)
            (legacy / 'state.json').write_text('unverified predecessor')
            with self.assertRaisesRegex(RuntimeError, 'Legacy model scratch'):
                main.process_stage({'id': IDS[0], 'run_id': IDS[0], 'stage_name': 'Network Assignment'})
            claim.assert_not_called()
            self.assertEqual((legacy / 'state.json').read_text(), 'unverified predecessor')
            self.assertFalse(Path(temporary, 'runs', IDS[0]).exists())

    def test_invalid_identity_cannot_claim_or_create_files(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(main, 'RUN_WORK_ROOT', temporary), mock.patch.object(main, 'sb_claim_stage', return_value=False) as claim:
            for identity in ['../../escape', IDS[0].upper(), IDS[0][:12]]:
                with self.assertRaises(ValueError):
                    main.process_stage({'id': IDS[0], 'run_id': identity, 'stage_name': 'AequilibraE Setup'})
            claim.assert_not_called()
            self.assertEqual(list(Path(temporary).iterdir()), [])

if __name__ == '__main__':
    unittest.main()
