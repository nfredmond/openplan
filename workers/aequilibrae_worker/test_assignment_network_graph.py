"""Directed source comparison with real SQLite and synthetic prepared graphs."""
import copy
import sqlite3
import unittest

import numpy as np
import model_assignment_network_graph as graph_check
import model_assignment_input_snapshot as snapshot
import test_assignment_input_snapshot as inputs
from test_assignment_network_source import fixture
from network_settings import assignment_network_settings


class NetworkGraphTests(unittest.TestCase):
    setUp_inputs=inputs.SnapshotTests.setUp

    def setUp(self):
        self.setUp_inputs()
        self.database=self.path.parent/'network.sqlite';fixture(self.database)
        self.settings=assignment_network_settings()

    def call(self):return graph_check.verify(self.engine,self.database,self.settings)

    def sql(self,statement):
        with sqlite3.connect(self.database) as connection:connection.execute(statement)

    def test_baseline_and_row_reordering_match_source(self):
        source,record=self.call()
        self.assertEqual(record['source_sha256'],source['sha256'])
        self.assertEqual(record['compressed_routing_equivalence'],'unassessed')
        self.assertTrue(all(item['directed_link_count']==2 for item in record['graphs']))
        for item in self.engine.classes:
            item.graph.graph={key:value[::-1].copy() for key,value in item.graph.graph.items()}
        self.assertEqual(self.call(),(source,record))

    def test_recorded_road_class_factors_match_effective_fields(self):
        self.sql("ALTER TABLE links ADD COLUMN link_type TEXT DEFAULT 'primary'")
        self.settings=assignment_network_settings({'primary':2.})
        for item in self.engine.classes:
            item.graph.graph['travel_time']/=2.;item.graph.graph['capacity']*=2.
        self.assertEqual(self.call()[1]['status'],'matched')
        self.settings=assignment_network_settings()
        with self.assertRaisesRegex(ValueError,'recorded transformations'):self.call()

    def test_unavailable_mode_collapses_both_directions_to_source_a_node(self):
        self.sql("UPDATE links SET modes='w'")
        for item in self.engine.classes:
            item.graph.graph['modes'][:]='w'
            item.graph.graph['a_node'][:]=0;item.graph.graph['b_node'][:]=0
        self.assertEqual(self.call()[1]['status'],'matched')
        self.engine.classes[0].graph.graph['b_node'][0]=1
        with self.assertRaisesRegex(ValueError,'recorded transformations'):self.call()

    def test_one_way_directions_match_without_inventing_reverse_edges(self):
        original=copy.deepcopy(self.engine)
        for direction,index in ((1,0),(-1,1)):
            self.engine=copy.deepcopy(original)
            self.sql('UPDATE links SET direction='+str(direction))
            for item in self.engine.classes:
                item.graph.graph={key:value[[index]] for key,value in item.graph.graph.items()}
            self.assertTrue(all(row['directed_link_count']==1 for row in self.call()[1]['graphs']))

    def test_unexplained_numeric_or_topology_changes_refuse(self):
        original=copy.deepcopy(self.engine)
        for field,value in (('capacity',999.),('travel_time',7.),('distance',2999.),('a_node',1),('direction',-1)):
            self.engine=copy.deepcopy(original)
            self.engine.classes[0].graph.graph[field][0]=value
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,'recorded transformations'):self.call()

    def test_invalid_or_absent_node_map_refuses(self):
        original=copy.deepcopy(self.engine)
        self.engine.classes[0].graph.graph['a_node'][0]=20
        with self.assertRaisesRegex(ValueError,'node index'):self.call()
        self.engine=copy.deepcopy(original)
        self.engine.classes[0].graph.all_nodes=np.array([100,900,999])
        with self.assertRaisesRegex(ValueError,'nodes absent'):self.call()

    def test_missing_and_extra_directions_refuse(self):
        original=copy.deepcopy(self.engine)
        for indices in ([0],[0,1,1]):
            self.engine=copy.deepcopy(original)
            for item in self.engine.classes:
                item.graph.graph={key:value[indices] for key,value in item.graph.graph.items()}
                if len(indices)>2:item.graph.graph['link_id'][-1]=10
            with self.assertRaisesRegex(ValueError,'graph (differs|adds|omits)'):self.call()

    def test_drift_stops_snapshot_and_execution_even_when_live_arrays_agree(self):
        for item in self.engine.classes:item.graph.graph['capacity'][0]=999.
        self.engine.capacity[0]=999.
        with self.assertRaisesRegex(ValueError,'recorded transformations'):
            snapshot.retain_and_execute(self.engine,directory=self.path,context={},profile=self.profile,
                network_state={},network_settings=self.settings,network_database=self.database)
        self.engine.execute.assert_not_called();self.assertFalse(self.path.exists())

    def test_missing_settings_or_invalid_source_direction_refuses(self):
        self.settings={}
        with self.assertRaisesRegex(ValueError,'fields do not match'):self.call()
        self.settings=assignment_network_settings();self.sql('UPDATE links SET direction=2')
        with self.assertRaisesRegex(ValueError,'Source link direction'):self.call()

    def test_centroid_policy_drift_stops_before_snapshot_and_execution(self):
        original=copy.deepcopy(self.engine)
        changes=(('block_centroid_flows',False),('block_centroid_flows',1),('num_zones',3),
                 ('centroids',np.array([100,100])),('centroids',np.array([0,900])),
                 ('all_nodes',np.array([900,100])),('compact_all_nodes',np.array([900,100])),
                 ('nodes_to_indices',np.zeros(901,dtype=np.int64)),
                 ('compact_nodes_to_indices',np.zeros(901,dtype=np.int64)),
                 ('compact_nodes_to_indices',np.array([0,1])))
        for field,value in changes:
            self.engine=copy.deepcopy(original)
            setattr(self.engine.classes[0].graph,field,value)
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,'centroid|zone count'):
                snapshot.retain_and_execute(self.engine,directory=self.path,context={},profile=self.profile,
                    network_state={},network_settings=self.settings,network_database=self.database)
            self.engine.execute.assert_not_called();self.assertFalse(self.path.exists())

    def test_centroid_mapping_verification_does_not_claim_path_equivalence(self):
        record=self.call()[1]
        self.assertEqual(record['centroid_policy'],{'block_through_flows':True,
            'directed_and_compact_centroid_indices':'matched'})
        self.assertEqual(record['compressed_routing_equivalence'],'unassessed')


if __name__=='__main__':unittest.main()
