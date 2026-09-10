"""Financial counterexamples against fields from a producer-created fixture."""
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))
import reconstruct_owp_restore as reconstruction


class ReconstructionTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((Path(__file__).parent/'fixtures/owp-recovery.json').read_text())

    def test_independent_arithmetic_and_original_survive(self):
        result = reconstruction.reconstruct(**self.data)
        self.assertEqual(result['incurredAcrossCycles'], '20.35')
        self.assertEqual(result['priorUnpaidClaim'], '3.00')
        self.assertEqual(result['successorClaimRequest'], '8.00')
        self.assertEqual(result['outstandingCommitment'], '15.00')
        self.assertEqual(result['refundRemaining'], '1.00')
        self.assertEqual((result['originalCarryover'], result['currentCarryover']), ('20.00', '19.00'))
        self.assertTrue(result['oldPeriodClosed'])

    def test_changed_source_cost_is_detected(self):
        row = next(row for row in self.data['old']['source']['report']['snapshot']['actuals'] if row['kind'] == 'labor')
        row['amount'] = '13.35'
        with self.assertRaisesRegex(AssertionError, 'incurredAcrossCycles: expected 20.35, reconstructed 21.35'):
            reconstruction.reconstruct(**self.data)

    def test_duplicate_physical_identity_is_detected(self):
        for field, message in [('entry_id', 'Physical source entry duplicated'), ('source_key', 'Physical source key duplicated')]:
            data = copy.deepcopy(self.data)
            data['physical'][1][field] = data['physical'][0][field]
            with self.assertRaisesRegex(AssertionError, message):
                reconstruction.reconstruct(**data)

    def test_original_approval_and_cash_limits_are_checked(self):
        for change, message in [('original', 'Original carryover changed'), ('receipt', 'Cash match exceeds physical payment'), ('actor', 'Approval actor or evidence lost'), ('currency', 'Different currencies cannot be added')]:
            data = copy.deepcopy(self.data)
            if change == 'original':
                data['old']['records'][1]['content']['assessment']['work'][0]['allocations'][0]['amount'] = '19.00'
            elif change == 'receipt':
                data['old']['records'][-1]['content']['assessment']['claims'][0]['receipts'][0]['amount'] = '8.00'
            elif change == 'actor':
                data['old']['records'][1]['actor_id'] = 'other'
            else:
                data['successor']['source']['report']['snapshot']['baseline']['content_json']['currency'] = 'EUR'
            with self.assertRaisesRegex(AssertionError, message):
                reconstruction.reconstruct(**data)

    def test_unknown_or_truncated_response_count_is_refused(self):
        for total in ('2', '3', '*'):
            response = io.BytesIO(b'[{"id":1},{"id":2}]')
            response.headers = {'Content-Range': '0-1/'+total}
            with patch.dict(os.environ, {'RESTORE_API_URL': 'http://127.0.0.1', 'RESTORE_SERVICE_KEY': 'synthetic'}), patch.object(reconstruction.urllib.request, 'urlopen', return_value=response):
                if total == '2':
                    self.assertEqual(len(reconstruction.request('/test')), 2)
                else:
                    with self.assertRaisesRegex(ValueError, 'Incomplete source query'):
                        reconstruction.request('/test')

    def test_optimized_python_cannot_silently_remove_verification(self):
        result = subprocess.run([sys.executable, '-O', '-c', 'import reconstruct_owp_restore as r; r.reconstruct({}, {}, {}, [])'],
                                env={**os.environ, 'PYTHONPATH': str(OPS)}, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Recovery verification requires assertions enabled', result.stdout)


if __name__ == '__main__':
    unittest.main()
