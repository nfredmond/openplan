"""Retained compact paths and forward-star checks on explicit source chains."""
import copy
from types import SimpleNamespace
import unittest

import numpy as np
import model_assignment_compact_graph as compact


def fixture():
    return SimpleNamespace(centroids=np.array([1,2,3]),all_nodes=np.array([1,2,3,10,11]),
        compact_all_nodes=np.array([1,2,3]),compact_num_nodes=3,compact_num_links=3,
        compact_fs=np.array([0,1,2,3]),
        compact_graph={'id':np.array([0,1,2]),'a_node':np.array([0,1,2]),'b_node':np.array([1,2,0])},
        graph={'a_node':np.array([0,3,1,2,3]),'b_node':np.array([3,1,2,0,4]),
               'link_id':np.array([5,6,7,8,9]),'direction':np.ones(5,dtype=np.int64),
               '__compressed_id__':np.array([0,0,1,2,3])})


class CompactGraphTests(unittest.TestCase):
    def test_chain_and_reordered_sources_match_without_certifying_exclusions(self):
        graph=fixture();record=compact.verify(graph)
        self.assertEqual(record['status'],'matched')
        self.assertEqual(record['excluded_direction_count'],1)
        self.assertEqual(record['excluded_direction_equivalence'],'unassessed')
        self.assertEqual(record['runtime_cost_and_flow_equivalence'],'unassessed')
        graph.graph={name:values[::-1].copy() for name,values in graph.graph.items()}
        self.assertEqual(compact.verify(graph),record)

    def test_changed_compact_endpoint_refuses(self):
        graph=fixture();graph.compact_graph['b_node'][0]=2
        with self.assertRaisesRegex(ValueError,'chain (crosses|differs)'):compact.verify(graph)

    def test_changed_forward_star_refuses(self):
        graph=fixture();graph.compact_fs[1]=0
        with self.assertRaisesRegex(ValueError,'forward star'):compact.verify(graph)

    def test_misdirected_source_crosswalk_refuses(self):
        graph=fixture();graph.graph['__compressed_id__'][0]=1
        with self.assertRaisesRegex(ValueError,'chain'):compact.verify(graph)

    def test_missing_source_chain_refuses(self):
        graph=fixture();graph.graph['__compressed_id__'][2]=3
        with self.assertRaisesRegex(ValueError,'chain differs'):compact.verify(graph)

    def test_source_branch_refuses(self):
        graph=fixture();graph.graph['__compressed_id__'][4]=0
        with self.assertRaisesRegex(ValueError,'chain branches'):compact.verify(graph)

    def test_interior_centroid_refuses(self):
        graph=fixture();graph.centroids=np.array([1,2,3,10])
        with self.assertRaisesRegex(ValueError,'crosses a centroid'):compact.verify(graph)

    def test_bad_integer_arrays_counts_and_indices_refuse(self):
        original=fixture()
        changes=[('compact_fs',np.array([0.,1.,2.,3.])),('compact_num_nodes',4),
                 ('compact_num_links',4),('compact_all_nodes',np.array([1,1,3]))]
        for name,value in changes:
            graph=copy.deepcopy(original);setattr(graph,name,value)
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,'Compact routing'):compact.verify(graph)
        for column,value in (('id',7),('b_node',99)):
            graph=fixture();graph.compact_graph[column][0]=value
            with self.subTest(column=column),self.assertRaisesRegex(ValueError,'Compact routing'):compact.verify(graph)
        for value in (-1,4):
            graph=fixture();graph.graph['__compressed_id__'][0]=value
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'source index'):compact.verify(graph)


if __name__=='__main__':unittest.main()
