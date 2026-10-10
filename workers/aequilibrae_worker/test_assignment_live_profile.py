"""Live-object drift must stop before retaining inputs or calling the solver."""
import copy
import json
import unittest
from unittest.mock import patch

import numpy as np
import assignment_settings
import model_assignment_input_snapshot as snapshot
import model_assignment_live_profile as live
import test_assignment_input_snapshot as fixtures


class LiveProfileTests(unittest.TestCase):
    setUp = fixtures.SnapshotTests.setUp

    def refuse(self, mutate, reason):
        engine = copy.deepcopy(self.engine)
        mutate(engine)
        with self.assertRaisesRegex(ValueError, reason):
            snapshot.retain_and_execute(engine, directory=self.path, context={}, profile=self.profile,
                                       network_state={}, network_settings={})
        engine.execute.assert_not_called()
        self.assertFalse(self.path.exists())

    def test_snapshot_retains_live_profile_result(self):
        fixtures.SnapshotTests.call(self)
        result = json.loads((self.path/'manifest.json').read_text())['live_profile_verification']
        self.assertEqual(result, {'scope':'initial_assignment_profile_fields','status':'matched',
            'engine_version':'1.6.2','canonical_profile_sha256':assignment_settings.assignment_profile_digest(self.profile)})

    def test_internal_solver_settings_drift_refuses(self):
        for name, value in (('rgap_target', .001), ('max_iter', 100), ('cores', 2), ('algorithm', 'msa')):
            with self.subTest(name=name):
                self.refuse(lambda engine: setattr(engine.assignment, name, value), 'settings differ')

    def test_wrapper_algorithm_or_fields_drift_refuses(self):
        for name, value in (('algorithm', 'msa'), ('time_field', 'distance'), ('capacity_field', 'lanes')):
            with self.subTest(name=name):
                self.refuse(lambda engine: setattr(engine, name, value), 'differ')

    def test_internal_fields_or_vdf_drift_refuses(self):
        for name, value in (('time_field', 'distance'), ('cap_field', 'lanes')):
            with self.subTest(name=name):
                self.refuse(lambda engine: setattr(engine.assignment, name, value), 'differ')
        self.refuse(lambda engine: setattr(engine.assignment.vdf, 'function', 'BPR2'), 'VDF differ')

    def test_effective_vdf_arrays_refuse_drift_or_wrong_shape(self):
        for value in (.16, float('nan')):
            self.refuse(lambda engine: engine.assignment.vdf_parameters[0].__setitem__(0, value), 'parameter values differ')
        self.refuse(lambda engine: setattr(engine.assignment, 'vdf_parameters', [np.array([.15]),np.array([4.])]), 'parameter shape differs')
        self.refuse(lambda engine: setattr(engine.assignment, 'vdf_parameters', []), 'parameter inventory differs')

    def test_graph_values_must_match_effective_arrays(self):
        for target in ('capacity', 'free_flow_tt'):
            with self.subTest(target=target):
                self.refuse(lambda engine: getattr(engine.assignment,target).__setitem__(0,99.), 'network field values differ')

    def test_invalid_graph_indices_refuse(self):
        for ids in ([0,0], [-1,1], [0,2], [0.5,1.5]):
            self.refuse(lambda engine: engine.classes[0].graph.graph.__setitem__('__supernet_id__',np.array(ids)), 'network (index invalid|field values differ)')

    def test_class_identity_and_internal_cores_refuse(self):
        self.refuse(lambda engine: setattr(engine.assignment,'traffic_classes',list(reversed(engine.classes))), 'solver classes differ')
        for name in ('results','_aon_results'):
            self.refuse(lambda engine: setattr(getattr(engine.classes[0],name),'cores',2), 'class core count differs')

    def test_installed_version_mismatch_refuses(self):
        with patch.object(live,'installed_assignment_engine_version',return_value='1.6.3'):
            self.refuse(lambda engine: None, 'engine version differs')

    def test_graph_row_permutation_preserves_same_effective_values(self):
        for item in self.engine.classes:
            item.graph.graph = {key:value[::-1].copy() for key,value in item.graph.graph.items()}
        self.assertEqual(live.verify(self.engine,self.profile)['status'],'matched')


if __name__ == '__main__': unittest.main()
