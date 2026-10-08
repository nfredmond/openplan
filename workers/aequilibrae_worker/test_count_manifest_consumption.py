"""Real-file count custody checks; no engine or scientific acceptance."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import model_count_inputs as inputs

class ConsumptionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        source = self.root / 'source.csv'
        source.write_bytes(b'station,count\nA,17\n')
        self.record = inputs.retain(str(source), str(self.root), self.root / 'first')
        self.target = self.root / 'second'
    def consume(self):
        return inputs.consume(self.record, self.target)
    def test_independent_copy(self):
        result = self.consume()
        first, second = Path(self.record['counts_path']), Path(result['counts_path'])
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertNotEqual(first.stat().st_ino, second.stat().st_ino)
        self.assertFalse((self.target / 'count_source_status.json').exists())
        with self.assertRaises(FileExistsError):
            self.consume()
    def test_manifest_tampering(self):
        path = Path(self.record['manifest_path'])
        path.write_bytes(path.read_bytes().replace(b'unassessed', b'XXXXXXXXXX'))
        with self.assertRaisesRegex(ValueError, 'manifest'):
            self.consume()
        self.assertFalse(self.target.exists())
    def test_changed_missing_and_new_files(self):
        for variant in ('changed', 'missing', 'appeared'):
            with self.subTest(variant=variant):
                path = Path(self.record['counts_path'])
                path.write_bytes(b'station,count\nA,17\n')
                sidecar = path.parent / 'count_source_status.json'
                sidecar.unlink(missing_ok=True)
                if variant == 'changed':
                    path.write_bytes(b'station,count\nA,99\n')
                elif variant == 'missing':
                    path.unlink()
                else:
                    sidecar.write_bytes(b'{}')
                self.target = self.root / variant
                with self.assertRaisesRegex(ValueError, 'bytes differ'):
                    self.consume()
    def test_change_during_recopy(self):
        retain = inputs.retain
        def changed(*args):
            Path(self.record['counts_path']).write_bytes(b'late replacement')
            return retain(*args)
        with patch.object(inputs, 'retain', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'bytes differ'):
                self.consume()
    def test_duplicate_keys(self):
        path = Path(self.record['manifest_path'])
        content = path.read_bytes().replace(b'{', b'{"schema":"duplicate",', 1)
        path.write_bytes(content)
        self.record.update(manifest_sha256=hashlib.sha256(content).hexdigest(), manifest_size_bytes=len(content))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.consume()
    def test_path_substitution(self):
        self.record['counts_path'] = str(self.root / 'source.csv')
        with self.assertRaisesRegex(ValueError, 'paths disagree'):
            self.consume()

    def test_assignment_verifies_before_engine_open(self):
        from test_model_skip_dispatch import aeq
        import aequilibrae
        Path(self.record['counts_path']).write_bytes(b'changed counts')
        with patch.object(aequilibrae, 'Project', side_effect=AssertionError('Engine entered before count verification')) as project, patch.object(aeq, 'sb_get_run', return_value={}), patch.object(aeq, 'sb_patch_stage'):
            with self.assertRaisesRegex(ValueError, 'bytes differ'):
                aeq.stage_assignment('run', 'stage', str(self.root / 'run'),
                    {'centroid_map': {1: 1}, 'bbox': (-122, 38, -120, 40)}, 'unused',
                    counts_path_override=self.record['counts_path'], count_inputs_override=self.record)
            project.assert_not_called()

    def test_artifacts_use_independent_inputs_without_rewriting_assignment(self):
        from test_model_skip_dispatch import aeq
        import copy
        assignment = {'count_inputs': self.record, 'counts_path': self.record['counts_path']}
        original = copy.deepcopy(assignment)
        output = self.root / 'run_output'
        output.mkdir()
        class StopBeforeEvidence(Exception):
            pass
        def inspect(local, name):
            path = Path(local['counts_path'])
            self.assertEqual(path, output / 'artifact_count_inputs/counts.csv')
            self.assertEqual(path.read_bytes(), Path(self.record['counts_path']).read_bytes())
            self.assertNotEqual(path.stat().st_ino, Path(self.record['counts_path']).stat().st_ino)
            self.assertEqual(local['count_inputs']['counts_input_directory'], str(path.parent))
            self.assertEqual(assignment, original)
            raise StopBeforeEvidence()
        with patch.object(aeq, 'validated_convergence_profile', return_value=({}, '', '')), patch.object(
                aeq, 'assignment_artifact_metadata', side_effect=inspect):
            with self.assertRaises(StopBeforeEvidence):
                aeq.stage_artifacts('run', 'stage', str(self.root), {}, assignment)
        self.assertEqual(assignment, original)

    def test_artifacts_refuse_tampered_counts_before_evidence(self):
        from test_model_skip_dispatch import aeq
        (self.root / 'run_output').mkdir()
        Path(self.record['counts_path']).write_bytes(b'changed counts')
        with patch.object(aeq, 'validated_convergence_profile', side_effect=AssertionError('Evidence entered before count verification')) as evidence:
            with self.assertRaisesRegex(ValueError, 'bytes differ'):
                aeq.stage_artifacts('run', 'stage', str(self.root), {},
                    {'count_inputs': self.record, 'counts_path': self.record['counts_path']})
            evidence.assert_not_called()

    def test_legacy_artifact_record_does_not_claim_retained_inputs(self):
        from test_model_skip_dispatch import aeq
        assignment = {'counts_path': str(self.root / 'source.csv')}
        class StopBeforeEvidence(Exception):
            pass
        def inspect(local, name):
            self.assertIs(local, assignment)
            self.assertNotIn('count_inputs', local)
            raise StopBeforeEvidence()
        with patch.object(aeq, 'validated_convergence_profile', return_value=({}, '', '')), patch.object(
                aeq, 'assignment_artifact_metadata', side_effect=inspect):
            with self.assertRaises(StopBeforeEvidence):
                aeq.stage_artifacts('run', 'stage', str(self.root), {}, assignment)
        self.assertFalse((self.root / 'run_output/artifact_count_inputs').exists())
