"""Child assignment consumes parent count records without another acquisition."""
from pathlib import Path
import unittest
from unittest.mock import patch
import model_count_inputs
import model_engine_binding as bindings
import test_assignment_engine_binding as fixtures
from test_model_skip_dispatch import aeq

class AssignmentEngineInputTests(unittest.TestCase):
    setUp=fixtures.AssignmentEngineBindingTests.setUp

    def prepare(self):
        self.output=self.root/'run_output';self.output.mkdir()
        source=self.root/'source.csv';source.write_text('station_id,count_year,aadt\nA,2020,123\n')
        self.record=model_count_inputs.retain(str(source),self.root,self.output/'count_inputs')
        self.client.prepare_counts.return_value=self.record
        with bindings.bind(self.binding):aeq.create_assignment_output_directory(str(self.root),'run_output')
        return source

    def call(self,**kwargs):
        with bindings.bind(self.binding),patch.object(aeq,'auto_ingest_counts',side_effect=AssertionError('Child acquisition forbidden')):
            return aeq.prepare_assignment_count_inputs({}, {}, 'unused',str(self.output),calibrate_requested=False,**kwargs)

    def test_parent_counts_are_independently_verified_and_copied(self):
        source=self.prepare();result=self.call()
        self.assertEqual(Path(result['counts_path']).read_bytes(),source.read_bytes())
        self.assertNotEqual(result['counts_path'],self.record['counts_path'])
        self.assertNotEqual(Path(result['counts_path']).stat().st_ino,Path(self.record['counts_path']).stat().st_ino)
        self.assertTrue(Path(result['counts_path']).is_relative_to(self.output/'child_count_inputs'))
        self.client.prepare_counts.assert_called_once_with()

    def test_changed_parent_counts_stop_without_acquisition(self):
        self.prepare();Path(self.record['counts_path']).write_text('changed')
        with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.call()

    def test_child_override_refused_before_request(self):
        self.prepare()
        with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.call(counts_path_override='/foreign')
        self.client.prepare_counts.assert_not_called()

    def test_transit_requires_parent_outputs_and_no_child_override(self):
        with self.assertRaises(ValueError):self.binding.prepare_transit(str(self.root),None)
        self.prepare()
        with self.assertRaises(ValueError):self.binding.prepare_transit(str(self.output),{})
        self.client.prepare_transit.assert_not_called()
        self.client.prepare_transit.return_value={'status':'unavailable'}
        self.assertEqual(self.binding.prepare_transit(str(self.output),None),{'status':'unavailable'})
        self.client.prepare_transit.assert_called_once_with()

if __name__=='__main__':unittest.main()
