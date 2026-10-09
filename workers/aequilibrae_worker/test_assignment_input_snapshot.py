"""Retained solver inputs precede execution; failures never call the engine."""
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
import model_assignment_input_snapshot as snapshot


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.path=Path(temporary.name)/'inputs'
        classes=[]
        for name,values in [('resident',[[0.,7.],[3.,0.]]),('external',[[0.,2.],[1.,0.]])]:
            matrix=SimpleNamespace(index=np.array([100,900]),matrix_view=np.array(values),view_names=[name])
            classes.append(SimpleNamespace(_id=name,matrix=matrix,graph=SimpleNamespace(centroids=np.array([100,900])),pce=1.))
        self.engine=SimpleNamespace(classes=classes,rgap_target=.001,max_iter=100,cores=1,execute=Mock())
        self.profile={'target_gap':.001,'max_iterations':100,'cores':1,'class_pce':1.}

    def call(self):
        return snapshot.retain_and_execute(self.engine,directory=self.path,context={'run_id':'synthetic','stage_id':'synthetic-stage','demand_method':'aequilibrae'},profile=self.profile,network_state={'sha256':'synthetic-network'},network_settings={'speed':1.})

    def test_complete_exact_inputs_exist_before_execute(self):
        def execute():
            manifest=json.loads((self.path/'manifest.json').read_bytes())
            self.assertEqual(manifest['profile'],self.profile)
            self.assertEqual(manifest['network_settings'],{'speed':1.})
            self.assertEqual(manifest['scope'],'initial_assignment_only')
            self.assertEqual(manifest['scientific_acceptance'],'unassessed')
            for index,record in enumerate(manifest['classes']):
                for role,expected in [('centroids',self.engine.classes[index].matrix.index),('demand',self.engine.classes[index].matrix.matrix_view)]:
                    path=self.path/record[role]['path'];content=path.read_bytes()
                    self.assertEqual(hashlib.sha256(content).hexdigest(),record[role]['sha256'])
                    self.assertEqual(len(content),record[role]['bytes'])
                    np.testing.assert_array_equal(np.load(path,allow_pickle=False),expected)
            self.engine.classes[0].matrix.matrix_view[:]=0
        self.engine.execute.side_effect=execute
        result=self.call();self.engine.execute.assert_called_once()
        self.assertEqual(result['sha256'],hashlib.sha256((self.path/'manifest.json').read_bytes()).hexdigest())
        self.assertEqual(np.load(self.path/'resident_demand.npy')[0,1],7.)

    def test_partial_directory_is_not_adopted(self):
        self.path.mkdir();(self.path/'prior').write_bytes(b'preserve')
        with self.assertRaises(FileExistsError):self.call()
        self.engine.execute.assert_not_called();self.assertEqual((self.path/'prior').read_bytes(),b'preserve')

    def test_write_or_manifest_failure_prevents_execution(self):
        for name in ('save','manifest'):
            target=patch.object(snapshot.np,'save',side_effect=OSError('disk full')) if name=='save' else patch.object(snapshot.model_record_files,'materialize',side_effect=OSError('disk full'))
            self.path=self.path.parent/name
            with target,self.assertRaisesRegex(OSError,'disk full'):self.call()
            self.engine.execute.assert_not_called();self.assertFalse((self.path/'manifest.json').exists())

    def test_invalid_class_demand_never_executes(self):
        for value in (float('nan'),float('inf'),-1.):
            self.engine.classes[0].matrix.matrix_view[0,1]=value
            with self.assertRaisesRegex(ValueError,'finite nonnegative'):self.call()
            self.engine.execute.assert_not_called();self.assertFalse(self.path.exists())

    def test_centroid_order_or_duplicates_never_execute(self):
        for ids in ([900,100],[100,100]):
            self.engine.classes[1].matrix.index[:]=ids
            with self.assertRaisesRegex(ValueError,'centroid'):self.call()
            self.engine.execute.assert_not_called()

    def test_graph_centroid_mismatch_never_executes(self):
        self.engine.classes[0].graph.centroids[:]=[900,100]
        with self.assertRaisesRegex(ValueError,'graph centroid'):self.call()
        self.engine.execute.assert_not_called()

    def test_changed_settings_or_pce_never_execute(self):
        self.engine.max_iter=101
        with self.assertRaisesRegex(ValueError,'settings differ'):self.call()
        self.engine.max_iter=100;self.engine.classes[0].pce=2.
        with self.assertRaisesRegex(ValueError,'PCE differs'):self.call()
        self.engine.execute.assert_not_called()

    def test_corrupt_saved_array_prevents_execute(self):
        save=snapshot.np.save
        def corrupt(stream,array,**kwargs):return save(stream,np.zeros_like(array),**kwargs)
        with patch.object(snapshot.np,'save',corrupt),self.assertRaisesRegex(ValueError,'differs from solver input'):self.call()
        self.engine.execute.assert_not_called()

    def test_engine_failure_preserves_completed_snapshot(self):
        self.engine.execute.side_effect=RuntimeError('solver failure')
        with self.assertRaisesRegex(RuntimeError,'solver failure'):self.call()
        self.assertTrue((self.path/'manifest.json').is_file())


if __name__=='__main__':unittest.main()
