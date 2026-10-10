"""Stable assessment request preparation across fresh processes and changes."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import model_assessment_command as assessment
import model_command_journal as journal
from test_model_assessment_client import fixture, IDS, URL


class AssessmentPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'journal'
        self.payload, _ = fixture()

    def prepare(self, payload=None, identity=IDS[8], deployment='synthetic'):
        return assessment.prepare(self.directory, identity, self.payload if payload is None else payload,
                                  base_url=URL, deployment_id=deployment)

    def test_exact_request_survives_fresh_process_and_input_mutation(self):
        original = copy.deepcopy(self.payload)
        first = self.prepare()
        self.payload['p_partition']['count'] = 99
        self.assertEqual(first['arguments']['payload'], original)
        code = '''import json,sys
from pathlib import Path
import model_assessment_command as a
v=json.load(sys.stdin)
print(json.dumps(a.prepare(Path(v['directory']),v['identity'],v['payload'],base_url=v['url'],deployment_id='synthetic')))'''
        result = subprocess.run([sys.executable, '-B', '-c', code], input=json.dumps(dict(directory=str(self.directory), identity=IDS[8], payload=original, url=URL)), text=True, capture_output=True, timeout=15, cwd=Path(__file__).parent)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), first)
        self.assertEqual(len(journal.pending(self.directory, first['destination'])), 1)

    def test_changed_payload_cannot_get_a_new_request_for_same_assessment(self):
        first = self.prepare()
        for field, value in [('p_planning_use', 'Changed use'), ('p_model_run_id', IDS[0]), ('p_assessment_sha256', 'b'*64)]:
            with self.subTest(field=field):
                changed = copy.deepcopy(self.payload); changed[field] = value
                with self.assertRaisesRegex(ValueError, 'identity reused'):
                    self.prepare(changed)
        self.assertEqual(journal.pending(self.directory, first['destination'])[0]['command'], first)

    def test_resolved_request_is_still_immutable(self):
        first = self.prepare()
        journal.resolve(self.directory, first, {'synthetic': 'retained'})
        self.assertEqual(self.prepare(), first)
        changed = copy.deepcopy(self.payload); changed['p_partition']['count'] = 2
        with self.assertRaisesRegex(ValueError, 'identity reused'):
            self.prepare(changed)

    def test_deployment_and_assessment_id_separate_operations(self):
        first = self.prepare()
        second = self.prepare(identity=IDS[7])
        third = self.prepare(deployment='other-synthetic')
        self.assertEqual(len({first['request_id'], second['request_id'], third['request_id']}), 3)
        self.assertNotEqual(first['destination'], third['destination'])

    def test_invalid_input_never_creates_journal(self):
        with self.assertRaises(ValueError): self.prepare(identity='not-canonical')
        self.assertFalse(self.directory.exists())
        self.payload['p_assessment_size'] = True
        with self.assertRaises(ValueError): self.prepare()
        self.assertFalse(self.directory.exists())


if __name__ == '__main__':
    unittest.main()
