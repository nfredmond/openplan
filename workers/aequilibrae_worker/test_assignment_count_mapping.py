"""Count relocation preserves source bytes and the original assignment record."""
import copy
from pathlib import Path
import tempfile
import unittest
import model_count_inputs as counts
import model_package_inputs as packages
import model_predecessor_inputs as predecessor


class CountMappingTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root=Path(temp.name)
        source=self.root/'source.csv';source.write_bytes(b'station_id,aadt\nA,17\n')
        outputs=self.root/'run_output';outputs.mkdir()
        record=counts.retain(str(source),str(outputs),outputs/'count_inputs')
        producer={'stage_id':'stage','attempt_id':'attempt'}
        self.state={'producer':producer,'state':{'assignment':{'counts_path':record['counts_path'],'count_inputs':record,'source_label':str(source)}}}
        captured=packages.retain(outputs,self.root/'captured')
        consumed=packages.consume(captured,self.root/'consumed')
        self.output={**consumed,'outputs_directory':consumed['package_directory'],'producer':dict(producer)}

    def test_mapped_record_can_be_consumed_without_rewriting_sources(self):
        original=copy.deepcopy(self.state)
        original_manifest=Path(self.state['state']['assignment']['count_inputs']['manifest_path']).read_bytes()
        mapped=predecessor.map_assignment_counts(self.state,self.output)
        record=mapped['assignment']['count_inputs']
        self.assertEqual(record['manifest_path'],str(Path(self.output['outputs_directory'])/'count_inputs/manifest.json'))
        self.assertEqual(Path(record['manifest_path']).read_bytes(),original_manifest)
        self.assertEqual(mapped['assignment']['source_label'],original['state']['assignment']['source_label'])
        self.assertEqual(self.state,original)
        copied=counts.consume(record,self.root/'artifact_count_inputs')
        self.assertEqual(Path(copied['counts_path']).read_bytes(),b'station_id,aadt\nA,17\n')
        self.assertEqual(record['manifest_sha256'],original['state']['assignment']['count_inputs']['manifest_sha256'])

    def test_different_attempt_refused(self):
        self.output['producer']['attempt_id']='different'
        with self.assertRaisesRegex(ValueError,'same producer attempt'):
            predecessor.map_assignment_counts(self.state,self.output)

    def test_foreign_count_path_refused(self):
        self.state['state']['assignment']['count_inputs']['manifest_path']='/foreign/manifest.json'
        with self.assertRaisesRegex(ValueError,'paths differ'):
            predecessor.map_assignment_counts(self.state,self.output)

    def test_top_level_count_path_must_match(self):
        self.state['state']['assignment']['counts_path']='/foreign/counts.csv'
        with self.assertRaisesRegex(ValueError,'paths differ'):
            predecessor.map_assignment_counts(self.state,self.output)

    def test_missing_count_record_refused(self):
        del self.state['state']['assignment']['count_inputs']
        with self.assertRaisesRegex(ValueError,'no retained count'):
            predecessor.map_assignment_counts(self.state,self.output)

    def test_changed_copied_count_manifest_is_rejected_by_consumer(self):
        mapped=predecessor.map_assignment_counts(self.state,self.output)
        record=mapped['assignment']['count_inputs']
        Path(record['manifest_path']).write_bytes(b'{}')
        with self.assertRaises(ValueError):counts.consume(record,self.root/'artifact_count_inputs')


if __name__=='__main__':unittest.main()
